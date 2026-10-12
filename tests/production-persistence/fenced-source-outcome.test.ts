import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertFencedUnknownSourceOutcomeBinding, createFencedUnknownSourceExecutionOutcome, writeSourceExecutionOutcome } from "../../lib/production-persistence/source-execution-outcome";
import { closeContinuousRecord, type ContinuousRecord } from "../../lib/application/source-admission/continuous-acquisition";
import { canonicalDeserialize, canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createIncidentContinuousFencingEvidence, validateIncidentContinuousFencingEvidence,
  type IncidentContinuousFencingContext } from "../../lib/production-persistence/continuous-fencing-evidence";
import type { SourceExecutionRequestIntent } from "../../lib/production-persistence/source-execution-request-intent";

test("a caller termination flag cannot manufacture a fenced source outcome", () => {
  assert.throws(() => createFencedUnknownSourceExecutionOutcome({
    terminated: true,
    source_execution_id: "scheduler-source:TEST_ONLY",
    status: "SUCCESS",
    http_status: 200
  } as never), /FENCED_SOURCE_OUTCOME_CONTEXT_REQUIRED/);
});

test("missing reserve, verified recovery and committed witness fail before outcome creation", () => {
  for (const context of [null, {}, { reserve: {} }, { reserve: {}, recovery: {} }]) {
    assert.throws(() => createFencedUnknownSourceExecutionOutcome(context as never),
      /FENCED_SOURCE_OUTCOME_CONTEXT_REQUIRED/);
  }
});

test("an independently validated test recovery preserves unknown send and creates no acquisition facts", () => {
  const decode = <Value>(relative: string) => canonicalDeserialize(readFileSync(path.resolve(relative), "utf8")) as Value;
  const state = decode<{ continuous_records: readonly { path: string }[] }>("production-source-state/state/current.json");
  const records = state.continuous_records.map(reference => decode<ContinuousRecord>(reference.path));
  const reserve = records.find(record => record.kind === "RESERVE"
    && record.payload.attempt_id === "continuous-attempt:bccb61fd-fdb9-4ffa-a901-69cacbe35638")!;
  assert.ok(reserve);
  const sourceExecution = "scheduler-source:b11f252b67a074cdc98beacdba3d0dc9ba4e9a9a78b684522314d9a0bd8c98ab";
  const intent = decode<SourceExecutionRequestIntent>(`production-runs/source-request-intents/${canonicalHash({ source_execution_id: sourceExecution })}.json`);
  const parent = "f40714dc001994ca140df6002138c09aa5be223b";
  const reserveCommit = "57ebf594af3b1019552edae25e9d9cd639aa48bb";
  const fencingContext: IncidentContinuousFencingContext = {
    historical_parent: parent, reserve,
    intent: { integrity_hash: intent.integrity_hash, source_execution_id: sourceExecution,
      authorization_id: reserve.payload.authorization_id!, exact_url: intent.targets[0]!.exact_url,
      introducing_commit: "804e221ed9f49ef94c959110a32157d804768831", reserve_commit: reserveCommit },
    executor: { repository: "bryrgr263-star/wuda-law-job-radar-2027", run_id: "37909786610", job_id: "113751898178",
      run_attempt: 1, batch_id: "github-actions:37909786610:1", status: "completed", conclusion: "failure",
      completed_at: "2026-10-09T09:15:22.000Z", reservation_commit: reserveCommit, source_execution_id: sourceExecution },
    approval: { reference: "TEST_ONLY:controlled-fenced-outcome", approved_at: "2026-10-10T06:22:00.000Z",
      attempt_id: reserve.payload.attempt_id!, action: "RECOVER_FENCED_UNKNOWN" }
  };
  const proof = createIncidentContinuousFencingEvidence(fencingContext);
  const prefix = records.filter(record => record.sequence <= reserve.sequence);
  const before = structuredClone(prefix);
  const recovered = closeContinuousRecord(prefix, reserve.payload.attempt_id!, reserve.payload.holder!,
    "2026-10-10T07:00:00.000Z", "FENCED_UNKNOWN", proof as unknown as Readonly<Record<string, unknown>>,
    (pending, evidence) => {
      assert.deepEqual(pending, reserve);
      validateIncidentContinuousFencingEvidence(evidence, fencingContext);
      return true;
    });
  const context = { intent, reserve, recovered, fencing_context: fencingContext, expected_parent: parent };
  const outcome = createFencedUnknownSourceExecutionOutcome(context);
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.trusted_chain_status, "NOT_RUN");
  assert.equal(outcome.fenced_recovery.actual_send, "UNKNOWN");
  assert.deepEqual(outcome.acquisition_run_ids, []);
  assert.deepEqual(outcome.snapshot_ids, []);
  assert.deepEqual(outcome.raw_blob_ids, []);
  assert.deepEqual(outcome.extracted_record_ids, []);
  assert.deepEqual(prefix, before);
  assert.throws(() => createFencedUnknownSourceExecutionOutcome({ ...context,
    intent: { ...intent, source_execution_id: "wrong-execution" } }), /FENCED_SOURCE_OUTCOME_UPSTREAM_MISMATCH/);
  assert.throws(() => createFencedUnknownSourceExecutionOutcome({ ...context,
    recovered: reserve }), /FENCING|FENCED/);
  const repository = mkdtempSync(path.join(tmpdir(), "fso-TEST_ONLY-"));
  assert.doesNotThrow(() => writeSourceExecutionOutcome(repository, outcome));
  const { integrity_hash: originalHash, ...originalContent } = outcome;
  assert.ok(originalHash);
  const forgedContent = { ...originalContent,
    fenced_recovery: { ...originalContent.fenced_recovery, actual_send: "REQUESTED" } };
  assert.throws(() => writeSourceExecutionOutcome(repository, { ...forgedContent,
    integrity_hash: canonicalHash(forgedContent) } as never), /FENCED_SOURCE_OUTCOME_SCHEMA_INVALID/);
  const stored = decode<unknown>(path.join(repository, "production-runs", "source-executions",
    `${canonicalHash({ source_execution_id: sourceExecution })}.json`));
  assert.deepEqual(stored, outcome);
  assert.throws(() => assertFencedUnknownSourceOutcomeBinding(repository, outcome, [], [...prefix, recovered]),
    /FENCED_SOURCE_OUTCOME_COMMITTED_CONTEXT_REQUIRED/);
});
