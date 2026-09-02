import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  createMigratedShadowDatabase,
  readShadowMigration
} from "./shadow-test-database";

const expectedBusinessTables = [
  "shadow_candidate_profiles",
  "shadow_canonical_opportunities",
  "shadow_eligibility_assessment_evidence",
  "shadow_eligibility_assessment_facts",
  "shadow_eligibility_assessments",
  "shadow_opportunity_version_sources",
  "shadow_opportunity_versions",
  "shadow_organizations",
  "shadow_recruitment_endpoints",
  "shadow_requirement_evidence",
  "shadow_requirement_facts",
  "shadow_source_definitions",
  "shadow_source_occurrence_versions",
  "shadow_source_occurrences"
] as const;

test("shadow migration applies to a fresh in-memory database", () => {
  const database = createMigratedShadowDatabase();
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'shadow_%' ORDER BY name"
  ).all().map((row) => String(row.name));

  assert.deepEqual(tables, [
    ...expectedBusinessTables,
    "shadow_schema_migrations"
  ].sort());
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  database.close();
});

test("shadow migration is idempotent and records its isolated migration id", () => {
  const database = createMigratedShadowDatabase();
  database.exec(readShadowMigration());
  const migrations = database.prepare(
    "SELECT migration_id FROM shadow_schema_migrations ORDER BY migration_id"
  ).all().map((row) => String(row.migration_id));

  assert.deepEqual(migrations, ["001_shadow_persistence"]);
  database.close();
});

test("migration never creates or modifies legacy production tables", () => {
  const migration = readShadowMigration();
  const database = createMigratedShadowDatabase();
  const productionTables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('sources', 'jobs', 'applications', 'sync_runs')"
  ).all();

  assert.deepEqual(productionTables, []);
  assert.doesNotMatch(migration, /(?:ALTER|DROP|DELETE|UPDATE)\s+(?:TABLE\s+)?(?:sources|jobs|applications|sync_runs)\b/iu);
  database.close();
});

test("shadow business tables are physically append-only", () => {
  const database = createMigratedShadowDatabase();
  database.prepare(
    "INSERT INTO shadow_organizations (organization_id, payload_json) VALUES (?, ?)"
  ).run("append-only-organization", JSON.stringify({ organization_id: "append-only-organization" }));

  assert.throws(() => database.prepare(
    "UPDATE shadow_organizations SET payload_json = ? WHERE organization_id = ?"
  ).run("{}", "append-only-organization"), /append-only/);
  assert.throws(() => database.prepare(
    "DELETE FROM shadow_organizations WHERE organization_id = ?"
  ).run("append-only-organization"), /append-only/);
  database.close();
});

test("migration contains no lifecycle or Source Run persistence table", () => {
  const database = createMigratedShadowDatabase();
  const lifecycleTables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND (name LIKE '%lifecycle%' OR name LIKE '%source_run%' OR name LIKE '%missing%')"
  ).all();

  assert.deepEqual(lifecycleTables, []);
  database.close();
});

test("P1-11 migration tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});
