import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createIncidentContinuousFencingEvidence, validateIncidentContinuousFencingEvidence,
  type IncidentContinuousFencingContext } from "../../lib/production-persistence/continuous-fencing-evidence";

function fixture(): IncidentContinuousFencingContext {
  return {
    historical_parent: "f40714dc001994ca140df6002138c09aa5be223b",
    reserve: {
      schema_version: "continuous-admission-record/1.0.0", kind: "RESERVE", sequence: 70,
      previous_hash: "b772df7af128ce90024db274e3f6a5244839d87b6a6170c1ce4910114bea4d0b",
      record_id: "continuous-record:RESERVE:7164ac19cbf8760ba4811da0982adef49dba7ac2d5bc1bf83f626ea57dd779f7",
      integrity_hash: "91a59c623fd4a7030500d47f08ac188ceeeb7d1c2212c3f4cc0ed5683de86e77",
      payload: { at: "2026-10-09T09:14:40.511Z", attempt_id: "continuous-attempt:bccb61fd-fdb9-4ffa-a901-69cacbe35638",
        authorization_id: "continuous-authorization:1e951b695ba4fda327be01bf32950f51b8e675716a1c05871c8aee417afce8fc",
        authorization_version: 1, holder: "continuous-holder:2e85d240-8620-4407-8796-7e1d1ee1f7ac",
        target_key: "ced21121bf008a721253971b5362c1e7301481731d193a2d95277fec95379d20", min_interval_seconds: 86400 }
    },
    intent: { integrity_hash: "8169698d98f484c03a8d8963d71368f8db2af77eaf31fc8e908f364719d8bd49",
      source_execution_id: "scheduler-source:b11f252b67a074cdc98beacdba3d0dc9ba4e9a9a78b684522314d9a0bd8c98ab",
      authorization_id: "continuous-authorization:1e951b695ba4fda327be01bf32950f51b8e675716a1c05871c8aee417afce8fc",
      exact_url: "https://zhaopin.chnenergy.com.cn/annc/showgw?id=5a798bfe-a4d6-0be4-e063-98b4d40a088a",
      introducing_commit: "804e221ed9f49ef94c959110a32157d804768831", reserve_commit: "57ebf594af3b1019552edae25e9d9cd639aa48bb" },
    executor: { repository: "bryrgr263-star/wuda-law-job-radar-2027", run_id: "37909786610", job_id: "113751898178",
      run_attempt: 1, batch_id: "github-actions:37909786610:1", status: "completed", conclusion: "failure",
      completed_at: "2026-10-09T09:20:00.000Z", reservation_commit: "57ebf594af3b1019552edae25e9d9cd639aa48bb",
      source_execution_id: "scheduler-source:b11f252b67a074cdc98beacdba3d0dc9ba4e9a9a78b684522314d9a0bd8c98ab" },
    approval: { reference: "TEST_ONLY:independently-verified-user-approval", approved_at: "2026-10-10T00:00:00.000Z",
      attempt_id: "continuous-attempt:bccb61fd-fdb9-4ffa-a901-69cacbe35638", action: "RECOVER_FENCED_UNKNOWN" }
  };
}

function reseal(value: Record<string, unknown>) {
  const { integrity_hash, ...content } = value;
  return { ...content, integrity_hash: canonicalHash(content) };
}

test("incident primitive binds independently supplied facts and preserves UNKNOWN without mutating reserve", () => {
  const context = fixture();
  const before = structuredClone(context);
  const proof = createIncidentContinuousFencingEvidence(context);
  assert.equal(proof.actual_send, "UNKNOWN");
  assert.deepEqual(validateIncidentContinuousFencingEvidence(proof, context), proof);
  assert.deepEqual(context, before);
  assert.equal(context.reserve.kind, "RESERVE");
  assert.equal("http_status" in proof, false);
});

test("even matching context claims cannot substitute another incident history", () => {
  const context = fixture();
  assert.throws(() => createIncidentContinuousFencingEvidence({ ...context,
    intent: { ...context.intent, introducing_commit: "0".repeat(40) } }));
  assert.throws(() => createIncidentContinuousFencingEvidence({ ...context,
    intent: { ...context.intent, reserve_commit: "0".repeat(40) },
    executor: { ...context.executor, reservation_commit: "0".repeat(40) } }));
});

test("missing module contract inputs and bare termination flags cannot prove fencing", () => {
  const context = fixture();
  for (const proof of [null, {}, { terminated: true }, { schema_version: "unsupported" }]) {
    assert.throws(() => validateIncidentContinuousFencingEvidence(proof, context));
  }
  for (const key of ["reserve", "intent", "executor", "approval", "historical_parent"] as const) {
    const altered = structuredClone(context) as unknown as Record<string, unknown>;
    delete altered[key];
    assert.throws(() => createIncidentContinuousFencingEvidence(altered as unknown as IncidentContinuousFencingContext));
  }
});

test("re-sealed forged references and invented observations are refused", () => {
  const context = fixture();
  const proof = createIncidentContinuousFencingEvidence(context);
  for (const change of [
    { attempt_id: "wrong" }, { reserve_integrity_hash: "0".repeat(64) }, { holder: "wrong" },
    { authorization_id: "wrong" }, { target_key: "0".repeat(64) }, { min_interval_seconds: 0 },
    { intent_integrity_hash: "0".repeat(64) }, { source_execution_id: "wrong" },
    { historical_parent: "0".repeat(40) }, { actual_send: "SUCCESS" }, { terminated: true }, { http_status: 200 },
    { executor: { ...context.executor, job_id: "wrong" } },
    { approval: { ...context.approval, reference: "caller-invented" } }
  ]) assert.throws(() => validateIncidentContinuousFencingEvidence(reseal({ ...proof, ...change }), context));
});

test("context rejects running executor wrong incident association and absent approval authority", () => {
  const context = fixture();
  for (const executor of [
    { ...context.executor, status: "in_progress" }, { ...context.executor, repository: "wrong/repo" },
    { ...context.executor, run_id: "wrong" }, { ...context.executor, job_id: "wrong" },
    { ...context.executor, batch_id: "github-actions:37909786610:2" },
    { ...context.executor, reservation_commit: "0".repeat(40) },
    { ...context.executor, source_execution_id: "wrong" }
  ]) assert.throws(() => createIncidentContinuousFencingEvidence({ ...context, executor } as IncidentContinuousFencingContext));
  for (const approval of [undefined, { ...context.approval, action: "COMPLETE" },
    { ...context.approval, attempt_id: "wrong" }, { ...context.approval, reference: "" },
    { ...context.approval, approved_at: "2026-10-08T00:00:00.000Z" }]) {
    assert.throws(() => createIncidentContinuousFencingEvidence({ ...context, approval } as IncidentContinuousFencingContext));
  }
});
