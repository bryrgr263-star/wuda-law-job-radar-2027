import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { sealSourceExecutionRequestPlan, assertSourceExecutionAbortReservations } from "../../lib/production-persistence/source-execution-request-plan";
import { sealSourceExecutionRequestIntent } from "../../lib/production-persistence/source-execution-request-intent";
import { queryContext } from "./continuous-acquisition-fixture";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { issueContinuousRecord, reserveContinuousRecord, closeContinuousRecord } from "../../lib/application/source-admission/continuous-acquisition";
import { AT, request } from "./continuous-acquisition-fixture";

test("query intent and plan use explicit v2 schema while historical plans keep v1 bytes", () => {
  const context = queryContext();
  const contractHash = context.admission.continuous_acquisition_scope!.exact_targets[0]!.query_contract_hash!;
  const target = { allowlist_entry_id: context.bindings.target.id, allowlist_artifact_id: context.bindings.target.artifact_id,
    exact_url: context.admission.continuous_acquisition_scope!.exact_targets[0]!.exact_url, authorization_id: "controlled-grant",
    source_admission_artifact_id: context.bindings.admission.artifact_id, endpoint_purpose: "JOB_LIST",
    request_policy: { method: "GET" as const, redirect: "DENY" as const, query: "FINITE_VALUES" as const, query_contract_hash: contractHash } };
  const input = { source_execution_id: "controlled-query-plan", source_definition_id: context.source.source_definition_id,
    source_artifact_id: context.bindings.source.artifact_id, source_revision: 1, recruitment_endpoint_id: context.endpoint.recruitment_endpoint_id,
    endpoint_artifact_id: context.bindings.endpoint.artifact_id };
  const intent = sealSourceExecutionRequestIntent({ ...input, source_admission_artifact_id: context.bindings.admission.artifact_id, targets: [target] });
  const plan = sealSourceExecutionRequestPlan({ ...input, targets: [{ ...target, observations: [] }] });
  assert.equal(intent.schema_version, "source-execution-request-intent/2.0.0");
  assert.equal(plan.schema_version, "source-execution-request-plan/2.0.0");
  const oldTarget = { ...target, exact_url: "https://example.invalid/recruitment", request_policy: { method: "GET" as const, redirect: "DENY" as const, query: "DENY" as const } };
  const historical = sealSourceExecutionRequestPlan({ ...input, targets: [{ ...oldTarget, observations: [] }] });
  assert.equal(historical.schema_version, "source-execution-request-plan/1.0.0");
  assert.equal(canonicalSerialize(historical).includes("query_contract_hash"), false);
});

test("query abort disposition requires prior observations, a sealed intent binding and no fabricated observation", () => {
  const context = queryContext();
  const contractHash = context.admission.continuous_acquisition_scope!.exact_targets[0]!.query_contract_hash!;
  const target = { allowlist_entry_id: context.bindings.target.id, allowlist_artifact_id: context.bindings.target.artifact_id,
    exact_url: context.admission.continuous_acquisition_scope!.exact_targets[0]!.exact_url, authorization_id: "controlled-grant",
    source_admission_artifact_id: context.bindings.admission.artifact_id, endpoint_purpose: "JOB_LIST",
    request_policy: { method: "GET" as const, redirect: "DENY" as const, query: "FINITE_VALUES" as const, query_contract_hash: contractHash } };
  const input = { source_execution_id: "controlled-query-abort", source_definition_id: context.source.source_definition_id,
    source_artifact_id: context.bindings.source.artifact_id, source_revision: 1, recruitment_endpoint_id: context.endpoint.recruitment_endpoint_id,
    endpoint_artifact_id: context.bindings.endpoint.artifact_id };
  const observation = { request_attempt_id: "attempt-1", acquisition_run_id: "run-1", snapshot_id: "snapshot-1",
    raw_blob_id: null, raw_content_sha256: null, extracted_record_ids: [], transport_status: "FAILED" as const };
  const later = { ...target, exact_url: context.admission.continuous_acquisition_scope!.exact_targets[1]!.exact_url,
    authorization_id: "controlled-grant-2", observations: [], execution_disposition: "NOT_REQUESTED_DUE_ABORT" as const,
    abort_evidence: { reason: "AUTHORIZATION_REVOKED" as const, stage: "BEFORE_RESERVATION" as const,
      request_intent_hash: "a".repeat(64), authorization_reference: "controlled-grant-2",
      policy_reference: context.bindings.target.artifact_id } };
  const plan = sealSourceExecutionRequestPlan({ ...input, targets: [{ ...target, observations: [observation] }, later] });
  assert.equal(plan.targets[1]!.execution_disposition, "NOT_REQUESTED_DUE_ABORT");
  assert.throws(() => sealSourceExecutionRequestPlan({ ...input, targets: [later] }), /ABORT/);
  assert.throws(() => sealSourceExecutionRequestPlan({ ...input, targets: [{ ...target, observations: [observation] },
    { ...later, observations: [observation] }] }), /ABORT/);
  assert.throws(() => sealSourceExecutionRequestPlan({ ...input, targets: [{ ...target, observations: [observation] },
    { ...later, abort_evidence: { ...later.abort_evidence, authorization_reference: "wrong" } }] }), /ABORT/);
  const grant = issueContinuousRecord([], context, { effective_from: AT, min_interval_seconds: 60,
    actor: "controlled-reviewer", issued_at: AT });
  const reserve = reserveContinuousRecord([grant], grant.payload.grant!.authorization_id, context,
    { ...request, locator: target.exact_url }, "attempt-1", "holder", AT, "CONTROLLED_TEST");
  const complete = closeContinuousRecord([grant, reserve], "attempt-1", "holder", AT, "FAILED");
  assert.doesNotThrow(() => assertSourceExecutionAbortReservations(plan, [grant, reserve, complete]));
  assert.throws(() => assertSourceExecutionAbortReservations(plan, []), /ABORT_RESERVATION/);
  const conflicting = { ...reserve, sequence: complete.sequence + 1, payload: { ...reserve.payload,
    attempt_id: "attempt-later", target_key: canonicalHash({ exact_url: later.exact_url, method: "GET" }) } };
  assert.throws(() => assertSourceExecutionAbortReservations(plan, [grant, reserve, complete, conflicting]), /ABORT_RESERVATION/);
  const closedConflict = { ...complete, sequence: conflicting.sequence + 1,
    payload: { ...complete.payload, attempt_id: "attempt-later" } };
  assert.throws(() => assertSourceExecutionAbortReservations(plan, [grant, reserve, complete, conflicting, closedConflict]), /ABORT_RESERVATION/);
});
