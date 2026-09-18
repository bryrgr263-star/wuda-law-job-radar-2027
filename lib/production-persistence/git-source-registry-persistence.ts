import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

  constructor(options: { readonly repository_path: string; readonly root_path?: string }) {
    this.#repositoryPath = path.resolve(options.repository_path);
    this.#rootPath = normalizeRootPath(options.root_path ?? "production-source-state");
    this.#git(["rev-parse", "--git-dir"]);
    const loaded = this.#loadCommitted();
    this.#versions = [...loaded.versions];
    this.#state = loaded.state;
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
      versions: [...(this.#state?.versions ?? []), reference]
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

  #loadCommitted() {
    const stateText = this.#tryReadHead(this.#statePath());
    if (stateText === null) return { state: null, versions: [] as SourcePersistenceVersion[] };
    const state = decode<State>(stateText, "Source registry state");
    assertState(state);
    const snapshot = this.#readHead(this.#snapshotPath(state.integrity_hash));
    if (snapshot !== stateText) throw new Error("Source registry state snapshot mismatch");
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
    return { state, versions };
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
