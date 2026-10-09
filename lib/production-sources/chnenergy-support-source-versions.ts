import { createHash } from "node:crypto";
import { SOURCE_PROHIBITED_ACTIONS, type SourceAdmission } from "../application/source-admission/types";
import { validateSourceAdmission } from "../application/source-admission/source-admission-register";
import { sealQueryAuthorizationContract } from "../application/source-admission/query-authorization";
import { UTF8_TEXT_ENCODING } from "../ingestion";
import { assertSourcePersistenceVersion, createSourcePersistenceVersion,
  type ProductionPersistenceProvenance, type SourcePersistenceVersion } from "../production-persistence/contracts";
import { CHNENERGY_CAMPAIGN_URL, CHNENERGY_JOBS, CHNENERGY_SOURCE_ID } from "./chnenergy-2027-source";
import { CHNENERGY_SUPPORT_ADAPTER_KEY, chnenergySupportingEndpoint } from "./chnenergy-supporting-evidence";

export function createChnenergySupportingSourceVersions(input: {
  readonly existing_versions: readonly SourcePersistenceVersion[];
  readonly approved_at: string;
  readonly reviewer: string;
  readonly approval_reference: string;
  readonly provenance: ProductionPersistenceProvenance;
}): readonly SourcePersistenceVersion[] {
  const at = Date.parse(input.approved_at);
  if (!Number.isFinite(at) || !input.reviewer.trim() || !input.approval_reference.trim()) {
    throw new Error("CHNENERGY_SUPPORT_EXPLICIT_APPROVAL_REQUIRED");
  }
  input.existing_versions.forEach(assertSourcePersistenceVersion);
  const definitions = input.existing_versions.filter(version => version.artifact.kind === "SOURCE_DEFINITION"
    && version.artifact.payload.source_definition_id === CHNENERGY_SOURCE_ID);
  const source = definitions[0];
  if (definitions.length !== 1 || source?.artifact.kind !== "SOURCE_DEFINITION"
    || !source.artifact.payload.enabled || source.artifact.payload.authority_level !== "OFFICIAL"
    || Date.parse(source.effective_at) > at) throw new Error("CHNENERGY_SUPPORT_EXISTING_SOURCE_REQUIRED");
  const urls = [CHNENERGY_CAMPAIGN_URL, ...CHNENERGY_JOBS.map(job => job.membership_url)];
  if (input.existing_versions.some(version => version.artifact.kind === "ADAPTER_REGISTRATION"
    && version.artifact.payload.adapter_key === CHNENERGY_SUPPORT_ADAPTER_KEY
    || version.artifact.kind === "RECRUITMENT_ENDPOINT" && urls.includes(version.artifact.payload.locator))) {
    throw new Error("CHNENERGY_SUPPORT_ALREADY_REGISTERED");
  }
  const original = (text: string) => ({ text, encoding: UTF8_TEXT_ENCODING });
  const versions: SourcePersistenceVersion[] = [];
  const append = (stream: string, artifact: SourcePersistenceVersion["artifact"]) => {
    const version = createSourcePersistenceVersion({ stream_id: stream, revision: 1, supersedes_artifact_id: null,
      artifact, provenance: input.provenance, effective_at: input.approved_at, created_at: input.approved_at });
    versions.push(version);
    return version;
  };
  append(CHNENERGY_SUPPORT_ADAPTER_KEY, { kind: "ADAPTER_REGISTRATION", payload: {
    adapter_key: CHNENERGY_SUPPORT_ADAPTER_KEY, name: { original: original("ChnenergyReviewedSupportingHtmlAdapter") },
    supported_content_kinds: ["HTML"] } });
  for (const url of urls) {
    const endpoint = chnenergySupportingEndpoint(url);
    const identity = createHash("sha256").update(url).digest("hex");
    const admissionId = `admission-cn-chnenergy-support:${identity}` as SourceAdmission["source_admission_id"];
    const parsed = new URL(url);
    const combination = [...parsed.searchParams].map(([name, value]) => ({ name, value }));
    const contract = sealQueryAuthorizationContract({ schema_version: "query-authorization/2.0.0",
      base_exact_url: `${parsed.origin}${parsed.pathname}`, parameters: combination.map(({ name, value }) => ({ name,
        required: true, allowed_values: [value] })), approved_combinations: [combination], pagination: null,
      maximum_pages: 1, request_budget: 1, canonicalization: "QUERY_ASCII_RFC3986_V1" });
    const purpose = url === CHNENERGY_CAMPAIGN_URL ? "RECRUITMENT_NOTICE" : "JOB_LIST";
    const evidence: SourceAdmission["evidence"] = [
      { source_admission_evidence_id: `support-${identity}-robots` as never, source_admission_id: admissionId,
        endpoint: url, source_url: url, kind: "ROBOTS", locator: url, captured_at: input.approved_at,
        reviewer: input.reviewer, decision: "UNKNOWN", summary: original("Robots unverified; one reviewed request only") },
      { source_admission_evidence_id: `support-${identity}-terms` as never, source_admission_id: admissionId,
        endpoint: url, source_url: url, kind: "TERMS", locator: url, captured_at: input.approved_at,
        reviewer: input.reviewer, decision: "UNKNOWN", summary: original("Terms unverified; no continuous access granted") },
      { source_admission_evidence_id: `support-${identity}-approval` as never, source_admission_id: admissionId,
        endpoint: url, source_url: url, kind: "MANUAL_REVIEW", locator: input.approval_reference, captured_at: input.approved_at,
        reviewer: input.reviewer, decision: "ALLOWED", summary: original(`Exact supporting surface approved for one stateless request: ${url}; response content remains unverified`) }
    ];
    const admission: SourceAdmission = { source_admission_id: admissionId, admission_level: "B",
      automation_basis: "HUMAN_REVIEWED_CANARY", source_name: { original: original("国家能源精确招聘佐证页面") },
      source_type: "OFFICIAL_RECRUITMENT_PAGE", official_owner: { original: original("国家能源投资集团有限责任公司") },
      endpoint: url, recruitment_endpoint_id: endpoint.recruitment_endpoint_id, endpoint_purpose: purpose,
      allowed_http_method: "GET", content_kind: "HTML", source_authority: "OFFICIAL",
      robots: { status: "UNKNOWN", evidence_id: evidence[0]!.source_admission_evidence_id },
      terms: { status: "UNKNOWN", evidence_id: evidence[1]!.source_admission_evidence_id }, login_requirement: "NONE",
      captcha: "NONE_OBSERVED", structure: "STATIC_HTML", stability: "MEDIUM", update_frequency: "IRREGULAR",
      priority: "HIGH", prohibited_actions: [...SOURCE_PROHIBITED_ACTIONS], evidence,
      review_records: [{ source_admission_review_id: `support-${identity}-review` as never, reviewer: input.reviewer,
        reviewed_at: input.approved_at, decision: "APPROVED", rationale: original("Previously reviewed exact support surface; actual response must still pass transport and extraction policy"),
        evidence_ids: evidence.map(item => item.source_admission_evidence_id) }], admission_decision: "APPROVED" };
    validateSourceAdmission(admission);
    const endpointVersion = append(endpoint.recruitment_endpoint_id, { kind: "RECRUITMENT_ENDPOINT", payload: endpoint });
    const admissionVersion = append(admissionId, { kind: "SOURCE_ADMISSION", payload: admission });
    append(`allowlist-cn-chnenergy-support:${identity}`, { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: {
      allowlist_entry_id: `allowlist-cn-chnenergy-support:${identity}`, recruitment_endpoint_artifact_id: endpointVersion.artifact_id,
      source_admission_artifact_id: admissionVersion.artifact_id, active: true, scheme: "https", host: parsed.hostname,
      port: null, path_prefix: parsed.pathname, exact_path: true, allowed_method: "GET", query_policy: { mode: "FINITE_VALUES", contract },
      endpoint_purpose: purpose, authority_level: "OFFICIAL", approval_evidence_ids: evidence.map(item => item.source_admission_evidence_id) } });
  }
  return versions;
}
