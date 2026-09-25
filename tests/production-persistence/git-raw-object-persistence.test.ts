import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  RawCaptureService,
  bootstrapTrustedChainCompositionRoot,
  createExtractedRecordV2,
  type ExtractedRecordV2,
  type RawBlob,
  type RawContentSha256,
  type Snapshot,
  type SnapshotId,
  type TrustedChainCommand
} from "../../lib/ingestion";
import { canonicalHash, canonicalSerialize } from
  "../../lib/ingestion/normalization/canonical-artifact-registry";
import {
  GitAppendOnlyExecutionStore,
  GitRawObjectPersistence,
  ProductionPersistenceError,
  ProductionRawObjectBoundary,
  createRawValidatedRestorationJournal,
  rebuildGitRawSqliteIndex,
  type AcquisitionPersistenceBundle,
  type GitRawPersistenceFaultPoint,
  type ProductionPersistenceProvenance
} from "../../lib/production-persistence";
import { trustedFixture } from "../pipeline/position-bound-phase-fixture";

const PROVENANCE: ProductionPersistenceProvenance = {
  scope: "PRODUCTION",
  actor_id: "git-raw-test",
  actor_role: "TEST_FIXTURE",
  evidence_references: ["fixture:git-raw"]
};

test("RawBlob uses deterministic SHA-256 paths and exact replay is idempotent", async () => {
  const repository = createRepository();
  try {
    const persistence = new GitRawObjectPersistence({ repository_path: repository.path });
    const fixture = rawFixture("idempotent", textBytes("official attachment bytes"));
    const boundary = new ProductionRawObjectBoundary(persistence, persistence);
    const first = await persistFixture(boundary, fixture);
    assert.equal(first.persistence_outcome, "APPENDED");
    assert.equal(first.manifest.object_key,
      `sha256/${fixture.hash.slice(0, 2)}/${fixture.hash.slice(2, 4)}/${fixture.hash}`);
    const second = await persistFixture(boundary, fixture);
    assert.equal(second.persistence_outcome, "IDEMPOTENT_REUSE");
    const verified = await boundary.readVerified(fixture.rawBlob.raw_blob_id);
    assert.deepEqual([...verified.bytes], [...fixture.bytes]);
    assert.equal((await persistence.listVerifiedAcquisitions()).length, 1);
    assert.equal(git(repository.path, "rev-list", "--count", "HEAD").trim(), "2");
  } finally {
    repository.remove();
  }
});

test("safe response Cookie observation survives sealed Git acquisition replay", async () => {
  const repository = createRepository();
  try {
    const fixture = rawFixture("cookie-observation", textBytes("public recruitment page"), true);
    const persistence = new GitRawObjectPersistence({ repository_path: repository.path });
    await persistFixture(new ProductionRawObjectBoundary(persistence, persistence), fixture);
    const [restored] = await new GitRawObjectPersistence({ repository_path: repository.path }).listVerifiedAcquisitions();
    assert.equal(restored?.snapshot.response_metadata.response_set_cookie_present, true);
    assert.deepEqual(restored?.snapshot, fixture.snapshot);
    assert.doesNotMatch(git(repository.path, "log", "-p", "--all"), /secret-cookie/u);
  } finally { repository.remove(); }
});

test("Git text conversion cannot alter committed RawBlob bytes", async () => {
  const repository = createRepository();
  try {
    git(repository.path, "config", "core.autocrlf", "true");
    const persistence = new GitRawObjectPersistence({ repository_path: repository.path });
    const boundary = new ProductionRawObjectBoundary(persistence, persistence);
    const first = rawFixture(
      "crlf-first",
      textBytes("<!doctype html>\r\n<html>first</html>\r\n")
    );
    const second = rawFixture(
      "crlf-second",
      textBytes("<!doctype html>\r\n<html>second</html>\r\n")
    );

    await persistFixture(boundary, first);
    await persistFixture(boundary, second);

    const fresh = new GitRawObjectPersistence({ repository_path: repository.path });
    const verified = await new ProductionRawObjectBoundary(fresh, fresh)
      .readVerified(first.rawBlob.raw_blob_id);
    assert.deepEqual([...verified.bytes], [...first.bytes]);
    assert.equal((await fresh.listVerifiedAcquisitions()).length, 2);
  } finally {
    repository.remove();
  }
});

test("multi-record acquisition replay preserves the authoritative record order", async () => {
  const repository = createRepository();
  try {
    const fixture = rawFixture("multi-record", textBytes("official multi-position page"));
    const secondRecord = {
      ...structuredClone(fixture.extractedRecord),
      extracted_record_id: "extracted:v2:additional-position" as ExtractedRecordV2["extracted_record_id"],
      raw_source_record_id: "row-multi-record-additional",
      raw_title: original("合规岗")
    };
    const records = [fixture.extractedRecord, secondRecord]
      .sort((left, right) => rawFactReferenceKey(right).localeCompare(rawFactReferenceKey(left)));
    const orderedFixture = {
      ...fixture,
      bundle: { ...fixture.bundle, extracted_records: records }
    };
    const persistence = new GitRawObjectPersistence({ repository_path: repository.path });

    await persistFixture(
      new ProductionRawObjectBoundary(persistence, persistence),
      orderedFixture
    );

    const [restored] = await new GitRawObjectPersistence({
      repository_path: repository.path
    }).listVerifiedAcquisitions();
    assert.deepEqual(
      restored?.extracted_records.map((record) => record.extracted_record_id),
      records.map((record) => record.extracted_record_id)
    );
  } finally {
    repository.remove();
  }
});

test("same declared hash with different bytes and committed overwrite are rejected", async () => {
  const repository = createRepository();
  try {
    const persistence = new GitRawObjectPersistence({ repository_path: repository.path });
    const fixture = rawFixture("collision", textBytes("content-a"));
    await persistFixture(new ProductionRawObjectBoundary(persistence, persistence), fixture);
    await assert.rejects(persistence.putIfAbsent({
      bucket: "trusted-raw-production",
      object_key: `sha256/${fixture.hash.slice(0, 2)}/${fixture.hash.slice(2, 4)}/${fixture.hash}`,
      bytes: textBytes("content-b"),
      content_type: "application/octet-stream"
    }), (error: unknown) => error instanceof ProductionPersistenceError
      && error.code === "HASH_MISMATCH");

    const objectPath = path.join(
      repository.path,
      "trusted-objects",
      "objects",
      "sha256",
      fixture.hash.slice(0, 2),
      fixture.hash.slice(2, 4),
      fixture.hash
    );
    writeFileSync(objectPath, textBytes("committed-overwrite"));
    git(repository.path, "add", "--", "trusted-objects");
    commit(repository.path, "overwrite");
    await assert.rejects(
      new GitRawObjectPersistence({ repository_path: repository.path })
        .listVerifiedAcquisitions(),
      (error: unknown) => error instanceof ProductionPersistenceError
        && error.code === "EVIDENCE_BLOCKED"
    );
  } finally {
    repository.remove();
  }
});

test("deleting a committed Raw object blocks recovery", async () => {
  const repository = createRepository();
  try {
    const persistence = new GitRawObjectPersistence({ repository_path: repository.path });
    const fixture = rawFixture("deleted", textBytes("delete protection"));
    const result = await persistFixture(
      new ProductionRawObjectBoundary(persistence, persistence),
      fixture
    );
    const objectPath = path.join(
      repository.path,
      "trusted-objects",
      "objects",
      ...result.manifest.object_key.split("/")
    );
    rmSync(objectPath);
    git(repository.path, "add", "--", "trusted-objects");
    commit(repository.path, "delete object");
    await assert.rejects(
      new GitRawObjectPersistence({ repository_path: repository.path })
        .listVerifiedAcquisitions(),
      (error: unknown) => error instanceof ProductionPersistenceError
        && (error.code === "INTEGRITY_MISMATCH"
          || error.code === "STORAGE_WRITE_FAILED")
    );
  } finally {
    repository.remove();
  }
});

test("a valid orphan object stays untrusted without a manifest", async () => {
  const repository = createRepository();
  try {
    const bytes = textBytes("orphan official bytes");
    const hash = sha256(bytes);
    const objectPath = path.join(
      repository.path,
      "trusted-objects",
      "objects",
      "sha256",
      hash.slice(0, 2),
      hash.slice(2, 4),
      hash
    );
    writeFileWithParents(objectPath, bytes);
    git(repository.path, "add", "--", "trusted-objects");
    commit(repository.path, "orphan");
    const persistence = new GitRawObjectPersistence({ repository_path: repository.path });
    assert.deepEqual(await persistence.listVerifiedAcquisitions(), []);
    assert.equal(await persistence.getRawBlobManifest(`sha256:${hash}`), null);
    await assert.rejects(
      new ProductionRawObjectBoundary(persistence, persistence)
        .readVerified(`sha256:${hash}`),
      (error: unknown) => error instanceof ProductionPersistenceError
        && error.code === "EVIDENCE_BLOCKED"
    );
  } finally {
    repository.remove();
  }
});

test("small, medium, and large fixtures persist while configured oversize blocks", async () => {
  const repository = createRepository();
  try {
    const persistence = new GitRawObjectPersistence({
      repository_path: repository.path,
      limits: {
        max_object_bytes: 2 * 1024 * 1024,
        annual_archive_bytes: 8 * 1024 * 1024,
        max_repository_bytes: 10 * 1024 * 1024
      }
    });
    const boundary = new ProductionRawObjectBoundary(persistence, persistence);
    for (const [suffix, size] of [
      ["small", 16],
      ["medium", 64 * 1024],
      ["large", 1024 * 1024]
    ] as const) {
      const fixture = rawFixture(suffix, repeatedBytes(size, suffix.charCodeAt(0)));
      assert.equal((await persistFixture(boundary, fixture)).persistence_outcome, "APPENDED");
    }
    assert.equal((await persistence.listVerifiedAcquisitions()).length, 3);

    const blocked = new GitRawObjectPersistence({
      repository_path: repository.path,
      root_path: "blocked-objects",
      limits: {
        max_object_bytes: 8,
        annual_archive_bytes: 1024,
        max_repository_bytes: 2048
      }
    });
    await assert.rejects(blocked.putIfAbsent({
      bucket: "trusted-raw-production",
      object_key: objectKey(sha256(repeatedBytes(9, 7))),
      bytes: repeatedBytes(9, 7),
      content_type: "application/octet-stream"
    }), (error: unknown) => error instanceof ProductionPersistenceError
      && error.code === "EVIDENCE_BLOCKED");

    const archivePersistence = new GitRawObjectPersistence({
      repository_path: repository.path,
      root_path: "archive-threshold-objects",
      limits: {
        max_object_bytes: 64,
        annual_archive_bytes: 20,
        max_repository_bytes: 100
      }
    });
    const archiveBoundary = new ProductionRawObjectBoundary(
      archivePersistence,
      archivePersistence
    );
    await persistFixture(
      archiveBoundary,
      rawFixture("archive-a", repeatedBytes(12, 1))
    );
    await assert.rejects(
      persistFixture(
        archiveBoundary,
        rawFixture("archive-b", repeatedBytes(12, 2))
      ),
      (error: unknown) => error instanceof ProductionPersistenceError
        && error.code === "EVIDENCE_BLOCKED"
    );
  } finally {
    repository.remove();
  }
});

test("SOV persistence rejects Snapshot and ExtractedRecord without committed Raw evidence", async () => {
  const repository = createRepository();
  try {
    const fixture = rawFixture("missing-raw", textBytes("not persisted"));
    const raw = new GitRawObjectPersistence({ repository_path: repository.path });
    const journal = new GitAppendOnlyExecutionStore<TrustedChainCommand>({
      repository_path: repository.path,
      stream_id: "missing-raw-gate",
      scope: "PRODUCTION"
    });
    const root = await bootstrapTrustedChainCompositionRoot({
      scope: "PRODUCTION",
      restoration_journal: createRawValidatedRestorationJournal(raw, journal)
    });
    await assert.rejects(root.root.execute({
      kind: "SOURCE_OCCURRENCE_MATERIALIZE",
      input: {
        source_role: "POSITION_BEARING",
        endpoint: fixture.endpoint,
        snapshot: fixture.snapshot,
        extracted_record: fixture.extractedRecord
      }
    }, {
      actor: "missing-raw-test",
      recorded_at: "2026-09-16T10:00:02.000Z"
    }), /lacks verified Raw evidence/);
    assert.deepEqual(await journal.list(), []);
  } finally {
    repository.remove();
  }
});

test("SQLite index is deleted and rebuilt deterministically from Git state", async () => {
  const repository = createRepository();
  const indexPath = path.join(repository.path, "raw-index.sqlite");
  const copyPath = path.join(repository.path, "raw-index-a.sqlite");
  try {
    const persistence = new GitRawObjectPersistence({ repository_path: repository.path });
    const boundary = new ProductionRawObjectBoundary(persistence, persistence);
    await persistFixture(boundary, rawFixture("index-a", textBytes("index a")));
    await persistFixture(boundary, rawFixture("index-b", textBytes("index b")));
    const first = await rebuildGitRawSqliteIndex({
      persistence,
      database_path: indexPath
    });
    copyFileSync(indexPath, copyPath);
    rmSync(indexPath);
    const second = await rebuildGitRawSqliteIndex({
      persistence: new GitRawObjectPersistence({ repository_path: repository.path }),
      database_path: indexPath
    });
    assert.deepEqual(second, first);
    assert.deepEqual(readFileSync(indexPath), readFileSync(copyPath));
    assert.equal(first.acquisition_count, 2);
    assert.equal(first.raw_blob_count, 2);
    assert.equal(first.snapshot_count, 2);
    assert.equal(first.extracted_record_count, 2);
  } finally {
    repository.remove();
  }
});

test("Raw temporary, pre-commit, and post-commit crashes preserve committed authority", async () => {
  await assertCrashOutcome("AFTER_TEMPORARY_OBJECTS", false, false);
  await assertCrashOutcome("BEFORE_COMMIT", false, true);
  await assertCrashOutcome("AFTER_COMMIT", true, false);
});

test("fresh Process B verifies Raw, Snapshot, ExtractedRecord, then restores SOV", async () => {
  const repository = createRepository();
  const markerPath = path.join(repository.path, "process-b-marker.json");
  const expectedPath = path.join(repository.path, "process-b-expected.json");
  const scriptPath = path.join(repository.path, "process-b.ts");
  try {
    const rawPersistence = new GitRawObjectPersistence({
      repository_path: repository.path
    });
    const fixture = rawFixture("process-b", textBytes("process b official attachment"));
    await persistFixture(
      new ProductionRawObjectBoundary(rawPersistence, rawPersistence),
      fixture
    );
    const journal = new GitAppendOnlyExecutionStore<TrustedChainCommand>({
      repository_path: repository.path,
      stream_id: "git-raw-process-b",
      scope: "PRODUCTION"
    });
    const verifiedJournal = createRawValidatedRestorationJournal(
      rawPersistence,
      journal
    );
    const processA = await bootstrapTrustedChainCompositionRoot({
      scope: "PRODUCTION",
      restoration_journal: verifiedJournal
    });
    const source = await processA.root.execute({
      kind: "SOURCE_OCCURRENCE_MATERIALIZE",
      input: {
        source_role: "POSITION_BEARING",
        endpoint: fixture.endpoint,
        snapshot: fixture.snapshot,
        extracted_record: fixture.extractedRecord
      }
    }, {
      actor: "git-raw-process-a",
      recorded_at: "2026-09-16T10:00:02.000Z"
    }) as { readonly version: { readonly source_occurrence_version_id: string } };
    const expected = {
      raw_blob_id: fixture.rawBlob.raw_blob_id,
      sha256: fixture.hash,
      byte_length: fixture.bytes.byteLength,
      snapshot_id: fixture.snapshot.snapshot_id,
      extracted_record_id: fixture.extractedRecord.extracted_record_id,
      source_occurrence_version_id: source.version.source_occurrence_version_id,
      source_occurrence_version_hash: canonicalHash(source.version)
    };
    writeFileSync(expectedPath, JSON.stringify(expected), "utf8");
    const ingestionModule = pathToFileURL(path.resolve(
      process.cwd(), "lib/ingestion/index.ts"
    )).href;
    const canonicalModule = pathToFileURL(path.resolve(
      process.cwd(), "lib/ingestion/normalization/canonical-artifact-registry.ts"
    )).href;
    const persistenceModule = pathToFileURL(path.resolve(
      process.cwd(), "lib/production-persistence/index.ts"
    )).href;
    writeFileSync(scriptPath, `
      import { readFileSync, writeFileSync } from "node:fs";
      import { bootstrapTrustedChainCompositionRoot } from ${JSON.stringify(ingestionModule)};
      import { canonicalHash } from ${JSON.stringify(canonicalModule)};
      import {
        GitAppendOnlyExecutionStore,
        GitRawObjectPersistence,
        ProductionRawObjectBoundary,
        createRawValidatedRestorationJournal
      } from ${JSON.stringify(persistenceModule)};
      void (async () => {
        const expected = JSON.parse(readFileSync(process.argv[2], "utf8"));
        const repositoryPath = process.argv[3];
        const markerPath = process.argv[4];
        const raw = new GitRawObjectPersistence({ repository_path: repositoryPath });
        const bundles = await raw.listVerifiedAcquisitions();
        const verified = await new ProductionRawObjectBoundary(raw, raw)
          .readVerified(expected.raw_blob_id);
        const journal = new GitAppendOnlyExecutionStore({
          repository_path: repositoryPath,
          stream_id: "git-raw-process-b",
          scope: "PRODUCTION"
        });
        const restored = await bootstrapTrustedChainCompositionRoot({
          scope: "PRODUCTION",
          restoration_journal: createRawValidatedRestorationJournal(raw, journal)
        });
        const source = restored.root.resolvers.source_occurrences.resolve(
          expected.source_occurrence_version_id
        );
        const checks = [
          bundles.length === 1,
          bundles[0]?.raw_blob_manifest?.raw_blob_id === expected.raw_blob_id,
          bundles[0]?.snapshot.snapshot_id === expected.snapshot_id,
          bundles[0]?.extracted_records[0]?.extracted_record_id
            === expected.extracted_record_id,
          verified.manifest.raw_content_sha256 === expected.sha256,
          verified.bytes.byteLength === expected.byte_length,
          source?.version.source_occurrence_version_id
            === expected.source_occurrence_version_id,
          canonicalHash(source?.version) === expected.source_occurrence_version_hash
        ];
        if (checks.some((check) => !check)) throw new Error("Raw Process B mismatch");
        writeFileSync(markerPath, JSON.stringify({
          restored_record_count: restored.restored_record_count,
          process_id: process.pid
        }), "utf8");
      })();
    `, "utf8");
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
    const child = spawnSync(
      process.execPath,
      [tsxCli, scriptPath, expectedPath, repository.path, markerPath],
      { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 }
    );
    assert.equal(child.status, 0,
      `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
      readonly restored_record_count: number;
      readonly process_id: number;
    };
    assert.equal(marker.restored_record_count, 1);
    assert.notEqual(marker.process_id, process.pid);
  } finally {
    repository.remove();
  }
});

async function assertCrashOutcome(
  point: GitRawPersistenceFaultPoint,
  committed: boolean,
  dirty: boolean
) {
  const repository = createRepository();
  try {
    const initialCommit = git(repository.path, "rev-parse", "HEAD").trim();
    const persistence = new GitRawObjectPersistence({
      repository_path: repository.path,
      fault_injector(candidate) {
        if (candidate === point) throw new Error(`simulated Raw crash at ${point}`);
      }
    });
    const fixture = rawFixture(`crash-${point}`, textBytes(`crash ${point}`));
    await assert.rejects(
      persistFixture(new ProductionRawObjectBoundary(persistence, persistence), fixture),
      /simulated Raw crash/
    );
    const currentCommit = git(repository.path, "rev-parse", "HEAD").trim();
    assert.equal(currentCommit === initialCommit, !committed);
    assert.equal(Boolean(git(
      repository.path,
      "status",
      "--porcelain",
      "--",
      "trusted-objects"
    ).trim()), dirty);
    const fresh = new GitRawObjectPersistence({ repository_path: repository.path });
    assert.equal((await fresh.listVerifiedAcquisitions()).length, committed ? 1 : 0);
  } finally {
    repository.remove();
  }
}

function rawFixture(suffix: string, bytes: Uint8Array, responseSetCookiePresent?: boolean) {
  const trusted = trustedFixture(`git-raw-${suffix}`);
  const endpoint = structuredClone(trusted.source.endpoint);
  const hash = sha256(bytes) as RawContentSha256;
  const snapshotId = `snapshot-git-raw-${suffix}` as SnapshotId;
  const rawRepository = new InMemoryRawBlobRepository();
  const snapshotRepository = new InMemorySnapshotRepository();
  const captured = new RawCaptureService(rawRepository, snapshotRepository, {
    create_snapshot_id: () => snapshotId
  }).record({
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    locator: endpoint.locator,
    method: endpoint.request_method ?? null,
    requested_at: "2026-09-16T10:00:00.000Z" as never,
    headers: {},
    parameters: {}
  }, {
    status: "SUCCESS",
    responded_at: "2026-09-16T10:00:01.000Z" as never,
    bytes,
    content_sha256: hash,
    mime_type: "application/octet-stream",
    http_status: 200,
    headers: {},
    ...(responseSetCookiePresent === undefined ? {} : { response_set_cookie_present: responseSetCookiePresent })
  });
  const rawBlob = captured.raw_blob as RawBlob;
  const snapshot = captured.snapshot as Snapshot & { readonly transport_status: "SUCCESS" };
  const extractedRecord = createExtractedRecordV2(snapshot, {
    source_definition_id: endpoint.source_definition_id,
    identity_candidates: [{
      kind: "SOURCE_RECORD_ID",
      value: `row-${suffix}`,
      confidence: "HIGH"
    }],
    raw_source_record_id: `row-${suffix}`,
    raw_title: original("法务岗"),
    raw_organization_name: original("测试官方机构"),
    raw_location_text: [original("北京市")],
    raw_requirement_text: original("法学专业，本科及以上"),
    recruitment_context: structuredClone(
      trusted.source.extracted_record.recruitment_context
    ),
    source_record_locator: {
      kind: "DOCUMENT",
      section: "Sheet1",
      text_locator: `row-${suffix}`
    },
    adapter_metadata: {},
    extraction: {
      extractor_name: "GitRawFixtureExtractor",
      extractor_version: "1.0.0",
      schema_version: "git-raw-fixture/1.0.0"
    }
  });
  const acquisitionRun = {
    acquisition_run_id: `acquisition-git-raw-${suffix}`,
    source_admission_artifact_id: `admission-git-raw-${suffix}`,
    endpoint_artifact_id: `endpoint-artifact-git-raw-${suffix}`,
    allowlist_artifact_id: `allowlist-git-raw-${suffix}`,
    status: "SUCCESS" as const,
    started_at: "2026-09-16T10:00:00.000Z",
    completed_at: "2026-09-16T10:00:02.000Z",
    request_metadata: {},
    result_metadata: {},
    provenance: PROVENANCE
  };
  const bundle = {
    acquisition_run: acquisitionRun,
    snapshot,
    extracted_records: [extractedRecord]
  } satisfies Omit<AcquisitionPersistenceBundle, "raw_blob_manifest">;
  return { bytes, hash, endpoint, rawBlob, snapshot, extractedRecord, bundle };
}

function persistFixture(
  boundary: ProductionRawObjectBoundary,
  fixture: ReturnType<typeof rawFixture>
) {
  return boundary.persistSuccessfulAcquisition({
    raw_blob: fixture.rawBlob,
    source_definition_id: fixture.endpoint.source_definition_id,
    recruitment_endpoint_id: fixture.endpoint.recruitment_endpoint_id,
    acquired_at: fixture.rawBlob.created_at,
    provenance: PROVENANCE,
    bundle: fixture.bundle
  });
}

function createRepository() {
  const repositoryPath = mkdtempSync(path.join(os.tmpdir(), "trusted-git-raw-"));
  git(repositoryPath, "init", "-b", "main");
  writeFileSync(path.join(repositoryPath, "README.md"), "seed", "utf8");
  git(repositoryPath, "add", "README.md");
  commit(repositoryPath, "seed");
  return {
    path: repositoryPath,
    remove() { rmSync(repositoryPath, { recursive: true, force: true }); }
  };
}

function commit(repositoryPath: string, message: string) {
  git(repositoryPath, "-c", "user.name=Test", "-c",
    "user.email=test@example.invalid", "commit", "-m", message);
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function writeFileWithParents(filePath: string, bytes: Uint8Array) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes);
}

function objectKey(hash: string) {
  return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

function rawFactReferenceKey(record: ExtractedRecordV2) {
  const identity = record.extracted_record_id;
  return canonicalSerialize({
    identity,
    path: `trusted-objects/facts/extracted-records/${canonicalHash({ identity })}.json`,
    content_hash: sha256(textBytes(canonicalSerialize(record)))
  });
}

function original(text: string) {
  return { text, encoding: "UTF-8" as const };
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function repeatedBytes(size: number, value: number) {
  return new Uint8Array(size).fill(value);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
