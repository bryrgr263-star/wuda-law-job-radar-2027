import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { SOURCE_PROHIBITED_ACTIONS, type SourceAdmission } from "../application/source-admission";
import { AdapterExtractionError, UTF8_TEXT_ENCODING, type AdapterExtractionInput, type AdapterCompletenessInput,
  type ExtractedRecord, type OriginalText, type RecruitmentAdapter, type RecruitmentEndpoint, type EndpointValidationResult } from "../ingestion";
import { createSourcePersistenceVersion, type SourcePersistenceVersion, type ProductionPersistenceProvenance } from "../production-persistence/contracts";

export const SEU_CBIT_URL = "https://em.seu.edu.cn/2026/0922/c57206a584203/page.htm";
export const SEU_CBIT_ADAPTER_KEY = "cn-seu-cbit-2027-university-html";
export const SEU_CBIT_SOURCE_ID = "source-seu-cbit-2027-university-publication";
export const SEU_CBIT_ADMISSION_ID = "admission-seu-cbit-2027-publication";
export const SEU_CBIT_ALLOWLIST_ID = "allowlist-seu-cbit-2027-publication";
const employer = "银保信科技（北京）有限公司";
const publicationTitle = "中国银行保险信息技术管理有限公司2027年度校园招聘";
const approval = "call_5d2551504ceb40b69c016013f8748505";
const original = (text: string): OriginalText => ({ text, encoding: UTF8_TEXT_ENCODING });
const traceable = (text: string) => ({ original: original(text) });
const clean = (text: string) => text.replace(/\s+/gu, " ").trim();

export function seuCbitEndpoint(): RecruitmentEndpoint {
  return { recruitment_endpoint_id: "endpoint-seu-cbit-2027-publication" as never, source_definition_id: SEU_CBIT_SOURCE_ID as never,
    name: traceable("东南大学官方发布的中国银保信2027年度招聘公告"), coverage_regions: [], locator: SEU_CBIT_URL,
    request_method: "GET", content_kind: "HTML", decoded_text_encoding: UTF8_TEXT_ENCODING, adapter_key: SEU_CBIT_ADAPTER_KEY,
    collection_config: { timeout_ms: 20000, max_pages: 1, max_items: 2, retry_limit: 0, follow_redirects: false }, enabled: true };
}

export class SeuCbit2027HtmlAdapter implements RecruitmentAdapter {
  readonly descriptor = { adapter_key: SEU_CBIT_ADAPTER_KEY, name: "SeuCbit2027UniversityPublicationAdapter", version: "1.0.0",
    supported_content_kinds: ["HTML"] as const, capabilities: ["HTML_EXTRACTION"] as const };
  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    const approved = seuCbitEndpoint();
    const valid = endpoint.locator === approved.locator && endpoint.recruitment_endpoint_id === approved.recruitment_endpoint_id
      && endpoint.source_definition_id === approved.source_definition_id && endpoint.adapter_key === approved.adapter_key
      && endpoint.request_method === "GET" && endpoint.content_kind === "HTML" && endpoint.collection_config.max_pages === 1
      && endpoint.collection_config.retry_limit === 0 && endpoint.collection_config.follow_redirects === false;
    return valid ? { valid: true as const, issues: [] } : { valid: false as const, issues: ["UNAPPROVED_UNIVERSITY_PUBLICATION_ENDPOINT"] };
  }
  plan(endpoint: RecruitmentEndpoint) {
    if (!this.validateEndpoint(endpoint).valid) throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "UNAPPROVED_UNIVERSITY_PUBLICATION_ENDPOINT");
    return [{ recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: endpoint.locator, method: "GET" as const,
      parameters: {}, pagination_state: { page_index: 1, cursor: null, visited_locators: [endpoint.locator] } }];
  }
  extract(input: AdapterExtractionInput): readonly ExtractedRecord[] {
    if (!input.raw_blob || !this.validateEndpoint(input.endpoint).valid || input.snapshot.request_metadata.locator !== SEU_CBIT_URL) {
      throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "UNAPPROVED_UNIVERSITY_PUBLICATION_ENDPOINT");
    }
    const document = cheerio.load(new TextDecoder("utf-8", { fatal: true }).decode(input.raw_blob.bytes));
    const body = document(".wp_articlecontent");
    const title = clean(document("h1.arti_title").text());
    if (body.length !== 1 || title !== publicationTitle) throw new AdapterExtractionError("MALFORMED_CONTENT", "UNIVERSITY_CAMPAIGN_BINDING_MISMATCH");
    const tables = body.children("table").filter((_index, node) => clean(document(node).prevAll("p").first().text()) === `（四）${employer}`);
    const rows = tables.find("tr").filter((_index, node) => clean(document(node).children("td").eq(2).text()) === "法务岗");
    const values = rows.first().children("td").map((_index, node) => clean(document(node).text())).get();
    const bodyText = clean(body.text());
    const conditionStart = bodyText.indexOf("三、招聘条件");
    const conditionEnd = bodyText.indexOf("四、公司培养", conditionStart);
    if (tables.length !== 1 || rows.length !== 1 || values.length !== 6 || values[1] !== "法学类"
      || !values[3]!.includes("法学类") || values[5] !== "北京" || conditionStart < 0) {
      throw new AdapterExtractionError("MALFORMED_CONTENT", "UNIVERSITY_POSITION_BINDING_MISMATCH");
    }
    const conditions = bodyText.slice(conditionStart, conditionEnd < 0 ? bodyText.length : conditionEnd);
    const record = (packageRecord: boolean): ExtractedRecord => {
      const recordKey = packageRecord ? "seu-cbit-2027:publication" : "seu-cbit-2027:subsidiary-law:row-2";
      const publicationIdentity = { identity_state: "PROVISIONAL" as const, source_local_identifier: original(SEU_CBIT_URL),
        evidence_locator: { kind: "HTML" as const, selector: "h1.arti_title" } };
      const positionIdentity = { identity_state: "PROVISIONAL" as const, source_local_identifier: original(`${employer}|${values[0]}|${values[2]}`),
        evidence_locator: { kind: "HTML" as const, selector: ".wp_articlecontent > table tr", path: recordKey } };
      return { extracted_record_id: `seu-cbit:${createHash("sha256").update(`${input.snapshot.snapshot_id}|${recordKey}`).digest("hex")}` as never,
        snapshot_id: input.snapshot.snapshot_id, source_definition_id: input.endpoint.source_definition_id,
        identity_candidates: [{ kind: "SOURCE_RECORD_ID", value: recordKey, confidence: "HIGH" }], raw_source_record_id: recordKey,
        raw_title: original(packageRecord ? title : values[2]!), raw_organization_name: original(packageRecord ? "中国银行保险信息技术管理有限公司" : employer),
        raw_location_text: packageRecord ? [] : [original(values[5]!)], raw_description: original(packageRecord ? bodyText : values.join(" | ")),
        ...(!packageRecord ? { raw_requirement_text: original(`${values[3]}\n${conditions}`) } : {}),
        announcement_url: SEU_CBIT_URL, recruitment_year: original("2027"), recruitment_batch: original(title),
        ...(!packageRecord ? { recruitment_context: { announcement: publicationIdentity, recruitment_plan: publicationIdentity,
          recruitment_batch: { applicability: "APPLICABLE" as const, identity: { ...publicationIdentity, source_local_identifier: original(title) } },
          position: positionIdentity, opportunity: positionIdentity } } : {}),
        source_record_locator: { kind: "HTML", selector: packageRecord ? ".wp_articlecontent" : ".wp_articlecontent > table tr", path: recordKey },
        adapter_metadata: { [SEU_CBIT_ADAPTER_KEY]: { source_role: packageRecord ? "PACKAGE" : "POSITION_BEARING",
          publisher_kind: "UNIVERSITY_BOARD", publisher_name: "东南大学", publication_basis: "UNIVERSITY_OFFICIAL_PUBLICATION_REPRINT",
          employer_original_verified: false, application_platform_acquired: false, qualification_evidence_status: "NEEDS_REVIEW" } },
        extraction: { extractor_name: this.descriptor.name, extractor_version: this.descriptor.version, extracted_at: input.snapshot.observed_at } };
    };
    return [record(true), record(false)];
  }
  nextPage() { return null; }
  assessCompleteness(input: AdapterCompletenessInput) {
    return input.extraction_errors.length || input.snapshots.length !== 1 || input.records.length !== 2
      ? { status: "FAILED" as const, reason_codes: ["UNIVERSITY_PUBLICATION_EXTRACTION_INCOMPLETE"] }
      : { status: "COMPLETE" as const, reason_codes: ["SINGLE_APPROVED_PUBLICATION_PARSED_QUALIFICATION_REVIEW_SEPARATE"] };
  }
}

export function createSeuCbit2027SourceVersions(input: { observed_at: string; provenance: ProductionPersistenceProvenance;
  scope?: "PRODUCTION" | "CONTROLLED_TEST" }): readonly SourcePersistenceVersion[] {
  if (input.scope === "CONTROLLED_TEST" && input.provenance.actor_role !== "TEST_ONLY") throw new Error("CONTROLLED_SOURCE_SCOPE_DENIED");
  const versions: SourcePersistenceVersion[] = [];
  const append = (stream: string, artifact: SourcePersistenceVersion["artifact"]) => {
    const version = createSourcePersistenceVersion({ stream_id: stream, revision: 1, supersedes_artifact_id: null,
      artifact, provenance: input.provenance, effective_at: input.observed_at, created_at: input.observed_at });
    versions.push(version); return version;
  };
  append("organization-seu-publisher", { kind: "ORGANIZATION", payload: { organization_id: "organization-seu-publisher" as never,
    name: traceable("东南大学"), aliases: [], country_code: "CN" } });
  append(SEU_CBIT_ADAPTER_KEY, { kind: "ADAPTER_REGISTRATION", payload: { adapter_key: SEU_CBIT_ADAPTER_KEY,
    name: traceable("SeuCbit2027UniversityPublicationAdapter"), supported_content_kinds: ["HTML"] } });
  append(SEU_CBIT_SOURCE_ID, { kind: "SOURCE_DEFINITION", payload: { source_definition_id: SEU_CBIT_SOURCE_ID as never,
    publisher_organization_id: "organization-seu-publisher" as never, name: traceable("东南大学官方招聘发布/转载"),
    publisher_kind: "UNIVERSITY_BOARD", authority_level: "OFFICIAL", scope: "MULTI_ORGANIZATION", enabled: true } });
  const endpoint = seuCbitEndpoint();
  const admissionId = SEU_CBIT_ADMISSION_ID as SourceAdmission["source_admission_id"];
  const evidence = ([
    ["robots", "ROBOTS", "UNKNOWN", SEU_CBIT_URL, "Robots status unverified; only exact human-approved bounded scope"],
    ["terms", "TERMS", "UNKNOWN", SEU_CBIT_URL, "Terms status unverified; no third-party platform, credentials or crawling"],
    ["inspection", "ENDPOINT_INSPECTION", "ALLOWED", SEU_CBIT_URL, "Public university HTML binds named subsidiary legal role and explicit 2027 campaign; university is publisher, not employer"],
    ["approval", "MANUAL_REVIEW", "ALLOWED", approval, "User approved university official publication/reprint with separate employer and review status; exact HTML target only"]
  ] as const).map(([suffix, kind, decision, locator, summary]) => ({ source_admission_evidence_id: `evidence-seu-cbit-${suffix}` as never,
    source_admission_id: admissionId, endpoint: SEU_CBIT_URL, source_url: SEU_CBIT_URL, kind, locator, captured_at: input.observed_at,
    reviewer: "delegated-university-publication-review", decision, summary: original(summary) }));
  const reviewId = "review-seu-cbit-2027-exact-publication" as never;
  const admission: SourceAdmission = { source_admission_id: admissionId, admission_level: "B", automation_basis: "HUMAN_APPROVED_CONTINUOUS_SCOPE",
    source_name: traceable("东南大学官方招聘发布/转载"), source_type: "OFFICIAL_RECRUITMENT_PAGE", official_owner: traceable("东南大学"),
    endpoint: SEU_CBIT_URL, recruitment_endpoint_id: endpoint.recruitment_endpoint_id, endpoint_purpose: "RECRUITMENT_NOTICE", allowed_http_method: "GET",
    content_kind: "HTML", source_authority: "OFFICIAL", robots: { status: "UNKNOWN", evidence_id: evidence[0]!.source_admission_evidence_id },
    terms: { status: "UNKNOWN", evidence_id: evidence[1]!.source_admission_evidence_id }, login_requirement: "NONE", captcha: "NONE_OBSERVED",
    structure: "STATIC_HTML", stability: "MEDIUM", update_frequency: "IRREGULAR", priority: "HIGH", prohibited_actions: [...SOURCE_PROHIBITED_ACTIONS],
    evidence, review_records: [{ source_admission_review_id: reviewId, reviewer: "user-approved-university-publication-review",
      reviewed_at: input.observed_at, decision: "APPROVED", rationale: original("Exact university publication only; employer-origin and qualification gaps remain unresolved"),
      evidence_ids: evidence.map(value => value.source_admission_evidence_id) }], admission_decision: "APPROVED",
    continuous_acquisition_scope: { scope: input.scope ?? "PRODUCTION", exact_targets: [{ allowlist_entry_id: SEU_CBIT_ALLOWLIST_ID, exact_url: SEU_CBIT_URL }],
      min_interval_seconds: 86400, effective_from: input.observed_at, approval_review_id: reviewId } };
  const endpointVersion = append(endpoint.recruitment_endpoint_id, { kind: "RECRUITMENT_ENDPOINT", payload: endpoint });
  const admissionVersion = append(admissionId, { kind: "SOURCE_ADMISSION", payload: admission });
  append(SEU_CBIT_ALLOWLIST_ID, { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: { allowlist_entry_id: SEU_CBIT_ALLOWLIST_ID,
    recruitment_endpoint_artifact_id: endpointVersion.artifact_id, source_admission_artifact_id: admissionVersion.artifact_id,
    active: true, scheme: "https", host: "em.seu.edu.cn", port: null, path_prefix: new URL(SEU_CBIT_URL).pathname, exact_path: true,
    allowed_method: "GET", query_policy: { mode: "DENY_ALL", allowed_parameters: [] }, endpoint_purpose: "RECRUITMENT_NOTICE", authority_level: "OFFICIAL",
    approval_evidence_ids: evidence.map(value => value.source_admission_evidence_id) } });
  return versions;
}
