import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import {
  AdapterExtractionError,
  UTF8_TEXT_ENCODING,
  type AdapterCompletenessAssessment,
  type AdapterCompletenessInput,
  type AdapterDescriptor,
  type AdapterExtractionInput,
  type AdapterNextPageInput,
  type AdapterRequestPlan,
  type EndpointValidationResult,
  type ExtractedRecord,
  type ExtractedRecordId,
  type OriginalText,
  type RawBlob,
  type RecruitmentAdapter,
  type RecruitmentEndpoint,
  type Snapshot,
  type SourceRecordLocator
} from "../../ingestion";

export const NTSC_OFFICIAL_HTML_ADAPTER_KEY = "cn-cas-ntsc-official-html";
export const NTSC_TALENT_LIST_LOCATOR = "https://ntsc.cas.cn/xwzx_/rczp/index.html";
export const NTSC_LIVE_STRUCTURE_STATUS = "TODO_HUMAN_CONFIRM_SELECTORS" as const;

export interface NtscHtmlStructureProfile {
  readonly profile_id: string;
  readonly origin: "SYNTHETIC_TEST_ONLY" | "HUMAN_CONFIRMED";
  readonly organization_selector: string;
  readonly list_selector: string;
  readonly record_selector: string;
  readonly title_selector: string;
  readonly detail_link_selector: string;
  readonly publish_date_selector: string;
}

export const NTSC_SYNTHETIC_HTML_STRUCTURE: NtscHtmlStructureProfile = {
  profile_id: "ntsc-synthetic-test-only-v1",
  origin: "SYNTHETIC_TEST_ONLY",
  organization_selector: "[data-p2-04-synthetic-organization]",
  list_selector: "[data-p2-04-synthetic-ntsc-list]",
  record_selector: "[data-p2-04-synthetic-ntsc-record]",
  title_selector: "[data-p2-04-synthetic-title]",
  detail_link_selector: "[data-p2-04-synthetic-detail]",
  publish_date_selector: "[data-p2-04-synthetic-publish-date]"
};

const descriptor: AdapterDescriptor = {
  adapter_key: NTSC_OFFICIAL_HTML_ADAPTER_KEY,
  name: "NtscOfficialHtmlAdapter",
  version: "1.0.0-offline",
  supported_content_kinds: ["HTML"],
  capabilities: ["SINGLE_PAGE", "HTML_EXTRACTION"]
};

type CheerioNodeSet = ReturnType<ReturnType<typeof cheerio.load>>;

export class NtscOfficialHtmlAdapter implements RecruitmentAdapter {
  readonly descriptor = descriptor;

  constructor(readonly structure: NtscHtmlStructureProfile) {}

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const issues: string[] = [];
    if (endpoint.adapter_key !== this.descriptor.adapter_key) {
      issues.push(`Endpoint adapter_key must be ${this.descriptor.adapter_key}`);
    }
    if (endpoint.locator !== NTSC_TALENT_LIST_LOCATOR) {
      issues.push("Endpoint locator must exactly match the admitted NTSC talent-list locator");
    }
    if (endpoint.request_method !== "GET") {
      issues.push("NTSC talent-list Endpoint must use GET");
    }
    if (endpoint.content_kind !== "HTML") {
      issues.push("NTSC talent-list Endpoint must use HTML content");
    }
    if ((endpoint.collection_config.max_pages ?? 1) !== 1) {
      issues.push("NTSC offline preparation permits one page only");
    }
    if (endpoint.collection_config.follow_redirects !== false) {
      issues.push("NTSC offline preparation must not follow redirects");
    }
    if (endpoint.enabled && this.structure.origin !== "HUMAN_CONFIRMED") {
      issues.push("Synthetic selectors cannot be used by an enabled Live Endpoint");
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
      method: "GET",
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
    const rawBlob = this.assertTraceability(input);
    const html = decodeUtf8(rawBlob);
    const $ = cheerio.load(html);
    const list = $(this.structure.list_selector).first();
    if (list.length === 0) {
      throw malformed("Synthetic list structure is missing; live selectors remain unconfirmed");
    }
    const organizationName = $(this.structure.organization_selector).first().text().trim();
    if (!organizationName) {
      throw malformed("Source organization text is missing");
    }

    const records = list.find(this.structure.record_selector).toArray().map((element, index) => {
      return this.extractRecord(input, $, $(element), organizationName, index);
    });
    return deduplicateByAnnouncement(records);
  }

  nextPage(_input: AdapterNextPageInput): AdapterRequestPlan | null {
    return null;
  }

  assessCompleteness(input: AdapterCompletenessInput): AdapterCompletenessAssessment {
    if (input.extraction_errors.length > 0) {
      return input.records.length > 0
        ? { status: "PARTIAL", reason_codes: ["HTML_EXTRACTION_ERROR"] }
        : { status: "FAILED", reason_codes: ["HTML_EXTRACTION_ERROR"] };
    }
    if (input.snapshots.some((snapshot) => snapshot.transport_status === "FAILED")) {
      return { status: "FAILED", reason_codes: ["FAILED_SNAPSHOT"] };
    }
    if (input.records.length === 0) {
      return { status: "SUSPICIOUS_EMPTY", reason_codes: ["ZERO_EXTRACTED_RECORDS"] };
    }
    return { status: "COMPLETE", reason_codes: ["SINGLE_HTML_PAGE_EXTRACTED"] };
  }

  private extractRecord(
    input: AdapterExtractionInput,
    $: ReturnType<typeof cheerio.load>,
    node: CheerioNodeSet,
    organizationName: string,
    index: number
  ): ExtractedRecord {
    const title = node.find(this.structure.title_selector).first().text().trim();
    if (!title) throw malformed(`Recruitment list record ${index + 1} is missing a title`);
    const rawDetailLocator = node.find(this.structure.detail_link_selector).first().attr("href")?.trim();
    if (!rawDetailLocator) {
      throw malformed(`Recruitment list record ${index + 1} is missing a detail locator`);
    }
    const announcementUrl = safeAnnouncementLocator(rawDetailLocator, input.endpoint.locator);
    const publishDate = node.find(this.structure.publish_date_selector).first().text().trim();
    const locator: SourceRecordLocator = {
      kind: "HTML",
      selector: `${this.structure.record_selector}:nth-of-type(${index + 1})`,
      path: `${this.structure.list_selector} > record[${index}]`
    };
    const seed = `${input.snapshot.snapshot_id}|${announcementUrl}|${index}`;
    return {
      extracted_record_id: `extracted:${sha256(seed)}` as ExtractedRecordId,
      snapshot_id: input.snapshot.snapshot_id,
      source_definition_id: input.endpoint.source_definition_id,
      identity_candidates: [{
        kind: "ANNOUNCEMENT_URL",
        value: announcementUrl,
        confidence: "HIGH"
      }],
      raw_title: original(title),
      raw_organization_name: original(organizationName),
      raw_location_text: [],
      announcement_url: announcementUrl,
      publish_time: publishDate ? original(publishDate) : undefined,
      source_record_locator: locator,
      adapter_metadata: {
        [NTSC_OFFICIAL_HTML_ADAPTER_KEY]: {
          structure_profile_id: this.structure.profile_id,
          structure_origin: this.structure.origin,
          record_index: index,
          raw_detail_locator: rawDetailLocator
        }
      },
      extraction: {
        extractor_name: descriptor.name,
        extractor_version: descriptor.version,
        extracted_at: input.snapshot.observed_at
      }
    };
  }

  private assertEndpoint(endpoint: RecruitmentEndpoint) {
    const validation = this.validateEndpoint(endpoint);
    if (!validation.valid) {
      throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", validation.issues.join("; "));
    }
  }

  private assertTraceability(input: AdapterExtractionInput): RawBlob {
    const { endpoint, snapshot, raw_blob: rawBlob } = input;
    if (snapshot.transport_status === "FAILED") {
      throw new AdapterExtractionError("SNAPSHOT_FAILED", "Cannot extract a failed Snapshot");
    }
    if (!rawBlob) {
      throw new AdapterExtractionError("RAW_BLOB_REQUIRED", "Successful Snapshot requires RawBlob");
    }
    if (
      snapshot.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id
      || snapshot.raw_blob_id !== rawBlob.raw_blob_id
      || snapshot.content_hash !== rawBlob.raw_content_sha256
      || snapshot.content_length !== rawBlob.byte_length
    ) {
      throw new AdapterExtractionError("RAW_BLOB_MISMATCH", "Snapshot does not reference the supplied RawBlob");
    }
    if (
      !rawBlob.mime_type.toLowerCase().startsWith("text/html")
      || !snapshot.response_metadata.mime_type?.toLowerCase().startsWith("text/html")
    ) {
      throw malformed("NTSC Adapter accepts captured HTML content only");
    }
    return rawBlob;
  }
}

function safeAnnouncementLocator(value: string, endpointLocator: string) {
  if (value.startsWith("#")) throw malformed("Detail locator cannot be a page fragment");
  let endpoint: URL;
  let candidate: URL;
  try {
    endpoint = new URL(endpointLocator);
    candidate = new URL(value, endpoint);
  } catch {
    throw malformed("Detail locator is not a valid URL");
  }
  if (
    candidate.protocol !== "https:"
    || candidate.origin !== endpoint.origin
    || candidate.username
    || candidate.password
    || candidate.href === endpoint.href
  ) {
    throw malformed("Detail locator must be a distinct credential-free HTTPS URL on the admitted origin");
  }
  return candidate.href;
}

function decodeUtf8(rawBlob: RawBlob) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(rawBlob.bytes);
  } catch {
    throw malformed("Raw HTML bytes are not valid UTF-8");
  }
}

function deduplicateByAnnouncement(records: readonly ExtractedRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = record.announcement_url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function malformed(message: string) {
  return new AdapterExtractionError("MALFORMED_CONTENT", message);
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
