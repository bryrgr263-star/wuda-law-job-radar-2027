import type { RecruitmentEndpoint, SourceDefinition } from "../../ingestion/domain";
import { canonicalSerialize } from "../../ingestion/normalization/canonical-artifact-registry";
import { assertApprovedQueryRequest, type QueryAuthorizationContract } from "./query-authorization";
import type { LiveCanaryManualAuthorization, SourceAdmission } from "./types";

export interface SupportingInspectionBindings {
  readonly source_artifact_id: string;
  readonly endpoint_artifact_id: string;
  readonly admission_artifact_id: string;
  readonly allowlist_artifact_id: string;
  readonly adapter_artifact_id: string;
}

interface SupportingInspectionBase {
  readonly schema_version: "supporting-inspection-execution/1.0.0";
  readonly authorization: LiveCanaryManualAuthorization;
  readonly bindings: SupportingInspectionBindings;
  readonly exact_url: string;
  readonly method: "GET";
  readonly query_contract_hash: string;
  readonly claimed_at: string;
}

export interface SupportingInspectionReceipt {
  readonly collection_run_id: string;
  readonly exact_url: string;
  readonly acquisition_run_id: string;
  readonly snapshot_id: string;
  readonly acquisition_bundle_hash: string;
  readonly request_started_at: string;
  readonly response_received_at: string;
  readonly transport_status: "SUCCESS" | "FAILED";
  readonly raw_blob_id: string | null;
}

export type SupportingInspectionExecution = SupportingInspectionBase & (
  { readonly state: "CLAIMED" }
  | { readonly state: "RECEIPT"; readonly receipt: SupportingInspectionReceipt }
  | { readonly state: "UNKNOWN"; readonly unknown: {
    readonly recorded_at: string;
    readonly reason: "SEND_STATE_UNKNOWN" | "RECEIPT_STATE_UNKNOWN";
  } }
);

export interface SupportingInspectionContext {
  readonly source: SourceDefinition;
  readonly endpoint: RecruitmentEndpoint;
  readonly admission: SourceAdmission;
  readonly bindings: SupportingInspectionBindings;
  readonly query_contract: QueryAuthorizationContract;
}

function deny(): never { throw new Error("SUPPORTING_INSPECTION_DENIED"); }
function keys(value: object, expected: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) deny();
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) deny();
}
function time(value: unknown): number {
  text(value);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) deny();
  return parsed;
}
function hash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) deny();
}

export function assertSupportingInspectionExecution(record: SupportingInspectionExecution) {
  keys(record, ["schema_version", "state", "authorization", "bindings", "exact_url", "method", "query_contract_hash", "claimed_at",
    ...(record.state === "RECEIPT" ? ["receipt"] : record.state === "UNKNOWN" ? ["unknown"] : [])]);
  if (record.schema_version !== "supporting-inspection-execution/1.0.0"
    || !["CLAIMED", "RECEIPT", "UNKNOWN"].includes(record.state) || record.method !== "GET") deny();
  keys(record.authorization, ["authorization_mode", "authorization_id", "source_admission_id", "endpoint", "recruitment_endpoint_id",
    "endpoint_purpose", "allowed_http_method", "collection_run_id", "reviewer", "issued_at", "evidence_id", "scope", "manual_confirmation"]);
  const authorization = record.authorization;
  for (const value of [authorization.authorization_id, authorization.source_admission_id, authorization.recruitment_endpoint_id,
    authorization.endpoint_purpose, authorization.collection_run_id, authorization.reviewer, authorization.evidence_id]) text(value);
  if (authorization.authorization_mode !== "AUTOMATION_CANARY" || authorization.scope !== "ONE_ENDPOINT_ONE_RUN"
    || authorization.manual_confirmation !== true || authorization.allowed_http_method !== "GET"
    || authorization.endpoint !== record.exact_url || time(authorization.issued_at) > time(record.claimed_at)) deny();
  keys(record.bindings, ["source_artifact_id", "endpoint_artifact_id", "admission_artifact_id", "allowlist_artifact_id", "adapter_artifact_id"]);
  Object.values(record.bindings).forEach(text);
  text(record.exact_url);
  let url: URL;
  try { url = new URL(record.exact_url); } catch { return deny(); }
  if (url.protocol !== "https:" || url.href !== record.exact_url || url.username || url.password || url.hash || url.port) deny();
  hash(record.query_contract_hash);
  if (record.state === "RECEIPT") {
    const receipt = record.receipt;
    keys(receipt, ["collection_run_id", "exact_url", "acquisition_run_id", "snapshot_id", "acquisition_bundle_hash", "request_started_at",
      "response_received_at", "transport_status", "raw_blob_id"]);
    text(receipt.acquisition_run_id); text(receipt.snapshot_id); hash(receipt.acquisition_bundle_hash);
    if (receipt.collection_run_id !== authorization.collection_run_id || receipt.exact_url !== record.exact_url
      || time(receipt.request_started_at) < time(record.claimed_at)
      || time(receipt.response_received_at) < time(receipt.request_started_at)
      || !["SUCCESS", "FAILED"].includes(receipt.transport_status)
      || (receipt.transport_status === "SUCCESS" ? typeof receipt.raw_blob_id !== "string"
        || !/^sha256:[a-f0-9]{64}$/u.test(receipt.raw_blob_id) : receipt.raw_blob_id !== null)) deny();
  } else if (record.state === "UNKNOWN") {
    keys(record.unknown, ["recorded_at", "reason"]);
    if (time(record.unknown.recorded_at) < time(record.claimed_at)
      || !["SEND_STATE_UNKNOWN", "RECEIPT_STATE_UNKNOWN"].includes(record.unknown.reason)) deny();
  }
}

export function replaySupportingInspections(
  records: readonly SupportingInspectionExecution[],
  resolve: (record: SupportingInspectionExecution, index: number) => SupportingInspectionContext
): SupportingInspectionExecution[] {
  const current = new Map<string, SupportingInspectionExecution>();
  const runs = new Set<string>();
  for (const [index, record] of records.entries()) {
    assertSupportingInspectionExecution(record);
    const prior = current.get(record.authorization.authorization_id);
    if (!prior) {
      if (record.state !== "CLAIMED" || runs.has(record.authorization.collection_run_id)) deny();
      const context = resolve(record, index);
      const endpoint = context.endpoint;
      const admission = context.admission;
      if (canonicalSerialize(context.bindings) !== canonicalSerialize(record.bindings)
        || context.source.source_definition_id !== endpoint.source_definition_id || !context.source.enabled || !endpoint.enabled
        || context.source.authority_level !== "OFFICIAL" || admission.source_authority !== "OFFICIAL"
        || admission.admission_level !== "B" || admission.automation_basis !== "HUMAN_REVIEWED_CANARY"
        || admission.admission_decision !== "APPROVED"
        || admission.continuous_acquisition_scope !== undefined
        || endpoint.collection_config.max_items !== 1 || endpoint.collection_config.max_pages !== 1
        || endpoint.collection_config.retry_limit !== 0 || endpoint.collection_config.follow_redirects !== false
        || context.query_contract.contract_hash !== record.query_contract_hash || context.query_contract.pagination !== null
        || context.query_contract.maximum_pages !== 1 || context.query_contract.request_budget !== 1) deny();
      assertApprovedQueryRequest(record.exact_url, context.query_contract);
      const authorization = record.authorization;
      if (authorization.source_admission_id !== admission.source_admission_id
        || admission.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id
        || authorization.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id
        || admission.endpoint !== record.exact_url || endpoint.locator !== record.exact_url
        || admission.endpoint_purpose !== authorization.endpoint_purpose
        || admission.allowed_http_method !== "GET" || endpoint.request_method !== "GET"
        || endpoint.content_kind !== admission.content_kind
        || !admission.evidence.some(evidence => evidence.source_admission_evidence_id === authorization.evidence_id
          && evidence.decision === "ALLOWED")
        || !admission.review_records.some(review => review.decision === "APPROVED"
          && review.evidence_ids.includes(authorization.evidence_id))) deny();
      runs.add(record.authorization.collection_run_id);
    } else {
      if (prior.state !== "CLAIMED" || record.state === "CLAIMED") deny();
      const base = (value: SupportingInspectionExecution) => ({ schema_version: value.schema_version,
        authorization: value.authorization, bindings: value.bindings, exact_url: value.exact_url, method: value.method,
        query_contract_hash: value.query_contract_hash, claimed_at: value.claimed_at });
      if (canonicalSerialize(base(prior)) !== canonicalSerialize(base(record))) deny();
    }
    current.set(record.authorization.authorization_id, structuredClone(record));
  }
  return [...current.values()].map(record => structuredClone(record));
}
