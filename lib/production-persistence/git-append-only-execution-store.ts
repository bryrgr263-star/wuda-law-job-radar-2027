import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAuthoritativePresentationCurrentSnapshot } from "../ingestion/pipeline/presentation-persistence";
import { PRESENTATION_DECISION_V2_SCHEMA_VERSION, type PresentationDecision, type PresentationReadModel, type PresentationMigrationAudit } from "../ingestion/domain/presentation";

import {
  TrustedRestorationError,
  assertTrustedArtifactEnvelopeIntegrity,
  assertTrustedRestorationExecution,
  assertTrustedRestorationRecordIntegrity,
  assertTrustedRestorationSequence,
  type TrustedPresentationReadModelProjection,
  type TrustedRestorationArtifactEnvelope,
  type TrustedRestorationExecution,
  type TrustedRestorationJournalRepository,
  type TrustedRestorationRecord,
  type TrustedRestorationScope
} from "../ingestion";
import {
  canonicalDeserialize,
  canonicalHash,
  canonicalSerialize
} from "../ingestion/normalization/canonical-artifact-registry";

export const GIT_TRUSTED_STATE_SCHEMA_VERSION =
  "git-trusted-state/1.0.0" as const;

export type GitPersistenceFaultPoint =
  | "AFTER_TEMPORARY_WORKSPACE"
  | "BEFORE_COMMIT"
  | "AFTER_COMMIT"
  | "BEFORE_PUSH";

export interface GitAppendOnlyExecutionStoreOptions {
  readonly repository_path: string;
  readonly stream_id: string;
  readonly scope: TrustedRestorationScope;
  readonly state_path?: string;
  readonly remote?: {
    readonly name: string;
    readonly branch: string;
  };
  readonly commit_identity?: {
    readonly name: string;
    readonly email: string;
  };
  readonly fault_injector?: (
    point: GitPersistenceFaultPoint
  ) => void | Promise<void>;
}

export class GitAppendOnlyExecutionStoreError extends Error {
  readonly code:
    | "INVALID_LAYOUT"
    | "STATE_TAMPERED"
    | "IDENTITY_COLLISION"
    | "JOURNAL_DISCONTINUITY"
    | "DIRTY_STATE_PATH"
    | "CAS_MISMATCH"
    | "GIT_OPERATION_FAILED";

  constructor(
    code: GitAppendOnlyExecutionStoreError["code"],
    message: string
  ) {
    super(message);
    this.name = "GitAppendOnlyExecutionStoreError";
    this.code = code;
  }
}

interface GitArtifactIdentity {
  readonly schema_version: typeof GIT_TRUSTED_STATE_SCHEMA_VERSION;
  readonly artifact_kind: string;
  readonly artifact_id: string;
  readonly artifact_hash: string;
  readonly seal: string;
  readonly envelope_integrity_hash: string;
  readonly object_path: string;
}

interface GitReadModelIdentity {
  readonly schema_version: typeof GIT_TRUSTED_STATE_SCHEMA_VERSION;
  readonly presentation_read_model_id: string;
  readonly artifact_hash: string;
  readonly seal: string;
  readonly object_path: string;
}

interface GitExecutionArtifactReference {
  readonly artifact_kind: string;
  readonly artifact_id: string;
  readonly identity_path: string;
  readonly object_path: string;
  readonly envelope_integrity_hash: string;
}

interface GitExecutionProjectionReference {
  readonly presentation_read_model_id: string;
  readonly identity_path: string;
  readonly object_path: string;
  readonly artifact_hash: string;
  readonly seal: string;
}

interface GitExecutionManifestContent {
  readonly schema_version: typeof GIT_TRUSTED_STATE_SCHEMA_VERSION;
  readonly stream_id: string;
  readonly scope: TrustedRestorationScope;
  readonly sequence: number;
  readonly restoration_record_id: string;
  readonly journal_segment_path: string;
  readonly journal_record_hash: string;
  readonly previous_execution_manifest_hash: string | null;
  readonly artifact_references: readonly GitExecutionArtifactReference[];
  readonly read_model_projection: GitExecutionProjectionReference | null;
}

interface GitExecutionManifest extends GitExecutionManifestContent {
  readonly integrity_hash: string;
}

interface GitStateExecutionReference {
  readonly sequence: number;
  readonly path: string;
  readonly integrity_hash: string;
}

interface GitStateManifestContent {
  readonly schema_version: typeof GIT_TRUSTED_STATE_SCHEMA_VERSION;
  readonly stream_id: string;
  readonly scope: TrustedRestorationScope;
  readonly latest_sequence: number;
  readonly latest_journal_hash: string | null;
  readonly previous_state_manifest_hash: string | null;
  readonly generated_at: string | null;
  readonly execution_manifests: readonly GitStateExecutionReference[];
  readonly artifact_identity_hashes: readonly string[];
  readonly read_model_identity_hashes: readonly string[];
}

interface GitStateManifest extends GitStateManifestContent {
  readonly integrity_hash: string;
}

interface GitJournalHead {
  readonly schema_version: typeof GIT_TRUSTED_STATE_SCHEMA_VERSION;
  readonly stream_id: string;
  readonly scope: TrustedRestorationScope;
  readonly latest_sequence: number;
  readonly latest_journal_hash: string | null;
  readonly state_commit: string;
  readonly state_commit_role: "EXPECTED_PARENT";
  readonly checkpoint_reference: null;
  readonly manifest_hash: string;
}

interface LoadedGitState<Command> {
  readonly head: GitJournalHead | null;
  readonly state_manifest: GitStateManifest | null;
  readonly executions: readonly TrustedRestorationExecution<Command>[];
  readonly artifact_identities: ReadonlyMap<string, GitArtifactIdentity>;
  readonly read_model_identities: ReadonlyMap<string, GitReadModelIdentity>;
  readonly execution_manifest_hashes: readonly string[];
}

interface ProposedFiles {
  readonly immutable: ReadonlyMap<string, string>;
  readonly mutable: ReadonlyMap<string, string>;
}

export class GitAppendOnlyExecutionStore<Command = unknown> implements
TrustedRestorationJournalRepository<Command> {
  readonly #repositoryPath: string;
  readonly #statePath: string;
  readonly #streamId: string;
  readonly #scope: TrustedRestorationScope;
  readonly #remote: GitAppendOnlyExecutionStoreOptions["remote"];
  readonly #commitIdentity: NonNullable<
    GitAppendOnlyExecutionStoreOptions["commit_identity"]
  >;
  readonly #faultInjector: GitAppendOnlyExecutionStoreOptions["fault_injector"];

  constructor(options: GitAppendOnlyExecutionStoreOptions) {
    this.#repositoryPath = path.resolve(options.repository_path);
    this.#statePath = normalizeStatePath(options.state_path ?? "trusted-state");
    this.#streamId = required(options.stream_id, "stream_id");
    this.#scope = options.scope;
    this.#remote = options.remote;
    this.#commitIdentity = options.commit_identity ?? {
      name: "Trusted Chain Persistence",
      email: "trusted-chain@invalid.local"
    };
    this.#faultInjector = options.fault_injector;
    this.#git(["rev-parse", "--git-dir"]);
  }

  async list(): Promise<readonly TrustedRestorationRecord<Command>[]> {
    const commit = this.#headCommit();
    const state = this.#loadState(commit);
    return structuredClone(state.executions.map((execution) => execution.record));
  }

  listVerifiedExecutions() {
    return structuredClone(this.#loadState(this.#headCommit()).executions);
  }

  async readArtifactEnvelope(kind: string, id: string, scope: TrustedRestorationScope) {
    if (scope !== this.#scope) throw new TrustedRestorationError("ARTIFACT_INTEGRITY_FAILURE", "Issuance envelope scope mismatch");
    const envelope = this.#loadState(this.#headCommit()).executions
      .flatMap((execution) => execution.artifact_envelopes)
      .find((artifact) => artifact.artifact_kind === kind && artifact.artifact_id === id);
    return structuredClone(envelope ?? null);
  }

  listVerifiedPresentationReadModels() {
    return this.#loadState(this.#headCommit()).executions.flatMap((execution) => {
      return execution.read_model_projection
        ? [structuredClone(execution.read_model_projection.record)]
        : [];
    });
  }

  readCurrentSnapshot() {
    const anchor = this.#headCommit();
    const executions = this.#loadState(anchor).executions;
    const decisions = executions.flatMap((execution) => execution.artifact_envelopes
      .filter((envelope) => envelope.artifact_kind === "PRESENTATION_DECISION")
      .map((envelope) => JSON.parse(envelope.canonical_bytes) as PresentationDecision));
    const migrationAudits = executions.flatMap((execution) => execution.artifact_envelopes
      .filter((envelope) => envelope.artifact_kind === "PRESENTATION_MIGRATION_AUDIT")
      .map((envelope) => JSON.parse(envelope.canonical_bytes) as PresentationMigrationAudit));
    if (!decisions.some((decision) => decision.schema_version === PRESENTATION_DECISION_V2_SCHEMA_VERSION) && migrationAudits.length === 0) return null;
    const models = executions.flatMap((execution) => execution.read_model_projection
      ? [execution.read_model_projection.record as PresentationReadModel] : []);
    const associations = executions.flatMap((execution) => {
      const command = execution.record.command as { readonly kind?: string;
        readonly input?: { readonly opportunity_candidate_id?: string; readonly contract_version?: string } };
      if (command.kind !== "PRESENTATION_DECIDE" || command.input?.contract_version !== PRESENTATION_DECISION_V2_SCHEMA_VERSION) return [];
      const candidateId = command.input.opportunity_candidate_id;
      if (!candidateId) throw new Error("Presentation execution lacks its validated discovery association");
      return execution.record.expected_artifacts.filter((seal) => seal.artifact_kind === "PRESENTATION_DECISION")
        .map((seal) => ({ opportunity_candidate_id: candidateId, presentation_decision_id: seal.artifact_id }));
    });
    return buildAuthoritativePresentationCurrentSnapshot({ scope: this.#scope, authoritative_head: anchor,
      decisions, read_models: models, migration_audits: migrationAudits, candidate_associations: associations });
  }

  async readAuthoritativeHead() {
    const anchor = this.#headCommit();
    this.#loadState(anchor);
    return anchor;
  }

  listCurrentReadModels() {
    const snapshot = this.readCurrentSnapshot();
    if (!snapshot) throw new Error("Git Presentation V2 read contract is not activated");
    return snapshot.current_position_read_models;
  }

  prepareAtomicCommit(expectedParent: string) {
    const state = this.#loadState(this.#headCommit());
    if (!state.head || state.head.state_commit === expectedParent) return;
    this.#git(["merge-base", "--is-ancestor", expectedParent, "HEAD"]);
    const head: GitJournalHead = {
      ...state.head,
      state_commit: expectedParent
    };
    const absolutePath = this.#absolutePath(this.#journalHeadPath());
    writeFileSync(absolutePath, canonicalSerialize(head), "utf8");
  }

  async appendExecution(execution: TrustedRestorationExecution<Command>) {
    const validated = assertTrustedRestorationExecution(execution);
    if (validated.record.provenance.scope !== this.#scope) {
      throw new GitAppendOnlyExecutionStoreError(
        "STATE_TAMPERED",
        "Execution scope does not match the Git persistence scope"
      );
    }
    this.#assertCleanStatePath();
    const expectedParent = this.#headCommit();
    await this.#assertRemoteExpectedParent(expectedParent);
    const current = this.#loadState(expectedParent);
    const existing = current.executions[validated.record.sequence - 1];
    if (existing) {
      if (canonicalSerialize(existing) !== canonicalSerialize(validated)) {
        throw new GitAppendOnlyExecutionStoreError(
          "IDENTITY_COLLISION",
          `Execution collision at sequence ${validated.record.sequence}`
        );
      }
      return "IDEMPOTENT_REUSE" as const;
    }
    const expectedSequence = current.executions.length + 1;
    const expectedPreviousHash = current.executions.at(-1)?.record.integrity_hash ?? null;
    if (validated.record.sequence !== expectedSequence
        || validated.record.previous_record_hash !== expectedPreviousHash) {
      throw new GitAppendOnlyExecutionStoreError(
        "JOURNAL_DISCONTINUITY",
        `Execution is not contiguous at sequence ${expectedSequence}`
      );
    }

    const proposed = this.#buildProposedFiles(validated, current, expectedParent);
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "trusted-git-state-"));
    try {
      writeFileMap(temporaryRoot, proposed.immutable, false);
      writeFileMap(temporaryRoot, proposed.mutable, false);
      this.#validateProposedFiles(validated, proposed, current);
      await this.#faultInjector?.("AFTER_TEMPORARY_WORKSPACE");
      this.#materializeProposedFiles(proposed);
      this.#git(["add", "--", this.#statePath]);
      await this.#faultInjector?.("BEFORE_COMMIT");
      this.#commit(validated.record);
      await this.#faultInjector?.("AFTER_COMMIT");
      if (this.#remote) {
        await this.#faultInjector?.("BEFORE_PUSH");
        this.#push(expectedParent);
      }
      return "APPENDED" as const;
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  #buildProposedFiles(
    execution: TrustedRestorationExecution<Command>,
    current: LoadedGitState<Command>,
    expectedParent: string
  ): ProposedFiles {
    const immutable = new Map<string, string>();
    const mutable = new Map<string, string>();
    const sequence = execution.record.sequence;
    const journalPath = this.#journalSegmentPath(sequence);
    immutable.set(journalPath, canonicalSerialize(execution.record));

    const artifactReferences = execution.artifact_envelopes.map((envelope) => {
      const identityPath = this.#artifactIdentityPath(envelope);
      const objectPath = this.#artifactObjectPath(envelope);
      const identity: GitArtifactIdentity = {
        schema_version: GIT_TRUSTED_STATE_SCHEMA_VERSION,
        artifact_kind: envelope.artifact_kind,
        artifact_id: envelope.artifact_id,
        artifact_hash: envelope.artifact_hash,
        seal: envelope.seal,
        envelope_integrity_hash: envelope.integrity_hash,
        object_path: objectPath
      };
      this.#assertArtifactIdentityAvailable(identity, current.artifact_identities);
      immutable.set(objectPath, canonicalSerialize(envelope));
      immutable.set(identityPath, canonicalSerialize(identity));
      return {
        artifact_kind: envelope.artifact_kind,
        artifact_id: envelope.artifact_id,
        identity_path: identityPath,
        object_path: objectPath,
        envelope_integrity_hash: envelope.integrity_hash
      } satisfies GitExecutionArtifactReference;
    });

    const projectionReference = execution.read_model_projection
      ? this.#persistProjection(
          execution.read_model_projection,
          current.read_model_identities,
          immutable
        )
      : null;
    const previousExecutionManifestHash = current.execution_manifest_hashes.at(-1) ?? null;
    const executionManifest = sealRecord<GitExecutionManifestContent>({
      schema_version: GIT_TRUSTED_STATE_SCHEMA_VERSION,
      stream_id: this.#streamId,
      scope: this.#scope,
      sequence,
      restoration_record_id: execution.record.restoration_record_id,
      journal_segment_path: journalPath,
      journal_record_hash: canonicalHash(execution.record),
      previous_execution_manifest_hash: previousExecutionManifestHash,
      artifact_references: [...artifactReferences].sort(compareCanonical),
      read_model_projection: projectionReference
    });
    const executionManifestPath = this.#executionManifestPath(sequence);
    immutable.set(executionManifestPath, canonicalSerialize(executionManifest));

    const artifactIdentityHashes = new Set(
      current.state_manifest?.artifact_identity_hashes ?? []
    );
    for (const reference of artifactReferences) {
      artifactIdentityHashes.add(pathHash(reference.identity_path));
    }
    const readModelIdentityHashes = new Set(
      current.state_manifest?.read_model_identity_hashes ?? []
    );
    if (projectionReference) {
      readModelIdentityHashes.add(pathHash(projectionReference.identity_path));
    }
    const stateManifest = sealRecord<GitStateManifestContent>({
      schema_version: GIT_TRUSTED_STATE_SCHEMA_VERSION,
      stream_id: this.#streamId,
      scope: this.#scope,
      latest_sequence: sequence,
      latest_journal_hash: execution.record.integrity_hash,
      previous_state_manifest_hash: current.state_manifest?.integrity_hash ?? null,
      generated_at: execution.record.provenance.recorded_at,
      execution_manifests: [
        ...(current.state_manifest?.execution_manifests ?? []),
        {
          sequence,
          path: executionManifestPath,
          integrity_hash: executionManifest.integrity_hash
        }
      ],
      artifact_identity_hashes: [...artifactIdentityHashes].sort(),
      read_model_identity_hashes: [...readModelIdentityHashes].sort()
    });
    const stateSnapshotPath = this.#stateManifestSnapshotPath(
      stateManifest.integrity_hash
    );
    immutable.set(stateSnapshotPath, canonicalSerialize(stateManifest));
    mutable.set(this.#stateManifestPath(), canonicalSerialize(stateManifest));
    const head: GitJournalHead = {
      schema_version: GIT_TRUSTED_STATE_SCHEMA_VERSION,
      stream_id: this.#streamId,
      scope: this.#scope,
      latest_sequence: sequence,
      latest_journal_hash: execution.record.integrity_hash,
      state_commit: expectedParent,
      state_commit_role: "EXPECTED_PARENT",
      checkpoint_reference: null,
      manifest_hash: stateManifest.integrity_hash
    };
    mutable.set(this.#journalHeadPath(), canonicalSerialize(head));
    return { immutable, mutable };
  }

  #persistProjection(
    projection: TrustedPresentationReadModelProjection,
    existingIdentities: ReadonlyMap<string, GitReadModelIdentity>,
    immutable: Map<string, string>
  ): GitExecutionProjectionReference {
    const objectPath = this.#readModelObjectPath(projection.artifact_hash);
    const identityPath = this.#readModelIdentityPath(
      projection.presentation_read_model_id
    );
    const identity: GitReadModelIdentity = {
      schema_version: GIT_TRUSTED_STATE_SCHEMA_VERSION,
      presentation_read_model_id: projection.presentation_read_model_id,
      artifact_hash: projection.artifact_hash,
      seal: projection.seal,
      object_path: objectPath
    };
    const identityKey = projection.presentation_read_model_id;
    const existing = existingIdentities.get(identityKey);
    if (existing && canonicalSerialize(existing) !== canonicalSerialize(identity)) {
      throw new GitAppendOnlyExecutionStoreError(
        "IDENTITY_COLLISION",
        `PresentationReadModel identity collision: ${identityKey}`
      );
    }
    immutable.set(objectPath, projection.canonical_bytes);
    immutable.set(identityPath, canonicalSerialize(identity));
    return {
      presentation_read_model_id: projection.presentation_read_model_id,
      identity_path: identityPath,
      object_path: objectPath,
      artifact_hash: projection.artifact_hash,
      seal: projection.seal
    };
  }

  #validateProposedFiles(
    execution: TrustedRestorationExecution<Command>,
    proposed: ProposedFiles,
    current: LoadedGitState<Command>
  ) {
    for (const [relativePath, bytes] of proposed.immutable) {
      if (!relativePath.startsWith(`${this.#statePath}/`)
          || canonicalFileBytes(relativePath, bytes) !== bytes) {
        throw new GitAppendOnlyExecutionStoreError(
          "INVALID_LAYOUT",
          `Proposed immutable file is not canonical: ${relativePath}`
        );
      }
    }
    for (const [relativePath, bytes] of proposed.mutable) {
      if (!relativePath.startsWith(`${this.#statePath}/`)
          || canonicalFileBytes(relativePath, bytes) !== bytes) {
        throw new GitAppendOnlyExecutionStoreError(
          "INVALID_LAYOUT",
          `Proposed mutable file is not canonical: ${relativePath}`
        );
      }
    }
    const stateManifest = decodeCanonicalFile<GitStateManifest>(
      proposed.mutable.get(this.#stateManifestPath())!,
      "state manifest"
    );
    assertSealedRecord(stateManifest, "state manifest");
    const head = decodeCanonicalFile<GitJournalHead>(
      proposed.mutable.get(this.#journalHeadPath())!,
      "journal head"
    );
    if (head.manifest_hash !== stateManifest.integrity_hash
        || head.latest_sequence !== execution.record.sequence
        || head.latest_journal_hash !== execution.record.integrity_hash) {
      throw new GitAppendOnlyExecutionStoreError(
        "STATE_TAMPERED",
        "Proposed journal head does not match the proposed state manifest"
      );
    }
    const priorRecords = current.executions.map((item) => item.record);
    assertTrustedRestorationSequence(
      [...priorRecords, execution.record],
      this.#scope
    );
  }

  #materializeProposedFiles(proposed: ProposedFiles) {
    for (const [relativePath, bytes] of proposed.immutable) {
      const absolutePath = this.#absolutePath(relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      if (existsSync(absolutePath)) {
        if (readFileSync(absolutePath, "utf8") !== bytes) {
          throw new GitAppendOnlyExecutionStoreError(
            "IDENTITY_COLLISION",
            `Immutable Git state file collision: ${relativePath}`
          );
        }
        continue;
      }
      writeFileSync(absolutePath, bytes, { encoding: "utf8", flag: "wx" });
    }
    for (const [relativePath, bytes] of proposed.mutable) {
      const absolutePath = this.#absolutePath(relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, bytes, "utf8");
    }
  }

  #loadState(commit: string): LoadedGitState<Command> {
    const headBytes = this.#tryReadCommittedFile(commit, this.#journalHeadPath());
    if (headBytes === null) {
      if (this.#listCommittedStateFiles(commit).length > 0) {
        throw tampered("Trusted state files exist without a journal head");
      }
      return emptyState();
    }
    const head = decodeCanonicalFile<GitJournalHead>(headBytes, "journal head");
    this.#assertHead(head);
    const stateBytes = this.#readCommittedFile(commit, this.#stateManifestPath());
    const stateManifest = decodeCanonicalFile<GitStateManifest>(
      stateBytes,
      "state manifest"
    );
    assertSealedRecord(stateManifest, "state manifest");
    if (head.manifest_hash !== stateManifest.integrity_hash
        || head.latest_sequence !== stateManifest.latest_sequence
        || head.latest_journal_hash !== stateManifest.latest_journal_hash) {
      throw tampered("Journal head does not match the state manifest");
    }
    const snapshot = this.#readCommittedFile(
      commit,
      this.#stateManifestSnapshotPath(stateManifest.integrity_hash)
    );
    if (snapshot !== stateBytes) {
      throw tampered("Mutable state manifest does not match its immutable snapshot");
    }
    const expectedFiles = new Set<string>([
      this.#journalHeadPath(),
      this.#stateManifestPath(),
      this.#stateManifestSnapshotPath(stateManifest.integrity_hash)
    ]);
    for (const historicalHash of this.#verifyStateManifestHistory(
      commit,
      stateManifest
    )) {
      expectedFiles.add(this.#stateManifestSnapshotPath(historicalHash));
    }
    this.#assertHeadCommit(commit, head);

    const executions: TrustedRestorationExecution<Command>[] = [];
    const artifactIdentities = new Map<string, GitArtifactIdentity>();
    const readModelIdentities = new Map<string, GitReadModelIdentity>();
    const executionManifestHashes: string[] = [];
    let previousManifestHash: string | null = null;
    for (const reference of stateManifest.execution_manifests) {
      const expectedSequence = executions.length + 1;
      if (reference.sequence !== expectedSequence
          || reference.path !== this.#executionManifestPath(expectedSequence)) {
        throw tampered(`Execution manifest order is invalid at ${expectedSequence}`);
      }
      const manifest = decodeCanonicalFile<GitExecutionManifest>(
        this.#readCommittedFile(commit, reference.path),
        `execution manifest ${expectedSequence}`
      );
      expectedFiles.add(reference.path);
      assertSealedRecord(manifest, `execution manifest ${expectedSequence}`);
      if (manifest.integrity_hash !== reference.integrity_hash
          || manifest.previous_execution_manifest_hash !== previousManifestHash
          || manifest.sequence !== expectedSequence
          || manifest.stream_id !== this.#streamId
          || manifest.scope !== this.#scope) {
        throw tampered(`Execution manifest chain is invalid at ${expectedSequence}`);
      }
      const record = decodeCanonicalFile<TrustedRestorationRecord<Command>>(
        this.#readCommittedFile(commit, manifest.journal_segment_path),
        `journal segment ${expectedSequence}`
      );
      expectedFiles.add(manifest.journal_segment_path);
      assertTrustedRestorationRecordIntegrity(record);
      if (record.sequence !== expectedSequence
          || record.restoration_record_id !== manifest.restoration_record_id
          || canonicalHash(record) !== manifest.journal_record_hash) {
        throw tampered(`Journal segment does not match manifest ${expectedSequence}`);
      }
      const envelopes = manifest.artifact_references.map((artifactReference) => {
        expectedFiles.add(artifactReference.identity_path);
        expectedFiles.add(artifactReference.object_path);
        const identity = decodeCanonicalFile<GitArtifactIdentity>(
          this.#readCommittedFile(commit, artifactReference.identity_path),
          `artifact identity ${artifactReference.artifact_id}`
        );
        const envelope = decodeCanonicalFile<TrustedRestorationArtifactEnvelope>(
          this.#readCommittedFile(commit, artifactReference.object_path),
          `artifact envelope ${artifactReference.artifact_id}`
        );
        assertTrustedArtifactEnvelopeIntegrity(envelope);
        if (identity.artifact_kind !== artifactReference.artifact_kind
            || identity.artifact_id !== artifactReference.artifact_id
            || identity.object_path !== artifactReference.object_path
            || identity.envelope_integrity_hash
              !== artifactReference.envelope_integrity_hash
            || envelope.artifact_kind !== identity.artifact_kind
            || envelope.artifact_id !== identity.artifact_id
            || envelope.artifact_hash !== identity.artifact_hash
            || envelope.seal !== identity.seal
            || envelope.integrity_hash !== identity.envelope_integrity_hash) {
          throw tampered(`Artifact identity mismatch: ${artifactReference.artifact_id}`);
        }
        const key = artifactIdentityKey(identity.artifact_kind, identity.artifact_id);
        const existing = artifactIdentities.get(key);
        if (existing && canonicalSerialize(existing) !== canonicalSerialize(identity)) {
          throw collision(`Artifact identity collision: ${identity.artifact_id}`);
        }
        artifactIdentities.set(key, identity);
        return envelope;
      });
      const projection = manifest.read_model_projection
        ? this.#loadProjection(
            commit,
            manifest.read_model_projection,
            readModelIdentities,
            expectedFiles
          )
        : null;
      const execution = assertTrustedRestorationExecution({
        record,
        artifact_envelopes: envelopes,
        read_model_projection: projection
      });
      executions.push(execution);
      previousManifestHash = manifest.integrity_hash;
      executionManifestHashes.push(manifest.integrity_hash);
    }
    assertTrustedRestorationSequence(
      executions.map((execution) => execution.record),
      this.#scope
    );
    this.#assertAggregateState(
      head,
      stateManifest,
      executions,
      artifactIdentities,
      readModelIdentities
    );
    this.#assertUpstreamReferences(executions);
    const actualFiles = this.#listCommittedStateFiles(commit).sort();
    const manifestFiles = [...expectedFiles].sort();
    if (canonicalSerialize(actualFiles) !== canonicalSerialize(manifestFiles)) {
      throw tampered("Committed trusted-state layout contains unmanifested files");
    }
    return {
      head,
      state_manifest: stateManifest,
      executions,
      artifact_identities: artifactIdentities,
      read_model_identities: readModelIdentities,
      execution_manifest_hashes: executionManifestHashes
    };
  }

  #loadProjection(
    commit: string,
    reference: GitExecutionProjectionReference,
    identities: Map<string, GitReadModelIdentity>,
    expectedFiles: Set<string>
  ): TrustedPresentationReadModelProjection {
    expectedFiles.add(reference.identity_path);
    expectedFiles.add(reference.object_path);
    const identity = decodeCanonicalFile<GitReadModelIdentity>(
      this.#readCommittedFile(commit, reference.identity_path),
      `ReadModel identity ${reference.presentation_read_model_id}`
    );
    const canonicalBytes = this.#readCommittedFile(commit, reference.object_path);
    if (identity.presentation_read_model_id !== reference.presentation_read_model_id
        || identity.object_path !== reference.object_path
        || identity.artifact_hash !== reference.artifact_hash
        || identity.seal !== reference.seal
        || sha256(canonicalBytes) !== identity.artifact_hash) {
      throw tampered(
        `PresentationReadModel projection mismatch: ${reference.presentation_read_model_id}`
      );
    }
    const existing = identities.get(identity.presentation_read_model_id);
    if (existing && canonicalSerialize(existing) !== canonicalSerialize(identity)) {
      throw collision(
        `PresentationReadModel identity collision: ${identity.presentation_read_model_id}`
      );
    }
    identities.set(identity.presentation_read_model_id, identity);
    return {
      presentation_read_model_id: identity.presentation_read_model_id,
      canonical_bytes: canonicalBytes,
      artifact_hash: identity.artifact_hash,
      seal: identity.seal,
      record: canonicalDeserialize(canonicalBytes)
    };
  }

  #assertAggregateState(
    head: GitJournalHead,
    manifest: GitStateManifest,
    executions: readonly TrustedRestorationExecution<Command>[],
    artifactIdentities: ReadonlyMap<string, GitArtifactIdentity>,
    readModelIdentities: ReadonlyMap<string, GitReadModelIdentity>
  ) {
    const latest = executions.at(-1)?.record ?? null;
    if (head.latest_sequence !== executions.length
        || manifest.latest_sequence !== executions.length
        || head.latest_journal_hash !== (latest?.integrity_hash ?? null)) {
      throw tampered("Aggregate state does not match the journal head");
    }
    const actualArtifactHashes = [...artifactIdentities.values()]
      .map((identity) => pathHash(this.#artifactIdentityPathFromIdentity(identity)))
      .sort();
    const actualReadModelHashes = [...readModelIdentities.values()]
      .map((identity) => pathHash(
        this.#readModelIdentityPath(identity.presentation_read_model_id)
      ))
      .sort();
    if (canonicalSerialize(actualArtifactHashes)
          !== canonicalSerialize(manifest.artifact_identity_hashes)
        || canonicalSerialize(actualReadModelHashes)
          !== canonicalSerialize(manifest.read_model_identity_hashes)) {
      throw tampered("State manifest identity set does not match persisted executions");
    }
  }

  #assertUpstreamReferences(
    executions: readonly TrustedRestorationExecution<Command>[]
  ) {
    const seals = new Map<string, string>();
    for (const execution of executions) {
      for (const envelope of execution.artifact_envelopes) {
        seals.set(
          artifactIdentityKey(envelope.artifact_kind, envelope.artifact_id),
          envelope.seal
        );
      }
    }
    for (const execution of executions) {
      for (const envelope of execution.artifact_envelopes) {
        for (const upstream of envelope.upstream_references) {
          const actual = seals.get(artifactIdentityKey(
            upstream.upstream_artifact_kind,
            upstream.upstream_artifact_id
          ));
          if (actual !== upstream.expected_seal) {
            throw new TrustedRestorationError(
              "UPSTREAM_REFERENCE_FAILURE",
              `Persisted upstream reference is unavailable: ${upstream.upstream_artifact_id}`
            );
          }
        }
      }
    }
  }

  #verifyStateManifestHistory(commit: string, current: GitStateManifest) {
    const historicalHashes: string[] = [];
    let previousHash = current.previous_state_manifest_hash;
    let maximumSequence = current.latest_sequence;
    while (previousHash) {
      const previous = decodeCanonicalFile<GitStateManifest>(
        this.#readCommittedFile(commit, this.#stateManifestSnapshotPath(previousHash)),
        `state manifest snapshot ${previousHash}`
      );
      assertSealedRecord(previous, "state manifest snapshot");
      if (previous.integrity_hash !== previousHash
          || previous.latest_sequence >= maximumSequence) {
        throw tampered("State manifest history is invalid");
      }
      maximumSequence = previous.latest_sequence;
      historicalHashes.push(previousHash);
      previousHash = previous.previous_state_manifest_hash;
    }
    return historicalHashes;
  }

  #assertHeadCommit(commit: string, head: GitJournalHead) {
    const stateCommit = this.#git([
      "log",
      "-1",
      "--format=%H",
      commit,
      "--",
      this.#journalHeadPath()
    ]).trim();
    if (!stateCommit) throw tampered("Journal head has no introducing Git commit");
    const parent = this.#git(["rev-parse", `${stateCommit}^`]).trim();
    if (head.state_commit !== parent) {
      throw tampered("Journal head expected-parent commit is invalid");
    }
  }

  #assertHead(head: GitJournalHead) {
    if (head.schema_version !== GIT_TRUSTED_STATE_SCHEMA_VERSION
        || head.stream_id !== this.#streamId
        || head.scope !== this.#scope
        || head.state_commit_role !== "EXPECTED_PARENT"
        || head.checkpoint_reference !== null
        || !head.state_commit.trim()
        || !head.manifest_hash.trim()) {
      throw tampered("Journal head identity is invalid");
    }
  }

  #assertArtifactIdentityAvailable(
    identity: GitArtifactIdentity,
    existingIdentities: ReadonlyMap<string, GitArtifactIdentity>
  ) {
    const key = artifactIdentityKey(identity.artifact_kind, identity.artifact_id);
    const existing = existingIdentities.get(key);
    if (existing && canonicalSerialize(existing) !== canonicalSerialize(identity)) {
      throw collision(`Artifact identity collision: ${identity.artifact_id}`);
    }
  }

  #assertCleanStatePath() {
    const staged = this.#git(["diff", "--cached", "--name-only"]);
    if (staged.trim()) {
      throw new GitAppendOnlyExecutionStoreError(
        "DIRTY_STATE_PATH",
        "Git index must be empty before an authoritative append"
      );
    }
    const status = this.#git([
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      this.#statePath
    ]);
    if (status.trim()) {
      throw new GitAppendOnlyExecutionStoreError(
        "DIRTY_STATE_PATH",
        "Trusted state path has uncommitted changes; use a fresh checkout"
      );
    }
  }

  async #assertRemoteExpectedParent(expectedParent: string) {
    if (!this.#remote) return;
    const remoteHead = this.#remoteHead();
    if (remoteHead !== expectedParent) {
      throw new GitAppendOnlyExecutionStoreError(
        "CAS_MISMATCH",
        `Remote head changed: expected ${expectedParent}, found ${remoteHead}`
      );
    }
  }

  #push(expectedParent: string) {
    if (!this.#remote) return;
    const remoteHead = this.#remoteHead();
    if (remoteHead !== expectedParent) {
      throw new GitAppendOnlyExecutionStoreError(
        "CAS_MISMATCH",
        `Remote head changed before push: expected ${expectedParent}, found ${remoteHead}`
      );
    }
    try {
      this.#git([
        "push",
        "--porcelain",
        this.#remote.name,
        `HEAD:refs/heads/${this.#remote.branch}`
      ]);
    } catch (error) {
      throw new GitAppendOnlyExecutionStoreError(
        "CAS_MISMATCH",
        `Authoritative push was rejected; fresh checkout required: ${errorMessage(error)}`
      );
    }
  }

  #remoteHead() {
    if (!this.#remote) throw new Error("Remote is unavailable");
    const output = this.#git([
      "ls-remote",
      "--heads",
      this.#remote.name,
      `refs/heads/${this.#remote.branch}`
    ]).trim();
    const [commit] = output.split(/\s+/u);
    if (!commit) {
      throw new GitAppendOnlyExecutionStoreError(
        "CAS_MISMATCH",
        `Remote branch does not exist: ${this.#remote.branch}`
      );
    }
    return commit;
  }

  #commit(record: TrustedRestorationRecord<Command>) {
    const environment = {
      ...process.env,
      GIT_AUTHOR_DATE: record.provenance.recorded_at,
      GIT_COMMITTER_DATE: record.provenance.recorded_at
    };
    this.#git([
      "-c", `user.name=${this.#commitIdentity.name}`,
      "-c", `user.email=${this.#commitIdentity.email}`,
      "commit",
      "--no-gpg-sign",
      "-m", `trusted-state: append sequence ${record.sequence}`
    ], environment);
  }

  #headCommit() {
    return this.#git(["rev-parse", "HEAD"]).trim();
  }

  #readCommittedFile(commit: string, relativePath: string) {
    const value = this.#tryReadCommittedFile(commit, relativePath);
    if (value === null) throw tampered(`Committed state file is missing: ${relativePath}`);
    return value;
  }

  #tryReadCommittedFile(commit: string, relativePath: string) {
    try {
      return this.#git(["show", `${commit}:${relativePath}`]);
    } catch {
      return null;
    }
  }

  #listCommittedStateFiles(commit: string) {
    const output = this.#git([
      "ls-tree",
      "-r",
      "--name-only",
      commit,
      "--",
      this.#statePath
    ]).trim();
    return output ? output.split(/\r?\n/u) : [];
  }

  #git(args: readonly string[], environment = process.env) {
    try {
      return execFileSync("git", [...args], {
        cwd: this.#repositoryPath,
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      if (error instanceof GitAppendOnlyExecutionStoreError) throw error;
      throw new GitAppendOnlyExecutionStoreError(
        "GIT_OPERATION_FAILED",
        `Git operation failed (${args[0] ?? "unknown"}): ${errorMessage(error)}`
      );
    }
  }

  #absolutePath(relativePath: string) {
    return path.join(this.#repositoryPath, ...relativePath.split("/"));
  }

  #journalSegmentPath(sequence: number) {
    return `${this.#statePath}/journal/segments/${sequenceName(sequence)}.json`;
  }

  #journalHeadPath() {
    return `${this.#statePath}/journal/head.json`;
  }

  #executionManifestPath(sequence: number) {
    return `${this.#statePath}/manifests/executions/${sequenceName(sequence)}.json`;
  }

  #stateManifestPath() {
    return `${this.#statePath}/state-manifest.json`;
  }

  #stateManifestSnapshotPath(integrityHash: string) {
    return `${this.#statePath}/manifests/states/${integrityHash}.json`;
  }

  #artifactObjectPath(envelope: TrustedRestorationArtifactEnvelope) {
    return `${this.#statePath}/artifacts/objects/${envelope.integrity_hash}.json`;
  }

  #artifactIdentityPath(envelope: TrustedRestorationArtifactEnvelope) {
    return this.#artifactIdentityPathFromIdentity({
      artifact_kind: envelope.artifact_kind,
      artifact_id: envelope.artifact_id
    });
  }

  #artifactIdentityPathFromIdentity(identity: {
    readonly artifact_kind: string;
    readonly artifact_id: string;
  }) {
    const kind = safeKind(identity.artifact_kind);
    const identityHash = canonicalHash({
      artifact_kind: identity.artifact_kind,
      artifact_id: identity.artifact_id
    });
    return `${this.#statePath}/artifacts/identities/${kind}/${identityHash}.json`;
  }

  #readModelObjectPath(artifactHash: string) {
    return `${this.#statePath}/read-model/objects/${artifactHash}.json`;
  }

  #readModelIdentityPath(readModelId: string) {
    return `${this.#statePath}/read-model/identities/${canonicalHash({
      presentation_read_model_id: readModelId
    })}.json`;
  }
}

function emptyState<Command>(): LoadedGitState<Command> {
  return {
    head: null,
    state_manifest: null,
    executions: [],
    artifact_identities: new Map(),
    read_model_identities: new Map(),
    execution_manifest_hashes: []
  };
}

function sealRecord<Content extends object>(content: Content) {
  return {
    ...content,
    integrity_hash: canonicalHash(content)
  };
}

function assertSealedRecord(
  value: { readonly integrity_hash: string },
  label: string
) {
  const { integrity_hash: integrityHash, ...content } = value;
  if (integrityHash !== canonicalHash(content)) {
    throw tampered(`${label} integrity hash is invalid`);
  }
}

function decodeCanonicalFile<Value>(bytes: string, label: string): Value {
  let value: Value;
  try {
    value = canonicalDeserialize<Value>(bytes);
  } catch (error) {
    throw tampered(`${label} is not valid canonical JSON: ${errorMessage(error)}`);
  }
  if (canonicalSerialize(value) !== bytes) {
    throw tampered(`${label} bytes are not canonical`);
  }
  return value;
}

function canonicalFileBytes(relativePath: string, bytes: string) {
  if (relativePath.includes("/read-model/objects/")) {
    return canonicalSerialize(canonicalDeserialize(bytes));
  }
  return canonicalSerialize(canonicalDeserialize(bytes));
}

function writeFileMap(
  root: string,
  files: ReadonlyMap<string, string>,
  exclusive: boolean
) {
  for (const [relativePath, bytes] of files) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes, {
      encoding: "utf8",
      flag: exclusive ? "wx" : "w"
    });
  }
}

function normalizeStatePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized
      || normalized.startsWith("/")
      || normalized.includes("../")
      || normalized === ".."
      || normalized.endsWith("/")) {
    throw new GitAppendOnlyExecutionStoreError(
      "INVALID_LAYOUT",
      "Trusted state path must be a repository-relative path"
    );
  }
  return normalized;
}

function safeKind(value: string) {
  const label = value.toLowerCase().replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "artifact";
  return `${label}-${canonicalHash(value).slice(0, 12)}`;
}

function sequenceName(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new GitAppendOnlyExecutionStoreError(
      "INVALID_LAYOUT",
      "Journal sequence must be a positive safe integer"
    );
  }
  return sequence.toString().padStart(12, "0");
}

function artifactIdentityKey(kind: string, id: string) {
  return `${kind}\0${id}`;
}

function compareCanonical(left: unknown, right: unknown) {
  return canonicalSerialize(left).localeCompare(canonicalSerialize(right));
}

function pathHash(value: string) {
  return sha256(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function required(value: string, label: string) {
  if (!value.trim()) {
    throw new GitAppendOnlyExecutionStoreError(
      "INVALID_LAYOUT",
      `${label} is required`
    );
  }
  return value;
}

function tampered(message: string) {
  return new GitAppendOnlyExecutionStoreError("STATE_TAMPERED", message);
}

function collision(message: string) {
  return new GitAppendOnlyExecutionStoreError("IDENTITY_COLLISION", message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
