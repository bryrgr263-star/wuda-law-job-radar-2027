import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export const shadowMigrationPath = path.join(
  repositoryRoot,
  "shadow",
  "migrations",
  "001_shadow_persistence.sql"
);

export const opportunityRecallMigrationPath = path.join(
  repositoryRoot,
  "shadow",
  "migrations",
  "002_opportunity_recall.sql"
);

export function readShadowMigration() {
  return readFileSync(shadowMigrationPath, "utf8");
}

export function readOpportunityRecallMigration() {
  return readFileSync(opportunityRecallMigrationPath, "utf8");
}

export function readShadowMigrations() {
  return [readShadowMigration(), readOpportunityRecallMigration()];
}

export function createMigratedShadowDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const migration of readShadowMigrations()) database.exec(migration);
  return database;
}
