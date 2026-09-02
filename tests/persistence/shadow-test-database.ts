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

export function readShadowMigration() {
  return readFileSync(shadowMigrationPath, "utf8");
}

export function createMigratedShadowDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(readShadowMigration());
  return database;
}
