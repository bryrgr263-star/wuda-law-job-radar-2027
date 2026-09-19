import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertContinuousRecord, replayContinuousRecords, pendingContinuousAttempt, type ContinuousRecord, type ContinuousFencingVerifier
} from "../application/source-admission/continuous-acquisition";
import { resolveContinuousSourceContext } from "./continuous-source-context";

import {
  canonicalDeserialize,
  canonicalHash,
  canonicalSerialize
} from "../ingestion/normalization/canonical-artifact-registry";
import {
  assertSourcePersistenceVersion,
  type ProductionSourceRegistryRepository,
  type SourcePersistenceVersion
} from "./contracts";

const SCHEMA_VERSION = "git-source-registry-state/1.0.0" as const;

interface VersionReference {
  readonly artifact_id: string;
  readonly artifact_kind: string;
  readonly stream_id: string;
  readonly revision: number;
  readonly path: string;
  readonly integrity_hash: string;
}

interface StateContent {
  readonly schema_version: typeof SCHEMA_VERSION;
  readonly previous_state_hash: string | null;
  readonly versions: readonly VersionReference[];
  readonly continuous_records?: readonly { readonly record_id: string; readonly path: string; readonly integrity_hash: string }[];
}

interface State extends StateContent {
  readonly integrity_hash: string;
}

export class GitSourceRegistryPersistence implements
ProductionSourceRegistryRepository {
  readonly #repositoryPath: string;
  readonly #rootPath: string;
  #versions: SourcePersistenceVersion[];
  #state: State | null;
  #continuousRecords: ContinuousRecord[] = [];
  readonly #fencingVerifier?: ContinuousFencingVerifier;
  #loadedHead: string;

  constructor(options: { readonly repository_path: string; readonly root_path?: string; readonly fencing_verifier?: ContinuousFencingVerifier }) {
    this.#repositoryPath = path.resolve(options.repository_path);
    this.#rootPath = normalizeRootPath(options.root_path ?? "production-source-state");
    this.#fencingVerifier = options.fencing_verifier;
    this.#git(["rev-parse", "--git-dir"]);
    this.#loadedHead = this.readCommittedHead();
    const loaded = this.#loadCommitted();
    if (this.readCommittedHead() !== this.#loadedHead) throw new Error("CONTINUOUS_LOCAL_HEAD_CHANGED");
    this.#versions = [...loaded.versions];
    this.#state = loaded.state;
    this.#continuousRecords = loaded.records;
  }

  async appendVersion(version: SourcePersistenceVersion) {
    assertSourcePersistenceVersion(version);
    const existingById = this.#versions.find((item) => {
      return item.artifact_id === version.artifact_id;
    });
    if (existingById) {
      if (canonicalSerialize(existingById) !== canonicalSerialize(version)) {
        throw new Error(`Source persistence artifact collision: ${version.artifact_id}`);
      }
      return "IDEMPOTENT_REUSE" as const;
    }
    if (pendingContinuousAttempt(this.#continuousRecords)) throw new Error("PENDING_GATE_DENIED");
    const sameRevision = this.#versions.find((item) => {
      return item.artifact.kind === version.artifact.kind
        && item.stream_id === version.stream_id
        && item.revision === version.revision;
    });
    if (sameRevision) {
      throw new Error(
        `Source persistence revision collision: ${version.artifact.kind}:${version.stream_id}`
      );
    }
    const prior = this.#versions.filter((item) => {
      return item.artifact.kind === version.artifact.kind
        && item.stream_id === version.stream_id;
    }).sort((left, right) => left.revision - right.revision).at(-1);
    if (version.revision !== (prior?.revision ?? 0) + 1
        || version.supersedes_artifact_id !== (prior?.artifact_id ?? null)) {
      throw new Error(
        `Source persistence revision is not contiguous: ${version.artifact.kind}:${version.stream_id}`
      );
    }

    const versionPath = this.#versionPath(version.artifact_id);
    this.#writeImmutable(versionPath, canonicalSerialize(version));
    this.#versions.push(structuredClone(version));
    const reference: VersionReference = {
      artifact_id: version.artifact_id,
      artifact_kind: version.artifact.kind,
      stream_id: version.stream_id,
      revision: version.revision,
      path: versionPath,
      integrity_hash: version.integrity_hash
    };
    const content: StateContent = {
      schema_version: SCHEMA_VERSION,
      previous_state_hash: this.#state?.integrity_hash ?? null,
      versions: [...(this.#state?.versions ?? []), reference],
      ...(this.#state?.continuous_records ? { continuous_records: this.#state.continuous_records } : {})
    };
    const state: State = { ...content, integrity_hash: canonicalHash(content) };
    this.#writeImmutable(this.#snapshotPath(state.integrity_hash), canonicalSerialize(state));
    this.#writeMutable(this.#statePath(), canonicalSerialize(state));
    this.#state = state;
    return "APPENDED" as const;
  }

  async listVersions() {
    return structuredClone(this.#versions);
  }

  listContinuousRecords() { return structuredClone(this.#continuousRecords); }

  readCommittedHead() { return this.#git(["rev-parse", "HEAD"]).trim(); }

  assertAuthoritativeHead(branch: string, expected: string) {
    const remote = this.#git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).trim().split(/\s+/u)[0];
    if (!remote || remote !== expected || this.readCommittedHead() !== expected || this.#loadedHead !== expected) throw new Error("CONTINUOUS_CAS_OR_STALE_HEAD_DENIED");
  }

  async publishContinuousRecord(record: ContinuousRecord, options: {
    readonly expected_parent: string; readonly branch: string; readonly commit_identity: { readonly name: string; readonly email: string }
  }) {
    assertContinuousRecord(record);
    this.assertAuthoritativeHead(options.branch, options.expected_parent);
    const existing = this.#continuousRecords.find(item => item.record_id === record.record_id);
    if (existing) {
      if (canonicalSerialize(existing) !== canonicalSerialize(record)) throw new Error("CONTINUOUS_RECORD_COLLISION");
      return this.readCommittedHead();
    }
    if (this.#git(["status", "--porcelain=v1", "--", this.#rootPath]).trim()) throw new Error("CONTINUOUS_DIRTY_STATE_DENIED");
    const next = replayContinuousRecords([...this.#continuousRecords, record],
      bindings => resolveContinuousSourceContext(this.#versions, bindings), this.#fencingVerifier);
    const relativePath = `${this.#rootPath}/continuous/records/${canonicalHash({ record_id: record.record_id })}.json`;
    this.#writeImmutable(relativePath, canonicalSerialize(record));
    const content: StateContent = { schema_version: SCHEMA_VERSION, previous_state_hash: this.#state?.integrity_hash ?? null,
      versions: this.#state?.versions ?? [], continuous_records: [...(this.#state?.continuous_records ?? []),
        { record_id: record.record_id, path: relativePath, integrity_hash: record.integrity_hash }] };
    const state = { ...content, integrity_hash: canonicalHash(content) };
    this.#writeImmutable(this.#snapshotPath(state.integrity_hash), canonicalSerialize(state));
    this.#writeMutable(this.#statePath(), canonicalSerialize(state));
    this.#git(["add", "--", this.#rootPath]);
    const staged = this.#git(["diff", "--cached", "--name-only"]).trim().split(/\r?\n/u);
    if (staged.some(file => !file.startsWith(this.#rootPath + "/"))) throw new Error("CONTINUOUS_UNRELATED_STAGED_FILES_DENIED");
    this.#git(["-c", `user.name=${options.commit_identity.name}`, "-c", `user.email=${options.commit_identity.email}`,
      "commit", "-m", `Continuous Admission ${record.kind} ${record.record_id}`]);
    const head = this.readCommittedHead();
    const remote = this.#git(["ls-remote", "--heads", "origin", `refs/heads/${options.branch}`]).trim().split(/\s+/u)[0];
    if (remote !== options.expected_parent) throw new Error("CONTINUOUS_CAS_DENIED");
    this.#git(["push", "origin", `HEAD:refs/heads/${options.branch}`]);
    this.#loadedHead = head;
    this.assertAuthoritativeHead(options.branch, head);
    this.#state = state;
    this.#continuousRecords = next;
    return head;
  }

  #loadCommitted() {
    const stateText = this.#tryReadHead(this.#statePath());
    if (stateText === null) return { state: null, versions: [] as SourcePersistenceVersion[], records: [] as ContinuousRecord[] };
    const state = decode<State>(stateText, "Source registry state");
    assertState(state);
    const snapshot = this.#readHead(this.#snapshotPath(state.integrity_hash));
    if (snapshot !== stateText) throw new Error("Source registry state snapshot mismatch");
    let child = state;
    const visited = new Set<string>([state.integrity_hash]);
    while (child.previous_state_hash) {
      if (visited.has(child.previous_state_hash)) throw new Error("Source registry state history cycle");
      visited.add(child.previous_state_hash);
      const previous = decode<State>(this.#readHead(this.#snapshotPath(child.previous_state_hash)), "Source state history");
      assertState(previous);
      if (previous.integrity_hash !== child.previous_state_hash
        || canonicalSerialize(previous.versions) !== canonicalSerialize(child.versions.slice(0, previous.versions.length))
        || canonicalSerialize(previous.continuous_records ?? []) !== canonicalSerialize((child.continuous_records ?? []).slice(0, previous.continuous_records?.length ?? 0))
        || previous.versions.length + (previous.continuous_records?.length ?? 0) >= child.versions.length + (child.continuous_records?.length ?? 0)) {
        throw new Error("Source registry append-only history mismatch");
      }
      child = previous;
    }
    const versions = state.versions.map((reference) => {
      const version = decode<SourcePersistenceVersion>(
        this.#readHead(reference.path),
        `Source version ${reference.artifact_id}`
      );
      assertSourcePersistenceVersion(version);
      if (version.artifact_id !== reference.artifact_id
          || version.artifact.kind !== reference.artifact_kind
          || version.stream_id !== reference.stream_id
          || version.revision !== reference.revision
          || version.integrity_hash !== reference.integrity_hash) {
        throw new Error(`Source registry reference mismatch: ${reference.artifact_id}`);
      }
      return version;
    });
    const streams = new Map<string, SourcePersistenceVersion>();
    for (const version of versions) {
      const key = `${version.artifact.kind}\0${version.stream_id}`;
      const prior = streams.get(key);
      if (version.revision !== (prior?.revision ?? 0) + 1
          || version.supersedes_artifact_id !== (prior?.artifact_id ?? null)) {
        throw new Error(`Source registry revision chain mismatch: ${key}`);
      }
      streams.set(key, version);
    }
    const records = (state.continuous_records ?? []).map(reference => {
      const expectedPath = `${this.#rootPath}/continuous/records/${canonicalHash({ record_id: reference.record_id })}.json`;
      if (reference.path !== expectedPath) throw new Error("CONTINUOUS_REFERENCE_PATH_INVALID");
      const record = decode<ContinuousRecord>(this.#readHead(reference.path), "Continuous Admission record");
      assertContinuousRecord(record);
      if (record.record_id !== reference.record_id || record.integrity_hash !== reference.integrity_hash) throw new Error("CONTINUOUS_REFERENCE_INVALID");
      return record;
    });
    replayContinuousRecords(records, bindings => resolveContinuousSourceContext(versions, bindings), this.#fencingVerifier);
    return { state, versions, records };
  }

  #versionPath(artifactId: string) {
    return `${this.#rootPath}/versions/${canonicalHash({ artifact_id: artifactId })}.json`;
  }

  #snapshotPath(hash: string) {
    return `${this.#rootPath}/state/history/${hash}.json`;
  }

  #statePath() {
    return `${this.#rootPath}/state/current.json`;
  }

  #writeImmutable(relativePath: string, contents: string) {
    const absolutePath = this.#absolutePath(relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    if (existsSync(absolutePath)) {
      if (readFileSync(absolutePath, "utf8") !== contents) {
        throw new Error(`Immutable source state collision: ${relativePath}`);
      }
      return;
    }
    writeFileSync(absolutePath, contents, { encoding: "utf8", flag: "wx" });
  }

  #writeMutable(relativePath: string, contents: string) {
    const absolutePath = this.#absolutePath(relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents, "utf8");
  }

  #tryReadHead(relativePath: string) {
    try {
      return this.#git(["show", `HEAD:${relativePath}`]);
    } catch {
      return null;
    }
  }

  #readHead(relativePath: string) {
    const value = this.#tryReadHead(relativePath);
    if (value === null) throw new Error(`Committed source state is missing: ${relativePath}`);
    return value;
  }

  #absolutePath(relativePath: string) {
    return path.join(this.#repositoryPath, ...relativePath.split("/"));
  }

  #git(args: readonly string[]) {
    return execFileSync("git", args, {
      cwd: this.#repositoryPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }
}

function assertState(state: State) {
  const { integrity_hash: integrityHash, ...content } = state;
  if (state.schema_version !== SCHEMA_VERSION
      || integrityHash !== canonicalHash(content)) {
    throw new Error("Source registry state integrity mismatch");
  }
  const identities = new Set<string>();
  for (const reference of state.versions) {
    const key = `${reference.artifact_kind}\0${reference.stream_id}\0${reference.revision}`;
    if (identities.has(key)) throw new Error("Source registry state contains duplicates");
    identities.add(key);
  }
}

function decode<Value>(contents: string, label: string): Value {
  const value = canonicalDeserialize(contents) as Value;
  if (canonicalSerialize(value) !== contents) throw new Error(`${label} is not canonical`);
  return value;
}

function normalizeRootPath(value: string) {
  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("Source persistence root must be repository-relative");
  }
  return normalized;
}
