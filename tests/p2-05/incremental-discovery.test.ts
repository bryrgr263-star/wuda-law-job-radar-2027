import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverIncrementalChanges,
  type SnapshotRecordSet
} from "../../lib/source-scheduler";
import { UTF8_TEXT_ENCODING, type ExtractedRecord } from "../../lib/ingestion";
import { successfulSnapshot } from "./test-support";

const endpointId = "endpoint-p2-05-incremental" as never;
const sourceDefinitionId = "source-p2-05-incremental" as never;

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function record(input: {
  readonly id: string;
  readonly snapshot_id: string;
  readonly title?: string;
  readonly detail_url?: string;
  readonly source_record_id?: string;
  readonly published?: string;
  readonly requirement?: string;
}): ExtractedRecord {
  return {
    extracted_record_id: input.id as ExtractedRecord["extracted_record_id"],
    snapshot_id: input.snapshot_id as ExtractedRecord["snapshot_id"],
    source_definition_id: sourceDefinitionId,
    identity_candidates: input.detail_url ? [{ kind: "ANNOUNCEMENT_URL", value: input.detail_url, confidence: "HIGH" }] : [],
    raw_source_record_id: input.source_record_id,
    raw_title: input.title ? original(input.title) : undefined,
    raw_organization_name: original("北京市测试单位"),
    raw_location_text: [original("北京市")],
    raw_requirement_text: input.requirement ? original(input.requirement) : undefined,
    announcement_url: input.detail_url,
    publish_time: input.published ? original(input.published) : undefined,
    source_record_locator: { kind: "HTML", selector: ".list > li" },
    adapter_metadata: {},
    extraction: {
      extractor_name: "P2-05SyntheticAdapter",
      extractor_version: "1",
      extracted_at: "2026-09-02T00:00:00.000Z" as never
    }
  };
}

function set(snapshotId: string, hash: string, records: readonly ExtractedRecord[]): SnapshotRecordSet {
  return {
    snapshot: successfulSnapshot(snapshotId, hash, endpointId),
    records
  };
}

test("incremental discovery classifies NEW, UPDATED, and UNCHANGED by stable detail locator", () => {
  const previous = set("snapshot-before", "page-before", [
    record({ id: "before-unchanged", snapshot_id: "snapshot-before", title: "公告甲", detail_url: "https://example.invalid/detail/a" }),
    record({ id: "before-updated", snapshot_id: "snapshot-before", title: "公告乙", detail_url: "https://example.invalid/detail/b", requirement: "本科" })
  ]);
  const current = set("snapshot-after", "page-after", [
    record({ id: "after-unchanged", snapshot_id: "snapshot-after", title: "公告甲", detail_url: "https://example.invalid/detail/a" }),
    record({ id: "after-updated", snapshot_id: "snapshot-after", title: "公告乙", detail_url: "https://example.invalid/detail/b", requirement: "硕士" }),
    record({ id: "after-new", snapshot_id: "snapshot-after", title: "公告丙", detail_url: "https://example.invalid/detail/c" })
  ]);
  const result = discoverIncrementalChanges({ previous, current });
  assert.equal(result.page_diff.status, "CHANGED");
  assert.deepEqual(result.record_diffs.map((diff) => diff.status), ["UNCHANGED", "UPDATED", "NEW"]);
});

test("publication-date and page-only changes do not turn an unchanged recruitment record into UPDATED", () => {
  const previous = set("snapshot-before", "page-before", [
    record({ id: "before", snapshot_id: "snapshot-before", title: "公告甲", detail_url: "https://example.invalid/detail/a", published: "2026-01-01" })
  ]);
  const current = set("snapshot-after", "page-after", [
    record({ id: "after", snapshot_id: "snapshot-after", title: "公告甲", detail_url: "https://example.invalid/detail/a", published: "2026-01-02" })
  ]);
  const result = discoverIncrementalChanges({ previous, current });
  assert.equal(result.page_diff.status, "CHANGED");
  assert.equal(result.record_diffs[0]?.status, "UNCHANGED");
});

test("a successful current list reports MISSING_OBSERVED without inferring CLOSED or EXPIRED", () => {
  const previous = set("snapshot-before", "page-before", [
    record({ id: "before", snapshot_id: "snapshot-before", title: "公告甲", detail_url: "https://example.invalid/detail/a" })
  ]);
  const current = set("snapshot-after", "page-after", []);
  const result = discoverIncrementalChanges({ previous, current });
  assert.equal(result.missing_observation_complete, true);
  assert.deepEqual(result.record_diffs.map((diff) => diff.status), ["MISSING_OBSERVED"]);
  assert.equal(result.record_diffs[0]?.reason_code, "ABSENT_FROM_SUCCESSFUL_CURRENT_SNAPSHOT");
  assert.doesNotMatch(JSON.stringify(result), /CLOSED|EXPIRED/u);
});

test("missing stable identity remains uncertain and prevents forced merging or missing inference", () => {
  const previous = set("snapshot-before", "page-before", [
    record({ id: "before", snapshot_id: "snapshot-before", title: "公告甲", detail_url: "https://example.invalid/detail/a" })
  ]);
  const current = set("snapshot-after", "page-after", [
    record({ id: "after", snapshot_id: "snapshot-after", title: "公告甲" })
  ]);
  const result = discoverIncrementalChanges({ previous, current });
  assert.equal(result.missing_observation_complete, false);
  assert.deepEqual(result.record_diffs.map((diff) => diff.status), ["IDENTITY_UNCERTAIN"]);
  assert.equal(result.record_diffs[0]?.reason_code, "NO_STABLE_SOURCE_IDENTITY");
});

test("stable source record IDs remain an identity fallback when detail locators are absent", () => {
  const previous = set("snapshot-before", "page-before", [
    record({ id: "before", snapshot_id: "snapshot-before", title: "标题一", source_record_id: "official-record-42" })
  ]);
  const current = set("snapshot-after", "page-after", [
    record({ id: "after", snapshot_id: "snapshot-after", title: "标题二", source_record_id: "official-record-42" })
  ]);
  const result = discoverIncrementalChanges({ previous, current });
  assert.equal(result.record_diffs[0]?.status, "UPDATED");
});

test("a failed current Snapshot never turns prior records into MISSING_OBSERVED", () => {
  const previous = set("snapshot-before", "page-before", [
    record({ id: "before", snapshot_id: "snapshot-before", title: "公告甲", detail_url: "https://example.invalid/detail/a" })
  ]);
  const failedCurrent: SnapshotRecordSet = {
    snapshot: {
      ...successfulSnapshot("snapshot-failed", "unused", endpointId),
      transport_status: "FAILED",
      raw_blob_id: null,
      content_hash: null,
      content_length: null,
      response_metadata: {
        http_status: null,
        headers: {},
        mime_type: null,
        content_length: null,
        transport_error: { code: "TIMEOUT", message: "synthetic", retryable: false }
      }
    },
    records: []
  };
  const result = discoverIncrementalChanges({ previous, current: failedCurrent });
  assert.equal(result.page_diff.status, "CURRENT_UNAVAILABLE");
  assert.equal(result.missing_observation_complete, false);
  assert.deepEqual(result.record_diffs, []);
});

test("P2-05 incremental discovery tests retain the shared external Network Guard", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
