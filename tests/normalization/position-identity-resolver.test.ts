import "../helpers/network-guard";
import { readHistoricalEvidenceBytes, readHistoricalEvidenceJson } from "../helpers/historical-evidence";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  POSITION_IDENTITY_CONTRACT_VERSION,
  PositionContractValidationError,
  SourceOccurrenceMaterializationError,
  createExtractedRecordV2,
  materializeSourceOccurrenceVersion,
  positionIdForIdentityBasis,
  positionIdentityHashFor,
  prepareSourceOccurrenceMaterialization,
  resolvePositionIdentity,
  validatePosition,
  type AdapterExtractionInput,
  type IdentityEvidenceId,
  type IdentityReconciliation,
  type IdentityReconciliationId,
  type IsoDateTime,
  type PositionIdentityResolutionInput,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
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

const baseObservedAt = "2026-09-08T11:00:00+08:00";

type PositionClaim =
  | {
      readonly state: "CONFIRMED";
      readonly value: string;
      readonly namespace: string;
    }
  | {
      readonly state: "PROVISIONAL";
      readonly value: string;
    }
  | {
      readonly state: "UNRESOLVED";
      readonly value?: string;
    };

interface SourceOptions {
  readonly source?: string;
  readonly endpoint?: string;
  readonly snapshot?: string;
  readonly observedAt?: string;
  readonly rawSeed?: string;
  readonly recordKey?: string;
  readonly title?: string;
  readonly organization?: string;
  readonly position?: PositionClaim;
  readonly includeAnnouncementEvidence?: boolean;
}

function source(options: SourceOptions = {}): PositionIdentityResolutionInput {
  const sourceDefinitionId = branded<SourceDefinitionId>(
    options.source ?? "source-phase-c-official"
  );
  const endpointId = branded<RecruitmentEndpointId>(
    options.endpoint ?? "endpoint-phase-c-official"
  );
  const endpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: endpointId,
    source_definition_id: sourceDefinitionId,
    name: traceable("Phase C synthetic endpoint"),
    coverage_regions: [{ raw_text: original("贵州省") }],
    locator: `fixture://phase-c/${endpointId}`,
    request_method: "GET",
    content_kind: "FILE",
    adapter_key: "phase-c-synthetic",
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
  const rawHash = branded<RawContentSha256>(sha256(options.rawSeed ?? "phase-c-raw"));
  const sourceSnapshot: Snapshot = {
    snapshot_id: branded<SnapshotId>(options.snapshot ?? "snapshot-phase-c-1"),
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
    raw_location_text: [original("贵州省")],
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
      "phase-c-synthetic": { transient_sequence: 1 }
    },
    extraction: {
      extractor_name: "PhaseCSyntheticExtractor",
      extractor_version: "1.0.0",
      schema_version: "phase-c-extracted-record/2.0.0"
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

function resolved(input: PositionIdentityResolutionInput) {
  const result = resolvePositionIdentity(input);
  assert.equal(result.status, "RESOLVED");
  assert.ok(result.position);
  return result.position;
}

function positionEvidenceId(input: PositionIdentityResolutionInput) {
  const context = input.version.content.recruitment_context;
  assert.ok(context);
  const evidenceId = context.position.identity_evidence_ids[0];
  assert.ok(evidenceId);
  return evidenceId;
}

function reconciliation(
  first: PositionIdentityResolutionInput,
  second: PositionIdentityResolutionInput,
  state: IdentityReconciliation["state"] = "CONFIRMED"
): IdentityReconciliation {
  const firstPosition = resolved(first);
  const secondPosition = resolved(second);
  return {
    identity_reconciliation_id: branded<IdentityReconciliationId>(
      "identity-reconciliation-phase-c"
    ),
    reconciliation_kind: "MERGE",
    state,
    from: [{ kind: "POSITION", id: firstPosition.position_id }],
    to: [{ kind: "POSITION", id: secondPosition.position_id }],
    evidence_ids: [positionEvidenceId(first), positionEvidenceId(second)],
    resolver_version: "phase-c-explicit-reconciliation/1.0.0",
    created_at: branded<IsoDateTime>(baseObservedAt)
  };
}

test("OFFICIAL_POSITION_CODE resolves from validated SOV evidence", () => {
  const input = source();
  const position = resolved(input);
  assert.equal(position.identity_basis.kind, "OFFICIAL_POSITION_CODE");
  assert.equal(position.identity_state, "CONFIRMED");
  assert.equal(position.official_position_code?.original.text, "001");
  assert.equal(position.position_code_namespace, "official:plan-2027:position");
});

test("SOURCE_LOCAL_RECORD resolves from exact validated source-local evidence", () => {
  const input = source({ position: { state: "PROVISIONAL", value: "LOCAL-001" } });
  const position = resolved(input);
  assert.equal(position.identity_basis.kind, "SOURCE_LOCAL_RECORD");
  assert.equal(position.source_local_record_identifier?.original.text, "LOCAL-001");
});

test("SOURCE_LOCAL_RECORD always forces PROVISIONAL", () => {
  const position = resolved(source({
    position: { state: "PROVISIONAL", value: "LOCAL-001" }
  }));
  assert.equal(position.identity_state, "PROVISIONAL");
  assert.equal(position.identity_resolver_version, POSITION_IDENTITY_CONTRACT_VERSION);
  assert.throws(() => validatePosition({
    ...position,
    identity_state: "CONFIRMED"
  }), PositionContractValidationError);
});

test("EXPLICIT_RECONCILIATION resolves only with validated related SOV Evidence", () => {
  const first = source({ position: { state: "PROVISIONAL", value: "LOCAL-001" } });
  const second = source({
    endpoint: "endpoint-phase-c-second",
    snapshot: "snapshot-phase-c-second",
    recordKey: "Sheet2!row:9",
    position: { state: "PROVISIONAL", value: "LOCAL-009" }
  });
  const position = resolved({
    ...first,
    reconciliation: {
      reconciliation: reconciliation(first, second),
      related_sources: [second]
    }
  });
  assert.equal(position.identity_basis.kind, "EXPLICIT_RECONCILIATION");
  assert.equal(position.identity_state, "CONFIRMED");
});

test("weak title, organization, URL, and row metadata cannot resolve identity", () => {
  const result = resolvePositionIdentity(source({
    title: "法官助理",
    organization: "某法院",
    recordKey: "row-weak-only",
    position: { state: "UNRESOLVED", value: "待确认" }
  }));
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.position, null);
});

test("missing Position identity Evidence is rejected by the validated-SOV gate", () => {
  const input = source();
  const tampered = {
    ...input,
    version: {
      ...input.version,
      identity_evidence: []
    }
  };
  assert.throws(
    () => resolvePositionIdentity(tampered),
    SourceOccurrenceMaterializationError
  );
});

test("mismatched SOV identity Evidence is rejected before Position resolution", () => {
  const first = source();
  const second = source({
    endpoint: "endpoint-phase-c-mismatch",
    snapshot: "snapshot-phase-c-mismatch",
    recordKey: "row-mismatch"
  });
  const tampered = {
    ...first,
    version: {
      ...first.version,
      identity_evidence: second.version.identity_evidence
    }
  };
  assert.throws(
    () => resolvePositionIdentity(tampered),
    SourceOccurrenceMaterializationError
  );
});

test("resolver canonicalization is deterministic", () => {
  const first = resolved(source());
  const second = resolved(source({ includeAnnouncementEvidence: true }));
  assert.equal(first.identity_hash, second.identity_hash);
});

test("resolver persists the canonical Position identity hash", () => {
  const position = resolved(source());
  assert.equal(position.identity_hash, positionIdentityHashFor(position.identity_basis));
});

test("resolver creates deterministic position:<hash> IDs", () => {
  const position = resolved(source());
  assert.equal(position.position_id, positionIdForIdentityBasis(position.identity_basis));
  assert.equal(position.position_id, `position:${position.identity_hash}`);
});

test("retrieval timestamp does not change Position identity", () => {
  const first = resolved(source());
  const second = resolved(source({
    snapshot: "snapshot-phase-c-later",
    observedAt: "2026-09-09T11:00:00+08:00"
  }));
  assert.equal(first.position_id, second.position_id);
});

test("SOV Evidence order does not change Position identity", () => {
  const input = source({ includeAnnouncementEvidence: true });
  const reordered = {
    ...input,
    version: {
      ...input.version,
      identity_evidence: [...input.version.identity_evidence].reverse()
    }
  };
  assert.equal(resolved(input).position_id, resolved(reordered).position_id);
});

test("duplicate SOV Evidence does not change Position identity", () => {
  const input = source();
  const duplicated = {
    ...input,
    version: {
      ...input.version,
      identity_evidence: [
        ...input.version.identity_evidence,
        ...input.version.identity_evidence
      ]
    }
  };
  assert.equal(resolved(input).position_id, resolved(duplicated).position_id);
});

test("different official Position codes never merge", () => {
  const first = resolved(source({ position: {
    state: "CONFIRMED",
    value: "001",
    namespace: "official:plan-2027:position"
  } }));
  const second = resolved(source({ position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } }));
  assert.notEqual(first.position_id, second.position_id);
});

test("same official code and namespace may resolve to the same Position", () => {
  const first = resolved(source({ endpoint: "endpoint-phase-c-list-a" }));
  const second = resolved(source({
    endpoint: "endpoint-phase-c-list-b",
    snapshot: "snapshot-phase-c-list-b",
    recordKey: "Sheet2!row:8",
    title: "不同展示标题",
    organization: "不同展示单位"
  }));
  assert.equal(first.position_id, second.position_id);
});

test("same title never merges distinct source-local Positions", () => {
  const first = resolved(source({
    recordKey: "row-title-1",
    title: "法官助理",
    position: { state: "PROVISIONAL", value: "LOCAL-001" }
  }));
  const second = resolved(source({
    recordKey: "row-title-2",
    title: "法官助理",
    position: { state: "PROVISIONAL", value: "LOCAL-002" }
  }));
  assert.notEqual(first.position_id, second.position_id);
});

test("same organization never merges distinct source-local Positions", () => {
  const first = resolved(source({
    recordKey: "row-org-1",
    organization: "同一单位",
    position: { state: "PROVISIONAL", value: "LOCAL-001" }
  }));
  const second = resolved(source({
    recordKey: "row-org-2",
    organization: "同一单位",
    position: { state: "PROVISIONAL", value: "LOCAL-002" }
  }));
  assert.notEqual(first.position_id, second.position_id);
});

test("different attachments never merge source-local Positions", () => {
  const first = resolved(source({
    endpoint: "endpoint-phase-c-attachment-1",
    recordKey: "Sheet1!row:4",
    position: { state: "PROVISIONAL", value: "LOCAL-001" }
  }));
  const second = resolved(source({
    endpoint: "endpoint-phase-c-attachment-2",
    snapshot: "snapshot-phase-c-attachment-2",
    recordKey: "Sheet1!row:4",
    position: { state: "PROVISIONAL", value: "LOCAL-001" }
  }));
  assert.notEqual(first.position_id, second.position_id);
});

test("different sources never merge without explicit reconciliation", () => {
  const first = resolved(source({ source: "source-phase-c-a" }));
  const second = resolved(source({
    source: "source-phase-c-b",
    endpoint: "endpoint-phase-c-b",
    snapshot: "snapshot-phase-c-b"
  }));
  assert.notEqual(first.position_id, second.position_id);
});

test("explicit reconciliation permits evidence-backed cross-source merge", () => {
  const first = source({
    source: "source-phase-c-a",
    position: { state: "PROVISIONAL", value: "A-001" }
  });
  const second = source({
    source: "source-phase-c-b",
    endpoint: "endpoint-phase-c-b",
    snapshot: "snapshot-phase-c-b",
    recordKey: "source-b-row-9",
    position: { state: "PROVISIONAL", value: "B-009" }
  });
  const contract = reconciliation(first, second);
  const forward = resolved({
    ...first,
    reconciliation: { reconciliation: contract, related_sources: [second] }
  });
  const reverse = resolved({
    ...second,
    reconciliation: { reconciliation: contract, related_sources: [first] }
  });
  assert.equal(forward.position_id, reverse.position_id);
});

test("legacy RequirementSetCompositionResult cannot provide Position identity", () => {
  const legacy = {
    opportunity_version_id: "legacy-opportunity-version",
    source_composition_hash: "legacy-hash",
    requirement_set: { position_code: "001" }
  };
  assert.throws(
    () => resolvePositionIdentity(legacy as unknown as PositionIdentityResolutionInput),
    SourceOccurrenceMaterializationError
  );
});

test("target 22828700101 resolves test-scoped as SOURCE_LOCAL_RECORD + PROVISIONAL", () => {
  const input = targetSource();
  const position = resolved(input);
  assert.equal(position.identity_basis.kind, "SOURCE_LOCAL_RECORD");
  assert.equal(position.identity_state, "PROVISIONAL");
  assert.equal(
    position.source_local_record_identifier?.original.text,
    P2_LEGAL_05_TARGET_JOB_CODE
  );
  assert.equal("position_version" in position, false);
  assert.equal("opportunity" in position, false);
  assert.equal("source_composition_result" in position, false);
  assert.equal("requirement_set" in position, false);
  assert.equal("eligibility_assessment" in position, false);
});

test("unresolved Position identity remains REVIEW_REQUIRED without a Position", () => {
  const result = resolvePositionIdentity(source({
    position: { state: "UNRESOLVED" }
  }));
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.identity_state, "UNRESOLVED");
  assert.equal(result.position, null);
  assert.deepEqual(result.reason_codes, ["POSITION_IDENTITY_UNRESOLVED"]);
});

test("provisional identity is never automatically upgraded to official identity", () => {
  const provisional = resolved(source({
    position: { state: "PROVISIONAL", value: "001" }
  }));
  const official = resolved(source({
    position: {
      state: "CONFIRMED",
      value: "001",
      namespace: "official:plan-2027:position"
    }
  }));
  assert.equal(provisional.identity_state, "PROVISIONAL");
  assert.equal(official.identity_state, "CONFIRMED");
  assert.notEqual(provisional.position_id, official.position_id);
});

test("review-required reconciliation never creates a Position", () => {
  const first = source({ position: { state: "PROVISIONAL", value: "LOCAL-001" } });
  const second = source({
    endpoint: "endpoint-phase-c-review",
    snapshot: "snapshot-phase-c-review",
    recordKey: "review-row",
    position: { state: "PROVISIONAL", value: "LOCAL-002" }
  });
  const result = resolvePositionIdentity({
    ...first,
    reconciliation: {
      reconciliation: reconciliation(first, second, "REVIEW_REQUIRED"),
      related_sources: [second]
    }
  });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.position, null);
  assert.deepEqual(result.reason_codes, ["RECONCILIATION_REVIEW_REQUIRED"]);
});

test("reconciliation Evidence absent from validated SOVs is rejected", () => {
  const first = source({ position: { state: "PROVISIONAL", value: "LOCAL-001" } });
  const second = source({
    endpoint: "endpoint-phase-c-evidence",
    snapshot: "snapshot-phase-c-evidence",
    recordKey: "evidence-row",
    position: { state: "PROVISIONAL", value: "LOCAL-002" }
  });
  const contract = {
    ...reconciliation(first, second),
    evidence_ids: [
      branded<IdentityEvidenceId>("identity-evidence-not-present")
    ] as const
  };
  assert.throws(() => resolvePositionIdentity({
    ...first,
    reconciliation: { reconciliation: contract, related_sources: [second] }
  }), PositionContractValidationError);
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
