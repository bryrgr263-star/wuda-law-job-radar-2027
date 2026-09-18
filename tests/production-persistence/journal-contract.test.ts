import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  TrustedRestorationError,
  createTrustedRestorationRecord,
  type TrustedRestorationArtifactEnvelope,
  type TrustedRestorationExecution
} from "../../lib/ingestion";
import {
  canonicalHash,
  canonicalSerialize
} from "../../lib/ingestion/normalization/canonical-artifact-registry";
import {
  PostgresProductionPersistence,
  artifactSetHash,
  loadVerifiedPostgresJournal,
  sealCheckpoint,
  type PostgresExecutor,
  type TrustedCheckpointVerifier
} from "../../lib/production-persistence";

const verifier: TrustedCheckpointVerifier = {
  async verify({ signature }) {
    return signature === "test-signature";
  }
};

test("verified checkpoint, journal, artifacts, and upstream seals restore records", async () => {
  const fixture = journalFixture();
  const database = new JournalReadExecutor(fixture);
  const records = await loadVerifiedPostgresJournal({
    database,
    options: {
      stream_id: "journal-test",
      scope: "SYNTHETIC_TEST",
      writer_epoch: 1,
      checkpoint_verifier: verifier
    }
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]!.integrity_hash, fixture.record.integrity_hash);
});

test("invalid signature, dangling upstream, scope mismatch, and seal mismatch require recovery", async () => {
  const fixture = journalFixture();
  const badSignature = new JournalReadExecutor({
    ...fixture,
    checkpoint: { ...fixture.checkpoint, signature: "invalid" }
  });
  await assert.rejects(load(badSignature), checkpointFailure);

  const dangling = resealEnvelope({
    ...fixture.envelope,
    upstream_references: [{
      relation: "ARTIFACT_REFERENCE",
      upstream_artifact_kind: "MISSING",
      upstream_artifact_id: "missing",
      expected_seal: "0".repeat(64)
    }]
  });
  await assert.rejects(load(new JournalReadExecutor({ ...fixture, envelope: dangling })),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "UPSTREAM_REFERENCE_FAILURE");

  const wrongScope = resealEnvelope({ ...fixture.envelope, scope: "PRODUCTION" });
  await assert.rejects(load(new JournalReadExecutor({ ...fixture, envelope: wrongScope })),
    checkpointFailure);

  const wrongSeal = resealEnvelope({ ...fixture.envelope, seal: "1".repeat(64) });
  await assert.rejects(load(new JournalReadExecutor({ ...fixture, envelope: wrongSeal })),
    checkpointFailure);
});

test("sequence gaps, previous-hash mismatch, normalized seal tampering, and checkpoint forks require recovery", async () => {
  const fixture = journalFixture();
  const sequenceGap = createTrustedRestorationRecord({
    sequence: 2,
    previous_record_hash: null,
    command_kind: fixture.record.command_kind,
    command: fixture.record.command,
    result: { artifact_id: "artifact-1", value: "trusted" },
    expected_artifacts: fixture.record.expected_artifacts,
    provenance: fixture.record.provenance
  });
  await assert.rejects(load(new JournalReadExecutor({ ...fixture, record: sequenceGap })),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "JOURNAL_DISCONTINUITY");

  const previousMismatch = createTrustedRestorationRecord({
    sequence: 1,
    previous_record_hash: "f".repeat(64),
    command_kind: fixture.record.command_kind,
    command: fixture.record.command,
    result: { artifact_id: "artifact-1", value: "trusted" },
    expected_artifacts: fixture.record.expected_artifacts,
    provenance: fixture.record.provenance
  });
  await assert.rejects(load(new JournalReadExecutor({ ...fixture, record: previousMismatch })),
    (error: unknown) => error instanceof TrustedRestorationError
      && error.code === "JOURNAL_DISCONTINUITY");

  await assert.rejects(load(new JournalReadExecutor({
    ...fixture,
    journalArtifactSeals: [{
      ...fixture.journalArtifactSeals[0]!,
      expected_seal: "e".repeat(64)
    }]
  })), checkpointFailure);

  const checkpointFork = {
    ...fixture.checkpoint,
    previous_checkpoint_hash: "d".repeat(64)
  };
  await assert.rejects(load(new JournalReadExecutor({
    ...fixture,
    checkpoint: checkpointFork
  })), checkpointFailure);
});

test("PostgreSQL appendExecution is one RPC and propagates transaction failure atomically", async () => {
  const fixture = journalFixture();
  const execution: TrustedRestorationExecution = {
    record: fixture.record,
    artifact_envelopes: [fixture.envelope],
    read_model_projection: null
  };
  const success = new AppendExecutor();
  const repository = new PostgresProductionPersistence(success, {
    stream_id: "journal-test",
    scope: "SYNTHETIC_TEST",
    writer_epoch: 7,
    checkpoint_verifier: verifier
  });
  assert.equal(await repository.appendExecution(execution), "APPENDED");
  assert.equal(success.calls.length, 1);
  assert.match(success.calls[0]!.sql, /trusted_chain\.append_execution/iu);

  const artifactFailure = new AppendExecutor("artifact failure");
  await assert.rejects(new PostgresProductionPersistence(artifactFailure, {
    stream_id: "journal-test",
    scope: "SYNTHETIC_TEST",
    writer_epoch: 7,
    checkpoint_verifier: verifier
  }).appendExecution(execution), /artifact failure/);
  assert.equal(artifactFailure.committedExecutions, 0);

  const headFailure = new AppendExecutor("head advance failure");
  await assert.rejects(new PostgresProductionPersistence(headFailure, {
    stream_id: "journal-test",
    scope: "SYNTHETIC_TEST",
    writer_epoch: 7,
    checkpoint_verifier: verifier
  }).appendExecution(execution), /head advance failure/);
  assert.equal(headFailure.committedExecutions, 0);
});

function journalFixture() {
  const artifact = { artifact_id: "artifact-1", value: "trusted" };
  const seal = canonicalHash(artifact);
  const record = createTrustedRestorationRecord({
    sequence: 1,
    previous_record_hash: null,
    command_kind: "TEST_ARTIFACT",
    command: { kind: "TEST_ARTIFACT" },
    result: artifact,
    expected_artifacts: [{
      artifact_kind: "OPPORTUNITY_CANDIDATE",
      artifact_id: artifact.artifact_id,
      content_hash: seal
    }],
    provenance: {
      scope: "SYNTHETIC_TEST",
      actor: "journal-test",
      recorded_at: "2026-09-15T00:00:00.000Z"
    }
  });
  const canonicalBytes = canonicalSerialize(artifact);
  const base = {
    artifact_type: "OPPORTUNITY_CANDIDATE",
    artifact_kind: "OPPORTUNITY_CANDIDATE",
    artifact_id: artifact.artifact_id,
    stream_id: artifact.artifact_id,
    revision: null,
    supersedes_artifact_id: null,
    schema_version: "test/1",
    canonical_bytes: canonicalBytes,
    artifact_hash: canonicalHash(artifact),
    seal,
    scope: "SYNTHETIC_TEST" as const,
    provenance: record.provenance,
    created_at: record.provenance.recorded_at,
    producer: {
      name: "bootstrapTrustedChainCompositionRoot" as const,
      version: record.schema_version,
      command_kind: record.command_kind
    },
    upstream_references: []
  };
  const envelope = resealEnvelope(base);
  const genesisCheckpoint = sealCheckpoint({
    checkpoint_id: "checkpoint-genesis",
    stream_id: "journal-test",
    scope: "SYNTHETIC_TEST",
    sequence: 0,
    head_hash: "0".repeat(64),
    artifact_set_hash: artifactSetHash([]),
    previous_checkpoint_hash: null,
    signer_key_id: "test-only-key",
    signature_algorithm: "Ed25519",
    created_at: "2026-09-14T23:59:59.000Z"
  }, "test-signature");
  const checkpoint = sealCheckpoint({
    checkpoint_id: "checkpoint-1",
    stream_id: "journal-test",
    scope: "SYNTHETIC_TEST",
    sequence: 1,
    head_hash: record.integrity_hash,
    artifact_set_hash: artifactSetHash([envelope]),
    previous_checkpoint_hash: genesisCheckpoint.checkpoint_hash,
    signer_key_id: "test-only-key",
    signature_algorithm: "Ed25519",
    created_at: "2026-09-15T00:00:01.000Z"
  }, "test-signature");
  const journalArtifactSeals = record.expected_artifacts.map((artifact, ordinal) => ({
    sequence: record.sequence,
    ordinal,
    artifact_kind: artifact.artifact_kind,
    artifact_id: artifact.artifact_id,
    expected_seal: artifact.content_hash
  }));
  return { record, envelope, genesisCheckpoint, checkpoint, journalArtifactSeals };
}

function resealEnvelope(
  input: Omit<TrustedRestorationArtifactEnvelope, "integrity_bytes" | "integrity_hash">
    | TrustedRestorationArtifactEnvelope
): TrustedRestorationArtifactEnvelope {
  const withoutIntegrity = "integrity_bytes" in input
    ? stripEnvelopeIntegrity(input)
    : input;
  const integrityBytes = canonicalSerialize(withoutIntegrity);
  return {
    ...structuredClone(withoutIntegrity),
    integrity_bytes: integrityBytes,
    integrity_hash: canonicalHash(withoutIntegrity)
  };
}

function stripEnvelopeIntegrity(input: TrustedRestorationArtifactEnvelope) {
  const {
    integrity_bytes: ignoredIntegrityBytes,
    integrity_hash: ignoredIntegrityHash,
    ...withoutIntegrity
  } = input;
  return withoutIntegrity;
}

function load(database: PostgresExecutor) {
  return loadVerifiedPostgresJournal({
    database,
    options: {
      stream_id: "journal-test",
      scope: "SYNTHETIC_TEST",
      writer_epoch: 1,
      checkpoint_verifier: verifier
    }
  });
}

function checkpointFailure(error: unknown) {
  return error instanceof TrustedRestorationError
    && (error.code === "CHECKPOINT_REQUIRED"
      || error.code === "ARTIFACT_INTEGRITY_FAILURE");
}

class JournalReadExecutor implements PostgresExecutor {
  constructor(readonly fixture: ReturnType<typeof journalFixture>) {}

  async query<Row>(sql: string) {
    if (/journal_checkpoints/iu.test(sql)) {
      return { rows: [
        { record_json: this.fixture.genesisCheckpoint },
        { record_json: this.fixture.checkpoint }
      ] as Row[] };
    }
    if (/journal_artifact_seals/iu.test(sql)) {
      return { rows: this.fixture.journalArtifactSeals as Row[] };
    }
    if (/command_journal/iu.test(sql)) {
      return { rows: [{ record_json: this.fixture.record }] as Row[] };
    }
    if (/trusted_chain\.artifacts/iu.test(sql)) {
      return { rows: [{ record_json: this.fixture.envelope, first_sequence: 1 }] as Row[] };
    }
    return { rows: [] as Row[] };
  }

  async transaction<Result>(
    work: (executor: PostgresExecutor) => Promise<Result>
  ): Promise<Result> {
    return work(this);
  }
}

class AppendExecutor implements PostgresExecutor {
  readonly calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  committedExecutions = 0;

  constructor(readonly failure: string | null = null) {}

  async query<Row>(sql: string, parameters: readonly unknown[] = []) {
    this.calls.push({ sql, parameters });
    if (this.failure) throw new Error(this.failure);
    this.committedExecutions += 1;
    return { rows: [{ outcome: "APPENDED" }] as Row[] };
  }

  async transaction<Result>(
    work: (executor: PostgresExecutor) => Promise<Result>
  ): Promise<Result> {
    return work(this);
  }
}
