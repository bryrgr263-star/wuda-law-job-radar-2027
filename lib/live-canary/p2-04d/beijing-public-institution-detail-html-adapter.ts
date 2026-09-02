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
  type SourceRecordLocator
} from "../../ingestion";
import {
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID
} from "./beijing-public-institution-detail-live-canary";

export {
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID
};

const descriptor: AdapterDescriptor = {
  adapter_key: BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
  name: "BeijingPublicInstitutionDetailHtmlAdapter",
  version: "1.0.0-p2-04d-canary-raw",
  supported_content_kinds: ["HTML"],
  capabilities: ["SINGLE_PAGE", "HTML_EXTRACTION"]
};

type CheerioNodeSet = ReturnType<ReturnType<typeof cheerio.load>>;

interface SourceFact {
  readonly text: string;
  readonly selector: string;
}

interface SourceFactSection {
  readonly heading: string;
  readonly heading_selector: string;
  readonly paragraphs: readonly SourceFact[];
}

export class BeijingPublicInstitutionDetailHtmlAdapter implements RecruitmentAdapter {
  readonly descriptor = descriptor;

  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const issues: string[] = [];
    if (endpoint.adapter_key !== this.descriptor.adapter_key) {
      issues.push(`Endpoint adapter_key must be ${this.descriptor.adapter_key}`);
    }
    if (endpoint.recruitment_endpoint_id !== BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID) {
      issues.push("Endpoint must use the admitted Beijing detail RecruitmentEndpoint reference");
    }
    if (endpoint.source_definition_id !== BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID) {
      issues.push("Endpoint must use the Beijing public-institution SourceDefinition reference");
    }
    if (endpoint.locator !== BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT) {
      issues.push("Endpoint locator must exactly match the admitted Beijing detail locator");
    }
    if (endpoint.request_method !== "GET") issues.push("Beijing detail Endpoint must use GET");
    if (endpoint.content_kind !== "HTML") issues.push("Beijing detail Endpoint must use HTML");
    if ((endpoint.collection_config.max_pages ?? 1) !== 1) {
      issues.push("P2-04D permits one captured page only");
    }
    if (endpoint.collection_config.follow_redirects !== false) {
      issues.push("P2-04D must not follow redirects");
    }
    if (endpoint.enabled) {
      issues.push("P2-04D offline Adapter requires a disabled Endpoint");
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
    const content = $("#mainText > .view").first();
    if (content.length === 0) {
      throw malformed("Beijing detail content container #mainText > .view is missing");
    }

    const title = extractTitle($);
    if (!title) throw malformed("Beijing detail page is missing an article title");
    const documentText = normalize(content.text());
    if (!documentText) throw malformed("Beijing detail content is empty");
    const sourceRecordLocator: SourceRecordLocator = {
      kind: "HTML",
      selector: "#mainText > .view",
      path: "html > body > #mainText > .view"
    };
    const contentSource = meta($, "ContentSource");
    const publishedAt = meta($, "PubDate");
    const attachments = extractAttachments($, input.endpoint.locator);
    const sections = extractSections($, content);
    const seed = `${input.snapshot.snapshot_id}|${input.endpoint.locator}|${title}`;

    return [{
      extracted_record_id: `extracted:${sha256(seed)}` as ExtractedRecordId,
      snapshot_id: input.snapshot.snapshot_id,
      source_definition_id: input.endpoint.source_definition_id,
      identity_candidates: [{
        kind: "ANNOUNCEMENT_URL",
        value: input.endpoint.locator,
        confidence: "HIGH"
      }],
      raw_title: original(title),
      raw_organization_name: extractOrganizationFromIntroduction(content),
      raw_location_text: [],
      raw_description: original(documentText),
      raw_requirement_text: original(documentText),
      announcement_url: input.endpoint.locator,
      publish_time: publishedAt ? original(publishedAt) : undefined,
      recruitment_year: extractFirst(title, /((?:19|20)\d{2})年度/u),
      recruitment_batch: extractFirst(title, /(第[一二三四五六七八九十]+批)/u),
      source_record_locator: sourceRecordLocator,
      adapter_metadata: {
        [BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY]: {
          source_fact_scope: "CAPTURED_DETAIL_HTML_ONLY",
          article_title_meta: meta($, "ArticleTitle"),
          content_source_meta: contentSource,
          publication_meta: publishedAt,
          description_meta: meta($, "Description"),
          content_selector: "#mainText > .view",
          content_text: documentText,
          sections,
          attachment_references: attachments,
          explicitly_named_position_mentions: explicitPositionMentions(documentText),
          position_table_status: attachments.some((attachment) => /职位及要求表/u.test(attachment.text))
            ? "LINKED_ATTACHMENT_NOT_FETCHED"
            : "NOT_OBSERVED_IN_CAPTURED_HTML",
          legal_term_observations: legalTermObservations(documentText),
          facts_not_inferred: [
            "No attachment contents were retrieved.",
            "No job-level education, degree, major, experience, household-registration, political-status, or certificate fact is inferred when absent from captured HTML.",
            "No requirement, eligibility, canonical opportunity, or recruitment-status decision is produced."
          ]
        }
      },
      extraction: {
        extractor_name: descriptor.name,
        extractor_version: descriptor.version,
        extracted_at: input.snapshot.observed_at
      }
    }];
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
    return { status: "COMPLETE", reason_codes: ["SINGLE_REAL_DETAIL_CANARY_PAGE_EXTRACTED"] };
  }

  private assertEndpoint(endpoint: RecruitmentEndpoint) {
    const validation = this.validateEndpoint(endpoint);
    if (!validation.valid) {
      throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", validation.issues.join("; "));
    }
  }
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
    throw malformed("Beijing detail Adapter accepts captured HTML content only");
  }
  return rawBlob;
}

function extractTitle($: ReturnType<typeof cheerio.load>) {
  return normalize($("meta[name='ArticleTitle']").attr("content") ?? "")
    || normalize($("div.header h1").first().text())
    || normalize($("title").first().text()).split("_")[0]!
    || null;
}

function extractOrganizationFromIntroduction(content: CheerioNodeSet) {
  const firstParagraph = normalize(content.children("p").first().text());
  const matched = /^(.{2,80}?)(?:是|为)北京市卫生健康委员会直属/u.exec(firstParagraph);
  return matched?.[1] ? original(matched[1]) : undefined;
}

function extractSections(
  $: ReturnType<typeof cheerio.load>,
  content: CheerioNodeSet
): readonly SourceFactSection[] {
  const sections: Array<{
    heading: string;
    heading_selector: string;
    paragraphs: SourceFact[];
  }> = [];
  let current: (typeof sections)[number] | null = null;
  content.children("p").each((index, element) => {
    const paragraph = $(element);
    const text = normalize(paragraph.text());
    if (!text) return;
    const selector = `#mainText > .view > p:nth-of-type(${index + 1})`;
    const heading = normalize(paragraph.children("strong").first().text());
    if (heading) {
      current = { heading, heading_selector: selector, paragraphs: [] };
      sections.push(current);
    }
    if (current) current.paragraphs.push({ text, selector });
  });
  return sections;
}

function extractAttachments($: ReturnType<typeof cheerio.load>, endpointLocator: string) {
  return $("#filerider a[href]").toArray().flatMap((element) => {
    const node = $(element);
    const rawLocator = node.attr("href")?.trim();
    if (!rawLocator) return [];
    try {
      const resolved = new URL(rawLocator, endpointLocator);
      if (resolved.protocol !== "https:" || resolved.origin !== new URL(endpointLocator).origin) {
        return [];
      }
      return [{
        text: normalize(node.text()),
        raw_locator: rawLocator,
        locator: resolved.href,
        selector: "#filerider a[href]"
      }];
    } catch {
      return [];
    }
  });
}

function explicitPositionMentions(documentText: string) {
  const matches = [...documentText.matchAll(/例如“[^”+]+\+([^”]+)”/gu)];
  return matches.map((match) => ({
    text: match[1],
    evidence_text: match[0],
    classification: "EXPLICIT_MENTION_NOT_COMPLETE_POSITION_TABLE"
  }));
}

function legalTermObservations(documentText: string) {
  const terms = [
    "法律硕士",
    "法律硕士（非法学）",
    "法学硕士",
    "法学专业",
    "法学类",
    "法律专业",
    "本科专业",
    "硕士专业",
    "法律职业资格"
  ];
  return Object.fromEntries(terms.map((term) => [term, documentText.includes(term)]));
}

function extractFirst(value: string, pattern: RegExp) {
  const match = pattern.exec(value)?.[1];
  return match ? original(match) : undefined;
}

function meta($: ReturnType<typeof cheerio.load>, name: string) {
  const value = $("meta").filter((_index, element) => {
    return $(element).attr("name") === name;
  }).first().attr("content");
  return value ? normalize(value) : null;
}

function decodeUtf8(rawBlob: RawBlob) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(rawBlob.bytes);
  } catch {
    throw malformed("Raw HTML bytes are not valid UTF-8");
  }
}

function normalize(value: string) {
  return value.replace(/\s+/gu, " ").trim();
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
