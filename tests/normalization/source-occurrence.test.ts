import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FixtureAdapter,
  FixtureTransport,
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  InMemorySourceOccurrenceTracker,
  RawCaptureService,
  UTF8_TEXT_ENCODING,
  buildIdentityBasis,
  normalizeExtractedRecord,
  normalizeLocationName,
  normalizeUrl,
  semanticHashFor,
  type ExtractedRecord,
  type ExtractedRecordId,
  type IsoDateTime,
  type OriginalText,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type SnapshotId,
  type SourceDefinitionId,
  type TransportRequest
} from "../../lib/ingestion";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const htmlFixturePath = path.join(repositoryRoot, "fixtures", "adapters", "official-html.html");
const htmlLocator = "fixture://normalization/official-html.html";
const sourceDefinitionId = branded<SourceDefinitionId>("source-normalization-fixture");
const endpointId = branded<RecruitmentEndpointId>("endpoint-normalization-fixture");
const observedAt = branded<IsoDateTime>("2026-09-01T11:00:01+08:00");
const requestedAt = branded<IsoDateTime>("2026-09-01T11:00:00+08:00");

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

const endpoint: RecruitmentEndpoint = {
  recruitment_endpoint_id: endpointId,
  source_definition_id: sourceDefinitionId,
  name: traceable("来源内身份 Fixture Endpoint"),
  description: traceable("仅用于 P1-06 离线测试"),
  coverage_regions: [{ raw_text: original("全国") }],
  locator: htmlLocator,
  content_kind: "HTML",
  adapter_key: "fixture",
  decoded_text_encoding: "UTF-8",
  collection_config: { max_items: 100, max_pages: 1 },
  enabled: true
};

async function basePipeline(
  captureObservedAt = observedAt,
  snapshotPrefix = "normalization-snapshot"
) {
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  let snapshotSequence = 0;
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () => branded<SnapshotId>(`${snapshotPrefix}-${++snapshotSequence}`)
  });
  const transport = new FixtureTransport([{
    locator: htmlLocator,
    bytes: new Uint8Array(readFileSync(htmlFixturePath)),
    mime_type: "text/html; charset=utf-8"
  }], { now: () => captureObservedAt });
  const request: TransportRequest = {
    recruitment_endpoint_id: endpointId,
    locator: htmlLocator,
    method: null,
    requested_at: requestedAt,
    headers: {},
    parameters: {}
  };
  const captured = capture.record(request, await transport.execute(request));
  const adapter = new FixtureAdapter();
  const records = adapter.extract({
    endpoint,
    snapshot: captured.snapshot,
    raw_blob: captured.raw_blob
  });
  return {
    rawBlobs,
    snapshots,
    snapshot: captured.snapshot,
    rawBlob: captured.raw_blob,
    record: records[0]
  };
}

let variantSequence = 0;

function variant(
  base: ExtractedRecord,
  overrides: Partial<ExtractedRecord> = {}
): ExtractedRecord {
  variantSequence += 1;
  return {
    ...base,
    extracted_record_id: branded<ExtractedRecordId>(`normalized-record-${variantSequence}`),
    snapshot_id: branded<SnapshotId>(`normalized-snapshot-${variantSequence}`),
    ...overrides,
    extraction: overrides.extraction ?? {
      ...base.extraction,
      extracted_at: branded<IsoDateTime>(`2026-09-${String(
        Math.min(variantSequence + 1, 28)
      ).padStart(2, "0")}T11:00:00+08:00`)
    }
  };
}

function withoutSourceIdentity(base: ExtractedRecord, overrides: Partial<ExtractedRecord> = {}) {
  return variant(base, {
    raw_source_record_id: undefined,
    identity_candidates: base.identity_candidates.filter(
      (candidate) => candidate.kind !== "SOURCE_RECORD_ID"
    ),
    ...overrides
  });
}

test("Normalization conservatively unifies 北京市, 北京, and 北京 市", async () => {
  const { record } = await basePipeline();
  const normalized = normalizeExtractedRecord(variant(record, {
    raw_location_text: [original("北京市"), original("北京"), original("北京 市")]
  }));
  assert.deepEqual(normalized.content.locations.map((location) => location.city), [
    "北京",
    "北京",
    "北京"
  ]);
  assert.equal(normalizeLocationName("北京 市"), "北京");
  assert.equal(normalized.content.title.original.text, record.raw_title?.text);
  assert.equal(normalized.content.title.normalized?.text, "法律事务岗(2027届)");
});

test("Source identity follows source ID, detail URL, then composite fields", async () => {
  const { record } = await basePipeline();
  const sourceIdBasis = buildIdentityBasis(normalizeExtractedRecord(record));
  assert.equal(sourceIdBasis.kind, "SOURCE_RECORD_ID");

  const detailRecord = withoutSourceIdentity(record);
  const detailBasis = buildIdentityBasis(normalizeExtractedRecord(detailRecord));
  assert.equal(detailBasis.kind, "DETAIL_URL");

  const compositeRecord = withoutSourceIdentity(record, { announcement_url: undefined });
  const compositeBasis = buildIdentityBasis(normalizeExtractedRecord(compositeRecord));
  assert.equal(compositeBasis.kind, "COMPOSITE_FIELDS");
});

test("duplicate collection creates one SourceOccurrence and one Version", async () => {
  const { record } = await basePipeline();
  const tracker = new InMemorySourceOccurrenceTracker();
  const first = tracker.process(endpoint, record);
  const second = tracker.process(endpoint, record);
  assert.equal(first.occurrence_created, true);
  assert.equal(first.version_created, true);
  assert.equal(second.occurrence_created, false);
  assert.equal(second.version_created, false);
  assert.equal(tracker.listOccurrences().length, 1);
  assert.equal(tracker.listVersions(first.occurrence.source_occurrence_id).length, 1);
});

test("capture and extraction time changes do not create identity or content versions", async () => {
  const firstPipeline = await basePipeline();
  const laterObservedAt = branded<IsoDateTime>("2026-09-20T12:30:00+08:00");
  const laterPipeline = await basePipeline(laterObservedAt, "later-normalization-snapshot");
  assert.notEqual(firstPipeline.snapshot.snapshot_id, laterPipeline.snapshot.snapshot_id);
  assert.notEqual(firstPipeline.snapshot.observed_at, laterPipeline.snapshot.observed_at);
  const tracker = new InMemorySourceOccurrenceTracker();
  const first = tracker.process(endpoint, firstPipeline.record);
  const second = tracker.process(endpoint, laterPipeline.record);
  assert.equal(first.occurrence.identity_hash, second.occurrence.identity_hash);
  assert.equal(first.version.semantic_hash, second.version.semantic_hash);
  assert.equal(tracker.listVersions(first.occurrence.source_occurrence_id).length, 1);
});

test("description changes create a second Version under the same Occurrence", async () => {
  const { record } = await basePipeline();
  const changed = variant(record, {
    raw_description: original("负责合同审查、法律咨询、诉讼管理及新增的数据合规工作。")
  });
  const tracker = new InMemorySourceOccurrenceTracker();
  const first = tracker.process(endpoint, record);
  const second = tracker.process(endpoint, changed);
  assert.equal(first.occurrence.identity_hash, second.occurrence.identity_hash);
  assert.notEqual(first.version.semantic_hash, second.version.semantic_hash);
  assert.deepEqual(
    tracker.listVersions(first.occurrence.source_occurrence_id).map((version) => version.revision),
    [1, 2]
  );
});

test("requirement changes create a second Version under the same Occurrence", async () => {
  const { record } = await basePipeline();
  const changed = variant(record, {
    raw_requirement_text: original("法律硕士（非法学）专业；必须通过法律职业资格考试。")
  });
  const tracker = new InMemorySourceOccurrenceTracker();
  const first = tracker.process(endpoint, record);
  const second = tracker.process(endpoint, changed);
  assert.equal(first.occurrence.identity_hash, second.occurrence.identity_hash);
  assert.notEqual(first.version.semantic_hash, second.version.semantic_hash);
  assert.equal(tracker.listVersions(first.occurrence.source_occurrence_id).length, 2);
});

test("2027 spring and autumn batches produce different source identities", async () => {
  const { record } = await basePipeline();
  const spring = variant(record, {
    raw_source_record_id: "12345",
    recruitment_year: original("2027届"),
    recruitment_batch: original("2027春招")
  });
  const autumn = variant(record, {
    raw_source_record_id: "12345",
    recruitment_year: original("2027届"),
    recruitment_batch: original("2027秋招")
  });
  const tracker = new InMemorySourceOccurrenceTracker();
  const springResult = tracker.process(endpoint, spring);
  const autumnResult = tracker.process(endpoint, autumn);
  assert.notEqual(springResult.occurrence.identity_hash, autumnResult.occurrence.identity_hash);
  assert.equal(tracker.listOccurrences().length, 2);
});

test("reused source record ID alone cannot merge different recruitment cycles", async () => {
  const { record } = await basePipeline();
  const firstCycle = variant(record, {
    raw_source_record_id: "12345",
    recruitment_year: original("2027届"),
    recruitment_batch: original("第一批")
  });
  const secondCycle = variant(record, {
    raw_source_record_id: "12345",
    recruitment_year: original("2028届"),
    recruitment_batch: original("第一批")
  });
  const tracker = new InMemorySourceOccurrenceTracker();
  const first = tracker.process(endpoint, firstCycle);
  const second = tracker.process(endpoint, secondCycle);
  assert.notEqual(first.occurrence.identity_hash, second.occurrence.identity_hash);
  assert.equal(first.occurrence.identity_basis.kind, "SOURCE_RECORD_ID");
  assert.equal(second.occurrence.identity_basis.kind, "SOURCE_RECORD_ID");
});

test("records without source IDs fall back to normalized composite identity", async () => {
  const { record } = await basePipeline();
  const composite = withoutSourceIdentity(record, { announcement_url: undefined });
  const tracker = new InMemorySourceOccurrenceTracker();
  const result = tracker.process(endpoint, composite);
  assert.equal(result.occurrence.identity_basis.kind, "COMPOSITE_FIELDS");
  if (result.occurrence.identity_basis.kind !== "COMPOSITE_FIELDS") return;
  assert.equal(result.occurrence.identity_basis.normalized_organization, "中国科学院某研究所");
  assert.equal(result.occurrence.identity_basis.normalized_title, "法律事务岗(2027届)");
  assert.deepEqual(result.occurrence.identity_basis.normalized_locations, ["北京", "武汉市"]);
});

test("normalized detail URLs provide stable second-priority identity", async () => {
  const { record } = await basePipeline();
  const first = withoutSourceIdentity(record, {
    announcement_url: "fixture://announcement/legal/?b=2&a=1#position"
  });
  const second = withoutSourceIdentity(record, {
    announcement_url: "fixture://announcement/legal?a=1&b=2"
  });
  assert.equal(normalizeUrl(first.announcement_url!), normalizeUrl(second.announcement_url!));
  const tracker = new InMemorySourceOccurrenceTracker();
  const firstResult = tracker.process(endpoint, first);
  const secondResult = tracker.process(endpoint, second);
  assert.equal(firstResult.occurrence.identity_hash, secondResult.occurrence.identity_hash);
});

test("multi-location arrays remain structured and affect composite identity", async () => {
  const { record } = await basePipeline();
  const oneLocation = withoutSourceIdentity(record, {
    announcement_url: undefined,
    raw_location_text: [original("北京")]
  });
  const twoLocations = withoutSourceIdentity(record, {
    announcement_url: undefined,
    raw_location_text: [original("北京"), original("上海")]
  });
  const tracker = new InMemorySourceOccurrenceTracker();
  const one = tracker.process(endpoint, oneLocation);
  const two = tracker.process(endpoint, twoLocations);
  assert.notEqual(one.occurrence.identity_hash, two.occurrence.identity_hash);
  if (two.occurrence.identity_basis.kind !== "COMPOSITE_FIELDS") return;
  assert.deepEqual(two.occurrence.identity_basis.normalized_locations, ["上海", "北京"].sort());
});

test("adapter metadata changes affect neither identity nor semantic hash", async () => {
  const { record } = await basePipeline();
  const changedMetadata = variant(record, {
    adapter_metadata: {
      fixture: { debug_value: "completely-different", record_index: 999 }
    }
  });
  const firstNormalized = normalizeExtractedRecord(record);
  const secondNormalized = normalizeExtractedRecord(changedMetadata);
  assert.deepEqual(buildIdentityBasis(firstNormalized), buildIdentityBasis(secondNormalized));
  assert.equal(
    semanticHashFor(firstNormalized.content),
    semanticHashFor(secondNormalized.content)
  );
  const tracker = new InMemorySourceOccurrenceTracker();
  const first = tracker.process(endpoint, record);
  const second = tracker.process(endpoint, changedMetadata);
  assert.equal(first.occurrence.identity_hash, second.occurrence.identity_hash);
  assert.equal(first.version.semantic_hash, second.version.semantic_hash);
  assert.equal(second.version_created, false);
});

test("SourceOccurrenceVersion traces to ExtractedRecord, Snapshot, and immutable RawBlob", async () => {
  const pipeline = await basePipeline();
  const tracker = new InMemorySourceOccurrenceTracker();
  const result = tracker.process(endpoint, pipeline.record);
  assert.equal(result.version.extracted_record_id, pipeline.record.extracted_record_id);
  assert.equal(pipeline.record.snapshot_id, pipeline.snapshot.snapshot_id);
  assert.equal(pipeline.snapshot.transport_status, "SUCCESS");
  assert.ok(pipeline.rawBlob);
  assert.equal(pipeline.snapshot.raw_blob_id, pipeline.rawBlob.raw_blob_id);
  const storedRaw = pipeline.rawBlobs.get(pipeline.rawBlob.raw_blob_id);
  assert.ok(storedRaw);
  assert.deepEqual(storedRaw.bytes, pipeline.rawBlob.bytes);
});

test("P1-06 normalization and identity tests remain offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
