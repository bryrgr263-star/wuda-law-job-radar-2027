import {
  TrustedRestorationError,
  assertTrustedArtifactEnvelopeIntegrity,
  assertTrustedRestorationRecordIntegrity,
  assertTrustedRestorationSequence,
  type TrustedRestorationArtifactEnvelope,
  type TrustedRestorationArtifactSeal,
  type TrustedRestorationRecord,
  type TrustedRestorationScope
} from "../ingestion";
import {
  canonicalHash,
  canonicalSerialize
} from "../ingestion/normalization/canonical-artifact-registry";
import type { PostgresExecutor } from "./contracts";

export interface TrustedJournalCheckpointPayload {
  readonly checkpoint_id: string;
  readonly stream_id: string;
  readonly scope: TrustedRestorationScope;
  readonly sequence: number;
  readonly head_hash: string;
  readonly artifact_set_hash: string;
  readonly previous_checkpoint_hash: string | null;
  readonly signer_key_id: string;
  readonly signature_algorithm: "Ed25519";
  readonly created_at: string;
}

export interface TrustedJournalCheckpoint extends TrustedJournalCheckpointPayload {
  readonly signing_payload_bytes: string;
  readonly signature: string;
  readonly checkpoint_hash: string;
}

export interface TrustedCheckpointVerifier {
  verify(input: {
    readonly signer_key_id: string;
    readonly algorithm: "Ed25519";
    readonly payload_bytes: string;
    readonly signature: string;
  }): Promise<boolean>;
}

export interface ProductionJournalOptions {
  readonly stream_id: string;
  readonly scope: TrustedRestorationScope;
  readonly writer_epoch: number;
  readonly checkpoint_verifier: TrustedCheckpointVerifier;
}

export function createCheckpointPayload(input: TrustedJournalCheckpointPayload) {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw recoveryRequired("Checkpoint sequence is invalid");
  }
  if (!input.checkpoint_id.trim() || !input.stream_id.trim() || !input.signer_key_id.trim()) {
    throw recoveryRequired("Checkpoint identity is incomplete");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.head_hash)
      || !/^[a-f0-9]{64}$/u.test(input.artifact_set_hash)) {
    throw recoveryRequired("Checkpoint hashes must be lowercase SHA-256");
  }
  return canonicalSerialize({
    checkpoint_id: input.checkpoint_id,
    stream_id: input.stream_id,
    scope: input.scope,
    sequence: input.sequence,
    head_hash: input.head_hash,
    artifact_set_hash: input.artifact_set_hash,
    previous_checkpoint_hash: input.previous_checkpoint_hash,
    signer_key_id: input.signer_key_id,
    signature_algorithm: input.signature_algorithm,
    created_at: input.created_at
  });
}

export function sealCheckpoint(
  payload: TrustedJournalCheckpointPayload,
  signature: string
): TrustedJournalCheckpoint {
  if (!signature.trim()) throw recoveryRequired("Checkpoint signature is required");
  const signingPayloadBytes = createCheckpointPayload(payload);
  return {
    ...structuredClone(payload),
    signing_payload_bytes: signingPayloadBytes,
    signature,
    checkpoint_hash: canonicalHash({
      signing_payload_bytes: signingPayloadBytes,
      signature
    })
  };
}

export function artifactSetHash(
  artifacts: readonly TrustedRestorationArtifactEnvelope[]
) {
  return canonicalHash(artifacts.map((artifact) => ({
    artifact_type: artifact.artifact_type,
    artifact_id: artifact.artifact_id,
    seal: artifact.seal
  })).sort((left, right) => canonicalSerialize(left).localeCompare(
    canonicalSerialize(right)
  )));
}

export async function loadVerifiedPostgresJournal<Command>(input: {
  readonly database: PostgresExecutor;
  readonly options: ProductionJournalOptions;
}) {
  const checkpointRows = await input.database.query<{ record_json: unknown }>(
    `select record_json from trusted_chain.journal_checkpoints
      where stream_id = $1 order by sequence`,
    [input.options.stream_id]
  );
  const checkpoints = checkpointRows.rows.map((row) => {
    return decodeRequired<TrustedJournalCheckpoint>(row.record_json, "journal checkpoint");
  });
  if (checkpoints.length === 0) {
    throw recoveryRequired("No signed journal checkpoint is available");
  }
  const genesis = checkpoints[0]!;
  if (genesis.sequence !== 0
      || genesis.head_hash !== "0".repeat(64)
      || genesis.artifact_set_hash !== artifactSetHash([])
      || genesis.previous_checkpoint_hash !== null) {
    throw recoveryRequired("Journal genesis checkpoint is invalid");
  }
  let previousCheckpointHash: string | null = null;
  let previousCheckpointSequence = -1;
  for (const checkpoint of checkpoints) {
    if (checkpoint.sequence <= previousCheckpointSequence
        || checkpoint.previous_checkpoint_hash !== previousCheckpointHash) {
      throw recoveryRequired("Checkpoint chain is discontinuous");
    }
    await assertCheckpoint(checkpoint, input.options);
    previousCheckpointHash = checkpoint.checkpoint_hash;
    previousCheckpointSequence = checkpoint.sequence;
  }

  const journalRows = await input.database.query<{ record_json: unknown }>(
    `select record_json from trusted_chain.command_journal
      where stream_id = $1 order by sequence`,
    [input.options.stream_id]
  );
  const records = journalRows.rows.map((row) => {
    return assertTrustedRestorationRecordIntegrity(
      decodeRequired<TrustedRestorationRecord<Command>>(row.record_json, "journal record")
    );
  });
  assertTrustedRestorationSequence(records, input.options.scope);

  const normalizedSealRows = await input.database.query<{
    sequence: number;
    ordinal: number;
    artifact_kind: string;
    artifact_id: string;
    expected_seal: string;
  }>(
    `select sequence, ordinal, artifact_kind, artifact_id, expected_seal
      from trusted_chain.journal_artifact_seals
      where stream_id = $1 order by sequence, ordinal`,
    [input.options.stream_id]
  );
  verifyNormalizedJournalSeals(records, normalizedSealRows.rows);

  const artifactRows = await input.database.query<{
    record_json: unknown;
    first_sequence: number;
  }>(
    `select record_json, first_sequence from trusted_chain.artifacts
      where journal_stream_id = $1 order by first_sequence, artifact_type, artifact_id`,
    [input.options.stream_id]
  );
  const artifacts = artifactRows.rows.map((row) => ({
    envelope: assertTrustedArtifactEnvelopeIntegrity(
      decodeRequired<TrustedRestorationArtifactEnvelope>(row.record_json, "artifact envelope")
    ),
    first_sequence: Number(row.first_sequence)
  }));
  verifyArtifactGraph(records, artifacts, input.options.scope);
  for (const checkpoint of checkpoints) {
    verifyCheckpointPosition(checkpoint, records, artifacts);
  }
  return records.map((record) => structuredClone(record));
}

async function assertCheckpoint(
  checkpoint: TrustedJournalCheckpoint,
  options: ProductionJournalOptions
) {
  if (checkpoint.stream_id !== options.stream_id || checkpoint.scope !== options.scope) {
    throw recoveryRequired("Checkpoint scope or stream mismatch");
  }
  if (checkpoint.signing_payload_bytes !== createCheckpointPayload(checkpoint)) {
    throw recoveryRequired("Checkpoint signing payload mismatch");
  }
  if (checkpoint.checkpoint_hash !== canonicalHash({
    signing_payload_bytes: checkpoint.signing_payload_bytes,
    signature: checkpoint.signature
  })) {
    throw recoveryRequired("Checkpoint integrity hash mismatch");
  }
  if (!await options.checkpoint_verifier.verify({
    signer_key_id: checkpoint.signer_key_id,
    algorithm: checkpoint.signature_algorithm,
    payload_bytes: checkpoint.signing_payload_bytes,
    signature: checkpoint.signature
  })) {
    throw recoveryRequired("Checkpoint signature verification failed");
  }
}

function verifyArtifactGraph<Command>(
  records: readonly TrustedRestorationRecord<Command>[],
  artifacts: readonly {
    readonly envelope: TrustedRestorationArtifactEnvelope;
    readonly first_sequence: number;
  }[],
  scope: TrustedRestorationScope
) {
  const ledger = new Map<string, TrustedRestorationArtifactEnvelope>();
  for (const item of artifacts) {
    const envelope = item.envelope;
    if (envelope.scope !== scope) throw recoveryRequired("Artifact scope mismatch");
    const key = artifactKey(envelope.artifact_kind, envelope.artifact_id);
    if (ledger.has(key)) throw recoveryRequired(`Artifact identity collision: ${key}`);
    ledger.set(key, envelope);
  }
  for (const item of artifacts) {
    for (const reference of item.envelope.upstream_references) {
      const upstream = ledger.get(artifactKey(
        reference.upstream_artifact_kind,
        reference.upstream_artifact_id
      ));
      if (!upstream || upstream.scope !== item.envelope.scope
          || upstream.seal !== reference.expected_seal) {
        throw new TrustedRestorationError(
          "UPSTREAM_REFERENCE_FAILURE",
          `Invalid upstream reference: ${item.envelope.artifact_id}`
        );
      }
    }
  }
  for (const record of records) {
    for (const seal of record.expected_artifacts) {
      const artifact = ledger.get(artifactKey(seal.artifact_kind, seal.artifact_id));
      if (!artifact || artifact.seal !== seal.content_hash) {
        throw recoveryRequired(
          `Journal artifact seal is unavailable or mismatched: ${seal.artifact_id}`
        );
      }
    }
  }
}

function verifyNormalizedJournalSeals<Command>(
  records: readonly TrustedRestorationRecord<Command>[],
  rows: readonly {
    readonly sequence: number;
    readonly ordinal: number;
    readonly artifact_kind: string;
    readonly artifact_id: string;
    readonly expected_seal: string;
  }[]
) {
  const expected = records.flatMap((record) => {
    return record.expected_artifacts.map((artifact, ordinal) => ({
      sequence: record.sequence,
      ordinal,
      artifact_kind: artifact.artifact_kind,
      artifact_id: artifact.artifact_id,
      expected_seal: artifact.content_hash
    }));
  });
  const actual = rows.map((row) => ({
    sequence: Number(row.sequence),
    ordinal: Number(row.ordinal),
    artifact_kind: row.artifact_kind,
    artifact_id: row.artifact_id,
    expected_seal: row.expected_seal
  }));
  if (canonicalSerialize(actual) !== canonicalSerialize(expected)) {
    throw recoveryRequired("Normalized journal artifact seals do not match journal records");
  }
}

function verifyCheckpointPosition<Command>(
  checkpoint: TrustedJournalCheckpoint,
  records: readonly TrustedRestorationRecord<Command>[],
  artifacts: readonly {
    readonly envelope: TrustedRestorationArtifactEnvelope;
    readonly first_sequence: number;
  }[]
) {
  if (checkpoint.sequence > records.length) {
    throw recoveryRequired("Checkpoint sequence is ahead of the journal");
  }
  const expectedHead = checkpoint.sequence === 0
    ? "0".repeat(64)
    : records[checkpoint.sequence - 1]!.integrity_hash;
  if (checkpoint.head_hash !== expectedHead) {
    throw recoveryRequired("Checkpoint journal head mismatch");
  }
  const checkpointArtifacts = artifacts
    .filter((item) => item.first_sequence <= checkpoint.sequence)
    .map((item) => item.envelope);
  if (checkpoint.artifact_set_hash !== artifactSetHash(checkpointArtifacts)) {
    throw recoveryRequired("Checkpoint artifact-set hash mismatch");
  }
}

function artifactKey(kind: string, id: string) {
  return `${kind}\0${id}`;
}

function decode<Value>(value: unknown): Value | null {
  if (value === undefined || value === null) return null;
  return (typeof value === "string" ? JSON.parse(value) : structuredClone(value)) as Value;
}

function decodeRequired<Value>(value: unknown, label: string) {
  const decoded = decode<Value>(value);
  if (!decoded) throw recoveryRequired(`Missing ${label}`);
  return decoded;
}

function recoveryRequired(message: string) {
  return new TrustedRestorationError("CHECKPOINT_REQUIRED", message);
}
