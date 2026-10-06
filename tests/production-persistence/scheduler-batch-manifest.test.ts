import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSchedulerBatchManifest,
  deriveSchedulerBatchStatus,
  deriveCurrentSchedulerBatchStatus,
  effectiveSourceExecutionStatus,
  readSchedulerBatchManifests,
  sealSchedulerBatchManifest
} from "../../lib/production-persistence/scheduler-batch-manifest";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { AT, createRemote, git, identity } from "./continuous-acquisition-fixture";

test("current cadence-only deferral is not failure and never masks safety failures", () => {
  assert.equal(deriveCurrentSchedulerBatchStatus([], ["CADENCE_DENIED"]), "DEFERRED");
  assert.equal(deriveCurrentSchedulerBatchStatus(["SUCCESS"], ["CADENCE_DENIED"]), "SUCCESS");
  assert.equal(deriveCurrentSchedulerBatchStatus(["FAILED"], ["CADENCE_DENIED"]), "FAILED");
  assert.equal(deriveCurrentSchedulerBatchStatus(["SUCCESS", "FAILED"], ["CADENCE_DENIED"]), "PARTIAL");
  assert.equal(deriveCurrentSchedulerBatchStatus([], ["AUTHORIZATION_REVOKED"]), "FAILED");
  assert.equal(deriveCurrentSchedulerBatchStatus(["SUCCESS"], ["PENDING_GATE_DENIED"]), "PARTIAL");
  assert.equal(deriveCurrentSchedulerBatchStatus([], []), "FAILED");
  assert.equal(deriveSchedulerBatchStatus([], 1), "FAILED");
});

test("v4 cadence deferral restores from Git while historical v1 bytes retain FAILED semantics", async () => {
  const repository = await createRemote();
  try {
    const parent = git(repository.remote, "rev-parse", "main");
    const base = { batch_id: "cadence-version-compatibility", initial_head: parent, manifest_parent: parent,
      started_at: AT, completed_at: AT, actor: "controlled-scheduler", source_executions: [],
      deferred_sources: [{ source_definition_id: "source", recruitment_endpoint_id: "endpoint",
        authorization_id: "authorization", reason: "CADENCE_DENIED" as const }],
      presentation_publish_readiness: "NO_NEW_MODEL" as const, public_website_published: false as const };
    const legacy = sealSchedulerBatchManifest({ ...base, scheduler_policy_version: "production-scheduler-batch/1.0.0", batch_status: "FAILED" });
    assert.equal(legacy.schema_version, "production-scheduler-batch/1.0.0");
    assert.throws(() => sealSchedulerBatchManifest({ ...base, scheduler_policy_version: "production-scheduler-batch/1.0.0", batch_status: "DEFERRED" }), /SEAL_INVALID/u);
    const current = sealSchedulerBatchManifest({ ...base, scheduler_policy_version: "production-scheduler-batch/4.0.0", batch_status: "DEFERRED" });
    appendSchedulerBatchManifest(repository.remote, "main", current, identity, [], []);
    const restored = await bootstrapZeroCostProductionCompositionRoot({ remote_url: repository.remote,
      branch: "main", stream_id: "cadence-version-compatibility" }).restore();
    assert.deepEqual(restored.scheduler_batches, [current]);
    assert.throws(() => sealSchedulerBatchManifest({ ...base, scheduler_policy_version: "production-scheduler-batch/4.0.0",
      deferred_sources: [{ ...base.deferred_sources[0]!, reason: "PENDING_GATE_DENIED" }], batch_status: "DEFERRED" }), /SEAL_INVALID/u);
  } finally { repository.remove(); }
});

test("batch status is derived only from retained source outcomes and deferrals", () => {
  assert.equal(deriveSchedulerBatchStatus(["SUCCESS", "NOT_MODIFIED", "CONFIRMED_EMPTY"], 0), "SUCCESS");
  assert.equal(deriveSchedulerBatchStatus(["SUCCESS", "FAILED"], 0), "PARTIAL");
  assert.equal(deriveSchedulerBatchStatus(["PARTIAL", "FAILED"], 0), "FAILED");
  assert.equal(deriveSchedulerBatchStatus(["SUCCESS"], 1), "PARTIAL");
  assert.equal(deriveSchedulerBatchStatus([], 1), "FAILED");
});

test("effective source status treats a trusted-chain failure as failure without changing acquisition evidence", () => {
  const outcome = { status: "SUCCESS", trusted_chain_status: "FAILED" } as Parameters<typeof effectiveSourceExecutionStatus>[0];
  assert.equal(effectiveSourceExecutionStatus(outcome), "FAILED");
  assert.equal(outcome.status, "SUCCESS");
  assert.equal(deriveSchedulerBatchStatus(["NOT_MODIFIED", effectiveSourceExecutionStatus(outcome)], 0), "PARTIAL");
  assert.equal(deriveSchedulerBatchStatus([effectiveSourceExecutionStatus(outcome)], 0), "FAILED");
});

test("v3 batch seal rejects a successful aggregate when its trusted-chain source failed", () => {
  const base = {
    batch_id: "trusted-failure-batch",
    scheduler_policy_version: "production-scheduler-batch/3.0.0" as const,
    initial_head: "a".repeat(40), manifest_parent: "a".repeat(40),
    started_at: AT, completed_at: AT, actor: "scheduler",
    source_executions: [{ source_definition_id: "source", recruitment_endpoint_id: "endpoint",
      authorization_id: "authorization", source_execution_id: "execution",
      result_commit: "b".repeat(40), outcome_status: "SUCCESS" as const,
      trusted_chain_status: "FAILED" as const, effective_status: "FAILED" as const,
      outcome_integrity_hash: "c".repeat(64), presentation_read_model_ids: [] }],
    deferred_sources: [], presentation_publish_readiness: "NO_NEW_MODEL" as const,
    public_website_published: false as const
  };
  assert.throws(() => sealSchedulerBatchManifest({ ...base, batch_status: "SUCCESS" }), /SEAL_INVALID/u);
  assert.throws(() => sealSchedulerBatchManifest({ ...base,
    source_executions: [{ ...base.source_executions[0]!, effective_status: "SUCCESS" as const }],
    batch_status: "SUCCESS" }), /SCHEMA_INVALID/u);
  const manifest = sealSchedulerBatchManifest({ ...base, batch_status: "FAILED" });
  assert.equal(manifest.schema_version, "production-scheduler-batch/3.0.0");
  assert.equal(manifest.source_executions[0]?.outcome_status, "SUCCESS");
  assert.equal(manifest.source_executions[0]?.effective_status, "FAILED");
});

test("append-only batch manifest is sealed, restart-readable, idempotent and collision-safe", async () => {
  const repository = await createRemote();
  try {
    const parent = git(repository.remote, "rev-parse", "main");
    const manifest = sealSchedulerBatchManifest({
      batch_id: "controlled-batch-manifest",
      scheduler_policy_version: "production-scheduler-batch/1.0.0",
      initial_head: parent,
      manifest_parent: parent,
      started_at: AT,
      completed_at: AT,
      actor: "controlled-scheduler",
      source_executions: [],
      deferred_sources: [],
      batch_status: "FAILED",
      presentation_publish_readiness: "NO_NEW_MODEL",
      public_website_published: false
    });
    const first = appendSchedulerBatchManifest(repository.remote, "main", manifest, identity, [], []);
    assert.notEqual(first, parent);
    assert.equal(appendSchedulerBatchManifest(repository.remote, "main", manifest, identity, [], []), first);
    const checkout = repository.clone();
    assert.deepEqual(readSchedulerBatchManifests(checkout, [], []), [manifest]);
    const processB = await bootstrapZeroCostProductionCompositionRoot({
      remote_url: repository.remote, branch: "main", stream_id: "scheduler-batch-test"
    }).restore();
    assert.deepEqual(processB.scheduler_batches, [manifest]);
    const collision = sealSchedulerBatchManifest({ ...manifest, actor: "different-actor" });
    assert.throws(() => appendSchedulerBatchManifest(repository.remote, "main", collision, identity, [], []), /COLLISION/u);
  } finally { repository.remove(); }
});

test("batch manifest rejects duplicate authorization coverage and incomplete source references", () => {
  const parent = "a".repeat(40);
  const reference = {
    source_definition_id: "controlled-source",
    recruitment_endpoint_id: "controlled-endpoint",
    authorization_id: "controlled-authorization",
    source_execution_id: "controlled-execution-a",
    result_commit: "b".repeat(40),
    outcome_status: "SUCCESS" as const,
    outcome_integrity_hash: "c".repeat(64),
    presentation_read_model_ids: []
  };
  const input = {
    batch_id: "controlled-invalid-batch",
    scheduler_policy_version: "production-scheduler-batch/1.0.0" as const,
    initial_head: parent,
    manifest_parent: parent,
    started_at: AT,
    completed_at: AT,
    actor: "controlled-scheduler",
    source_executions: [reference, { ...reference, source_execution_id: "controlled-execution-b" }],
    deferred_sources: [],
    batch_status: "SUCCESS" as const,
    presentation_publish_readiness: "NO_NEW_MODEL" as const,
    public_website_published: false as const
  };
  assert.throws(() => sealSchedulerBatchManifest(input), /DUPLICATE_SOURCE/u);
  assert.throws(() => sealSchedulerBatchManifest({ ...input,
    source_executions: [{ ...reference, result_commit: "" }] }), /SCHEMA_INVALID/u);
  assert.throws(() => sealSchedulerBatchManifest({ ...input,
    source_executions: [reference], deferred_sources: [{ source_definition_id: reference.source_definition_id,
      recruitment_endpoint_id: reference.recruitment_endpoint_id,
      authorization_id: reference.authorization_id, reason: "CADENCE_DENIED" as const }],
    batch_status: "PARTIAL" }), /DUPLICATE_SOURCE/u);
  assert.throws(() => sealSchedulerBatchManifest({ ...input, source_executions: [reference],
    started_at: "2026-09-18T00:01:00.000Z", completed_at: AT }), /TIME_INVALID/u);
});
