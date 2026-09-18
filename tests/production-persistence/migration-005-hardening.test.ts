import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertTrustedRestorationExecution,
  createTrustedRestorationRecord,
  TRUSTED_RESTORATION_RECORD_SCHEMA_VERSION,
  type TrustedRestorationArtifactEnvelope,
  type TrustedRestorationExecution,
  type TrustedRestorationRecord
} from "../../lib/ingestion";
import {
  canonicalHash,
  canonicalSerialize
} from "../../lib/ingestion/normalization/canonical-artifact-registry";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.join(
  repositoryRoot,
  "production",
  "persistence",
  "migrations",
  "005_atomic_command_journal.up.sql"
);

test("Migration 005 rejects NULL-unsafe journal and checkpoint continuity", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /checkpoint->>'previous_checkpoint_hash' is not null/iu);
  assert.match(sql, /checkpoint->>'previous_checkpoint_hash' is distinct from previous_hash/iu);
  assert.match(sql, /if head\.current_sequence = 0 then[\s\S]+previous_record_hash' is not null[\s\S]+else[\s\S]+previous_record_hash' is null[\s\S]+previous_record_hash' is distinct from head\.current_hash/iu);
  assert.doesNotMatch(sql, /previous_(?:record|checkpoint)_hash'\s*<>/iu);

  const hash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  assert.equal(previousHashAccepted(true, null, null), true);
  assert.equal(previousHashAccepted(false, hash, null), false);
  assert.equal(previousHashAccepted(false, null, hash), false);
  assert.equal(previousHashAccepted(true, null, hash), false);
  assert.equal(previousHashAccepted(false, hash, otherHash), false);
  assert.equal(previousHashAccepted(false, hash, hash), true);
});

test("Migration 005 requires unique bidirectionally equal artifact sets", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /actual_count <> actual_distinct_count/iu);
  assert.match(sql, /expected_count <> expected_distinct_count/iu);
  assert.match(sql, /actual_count <> expected_count/iu);
  assert.match(sql, /Artifact envelopes must be unique/u);
  assert.match(sql, /Expected artifact seals must be unique/u);
  assert.match(sql, /Artifact set cardinality mismatch/u);
  assert.match(sql, /jsonb_array_elements\(record->'expected_artifacts'\)[\s\S]+where not exists[\s\S]+jsonb_array_elements\(execution->'artifact_envelopes'\)/iu);
  assert.match(sql, /jsonb_array_elements\(execution->'artifact_envelopes'\)[\s\S]+where not exists[\s\S]+jsonb_array_elements\(record->'expected_artifacts'\)/iu);

  const fixture = executionFixture();
  assert.doesNotThrow(() => assertTrustedRestorationExecution(fixture.execution));
  assert.doesNotThrow(() => assertTrustedRestorationExecution({
    ...fixture.execution,
    artifact_envelopes: [...fixture.execution.artifact_envelopes].reverse()
  }));
  assert.doesNotThrow(() => assertTrustedRestorationExecution({
    ...fixture.execution,
    record: resealRecord({
      ...fixture.execution.record,
      expected_artifacts: [...fixture.execution.record.expected_artifacts].reverse()
    })
  }));

  assert.throws(() => assertTrustedRestorationExecution({
    ...fixture.execution,
    artifact_envelopes: [fixture.firstEnvelope]
  }), /do not match restoration seals/iu);
  assert.throws(() => assertTrustedRestorationExecution({
    ...fixture.execution,
    artifact_envelopes: [
      ...fixture.execution.artifact_envelopes,
      createEnvelope("artifact-extra", "extra", fixture.execution.record.provenance)
    ]
  }), /do not match restoration seals/iu);
  assert.throws(() => assertTrustedRestorationExecution({
    ...fixture.execution,
    artifact_envelopes: [fixture.firstEnvelope, fixture.firstEnvelope]
  }), /do not match restoration seals/iu);
  assert.throws(() => assertTrustedRestorationExecution({
    ...fixture.execution,
    record: resealRecord({
      ...fixture.execution.record,
      expected_artifacts: [
        fixture.execution.record.expected_artifacts[0]!,
        fixture.execution.record.expected_artifacts[0]!
      ]
    })
  }), /must be unique/iu);
  assert.throws(() => assertTrustedRestorationExecution({
    ...fixture.execution,
    artifact_envelopes: [{ ...fixture.secondEnvelope, canonical_bytes: "{}" }, fixture.firstEnvelope]
  }), /canonical hash mismatch/iu);
  assert.throws(() => assertTrustedRestorationExecution({
    ...fixture.execution,
    artifact_envelopes: [
      fixture.firstEnvelope,
      createEnvelope(fixture.secondEnvelope.artifact_id, "changed", fixture.execution.record.provenance)
    ]
  }), /do not match restoration seals/iu);
});

test("Migration 005 separates execution identity from writer fencing", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const staleCheck = sql.indexOf("head.writer_epoch is distinct from epoch");
  const existingLookup = sql.indexOf("select execution_json into existing_execution");

  assert.ok(staleCheck >= 0 && existingLookup > staleCheck);
  assert.match(sql, /execution - 'writer_epoch' - 'record_integrity_bytes'/iu);
  assert.match(sql, /\(execution->'record'\) - 'integrity_hash'/iu);
  assert.match(sql, /jsonb_agg\(envelope\.value order by[\s\S]+artifact_kind[\s\S]+artifact_id/iu);
  assert.match(sql, /existing_execution_identity = incoming_execution_identity/iu);
  assert.doesNotMatch(sql, /existing_execution\s*=\s*execution/iu);

  const fixture = executionFixture();
  const journal = new OfflineAtomicAppendContract(7);
  const epochSeven = executionPayload(7, fixture.execution);
  assert.equal(journal.append(epochSeven), "APPENDED");
  assert.equal(journal.append(epochSeven), "IDEMPOTENT_REUSE");

  journal.acquireWriterEpoch();
  assert.throws(() => journal.append(epochSeven), /STALE_WRITER/iu);
  assert.equal(journal.append(executionPayload(8, {
    ...fixture.execution,
    artifact_envelopes: [...fixture.execution.artifact_envelopes].reverse()
  })), "IDEMPOTENT_REUSE");

  const conflictingRecord = resealRecord({
    ...fixture.execution.record,
    result_hash: "f".repeat(64)
  });
  assert.throws(() => journal.append(executionPayload(8, {
    ...fixture.execution,
    record: conflictingRecord
  })), /COLLISION/iu);

  const unrelated = executionFixture(2, fixture.execution.record.integrity_hash);
  assert.equal(journal.append(executionPayload(8, unrelated.execution)), "APPENDED");
});

test("offline transaction model preserves crash-before and crash-after retry semantics", () => {
  const fixture = executionFixture();
  const beforeCommit = new OfflineAtomicAppendContract(4);
  const firstPayload = executionPayload(4, fixture.execution);
  assert.throws(() => beforeCommit.append(firstPayload, "BEFORE_COMMIT"), /CRASH_BEFORE_COMMIT/iu);
  beforeCommit.acquireWriterEpoch();
  assert.equal(beforeCommit.append(executionPayload(5, fixture.execution)), "APPENDED");

  const afterCommit = new OfflineAtomicAppendContract(9);
  assert.throws(() => afterCommit.append(executionPayload(9, fixture.execution), "AFTER_COMMIT"),
    /CRASH_AFTER_COMMIT/iu);
  afterCommit.acquireWriterEpoch();
  assert.equal(afterCommit.append(executionPayload(10, fixture.execution)), "IDEMPOTENT_REUSE");
});

function previousHashAccepted(
  genesis: boolean,
  expected: string | null,
  actual: string | null
) {
  if (genesis) return expected === null && actual === null;
  return expected !== null && actual !== null && expected === actual;
}

function executionFixture(sequence = 1, previousRecordHash: string | null = null) {
  const provenance = {
    scope: "SYNTHETIC_TEST" as const,
    actor: "migration-005-hardening",
    recorded_at: "2026-09-15T00:00:00.000Z"
  };
  const firstEnvelope = createEnvelope("artifact-a", "alpha", provenance);
  const secondEnvelope = createEnvelope("artifact-b", "beta", provenance);
  const record = createTrustedRestorationRecord({
    sequence,
    previous_record_hash: previousRecordHash,
    command_kind: "TEST_ARTIFACT_SET",
    command: { kind: "TEST_ARTIFACT_SET", sequence },
    result: { artifact_ids: [firstEnvelope.artifact_id, secondEnvelope.artifact_id] },
    expected_artifacts: [firstEnvelope, secondEnvelope].map((envelope) => ({
      artifact_kind: envelope.artifact_kind,
      artifact_id: envelope.artifact_id,
      content_hash: envelope.seal
    })),
    provenance
  });
  const execution: TrustedRestorationExecution = {
    record,
    artifact_envelopes: [firstEnvelope, secondEnvelope],
    read_model_projection: null
  };
  return { execution, firstEnvelope, secondEnvelope };
}

function createEnvelope(
  artifactId: string,
  value: string,
  provenance: TrustedRestorationRecord["provenance"]
): TrustedRestorationArtifactEnvelope {
  const artifact = { artifact_id: artifactId, value };
  const canonicalBytes = canonicalSerialize(artifact);
  const withoutIntegrity = {
    artifact_type: "OPPORTUNITY_CANDIDATE" as const,
    artifact_kind: "OPPORTUNITY_CANDIDATE",
    artifact_id: artifactId,
    stream_id: artifactId,
    revision: null,
    supersedes_artifact_id: null,
    schema_version: "migration-005-hardening/1",
    canonical_bytes: canonicalBytes,
    artifact_hash: canonicalHash(artifact),
    seal: canonicalHash(artifact),
    scope: provenance.scope,
    provenance,
    created_at: provenance.recorded_at,
    producer: {
      name: "bootstrapTrustedChainCompositionRoot" as const,
      version: TRUSTED_RESTORATION_RECORD_SCHEMA_VERSION,
      command_kind: "TEST_ARTIFACT_SET"
    },
    upstream_references: []
  };
  return {
    ...withoutIntegrity,
    integrity_bytes: canonicalSerialize(withoutIntegrity),
    integrity_hash: canonicalHash(withoutIntegrity)
  };
}

function resealRecord<Command>(
  input: TrustedRestorationRecord<Command>
): TrustedRestorationRecord<Command> {
  const { integrity_hash: ignoredIntegrityHash, ...withoutIntegrity } = input;
  return {
    ...structuredClone(withoutIntegrity),
    integrity_hash: canonicalHash(withoutIntegrity)
  };
}

interface ExecutionPayload {
  readonly writer_epoch: number;
  readonly record_integrity_bytes: string;
  readonly record: TrustedRestorationRecord;
  readonly artifact_envelopes: readonly TrustedRestorationArtifactEnvelope[];
  readonly read_model_projection: null;
}

function executionPayload(
  writerEpoch: number,
  execution: TrustedRestorationExecution
): ExecutionPayload {
  const { integrity_hash: ignoredIntegrityHash, ...recordWithoutIntegrity } = execution.record;
  return {
    writer_epoch: writerEpoch,
    record_integrity_bytes: canonicalSerialize(recordWithoutIntegrity),
    ...structuredClone(execution),
    read_model_projection: null
  };
}

class OfflineAtomicAppendContract {
  #writerEpoch: number;
  readonly #executions = new Map<string, string>();

  constructor(writerEpoch: number) {
    this.#writerEpoch = writerEpoch;
  }

  acquireWriterEpoch() {
    this.#writerEpoch += 1;
    return this.#writerEpoch;
  }

  append(payload: ExecutionPayload, crash: "BEFORE_COMMIT" | "AFTER_COMMIT" | null = null) {
    if (payload.writer_epoch !== this.#writerEpoch) throw new Error("STALE_WRITER");
    const identity = logicalExecutionIdentity(payload);
    const recordId = payload.record.restoration_record_id;
    const existing = this.#executions.get(recordId);
    if (existing !== undefined) {
      if (existing === identity) return "IDEMPOTENT_REUSE" as const;
      throw new Error("COLLISION");
    }
    if (crash === "BEFORE_COMMIT") throw new Error("CRASH_BEFORE_COMMIT");
    this.#executions.set(recordId, identity);
    if (crash === "AFTER_COMMIT") throw new Error("CRASH_AFTER_COMMIT");
    return "APPENDED" as const;
  }
}

function logicalExecutionIdentity(payload: ExecutionPayload) {
  const { writer_epoch: ignoredWriterEpoch, record_integrity_bytes: ignoredBytes, ...logical } = payload;
  const { integrity_hash: ignoredRecordHash, ...record } = logical.record;
  return canonicalSerialize({
    ...logical,
    record: {
      ...record,
      expected_artifacts: [...record.expected_artifacts].sort(compareArtifactIdentity)
    },
    artifact_envelopes: [...logical.artifact_envelopes].sort(compareArtifactIdentity)
  });
}

function compareArtifactIdentity(
  left: { readonly artifact_kind: string; readonly artifact_id: string },
  right: { readonly artifact_kind: string; readonly artifact_id: string }
) {
  return `${left.artifact_kind}\0${left.artifact_id}`.localeCompare(
    `${right.artifact_kind}\0${right.artifact_id}`
  );
}
