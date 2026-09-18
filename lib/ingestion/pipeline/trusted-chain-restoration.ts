import {
  canonicalHash,
  canonicalSerialize
} from "../normalization/canonical-artifact-registry";
import type { SOVDiscoveryEvidence } from "../normalization/source-discovery-support";

export const TRUSTED_RESTORATION_RECORD_SCHEMA_VERSION =
  "trusted-restoration-record/1.0.0" as const;

export type TrustedRestorationScope = "PRODUCTION" | "SYNTHETIC_TEST";

export interface TrustedRestorationProvenance {
  readonly scope: TrustedRestorationScope;
  readonly actor: string;
  readonly recorded_at: string;
}

export interface TrustedRestorationArtifactSeal {
  readonly artifact_kind: string;
  readonly artifact_id: string;
  readonly content_hash: string;
}

export interface TrustedRestorationUpstreamReference {
  readonly relation: "ARTIFACT_REFERENCE";
  readonly upstream_artifact_kind: string;
  readonly upstream_artifact_id: string;
  readonly expected_seal: string;
}

export interface TrustedRestorationArtifactEnvelope {
  readonly artifact_type: string;
  readonly artifact_kind: string;
  readonly artifact_id: string;
  readonly stream_id: string;
  readonly revision: number | null;
  readonly supersedes_artifact_id: string | null;
  readonly schema_version: string;
  readonly canonical_bytes: string;
  readonly artifact_hash: string;
  readonly seal: string;
  readonly scope: TrustedRestorationScope;
  readonly provenance: TrustedRestorationProvenance;
  readonly created_at: string;
  readonly producer: {
    readonly name: "bootstrapTrustedChainCompositionRoot";
    readonly version: typeof TRUSTED_RESTORATION_RECORD_SCHEMA_VERSION;
    readonly command_kind: string;
  };
  readonly upstream_references: readonly TrustedRestorationUpstreamReference[];
  readonly integrity_bytes: string;
  readonly integrity_hash: string;
}

export interface TrustedPresentationReadModelProjection {
  readonly presentation_read_model_id: string;
  readonly canonical_bytes: string;
  readonly artifact_hash: string;
  readonly seal: string;
  readonly record: unknown;
}

export interface TrustedRestorationExecution<Command = unknown> {
  readonly record: TrustedRestorationRecord<Command>;
  readonly artifact_envelopes: readonly TrustedRestorationArtifactEnvelope[];
  readonly read_model_projection: TrustedPresentationReadModelProjection | null;
}

export interface TrustedRestorationRecord<Command = unknown> {
  readonly restoration_record_id: string;
  readonly sequence: number;
  readonly previous_record_hash: string | null;
  readonly command_kind: string;
  readonly command: Command;
  readonly command_hash: string;
  readonly result_hash: string;
  readonly expected_artifacts: readonly TrustedRestorationArtifactSeal[];
  readonly provenance: TrustedRestorationProvenance;
  readonly schema_version: typeof TRUSTED_RESTORATION_RECORD_SCHEMA_VERSION;
  readonly integrity_hash: string;
}

export interface TrustedRestorationJournalRepository<Command = unknown> {
  readAuthoritativeHead?(): Promise<string>;
  list(): Promise<readonly TrustedRestorationRecord<Command>[]>;
  readVerifiedDiscovery?(snapshotId: string, recordId: string): Promise<SOVDiscoveryEvidence>;
  readArtifactEnvelope?(kind: string, id: string, scope: TrustedRestorationScope): Promise<TrustedRestorationArtifactEnvelope | null>;
  appendExecution(execution: TrustedRestorationExecution<Command>): Promise<
    "APPENDED" | "IDEMPOTENT_REUSE"
  >;
}

export class TrustedRestorationError extends Error {
  readonly code:
    | "INVALID_RECORD"
    | "JOURNAL_DISCONTINUITY"
    | "COMMAND_REPLAY_MISMATCH"
    | "ARTIFACT_INTEGRITY_FAILURE"
    | "UPSTREAM_REFERENCE_FAILURE"
    | "CHECKPOINT_REQUIRED"
    | "JOURNAL_WRITE_FAILURE"
    | "ROOT_HALTED";

  constructor(code: TrustedRestorationError["code"], message: string) {
    super(message);
    this.name = "TrustedRestorationError";
    this.code = code;
  }
}

export function assertTrustedArtifactEnvelopeIntegrity(
  envelope: TrustedRestorationArtifactEnvelope
) {
  if (!envelope.artifact_type.trim()
      || !envelope.artifact_kind.trim()
      || !envelope.artifact_id.trim()
      || !envelope.stream_id.trim()
      || !envelope.schema_version.trim()
      || !envelope.seal.trim()) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      "Trusted artifact envelope identity is incomplete"
    );
  }
  if (envelope.revision !== null
      && (!Number.isSafeInteger(envelope.revision) || envelope.revision < 1)) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      "Trusted artifact revision must be positive"
    );
  }
  if (envelope.artifact_hash !== canonicalHash(
    JSON.parse(envelope.canonical_bytes)
  )) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      `Artifact canonical hash mismatch: ${envelope.artifact_id}`
    );
  }
  const references = [...envelope.upstream_references].sort((left, right) => {
    return canonicalSerialize(left).localeCompare(canonicalSerialize(right));
  });
  if (canonicalSerialize(references) !== canonicalSerialize(envelope.upstream_references)) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      `Artifact upstream references are not canonical: ${envelope.artifact_id}`
    );
  }
  const {
    integrity_hash: integrityHash,
    integrity_bytes: integrityBytes,
    ...withoutIntegrity
  } = envelope;
  if (integrityBytes !== canonicalSerialize(withoutIntegrity)) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      `Artifact integrity bytes mismatch: ${envelope.artifact_id}`
    );
  }
  if (integrityHash !== canonicalHash(withoutIntegrity)) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      `Artifact envelope integrity mismatch: ${envelope.artifact_id}`
    );
  }
  return structuredClone(envelope);
}

export function assertTrustedRestorationExecution<Command>(
  execution: TrustedRestorationExecution<Command>
) {
  const record = assertTrustedRestorationRecordIntegrity(execution.record);
  const envelopes = execution.artifact_envelopes.map(
    assertTrustedArtifactEnvelopeIntegrity
  );
  const expected = [...record.expected_artifacts].sort((left, right) => {
    return canonicalSerialize(left).localeCompare(canonicalSerialize(right));
  });
  const actual = envelopes.map((envelope) => ({
    artifact_kind: envelope.artifact_kind,
    artifact_id: envelope.artifact_id,
    content_hash: envelope.seal
  })).sort((left, right) => canonicalSerialize(left).localeCompare(
    canonicalSerialize(right)
  ));
  if (canonicalSerialize(expected) !== canonicalSerialize(actual)) {
    throw new TrustedRestorationError(
      "ARTIFACT_INTEGRITY_FAILURE",
      "Artifact envelopes do not match restoration seals"
    );
  }
  for (const envelope of envelopes) {
    if (envelope.scope !== record.provenance.scope) {
      throw new TrustedRestorationError(
        "ARTIFACT_INTEGRITY_FAILURE",
        `Artifact scope mismatch: ${envelope.artifact_id}`
      );
    }
  }
  if (execution.read_model_projection) {
    const projection = execution.read_model_projection;
    const envelope = envelopes.find((item) => {
      return item.artifact_type === "PRESENTATION_READ_MODEL"
        && item.artifact_id === projection.presentation_read_model_id;
    });
    if (!envelope
        || envelope.canonical_bytes !== projection.canonical_bytes
        || envelope.artifact_hash !== projection.artifact_hash
        || envelope.seal !== projection.seal
        || canonicalSerialize(projection.record) !== projection.canonical_bytes) {
      throw new TrustedRestorationError(
        "ARTIFACT_INTEGRITY_FAILURE",
        "PresentationReadModel projection does not match its artifact envelope"
      );
    }
  }
  return structuredClone(execution);
}

export function createTrustedRestorationRecord<Command>(input: {
  readonly sequence: number;
  readonly previous_record_hash: string | null;
  readonly command_kind: string;
  readonly command: Command;
  readonly result: unknown;
  readonly expected_artifacts: readonly TrustedRestorationArtifactSeal[];
  readonly provenance: TrustedRestorationProvenance;
}): TrustedRestorationRecord<Command> {
  const command = structuredClone(input.command);
  const commandHash = canonicalHash(command);
  const expectedArtifacts = [...input.expected_artifacts]
    .map((artifact) => structuredClone(artifact))
    .sort((left, right) => canonicalSerialize(left).localeCompare(
      canonicalSerialize(right)
    ));
  const withoutIntegrity = {
    restoration_record_id: restorationRecordIdFor(
      input.sequence,
      input.previous_record_hash,
      input.command_kind,
      commandHash
    ),
    sequence: input.sequence,
    previous_record_hash: input.previous_record_hash,
    command_kind: input.command_kind,
    command,
    command_hash: commandHash,
    result_hash: canonicalHash(input.result),
    expected_artifacts: expectedArtifacts,
    provenance: structuredClone(input.provenance),
    schema_version: TRUSTED_RESTORATION_RECORD_SCHEMA_VERSION
  } as const;
  return assertTrustedRestorationRecordIntegrity({
    ...withoutIntegrity,
    integrity_hash: canonicalHash(withoutIntegrity)
  });
}

export function assertTrustedRestorationRecordIntegrity<Command>(
  record: TrustedRestorationRecord<Command>
): TrustedRestorationRecord<Command> {
  if (!record || typeof record !== "object") {
    throw invalid("Restoration record must be an object");
  }
  if (record.schema_version !== TRUSTED_RESTORATION_RECORD_SCHEMA_VERSION) {
    throw invalid("Restoration record schema is unsupported");
  }
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 1) {
    throw invalid("Restoration record sequence must be a positive integer");
  }
  if (!record.command_kind.trim()) {
    throw invalid("Restoration command kind is required");
  }
  if (record.command_hash !== canonicalHash(record.command)) {
    throw invalid("Restoration command hash does not match canonical bytes");
  }
  if (!record.result_hash.trim()) {
    throw invalid("Restoration result hash is required");
  }
  if (!record.provenance.actor.trim() || !record.provenance.recorded_at.trim()) {
    throw invalid("Restoration provenance is incomplete");
  }
  if (record.provenance.scope !== "PRODUCTION"
      && record.provenance.scope !== "SYNTHETIC_TEST") {
    throw invalid("Restoration provenance scope is unsupported");
  }
  const expectedId = restorationRecordIdFor(
    record.sequence,
    record.previous_record_hash,
    record.command_kind,
    record.command_hash
  );
  if (record.restoration_record_id !== expectedId) {
    throw invalid("Restoration record ID does not match its command chain");
  }
  const artifactKeys = new Set<string>();
  for (const artifact of record.expected_artifacts) {
    if (!artifact.artifact_kind.trim()
        || !artifact.artifact_id.trim()
        || !artifact.content_hash.trim()) {
      throw invalid("Restoration artifact seal is incomplete");
    }
    const key = `${artifact.artifact_kind}\0${artifact.artifact_id}`;
    if (artifactKeys.has(key)) {
      throw invalid("Restoration artifact seals must be unique");
    }
    artifactKeys.add(key);
  }
  const { integrity_hash: integrityHash, ...withoutIntegrity } = record;
  if (integrityHash !== canonicalHash(withoutIntegrity)) {
    throw invalid("Restoration record integrity hash does not match content");
  }
  return structuredClone(record);
}

export function assertTrustedRestorationSequence<Command>(
  records: readonly TrustedRestorationRecord<Command>[],
  scope: TrustedRestorationScope
) {
  let previousHash: string | null = null;
  records.forEach((untrustedRecord, index) => {
    const record = assertTrustedRestorationRecordIntegrity(untrustedRecord);
    const expectedSequence = index + 1;
    if (record.sequence !== expectedSequence
        || record.previous_record_hash !== previousHash) {
      throw new TrustedRestorationError(
        "JOURNAL_DISCONTINUITY",
        `Restoration journal is discontinuous at sequence ${expectedSequence}`
      );
    }
    if (record.provenance.scope !== scope) {
      throw new TrustedRestorationError(
        "JOURNAL_DISCONTINUITY",
        "Restoration journal scope does not match the composition root"
      );
    }
    previousHash = record.integrity_hash;
  });
  return {
    next_sequence: records.length + 1,
    previous_record_hash: previousHash
  } as const;
}

function restorationRecordIdFor(
  sequence: number,
  previousRecordHash: string | null,
  commandKind: string,
  commandHash: string
) {
  return `trusted-restoration:${canonicalHash({
    sequence,
    previous_record_hash: previousRecordHash,
    command_kind: commandKind,
    command_hash: commandHash
  })}`;
}

function invalid(message: string) {
  return new TrustedRestorationError("INVALID_RECORD", message);
}
