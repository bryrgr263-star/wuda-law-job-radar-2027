import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { SOURCE_PROHIBITED_ACTIONS, type SourceAdmission } from "../application/source-admission";
import { sealQueryAuthorizationContract } from "../application/source-admission/query-authorization";
import { AdapterExtractionError, UTF8_TEXT_ENCODING, type RecruitmentAdapter, type AdapterExtractionInput,
  type AdapterCompletenessInput, type RecruitmentEndpoint, type ExtractedRecord, type OriginalText, type EndpointValidationResult } from "../ingestion";
import { createSourcePersistenceVersion, type SourcePersistenceVersion, type ProductionPersistenceProvenance } from "../production-persistence/contracts";

export const CHNENERGY_ADAPTER_KEY = "cn-chnenergy-2027-reviewed-official-html";
export const CHNENERGY_SOURCE_ID = "source-cn-chnenergy-2027-first-expansion";
export const CHNENERGY_CAMPAIGN_URL = "https://zhaopin.chnenergy.com.cn/annc/showgg?id=6a152f40-7fe5-460e-ad37-0024acafd8c9";
const approvedProject = "e929662a-324a-47d0-b4ca-9fe5ef47b8ba";
const approval = "user-approval:2026-10-06-first-production-source-expansion";
const base = "https://zhaopin.chnenergy.com.cn/annc/showgw";

export const CHNENERGY_JOBS = Object.freeze([
  Object.freeze({ id: "5a798bfe-a4d6-0be4-e063-98b4d40a088a", title: "法务管理",
    employer: "中国神华煤制油化工有限公司鄂尔多斯煤制油分公司本部", location: "内蒙古自治区鄂尔多斯",
    url: `${base}?id=5a798bfe-a4d6-0be4-e063-98b4d40a088a`,
    membership_url: "https://zhaopin.chnenergy.com.cn/annc/showggStationList?id=6a152f40-7fe5-460e-ad37-0024acafd8c9&zhaopingangwei=%E6%B3%95%E5%8A%A1%E7%AE%A1%E7%90%86" }),
  Object.freeze({ id: "5a798bfe-ac8c-0be4-e063-98b4d40a088a", title: "合规管理岗",
    employer: "国能西部能源青松新疆矿业有限公司", location: "新疆阿克苏",
    url: `${base}?id=5a798bfe-ac8c-0be4-e063-98b4d40a088a`,
    membership_url: "https://zhaopin.chnenergy.com.cn/annc/showggStationList?id=6a152f40-7fe5-460e-ad37-0024acafd8c9&zhaopingangwei=%E5%90%88%E8%A7%84%E7%AE%A1%E7%90%86%E5%B2%97" })
]);
type ReviewedJob = (typeof CHNENERGY_JOBS)[number];
const original = (text: string): OriginalText => ({ text, encoding: UTF8_TEXT_ENCODING });
const traceable = (text: string) => ({ original: original(text) });
const endpointId = (job: ReviewedJob) => `endpoint-cn-chnenergy-${job.id}`;
export const chnenergyAdmissionId = (job: ReviewedJob) => `admission-cn-chnenergy-${job.id}`;
export const chnenergyAllowlistId = (job: ReviewedJob) => `allowlist-cn-chnenergy-${job.id}`;

function reviewedJob(endpoint: RecruitmentEndpoint) {
  const job = CHNENERGY_JOBS.find(candidate => endpoint.locator === candidate.url
    && endpoint.recruitment_endpoint_id === endpointId(candidate));
  if (!job) throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "UNAPPROVED_CHNENERGY_TARGET");
  return job;
}

export function chnenergyEndpoint(job: ReviewedJob): RecruitmentEndpoint {
  return { recruitment_endpoint_id: endpointId(job) as never, source_definition_id: CHNENERGY_SOURCE_ID as never,
    name: traceable(`${job.employer} ${job.title}`), locator: job.url, request_method: "GET", content_kind: "HTML",
    adapter_key: CHNENERGY_ADAPTER_KEY, decoded_text_encoding: UTF8_TEXT_ENCODING, coverage_regions: [],
    collection_config: { timeout_ms: 20000, max_items: 2, max_pages: 1, follow_redirects: false, retry_limit: 0 }, enabled: true };
}

export class Chnenergy2027HtmlAdapter implements RecruitmentAdapter {
  readonly descriptor = { adapter_key: CHNENERGY_ADAPTER_KEY, name: "Chnenergy2027ReviewedOfficialHtmlAdapter", version: "1.0.0",
    supported_content_kinds: ["HTML"] as const, capabilities: ["HTML_EXTRACTION"] as const };
  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult {
    try {
      reviewedJob(endpoint);
      if (endpoint.adapter_key !== CHNENERGY_ADAPTER_KEY || endpoint.request_method !== "GET" || endpoint.content_kind !== "HTML"
        || endpoint.collection_config.max_pages !== 1 || endpoint.collection_config.retry_limit !== 0
        || endpoint.collection_config.follow_redirects !== false) throw new Error("EXACT_ENDPOINT_CONFIG_REQUIRED");
      return { valid: true as const, issues: [] };
    } catch { return { valid: false as const, issues: ["UNAPPROVED_CHNENERGY_ENDPOINT"] }; }
  }
  plan(endpoint: RecruitmentEndpoint) {
    if (!this.validateEndpoint(endpoint).valid) throw new AdapterExtractionError("ENDPOINT_NOT_SUPPORTED", "UNAPPROVED_CHNENERGY_ENDPOINT");
    return [{ recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: endpoint.locator, method: "GET" as const,
      parameters: {}, pagination_state: { page_index: 1, cursor: null, visited_locators: [endpoint.locator] } }];
  }
  extract(input: AdapterExtractionInput): readonly ExtractedRecord[] {
    const job = reviewedJob(input.endpoint);
    const raw = input.raw_blob;
    if (!raw || input.snapshot.transport_status !== "SUCCESS" || input.snapshot.request_metadata.locator !== job.url
      || input.snapshot.raw_blob_id !== raw.raw_blob_id || input.snapshot.content_hash !== raw.raw_content_sha256
      || input.snapshot.content_length !== raw.byte_length || createHash("sha256").update(raw.bytes).digest("hex") !== raw.raw_content_sha256) {
      throw new AdapterExtractionError("RAW_BLOB_MISMATCH", "CHNENERGY_RAW_BINDING_MISMATCH");
    }
    const $ = cheerio.load(new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes));
    const clean = (text: string) => text.replace(/\s+/gu, " ").trim();
    const headers = $("h4.listTitle");
    const section = (label: string) => {
      const header = headers.filter((_index, node) => clean($(node).text()) === label);
      if (header.length !== 1) throw new AdapterExtractionError("MALFORMED_CONTENT", "CHNENERGY_SECTION_BINDING_MISSING");
      const content = header.parent().next();
      if (!content.is("ul,ol")) throw new AdapterExtractionError("MALFORMED_CONTENT", "CHNENERGY_SECTION_BOUNDARY_CHANGED");
      return content;
    };
    const info = section("岗位基本信息");
    const field = (label: string) => {
      const matches = info.find("li,div.col-md-5").filter((_index, node) => {
        return $(node).children().length === 0 && clean($(node).text()).startsWith(`${label}：`);
      });
      if (matches.length !== 1) throw new AdapterExtractionError("MALFORMED_CONTENT", `CHNENERGY_FIELD_BINDING_MISSING:${label}`);
      return clean(matches.text()).slice(label.length + 1);
    };
    const projectBound = $("[onclick]").toArray().some(node => {
      if (clean($(node).text()) !== "申请") return false;
      const ids = ($(node).attr("onclick") ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu);
      return ids?.length === 2 && ids[0] === job.id && ids[1] === approvedProject;
    });
    const employer = field("招聘单位"); const title = field("招聘岗位"); const location = field("工作地点");
    if (clean($("title").text()) !== "岗位详情" || title !== job.title || employer !== job.employer || !projectBound) {
      throw new AdapterExtractionError("MALFORMED_CONTENT", "CHNENERGY_2027_OFFICIAL_BINDING_MISMATCH");
    }
    const dutyText = section("岗位职责").find("#descDetail").text().trim();
    const requirements = section("岗位要求").find("li").map((_index, node) => clean($(node).text())).get();
    if (!requirements.some(text => text.startsWith("学历要求：")) || !requirements.some(text => text.startsWith("专业要求："))) {
      throw new AdapterExtractionError("MALFORMED_CONTENT", "CHNENERGY_REQUIREMENT_SURFACE_MISSING");
    }
    const record = (packageRecord: boolean): ExtractedRecord => {
      const recordId = `chnenergy:${job.id}:${packageRecord ? "package" : "position"}`;
      const identity = { identity_state: "CONFIRMED" as const, official_identifier: original(job.id),
        identifier_namespace: "official:chnenergy:campus-position", evidence_locator: { kind: "HTML" as const, selector: "button[onclick]" } };
      return { extracted_record_id: `chnenergy:${createHash("sha256").update(`${input.snapshot.snapshot_id}|${recordId}`).digest("hex")}` as never,
        snapshot_id: input.snapshot.snapshot_id, source_definition_id: input.endpoint.source_definition_id,
        identity_candidates: [{ kind: "SOURCE_RECORD_ID", value: recordId, confidence: "HIGH" }], raw_source_record_id: recordId,
        raw_title: original(title), raw_organization_name: original(employer), raw_location_text: packageRecord ? [] : [original(location)],
        raw_description: original(packageRecord ? `${employer} ${title}` : dutyText),
        ...(!packageRecord ? { raw_requirement_text: original(requirements.join("\n")) } : {}),
        announcement_url: job.url, application_url: job.url,
        recruitment_year: original("2027"), recruitment_batch: original("国家能源集团2027年度高校毕业生统招"),
        ...(!packageRecord ? { recruitment_context: { announcement: identity, recruitment_plan: {
          ...identity, official_identifier: original(approvedProject), identifier_namespace: "official:chnenergy:recruitment-project" },
          recruitment_batch: { applicability: "APPLICABLE" as const, identity: { ...identity, official_identifier: original("6a152f40-7fe5-460e-ad37-0024acafd8c9") } },
          position: identity, opportunity: identity } } : {}),
        source_record_locator: { kind: "HTML", selector: packageRecord ? "h4.listTitle" : "#descDetail", path: recordId },
        adapter_metadata: { [CHNENERGY_ADAPTER_KEY]: { source_role: packageRecord ? "PACKAGE" : "POSITION_BEARING",
          campaign_url: CHNENERGY_CAMPAIGN_URL, membership_evidence_url: job.membership_url,
          official_project_id: approvedProject, binding_basis: "REVIEWED_OFFICIAL_CAMPAIGN_MEMBER_AND_EXACT_PROJECT_ID",
          application_link_basis: "PUBLIC_JOB_PAGE_HAS_APPLY_ENTRY_LOGIN_NOT_ACQUIRED" } },
        extraction: { extractor_name: this.descriptor.name, extractor_version: this.descriptor.version, extracted_at: input.snapshot.observed_at } };
    };
    return [record(true), record(false)];
  }
  nextPage() { return null; }
  assessCompleteness(input: AdapterCompletenessInput) {
    return input.extraction_errors.length || input.snapshots.length !== 1 || input.records.length !== 2
      ? { status: "FAILED" as const, reason_codes: ["REVIEWED_POSITION_PACKAGE_INCOMPLETE"] }
      : { status: "COMPLETE" as const, reason_codes: ["EXACT_POSITION_SURFACE_OBSERVED"] };
  }
}

export function createChnenergy2027SourceVersions(input: { observed_at: string; provenance: ProductionPersistenceProvenance;
  scope?: "PRODUCTION" | "CONTROLLED_TEST" }): readonly SourcePersistenceVersion[] {
  if (input.scope === "CONTROLLED_TEST" && input.provenance.actor_role !== "TEST_ONLY") throw new Error("CONTROLLED_SOURCE_SCOPE_DENIED");
  const versions: SourcePersistenceVersion[] = [];
  const append = (stream: string, artifact: SourcePersistenceVersion["artifact"]) => {
    const version = createSourcePersistenceVersion({ stream_id: stream, revision: 1, supersedes_artifact_id: null,
      artifact, provenance: input.provenance, effective_at: input.observed_at, created_at: input.observed_at });
    versions.push(version); return version;
  };
  append("organization-cn-chnenergy-group", { kind: "ORGANIZATION", payload: { organization_id: "organization-cn-chnenergy-group" as never,
    name: traceable("国家能源投资集团有限责任公司"), aliases: [], country_code: "CN" } });
  append(CHNENERGY_ADAPTER_KEY, { kind: "ADAPTER_REGISTRATION", payload: { adapter_key: CHNENERGY_ADAPTER_KEY,
    name: traceable("Chnenergy2027ReviewedOfficialHtmlAdapter"), supported_content_kinds: ["HTML"] } });
  append(CHNENERGY_SOURCE_ID, { kind: "SOURCE_DEFINITION", payload: { source_definition_id: CHNENERGY_SOURCE_ID as never,
    publisher_organization_id: "organization-cn-chnenergy-group" as never, name: traceable("国家能源集团2027统招首批精确法律岗位"),
    publisher_kind: "EMPLOYER_OFFICIAL", authority_level: "OFFICIAL", scope: "MULTI_ORGANIZATION", enabled: true } });
  for (const job of CHNENERGY_JOBS) {
    const endpoint = chnenergyEndpoint(job);
    const contract = sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0", base_exact_url: base,
      parameters: [{ name: "id", required: true, allowed_values: [job.id] }], approved_combinations: [[{ name: "id", value: job.id }]],
      pagination: null, maximum_pages: 1, request_budget: 1, canonicalization: "QUERY_ASCII_RFC3986_V1" });
    const admissionId = chnenergyAdmissionId(job) as SourceAdmission["source_admission_id"];
    const evidence = ([
      ["robots", "ROBOTS", "UNKNOWN", job.url, "Robots policy is unverified; only human-reviewed bounded access is allowed"],
      ["terms", "TERMS", "UNKNOWN", job.url, "Terms are unverified; no credentialed, browser, or unrestricted access is approved"],
      ["batch", "ENDPOINT_INSPECTION", "ALLOWED", job.membership_url, `Official 2027 campaign ${CHNENERGY_CAMPAIGN_URL} links its member list; the filtered member list contains exact job ${job.id}; public apply entry independently binds project ${approvedProject}`],
      ["approval", "MANUAL_REVIEW", "ALLOWED", approval, `User approved first-batch official HTML admission only after batch binding. Exact target: ${job.url}; min interval 86400 seconds`]
    ] as const).map(([suffix, kind, decision, locator, summary]) => ({ source_admission_evidence_id: `evidence-${job.id}-${suffix}` as never,
      source_admission_id: admissionId, endpoint: job.url, source_url: job.url, kind, locator, captured_at: input.observed_at,
      reviewer: "first-expansion-official-binding-review", decision, summary: original(summary) }));
    const reviewId = `review-${job.id}-first-expansion` as never;
    const admission: SourceAdmission = { source_admission_id: admissionId, admission_level: "B", automation_basis: "HUMAN_APPROVED_CONTINUOUS_SCOPE",
      source_name: traceable(`${job.employer} ${job.title}`), source_type: "OFFICIAL_RECRUITMENT_PAGE", official_owner: traceable("国家能源投资集团有限责任公司"),
      endpoint: job.url, recruitment_endpoint_id: endpoint.recruitment_endpoint_id, endpoint_purpose: "JOB_DETAIL", allowed_http_method: "GET",
      content_kind: "HTML", source_authority: "OFFICIAL", robots: { status: "UNKNOWN", evidence_id: evidence[0]!.source_admission_evidence_id },
      terms: { status: "UNKNOWN", evidence_id: evidence[1]!.source_admission_evidence_id }, login_requirement: "NONE", captcha: "NONE_OBSERVED",
      structure: "STATIC_HTML", stability: "MEDIUM", update_frequency: "IRREGULAR", priority: "HIGH", prohibited_actions: [...SOURCE_PROHIBITED_ACTIONS],
      evidence, review_records: [{ source_admission_review_id: reviewId, reviewer: "human-approved-first-expansion",
        reviewed_at: input.observed_at, decision: "APPROVED", rationale: original("Two exact publicly readable job surfaces; no login or automatic discovery"),
        evidence_ids: evidence.map(item => item.source_admission_evidence_id) }], admission_decision: "APPROVED",
      continuous_acquisition_scope: { scope: input.scope ?? "PRODUCTION", exact_targets: [{ allowlist_entry_id: chnenergyAllowlistId(job), exact_url: job.url,
        query_contract_hash: contract.contract_hash }], min_interval_seconds: 86400, effective_from: input.observed_at, approval_review_id: reviewId } };
    const endpointVersion = append(endpoint.recruitment_endpoint_id, { kind: "RECRUITMENT_ENDPOINT", payload: endpoint });
    const admissionVersion = append(admissionId, { kind: "SOURCE_ADMISSION", payload: admission });
    append(chnenergyAllowlistId(job), { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: { allowlist_entry_id: chnenergyAllowlistId(job),
      recruitment_endpoint_artifact_id: endpointVersion.artifact_id, source_admission_artifact_id: admissionVersion.artifact_id,
      active: true, scheme: "https", host: "zhaopin.chnenergy.com.cn", port: null, path_prefix: "/annc/showgw", exact_path: true,
      allowed_method: "GET", query_policy: { mode: "FINITE_VALUES", contract }, endpoint_purpose: "JOB_DETAIL", authority_level: "OFFICIAL",
      approval_evidence_ids: evidence.map(item => item.source_admission_evidence_id) } });
  }
  return versions;
}
