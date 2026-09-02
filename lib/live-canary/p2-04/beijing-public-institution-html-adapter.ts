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
  type RecruitmentEndpointId,
  type SourceDefinitionId,
  type SourceRecordLocator
} from "../../ingestion";

export const BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY =
  "cn-beijing-government-public-institution-html";
export const BEIJING_PUBLIC_INSTITUTION_SOURCE_DEFINITION_ID =
  "source-cn-beijing-government-public-institution-recruitment" as SourceDefinitionId;
export const BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID =
  "endpoint-cn-beijing-government-public-institution-job-list-html" as RecruitmentEndpointId;
export const BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR =
  "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/";

const descriptor: AdapterDescriptor = {
  adapter_key: BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY,
  name: "BeijingPublicInstitutionHtmlAdapter",
  version: "1.0.0-canary-raw",
  supported_content_kinds: ["HTML"],
  capabilities: ["SINGLE_PAGE", "HTML_EXTRACTION"]
};

type CheerioNodeSet = ReturnType<ReturnType<typeof cheerio.load>>;

export class BeijingPublicInstitutionHtmlAdapter implements RecruitmentAdapter {
  readonly descriptor = descriptor;

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const issues: string[] = [];
    if (endpoint.adapter_key !== this.descriptor.adapter_key) {
      issues.push(`Endpoint adapter_key must be ${this.descriptor.adapter_key}`);
    }
    if (endpoint.recruitment_endpoint_id !== BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID) {
      issues.push("Endpoint must use the admitted Beijing RecruitmentEndpoint reference");
    }
    if (endpoint.source_definition_id !== BEIJING_PUBLIC_INSTITUTION_SOURCE_DEFINITION_ID) {
      issues.push("Endpoint must use the Beijing public-institution SourceDefinition reference");
    }
    if (endpoint.locator !== BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR) {
      issues.push("Endpoint locator must exactly match the admitted Beijing job-list locator");
    }
    if (endpoint.request_method !== "GET") issues.push("Beijing job-list Endpoint must use GET");
    if (endpoint.content_kind !== "HTML") issues.push("Beijing job-list Endpoint must use HTML");
    if ((endpoint.collection_config.max_pages ?? 1) !== 1) {
      issues.push("P2-04B permits one captured page only");
    }
    if (endpoint.collection_config.follow_redirects !== false) {
      issues.push("P2-04B must not follow redirects");
    }
    if (endpoint.enabled) {
      issues.push("P2-04B offline Adapter requires a disabled Endpoint");
    }
    return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
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
    const rawBlob = assertTraceability(input);
    const html = decodeUtf8(rawBlob);
    const $ = cheerio.load(html);
    const listBox = $(".listBox").first();
    if (listBox.length === 0) {
      throw malformed("Beijing job-list container .listBox is missing");
    }

    const records: ExtractedRecord[] = [];
    listBox.children("ul.list").each((listOffset, listElement) => {
      $(listElement).children("li.col-md").each((recordOffset, recordElement) => {
        records.push(extractRecord(input, $, $(recordElement), listOffset, recordOffset, records.length));
      });
    });
    return records;
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
    return { status: "COMPLETE", reason_codes: ["SINGLE_REAL_CANARY_PAGE_EXTRACTED"] };
  }

  private assertEndpoint(endpoint: RecruitmentEndpoint) {
    const validation = this.validateEndpoint(endpoint);
    if (!validation.valid) {
      throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", validation.issues.join("; "));
    }
  }
}

function extractRecord(
  input: AdapterExtractionInput,
  $: ReturnType<typeof cheerio.load>,
  node: CheerioNodeSet,
  listOffset: number,
  recordOffset: number,
  documentOrder: number
): ExtractedRecord {
  const anchor = node.children("a").first();
  const title = anchor.text().trim() || anchor.attr("title")?.trim() || "";
  if (!title) throw malformed(`Beijing job-list record ${documentOrder + 1} is missing a title`);
  const rawDetailLocator = anchor.attr("href")?.trim();
  if (!rawDetailLocator) {
    throw malformed(`Beijing job-list record ${documentOrder + 1} is missing a detail locator`);
  }
  const announcementUrl = resolveAnnouncementLocator(rawDetailLocator, input.endpoint.locator);
  const rawPublishDate = node.children("span").first().text().trim();
  const publishDate = /^\d{4}-\d{2}-\d{2}$/u.test(rawPublishDate)
    ? rawPublishDate
    : undefined;
  const sourceRecordLocator: SourceRecordLocator = {
    kind: "HTML",
    selector: `.listBox > ul.list:nth-of-type(${listOffset + 1}) > li.col-md:nth-of-type(${recordOffset + 1})`,
    path: `html > body > .listBox > ul.list[${listOffset}] > li.col-md[${recordOffset}]`
  };
  const seed = `${input.snapshot.snapshot_id}|${announcementUrl}|${documentOrder}`;
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
    raw_location_text: [],
    announcement_url: announcementUrl,
    publish_time: publishDate ? original(publishDate) : undefined,
    source_record_locator: sourceRecordLocator,
    adapter_metadata: {
      [BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY]: {
        list_index: listOffset,
        record_index_in_list: recordOffset,
        document_order: documentOrder,
        raw_detail_locator: rawDetailLocator,
        title_attribute: anchor.attr("title")?.trim() ?? null,
        raw_publish_date_text: rawPublishDate || null,
        structure: ".listBox > ul.list > li.col-md"
      }
    },
    extraction: {
      extractor_name: descriptor.name,
      extractor_version: descriptor.version,
      extracted_at: input.snapshot.observed_at
    }
  };
}

function assertTraceability(input: AdapterExtractionInput): RawBlob {
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
    throw malformed("Beijing Adapter accepts captured HTML content only");
  }
  return rawBlob;
}

function resolveAnnouncementLocator(value: string, endpointLocator: string) {
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

function malformed(message: string) {
  return new AdapterExtractionError("MALFORMED_CONTENT", message);
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
