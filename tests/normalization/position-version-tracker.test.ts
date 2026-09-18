import "../helpers/network-guard";
import { readHistoricalEvidenceBytes, readHistoricalEvidenceJson } from "../helpers/historical-evidence";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  InMemoryPositionVersionTracker,
  PositionContractValidationError,
  PositionVersionTrackingError,
  SourceOccurrenceMaterializationError,
  createExtractedRecordV2,
  materializeSourceOccurrenceVersion,
  positionVersionIdFor,
  positionVersionSemanticHashFor,
  prepareSourceOccurrenceMaterialization,
  resolvePositionIdentity,
  validatePositionVersion,
  type AdapterExtractionInput,
  type IdentityReconciliation,
  type IdentityReconciliationId,
  type IsoDateTime,
  type Position,
  type PositionIdentityResolutionInput,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type SemanticHash,
  type Snapshot,
  type SnapshotId,
  type SourceDefinitionId
} from "../../lib/ingestion";
import { GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID } from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";
import { GUIZHOU_ATTACHMENT_EXPECTED_MIME } from "../../lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary";
import {
  GuizhouLegalXlsxRequirementObservationAdapter,
  P2_LEGAL_05_TARGET_JOB_CODE,
  createGuizhouLegalRequirementEndpoint
} from "../../lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter";

const baseObservedAt = "2026-09-08T12:00:00+08:00";

type PositionClaim =
  | { readonly state: "CONFIRMED"; readonly value: string; readonly namespace: string }
  | { readonly state: "PROVISIONAL"; readonly value: string }
  | { readonly state: "UNRESOLVED"; readonly value?: string };

interface SourceOptions {
  readonly source?: string;
  readonly endpoint?: string;
  readonly snapshot?: string;
  readonly observedAt?: string;
  readonly rawSeed?: string;
  readonly recordKey?: string;
  readonly title?: string;
  readonly organization?: string;
  readonly locations?: readonly string[];
  readonly position?: PositionClaim;
  readonly includeAnnouncementEvidence?: boolean;
}

function source(options: SourceOptions = {}): PositionIdentityResolutionInput {
  const sourceDefinitionId = branded<SourceDefinitionId>(
    options.source ?? "source-phase-d-official"
  );
  const endpointId = branded<RecruitmentEndpointId>(
    options.endpoint ?? "endpoint-phase-d-official"
  );
  const endpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: endpointId,
    source_definition_id: sourceDefinitionId,
    name: traceable("Phase D synthetic endpoint"),
    coverage_regions: [{ raw_text: original("贵州省") }],
    locator: `fixture://phase-d/${endpointId}`,
    request_method: "GET",
    content_kind: "FILE",
    adapter_key: "phase-d-synthetic",
    decoded_text_encoding: "UTF-8",
    collection_config: {
      timeout_ms: 1_000,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
  const rawHash = branded<RawContentSha256>(sha256(options.rawSeed ?? "phase-d-raw"));
  const sourceSnapshot: Snapshot = {
    snapshot_id: branded<SnapshotId>(options.snapshot ?? "snapshot-phase-d-1"),
    recruitment_endpoint_id: endpointId,
    request_metadata: {
      locator: endpoint.locator,
      method: "GET",
      requested_at: branded<IsoDateTime>(options.observedAt ?? baseObservedAt),
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: 200,
      headers: {},
      mime_type: "application/json",
      content_length: 128,
      transport_error: null
    },
    observed_at: branded<IsoDateTime>(options.observedAt ?? baseObservedAt),
    transport_status: "SUCCESS",
    raw_blob_id: branded<RawBlobId>(`sha256:${rawHash}`),
    content_hash: rawHash,
    content_length: 128
  };
  const recordKey = options.recordKey ?? "Sheet1!row:4";
  const position = options.position ?? {
    state: "CONFIRMED",
    value: "001",
    namespace: "official:plan-2027:position"
  };
  const extractedRecord = createExtractedRecordV2(sourceSnapshot, {
    source_definition_id: sourceDefinitionId,
    identity_candidates: [
      { kind: "SOURCE_RECORD_ID", value: recordKey, confidence: "HIGH" }
    ],
    raw_source_record_id: recordKey,
    raw_title: original(options.title ?? "助理研究员"),
    raw_organization_name: original(options.organization ?? "贵州省法治研究服务保障中心"),
    raw_location_text: (options.locations ?? ["贵州省"]).map(original),
    announcement_url: "https://official.example.test/notice",
    recruitment_year: original("2025"),
    recruitment_context: {
      ...(options.includeAnnouncementEvidence
        ? {
            announcement: {
              identity_state: "CONFIRMED" as const,
              official_identifier: original("NOTICE-2025"),
              identifier_namespace: "official:notice",
              evidence_locator: {
                kind: "SOURCE_RECORD" as const,
                locator: "notice-id"
              }
            }
          }
        : {}),
      recruitment_batch: { applicability: "UNRESOLVED" },
      position: position.state === "CONFIRMED"
        ? {
            identity_state: "CONFIRMED",
            official_identifier: original(position.value),
            identifier_namespace: position.namespace,
            evidence_locator: {
              kind: "SPREADSHEET",
              sheet: "Sheet1",
              cell_or_range: "E4",
              field_path: "position_code"
            }
          }
        : position.state === "PROVISIONAL"
          ? {
              identity_state: "PROVISIONAL",
              source_local_identifier: original(position.value),
              evidence_locator: {
                kind: "SPREADSHEET",
                sheet: "Sheet1",
                cell_or_range: "E4",
                field_path: "position_code"
              }
            }
          : {
              identity_state: "UNRESOLVED",
              ...(position.value ? { raw_text: original(position.value) } : {}),
              evidence_locator: {
                kind: "SPREADSHEET",
                sheet: "Sheet1",
                cell_or_range: "E4",
                field_path: "position_code"
              }
            },
      opportunity: { identity_state: "UNRESOLVED" }
    },
    source_record_locator: {
      kind: "DOCUMENT",
      section: "Sheet1",
      text_locator: "A4:O4"
    },
    adapter_metadata: {
      "phase-d-synthetic": { transient_sequence: 1 }
    },
    extraction: {
      extractor_name: "PhaseDSyntheticExtractor",
      extractor_version: "1.0.0",
      schema_version: "phase-d-extracted-record/2.0.0"
    }
  });
  const prepared = prepareSourceOccurrenceMaterialization(
    endpoint,
    extractedRecord,
    sourceSnapshot
  );
  const materialized = materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: null,
    existing_versions: []
  });
  return {
    endpoint,
    occurrence: materialized.occurrence,
    version: materialized.version,
    extracted_record: extractedRecord,
    snapshot: sourceSnapshot
  };
}

function positionFor(input: PositionIdentityResolutionInput): Position {
  const result = resolvePositionIdentity(input);
  assert.equal(result.status, "RESOLVED");
  assert.ok(result.position);
  return result.position;
}

function process(
  tracker: InMemoryPositionVersionTracker,
  input: PositionIdentityResolutionInput,
  position = positionFor(input)
) {
  return tracker.process({ position, sources: [input] });
}

function equivalentSource(suffix: string, options: SourceOptions = {}) {
  return source({
    endpoint: `endpoint-phase-d-${suffix}`,
    snapshot: `snapshot-phase-d-${suffix}`,
    recordKey: `Sheet-${suffix}!row:4`,
    ...options
  });
}

function reconciliation(
  first: PositionIdentityResolutionInput,
  second: PositionIdentityResolutionInput
): IdentityReconciliation {
  const firstPosition = positionFor(first);
  const secondPosition = positionFor(second);
  const firstEvidence = first.version.content.recruitment_context
    ?.position.identity_evidence_ids[0];
  const secondEvidence = second.version.content.recruitment_context
    ?.position.identity_evidence_ids[0];
  assert.ok(firstEvidence);
  assert.ok(secondEvidence);
  return {
    identity_reconciliation_id: branded<IdentityReconciliationId>(
      "identity-reconciliation-phase-d"
    ),
    reconciliation_kind: "CORRECTION",
    state: "CONFIRMED",
    from: [{ kind: "POSITION", id: firstPosition.position_id }],
    to: [{ kind: "POSITION", id: secondPosition.position_id }],
    evidence_ids: [firstEvidence, secondEvidence],
    resolver_version: "phase-d-explicit-reconciliation/1.0.0",
    created_at: branded<IsoDateTime>(baseObservedAt)
  };
}

test("PositionVersion semantic hash is deterministic", () => {
  const input = source();
  const first = process(new InMemoryPositionVersionTracker(), input).position_version;
  const second = process(new InMemoryPositionVersionTracker(), input).position_version;
  assert.equal(first.semantic_hash, second.semantic_hash);
  assert.equal(first.semantic_hash, positionVersionSemanticHashFor(first));
});

test("PositionVersion ID is deterministic for one Position and revision", () => {
  const input = source();
  const position = positionFor(input);
  const version = process(new InMemoryPositionVersionTracker(), input, position).position_version;
  assert.equal(version.position_version_id, positionVersionIdFor(position.identity_hash, 1));
});

test("PositionVersion revision must be positive", () => {
  const input = source();
  const position = positionFor(input);
  const version = process(new InMemoryPositionVersionTracker(), input, position).position_version;
  assert.throws(() => validatePositionVersion({
    ...version,
    revision: 0
  }, position), PositionContractValidationError);
});

test("PositionVersion identity always matches its Position", () => {
  const input = source();
  const position = positionFor(input);
  const version = process(new InMemoryPositionVersionTracker(), input, position).position_version;
  assert.equal(version.position_id, position.position_id);
  assert.equal(validatePositionVersion(version, position), version);
});

test("Position and PositionVersion mismatch is rejected", () => {
  const first = source();
  const second = source({ position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } });
  const version = process(new InMemoryPositionVersionTracker(), first).position_version;
  assert.throws(
    () => validatePositionVersion(version, positionFor(second)),
    PositionContractValidationError
  );
});

test("tampered Position identity hash is rejected before version materialization", () => {
  const input = source();
  const position = positionFor(input);
  assert.throws(() => process(
    new InMemoryPositionVersionTracker(),
    input,
    {
      ...position,
      identity_hash: branded<typeof position.identity_hash>("0".repeat(64))
    }
  ), PositionContractValidationError);
});

test("every materialized PositionVersion retains a SOV binding", () => {
  const input = source();
  const version = process(new InMemoryPositionVersionTracker(), input).position_version;
  assert.deepEqual(version.source_occurrence_version_ids, [
    input.version.source_occurrence_version_id
  ]);
});

test("missing SOV input is rejected", () => {
  const input = source();
  assert.throws(() => new InMemoryPositionVersionTracker().process({
    position: positionFor(input),
    sources: []
  }), PositionVersionTrackingError);
});

test("invalid SOV input is rejected before PositionVersion materialization", () => {
  const input = source();
  const tampered = {
    ...input,
    version: {
      ...input.version,
      semantic_hash: branded<SemanticHash>("0".repeat(64))
    }
  };
  assert.throws(
    () => process(new InMemoryPositionVersionTracker(), tampered, positionFor(input)),
    SourceOccurrenceMaterializationError
  );
});

test("SOV resolving to another Position is rejected", () => {
  const first = source();
  const second = equivalentSource("identity-mismatch", { position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } });
  assert.throws(() => process(
    new InMemoryPositionVersionTracker(),
    second,
    positionFor(first)
  ), PositionVersionTrackingError);
});

test("tampered PositionVersion semantic hash is rejected", () => {
  const input = source();
  const position = positionFor(input);
  const version = process(new InMemoryPositionVersionTracker(), input, position).position_version;
  assert.throws(() => validatePositionVersion({
    ...version,
    semantic_hash: branded<SemanticHash>("f".repeat(64))
  }, position), PositionContractValidationError);
});

test("same PV identity cannot be reused with different SOV provenance", () => {
  const first = source();
  const second = equivalentSource("same-semantics");
  const position = positionFor(first);
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, first, position);
  assert.throws(
    () => process(tracker, second, position),
    PositionVersionTrackingError
  );
  assert.deepEqual(
    tracker.resolve(initial.position_version.position_version_id)?.position_version,
    initial.position_version
  );
});

test("same PV ID and canonical bytes are idempotent", () => {
  const input = source();
  const tracker = new InMemoryPositionVersionTracker();
  const first = process(tracker, input);
  const second = process(tracker, input);
  assert.equal(first.version_created, true);
  assert.equal(second.version_created, false);
  assert.deepEqual(second.position_version, first.position_version);
});

test("substantive title change creates the next revision", () => {
  const first = source();
  const changed = equivalentSource("title-change", { title: "高级助理研究员" });
  const position = positionFor(first);
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, first, position).position_version;
  const next = process(tracker, changed, position).position_version;
  assert.notEqual(next.semantic_hash, initial.semantic_hash);
  assert.equal(next.revision, 2);
});

test("substantive organization change creates the next revision", () => {
  const first = source();
  const changed = equivalentSource("organization-change", {
    organization: "贵州省另一法治机构"
  });
  const position = positionFor(first);
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, first, position).position_version;
  const next = process(tracker, changed, position).position_version;
  assert.notEqual(next.semantic_hash, initial.semantic_hash);
  assert.equal(next.revision, 2);
});

test("substantive location change creates the next revision", () => {
  const first = source();
  const changed = equivalentSource("location-change", { locations: ["贵阳市"] });
  const position = positionFor(first);
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, first, position).position_version;
  const next = process(tracker, changed, position).position_version;
  assert.notEqual(next.semantic_hash, initial.semantic_hash);
  assert.equal(next.revision, 2);
});

test("same PV identity cannot be reused with a different effective_from", () => {
  const first = source();
  const later = source({
    snapshot: "snapshot-phase-d-later",
    observedAt: "2026-09-09T12:00:00+08:00"
  });
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, first);
  assert.throws(
    () => process(tracker, later, positionFor(first)),
    PositionVersionTrackingError
  );
  assert.deepEqual(
    tracker.resolve(initial.position_version.position_version_id)?.position_version,
    initial.position_version
  );
});

test("changed observation provenance cannot overwrite a sealed PositionVersion", () => {
  const first = source();
  const laterExtraction = source({
    snapshot: "snapshot-phase-d-extraction-later",
    observedAt: "2026-09-10T12:00:00+08:00"
  });
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, first).position_version;
  assert.throws(
    () => process(tracker, laterExtraction, positionFor(first)),
    PositionVersionTrackingError
  );
  assert.deepEqual(
    tracker.resolve(initial.position_version_id)?.position_version,
    initial
  );
});

test("Evidence ordering does not create a new revision", () => {
  const input = source({ includeAnnouncementEvidence: true });
  const reordered = {
    ...input,
    version: {
      ...input.version,
      identity_evidence: [...input.version.identity_evidence].reverse()
    }
  };
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, input).position_version;
  const repeated = process(tracker, reordered, positionFor(input)).position_version;
  assert.equal(repeated.position_version_id, initial.position_version_id);
});

test("SOV provenance ordering does not create a new revision", () => {
  const first = source();
  const second = equivalentSource("provenance-order");
  const position = positionFor(first);
  const tracker = new InMemoryPositionVersionTracker();
  const initial = tracker.process({ position, sources: [first, second] });
  const repeated = tracker.process({ position, sources: [second, first] });
  assert.equal(repeated.version_created, false);
  assert.equal(repeated.position_version.position_version_id, initial.position_version.position_version_id);
  assert.equal(initial.position_version.source_occurrence_version_ids.length, 2);
});

test("duplicate Evidence does not create a new revision", () => {
  const input = source();
  const duplicateEvidence = {
    ...input,
    version: {
      ...input.version,
      identity_evidence: [
        ...input.version.identity_evidence,
        ...input.version.identity_evidence
      ]
    }
  };
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, input).position_version;
  const repeated = process(tracker, duplicateEvidence, positionFor(input)).position_version;
  assert.equal(repeated.position_version_id, initial.position_version_id);
});

test("PositionVersion history is append-only and defensively copied", () => {
  const first = source();
  const changed = equivalentSource("append-only", { title: "新岗位标题" });
  const position = positionFor(first);
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, first, position).position_version;
  process(tracker, changed, position);
  const externallyMutated = initial as unknown as { title: ReturnType<typeof traceable> };
  externallyMutated.title = traceable("篡改标题");
  const stored = tracker.listVersions(position.position_id);
  assert.equal(stored.length, 2);
  assert.equal(stored[0]?.title.original.text, "助理研究员");
  assert.equal(stored[0]?.revision, 1);
});

test("historical PositionVersion cannot be rebound to another Position", () => {
  const first = source();
  const second = equivalentSource("rebind", { position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } });
  const version = process(new InMemoryPositionVersionTracker(), first).position_version;
  assert.throws(
    () => validatePositionVersion(version, positionFor(second)),
    PositionContractValidationError
  );
});

test("official code change without reconciliation remains an identity boundary", () => {
  const oldSource = source();
  const newSource = equivalentSource("new-code", { position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } });
  const oldPosition = positionFor(oldSource);
  assert.notEqual(oldPosition.position_id, positionFor(newSource).position_id);
  assert.throws(
    () => process(new InMemoryPositionVersionTracker(), newSource, oldPosition),
    PositionVersionTrackingError
  );
});

test("explicit code correction keeps one reconciled Position and creates a new PV", () => {
  const oldSource = source({ title: "助理研究员" });
  const newSource = equivalentSource("corrected-code", {
    title: "高级助理研究员",
    position: {
      state: "CONFIRMED",
      value: "002",
      namespace: "official:plan-2027:position"
    }
  });
  const contract = reconciliation(oldSource, newSource);
  const oldReconciled: PositionIdentityResolutionInput = {
    ...oldSource,
    reconciliation: { reconciliation: contract, related_sources: [newSource] }
  };
  const newReconciled: PositionIdentityResolutionInput = {
    ...newSource,
    reconciliation: { reconciliation: contract, related_sources: [oldSource] }
  };
  const position = positionFor(oldReconciled);
  assert.equal(position.position_id, positionFor(newReconciled).position_id);
  const tracker = new InMemoryPositionVersionTracker();
  const initial = process(tracker, oldReconciled, position).position_version;
  const corrected = process(tracker, newReconciled, position).position_version;
  assert.equal(initial.position_id, corrected.position_id);
  assert.equal(corrected.revision, 2);
  assert.deepEqual(initial.source_occurrence_version_ids, [
    oldSource.version.source_occurrence_version_id
  ]);
  assert.deepEqual(corrected.source_occurrence_version_ids, [
    newSource.version.source_occurrence_version_id
  ]);
});

test("legacy RequirementSetCompositionResult cannot create a PositionVersion", () => {
  const input = source();
  const legacy = {
    opportunity_version_id: "legacy-opportunity-version",
    source_composition_hash: "legacy-hash",
    requirement_set: { position_code: "001" }
  };
  assert.throws(() => new InMemoryPositionVersionTracker().process({
    position: positionFor(input),
    sources: [legacy as unknown as PositionIdentityResolutionInput]
  }), SourceOccurrenceMaterializationError);
});

test("target 22828700101 materializes a test-scoped PositionVersion", () => {
  const input = targetSource();
  const position = positionFor(input);
  const result = process(new InMemoryPositionVersionTracker(), input, position);
  assert.equal(result.position_version.position_id, position.position_id);
  assert.equal(result.position_version.revision, 1);
  assert.deepEqual(result.position_version.source_occurrence_version_ids, [
    input.version.source_occurrence_version_id
  ]);
  assert.equal("opportunity_version" in result, false);
  assert.equal("source_composition_result" in result, false);
  assert.equal("requirement_set" in result, false);
  assert.equal("eligibility_assessment" in result, false);
});

test("PROVISIONAL Position remains PROVISIONAL after PositionVersion creation", () => {
  const input = source({
    position: { state: "PROVISIONAL", value: "22828700101" }
  });
  const position = positionFor(input);
  const result = process(new InMemoryPositionVersionTracker(), input, position);
  assert.equal(position.identity_state, "PROVISIONAL");
  assert.equal(result.position.identity_state, "PROVISIONAL");
  assert.equal(result.position_version.position_id, position.position_id);
});

function targetSource(): PositionIdentityResolutionInput {
  const rawBytes = new Uint8Array(readHistoricalEvidenceBytes("guizhou-attachment-xlsx"));
  const targetSnapshot = readHistoricalEvidenceJson<Snapshot>("guizhou-attachment-snapshot");
  const hash = branded<RawContentSha256>(sha256Bytes(rawBytes));
  const rawBlob: RawBlob = {
    raw_blob_id: branded<RawBlobId>(`sha256:${hash}`),
    bytes: new Uint8Array(rawBytes),
    raw_content_sha256: hash,
    mime_type: GUIZHOU_ATTACHMENT_EXPECTED_MIME,
    byte_length: rawBytes.byteLength,
    created_at: targetSnapshot.observed_at
  };
  const endpoint = createGuizhouLegalRequirementEndpoint(
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
  );
  const extractionInput: AdapterExtractionInput = {
    endpoint,
    snapshot: targetSnapshot,
    raw_blob: rawBlob
  };
  const parsed = new GuizhouLegalXlsxRequirementObservationAdapter().parse(
    extractionInput
  );
  assert.equal(
    parsed.source_occurrence_record.recruitment_context?.position.identity_state,
    "PROVISIONAL"
  );
  assert.equal(
    parsed.source_occurrence_record.recruitment_context?.position
      .source_local_identifier.text,
    P2_LEGAL_05_TARGET_JOB_CODE
  );
  const prepared = prepareSourceOccurrenceMaterialization(
    endpoint,
    parsed.source_occurrence_record,
    targetSnapshot
  );
  const materialized = materializeSourceOccurrenceVersion({
    prepared,
    existing_occurrence: null,
    existing_versions: []
  });
  return {
    endpoint,
    occurrence: materialized.occurrence,
    version: materialized.version,
    extracted_record: parsed.source_occurrence_record,
    snapshot: targetSnapshot
  };
}

function original(text: string) {
  return { text, encoding: "UTF-8" as const };
}

function traceable(text: string) {
  return { original: original(text) };
}

function branded<Type>(value: string) {
  return value as Type;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
