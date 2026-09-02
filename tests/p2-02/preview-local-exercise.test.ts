import "../helpers/network-guard";

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const localPreviewMigration = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS preview_sim_schema_migrations (migration_id TEXT PRIMARY KEY);
  INSERT OR IGNORE INTO preview_sim_schema_migrations VALUES ('001_preview_ingestion');
  CREATE TABLE IF NOT EXISTS preview_sim_organizations (organization_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS preview_sim_source_definitions (source_definition_id TEXT PRIMARY KEY, publisher_organization_id TEXT NOT NULL REFERENCES preview_sim_organizations (organization_id), payload_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS preview_sim_raw_blobs (raw_blob_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, object_path TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS preview_sim_snapshots (snapshot_id TEXT PRIMARY KEY, raw_blob_id TEXT REFERENCES preview_sim_raw_blobs (raw_blob_id), transport_status TEXT NOT NULL CHECK (transport_status IN ('SUCCESS', 'FAILED')), CHECK (transport_status = 'FAILED' OR raw_blob_id IS NOT NULL));
  CREATE TABLE IF NOT EXISTS preview_sim_source_occurrences (source_occurrence_id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS preview_sim_source_occurrence_versions (source_occurrence_version_id TEXT PRIMARY KEY, source_occurrence_id TEXT NOT NULL REFERENCES preview_sim_source_occurrences (source_occurrence_id), revision INTEGER NOT NULL CHECK (revision > 0), semantic_hash TEXT NOT NULL, UNIQUE (source_occurrence_id, revision), UNIQUE (source_occurrence_id, semantic_hash));
  CREATE TRIGGER IF NOT EXISTS preview_sim_raw_blobs_no_update BEFORE UPDATE ON preview_sim_raw_blobs BEGIN SELECT RAISE(ABORT, 'preview_sim_raw_blobs is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS preview_sim_raw_blobs_no_delete BEFORE DELETE ON preview_sim_raw_blobs BEGIN SELECT RAISE(ABORT, 'preview_sim_raw_blobs is append-only'); END;
`;

function createLocalPreviewDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(localPreviewMigration);
  return database;
}

test("local Preview exercise supports a clean migration and replay", () => {
  const database = createLocalPreviewDatabase();
  database.exec(localPreviewMigration);
  assert.deepEqual(database.prepare("SELECT migration_id FROM preview_sim_schema_migrations").all().map((row) => row.migration_id), ["001_preview_ingestion"]);
  assert.equal(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  database.close();
});

test("local Preview exercise verifies foreign keys, uniqueness, and append-only rows", () => {
  const database = createLocalPreviewDatabase();
  assert.throws(() => database.prepare("INSERT INTO preview_sim_source_definitions VALUES (?, ?, ?)").run("source-1", "absent-organization", "{}"), /FOREIGN KEY/);
  database.prepare("INSERT INTO preview_sim_raw_blobs VALUES (?, ?, ?)").run("raw-1", "a".repeat(64), `raw/sha256/aa/${"a".repeat(64)}`);
  assert.throws(() => database.prepare("INSERT INTO preview_sim_raw_blobs VALUES (?, ?, ?)").run("raw-2", "a".repeat(64), `raw/sha256/aa/${"a".repeat(64)}`), /UNIQUE/);
  assert.throws(() => database.prepare("UPDATE preview_sim_raw_blobs SET object_path = ? WHERE raw_blob_id = ?").run("raw/changed", "raw-1"), /append-only/);
  database.close();
});

test("local Preview exercise rolls back a failed transaction and models Snapshot-to-RawBlob", () => {
  const database = createLocalPreviewDatabase();
  database.exec("BEGIN");
  database.prepare("INSERT INTO preview_sim_organizations VALUES (?, ?)").run("organization-1", "{}");
  assert.throws(() => database.prepare("INSERT INTO preview_sim_source_definitions VALUES (?, ?, ?)").run("source-1", "missing-organization", "{}"), /FOREIGN KEY/);
  database.exec("ROLLBACK");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM preview_sim_organizations").get()?.count, 0);
  database.prepare("INSERT INTO preview_sim_raw_blobs VALUES (?, ?, ?)").run("raw-1", "b".repeat(64), `raw/sha256/bb/${"b".repeat(64)}`);
  database.prepare("INSERT INTO preview_sim_snapshots VALUES (?, ?, ?)").run("snapshot-success", "raw-1", "SUCCESS");
  database.prepare("INSERT INTO preview_sim_snapshots VALUES (?, ?, ?)").run("snapshot-failed", null, "FAILED");
  assert.throws(() => database.prepare("INSERT INTO preview_sim_snapshots VALUES (?, ?, ?)").run("snapshot-invalid", null, "SUCCESS"), /CHECK/);
  database.close();
});

test("P2-02 local Preview exercise remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
