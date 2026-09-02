import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import { assertPreviewStorageMetadataIsSafe, mapPreviewRawBlobToStorage, PREVIEW_RAW_STORAGE_POLICY, previewRawObjectPath } from "../../lib/application/preview-persistence";

const sha256 = "a".repeat(64);

test("Preview Raw Storage uses deterministic private SHA-256 object paths", () => {
  assert.equal(previewRawObjectPath(sha256), `raw/sha256/aa/${sha256}`);
  assert.equal(previewRawObjectPath(sha256.toUpperCase()), `raw/sha256/aa/${sha256}`);
  assert.equal(PREVIEW_RAW_STORAGE_POLICY.visibility, "PRIVATE");
  assert.equal(PREVIEW_RAW_STORAGE_POLICY.client_direct_read, false);
});

test("Preview Raw Storage maps immutable metadata without storing bytes", () => {
  const reference = mapPreviewRawBlobToStorage({ raw_blob_id: "raw-001", sha256, mime_type: "text/html; charset=utf-8", byte_length: 42, created_at: "2026-09-04T09:00:00+08:00" });
  assert.equal(reference.bucket_name, "preview-ingestion-raw-private");
  assert.equal(reference.object_path, `raw/sha256/aa/${sha256}`);
  assert.equal("bytes" in reference, false);
});

test("Preview Raw Storage rejects invalid or sensitive metadata", () => {
  assert.throws(() => previewRawObjectPath("not-a-sha"), /SHA-256/);
  assert.throws(() => mapPreviewRawBlobToStorage({ raw_blob_id: "", sha256, mime_type: "application/json", byte_length: 1, created_at: "2026-09-04T09:00:00+08:00" }), /immutable RawBlob metadata/);
  assert.throws(() => assertPreviewStorageMetadataIsSafe({ authorization: "forbidden" }), /sensitive key/);
  assert.throws(() => assertPreviewStorageMetadataIsSafe({ session_id: "forbidden" }), /sensitive key/);
  assert.doesNotThrow(() => assertPreviewStorageMetadataIsSafe({ mime_type: "application/pdf", byte_length: 9 }));
});

test("P2-02 Raw Storage tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
