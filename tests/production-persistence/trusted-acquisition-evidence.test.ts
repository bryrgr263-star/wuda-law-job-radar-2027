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

test("multi-target unchanged requires complete ordered coverage, not one unchanged target", () => {
  const first = collection('{"jobs":[{"title":"Legal"}],"total":1,"next":null}', 1);
  const secondLocator = "https://official.invalid/jobs/detail";
  const second = collection('{"jobs":[{"title":"Legal detail"}],"total":1,"next":null}', 1);
  const both = { ...first, request_results: [first.request_results[0]!, {
    ...second.request_results[0]!, request: { ...second.request_results[0]!.request, locator: secondLocator }
  }], snapshots: [...first.snapshots, ...second.snapshots], raw_blobs: [...first.raw_blobs, ...second.raw_blobs],
  pages_collected: 2, requests_made: 2 } as CollectionRunRuntimeResult;
  const previous = { source_execution_id: "prior", requests: [
    { locator, raw_hash: first.raw_blobs[0]!.raw_content_sha256 },
    { locator: secondLocator, raw_hash: second.raw_blobs[0]!.raw_content_sha256 }
  ] };
  assert.equal(classifyTrustedAcquisition({ collection: both, previous, content_kind: "JSON" }).status, "NOT_MODIFIED");
  const changedSecond = collection('{"jobs":[{"title":"Updated detail"}],"total":1,"next":null}', 1);
  const changed = { ...both, request_results: [both.request_results[0]!, {
    ...changedSecond.request_results[0]!, request: { ...changedSecond.request_results[0]!.request, locator: secondLocator }
  }] } as CollectionRunRuntimeResult;
  assert.equal(classifyTrustedAcquisition({ collection: changed, previous, content_kind: "JSON" }).status, "SUCCESS");
  const incomplete = { ...both, status: "PARTIAL" as const, request_results: [both.request_results[0]!] };
  assert.equal(classifyTrustedAcquisition({ collection: incomplete, previous, content_kind: "JSON" }).status, "PARTIAL");
});

test("one empty target never confirms an empty multi-target source", () => {
  const closed = collection('{"jobs":[],"total":0,"next":null}', 0);
  const twoTargets = { ...closed,
    request_results: [closed.request_results[0]!, { ...closed.request_results[0]!,
      request: { ...closed.request_results[0]!.request, locator: `${locator}/detail` } }],
    snapshots: [...closed.snapshots, ...closed.snapshots], raw_blobs: [...closed.raw_blobs, ...closed.raw_blobs],
    pages_collected: 2, requests_made: 2 } as CollectionRunRuntimeResult;
  assert.equal(classifyTrustedAcquisition({ collection: twoTargets, previous: null, content_kind: "JSON" }).status,
    "SUSPICIOUS_EMPTY");
  const missingSecond = { ...closed, status: "PARTIAL" as const };
  assert.equal(classifyTrustedAcquisition({ collection: missingSecond, previous: null, content_kind: "JSON" }).status,
    "PARTIAL");
});
