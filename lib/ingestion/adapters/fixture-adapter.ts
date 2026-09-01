import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import {
  UTF8_TEXT_ENCODING,
  type ExtractedRecord,
  type ExtractedRecordId,
  type OriginalText,
  type RawBlob,
  type RecruitmentEndpoint,
  type Snapshot,
  type SourceRecordLocator
} from "../domain";
import type {
  AdapterCompletenessAssessment,
  AdapterCompletenessInput,
  AdapterDescriptor,
  AdapterExtractionInput,
  AdapterNextPageInput,
  AdapterRequestPlan,
  EndpointValidationResult,
  RecruitmentAdapter
} from "./contract";
import { AdapterExtractionError } from "./errors";

const descriptor: AdapterDescriptor = {
  adapter_key: "fixture",
  name: "FixtureAdapter",
  version: "1.0.0",
  supported_content_kinds: ["HTML", "JSON", "PDF", "FILE"],
  capabilities: [
    "SINGLE_PAGE",
    "PAGINATION",
    "HTML_EXTRACTION",
    "JSON_EXTRACTION",
    "DOCUMENT_TEXT_EXTRACTION"
  ]
};

type CheerioNodeSet = ReturnType<ReturnType<typeof cheerio.load>>;

export class FixtureAdapter implements RecruitmentAdapter {
  readonly descriptor = descriptor;

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const issues: string[] = [];
    if (endpoint.adapter_key !== this.descriptor.adapter_key) {
      issues.push(`Endpoint adapter_key must be ${this.descriptor.adapter_key}`);
    }
    if (!endpoint.locator.startsWith("fixture://")) {
      issues.push("FixtureAdapter only accepts fixture:// locators");
    }
    if (!this.descriptor.supported_content_kinds.includes(endpoint.content_kind)) {
      issues.push(`Unsupported content kind: ${endpoint.content_kind}`);
    }
    return issues.length === 0
      ? { valid: true, issues: [] }
      : { valid: false, issues };
  }

  plan(endpoint: RecruitmentEndpoint): readonly AdapterRequestPlan[] {
    this.assertEndpoint(endpoint);
    return [{
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: endpoint.locator,
      method: endpoint.request_method ?? null,
      parameters: {},
      pagination_state: {
        page_index: 1,
        cursor: null,
        visited_locators: [endpoint.locator]
      }
    }];
  }

  extract(input: AdapterExtractionInput): readonly ExtractedRecord[] {
    this.assertEndpoint(input.endpoint);
    const rawBlob = this.assertTraceability(input.snapshot, input.raw_blob);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBlob.bytes);

    try {
      const records = input.endpoint.content_kind === "HTML"
        ? extractHtml(input, text)
        : input.endpoint.content_kind === "JSON"
          ? extractJson(input, text)
          : extractDocument(input, text);
      return deduplicateSourceRecords(records);
    } catch (error) {
      if (error instanceof AdapterExtractionError) throw error;
      throw new AdapterExtractionError(
        "MALFORMED_CONTENT",
        error instanceof Error ? error.message : "Fixture content is malformed"
      );
    }
  }

  nextPage(input: AdapterNextPageInput): AdapterRequestPlan | null {
    this.assertEndpoint(input.endpoint);
    if (input.snapshot.transport_status === "FAILED") return null;
    const nextLocator = input.snapshot.response_metadata.headers["x-fixture-next-locator"];
    if (!nextLocator) return null;
    if (!nextLocator.startsWith("fixture://")) {
      throw new AdapterExtractionError(
        "MALFORMED_CONTENT",
        "Fixture next-page locator must use fixture://"
      );
    }
    if (input.pagination_state.visited_locators.includes(nextLocator)) return null;
    return {
      recruitment_endpoint_id: input.endpoint.recruitment_endpoint_id,
      locator: nextLocator,
      method: input.endpoint.request_method ?? null,
      parameters: {},
      pagination_state: {
        page_index: input.pagination_state.page_index + 1,
        cursor: nextLocator,
        visited_locators: [...input.pagination_state.visited_locators, nextLocator]
      }
    };
  }

  assessCompleteness(input: AdapterCompletenessInput): AdapterCompletenessAssessment {
    if (input.extraction_errors.length > 0 || input.snapshots.some(
      (snapshot) => snapshot.transport_status === "FAILED"
    )) {
      return { status: "FAILED", reason_codes: ["TRANSPORT_OR_EXTRACTION_FAILED"] };
    }
    if (input.snapshots.length === 0) {
      return { status: "FAILED", reason_codes: ["NO_SNAPSHOTS"] };
    }
    const lastSnapshot = input.snapshots[input.snapshots.length - 1];
    if (lastSnapshot.response_metadata.headers["x-fixture-next-locator"]) {
      return { status: "PARTIAL", reason_codes: ["NEXT_PAGE_NOT_COLLECTED"] };
    }
    if (input.records.length === 0) {
      return { status: "SUSPICIOUS_EMPTY", reason_codes: ["ZERO_EXTRACTED_RECORDS"] };
    }
    return { status: "COMPLETE", reason_codes: ["ALL_PLANNED_PAGES_EXTRACTED"] };
  }

  private assertEndpoint(endpoint: RecruitmentEndpoint) {
    const validation = this.validateEndpoint(endpoint);
    if (!validation.valid) {
      throw new AdapterExtractionError(
        "ENDPOINT_NOT_SUPPORTED",
        validation.issues.join("; ")
      );
    }
  }

  private assertTraceability(snapshot: Snapshot, rawBlob: RawBlob | null) {
    if (snapshot.transport_status === "FAILED") {
      throw new AdapterExtractionError("SNAPSHOT_FAILED", "Cannot extract a failed Snapshot");
    }
    if (!rawBlob) {
      throw new AdapterExtractionError("RAW_BLOB_REQUIRED", "Successful Snapshot requires RawBlob");
    }
    if (
      snapshot.raw_blob_id !== rawBlob.raw_blob_id
      || snapshot.content_hash !== rawBlob.raw_content_sha256
      || snapshot.content_length !== rawBlob.byte_length
    ) {
      throw new AdapterExtractionError(
        "RAW_BLOB_MISMATCH",
        "Snapshot does not reference the supplied RawBlob"
      );
    }
    return rawBlob;
  }
}

function extractHtml(input: AdapterExtractionInput, text: string) {
  const $ = cheerio.load(text);
  return $("[data-fixture-record]").toArray().map((element, index) => {
    const node = $(element);
    const rawSourceRecordId = optionalString(node.attr("data-fixture-record"));
    const locator: SourceRecordLocator = {
      kind: "HTML",
      selector: rawSourceRecordId
        ? `[data-fixture-record="${rawSourceRecordId}"]`
        : `[data-fixture-record]:nth-of-type(${index + 1})`,
      path: `$.fixture-records[${index}]`
    };
    return record(input, index, locator, {
      raw_source_record_id: rawSourceRecordId,
      raw_title: fieldText(node, "title"),
      raw_organization_name: fieldText(node, "organization"),
      raw_location_text: node.find('[data-field="location"]').toArray()
        .map((location) => original($(location).text().trim()))
        .filter((location) => location.text.length > 0),
      raw_description: fieldText(node, "description"),
      raw_requirement_text: fieldText(node, "requirement"),
      announcement_url: fieldHref(node, "announcement-url"),
      application_url: fieldHref(node, "application-url"),
      publish_time: fieldText(node, "publish-time"),
      deadline: fieldText(node, "deadline"),
      recruitment_year: fieldText(node, "recruitment-year"),
      recruitment_batch: fieldText(node, "recruitment-batch"),
      adapter_details: { format: "HTML", record_index: index }
    });
  });
}

function extractJson(input: AdapterExtractionInput, text: string) {
  const parsed = JSON.parse(text) as unknown;
  if (!isObject(parsed) || !Array.isArray(parsed.records)) {
    throw new AdapterExtractionError("MALFORMED_CONTENT", "Fixture JSON must contain records[]");
  }
  return parsed.records.map((value, index) => {
    if (!isObject(value)) {
      throw new AdapterExtractionError("MALFORMED_CONTENT", `Fixture JSON record ${index} is invalid`);
    }
    const rawSourceRecordId = stringValue(value.record_id);
    const locator: SourceRecordLocator = { kind: "JSON", json_path: `$.records[${index}]` };
    return record(input, index, locator, {
      raw_source_record_id: rawSourceRecordId,
      raw_title: originalValue(value.title),
      raw_organization_name: originalValue(value.organization),
      raw_location_text: Array.isArray(value.locations)
        ? value.locations.map(originalValue).filter(isOriginalText)
        : [],
      raw_description: originalValue(value.description),
      raw_requirement_text: originalValue(value.requirement),
      announcement_url: stringValue(value.announcement_url),
      application_url: stringValue(value.application_url),
      publish_time: originalValue(value.publish_time),
      deadline: originalValue(value.deadline),
      recruitment_year: originalValue(value.recruitment_year),
      recruitment_batch: originalValue(value.recruitment_batch),
      adapter_details: { format: "JSON", record_index: index }
    });
  });
}

function extractDocument(input: AdapterExtractionInput, text: string) {
  if (!text.startsWith("FIXTURE_DOCUMENT_V1")) {
    throw new AdapterExtractionError(
      "MALFORMED_CONTENT",
      "Document fixture must use preprocessed FIXTURE_DOCUMENT_V1 text"
    );
  }
  const blocks = text.split("--- RECORD ---").slice(1).map((block) => block.split("--- END ---")[0]);
  return blocks.map((block, index) => {
    const fields = new Map<string, string[]>();
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (!key || !value) continue;
      fields.set(key, [...(fields.get(key) ?? []), value]);
    }
    const rawSourceRecordId = fields.get("id")?.[0];
    const pageNumber = Number(fields.get("page")?.[0]);
    const locator: SourceRecordLocator = {
      kind: "DOCUMENT",
      page_number: Number.isInteger(pageNumber) ? pageNumber : undefined,
      section: fields.get("section")?.[0],
      text_locator: `record:${index + 1}`
    };
    return record(input, index, locator, {
      raw_source_record_id: rawSourceRecordId,
      raw_title: optionalOriginal(fields.get("title")?.[0]),
      raw_organization_name: optionalOriginal(fields.get("organization")?.[0]),
      raw_location_text: (fields.get("location") ?? []).map(original),
      raw_description: optionalOriginal(fields.get("description")?.[0]),
      raw_requirement_text: optionalOriginal(fields.get("requirement")?.[0]),
      announcement_url: fields.get("announcement_url")?.[0],
      application_url: fields.get("application_url")?.[0],
      publish_time: optionalOriginal(fields.get("publish_time")?.[0]),
      deadline: optionalOriginal(fields.get("deadline")?.[0]),
      recruitment_year: optionalOriginal(fields.get("recruitment_year")?.[0]),
      recruitment_batch: optionalOriginal(fields.get("recruitment_batch")?.[0]),
      adapter_details: {
        format: "DOCUMENT_TEXT_FIXTURE",
        record_index: index,
        preprocessed: true
      }
    });
  });
}

interface RecordFields {
  readonly raw_source_record_id?: string;
  readonly raw_title?: OriginalText;
  readonly raw_organization_name?: OriginalText;
  readonly raw_location_text: readonly OriginalText[];
  readonly raw_description?: OriginalText;
  readonly raw_requirement_text?: OriginalText;
  readonly announcement_url?: string;
  readonly application_url?: string;
  readonly publish_time?: OriginalText;
  readonly deadline?: OriginalText;
  readonly recruitment_year?: OriginalText;
  readonly recruitment_batch?: OriginalText;
  readonly adapter_details: Readonly<Record<string, unknown>>;
}

function record(
  input: AdapterExtractionInput,
  index: number,
  locator: SourceRecordLocator,
  fields: RecordFields
): ExtractedRecord {
  const identityCandidates = fields.raw_source_record_id
    ? [{ kind: "SOURCE_RECORD_ID" as const, value: fields.raw_source_record_id, confidence: "HIGH" as const }]
    : fields.announcement_url
      ? [{ kind: "ANNOUNCEMENT_URL" as const, value: fields.announcement_url, confidence: "MEDIUM" as const }]
      : [{
          kind: "RAW_FIELD_COMBINATION" as const,
          value: [fields.raw_organization_name?.text, fields.raw_title?.text, ...fields.raw_location_text.map(
            (location) => location.text
          )].filter(Boolean).join("|"),
          confidence: "LOW" as const
        }];
  const seed = `${input.snapshot.snapshot_id}|${fields.raw_source_record_id ?? index}|${JSON.stringify(locator)}`;
  return {
    extracted_record_id: `extracted:${sha256(seed)}` as ExtractedRecordId,
    snapshot_id: input.snapshot.snapshot_id,
    source_definition_id: input.endpoint.source_definition_id,
    identity_candidates: identityCandidates,
    raw_source_record_id: fields.raw_source_record_id,
    raw_title: fields.raw_title,
    raw_organization_name: fields.raw_organization_name,
    raw_location_text: fields.raw_location_text,
    raw_description: fields.raw_description,
    raw_requirement_text: fields.raw_requirement_text,
    announcement_url: fields.announcement_url,
    application_url: fields.application_url,
    publish_time: fields.publish_time,
    deadline: fields.deadline,
    recruitment_year: fields.recruitment_year,
    recruitment_batch: fields.recruitment_batch,
    source_record_locator: locator,
    adapter_metadata: {
      fixture: fields.adapter_details
    },
    extraction: {
      extractor_name: descriptor.name,
      extractor_version: descriptor.version,
      extracted_at: input.snapshot.observed_at
    }
  };
}

function deduplicateSourceRecords(records: readonly ExtractedRecord[]) {
  const seen = new Set<string>();
  return records.filter((candidate) => {
    const key = candidate.raw_source_record_id
      ? `id:${candidate.raw_source_record_id}`
      : `candidate:${candidate.identity_candidates.map((item) => `${item.kind}:${item.value}`).join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fieldText(node: CheerioNodeSet, field: string) {
  return optionalOriginal(node.find(`[data-field="${field}"]`).first().text().trim());
}

function fieldHref(node: CheerioNodeSet, field: string) {
  return optionalString(node.find(`[data-field="${field}"]`).first().attr("href"));
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function optionalOriginal(value: string | undefined) {
  return value ? original(value) : undefined;
}

function originalValue(value: unknown) {
  return typeof value === "string" ? original(value) : undefined;
}

function isOriginalText(value: OriginalText | undefined): value is OriginalText {
  return value !== undefined;
}

function optionalString(value: string | undefined) {
  return value && value.length > 0 ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
