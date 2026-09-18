import "../helpers/network-guard";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
  GitAppendOnlyExecutionStore,
  GitAppendOnlyExecutionStoreError
} from "../../lib/production-persistence";

test("canonical Git layout is deterministic, append-only, and restart-readable", async () => {
  const repository = createRepository();
  try {
    const initialCommit = git(repository.path, "rev-parse", "HEAD").trim();
    const store = createStore(repository.path);
    const execution = executionFixture();
    assert.equal(await store.appendExecution(execution), "APPENDED");
    assert.equal(await store.appendExecution(structuredClone(execution)),
      "IDEMPOTENT_REUSE");
    const firstRead = await store.list();
    assert.deepEqual(firstRead, [execution.record]);
    (firstRead[0]!.expected_artifacts as Array<unknown>).push({ forged: true });
    assert.deepEqual(await store.list(), [execution.record]);

    const files = git(
      repository.path,
      "ls-tree",
      "-r",
      "--name-only",
      "HEAD",
      "trusted-state"
    ).trim().split(/\r?\n/u).sort();
    assert.equal(files.length, 9);
    assert.ok(files.includes("trusted-state/journal/head.json"));
    assert.ok(files.includes("trusted-state/journal/segments/000000000001.json"));
    assert.ok(files.includes(
      "trusted-state/manifests/executions/000000000001.json"
    ));
    assert.ok(files.includes("trusted-state/state-manifest.json"));
    assert.equal(files.filter((file) => file.startsWith(
      "trusted-state/artifacts/objects/"
    )).length, 1);
    assert.equal(files.filter((file) => file.startsWith(
      "trusted-state/artifacts/identities/presentation-read-model-"
    )).length, 1);
    assert.equal(files.filter((file) => file.startsWith(
      "trusted-state/manifests/states/"
    )).length, 1);
    assert.equal(files.filter((file) => file.startsWith(
      "trusted-state/read-model/objects/"
    )).length, 1);
    assert.equal(files.filter((file) => file.startsWith(
      "trusted-state/read-model/identities/"
    )).length, 1);
    const head = JSON.parse(git(
      repository.path,
      "show",
      "HEAD:trusted-state/journal/head.json"
    )) as {
      readonly latest_sequence: number;
      readonly state_commit: string;
      readonly state_commit_role: string;
      readonly checkpoint_reference: null;
    };
    assert.equal(head.latest_sequence, 1);
    assert.equal(head.state_commit, initialCommit);
    assert.equal(head.state_commit_role, "EXPECTED_PARENT");
    assert.equal(head.checkpoint_reference, null);
    assert.equal(git(repository.path, "rev-list", "--count", "HEAD").trim(), "2");
  } finally {
    repository.remove();
  }
});

test("same artifact identity reuses identical bytes and rejects different bytes", async () => {
  const repository = createRepository();
  try {
    const store = createStore(repository.path);
    const first = executionFixture();
    await store.appendExecution(first);
    const collision = executionFixture({
      sequence: 2,
      previous_record_hash: first.record.integrity_hash,
      artifact_value: "different"
    });
    await assert.rejects(
      store.appendExecution(collision),
      (error: unknown) => error instanceof GitAppendOnlyExecutionStoreError
        && error.code === "IDENTITY_COLLISION"
    );
    assert.equal((await store.list()).length, 1);
    assert.equal(git(repository.path, "rev-list", "--count", "HEAD").trim(), "2");
  } finally {
    repository.remove();
  }
});

test("temporary, pre-commit, and post-commit crashes preserve Git authority", async () => {
  await assertCrashOutcome("AFTER_TEMPORARY_WORKSPACE", false, false);
  await assertCrashOutcome("BEFORE_COMMIT", false, true);
  await assertCrashOutcome("AFTER_COMMIT", true, false);
});

test("committed tampering is rejected before Process B receives records", async () => {
  const repository = createRepository();
  try {
    const store = createStore(repository.path);
    await store.appendExecution(executionFixture());
    const segment = path.join(
      repository.path,
      "trusted-state",
      "journal",
      "segments",
      "000000000001.json"
    );
    writeFileSync(segment, canonicalSerialize({ forged: true }), "utf8");
    git(repository.path, "add", "--", "trusted-state");
    git(repository.path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
      "commit", "-m", "tamper");
    await assert.rejects(
      createStore(repository.path).list(),
      (error: unknown) => (error instanceof GitAppendOnlyExecutionStoreError
          && error.code === "STATE_TAMPERED")
        || (error instanceof TrustedRestorationError
          && error.code === "INVALID_RECORD")
    );
  } finally {
    repository.remove();
  }
});

test("an unmanifested committed file is rejected as non-authoritative state", async () => {
  const repository = createRepository();
  try {
    const store = createStore(repository.path);
    await store.appendExecution(executionFixture());
    const orphan = path.join(repository.path, "trusted-state", "orphan.json");
    writeFileSync(orphan, canonicalSerialize({ orphan: true }), "utf8");
    git(repository.path, "add", "--", "trusted-state");
    git(repository.path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
      "commit", "-m", "orphan");
    await assert.rejects(
      createStore(repository.path).list(),
      (error: unknown) => error instanceof GitAppendOnlyExecutionStoreError
        && error.code === "STATE_TAMPERED"
    );
  } finally {
    repository.remove();
  }
});

test("regular push rejects a writer when remote HEAD changes after preflight", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "trusted-git-cas-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  const writerA = path.join(root, "writer-a");
  const writerB = path.join(root, "writer-b");
  try {
    git(root, "init", "--bare", origin);
    git(root, "init", "-b", "main", seed);
    writeFileSync(path.join(seed, "README.md"), "seed", "utf8");
    git(seed, "add", "README.md");
    git(seed, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
      "commit", "-m", "seed");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-u", "origin", "main");
    git(root, "clone", "--branch", "main", origin, writerA);
    git(root, "clone", "--branch", "main", origin, writerB);

    const writerAStore = createStore(writerA, {
      remote: { name: "origin", branch: "main" }
    });
    const writerBStore = createStore(writerB, {
      remote: { name: "origin", branch: "main" },
      fault_injector: async (point) => {
        if (point === "BEFORE_PUSH") {
          await writerAStore.appendExecution(executionFixture({
            artifact_id: "presentation-read-model:writer-a",
            artifact_value: "writer-a"
          }));
        }
      }
    });
    await assert.rejects(
      writerBStore.appendExecution(executionFixture({
        artifact_id: "presentation-read-model:writer-b",
        artifact_value: "writer-b"
      })),
      (error: unknown) => error instanceof GitAppendOnlyExecutionStoreError
        && error.code === "CAS_MISMATCH"
    );
    const remoteHead = git(root, "--git-dir", origin, "rev-parse", "refs/heads/main").trim();
    assert.equal(remoteHead, git(writerA, "rev-parse", "HEAD").trim());
    assert.notEqual(remoteHead, git(writerB, "rev-parse", "HEAD").trim());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function assertCrashOutcome(
  point: "AFTER_TEMPORARY_WORKSPACE" | "BEFORE_COMMIT" | "AFTER_COMMIT",
  committed: boolean,
  dirty: boolean
) {
  const repository = createRepository();
  try {
    const initialCommit = git(repository.path, "rev-parse", "HEAD").trim();
    const store = createStore(repository.path, {
      fault_injector(candidate) {
        if (candidate === point) throw new Error(`simulated crash at ${point}`);
      }
    });
    await assert.rejects(store.appendExecution(executionFixture()), /simulated crash/);
    const currentCommit = git(repository.path, "rev-parse", "HEAD").trim();
    assert.equal(currentCommit === initialCommit, !committed);
    assert.equal(Boolean(git(
      repository.path,
      "status",
      "--porcelain",
      "--",
      "trusted-state"
    ).trim()), dirty);
    assert.equal((await createStore(repository.path).list()).length, committed ? 1 : 0);
  } finally {
    repository.remove();
  }
}

function executionFixture(options: {
  readonly sequence?: number;
  readonly previous_record_hash?: string | null;
  readonly artifact_id?: string;
  readonly artifact_value?: string;
} = {}): TrustedRestorationExecution {
  const artifact = {
    presentation_read_model_id:
      options.artifact_id ?? "presentation-read-model:test",
    value: options.artifact_value ?? "trusted"
  };
  const seal = canonicalHash(artifact);
  const record = createTrustedRestorationRecord({
    sequence: options.sequence ?? 1,
    previous_record_hash: options.previous_record_hash ?? null,
    command_kind: "TEST_PRESENTATION_READ_MODEL",
    command: {
      kind: "TEST_PRESENTATION_READ_MODEL",
      artifact_id: artifact.presentation_read_model_id,
      value: artifact.value
    },
    result: artifact,
    expected_artifacts: [{
      artifact_kind: "PRESENTATION_READ_MODEL",
      artifact_id: artifact.presentation_read_model_id,
      content_hash: seal
    }],
    provenance: {
      scope: "SYNTHETIC_TEST",
      actor: "git-persistence-test",
      recorded_at: "2026-09-16T00:00:00.000Z"
    }
  });
  const canonicalBytes = canonicalSerialize(artifact);
  const withoutIntegrity = {
    artifact_type: "PRESENTATION_READ_MODEL",
    artifact_kind: "PRESENTATION_READ_MODEL",
    artifact_id: artifact.presentation_read_model_id,
    stream_id: artifact.presentation_read_model_id,
    revision: 1,
    supersedes_artifact_id: null,
    schema_version: "test-presentation-read-model/1.0.0",
    canonical_bytes: canonicalBytes,
    artifact_hash: seal,
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
  const envelope: TrustedRestorationArtifactEnvelope = {
    ...withoutIntegrity,
    integrity_bytes: canonicalSerialize(withoutIntegrity),
    integrity_hash: canonicalHash(withoutIntegrity)
  };
  return {
    record,
    artifact_envelopes: [envelope],
    read_model_projection: {
      presentation_read_model_id: artifact.presentation_read_model_id,
      canonical_bytes: canonicalBytes,
      artifact_hash: seal,
      seal,
      record: artifact
    }
  };
}

function createRepository() {
  const repositoryPath = mkdtempSync(path.join(os.tmpdir(), "trusted-git-store-"));
  git(repositoryPath, "init", "-b", "main");
  writeFileSync(path.join(repositoryPath, "README.md"), "seed", "utf8");
  git(repositoryPath, "add", "README.md");
  git(repositoryPath, "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
    "commit", "-m", "seed");
  return {
    path: repositoryPath,
    remove() { rmSync(repositoryPath, { recursive: true, force: true }); }
  };
}

function createStore(
  repositoryPath: string,
  overrides: Partial<ConstructorParameters<typeof GitAppendOnlyExecutionStore>[0]> = {}
) {
  return new GitAppendOnlyExecutionStore({
    repository_path: repositoryPath,
    stream_id: "git-persistence-test",
    scope: "SYNTHETIC_TEST",
    ...overrides
  });
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
