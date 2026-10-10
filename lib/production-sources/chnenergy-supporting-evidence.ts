import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { AdapterExtractionError, UTF8_TEXT_ENCODING, type RecruitmentAdapter, type RecruitmentEndpoint,
  type AdapterExtractionInput, type AdapterCompletenessInput, type EndpointValidationResult, type ExtractedRecord } from "../ingestion";
import { CHNENERGY_CAMPAIGN_URL, CHNENERGY_JOBS, CHNENERGY_SOURCE_ID } from "./chnenergy-2027-source";

export const CHNENERGY_SUPPORT_ADAPTER_KEY = "cn-chnenergy-reviewed-supporting-html";
const campaignId = "6a152f40-7fe5-460e-ad37-0024acafd8c9";
const urls = [CHNENERGY_CAMPAIGN_URL, ...CHNENERGY_JOBS.map(job => job.membership_url)];
const original = (text: string) => ({ text, encoding: UTF8_TEXT_ENCODING });
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const endpointId = (url: string) => `endpoint-cn-chnenergy-support:${digest(url)}`;
const clean = (text: string) => text.replace(/\s+/gu, " ").trim();

export function chnenergySupportingEndpoint(url: string): RecruitmentEndpoint {
  if (!urls.includes(url)) throw new Error("CHNENERGY_SUPPORT_TARGET_NOT_APPROVED");
  return { recruitment_endpoint_id: endpointId(url) as never, source_definition_id: CHNENERGY_SOURCE_ID as never,
    name: { original: original("国家能源已审核招聘佐证页面") }, locator: url, request_method: "GET", content_kind: "HTML",
    adapter_key: CHNENERGY_SUPPORT_ADAPTER_KEY, decoded_text_encoding: UTF8_TEXT_ENCODING, coverage_regions: [],
    collection_config: { timeout_ms: 20000, max_items: 1, max_pages: 1, follow_redirects: false, retry_limit: 0 }, enabled: true };
}

export class ChnenergySupportingEvidenceAdapter implements RecruitmentAdapter {
  readonly descriptor;
  constructor(version: "1.0.0" | "1.1.0" = "1.0.0") {
    if (version !== "1.0.0" && version !== "1.1.0") throw new Error("CHNENERGY_SUPPORT_PARSER_VERSION_NOT_SUPPORTED");
    this.descriptor = { adapter_key: CHNENERGY_SUPPORT_ADAPTER_KEY, name: "ChnenergyReviewedSupportingHtmlAdapter",
      version, supported_content_kinds: ["HTML"] as const, capabilities: ["HTML_EXTRACTION"] as const };
  }
  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const valid = urls.includes(endpoint.locator) && endpoint.recruitment_endpoint_id === endpointId(endpoint.locator)
      && endpoint.source_definition_id === CHNENERGY_SOURCE_ID && endpoint.adapter_key === CHNENERGY_SUPPORT_ADAPTER_KEY
      && endpoint.request_method === "GET" && endpoint.content_kind === "HTML" && endpoint.enabled
      && endpoint.collection_config.max_pages === 1 && endpoint.collection_config.retry_limit === 0
      && endpoint.collection_config.follow_redirects === false;
    return valid ? { valid: true, issues: [] } : { valid: false, issues: ["CHNENERGY_SUPPORT_ENDPOINT_NOT_APPROVED"] };
  }
  plan(endpoint: RecruitmentEndpoint) {
    if (!this.validateEndpoint(endpoint).valid) throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "CHNENERGY_SUPPORT_ENDPOINT_NOT_APPROVED");
    return [{ recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: endpoint.locator, method: "GET" as const,
      parameters: {}, pagination_state: { page_index: 1, cursor: null, visited_locators: [endpoint.locator] } }];
  }
  extract(input: AdapterExtractionInput): readonly ExtractedRecord[] {
    if (!this.validateEndpoint(input.endpoint).valid || !input.raw_blob || input.snapshot.transport_status !== "SUCCESS"
      || input.snapshot.recruitment_endpoint_id !== input.endpoint.recruitment_endpoint_id
      || input.snapshot.request_metadata.locator !== input.endpoint.locator || input.snapshot.request_metadata.method !== "GET"
      || input.snapshot.raw_blob_id !== input.raw_blob.raw_blob_id || input.snapshot.content_hash !== input.raw_blob.raw_content_sha256
      || input.raw_blob.raw_blob_id !== `sha256:${input.raw_blob.raw_content_sha256}`
      || createHash("sha256").update(input.raw_blob.bytes).digest("hex") !== input.raw_blob.raw_content_sha256
      || input.raw_blob.byte_length !== input.raw_blob.bytes.byteLength || input.snapshot.content_length !== input.raw_blob.byte_length
      || input.snapshot.response_metadata.content_length !== input.raw_blob.byte_length
      || input.snapshot.response_metadata.http_status !== 200 || input.snapshot.response_metadata.mime_type !== input.raw_blob.mime_type
      || !/^text\/html(?:;|$)/iu.test(input.raw_blob.mime_type)) {
      throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "CHNENERGY_SUPPORT_CAPTURE_MISMATCH");
    }
    const dom = cheerio.load(new TextDecoder("utf-8", { fatal: true }).decode(input.raw_blob.bytes));
    let title: string;
    let organization: string;
    if (input.endpoint.locator === CHNENERGY_CAMPAIGN_URL) {
      const heading = dom("p.lead.text-center");
      if (heading.length !== 1 || !/^国家能源投资集团有限责任公司2027年度高校毕业生统招公告$/u.test(clean(heading.text()))) {
        throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "CHNENERGY_SUPPORT_CAMPAIGN_AMBIGUOUS");
      }
      title = clean(heading.text());
      const body = dom("#anncTxt");
      const links = (this.descriptor.version === "1.1.0" ? dom("a[href]") : body.find("a[href]")).toArray().filter(node => {
        try { return new URL(dom(node).attr("href")!, input.endpoint.locator).href === `https://zhaopin.chnenergy.com.cn/annc/showggStationList?id=${campaignId}`; }
        catch { return false; }
      });
      const prose = body.clone();
      prose.find("a,script,style,noscript").remove();
      if (body.length !== 1 || !clean(prose.text()) || links.length !== 1) {
        throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "CHNENERGY_SUPPORT_CAMPAIGN_BODY_MISSING");
      }
      organization = title.slice(0, title.indexOf("2027年度"));
    } else {
      const job = CHNENERGY_JOBS.find(value => value.membership_url === input.endpoint.locator)!;
      const form = dom("form#annclistform");
      const ids = form.find('input[type="hidden"][name="id"]');
      const links = dom("a[href]").toArray().filter(node => {
        try { return new URL(dom(node).attr("href")!, input.endpoint.locator).href === job.url && clean(dom(node).text()) === job.title; }
        catch { return false; }
      });
      if (form.length !== 1 || ids.length !== 1 || ids.attr("value") !== campaignId || links.length !== 1
        || new URL(form.attr("action") ?? "", input.endpoint.locator).href !== "https://zhaopin.chnenergy.com.cn/annc/showggStationList") {
        throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "CHNENERGY_SUPPORT_MEMBERSHIP_AMBIGUOUS");
      }
      title = `${job.title} 官方招聘岗位列表`;
      const employers = dom(links[0]!).closest(".list-group-item").find("p.list-group-item-text span[title]").first();
      if (employers.length !== 1 || employers.attr("title") !== job.employer) {
        throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "CHNENERGY_SUPPORT_MEMBER_EMPLOYER_MISSING");
      }
      organization = employers.attr("title")!;
    }
    dom("script,style,noscript").remove();
    const text = clean(dom("body").text());
    if (!text) throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "CHNENERGY_SUPPORT_CONTENT_EMPTY");
    const key = `chnenergy-support:${digest(input.endpoint.locator)}`;
    return [{ extracted_record_id: `${key}:${digest(input.snapshot.snapshot_id)}` as never,
      snapshot_id: input.snapshot.snapshot_id, source_definition_id: input.endpoint.source_definition_id,
      identity_candidates: [{ kind: "SOURCE_RECORD_ID", value: key, confidence: "HIGH" }], raw_source_record_id: key,
      raw_title: original(title), raw_organization_name: original(organization), raw_description: original(text), raw_location_text: [], announcement_url: input.endpoint.locator,
      source_record_locator: { kind: "HTML", selector: "body", path: key },
      adapter_metadata: { [CHNENERGY_SUPPORT_ADAPTER_KEY]: { source_role: "PACKAGE", surface_kind: input.endpoint.locator === CHNENERGY_CAMPAIGN_URL ? "CAMPAIGN" : "MEMBERSHIP" } },
      extraction: { extractor_name: this.descriptor.name, extractor_version: this.descriptor.version, extracted_at: input.snapshot.observed_at } }];
  }
  nextPage() { return null; }
  assessCompleteness(input: AdapterCompletenessInput) {
    return input.extraction_errors.length === 0 && input.snapshots.length === 1 && input.records.length === 1
      ? { status: "COMPLETE" as const, reason_codes: ["SUPPORTING_SURFACE_EXTRACTED_ONLY"] }
      : { status: "FAILED" as const, reason_codes: ["SUPPORTING_SURFACE_INCOMPLETE"] };
  }
}
