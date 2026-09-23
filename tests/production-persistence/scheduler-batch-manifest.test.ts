import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSchedulerBatchManifest,
  deriveSchedulerBatchStatus,
  readSchedulerBatchManifests,
  sealSchedulerBatchManifest
} from "../../lib/production-persistence/scheduler-batch-manifest";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { AT, createRemote, git, identity } from "./continuous-acquisition-fixture";

test("batch status is derived only from retained source outcomes and deferrals", () => {
  assert.equal(deriveSchedulerBatchStatus(["SUCCESS", "NOT_MODIFIED", "CONFIRMED_EMPTY"], 0), "SUCCESS");
  assert.equal(deriveSchedulerBatchStatus(["SUCCESS", "FAILED"], 0), "PARTIAL");
  assert.equal(deriveSchedulerBatchStatus(["PARTIAL", "FAILED"], 0), "FAILED");
  assert.equal(deriveSchedulerBatchStatus(["SUCCESS"], 1), "PARTIAL");
  assert.equal(deriveSchedulerBatchStatus([], 1), "FAILED");
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
