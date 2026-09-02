import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import { createPreviewRecoveryManifest, planPreviewRecovery } from "../../lib/application/preview-persistence";

const sha256 = "b".repeat(64);

test("Preview recovery manifest is deterministic and content-addressed", () => {
  const manifest = createPreviewRecoveryManifest({ migration_ids: ["002_preview_future", "001_preview_ingestion", "001_preview_ingestion"], raw_blob_sha256: [sha256.toUpperCase(), sha256], created_at: "2026-09-04T10:00:00+08:00" });
  assert.deepEqual(manifest.migration_ids, ["001_preview_ingestion", "002_preview_future"]);
  assert.deepEqual(manifest.raw_blob_sha256, [sha256]);
});

test("Preview recovery plan is local or Preview only", () => {
  const manifest = createPreviewRecoveryManifest({ migration_ids: ["001_preview_ingestion"], raw_blob_sha256: [sha256], created_at: "2026-09-04T10:00:00+08:00" });
  assert.deepEqual(planPreviewRecovery(manifest).steps, ["RESTORE_EMPTY_PREVIEW_DATABASE", "REPLAY_MIGRATIONS", "VERIFY_FOREIGN_KEYS_AND_CONSTRAINTS", "VERIFY_PRIVATE_RAW_OBJECT_HASHES", "RECONCILE_SNAPSHOT_RAW_REFERENCES"]);
});

test("Preview recovery rejects malformed migration identifiers and raw hashes", () => {
  assert.throws(() => createPreviewRecoveryManifest({ migration_ids: ["migration"], raw_blob_sha256: [sha256], created_at: "2026-09-04T10:00:00+08:00" }), /versioned preview migration/);
  assert.throws(() => createPreviewRecoveryManifest({ migration_ids: ["001_preview_ingestion"], raw_blob_sha256: ["not-a-hash"], created_at: "2026-09-04T10:00:00+08:00" }), /SHA-256/);
});

test("P2-02 recovery tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
