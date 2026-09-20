import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { CollectionRunRuntimeResult } from "../../lib/collection-runtime";
import { classifyTrustedAcquisition } from "../../lib/production-persistence/trusted-acquisition-evidence";

const locator = "https://official.invalid/jobs";

function collection(body: string, records: number): CollectionRunRuntimeResult {
  const bytes = new TextEncoder().encode(body);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const snapshot = { snapshot_id: `snapshot:${hash}`, recruitment_endpoint_id: "endpoint:controlled",
    transport_status: "SUCCESS", raw_blob_id: `raw:${hash}`, content_hash: hash };
  const raw = { raw_blob_id: `raw:${hash}`, raw_content_sha256: hash, bytes, byte_length: bytes.length,
    mime_type: "application/json" };
  return { collection_run_id: `run:${hash}`, source_definition_id: "source:controlled",
    recruitment_endpoint_id: "endpoint:controlled", started_at: "2026-09-19T00:00:00.000Z",
    completed_at: "2026-09-19T00:01:00.000Z", status: records ? "SUCCESS" : "SUSPICIOUS_EMPTY",
    runtime_states: ["CREATED", "RUNNING", "COMPLETED"], reason_codes: records ? [] : ["ZERO_EXTRACTED_RECORDS"],
    request_results: [{ request: { locator }, response: { status: "SUCCESS" }, snapshot, raw_blob: raw }], snapshots: [snapshot],
    raw_blobs: [raw], extracted_records: Array.from({ length: records }, (_, index) => ({ extracted_record_id: `record:${index}` })),
    pages_collected: 1, requests_made: 1 } as unknown as CollectionRunRuntimeResult;
}

test("identical verified Raw is NOT_MODIFIED, but identical parsed count with changed Raw is not", () => {
  const first = collection('{"jobs":[{"title":"Legal"}],"total":1,"next":null}', 1);
  const prior = { source_execution_id: "prior", requests: [{ locator, raw_hash: first.raw_blobs[0]!.raw_content_sha256 }] };
  assert.equal(classifyTrustedAcquisition({ collection: first, previous: prior, content_kind: "JSON" }).status, "NOT_MODIFIED");
  const changed = collection('{"jobs":[{"title":"Legal"}],"total":1,"next":null,"updated":true}', 1);
  assert.equal(classifyTrustedAcquisition({ collection: changed, previous: prior, content_kind: "JSON" }).status, "SUCCESS");
});

test("P1 guard accepts only exact closed official zero evidence; weak empty remains suspicious", () => {
  const previous = { source_execution_id: "prior", requests: [{ locator, raw_hash: "prior-content-hash" }] };
  const closed = collection('{"jobs":[],"total":0,"next":null}', 0);
  assert.equal(classifyTrustedAcquisition({ collection: closed, previous, content_kind: "JSON" }).status, "CONFIRMED_EMPTY");
  const weak = collection('{"jobs":[]}', 0);
  assert.equal(classifyTrustedAcquisition({ collection: weak, previous, content_kind: "JSON" }).status, "SUSPICIOUS_EMPTY");
  assert.equal(classifyTrustedAcquisition({ collection: closed, previous: null, content_kind: "JSON" }).status, "SUSPICIOUS_EMPTY");
});
