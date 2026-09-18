import "./historical-evidence-read-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { assertHistoricalEvidenceReadAllowed } from "./historical-evidence-read-guard";

interface HistoricalEvidenceEntry {
  fixture_id: string;
  historical_role: string;
  repository_relative_path: string;
  sha256: string;
  byte_length: number;
  media_type: string;
  origin_reference: string;
  used_by_tests: string[];
  packaging_reason: string;
  action: string;
}

const repositoryRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const manifestPath = path.join(repositoryRoot, "tests/fixtures/historical-evidence/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.schema_version, "historical-test-evidence/1.0.0", "Historical evidence schema");
assert.equal(manifest.boundary, "TEST_ONLY", "Historical evidence boundary");
for (const flag of ["production_authority", "runtime_source", "new_trust_source"]) {
  assert.equal(manifest[flag], false, `Historical evidence ${flag}`);
}
assert.ok(Array.isArray(manifest.entries), "Historical evidence inventory");
const entries: HistoricalEvidenceEntry[] = manifest.entries.map((entry: HistoricalEvidenceEntry) => {
  assert.ok(typeof entry.fixture_id === "string" && entry.fixture_id.length > 0, "Historical evidence ID");
  assert.ok(typeof entry.repository_relative_path === "string", "Historical evidence path");
  assert.match(entry.sha256, /^[a-f0-9]{64}$/, "Historical evidence SHA-256");
  assert.ok(Number.isSafeInteger(entry.byte_length) && entry.byte_length > 0, "Historical evidence size");
  assert.ok(Array.isArray(entry.used_by_tests) && entry.used_by_tests.every((value) => typeof value === "string"),
    "Historical evidence test consumers");
  return structuredClone(entry);
});
assert.equal(new Set(entries.map((entry) => entry.fixture_id)).size, entries.length, "Historical evidence duplicate IDs");
assert.equal(new Set(entries.map((entry) => entry.repository_relative_path)).size, entries.length,
  "Historical evidence duplicate paths");

export function historicalEvidenceInventory(): HistoricalEvidenceEntry[] {
  return structuredClone(entries);
}

export function resolveHistoricalEvidencePath(repositoryRelativePath: string): string {
  assert.ok(!path.isAbsolute(repositoryRelativePath) && !path.win32.isAbsolute(repositoryRelativePath)
    && !repositoryRelativePath.includes("\\") && !repositoryRelativePath.split("/").includes("..")
    && !repositoryRelativePath.split("/").includes("outputs"), "Historical evidence requires a safe relative path");
  assert.ok(entries.some((entry) => entry.repository_relative_path === repositoryRelativePath),
    "Historical evidence path is not inventoried");
  const resolved = realpathSync(path.join(repositoryRoot, repositoryRelativePath));
  const relative = path.relative(repositoryRoot, resolved);
  assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    "Historical evidence symlink escapes repository");
  return resolved;
}

export function verifyHistoricalEvidenceBytes(fixtureId: string, bytes: Uint8Array): void {
  const entry = entries.find((candidate) => candidate.fixture_id === fixtureId);
  assert.ok(entry, `Historical evidence ID is unknown: ${fixtureId}`);
  assert.equal(bytes.byteLength, entry.byte_length, `Historical evidence byte length: ${fixtureId}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256,
    `Historical evidence SHA-256: ${fixtureId}`);
}

export function readHistoricalEvidenceBytes(fixtureId: string): Buffer {
  const entry = entries.find((candidate) => candidate.fixture_id === fixtureId);
  assert.ok(entry, `Historical evidence ID is unknown: ${fixtureId}`);
  const bytes = readFileSync(resolveHistoricalEvidencePath(entry.repository_relative_path));
  verifyHistoricalEvidenceBytes(fixtureId, bytes);
  return bytes;
}

export function readHistoricalEvidenceJson<Value>(fixtureId: string): Value {
  return JSON.parse(readHistoricalEvidenceBytes(fixtureId).toString("utf8"));
}
