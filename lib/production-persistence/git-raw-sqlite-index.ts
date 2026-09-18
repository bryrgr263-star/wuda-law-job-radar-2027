import { existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { canonicalHash, canonicalSerialize } from
  "../ingestion/normalization/canonical-artifact-registry";
import type { GitRawObjectPersistence } from "./git-raw-object-persistence";

export interface GitRawSqliteIndexResult {
  readonly acquisition_count: number;
  readonly raw_blob_count: number;
  readonly snapshot_count: number;
  readonly extracted_record_count: number;
  readonly index_hash: string;
}

export async function rebuildGitRawSqliteIndex(input: {
  readonly persistence: GitRawObjectPersistence;
  readonly database_path: string;
}): Promise<GitRawSqliteIndexResult> {
  removeDatabaseFiles(input.database_path);
  const bundles = [...await input.persistence.listVerifiedAcquisitions()].sort(
    (left, right) => left.acquisition_run.acquisition_run_id.localeCompare(
      right.acquisition_run.acquisition_run_id
    )
  );
  const rawManifests = new Map<string, string>();
  const snapshots = new Map<string, string>();
  const extractedRecords = new Map<string, string>();
  for (const bundle of bundles) {
    if (bundle.raw_blob_manifest) {
      rawManifests.set(
        bundle.raw_blob_manifest.raw_blob_id,
        canonicalSerialize(bundle.raw_blob_manifest)
      );
    }
    snapshots.set(bundle.snapshot.snapshot_id, canonicalSerialize(bundle.snapshot));
    for (const record of bundle.extracted_records) {
      extractedRecords.set(record.extracted_record_id, canonicalSerialize(record));
    }
  }
  const indexContent = {
    acquisitions: bundles.map((bundle) => ({
      acquisition_run_id: bundle.acquisition_run.acquisition_run_id,
      raw_blob_id: bundle.raw_blob_manifest?.raw_blob_id ?? null,
      snapshot_id: bundle.snapshot.snapshot_id,
      extracted_record_ids: bundle.extracted_records
        .map((record) => record.extracted_record_id).sort(),
      canonical_hash: canonicalHash(bundle)
    })),
    raw_blobs: [...rawManifests.entries()].sort(compareEntries),
    snapshots: [...snapshots.entries()].sort(compareEntries),
    extracted_records: [...extractedRecords.entries()].sort(compareEntries)
  };
  const indexHash = canonicalHash(indexContent);
  const database = new DatabaseSync(input.database_path);
  try {
    database.exec(`
      pragma journal_mode = delete;
      pragma synchronous = full;
      create table index_metadata (
        key text primary key,
        value text not null
      ) strict;
      create table raw_blob_manifests (
        raw_blob_id text primary key,
        sha256 text not null unique,
        object_key text not null unique,
        byte_length integer not null,
        canonical_json text not null
      ) strict;
      create table acquisitions (
        acquisition_run_id text primary key,
        raw_blob_id text,
        snapshot_id text not null unique,
        canonical_json text not null
      ) strict;
      create table extracted_records (
        extracted_record_id text primary key,
        snapshot_id text not null,
        canonical_json text not null
      ) strict;
      create index extracted_records_snapshot_idx
        on extracted_records(snapshot_id);
    `);
    const insertMetadata = database.prepare(
      "insert into index_metadata(key, value) values (?, ?)"
    );
    insertMetadata.run("schema_version", "git-raw-sqlite-index/1.0.0");
    insertMetadata.run("index_hash", indexHash);
    const insertRaw = database.prepare(`
      insert into raw_blob_manifests(
        raw_blob_id, sha256, object_key, byte_length, canonical_json
      ) values (?, ?, ?, ?, ?)
    `);
    for (const bundle of bundles) {
      const manifest = bundle.raw_blob_manifest;
      if (!manifest || rawManifests.get(manifest.raw_blob_id) === undefined) continue;
      insertRaw.run(
        manifest.raw_blob_id,
        manifest.raw_content_sha256,
        manifest.object_key,
        manifest.byte_length,
        rawManifests.get(manifest.raw_blob_id)!
      );
      rawManifests.delete(manifest.raw_blob_id);
    }
    const insertAcquisition = database.prepare(`
      insert into acquisitions(
        acquisition_run_id, raw_blob_id, snapshot_id, canonical_json
      ) values (?, ?, ?, ?)
    `);
    const insertRecord = database.prepare(`
      insert into extracted_records(
        extracted_record_id, snapshot_id, canonical_json
      ) values (?, ?, ?)
    `);
    for (const bundle of bundles) {
      insertAcquisition.run(
        bundle.acquisition_run.acquisition_run_id,
        bundle.raw_blob_manifest?.raw_blob_id ?? null,
        bundle.snapshot.snapshot_id,
        canonicalSerialize(bundle)
      );
      for (const record of [...bundle.extracted_records].sort((left, right) => {
        return left.extracted_record_id.localeCompare(right.extracted_record_id);
      })) {
        insertRecord.run(
          record.extracted_record_id,
          record.snapshot_id,
          canonicalSerialize(record)
        );
      }
    }
  } finally {
    database.close();
  }
  return {
    acquisition_count: bundles.length,
    raw_blob_count: indexContent.raw_blobs.length,
    snapshot_count: snapshots.size,
    extracted_record_count: extractedRecords.size,
    index_hash: indexHash
  };
}

function removeDatabaseFiles(databasePath: string) {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }
}

function compareEntries(left: readonly [string, string], right: readonly [string, string]) {
  return left[0].localeCompare(right[0]);
}
