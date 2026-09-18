import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXTRACTED_RECORD_V2_CONTRACT_VERSION,
  SOURCE_OCCURRENCE_VERSION_V2_CONTRACT_VERSION,
  InMemorySourceOccurrenceTracker,
  SourceOccurrenceMaterializationError,
  createExtractedRecordV2,
  extractedRecordSemanticHashFor,
  materializeSourceOccurrenceVersion,
  prepareSourceOccurrenceMaterialization,
  sourceOccurrenceVersionSemanticHashFor,
  validateExtractedRecordV2,
  validateSourceOccurrenceVersionBinding,
  UTF8_TEXT_ENCODING,
  type ExtractedRecord,
  type ExtractedRecordV2,
  type IsoDateTime,
  type OriginalText,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type Snapshot,
  type SnapshotId,
  type SourceDefinitionId,
  type SourceOccurrence,
  type SourceOccurrenceVersion
} from "../../lib/ingestion";

const sourceDefinitionId = branded<SourceDefinitionId>("source-phase-b-synthetic");
const endpointId = branded<RecruitmentEndpointId>("endpoint-phase-b-synthetic");
const rawHash = branded<RawContentSha256>(sha256("phase-b-raw"));
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const endpoint: RecruitmentEndpoint = {
  recruitment_endpoint_id: endpointId,
  source_definition_id: sourceDefinitionId,
  name: traceable("Phase B synthetic endpoint"),
  description: traceable("Offline SourceOccurrenceVersion materialization only"),
  coverage_regions: [{ raw_text: original("贵州省") }],
  locator: "fixture://phase-b/source.xlsx",
  request_method: "GET",
  content_kind: "FILE",
  adapter_key: "phase-b-synthetic",
  decoded_text_encoding: UTF8_TEXT_ENCODING,
  collection_config: {
    timeout_ms: 1_000,
    max_items: 1,
    max_pages: 1,
    follow_redirects: false,
    retry_limit: 0
  },
  enabled: false
};

function snapshot(
  snapshotId = "snapshot-phase-b-1",
  observedAt = "2026-09-08T09:00:00+08:00"
): Snapshot {
  return {
    snapshot_id: branded<SnapshotId>(snapshotId),
    recruitment_endpoint_id: endpointId,
    request_metadata: {
      locator: endpoint.locator,
      method: "GET",
      requested_at: branded<IsoDateTime>(observedAt),
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: 200,
      headers: {},
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content_length: 128,
      transport_error: null
    },
    observed_at: branded<IsoDateTime>(observedAt),
    transport_status: "SUCCESS",
    raw_blob_id: branded<RawBlobId>(`sha256:${rawHash}`),
    content_hash: rawHash,
    content_length: 128
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    source_definition_id: sourceDefinitionId,
    identity_candidates: [
      { kind: "SOURCE_RECORD_ID" as const, value: "Sheet1!row:4", confidence: "HIGH" as const },
      { kind: "RAW_FIELD_COMBINATION" as const, value: "22828700101", confidence: "HIGH" as const }
    ],
    raw_source_record_id: "Sheet1!row:4",
    raw_title: original("助理研究员1"),
    raw_organization_name: original("贵州省法治研究服务保障中心"),
    raw_location_text: [original("贵州省")],
    announcement_url: "https://example.invalid/notice",
    recruitment_year: original("2025"),
    recruitment_context: {
      announcement: {
        identity_state: "UNRESOLVED" as const,
        raw_text: original("贵州省事业单位公开招聘公告"),
        evidence_locator: {
          kind: "SOURCE_RECORD" as const,
          locator: "notice-reference"
        }
      },
      recruitment_batch: { applicability: "UNRESOLVED" as const },
      position: {
        identity_state: "PROVISIONAL" as const,
        source_local_identifier: original("22828700101"),
        evidence_locator: {
          kind: "SPREADSHEET" as const,
          sheet: "Sheet1",
          cell_or_range: "E4",
          field_path: "job_code"
        }
      },
      opportunity: {
        identity_state: "PROVISIONAL" as const,
        source_local_identifier: original("Sheet1!A4:O4"),
        evidence_locator: {
          kind: "SPREADSHEET" as const,
          sheet: "Sheet1",
          cell_or_range: "A4:O4"
        }
      }
    },
    source_record_locator: {
      kind: "DOCUMENT" as const,
      section: "Sheet1",
      text_locator: "A4:O4"
    },
    adapter_metadata: {
      "phase-b-synthetic": { transient_sequence: 1 }
    },
    extraction: {
      extractor_name: "PhaseBSyntheticExtractor",
      extractor_version: "1.0.0",
      schema_version: "phase-b-extracted-record/2.0.0"
    },
    ...overrides
  };
}

function v2(
  sourceSnapshot = snapshot(),
  overrides: Record<string, unknown> = {}
): ExtractedRecordV2 {
  return createExtractedRecordV2(sourceSnapshot, draft(overrides));
}

function firstMaterialization(record = v2(), sourceSnapshot = snapshot()) {
  const prepared = prepareSourceOccurrenceMaterialization(endpoint, record, sourceSnapshot);
  return materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: null,
    existing_versions: []
  });
}

test("ExtractedRecord V2 identity and semantic hash are deterministic", () => {
  const first = v2();
  const second = v2();
  assert.equal(first.contract_version, EXTRACTED_RECORD_V2_CONTRACT_VERSION);
  assert.equal(first.extracted_record_id, second.extracted_record_id);
  assert.equal(first.semantic_hash, second.semantic_hash);
  assert.equal(first.semantic_hash, extractedRecordSemanticHashFor(first));
  assert.equal(validateExtractedRecordV2(first, snapshot()), first);
});

test("identical extraction with reordered identity candidates retains identity", () => {
  const first = v2();
  const second = v2(snapshot(), {
    identity_candidates: [...draft().identity_candidates].reverse()
  });
  assert.equal(first.extracted_record_id, second.extracted_record_id);
  assert.equal(first.semantic_hash, second.semantic_hash);
});

test("substantive ExtractedRecord content change changes identity", () => {
  const first = v2();
  const changed = v2(snapshot(), { raw_title: original("助理研究员2") });
  assert.notEqual(first.semantic_hash, changed.semantic_hash);
  assert.notEqual(first.extracted_record_id, changed.extracted_record_id);
});

test("SOV semantic hash and V2 materialization are deterministic", () => {
  const first = firstMaterialization();
  const second = firstMaterialization();
  assert.equal(first.version.semantic_hash, second.version.semantic_hash);
  assert.equal(first.version.source_occurrence_version_id, second.version.source_occurrence_version_id);
  assert.equal(
    first.version.materialization.contract_version,
    SOURCE_OCCURRENCE_VERSION_V2_CONTRACT_VERSION
  );
  assert.equal(first.version.semantic_hash, sourceOccurrenceVersionSemanticHashFor(first.version));
});

test("SOV revision is idempotent for an already materialized semantic hash", () => {
  const first = firstMaterialization();
  const prepared = prepareSourceOccurrenceMaterialization(endpoint, v2(), snapshot());
  const second = materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: first.occurrence,
    existing_versions: [first.version]
  });
  assert.equal(second.version_created, false);
  assert.equal(second.version.source_occurrence_version_id, first.version.source_occurrence_version_id);
  assert.equal(second.version.revision, 1);
});

test("tampered existing SOV is rejected before idempotent reuse", () => {
  const record = v2();
  const first = firstMaterialization(record);
  const tampered = {
    ...first.version,
    content: {
      ...first.version.content,
      title: traceable("tampered title")
    }
  };
  const prepared = prepareSourceOccurrenceMaterialization(endpoint, record, snapshot());
  assert.throws(() => materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: first.occurrence,
    existing_versions: [tampered]
  }), /existing SOV.*integrity/u);
});

test("ExtractedRecord to SOV binding validates the complete provenance chain", () => {
  const record = v2();
  const result = firstMaterialization(record);
  assert.equal(validateSourceOccurrenceVersionBinding({
    endpoint,
    occurrence: result.occurrence,
    version: result.version,
    extracted_record: record,
    snapshot: snapshot()
  }), result.version);
});

test("missing ExtractedRecord rejects SOV binding", () => {
  const result = firstMaterialization();
  assert.throws(() => validateSourceOccurrenceVersionBinding({
    endpoint,
    occurrence: result.occurrence,
    version: result.version,
    extracted_record: null,
    snapshot: snapshot()
  }), /ExtractedRecord.*required/u);
});

test("tampered ExtractedRecord hash rejects SOV binding", () => {
  const record = v2();
  const result = firstMaterialization(record);
  const tampered = {
    ...record,
    semantic_hash: branded<typeof record.semantic_hash>("0".repeat(64))
  };
  assert.throws(() => validateSourceOccurrenceVersionBinding({
    endpoint,
    occurrence: result.occurrence,
    version: result.version,
    extracted_record: tampered,
    snapshot: snapshot()
  }), /semantic hash/u);
});

test("tampered SOV semantic hash rejects binding", () => {
  const record = v2();
  const result = firstMaterialization(record);
  const tampered = {
    ...result.version,
    semantic_hash: branded<typeof result.version.semantic_hash>("f".repeat(64))
  };
  assert.throws(() => validateSourceOccurrenceVersionBinding({
    endpoint,
    occurrence: result.occurrence,
    version: tampered,
    extracted_record: record,
    snapshot: snapshot()
  }), /SOV semantic hash/u);
});

test("SOV RecruitmentContext mismatch rejects binding", () => {
  const record = v2();
  const result = firstMaterialization(record);
  const context = result.version.content.recruitment_context!;
  const tampered = {
    ...result.version,
    content: {
      ...result.version.content,
      recruitment_context: {
        ...context,
        position: { ...context.position, identity_key: "POSITION:wrong" }
      }
    }
  } as unknown as typeof result.version;
  assert.throws(() => validateSourceOccurrenceVersionBinding({
    endpoint,
    occurrence: result.occurrence,
    version: tampered,
    extracted_record: record,
    snapshot: snapshot()
  }), /content.*ExtractedRecord/u);
});

test("context Evidence provenance mismatch rejects binding", () => {
  const record = v2();
  const result = firstMaterialization(record);
  const [first, ...rest] = result.version.identity_evidence;
  assert.ok(first);
  const tampered = {
    ...result.version,
    identity_evidence: [{ ...first, snapshot_id: branded<SnapshotId>("wrong-snapshot") }, ...rest]
  };
  assert.throws(() => validateSourceOccurrenceVersionBinding({
    endpoint,
    occurrence: result.occurrence,
    version: tampered,
    extracted_record: record,
    snapshot: snapshot()
  }), /Identity Evidence.*provenance/u);
});

test("missing context Evidence rejects SOV binding", () => {
  const record = v2();
  const result = firstMaterialization(record);
  const missing = { ...result.version, identity_evidence: [] };
  assert.throws(() => validateSourceOccurrenceVersionBinding({
    endpoint,
    occurrence: result.occurrence,
    version: missing,
    extracted_record: record,
    snapshot: snapshot()
  }), /Identity Evidence/u);
});

test("legacy ExtractedRecord remains immutable when V2 is created", () => {
  const legacy: ExtractedRecord = {
    ...draft(),
    extracted_record_id: branded("legacy-extracted-record"),
    snapshot_id: snapshot().snapshot_id,
    extraction: {
      extractor_name: "LegacyExtractor",
      extractor_version: "1.0.0",
      extracted_at: snapshot().observed_at
    }
  } as ExtractedRecord;
  const before = structuredClone(legacy);
  createExtractedRecordV2(snapshot(), draft());
  assert.deepEqual(legacy, before);
  assert.equal("contract_version" in legacy, false);
  assert.equal("semantic_hash" in legacy, false);
});

test("retrieval timestamp and Snapshot identity do not create a SOV revision", () => {
  const firstRecord = v2();
  const first = firstMaterialization(firstRecord);
  const laterSnapshot = snapshot("snapshot-phase-b-2", "2026-09-09T10:30:00+08:00");
  const laterRecord = v2(laterSnapshot);
  const prepared = prepareSourceOccurrenceMaterialization(endpoint, laterRecord, laterSnapshot);
  const second = materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: first.occurrence,
    existing_versions: [first.version]
  });
  assert.notEqual(firstRecord.extracted_record_id, laterRecord.extracted_record_id);
  assert.equal(second.version_created, false);
  assert.equal(second.version.source_occurrence_version_id, first.version.source_occurrence_version_id);
});

test("Identity Evidence ordering does not change SOV semantic hash", () => {
  const { version } = firstMaterialization();
  const reordered = {
    ...version,
    identity_evidence: [...version.identity_evidence].reverse()
  };
  assert.equal(
    sourceOccurrenceVersionSemanticHashFor(reordered),
    sourceOccurrenceVersionSemanticHashFor(version)
  );
});

test("duplicate Identity Evidence does not change SOV semantic hash", () => {
  const { version } = firstMaterialization();
  const duplicated = {
    ...version,
    identity_evidence: [...version.identity_evidence, ...version.identity_evidence]
  };
  assert.equal(
    sourceOccurrenceVersionSemanticHashFor(duplicated),
    sourceOccurrenceVersionSemanticHashFor(version)
  );
});

test("extractor/schema contract change creates a new semantic revision", () => {
  const firstRecord = v2();
  const first = firstMaterialization(firstRecord);
  const changedRecord = v2(snapshot(), {
    extraction: {
      extractor_name: "PhaseBSyntheticExtractor",
      extractor_version: "1.0.0",
      schema_version: "phase-b-extracted-record/2.1.0"
    }
  });
  const prepared = prepareSourceOccurrenceMaterialization(endpoint, changedRecord, snapshot());
  const changed = materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: first.occurrence,
    existing_versions: [first.version]
  });
  assert.equal(changed.version_created, true);
  assert.equal(changed.version.revision, 2);
  assert.notEqual(changed.version.semantic_hash, first.version.semantic_hash);
});

test("InMemory tracker consumes the shared materializer without changing legacy behavior", () => {
  const record = v2();
  const direct = firstMaterialization(record);
  const tracked = new InMemorySourceOccurrenceTracker().process(endpoint, record, snapshot());
  assert.deepEqual(tracked.occurrence, direct.occurrence);
  assert.deepEqual(tracked.version, direct.version);
});

test("production repository delegates SOV construction to the shared materializer", () => {
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/production-ingestion/repository.ts"
  ), "utf8");
  assert.match(source, /prepareSourceOccurrenceMaterialization/u);
  assert.match(source, /materializeSourceOccurrenceVersion/u);
  assert.doesNotMatch(source, /semanticHashFor\(/u);
  assert.doesNotMatch(source, /`source-occurrence-version:/u);
});

test("legacy RequirementSetCompositionResult cannot materialize a SOV", () => {
  const legacyComposition = {
    composition_result_id: "legacy-composition",
    opportunity_version_id: "legacy-opportunity-version",
    requirement_facts: []
  };
  assert.throws(() => prepareSourceOccurrenceMaterialization(
    endpoint,
    legacyComposition as never,
    snapshot()
  ), SourceOccurrenceMaterializationError);
});

test("legacy OpportunityVersion cannot materialize a SOV", () => {
  const legacyOpportunityVersion = {
    opportunity_version_id: "legacy-opportunity-version",
    canonical_opportunity_id: "legacy-opportunity",
    revision: 1,
    semantic_hash: "legacy-hash",
    content: {},
    source_occurrence_version_ids: ["legacy-source-version"],
    effective_from: "2025-01-01T00:00:00+08:00"
  };
  assert.throws(() => prepareSourceOccurrenceMaterialization(
    endpoint,
    legacyOpportunityVersion as never,
    snapshot()
  ), SourceOccurrenceMaterializationError);
});

test("existing versions from another SourceOccurrence are rejected", () => {
  const first = firstMaterialization();
  const foreignOccurrence = {
    ...first.occurrence,
    source_occurrence_id: branded("source-occurrence:foreign")
  } as SourceOccurrence;
  const foreignVersion = {
    ...first.version,
    source_occurrence_id: foreignOccurrence.source_occurrence_id
  } as SourceOccurrenceVersion;
  const prepared = prepareSourceOccurrenceMaterialization(endpoint, v2(), snapshot());
  assert.throws(() => materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: first.occurrence,
    existing_versions: [foreignVersion]
  }), /existing SourceOccurrenceVersion.*same SourceOccurrence/u);
});

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

function branded<Value extends string>(value: string) {
  return value as Value;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
