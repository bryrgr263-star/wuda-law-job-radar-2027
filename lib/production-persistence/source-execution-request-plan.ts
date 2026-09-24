import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import type { SourceExecutionOutcome } from "./source-execution-outcome";
import type { AcquisitionPersistenceBundle, SourcePersistenceVersion } from "./contracts";
import type { ContinuousRecord } from "../application/source-admission/continuous-acquisition";

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
  readonly request_policy: { readonly method: "GET"; readonly redirect: "DENY"; readonly query: "DENY" };
  readonly observations: readonly SourceExecutionTargetObservation[];
}

export interface SourceExecutionRequestPlan {
  readonly schema_version: typeof SOURCE_EXECUTION_REQUEST_PLAN_SCHEMA_VERSION;
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
  const content = { schema_version: SOURCE_EXECUTION_REQUEST_PLAN_SCHEMA_VERSION, ...structuredClone(input) };
  const plan = { ...content, integrity_hash: canonicalHash(content) };
  assertSourceExecutionRequestPlan(plan);
  return plan;
}

export function assertSourceExecutionRequestPlan(plan: SourceExecutionRequestPlan) {
  const { integrity_hash: hash, ...content } = plan;
  if (plan.schema_version !== SOURCE_EXECUTION_REQUEST_PLAN_SCHEMA_VERSION
    || hash !== canonicalHash(content) || !plan.source_execution_id || !plan.source_artifact_id
    || !Number.isSafeInteger(plan.source_revision) || plan.source_revision < 1
    || !plan.endpoint_artifact_id || !plan.targets.length) throw new Error("SOURCE_REQUEST_PLAN_INTEGRITY_INVALID");
  const locators = new Set<string>();
  for (const target of plan.targets) {
    const parsed = new URL(target.exact_url);
    if (locators.has(target.exact_url) || !target.allowlist_entry_id || !target.allowlist_artifact_id
      || !target.source_admission_artifact_id || !target.endpoint_purpose
      || parsed.href !== target.exact_url || parsed.protocol !== "https:" || parsed.username || parsed.password
      || parsed.search || parsed.hash
      || (target.authorization_id === null && target.observations.length > 0)
      || target.observations.some(observation => !observation.request_attempt_id
        || !observation.acquisition_run_id || !observation.snapshot_id
        || (observation.raw_blob_id === null) !== (observation.raw_content_sha256 === null)
        || !["SUCCESS", "FAILED"].includes(observation.transport_status))
      || canonicalSerialize(target.request_policy) !== canonicalSerialize({ method: "GET", redirect: "DENY", query: "DENY" })) {
      throw new Error("SOURCE_REQUEST_PLAN_TARGET_INVALID");
    }
    locators.add(target.exact_url);
  }
}

export function assertSourceExecutionRequestPlanBindings(plan: SourceExecutionRequestPlan,
  outcome: SourceExecutionOutcome, versions: readonly SourcePersistenceVersion[],
  records: readonly ContinuousRecord[], bundles: readonly AcquisitionPersistenceBundle[]) {
  assertSourceExecutionRequestPlan(plan);
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
  const authorizedIds = plan.targets.flatMap(target => target.authorization_id ? [target.authorization_id] : []);
  if (new Set(authorizedIds).size !== authorizedIds.length
    || canonicalSerialize([...authorizedIds].sort()) !== canonicalSerialize([...outcome.continuous_authorization_ids].sort())) {
    throw new Error("SOURCE_REQUEST_PLAN_AUTHORIZATION_MISMATCH");
  }
  for (const target of plan.targets) {
    const version = byId.get(target.allowlist_artifact_id);
    const grant = target.authorization_id ? grants.get(target.authorization_id) : null;
    if (!version || version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST"
      || !version.artifact.payload.active || !version.artifact.payload.exact_path
      || version.artifact.payload.allowed_method !== "GET"
      || canonicalSerialize(version.artifact.payload.query_policy) !== canonicalSerialize({ mode: "DENY_ALL", allowed_parameters: [] })
      || !outcome.source_version_ids.includes(version.artifact_id)
      || version.artifact.payload.allowlist_entry_id !== target.allowlist_entry_id
      || version.artifact.payload.source_admission_artifact_id !== target.source_admission_artifact_id
      || target.source_admission_artifact_id !== outcome.source_admission_artifact_id
      || version.artifact.payload.recruitment_endpoint_artifact_id !== plan.endpoint_artifact_id
      || `${version.artifact.payload.scheme}://${version.artifact.payload.host}${version.artifact.payload.path_prefix}` !== target.exact_url
      || version.artifact.payload.endpoint_purpose !== target.endpoint_purpose
      || (target.authorization_id !== null && (!grant
        || grant.canonical_payload.exact_endpoint !== target.exact_url
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
