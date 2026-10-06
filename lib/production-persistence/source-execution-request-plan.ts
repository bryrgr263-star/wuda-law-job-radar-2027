import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import type { SourceExecutionOutcome } from "./source-execution-outcome";
import { assertOfficialRequestAllowed, type AcquisitionPersistenceBundle, type SourcePersistenceVersion, type OfficialEndpointAllowlist } from "./contracts";
import type { ContinuousRecord } from "../application/source-admission/continuous-acquisition";
import { paginationContentFingerprint } from "../collection-runtime/pagination-content";

export const SOURCE_EXECUTION_REQUEST_PLAN_SCHEMA_VERSION = "source-execution-request-plan/1.0.0" as const;

export interface SourceExecutionTargetObservation {
  readonly request_attempt_id: string;
  readonly acquisition_run_id: string;
  readonly snapshot_id: string;
  readonly raw_blob_id: string | null;
  readonly raw_content_sha256: string | null;
  readonly extracted_record_ids: readonly string[];
  readonly transport_status: "SUCCESS" | "FAILED";
}

export interface SourceExecutionPlannedTarget {
  readonly allowlist_entry_id: string;
  readonly allowlist_artifact_id: string;
  readonly exact_url: string;
  readonly authorization_id: string | null;
  readonly source_admission_artifact_id: string;
  readonly endpoint_purpose: string;
  readonly request_policy: { readonly method: "GET"; readonly redirect: "DENY"; readonly query: "DENY" }
    | { readonly method: "GET"; readonly redirect: "DENY"; readonly query: "FINITE_VALUES"; readonly query_contract_hash: string };
  readonly observations: readonly SourceExecutionTargetObservation[];
  readonly execution_disposition?: "REQUESTED" | "SKIPPED_BY_BOUNDED_STOP" | "NOT_REQUESTED_DUE_ABORT";
  readonly stop_evidence?: {
    readonly reason: "EMPTY_PAGE_STOP" | "REPEATED_CONTENT_BLOCKED" | "MAX_PAGES_REACHED" | "REQUEST_BUDGET_EXHAUSTED";
    readonly request_intent_hash: string;
    readonly policy_reference: string;
  };
  readonly abort_evidence?: {
    readonly reason: "AUTHORIZATION_REVOKED" | "AUTHORIZATION_NOT_EFFECTIVE" | "EXACT_REQUEST_DENIED"
      | "REAUTHORIZE_REQUIRED" | "REQUEST_PLAN_ABORTED" | "RUN_ABORTED";
    readonly stage: "BEFORE_RESERVATION";
    readonly request_intent_hash: string;
    readonly authorization_reference: string;
    readonly policy_reference: string;
  };
}

export interface SourceExecutionRequestPlan {
  readonly schema_version: typeof SOURCE_EXECUTION_REQUEST_PLAN_SCHEMA_VERSION | "source-execution-request-plan/2.0.0";
  readonly source_execution_id: string;
  readonly source_definition_id: string;
  readonly source_artifact_id: string;
  readonly source_revision: number;
  readonly recruitment_endpoint_id: string;
  readonly endpoint_artifact_id: string;
  readonly targets: readonly SourceExecutionPlannedTarget[];
  readonly integrity_hash: string;
}

export function sealSourceExecutionRequestPlan(input: Omit<SourceExecutionRequestPlan, "schema_version" | "integrity_hash">): SourceExecutionRequestPlan {
  const schema_version = input.targets.some(target => target.request_policy.query === "FINITE_VALUES")
    ? "source-execution-request-plan/2.0.0" as const : SOURCE_EXECUTION_REQUEST_PLAN_SCHEMA_VERSION;
  const content = { schema_version, ...structuredClone(input) };
  const plan = { ...content, integrity_hash: canonicalHash(content) };
  assertSourceExecutionRequestPlan(plan);
  return plan;
}

export function assertSourceExecutionRequestPlan(plan: SourceExecutionRequestPlan) {
  const { integrity_hash: hash, ...content } = plan;
  if (![SOURCE_EXECUTION_REQUEST_PLAN_SCHEMA_VERSION, "source-execution-request-plan/2.0.0"].includes(plan.schema_version)
    || (plan.schema_version === SOURCE_EXECUTION_REQUEST_PLAN_SCHEMA_VERSION && plan.targets.some(target => target.request_policy.query !== "DENY"))
    || hash !== canonicalHash(content) || !plan.source_execution_id || !plan.source_artifact_id
    || !Number.isSafeInteger(plan.source_revision) || plan.source_revision < 1
    || !plan.endpoint_artifact_id || !plan.targets.length) throw new Error("SOURCE_REQUEST_PLAN_INTEGRITY_INVALID");
  const locators = new Set<string>();
  for (const target of plan.targets) {
    if (target.execution_disposition === "REQUESTED") {
      if (plan.schema_version !== "source-execution-request-plan/2.0.0" || !target.observations.length
        || target.abort_evidence || target.stop_evidence) throw new Error("SOURCE_REQUEST_PLAN_DISPOSITION_INVALID");
    } else if (target.execution_disposition === "SKIPPED_BY_BOUNDED_STOP") {
      const stop = target.stop_evidence;
      if (plan.schema_version !== "source-execution-request-plan/2.0.0" || target.observations.length || target.abort_evidence
        || !stop || !["EMPTY_PAGE_STOP", "REPEATED_CONTENT_BLOCKED", "MAX_PAGES_REACHED", "REQUEST_BUDGET_EXHAUSTED"].includes(stop.reason)
        || !/^[a-f0-9]{64}$/.test(stop.request_intent_hash) || stop.policy_reference !== target.allowlist_artifact_id
        || !plan.targets.slice(0, plan.targets.indexOf(target)).some(previous => previous.observations.length > 0)
        || Object.keys(stop).sort().join(",") !== "policy_reference,reason,request_intent_hash") throw new Error("SOURCE_REQUEST_PLAN_STOP_INVALID");
    } else if (target.execution_disposition !== undefined || target.abort_evidence !== undefined || target.stop_evidence !== undefined) {
      const abort = target.abort_evidence;
      const index = plan.targets.indexOf(target);
      if (plan.schema_version !== "source-execution-request-plan/2.0.0"
        || target.execution_disposition !== "NOT_REQUESTED_DUE_ABORT" || !abort
        || target.observations.length !== 0 || target.stop_evidence !== undefined
        || !plan.targets.slice(0, index).some(previous => previous.observations.length > 0)
        || abort.stage !== "BEFORE_RESERVATION"
        || !["AUTHORIZATION_REVOKED", "AUTHORIZATION_NOT_EFFECTIVE", "EXACT_REQUEST_DENIED",
          "REAUTHORIZE_REQUIRED", "REQUEST_PLAN_ABORTED", "RUN_ABORTED"].includes(abort.reason)
        || !/^[a-f0-9]{64}$/.test(abort.request_intent_hash)
        || !target.authorization_id || abort.authorization_reference !== target.authorization_id
        || abort.policy_reference !== target.allowlist_artifact_id
        || Object.keys(abort).sort().join(",") !== "authorization_reference,policy_reference,reason,request_intent_hash,stage") {
        throw new Error("SOURCE_REQUEST_PLAN_ABORT_INVALID");
      }
    }
    assertPlannedTargetPolicy(target);
    const parsed = new URL(target.exact_url);
    if (locators.has(target.exact_url) || !target.allowlist_entry_id || !target.allowlist_artifact_id
      || !target.source_admission_artifact_id || !target.endpoint_purpose
      || parsed.href !== target.exact_url || parsed.protocol !== "https:" || parsed.username || parsed.password
      || (parsed.search && target.request_policy.query === "DENY") || parsed.hash
      || (target.authorization_id === null && target.observations.length > 0)
      || target.observations.some(observation => !observation.request_attempt_id
        || !observation.acquisition_run_id || !observation.snapshot_id
        || (observation.raw_blob_id === null) !== (observation.raw_content_sha256 === null)
        || !["SUCCESS", "FAILED"].includes(observation.transport_status))
      ) {
      throw new Error("SOURCE_REQUEST_PLAN_TARGET_INVALID");
    }
    locators.add(target.exact_url);
  }
}

export function assertSourceExecutionRequestPlanBindings(plan: SourceExecutionRequestPlan,
  outcome: SourceExecutionOutcome, versions: readonly SourcePersistenceVersion[],
  records: readonly ContinuousRecord[], bundles: readonly AcquisitionPersistenceBundle[]) {
  assertSourceExecutionRequestPlan(plan);
  if (plan.schema_version === "source-execution-request-plan/2.0.0" && plan.targets.some(target => !target.execution_disposition)) {
    throw new Error("SOURCE_REQUEST_PLAN_DISPOSITION_MISSING");
  }
  const byId = new Map(versions.map(version => [version.artifact_id, version]));
  if (plan.source_execution_id !== outcome.source_execution_id
    || plan.source_definition_id !== outcome.source_definition_id
    || plan.recruitment_endpoint_id !== outcome.recruitment_endpoint_id
    || !outcome.source_version_ids.includes(plan.source_artifact_id)
    || !outcome.source_version_ids.includes(plan.endpoint_artifact_id)
    || byId.get(plan.source_artifact_id)?.artifact.kind !== "SOURCE_DEFINITION"
    || byId.get(plan.source_artifact_id)?.revision !== plan.source_revision
    || byId.get(plan.endpoint_artifact_id)?.artifact.kind !== "RECRUITMENT_ENDPOINT") {
    throw new Error("SOURCE_REQUEST_PLAN_UPSTREAM_MISMATCH");
  }
  const observations = plan.targets.flatMap(target => target.observations);
  if (canonicalSerialize(observations.map(item => item.acquisition_run_id)) !== canonicalSerialize(outcome.acquisition_run_ids)
    || canonicalSerialize(observations.map(item => item.request_attempt_id)) !== canonicalSerialize(outcome.request_attempt_ids)
    || canonicalSerialize(observations.map(item => item.snapshot_id)) !== canonicalSerialize(outcome.snapshot_ids)
    || canonicalSerialize(observations.flatMap(item => item.raw_blob_id ? [item.raw_blob_id] : [])) !== canonicalSerialize(outcome.raw_blob_ids)
    || canonicalSerialize(observations.flatMap(item => item.extracted_record_ids)) !== canonicalSerialize(outcome.extracted_record_ids)) {
    throw new Error("SOURCE_REQUEST_PLAN_OBSERVATION_MISMATCH");
  }
  const grants = new Map(records.filter(record => record.kind === "GRANT")
    .map(record => [record.payload.grant!.authorization_id, record.payload.grant!]));
  const reservations = new Map(records.filter(record => record.kind === "RESERVE")
    .map(record => [record.payload.attempt_id!, record]));
  const byRun = new Map(bundles.map(bundle => [bundle.acquisition_run.acquisition_run_id, bundle]));
  assertSourceExecutionAbortReservations(plan, records);
  const authorizedIds = plan.targets.flatMap(target => target.authorization_id ? [target.authorization_id] : []);
  if (new Set(authorizedIds).size !== authorizedIds.length
    || canonicalSerialize([...authorizedIds].sort()) !== canonicalSerialize([...outcome.continuous_authorization_ids].sort())) {
    throw new Error("SOURCE_REQUEST_PLAN_AUTHORIZATION_MISMATCH");
  }
  for (const target of plan.targets) {
    const version = byId.get(target.allowlist_artifact_id);
    const grant = target.authorization_id ? grants.get(target.authorization_id) : null;
    if (version?.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST") assertPlannedTargetAllowlist(target, version.artifact.payload);
    if (!version || version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST"
      || !version.artifact.payload.active || !version.artifact.payload.exact_path
      || version.artifact.payload.allowed_method !== "GET"
      || !outcome.source_version_ids.includes(version.artifact_id)
      || version.artifact.payload.allowlist_entry_id !== target.allowlist_entry_id
      || version.artifact.payload.source_admission_artifact_id !== target.source_admission_artifact_id
      || target.source_admission_artifact_id !== outcome.source_admission_artifact_id
      || version.artifact.payload.recruitment_endpoint_artifact_id !== plan.endpoint_artifact_id
      || version.artifact.payload.endpoint_purpose !== target.endpoint_purpose
      || (target.authorization_id !== null && (!grant
        || grant.canonical_payload.exact_endpoint !== target.exact_url
        || (target.request_policy.query === "FINITE_VALUES" && (grant.canonical_payload.request_contract_version !== "continuous-request/2.0.0"
          || grant.canonical_payload.query_contract_hash !== target.request_policy.query_contract_hash))
        || grant.canonical_payload.bindings.target.artifact_id !== target.allowlist_artifact_id
        || grant.canonical_payload.bindings.admission.artifact_id !== target.source_admission_artifact_id))) {
      throw new Error("SOURCE_REQUEST_PLAN_TARGET_BINDING_MISMATCH");
    }
    for (const observation of target.observations) {
      const reservation = reservations.get(observation.request_attempt_id);
      const bundle = byRun.get(observation.acquisition_run_id);
      if (!target.authorization_id || !reservation || !bundle
        || reservation.payload.authorization_id !== target.authorization_id
        || reservation.payload.target_key !== canonicalHash({ exact_url: target.exact_url, method: "GET" })
        || bundle.acquisition_run.request_metadata.locator !== target.exact_url
        || bundle.acquisition_run.allowlist_artifact_id !== target.allowlist_artifact_id
        || bundle.snapshot.snapshot_id !== observation.snapshot_id
        || (bundle.raw_blob_manifest?.raw_blob_id ?? null) !== observation.raw_blob_id
        || (bundle.raw_blob_manifest?.raw_content_sha256 ?? null) !== observation.raw_content_sha256
        || bundle.acquisition_run.status !== observation.transport_status
        || canonicalSerialize(bundle.extracted_records.map(record => record.extracted_record_id))
          !== canonicalSerialize(observation.extracted_record_ids)) {
        throw new Error("SOURCE_REQUEST_PLAN_OBSERVATION_BINDING_MISMATCH");
      }
    }
  }
}

export function assertSourceExecutionPaginationEvidence(plan: SourceExecutionRequestPlan, outcome: SourceExecutionOutcome,
  versions: readonly SourcePersistenceVersion[], bundles: readonly AcquisitionPersistenceBundle[],
  rawBytes: ReadonlyMap<string, Uint8Array>) {
  if (plan.schema_version !== "source-execution-request-plan/2.0.0") return;
  for (const target of plan.targets) {
    const stop = target.stop_evidence;
    if (!stop) continue;
    const version = versions.find(item => item.artifact_id === target.allowlist_artifact_id);
    const endpoint = versions.find(item => item.artifact_id === plan.endpoint_artifact_id);
    if (version?.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST" || version.artifact.payload.query_policy.mode !== "FINITE_VALUES"
      || endpoint?.artifact.kind !== "RECRUITMENT_ENDPOINT"
      || ![...outcome.reason_codes, ...(outcome.acquisition_evidence.assessment?.collection_reason_codes ?? [])].includes(stop.reason)) throw new Error("SOURCE_REQUEST_PLAN_STOP_EVIDENCE_INVALID");
    const contract = version.artifact.payload.query_policy.contract;
    const successful = bundles.filter(bundle => bundle.acquisition_run.status === "SUCCESS");
    const last = successful.at(-1);
    let proven = false;
    if (stop.reason === "EMPTY_PAGE_STOP" && last?.raw_blob_manifest && last.extracted_records.length === 0
      && last.raw_blob_manifest.content_type.toLowerCase().includes("json")) {
      const bytes = rawBytes.get(last.raw_blob_manifest.raw_blob_id);
      try {
        const content: unknown = bytes ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) : null;
        proven = !!content && typeof content === "object" && !Array.isArray(content)
          && Object.keys(content).length === 1 && "records" in content && Array.isArray(content.records) && content.records.length === 0;
      } catch { proven = false; }
    } else if (stop.reason === "REPEATED_CONTENT_BLOCKED" && last?.extracted_records.length) {
      const fingerprint = paginationContentFingerprint(last.extracted_records);
      proven = successful.slice(0, -1).some(bundle => bundle.extracted_records.length > 0
        && paginationContentFingerprint(bundle.extracted_records) === fingerprint);
    } else if (stop.reason === "MAX_PAGES_REACHED") {
      proven = successful.length >= Math.min(endpoint.artifact.payload.collection_config.max_pages ?? 1, contract.maximum_pages);
    } else if (stop.reason === "REQUEST_BUDGET_EXHAUSTED") {
      proven = bundles.length >= Math.min(contract.request_budget, (endpoint.artifact.payload.collection_config.max_pages ?? 1)
        * ((endpoint.artifact.payload.collection_config.retry_limit ?? 0) + 1));
    }
    if (!proven) throw new Error("SOURCE_REQUEST_PLAN_STOP_EVIDENCE_INVALID");
  }
}

export function assertSourceExecutionAbortReservations(plan: SourceExecutionRequestPlan, records: readonly ContinuousRecord[]) {
  assertSourceExecutionRequestPlan(plan);
  const reservations = new Map(records.filter(record => record.kind === "RESERVE")
    .map(record => [record.payload.attempt_id!, record]));
  const firstSequence = Math.min(...plan.targets.flatMap(target => target.observations)
    .map(observation => reservations.get(observation.request_attempt_id)?.sequence ?? Number.POSITIVE_INFINITY));
  const closed = new Set(records.filter(record => record.kind === "COMPLETE" || record.kind === "RECOVER")
    .map(record => record.payload.attempt_id));
  for (const target of plan.targets) {
    if (target.execution_disposition !== "NOT_REQUESTED_DUE_ABORT" && target.execution_disposition !== "SKIPPED_BY_BOUNDED_STOP") continue;
    const targetKey = canonicalHash({ exact_url: target.exact_url, method: "GET" });
    if (!Number.isFinite(firstSequence) || records.some(record => record.kind === "RESERVE"
      && record.payload.target_key === targetKey
      && (record.sequence >= firstSequence || !closed.has(record.payload.attempt_id)))) {
      throw new Error("SOURCE_REQUEST_PLAN_ABORT_RESERVATION_CONFLICT");
    }
  }
}

export function assertPlannedTargetPolicy(target: Pick<SourceExecutionPlannedTarget, "exact_url" | "request_policy">) {
  const policy = target.request_policy;
  if (policy.query === "DENY") {
    if (canonicalSerialize(policy) !== canonicalSerialize({ method: "GET", redirect: "DENY", query: "DENY" }) || new URL(target.exact_url).search) throw new Error("SOURCE_REQUEST_POLICY_INVALID");
    return;
  }
  const parsed = new URL(target.exact_url);
  if (policy.query !== "FINITE_VALUES" || policy.method !== "GET" || policy.redirect !== "DENY"
    || Object.keys(policy).sort().join(",") !== "method,query,query_contract_hash,redirect"
    || !/^[a-f0-9]{64}$/.test(policy.query_contract_hash) || parsed.href !== target.exact_url
    || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) throw new Error("SOURCE_REQUEST_POLICY_INVALID");
}

export function assertPlannedTargetAllowlist(target: Pick<SourceExecutionPlannedTarget, "exact_url" | "request_policy">, allowlist: OfficialEndpointAllowlist) {
  assertPlannedTargetPolicy(target);
  assertOfficialRequestAllowed(allowlist, target.exact_url, "GET");
  if (target.request_policy.query === "DENY") {
    if (canonicalSerialize(allowlist.query_policy) !== canonicalSerialize({ mode: "DENY_ALL", allowed_parameters: [] })) throw new Error("SOURCE_REQUEST_POLICY_BINDING_INVALID");
  } else if (allowlist.query_policy.mode !== "FINITE_VALUES" || allowlist.query_policy.contract.contract_hash !== target.request_policy.query_contract_hash) throw new Error("SOURCE_REQUEST_POLICY_BINDING_INVALID");
}
