import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PREVIEW_PERSISTENCE_CONTRACT } from "../../lib/application/preview-persistence";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationRoot = path.join(repositoryRoot, "preview", "migrations");
const upMigration = readFileSync(path.join(migrationRoot, "001_preview_ingestion.up.sql"), "utf8");
const downMigration = readFileSync(path.join(migrationRoot, "001_preview_ingestion.down.sql"), "utf8");

test("Preview PostgreSQL migration maps frozen domain entities into an isolated schema", () => {
  assert.match(upMigration, /CREATE SCHEMA IF NOT EXISTS preview_ingestion/);
  for (const table of PREVIEW_PERSISTENCE_CONTRACT.tables) {
    const [, name] = table.split(".");
    assert.match(upMigration, new RegExp(`CREATE TABLE IF NOT EXISTS preview_ingestion\\.${name}\\b`));
  }
  assert.doesNotMatch(upMigration, /\b(?:source_runs|source_run_observations|source_run_assessments|missing_streak|lifecycle_events)\b/iu);
});

test("Preview migration keeps RawBlob content private and Snapshot references explicit", () => {
  assert.match(upMigration, /object_path TEXT NOT NULL UNIQUE/);
  assert.match(upMigration, /raw_blob_id TEXT REFERENCES preview_ingestion\.raw_blobs/);
  assert.match(upMigration, /transport_status IN \('SUCCESS', 'FAILED'\)/);
  assert.match(upMigration, /transport_status = 'SUCCESS' AND raw_blob_id IS NOT NULL/);
  assert.doesNotMatch(upMigration, /raw_bytes|raw_content|content_bytes/iu);
});

test("Preview PostgreSQL migration declares RLS, private grants, and append-only protection", () => {
  assert.match(upMigration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(upMigration, /preview_ingestion_service/);
  assert.match(upMigration, /preview_ingestion_read_api/);
  assert.match(upMigration, /REVOKE ALL ON ALL TABLES IN SCHEMA preview_ingestion FROM PUBLIC/);
  assert.match(upMigration, /GRANT SELECT ON preview_ingestion\.public_opportunity_projection TO preview_ingestion_read_api/);
  assert.doesNotMatch(upMigration, /GRANT .* ON ALL TABLES IN SCHEMA preview_ingestion TO preview_ingestion_read_api/);
  assert.match(upMigration, /reject_mutation/);
  assert.match(upMigration, /BEFORE UPDATE OR DELETE/);
});

test("Preview rollback removes only the isolated Preview schema and supports replay", () => {
  assert.match(downMigration, /DROP SCHEMA IF EXISTS preview_ingestion CASCADE/);
  assert.doesNotMatch(downMigration, /\b(?:supabase|sources|jobs|applications|sync_runs)\b/iu);
  assert.doesNotMatch(upMigration, /\b(?:CREATE|ALTER|DROP|DELETE|UPDATE)\s+(?:TABLE\s+)?(?:sources|jobs|applications|sync_runs)\b/iu);
});

test("P2-02 migration contract tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
