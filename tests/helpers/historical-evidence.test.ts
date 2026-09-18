import "./network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loader() {
  const module = await import("./historical-evidence").catch(() => null);
  assert.ok(module, "TEST_ONLY portable historical evidence loader is required");
  return module;
}

test("every packaged historical file has its exact original hash and size", async () => {
  const evidence = await loader();
  const inventory = evidence.historicalEvidenceInventory();
  assert.equal(inventory.length, 8);
  for (const entry of inventory) {
    const bytes = evidence.readHistoricalEvidenceBytes(entry.fixture_id);
    assert.equal(bytes.length, entry.byte_length, entry.fixture_id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.fixture_id);
  }
});

test("portable resolver rejects absolute, traversal, outputs and unlisted paths", async () => {
  const evidence = await loader();
  for (const locator of ["C:\\outside\\raw.xlsx", "/outside/raw.html", "../raw.xlsx",
    "tests/fixtures/historical-evidence/../raw.xlsx", "outputs/raw.xlsx",
    "tests/fixtures/historical-evidence/unlisted.json"]) {
    assert.throws(() => evidence.resolveHistoricalEvidencePath(locator), /historical evidence/i);
  }
  assert.throws(() => evidence.readHistoricalEvidenceBytes("unknown"), /historical evidence/i);
});

test("historical read guard rejects external and ignored evidence without opening it", async () => {
  const evidence = await loader();
  for (const locator of ["C:\\other-checkout\\raw.xlsx", "/outside/raw.html", "outputs/canary/raw.html"]) {
    assert.throws(() => evidence.assertHistoricalEvidenceReadAllowed(locator), /historical evidence/i);
  }
});

test("direct synchronous and asynchronous filesystem reads cannot bypass the historical guard", async () => {
  await loader();
  assert.throws(() => readFileSync("outputs/canary/raw.html"), /historical evidence/i);
  assert.throws(() => readFileSync("C:\\other-checkout\\raw.xlsx"), /historical evidence/i);
  await assert.rejects(readFile("outputs/canary/snapshot.json"), /historical evidence/i);
});

test("truncated or modified historical bytes fail integrity verification", async () => {
  const evidence = await loader();
  const bytes = evidence.readHistoricalEvidenceBytes("guizhou-attachment-xlsx");
  assert.throws(() => evidence.verifyHistoricalEvidenceBytes("guizhou-attachment-xlsx", bytes.subarray(1)),
    /historical evidence byte length/i);
  bytes[0] ^= 1;
  assert.throws(() => evidence.verifyHistoricalEvidenceBytes("guizhou-attachment-xlsx", bytes),
    /historical evidence SHA-256/i);
});

test("fixture reads and inventory copies cannot mutate preserved historical bytes", async () => {
  const evidence = await loader();
  const bytes = evidence.readHistoricalEvidenceBytes("guizhou-attachment-xlsx");
  const original = Buffer.from(bytes);
  bytes.fill(0);
  assert.deepEqual(evidence.readHistoricalEvidenceBytes("guizhou-attachment-xlsx"), original);
  const inventory = evidence.historicalEvidenceInventory();
  inventory[0]!.sha256 = "invalid";
  assert.notEqual(evidence.historicalEvidenceInventory()[0]!.sha256, "invalid");
});

test("historical Snapshot identity and the 24 composition blockers remain unchanged", async () => {
  const evidence = await loader();
  const snapshot = evidence.readHistoricalEvidenceJson<{ snapshot_id: string; content_hash: string }>(
    "guizhou-attachment-snapshot");
  assert.equal(snapshot.snapshot_id, "p2-legal-04-snapshot:194cfc4e-18ec-4f79-9a61-0551bafbcfa9");
  assert.equal(snapshot.content_hash, "87b013e13ea78cd1de130553f203024fbd8c274479219b39ae1bd4280fc8f7ec");
  const composition = evidence.readHistoricalEvidenceJson<{ composition_blockers: unknown[] }>(
    "guizhou-requirement-composition");
  assert.equal(composition.composition_blockers.length, 24);
});
