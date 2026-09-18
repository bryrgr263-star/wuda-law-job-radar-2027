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

import {
  assertTrustedRestorationExecution,
  type TrustedChainCommand,
  type TrustedRestorationExecution,
  type TrustedRestorationJournalRepository,
  type TrustedRestorationRecord
} from "../ingestion";
import {
  canonicalDeserialize,
  canonicalHash,
  canonicalSerialize
} from "../ingestion/normalization/canonical-artifact-registry";
import {
  PRODUCTION_RAW_BUCKET,
  ProductionPersistenceError,
  assertRawBlobManifest,
  rawBlobObjectKey,
  type AcquisitionPersistenceBundle,
  type PrivateRawObjectStorage,
  type ProductionAppendOutcome,
  type ProductionSourceFactRepository,
  type ProductionSourceRegistryRepository,
  assertSourcePersistenceVersion,
  assertOfficialRequestAllowed,
  type RawBlobManifest
} from "./contracts";
import { evaluateSourceAutomationPermission } from "../application/source-admission";
import type { SOVDiscoveryEvidence } from "../ingestion/normalization/source-discovery-support";
import { isExtractedRecordV2 } from "../ingestion/normalization/extracted-record-identity";
import { ProductionRawObjectBoundary } from "./raw-object-boundary";

export const GIT_RAW_STATE_SCHEMA_VERSION = "git-raw-state/1.0.0" as const;
export const GIT_RAW_RECOMMENDED_OBJECT_BYTES = 25 * 1024 * 1024;
export const GIT_RAW_HARD_OBJECT_BYTES = 95 * 1024 * 1024;
export const GIT_RAW_ANNUAL_ARCHIVE_BYTES = 1024 * 1024 * 1024;
export const GIT_RAW_REPOSITORY_BYTES = 2 * 1024 * 1024 * 1024;

const GIT_RAW_ATTRIBUTES = "* -text\n**/* -text\n";

export type GitRawPersistenceFaultPoint =
  | "AFTER_TEMPORARY_OBJECTS"
  | "BEFORE_COMMIT"
  | "AFTER_COMMIT"
  | "BEFORE_PUSH";

export interface GitRawObjectPersistenceOptions {
  readonly repository_path: string;
  readonly root_path?: string;
  readonly limits?: {
    readonly max_object_bytes?: number;
    readonly annual_archive_bytes?: number;
    readonly max_repository_bytes?: number;
  };
  readonly remote?: {
    readonly name: string;
    readonly branch: string;
  };
  readonly fault_injector?: (
    point: GitRawPersistenceFaultPoint
  ) => void | Promise<void>;
}

interface StagedObject {
  readonly bytes: Uint8Array;
  readonly content_type: string;
}

interface GitRawFactReference {
  readonly identity: string;
  readonly path: string;
  readonly content_hash: string;
}

interface GitRawAcquisitionManifestContent {
  readonly schema_version: typeof GIT_RAW_STATE_SCHEMA_VERSION;
  readonly sequence: number;
  readonly acquisition_run_id: string;
  readonly previous_acquisition_manifest_hash: string | null;
  readonly acquisition_run: GitRawFactReference;
  readonly raw_blob_manifest: GitRawFactReference | null;
  readonly object_path: string | null;
  readonly snapshot: GitRawFactReference;
  readonly extracted_records: readonly GitRawFactReference[];
  readonly bundle_hash: string;
}

interface GitRawAcquisitionManifest extends GitRawAcquisitionManifestContent {
  readonly integrity_hash: string;
}

interface GitRawStateAcquisitionReference {
  readonly sequence: number;
  readonly path: string;
  readonly integrity_hash: string;
}

interface GitRawStateManifestContent {
  readonly schema_version: typeof GIT_RAW_STATE_SCHEMA_VERSION;
  readonly latest_sequence: number;
  readonly previous_state_manifest_hash: string | null;
  readonly state_commit: string;
  readonly state_commit_role: "EXPECTED_PARENT";
  readonly generated_at: string;
  readonly total_object_bytes: number;
  readonly acquisitions: readonly GitRawStateAcquisitionReference[];
}

interface GitRawStateManifest extends GitRawStateManifestContent {
  readonly integrity_hash: string;
}

interface LoadedRawState {
  readonly state_manifest: GitRawStateManifest | null;
  readonly acquisitions: readonly AcquisitionPersistenceBundle[];
  readonly acquisition_manifest_hashes: readonly string[];
  readonly total_object_bytes: number;
}

interface ProposedFiles {
  readonly immutable: ReadonlyMap<string, Uint8Array>;
  readonly mutable: ReadonlyMap<string, Uint8Array>;
}

export class GitRawObjectPersistence implements
PrivateRawObjectStorage, ProductionSourceFactRepository {
  readonly #repositoryPath: string;
  readonly #rootPath: string;
  readonly #maxObjectBytes: number;
  readonly #annualArchiveBytes: number;
  readonly #maxRepositoryBytes: number;
  readonly #remote: GitRawObjectPersistenceOptions["remote"];
  readonly #faultInjector: GitRawObjectPersistenceOptions["fault_injector"];
  readonly #stagedObjects = new Map<string, StagedObject>();

  constructor(options: GitRawObjectPersistenceOptions) {
    this.#repositoryPath = path.resolve(options.repository_path);
    this.#rootPath = normalizeRootPath(options.root_path ?? "trusted-objects");
    this.#maxObjectBytes = positiveLimit(
      options.limits?.max_object_bytes ?? GIT_RAW_HARD_OBJECT_BYTES,
      "max_object_bytes"
    );
    this.#annualArchiveBytes = positiveLimit(
      options.limits?.annual_archive_bytes ?? GIT_RAW_ANNUAL_ARCHIVE_BYTES,
      "annual_archive_bytes"
    );
    this.#maxRepositoryBytes = positiveLimit(
      options.limits?.max_repository_bytes ?? GIT_RAW_REPOSITORY_BYTES,
      "max_repository_bytes"
    );
    this.#remote = options.remote;
    this.#faultInjector = options.fault_injector;
    this.#gitText(["rev-parse", "--git-dir"]);
  }

  async putIfAbsent(input: {
    readonly bucket: typeof PRODUCTION_RAW_BUCKET;
    readonly object_key: string;
    readonly bytes: Uint8Array;
    readonly content_type: string;
  }) {
    if (input.bucket !== PRODUCTION_RAW_BUCKET || !input.content_type.trim()) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        "Git Raw storage accepts only the production Raw bucket and a content type"
      );
    }
    if (input.bytes.byteLength > this.#maxObjectBytes) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        `RawBlob exceeds the Git object limit (${this.#maxObjectBytes} bytes)`
      );
    }
    const actualHash = sha256Bytes(input.bytes);
    if (input.object_key !== rawBlobObjectKey(actualHash)) {
      throw new ProductionPersistenceError(
        "HASH_MISMATCH",
        "RawBlob object key does not match its bytes"
      );
    }
    const staged = this.#stagedObjects.get(input.object_key);
    if (staged) {
      assertSameBytes(staged.bytes, input.bytes, input.object_key);
      return "ALREADY_EXISTS" as const;
    }
    const commit = this.#headCommit();
    const committed = this.#tryReadCommittedBytes(
      commit,
      this.#objectPath(input.object_key)
    );
    if (committed) {
      assertSameBytes(committed, input.bytes, input.object_key);
      return "ALREADY_EXISTS" as const;
    }
    this.#stagedObjects.set(input.object_key, {
      bytes: new Uint8Array(input.bytes),
      content_type: input.content_type
    });
    return "CREATED" as const;
  }

  async read(input: {
    readonly bucket: typeof PRODUCTION_RAW_BUCKET;
    readonly object_key: string;
  }) {
    if (input.bucket !== PRODUCTION_RAW_BUCKET) return null;
    const staged = this.#stagedObjects.get(input.object_key);
    if (staged) return new Uint8Array(staged.bytes);
    const bytes = this.#tryReadCommittedBytes(
      this.#headCommit(),
      this.#objectPath(input.object_key)
    );
    return bytes ? new Uint8Array(bytes) : null;
  }

  async appendAcquisitionBundle(
    bundle: AcquisitionPersistenceBundle
  ): Promise<ProductionAppendOutcome> {
    const validated = assertAcquisitionBundle(bundle);
    this.#assertCleanRootPath();
    const expectedParent = this.#headCommit();
    this.#assertRemoteExpectedParent(expectedParent);
    const current = this.#loadState(expectedParent);
    const existing = current.acquisitions.find((candidate) => {
      return candidate.acquisition_run.acquisition_run_id
        === validated.acquisition_run.acquisition_run_id;
    });
    if (existing) {
      if (canonicalSerialize(existing) !== canonicalSerialize(validated)) {
        throw new ProductionPersistenceError(
          "COLLISION",
          `Acquisition identity collision: ${validated.acquisition_run.acquisition_run_id}`
        );
      }
      this.#releaseStagedObject(validated.raw_blob_manifest);
      return "IDEMPOTENT_REUSE";
    }
    this.#assertFactIdentitiesAvailable(validated, current.acquisitions);
    const proposed = this.#buildProposedFiles(validated, current, expectedParent);
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "trusted-git-raw-"));
    try {
      writeProposedFiles(temporaryRoot, proposed);
      this.#validateProposedFiles(validated, proposed, current);
      await this.#faultInjector?.("AFTER_TEMPORARY_OBJECTS");
      this.#materializeProposedFiles(proposed);
      this.#gitText(["add", "--", this.#rootPath]);
      await this.#faultInjector?.("BEFORE_COMMIT");
      this.#commit(validated);
      await this.#faultInjector?.("AFTER_COMMIT");
      if (this.#remote) {
        await this.#faultInjector?.("BEFORE_PUSH");
        this.#push(expectedParent);
      }
      this.#releaseStagedObject(validated.raw_blob_manifest);
      return "APPENDED";
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  async getRawBlobManifest(rawBlobId: string) {
    const state = this.#loadState(this.#headCommit());
    const manifests = state.acquisitions.flatMap((bundle) => {
      return bundle.raw_blob_manifest ? [bundle.raw_blob_manifest] : [];
    }).filter((manifest) => manifest.raw_blob_id === rawBlobId);
    if (manifests.length === 0) return null;
    const first = manifests[0]!;
    if (manifests.some((manifest) => {
      return canonicalSerialize(manifest) !== canonicalSerialize(first);
    })) {
      throw new ProductionPersistenceError(
        "COLLISION",
        `RawBlob manifest collision: ${rawBlobId}`
      );
    }
    return structuredClone(first);
  }

  async listVerifiedAcquisitions() {
    return structuredClone(this.#loadState(this.#headCommit()).acquisitions);
  }

  prepareAtomicCommit(expectedParent: string) {
    const current = this.#loadState(this.#headCommit());
    const state = current.state_manifest;
    if (!state || state.state_commit === expectedParent) return;
    this.#gitText(["merge-base", "--is-ancestor", expectedParent, "HEAD"]);
    const reanchored = sealRecord<GitRawStateManifestContent>({
      schema_version: state.schema_version,
      latest_sequence: state.latest_sequence,
      previous_state_manifest_hash: state.previous_state_manifest_hash,
      state_commit: expectedParent,
      state_commit_role: "EXPECTED_PARENT",
      generated_at: state.generated_at,
      total_object_bytes: state.total_object_bytes,
      acquisitions: state.acquisitions
    });
    const oldSnapshot = this.#absolutePath(this.#stateSnapshotPath(state.integrity_hash));
    const newSnapshot = this.#absolutePath(
      this.#stateSnapshotPath(reanchored.integrity_hash)
    );
    if (oldSnapshot !== newSnapshot) rmSync(oldSnapshot);
    mkdirSync(path.dirname(newSnapshot), { recursive: true });
    const bytes = canonicalBytes(reanchored);
    if (existsSync(newSnapshot)) {
      assertSameBytes(readFileSync(newSnapshot), bytes, newSnapshot);
    } else {
      writeFileSync(newSnapshot, bytes, { flag: "wx" });
    }
    writeFileSync(this.#absolutePath(this.#stateManifestPath()), bytes);
  }

  #buildProposedFiles(
    bundle: AcquisitionPersistenceBundle,
    current: LoadedRawState,
    expectedParent: string
  ): ProposedFiles {
    const immutable = new Map<string, Uint8Array>();
    const mutable = new Map<string, Uint8Array>();
    immutable.set(this.#attributesPath(), textBytes(GIT_RAW_ATTRIBUTES));
    const sequence = current.acquisitions.length + 1;
    const acquisitionRunReference = this.#factReference(
      "acquisition-runs",
      bundle.acquisition_run.acquisition_run_id,
      bundle.acquisition_run,
      immutable
    );
    const snapshotReference = this.#factReference(
      "snapshots",
      bundle.snapshot.snapshot_id,
      bundle.snapshot,
      immutable
    );
    const extractedReferences = bundle.extracted_records.map((record) => {
      return this.#factReference(
        "extracted-records",
        record.extracted_record_id,
        record,
        immutable
      );
    });
    let manifestReference: GitRawFactReference | null = null;
    let objectPath: string | null = null;
    let totalObjectBytes = current.total_object_bytes;
    if (bundle.raw_blob_manifest) {
      const manifest = bundle.raw_blob_manifest;
      manifestReference = this.#factReference(
        "raw-blob-manifests",
        manifest.raw_blob_id,
        manifest,
        immutable
      );
      objectPath = this.#objectPath(manifest.object_key);
      const committed = this.#tryReadCommittedBytes(expectedParent, objectPath);
      const staged = this.#stagedObjects.get(manifest.object_key)?.bytes ?? null;
      const bytes = staged ?? committed;
      if (!bytes) {
        throw new ProductionPersistenceError(
          "EVIDENCE_BLOCKED",
          `RawBlob object is unavailable: ${manifest.raw_blob_id}`
        );
      }
      verifyManifestObject(manifest, bytes);
      if (!committed) {
        totalObjectBytes += bytes.byteLength;
        immutable.set(objectPath, new Uint8Array(bytes));
      }
    }
    if (totalObjectBytes > this.#maxRepositoryBytes) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        "Git Raw repository hard growth limit is reached"
      );
    }
    if (totalObjectBytes > this.#annualArchiveBytes) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        "Git Raw annual archive threshold is reached; archive rollover is required"
      );
    }
    const acquisitionManifest = sealRecord<GitRawAcquisitionManifestContent>({
      schema_version: GIT_RAW_STATE_SCHEMA_VERSION,
      sequence,
      acquisition_run_id: bundle.acquisition_run.acquisition_run_id,
      previous_acquisition_manifest_hash:
        current.acquisition_manifest_hashes.at(-1) ?? null,
      acquisition_run: acquisitionRunReference,
      raw_blob_manifest: manifestReference,
      object_path: objectPath,
      snapshot: snapshotReference,
      extracted_records: extractedReferences,
      bundle_hash: canonicalHash(bundle)
    });
    const acquisitionPath = this.#acquisitionManifestPath(sequence);
    immutable.set(acquisitionPath, canonicalBytes(acquisitionManifest));
    const stateManifest = sealRecord<GitRawStateManifestContent>({
      schema_version: GIT_RAW_STATE_SCHEMA_VERSION,
      latest_sequence: sequence,
      previous_state_manifest_hash: current.state_manifest?.integrity_hash ?? null,
      state_commit: expectedParent,
      state_commit_role: "EXPECTED_PARENT",
      generated_at: bundle.acquisition_run.completed_at,
      total_object_bytes: totalObjectBytes,
      acquisitions: [
        ...(current.state_manifest?.acquisitions ?? []),
        {
          sequence,
          path: acquisitionPath,
          integrity_hash: acquisitionManifest.integrity_hash
        }
      ]
    });
    immutable.set(
      this.#stateSnapshotPath(stateManifest.integrity_hash),
      canonicalBytes(stateManifest)
    );
    mutable.set(this.#stateManifestPath(), canonicalBytes(stateManifest));
    return { immutable, mutable };
  }

  #factReference(
    collection: string,
    identity: string,
    value: unknown,
    files: Map<string, Uint8Array>
  ): GitRawFactReference {
    const bytes = canonicalSerialize(value);
    const contentHash = sha256Text(bytes);
    const factPath = `${this.#rootPath}/facts/${collection}/${canonicalHash({
      identity
    })}.json`;
    files.set(factPath, textBytes(bytes));
    return { identity, path: factPath, content_hash: contentHash };
  }

  #validateProposedFiles(
    bundle: AcquisitionPersistenceBundle,
    proposed: ProposedFiles,
    current: LoadedRawState
  ) {
    for (const [relativePath, bytes] of [
      ...proposed.immutable,
      ...proposed.mutable
    ]) {
      if (!relativePath.startsWith(`${this.#rootPath}/`)) {
        throw new ProductionPersistenceError(
          "INTEGRITY_MISMATCH",
          `Raw persistence path escapes its root: ${relativePath}`
        );
      }
      if (relativePath === this.#attributesPath()) {
        assertSameBytes(bytes, textBytes(GIT_RAW_ATTRIBUTES), relativePath);
        continue;
      }
      if (!relativePath.includes("/objects/sha256/")) {
        const text = Buffer.from(bytes).toString("utf8");
        const decoded = canonicalDeserialize(text);
        if (canonicalSerialize(decoded) !== text) {
          throw new ProductionPersistenceError(
            "INTEGRITY_MISMATCH",
            `Raw persistence file is not canonical: ${relativePath}`
          );
        }
      }
    }
    const state = decodeCanonical<GitRawStateManifest>(
      proposed.mutable.get(this.#stateManifestPath())!,
      "Raw state manifest"
    );
    assertSealed(state, "Raw state manifest");
    if (state.latest_sequence !== current.acquisitions.length + 1
        || state.acquisitions.length !== state.latest_sequence
        || state.total_object_bytes < current.total_object_bytes
        || canonicalHash(bundle) === "") {
      throw new ProductionPersistenceError(
        "INTEGRITY_MISMATCH",
        "Proposed Raw state manifest is invalid"
      );
    }
  }

  #materializeProposedFiles(proposed: ProposedFiles) {
    for (const [relativePath, bytes] of proposed.immutable) {
      const absolutePath = this.#absolutePath(relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      if (existsSync(absolutePath)) {
        assertSameBytes(readFileSync(absolutePath), bytes, relativePath);
      } else {
        writeFileSync(absolutePath, bytes, { flag: "wx" });
      }
    }
    for (const [relativePath, bytes] of proposed.mutable) {
      const absolutePath = this.#absolutePath(relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, bytes);
    }
  }

  #loadState(commit: string): LoadedRawState {
    const stateBytes = this.#tryReadCommittedBytes(commit, this.#stateManifestPath());
    if (!stateBytes) {
      this.#validateOrphanObjects(commit, new Set());
      return {
        state_manifest: null,
        acquisitions: [],
        acquisition_manifest_hashes: [],
        total_object_bytes: 0
      };
    }
    const state = decodeCanonical<GitRawStateManifest>(stateBytes, "Raw state manifest");
    assertSealed(state, "Raw state manifest");
    const snapshotPath = this.#stateSnapshotPath(state.integrity_hash);
    const snapshotBytes = this.#readCommittedBytes(commit, snapshotPath);
    assertSameBytes(snapshotBytes, stateBytes, snapshotPath);
    this.#verifyStateHistory(commit, state);
    this.#assertStateCommit(commit, state);

    const expectedFiles = new Set<string>([
      this.#stateManifestPath(),
      snapshotPath,
      ...this.#stateHistoryPaths(commit, state)
    ]);
    const attributes = this.#tryReadCommittedBytes(commit, this.#attributesPath());
    if (attributes) {
      assertSameBytes(attributes, textBytes(GIT_RAW_ATTRIBUTES), this.#attributesPath());
      expectedFiles.add(this.#attributesPath());
    }
    const acquisitions: AcquisitionPersistenceBundle[] = [];
    const acquisitionManifestHashes: string[] = [];
    let previousHash: string | null = null;
    const factIdentities = new Map<string, string>();
    const referencedObjects = new Set<string>();
    for (const reference of state.acquisitions) {
      const expectedSequence = acquisitions.length + 1;
      if (reference.sequence !== expectedSequence
          || reference.path !== this.#acquisitionManifestPath(expectedSequence)) {
        throw integrity(`Raw acquisition order is invalid at ${expectedSequence}`);
      }
      expectedFiles.add(reference.path);
      const manifest = decodeCanonical<GitRawAcquisitionManifest>(
        this.#readCommittedBytes(commit, reference.path),
        `Raw acquisition manifest ${expectedSequence}`
      );
      assertSealed(manifest, `Raw acquisition manifest ${expectedSequence}`);
      if (manifest.integrity_hash !== reference.integrity_hash
          || manifest.sequence !== expectedSequence
          || manifest.previous_acquisition_manifest_hash !== previousHash) {
        throw integrity(`Raw acquisition chain is invalid at ${expectedSequence}`);
      }
      const acquisitionRun = this.#loadFact(
        commit,
        manifest.acquisition_run,
        expectedFiles,
        factIdentities
      );
      const snapshot = this.#loadFact(
        commit,
        manifest.snapshot,
        expectedFiles,
        factIdentities
      );
      const extractedRecords = manifest.extracted_records.map((record) => {
        return this.#loadFact(commit, record, expectedFiles, factIdentities);
      });
      const rawManifest = manifest.raw_blob_manifest
        ? this.#loadFact(
            commit,
            manifest.raw_blob_manifest,
            expectedFiles,
            factIdentities
          ) as RawBlobManifest
        : null;
      if (rawManifest) {
        assertRawBlobManifest(rawManifest);
        if (!manifest.object_path) {
          throw integrity(`Raw acquisition has no object path at ${expectedSequence}`);
        }
        expectedFiles.add(manifest.object_path);
        referencedObjects.add(manifest.object_path);
        verifyManifestObject(
          rawManifest,
          this.#readCommittedBytes(commit, manifest.object_path)
        );
      } else if (manifest.object_path !== null) {
        throw integrity(`Failed acquisition unexpectedly references Raw bytes`);
      }
      const bundle = assertAcquisitionBundle({
        acquisition_run: acquisitionRun as AcquisitionPersistenceBundle["acquisition_run"],
        raw_blob_manifest: rawManifest,
        snapshot: snapshot as AcquisitionPersistenceBundle["snapshot"],
        extracted_records: extractedRecords as AcquisitionPersistenceBundle["extracted_records"]
      });
      if (canonicalHash(bundle) !== manifest.bundle_hash
          || bundle.acquisition_run.acquisition_run_id !== manifest.acquisition_run_id) {
        throw integrity(`Raw acquisition bundle hash mismatch at ${expectedSequence}`);
      }
      acquisitions.push(bundle);
      acquisitionManifestHashes.push(manifest.integrity_hash);
      previousHash = manifest.integrity_hash;
    }
    if (state.latest_sequence !== acquisitions.length) {
      throw integrity("Raw state sequence does not match its acquisition manifests");
    }
    const totalObjectBytes = [...new Set(acquisitions.flatMap((bundle) => {
      return bundle.raw_blob_manifest
        ? [`${bundle.raw_blob_manifest.raw_content_sha256}:${bundle.raw_blob_manifest.byte_length}`]
        : [];
    }))].reduce((total, entry) => total + Number(entry.split(":")[1]), 0);
    if (totalObjectBytes !== state.total_object_bytes) {
      throw integrity("Raw state object byte total is invalid");
    }
    this.#validateCommittedLayout(commit, expectedFiles, referencedObjects);
    return {
      state_manifest: state,
      acquisitions,
      acquisition_manifest_hashes: acquisitionManifestHashes,
      total_object_bytes: totalObjectBytes
    };
  }

  #loadFact(
    commit: string,
    reference: GitRawFactReference,
    expectedFiles: Set<string>,
    identities: Map<string, string>
  ) {
    expectedFiles.add(reference.path);
    const bytes = this.#readCommittedBytes(commit, reference.path);
    const value = decodeCanonical<unknown>(bytes, `Raw fact ${reference.identity}`);
    if (sha256Bytes(bytes) !== reference.content_hash) {
      throw integrity(`Raw fact hash mismatch: ${reference.identity}`);
    }
    const existing = identities.get(reference.identity);
    if (existing && existing !== reference.content_hash) {
      throw new ProductionPersistenceError(
        "COLLISION",
        `Raw fact identity collision: ${reference.identity}`
      );
    }
    identities.set(reference.identity, reference.content_hash);
    return value;
  }

  #validateCommittedLayout(
    commit: string,
    expectedFiles: Set<string>,
    referencedObjects: Set<string>
  ) {
    for (const file of this.#listCommittedFiles(commit)) {
      if (expectedFiles.has(file)) continue;
      if (file.startsWith(`${this.#rootPath}/objects/sha256/`)) continue;
      throw integrity(`Unmanifested Raw state file is not allowed: ${file}`);
    }
    this.#validateOrphanObjects(commit, referencedObjects);
  }

  #validateOrphanObjects(commit: string, referencedObjects: ReadonlySet<string>) {
    for (const file of this.#listCommittedFiles(commit)) {
      if (file === this.#attributesPath()) {
        assertSameBytes(
          this.#readCommittedBytes(commit, file),
          textBytes(GIT_RAW_ATTRIBUTES),
          file
        );
        continue;
      }
      if (!file.startsWith(`${this.#rootPath}/objects/sha256/`)
          || referencedObjects.has(file)) continue;
      const hash = file.split("/").at(-1) ?? "";
      const bytes = this.#readCommittedBytes(commit, file);
      if (!/^[a-f0-9]{64}$/u.test(hash) || sha256Bytes(bytes) !== hash) {
        throw integrity(`Orphan Raw object path/hash mismatch: ${file}`);
      }
    }
  }

  #verifyStateHistory(commit: string, current: GitRawStateManifest) {
    let previousHash = current.previous_state_manifest_hash;
    let maximumSequence = current.latest_sequence;
    while (previousHash) {
      const previous = decodeCanonical<GitRawStateManifest>(
        this.#readCommittedBytes(commit, this.#stateSnapshotPath(previousHash)),
        `Raw state snapshot ${previousHash}`
      );
      assertSealed(previous, "Raw state snapshot");
      if (previous.integrity_hash !== previousHash
          || previous.latest_sequence >= maximumSequence) {
        throw integrity("Raw state manifest history is invalid");
      }
      maximumSequence = previous.latest_sequence;
      previousHash = previous.previous_state_manifest_hash;
    }
  }

  #stateHistoryPaths(commit: string, current: GitRawStateManifest) {
    const paths: string[] = [];
    let previousHash = current.previous_state_manifest_hash;
    while (previousHash) {
      const statePath = this.#stateSnapshotPath(previousHash);
      paths.push(statePath);
      const previous = decodeCanonical<GitRawStateManifest>(
        this.#readCommittedBytes(commit, statePath),
        `Raw state snapshot ${previousHash}`
      );
      previousHash = previous.previous_state_manifest_hash;
    }
    return paths;
  }

  #assertStateCommit(commit: string, state: GitRawStateManifest) {
    const stateCommit = this.#gitText([
      "log",
      "-1",
      "--format=%H",
      commit,
      "--",
      this.#stateManifestPath()
    ]).trim();
    const parent = this.#gitText(["rev-parse", `${stateCommit}^`]).trim();
    if (state.state_commit_role !== "EXPECTED_PARENT" || state.state_commit !== parent) {
      throw integrity("Raw state expected-parent commit is invalid");
    }
  }

  #assertFactIdentitiesAvailable(
    bundle: AcquisitionPersistenceBundle,
    existingBundles: readonly AcquisitionPersistenceBundle[]
  ) {
    const candidates = [
      [bundle.snapshot.snapshot_id, bundle.snapshot],
      ...bundle.extracted_records.map((record) => [record.extracted_record_id, record] as const),
      ...(bundle.raw_blob_manifest
        ? [[bundle.raw_blob_manifest.raw_blob_id, bundle.raw_blob_manifest] as const]
        : [])
    ] as const;
    const existing = new Map<string, string>();
    for (const prior of existingBundles) {
      existing.set(prior.snapshot.snapshot_id, canonicalSerialize(prior.snapshot));
      for (const record of prior.extracted_records) {
        existing.set(record.extracted_record_id, canonicalSerialize(record));
      }
      if (prior.raw_blob_manifest) {
        const key = prior.raw_blob_manifest.raw_blob_id;
        const bytes = canonicalSerialize(prior.raw_blob_manifest);
        const priorBytes = existing.get(key);
        if (priorBytes && priorBytes !== bytes) {
          throw new ProductionPersistenceError("COLLISION", `Raw manifest collision: ${key}`);
        }
        existing.set(key, bytes);
      }
    }
    for (const [identity, value] of candidates) {
      const prior = existing.get(identity);
      if (prior && prior !== canonicalSerialize(value)) {
        throw new ProductionPersistenceError(
          "COLLISION",
          `Raw persistence identity collision: ${identity}`
        );
      }
    }
  }

  #releaseStagedObject(manifest: RawBlobManifest | null) {
    if (manifest) this.#stagedObjects.delete(manifest.object_key);
  }

  #assertCleanRootPath() {
    if (this.#gitText(["diff", "--cached", "--name-only"]).trim()) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        "Git index must be empty before a Raw acquisition append"
      );
    }
    if (this.#gitText([
      "status", "--porcelain", "--untracked-files=all", "--", this.#rootPath
    ]).trim()) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        "Raw persistence path has uncommitted changes; use a fresh checkout"
      );
    }
  }

  #commit(bundle: AcquisitionPersistenceBundle) {
    this.#gitText([
      "-c", "user.name=Trusted Raw Persistence",
      "-c", "user.email=trusted-raw@invalid.local",
      "commit", "--no-gpg-sign", "-m",
      `trusted-raw: append ${bundle.acquisition_run.acquisition_run_id}`
    ], {
      ...process.env,
      GIT_AUTHOR_DATE: bundle.acquisition_run.completed_at,
      GIT_COMMITTER_DATE: bundle.acquisition_run.completed_at
    });
  }

  #assertRemoteExpectedParent(expectedParent: string) {
    if (!this.#remote) return;
    if (this.#remoteHead() !== expectedParent) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        "Raw persistence remote changed; fresh checkout required"
      );
    }
  }

  #push(expectedParent: string) {
    if (!this.#remote) return;
    this.#assertRemoteExpectedParent(expectedParent);
    try {
      this.#gitText([
        "push", "--porcelain", this.#remote.name,
        `HEAD:refs/heads/${this.#remote.branch}`
      ]);
    } catch (error) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        `Raw persistence push rejected; fresh checkout required: ${errorMessage(error)}`
      );
    }
  }

  #remoteHead() {
    if (!this.#remote) throw new Error("Remote is unavailable");
    const output = this.#gitText([
      "ls-remote", "--heads", this.#remote.name,
      `refs/heads/${this.#remote.branch}`
    ]).trim();
    const [commit] = output.split(/\s+/u);
    if (!commit) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        `Raw persistence remote branch is missing: ${this.#remote.branch}`
      );
    }
    return commit;
  }

  #headCommit() {
    return this.#gitText(["rev-parse", "HEAD"]).trim();
  }

  #listCommittedFiles(commit: string) {
    const output = this.#gitText([
      "ls-tree", "-r", "--name-only", commit, "--", this.#rootPath
    ]).trim();
    return output ? output.split(/\r?\n/u) : [];
  }

  #readCommittedBytes(commit: string, relativePath: string) {
    const bytes = this.#tryReadCommittedBytes(commit, relativePath);
    if (!bytes) throw integrity(`Committed Raw file is missing: ${relativePath}`);
    return bytes;
  }

  #tryReadCommittedBytes(commit: string, relativePath: string) {
    try {
      return this.#gitBytes(["show", `${commit}:${relativePath}`]);
    } catch {
      return null;
    }
  }

  #gitText(args: readonly string[], environment = process.env) {
    try {
      return execFileSync("git", [...args], {
        cwd: this.#repositoryPath,
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        `Git Raw operation failed (${args[0] ?? "unknown"}): ${errorMessage(error)}`
      );
    }
  }

  #gitBytes(args: readonly string[]) {
    try {
      return new Uint8Array(execFileSync("git", [...args], {
        cwd: this.#repositoryPath,
        encoding: "buffer",
        stdio: ["ignore", "pipe", "pipe"]
      }));
    } catch (error) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        `Git Raw read failed: ${errorMessage(error)}`
      );
    }
  }

  #objectPath(objectKey: string) {
    if (!/^sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}$/u.test(objectKey)) {
      throw new ProductionPersistenceError("HASH_MISMATCH", "Invalid Raw object key");
    }
    return `${this.#rootPath}/objects/${objectKey}`;
  }

  #attributesPath() {
    return `${this.#rootPath}/.gitattributes`;
  }

  #factPath(collection: string, identity: string) {
    return `${this.#rootPath}/facts/${collection}/${canonicalHash({ identity })}.json`;
  }

  #acquisitionManifestPath(sequence: number) {
    return `${this.#rootPath}/manifests/acquisitions/${sequenceName(sequence)}.json`;
  }

  #stateManifestPath() {
    return `${this.#rootPath}/state-manifest.json`;
  }

  #stateSnapshotPath(hash: string) {
    return `${this.#rootPath}/manifests/states/${hash}.json`;
  }

  #absolutePath(relativePath: string) {
    return path.join(this.#repositoryPath, ...relativePath.split("/"));
  }
}

export function createRawValidatedRestorationJournal(
  rawPersistence: GitRawObjectPersistence,
  restorationJournal: TrustedRestorationJournalRepository<TrustedChainCommand>,
  sourceRepository?: ProductionSourceRegistryRepository
): TrustedRestorationJournalRepository<TrustedChainCommand> {
  return Object.freeze({
    async readAuthoritativeHead() {
      if (!restorationJournal.readAuthoritativeHead) throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Verified journal HEAD is unavailable");
      return restorationJournal.readAuthoritativeHead();
    },
    async readArtifactEnvelope(kind: string, id: string, scope: "PRODUCTION" | "SYNTHETIC_TEST") {
      return restorationJournal.readArtifactEnvelope?.(kind, id, scope) ?? null;
    },
    async readVerifiedDiscovery(snapshotId: string, recordId: string): Promise<SOVDiscoveryEvidence> {
      if (!sourceRepository) throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Persisted source references are required for discovery support");
      const bundles = await rawPersistence.listVerifiedAcquisitions();
      const matches = bundles.filter((bundle) => bundle.snapshot.snapshot_id === snapshotId);
      if (matches.length !== 1) throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Exact discovery Snapshot is missing or ambiguous");
      const bundle = matches[0]!;
      const records = bundle.extracted_records.filter((record) => record.extracted_record_id === recordId);
      const record = records[0];
      const manifest = bundle.raw_blob_manifest;
      if (records.length !== 1 || !record || !isExtractedRecordV2(record) || !manifest
          || bundle.acquisition_run.status !== "SUCCESS"
          || bundle.acquisition_run.result_metadata.extraction_status !== "COMPLETE"
          || bundle.acquisition_run.result_metadata.extracted_record_count !== bundle.extracted_records.length) {
        throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Discovery acquisition/extraction completeness is not proved");
      }
      const versions = await sourceRepository.listVersions();
      versions.forEach(assertSourcePersistenceVersion);
      const exactVersion = (id: string) => {
        const found = versions.filter((version) => version.artifact_id === id);
        if (found.length !== 1) throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Exact discovery source version is missing");
        return found[0]!;
      };
      const endpointVersion = exactVersion(bundle.acquisition_run.endpoint_artifact_id);
      const admissionVersion = exactVersion(bundle.acquisition_run.source_admission_artifact_id);
      const allowlistVersion = exactVersion(bundle.acquisition_run.allowlist_artifact_id);
      if (endpointVersion.artifact.kind !== "RECRUITMENT_ENDPOINT"
          || admissionVersion.artifact.kind !== "SOURCE_ADMISSION"
          || allowlistVersion.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") {
        throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Discovery source reference types do not match");
      }
      const endpoint = endpointVersion.artifact.payload;
      const admitted = admissionVersion.artifact.payload;
      const allowlist = allowlistVersion.artifact.payload;
      const definitions = versions.filter((version) => version.artifact.kind === "SOURCE_DEFINITION"
        && version.artifact.payload.source_definition_id === endpoint.source_definition_id);
      const adapters = versions.filter((version) => version.artifact.kind === "ADAPTER_REGISTRATION"
        && version.artifact.payload.adapter_key === endpoint.adapter_key);
      if (definitions.length !== 1 || adapters.length !== 1) {
        throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Historical source/adapter revision cannot be uniquely proved");
      }
      const definitionVersion = definitions[0]!;
      if (definitionVersion.artifact.kind !== "SOURCE_DEFINITION") throw integrity("Source definition type mismatch");
      const definition = definitionVersion.artifact.payload;
      if (!definition.enabled || !endpoint.enabled || !["OFFICIAL", "AUTHORIZED"].includes(definition.authority_level)
          || !evaluateSourceAutomationPermission(admitted).allowed
          || admitted.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id
          || allowlist.recruitment_endpoint_artifact_id !== endpointVersion.artifact_id
          || allowlist.source_admission_artifact_id !== admissionVersion.artifact_id
          || allowlist.authority_level !== definition.authority_level
          || manifest.source_definition_id !== endpoint.source_definition_id
          || manifest.recruitment_endpoint_id !== endpoint.recruitment_endpoint_id) {
        throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Discovery source identity/admission/authority binding mismatch");
      }
      assertOfficialRequestAllowed(allowlist, bundle.snapshot.request_metadata.locator, bundle.snapshot.request_metadata.method ?? endpoint.request_method ?? "GET");
      if ([definitionVersion, endpointVersion, admissionVersion, allowlistVersion, adapters[0]!].some((version) =>
        Date.parse(version.effective_at) > Date.parse(bundle.acquisition_run.started_at))) {
        throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Discovery source reference was not effective at acquisition");
      }
      const raw = await new ProductionRawObjectBoundary(rawPersistence, rawPersistence).readVerified(manifest.raw_blob_id);
      const reference = (version: typeof endpointVersion) => ({ artifact_id: version.artifact_id, integrity_hash: version.integrity_hash });
      return {
        scope: "PRODUCTION", endpoint, snapshot: bundle.snapshot, extracted_record: record,
        raw_blob: { raw_blob_id: manifest.raw_blob_id, bytes: raw.bytes, sha256: manifest.raw_content_sha256,
          byte_length: manifest.byte_length, content_type: manifest.content_type },
        acquisition: { acquisition_run_id: bundle.acquisition_run.acquisition_run_id, status: bundle.acquisition_run.status,
          integrity_hash: canonicalHash(bundle), complete: true },
        source_reference: { source_definition: reference(definitionVersion), endpoint: reference(endpointVersion),
          admission: reference(admissionVersion), allowlist: reference(allowlistVersion),
          authority_level: definition.authority_level === "OFFICIAL" ? "OFFICIAL" : "AUTHORIZED" }
      };
    },
    async list() {
      const [bundles, records] = await Promise.all([
        rawPersistence.listVerifiedAcquisitions(),
        restorationJournal.list()
      ]);
      assertRawBindings(records, bundles);
      return structuredClone(records);
    },
    async appendExecution(execution: TrustedRestorationExecution<TrustedChainCommand>) {
      const validated = assertTrustedRestorationExecution(execution);
      const bundles = await rawPersistence.listVerifiedAcquisitions();
      assertRawBindings([validated.record], bundles);
      return restorationJournal.appendExecution(validated);
    }
  });
}

function assertRawBindings(
  records: readonly TrustedRestorationRecord<TrustedChainCommand>[],
  bundles: readonly AcquisitionPersistenceBundle[]
) {
  const snapshots = new Map(bundles.map((bundle) => [
    bundle.snapshot.snapshot_id,
    bundle
  ]));
  for (const record of records) {
    if (record.command.kind === "SOURCE_DISCOVERY_SUPPORT_VERIFY") {
      const input = record.command.input;
      const bundle = snapshots.get(input.snapshot_id);
      if (!bundle?.raw_blob_manifest || bundle.snapshot.transport_status !== "SUCCESS"
          || !bundle.extracted_records.some((item) => item.extracted_record_id === input.extracted_record_id)) {
        throw new ProductionPersistenceError("EVIDENCE_BLOCKED", "Discovery support lacks verified Raw evidence");
      }
      continue;
    }
    if (record.command.kind !== "SOURCE_OCCURRENCE_MATERIALIZE") continue;
    const { snapshot, extracted_record: extractedRecord } = record.command.input;
    const bundle = snapshots.get(snapshot.snapshot_id);
    const storedRecord = bundle?.extracted_records.find((candidate) => {
      return candidate.extracted_record_id === extractedRecord.extracted_record_id;
    });
    if (!bundle
        || !bundle.raw_blob_manifest
        || snapshot.transport_status !== "SUCCESS"
        || canonicalSerialize(bundle.snapshot) !== canonicalSerialize(snapshot)
        || !storedRecord
        || canonicalSerialize(storedRecord) !== canonicalSerialize(extractedRecord)) {
      throw new ProductionPersistenceError(
        "EVIDENCE_BLOCKED",
        `SourceOccurrence materialization lacks verified Raw evidence: ${snapshot.snapshot_id}`
      );
    }
  }
}

function assertAcquisitionBundle(bundle: AcquisitionPersistenceBundle) {
  const cloned = structuredClone(bundle);
  if (!cloned.acquisition_run.acquisition_run_id.trim()
      || cloned.acquisition_run.provenance.scope !== "PRODUCTION") {
    throw integrity("Acquisition run identity or provenance is invalid");
  }
  if (cloned.snapshot.transport_status === "SUCCESS") {
    const manifest = cloned.raw_blob_manifest;
    if (!manifest) throw integrity("Successful Snapshot requires a RawBlob manifest");
    assertRawBlobManifest(manifest);
    if (cloned.snapshot.raw_blob_id !== manifest.raw_blob_id
        || cloned.snapshot.content_hash !== manifest.raw_content_sha256
        || cloned.snapshot.content_length !== manifest.byte_length
        || cloned.snapshot.recruitment_endpoint_id !== manifest.recruitment_endpoint_id
        || cloned.extracted_records.some((record) => {
          return record.snapshot_id !== cloned.snapshot.snapshot_id
            || record.source_definition_id !== manifest.source_definition_id;
        })) {
      throw integrity("RawBlob, Snapshot, and ExtractedRecord binding is invalid");
    }
  } else if (cloned.raw_blob_manifest !== null || cloned.extracted_records.length > 0) {
    throw integrity("Failed Snapshot cannot claim RawBlob or ExtractedRecord evidence");
  }
  return cloned;
}

function verifyManifestObject(manifest: RawBlobManifest, bytes: Uint8Array) {
  assertRawBlobManifest(manifest);
  if (sha256Bytes(bytes) !== manifest.raw_content_sha256
      || bytes.byteLength !== manifest.byte_length) {
    throw new ProductionPersistenceError(
      "EVIDENCE_BLOCKED",
      `RawBlob object does not match manifest: ${manifest.raw_blob_id}`
    );
  }
}

function writeProposedFiles(root: string, proposed: ProposedFiles) {
  for (const [relativePath, bytes] of [...proposed.immutable, ...proposed.mutable]) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);
  }
}

function decodeCanonical<Value>(bytes: Uint8Array, label: string) {
  const text = Buffer.from(bytes).toString("utf8");
  let value: Value;
  try {
    value = canonicalDeserialize<Value>(text);
  } catch (error) {
    throw integrity(`${label} is invalid canonical JSON: ${errorMessage(error)}`);
  }
  if (canonicalSerialize(value) !== text) {
    throw integrity(`${label} bytes are not canonical`);
  }
  return value;
}

function sealRecord<Content extends object>(content: Content) {
  return { ...content, integrity_hash: canonicalHash(content) };
}

function assertSealed(value: { readonly integrity_hash: string }, label: string) {
  const { integrity_hash: actual, ...content } = value;
  if (actual !== canonicalHash(content)) throw integrity(`${label} seal is invalid`);
}

function canonicalBytes(value: unknown) {
  return textBytes(canonicalSerialize(value));
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function assertSameBytes(left: Uint8Array, right: Uint8Array, label: string) {
  if (left.byteLength !== right.byteLength
      || !left.every((byte, index) => byte === right[index])) {
    throw new ProductionPersistenceError(
      "COLLISION",
      `Immutable Raw object/file collision: ${label}`
    );
  }
}

function normalizeRootPath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../")
      || normalized === ".." || normalized.endsWith("/")) {
    throw integrity("Git Raw root must be repository-relative");
  }
  return normalized;
}

function sequenceName(sequence: number) {
  return sequence.toString().padStart(12, "0");
}

function positiveLimit(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw integrity(`${label} must be a positive safe integer`);
  }
  return value;
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function integrity(message: string) {
  return new ProductionPersistenceError("INTEGRITY_MISMATCH", message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
