import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  InMemoryPositionBoundOpportunityTracker,
  InMemoryPositionVersionTracker,
  OpportunityContractValidationError,
  PositionBoundOpportunityTrackingError,
  PositionContractValidationError,
  PositionVersionTrackingError,
  SourceOccurrenceMaterializationError,
  assertPositionBoundOpportunityVersionIntegrity,
  createExtractedRecordV2,
  materializeSourceOccurrenceVersion,
  prepareSourceOccurrenceMaterialization,
  positionBoundOpportunityVersionIntegrityHash,
  positionVersionIntegrityHashFor,
  positionVersionSemanticHashFor,
  resolvePositionIdentity,
  validatePositionBoundOpportunityVersion,
  validatePositionVersion,
  type AdapterExtractionInput,
  type IdentityReconciliation,
  type IdentityReconciliationId,
  type IdentityEvidenceId,
  type IsoDateTime,
  type OpportunityVersion,
  type Position,
  type PositionBoundOpportunityVersion,
  type PositionIdentityResolutionInput,
  type PositionVersion,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type SemanticHash,
  type Snapshot,
  type SnapshotId,
  type SourceDefinitionId,
  type SourceOccurrenceVersionId
} from "../../lib/ingestion";
import { GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID } from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";
import { GUIZHOU_ATTACHMENT_EXPECTED_MIME } from "../../lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary";
import {
  GuizhouLegalXlsxRequirementObservationAdapter,
  P2_LEGAL_05_TARGET_JOB_CODE,
  createGuizhouLegalRequirementEndpoint
} from "../../lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseObservedAt = "2026-09-08T12:00:00+08:00";

type PositionClaim =
  | { readonly state: "CONFIRMED"; readonly value: string; readonly namespace: string }
  | { readonly state: "PROVISIONAL"; readonly value: string }
  | { readonly state: "UNRESOLVED"; readonly value?: string };

type OpportunityClaim =
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
  readonly plan?: string;
  readonly planState?: "CONFIRMED" | "UNRESOLVED";
  readonly opportunity?: OpportunityClaim;
  readonly recruitmentYear?: number;
  readonly publishedOn?: string;
  readonly applicationStartsOn?: string;
  readonly applicationClosesOn?: string;
  readonly requirementText?: string;
}

function source(options: SourceOptions = {}): PositionIdentityResolutionInput {
  const sourceDefinitionId = branded<SourceDefinitionId>(
    options.source ?? "source-phase-e-official"
  );
  const endpointId = branded<RecruitmentEndpointId>(
    options.endpoint ?? "endpoint-phase-e-official"
  );
  const endpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: endpointId,
    source_definition_id: sourceDefinitionId,
    name: traceable("Phase E synthetic endpoint"),
    coverage_regions: [{ raw_text: original("贵州省") }],
    locator: `fixture://phase-e/${endpointId}`,
    request_method: "GET",
    content_kind: "FILE",
    adapter_key: "phase-e-synthetic",
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
  const observedAt = options.observedAt ?? baseObservedAt;
  const rawHash = branded<RawContentSha256>(sha256(options.rawSeed ?? "phase-e-raw"));
  const sourceSnapshot: Snapshot = {
    snapshot_id: branded<SnapshotId>(options.snapshot ?? "snapshot-phase-e-1"),
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
      mime_type: "application/json",
      content_length: 128,
      transport_error: null
    },
    observed_at: branded<IsoDateTime>(observedAt),
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
  const opportunity = options.opportunity ?? {
    state: "PROVISIONAL",
    value: recordKey
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
    recruitment_year: original(String(options.recruitmentYear ?? 2025)),
    publish_time: options.publishedOn ? original(options.publishedOn) : undefined,
    deadline: options.applicationClosesOn
      ? original(options.applicationClosesOn)
      : undefined,
    raw_requirement_text: options.requirementText
      ? original(options.requirementText)
      : undefined,
    recruitment_context: {
      recruitment_plan: options.planState === "UNRESOLVED"
        ? {
            identity_state: "UNRESOLVED",
            evidence_locator: {
              kind: "SOURCE_RECORD",
              locator: "recruitment-plan-unresolved"
            }
          }
        : {
            identity_state: "CONFIRMED",
            official_identifier: original(options.plan ?? "PLAN-2025"),
            identifier_namespace: "official:recruitment-plan",
            evidence_locator: {
              kind: "SOURCE_RECORD",
              locator: "recruitment-plan"
            }
          },
      recruitment_batch: { applicability: "NOT_APPLICABLE" },
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
      opportunity: opportunity.state === "CONFIRMED"
        ? {
            identity_state: "CONFIRMED",
            official_identifier: original(opportunity.value),
            identifier_namespace: opportunity.namespace,
            evidence_locator: {
              kind: "SOURCE_RECORD",
              locator: "opportunity-id"
            }
          }
        : opportunity.state === "PROVISIONAL"
          ? {
              identity_state: "PROVISIONAL",
              source_local_identifier: original(opportunity.value),
              evidence_locator: {
                kind: "SOURCE_RECORD",
                locator: "opportunity-row"
              }
            }
          : {
              identity_state: "UNRESOLVED",
              ...(opportunity.value ? { raw_text: original(opportunity.value) } : {}),
              evidence_locator: {
                kind: "SOURCE_RECORD",
                locator: "opportunity-unresolved"
              }
            }
    },
    source_record_locator: {
      kind: "DOCUMENT",
      section: "Sheet1",
      text_locator: "A4:O4"
    },
    adapter_metadata: {
      "phase-e-synthetic": { transient_sequence: 1 }
    },
    extraction: {
      extractor_name: "PhaseESyntheticExtractor",
      extractor_version: "1.0.0",
      schema_version: "phase-e-extracted-record/2.0.0"
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

function equivalentSource(suffix: string, options: SourceOptions = {}) {
  return source({
    endpoint: `endpoint-phase-e-${suffix}`,
    snapshot: `snapshot-phase-e-${suffix}`,
    recordKey: `Sheet-${suffix}!row:4`,
    rawSeed: `phase-e-raw-${suffix}`,
    ...options
  });
}

function positionFor(input: PositionIdentityResolutionInput): Position {
  const result = resolvePositionIdentity(input);
  assert.equal(result.status, "RESOLVED");
  assert.ok(result.position);
  return result.position;
}

function positionVersionFor(
  sources: readonly PositionIdentityResolutionInput[],
  position = positionFor(sources[0]!)
): PositionVersion {
  return new InMemoryPositionVersionTracker().process({
    position,
    sources
  }).position_version;
}

function process(
  tracker: InMemoryPositionBoundOpportunityTracker,
  sources: readonly PositionIdentityResolutionInput[],
  position = positionFor(sources[0]!),
  positionVersion = positionVersionFor(sources, position)
) {
  return tracker.process({
    position,
    position_version: positionVersion,
    sources
  });
}

function resealPositionVersion(
  version: PositionVersion
): PositionVersion {
  return {
    ...version,
    integrity_hash: positionVersionIntegrityHashFor(version)
  };
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
      "identity-reconciliation-phase-e"
    ),
    reconciliation_kind: "CORRECTION",
    state: "CONFIRMED",
    from: [{ kind: "POSITION", id: firstPosition.position_id }],
    to: [{ kind: "POSITION", id: secondPosition.position_id }],
    evidence_ids: [firstEvidence, secondEvidence],
    resolver_version: "phase-e-explicit-reconciliation/1.0.0",
    created_at: branded<IsoDateTime>(baseObservedAt)
  };
}

test("valid Position and validated PositionVersion materialize one PBOV", () => {
  const input = source();
  const position = positionFor(input);
  const positionVersion = positionVersionFor([input], position);
  const result = process(
    new InMemoryPositionBoundOpportunityTracker(),
    [input],
    position,
    positionVersion
  );
  assert.equal(
    result.opportunity_version.position_version_id,
    positionVersion.position_version_id
  );
  assert.equal(
    result.canonical_opportunity.identity_basis?.kind,
    "RECRUITMENT_CONTEXT"
  );
});

test("PBOV resolver returns an independently stored immutable artifact", () => {
  const input = source();
  const position = positionFor(input);
  const positionVersion = positionVersionFor([input], position);
  const tracker = new InMemoryPositionBoundOpportunityTracker();
  const result = process(tracker, [input], position, positionVersion);
  const resolved = tracker.resolve(result.opportunity_version.opportunity_version_id);
  assert.ok(resolved);
  assert.deepEqual(resolved, {
    position,
    position_version: positionVersion,
    canonical_opportunity: result.canonical_opportunity,
    opportunity_version: result.opportunity_version
  });
  (resolved.opportunity_version as { effective_from: string }).effective_from =
    "2099-01-01T00:00:00+08:00";
  assert.equal(
    tracker.resolve(result.opportunity_version.opportunity_version_id)
      ?.opportunity_version.effective_from,
    result.opportunity_version.effective_from
  );
  assert.equal(tracker.resolve("opportunity-version:missing" as never), null);
});

test("trusted PositionVersion rejects provenance and semantic poisoning", async (context) => {
  const input = source();
  const position = positionFor(input);
  const positionVersionTracker = new InMemoryPositionVersionTracker();
  const positionVersion = positionVersionTracker.process({
    position,
    sources: [input]
  }).position_version;
  const trustedSnapshot = structuredClone(positionVersion);
  const tracker = new InMemoryPositionBoundOpportunityTracker(
    positionVersionTracker
  );
  const original = process(tracker, [input], position, positionVersion);

  const changedSov = resealPositionVersion({
    ...positionVersion,
    source_occurrence_version_ids: [
      branded<SourceOccurrenceVersionId>("source-occurrence-version:forged")
    ]
  });
  const changedEvidence = resealPositionVersion({
    ...positionVersion,
    identity_evidence_ids: [
      branded<IdentityEvidenceId>("identity-evidence:forged")
    ]
  });
  const changedEffectiveFrom = resealPositionVersion({
    ...positionVersion,
    effective_from: branded<IsoDateTime>("2099-01-01T00:00:00+08:00")
  });
  const changedSemanticPayload = {
    ...positionVersion,
    title: traceable("伪造岗位标题")
  };
  const changedSemantics = resealPositionVersion({
    ...changedSemanticPayload,
    semantic_hash: positionVersionSemanticHashFor(changedSemanticPayload)
  });

  const mutations: readonly (readonly [string, PositionVersion])[] = [
    ["same ID with different SOV", changedSov],
    ["same ID with different identity Evidence", changedEvidence],
    ["same ID with different effective_from", changedEffectiveFrom],
    ["same ID with rehashed semantic fields", changedSemantics]
  ];
  for (const [name, mutation] of mutations) {
    await context.test(name, () => {
      assert.doesNotThrow(() => validatePositionVersion(mutation, position));
      assert.throws(
        () => process(tracker, [input], position, mutation),
        PositionBoundOpportunityTrackingError
      );
    });
  }
  assert.deepEqual(
    positionVersionTracker.resolve(positionVersion.position_version_id)
      ?.position_version,
    trustedSnapshot
  );
  assert.deepEqual(
    tracker.resolve(original.opportunity_version.opportunity_version_id)
      ?.position_version,
    trustedSnapshot
  );
});

test("new Opportunity cannot replace an existing trusted PositionVersion", () => {
  const first = source({
    opportunity: {
      state: "CONFIRMED",
      value: "OPPORTUNITY-A",
      namespace: "official:opportunity"
    }
  });
  const second = equivalentSource("pv-poisoning", {
    opportunity: {
      state: "CONFIRMED",
      value: "OPPORTUNITY-B",
      namespace: "official:opportunity"
    }
  });
  const position = positionFor(first);
  const trustedPositionVersionTracker = new InMemoryPositionVersionTracker();
  const trustedPositionVersion = trustedPositionVersionTracker.process({
    position,
    sources: [first]
  }).position_version;
  const untrustedPositionVersion = new InMemoryPositionVersionTracker().process({
    position,
    sources: [second]
  }).position_version;
  assert.equal(
    untrustedPositionVersion.position_version_id,
    trustedPositionVersion.position_version_id
  );
  assert.equal(
    untrustedPositionVersion.semantic_hash,
    trustedPositionVersion.semantic_hash
  );
  assert.notDeepEqual(untrustedPositionVersion, trustedPositionVersion);

  const trustedSnapshot = structuredClone(trustedPositionVersion);
  const tracker = new InMemoryPositionBoundOpportunityTracker(
    trustedPositionVersionTracker
  );
  const original = process(
    tracker,
    [first],
    position,
    trustedPositionVersion
  );
  assert.throws(
    () => process(
      tracker,
      [second],
      position,
      untrustedPositionVersion
    ),
    PositionBoundOpportunityTrackingError
  );
  assert.deepEqual(
    trustedPositionVersionTracker.resolve(
      trustedPositionVersion.position_version_id
    )?.position_version,
    trustedSnapshot
  );
  assert.deepEqual(
    tracker.resolve(original.opportunity_version.opportunity_version_id)
      ?.position_version,
    trustedSnapshot
  );
  assert.equal(
    tracker.listVersions(original.canonical_opportunity.canonical_opportunity_id)
      .length,
    1
  );
});

test("caller mutation after seal cannot change the trusted PositionVersion", () => {
  const input = source();
  const position = positionFor(input);
  const positionVersionTracker = new InMemoryPositionVersionTracker();
  const callerReadModel = positionVersionTracker.process({
    position,
    sources: [input]
  }).position_version;
  const trustedSnapshot = structuredClone(callerReadModel);
  (callerReadModel as unknown as {
    title: ReturnType<typeof traceable>;
  }).title = traceable("调用方篡改标题");

  assert.deepEqual(
    positionVersionTracker.resolve(callerReadModel.position_version_id)
      ?.position_version,
    trustedSnapshot
  );
});

test("PBOV integrity hash is self-excluding and protects immutable provenance", () => {
  const input = source();
  const position = positionFor(input);
  const positionVersion = positionVersionFor([input], position);
  const result = process(
    new InMemoryPositionBoundOpportunityTracker(),
    [input],
    position,
    positionVersion
  );
  const opportunityVersion = result.opportunity_version;
  assert.doesNotThrow(() => assertPositionBoundOpportunityVersionIntegrity(
    opportunityVersion,
    position,
    positionVersion,
    result.canonical_opportunity
  ));
  assert.equal(
    positionBoundOpportunityVersionIntegrityHash(opportunityVersion),
    opportunityVersion.integrity_hash
  );
  assert.equal(positionBoundOpportunityVersionIntegrityHash({
    ...opportunityVersion,
    integrity_hash: "f".repeat(64) as SemanticHash
  }), opportunityVersion.integrity_hash);
  const mutations = [
    {
      ...opportunityVersion,
      identity_evidence_ids: [
        ...(opportunityVersion.identity_evidence_ids ?? []),
        "identity-evidence:forged"
      ]
    },
    {
      ...opportunityVersion,
      effective_from: branded<IsoDateTime>("2099-01-01T00:00:00+08:00")
    },
    {
      ...opportunityVersion,
      source_occurrence_version_ids: [
        ...opportunityVersion.source_occurrence_version_ids,
        "source-occurrence-version:forged"
      ]
    }
  ];
  for (const mutation of mutations) {
    assert.throws(() => assertPositionBoundOpportunityVersionIntegrity(
      mutation as never,
      position,
      positionVersion,
      result.canonical_opportunity
    ), OpportunityContractValidationError);
  }
});

test("missing PositionVersion is rejected", () => {
  const input = source();
  const position = positionFor(input);
  assert.throws(() => new InMemoryPositionBoundOpportunityTracker().process({
    position,
    sources: [input]
  } as never), PositionBoundOpportunityTrackingError);
});

test("invalid PositionVersion is rejected", () => {
  const input = source();
  const position = positionFor(input);
  const positionVersion = positionVersionFor([input], position);
  assert.throws(() => process(
    new InMemoryPositionBoundOpportunityTracker(),
    [input],
    position,
    {
      ...positionVersion,
      semantic_hash: branded<SemanticHash>("0".repeat(64))
    }
  ), PositionContractValidationError);
});

test("PositionVersion belonging to another Position is rejected", () => {
  const first = source();
  const second = source({ position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } });
  assert.throws(() => process(
    new InMemoryPositionBoundOpportunityTracker(),
    [first],
    positionFor(second),
    positionVersionFor([first])
  ), PositionContractValidationError);
});

test("PBOV cannot be validated against a different Position", () => {
  const first = source();
  const second = source({ position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } });
  const firstPosition = positionFor(first);
  const firstPositionVersion = positionVersionFor([first], firstPosition);
  const opportunityVersion = process(
    new InMemoryPositionBoundOpportunityTracker(),
    [first],
    firstPosition,
    firstPositionVersion
  ).opportunity_version;
  assert.throws(() => validatePositionBoundOpportunityVersion(
    opportunityVersion,
    positionFor(second),
    firstPositionVersion
  ), OpportunityContractValidationError);
});

test("missing SOV input is rejected", () => {
  const input = source();
  const position = positionFor(input);
  assert.throws(() => new InMemoryPositionBoundOpportunityTracker().process({
    position,
    position_version: positionVersionFor([input], position),
    sources: []
  }), PositionBoundOpportunityTrackingError);
});

test("invalid SOV input is rejected", () => {
  const input = source();
  const position = positionFor(input);
  const positionVersion = positionVersionFor([input], position);
  const tampered = {
    ...input,
    version: {
      ...input.version,
      semantic_hash: branded<SemanticHash>("f".repeat(64))
    }
  };
  assert.throws(() => process(
    new InMemoryPositionBoundOpportunityTracker(),
    [tampered],
    position,
    positionVersion
  ), SourceOccurrenceMaterializationError);
});

test("SOV resolving to another Position is rejected", () => {
  const first = source();
  const second = source({ position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } });
  assert.throws(() => process(
    new InMemoryPositionBoundOpportunityTracker(),
    [second],
    positionFor(first),
    positionVersionFor([first])
  ), PositionBoundOpportunityTrackingError);
});

test("SOV outside the PositionVersion binding is rejected", () => {
  const first = source();
  const second = equivalentSource("unbound");
  const position = positionFor(first);
  assert.throws(() => process(
    new InMemoryPositionBoundOpportunityTracker(),
    [second],
    position,
    positionVersionFor([first], position)
  ), PositionBoundOpportunityTrackingError);
});

test("CanonicalOpportunity identity is deterministic", () => {
  const input = source();
  const first = process(new InMemoryPositionBoundOpportunityTracker(), [input]);
  const second = process(new InMemoryPositionBoundOpportunityTracker(), [input]);
  assert.equal(
    first.canonical_opportunity.canonical_opportunity_id,
    second.canonical_opportunity.canonical_opportunity_id
  );
  assert.equal(
    first.canonical_opportunity.identity_hash,
    second.canonical_opportunity.identity_hash
  );
});

test("PBOV identity is deterministic", () => {
  const input = source();
  const first = process(new InMemoryPositionBoundOpportunityTracker(), [input]);
  const second = process(new InMemoryPositionBoundOpportunityTracker(), [input]);
  assert.equal(
    first.opportunity_version.opportunity_version_id,
    second.opportunity_version.opportunity_version_id
  );
  assert.equal(
    first.opportunity_version.semantic_hash,
    second.opportunity_version.semantic_hash
  );
});

test("repeated materialization is idempotent", () => {
  const input = source();
  const tracker = new InMemoryPositionBoundOpportunityTracker();
  const first = process(tracker, [input]);
  const repeated = process(tracker, [input]);
  assert.equal(repeated.canonical_created, false);
  assert.equal(repeated.version_created, false);
  assert.deepEqual(repeated.opportunity_version, first.opportunity_version);
});

test("retrieval provenance cannot replace an existing OpportunityVersion", () => {
  const first = source();
  const later = source({
    snapshot: "snapshot-phase-e-later",
    observedAt: "2026-09-09T12:00:00+08:00"
  });
  const position = positionFor(first);
  const positionVersion = positionVersionFor([first, later], position);
  const tracker = new InMemoryPositionBoundOpportunityTracker();
  const initial = process(tracker, [first], position, positionVersion);
  assert.throws(
    () => process(tracker, [later], position, positionVersion),
    /source provenance collision/
  );
  assert.deepEqual(
    tracker.resolve(initial.opportunity_version.opportunity_version_id)
      ?.opportunity_version,
    initial.opportunity_version
  );
});

test("Evidence order does not change Opportunity identity", () => {
  const input = source();
  const reordered = {
    ...input,
    version: {
      ...input.version,
      identity_evidence: [...input.version.identity_evidence].reverse()
    }
  };
  const first = process(new InMemoryPositionBoundOpportunityTracker(), [input]);
  const second = process(new InMemoryPositionBoundOpportunityTracker(), [reordered]);
  assert.equal(first.canonical_opportunity.identity_hash,
    second.canonical_opportunity.identity_hash);
  assert.equal(first.opportunity_version.semantic_hash,
    second.opportunity_version.semantic_hash);
});

test("different canonical source payload cannot replace an OpportunityVersion", () => {
  const input = source();
  const duplicateEvidence = {
    ...input,
    version: {
      ...input.version,
      identity_evidence: [
        ...input.version.identity_evidence,
        input.version.identity_evidence[0]!
      ]
    }
  };
  const tracker = new InMemoryPositionBoundOpportunityTracker();
  const initial = process(tracker, [input]);
  assert.throws(
    () => process(tracker, [duplicateEvidence]),
    /source provenance collision/
  );
  assert.deepEqual(
    tracker.resolve(initial.opportunity_version.opportunity_version_id)
      ?.opportunity_version,
    initial.opportunity_version
  );
});

test("substantive Opportunity change creates a new version", () => {
  const first = source({ applicationClosesOn: "2025-02-20" });
  const changed = equivalentSource("window-change", {
    applicationClosesOn: "2025-02-21"
  });
  const position = positionFor(first);
  const positionVersion = positionVersionFor([first, changed], position);
  const tracker = new InMemoryPositionBoundOpportunityTracker();
  const initial = process(tracker, [first], position, positionVersion);
  const next = process(tracker, [changed], position, positionVersion);
  assert.equal(initial.opportunity_version.revision, 1);
  assert.equal(next.opportunity_version.revision, 2);
  assert.notEqual(initial.opportunity_version.semantic_hash,
    next.opportunity_version.semantic_hash);
});

test("PositionVersion revision does not become OpportunityVersion revision", () => {
  const first = source({ title: "助理研究员" });
  const changed = equivalentSource("position-title-change", {
    title: "高级助理研究员"
  });
  const position = positionFor(first);
  const positionTracker = new InMemoryPositionVersionTracker();
  const firstPositionVersion = positionTracker.process({
    position,
    sources: [first]
  }).position_version;
  const secondPositionVersion = positionTracker.process({
    position,
    sources: [changed]
  }).position_version;
  assert.equal(firstPositionVersion.revision, 1);
  assert.equal(secondPositionVersion.revision, 2);

  const opportunity = process(
    new InMemoryPositionBoundOpportunityTracker(),
    [changed],
    position,
    secondPositionVersion
  );
  assert.equal(opportunity.opportunity_version.revision, 1);
});

test("same Position may support multiple Opportunities", () => {
  const first = source({ plan: "PLAN-A" });
  const second = equivalentSource("plan-b", { plan: "PLAN-B" });
  const position = positionFor(first);
  const positionVersion = positionVersionFor([first, second], position);
  const tracker = new InMemoryPositionBoundOpportunityTracker();
  const opportunityA = process(tracker, [first], position, positionVersion);
  const opportunityB = process(tracker, [second], position, positionVersion);
  assert.equal(opportunityA.canonical_opportunity.identity_basis?.kind,
    "RECRUITMENT_CONTEXT");
  assert.equal(opportunityB.canonical_opportunity.identity_basis?.kind,
    "RECRUITMENT_CONTEXT");
  assert.notEqual(opportunityA.canonical_opportunity.canonical_opportunity_id,
    opportunityB.canonical_opportunity.canonical_opportunity_id);
  assert.equal(opportunityA.opportunity_version.revision, 1);
  assert.equal(opportunityB.opportunity_version.revision, 1);
});

test("different Positions cannot share one PBOV", () => {
  const first = source();
  const second = source({ position: {
    state: "CONFIRMED",
    value: "002",
    namespace: "official:plan-2027:position"
  } });
  const positionVersionTracker = new InMemoryPositionVersionTracker();
  const tracker = new InMemoryPositionBoundOpportunityTracker(
    positionVersionTracker
  );
  const firstPosition = positionFor(first);
  const secondPosition = positionFor(second);
  const firstPositionVersion = positionVersionTracker.process({
    position: firstPosition,
    sources: [first]
  }).position_version;
  const secondPositionVersion = positionVersionTracker.process({
    position: secondPosition,
    sources: [second]
  }).position_version;
  const opportunityA = process(
    tracker,
    [first],
    firstPosition,
    firstPositionVersion
  );
  const opportunityB = process(
    tracker,
    [second],
    secondPosition,
    secondPositionVersion
  );
  assert.notEqual(
    opportunityA.canonical_opportunity.canonical_opportunity_id,
    opportunityB.canonical_opportunity.canonical_opportunity_id
  );
  assert.notEqual(
    opportunityA.opportunity_version.position_version_id,
    opportunityB.opportunity_version.position_version_id
  );
});

test("cross-source sharing requires Phase C identity proof", () => {
  const first = source({
    source: "source-phase-e-cross-a",
    opportunity: {
      state: "CONFIRMED",
      value: "OPPORTUNITY-CROSS",
      namespace: "official:opportunity"
    }
  });
  const second = equivalentSource("cross-b", {
    source: "source-phase-e-cross-b",
    position: {
      state: "CONFIRMED",
      value: "002",
      namespace: "official:plan-2027:position"
    },
    opportunity: {
      state: "CONFIRMED",
      value: "OPPORTUNITY-CROSS",
      namespace: "official:opportunity"
    }
  });
  assert.throws(() => positionVersionFor([first, second], positionFor(first)),
    PositionVersionTrackingError);

  const contract = reconciliation(first, second);
  const firstReconciled: PositionIdentityResolutionInput = {
    ...first,
    reconciliation: { reconciliation: contract, related_sources: [second] }
  };
  const secondReconciled: PositionIdentityResolutionInput = {
    ...second,
    reconciliation: { reconciliation: contract, related_sources: [first] }
  };
  const position = positionFor(firstReconciled);
  const positionVersion = positionVersionFor(
    [firstReconciled, secondReconciled],
    position
  );
  const result = process(
    new InMemoryPositionBoundOpportunityTracker(),
    [firstReconciled, secondReconciled],
    position,
    positionVersion
  );
  assert.equal(result.canonical_opportunity.identity_state, "CONFIRMED");
  assert.equal(result.opportunity_version.source_occurrence_version_ids.length, 2);
});

test("legacy OpportunityVersion cannot become PBOV", () => {
  const input = source();
  const position = positionFor(input);
  const positionVersion = positionVersionFor([input], position);
  const legacy: OpportunityVersion = {
    opportunity_version_id: branded("legacy-opportunity-version"),
    canonical_opportunity_id: branded("legacy-opportunity"),
    revision: 1,
    semantic_hash: branded("legacy-semantic-hash"),
    content: input.version.content,
    source_occurrence_version_ids: [input.version.source_occurrence_version_id],
    effective_from: branded<IsoDateTime>(baseObservedAt)
  };
  assert.throws(() => validatePositionBoundOpportunityVersion(
    legacy,
    position,
    positionVersion
  ), OpportunityContractValidationError);
  assert.equal(legacy.position_version_id, undefined);
});

test("legacy RequirementSetCompositionResult cannot create PBOV", () => {
  const input = source();
  const legacy = {
    opportunity_version_id: "legacy-opportunity-version",
    source_composition_hash: "legacy-hash",
    requirement_set: { position_code: "001" }
  };
  assert.throws(() => new InMemoryPositionBoundOpportunityTracker().process({
    position: positionFor(input),
    position_version: positionVersionFor([input]),
    sources: [legacy]
  } as never), SourceOccurrenceMaterializationError);
});

test("target 22828700101 materializes only a test-scoped PBOV", () => {
  const input = targetSource();
  const position = positionFor(input);
  const positionVersion = positionVersionFor([input], position);
  const result = process(
    new InMemoryPositionBoundOpportunityTracker(),
    [input],
    position,
    positionVersion
  );
  assert.equal(result.opportunity_version.position_version_id,
    positionVersion.position_version_id);
  assert.equal(result.canonical_opportunity.identity_state, "PROVISIONAL");
  assert.equal("source_composition_result" in result, false);
  assert.equal("requirement_set" in result, false);
  assert.equal("predicate_resolution" in result, false);
  assert.equal("candidate_evidence" in result, false);
  assert.equal("eligibility_assessment" in result, false);
});

test("target PROVISIONAL Position remains PROVISIONAL", () => {
  const input = targetSource();
  const position = positionFor(input);
  const result = process(
    new InMemoryPositionBoundOpportunityTracker(),
    [input],
    position,
    positionVersionFor([input], position)
  );
  assert.equal(position.identity_state, "PROVISIONAL");
  assert.equal(result.canonical_opportunity.identity_state, "PROVISIONAL");
});

test("legal Requirement source changes cannot rebind an existing OpportunityVersion", () => {
  const first = source({ requirementText: "具有中华人民共和国国籍" });
  const changed = equivalentSource("requirement-only", {
    requirementText: "不得有刑事处罚记录"
  });
  const position = positionFor(first);
  const positionVersion = positionVersionFor([first, changed], position);
  const tracker = new InMemoryPositionBoundOpportunityTracker();
  const initial = process(tracker, [first], position, positionVersion);
  assert.throws(
    () => process(tracker, [changed], position, positionVersion),
    PositionBoundOpportunityTrackingError
  );
  const trusted = tracker.resolve(
    initial.opportunity_version.opportunity_version_id
  );
  assert.deepEqual(trusted?.opportunity_version, initial.opportunity_version);
  assert.equal(trusted && "eligibility_result" in trusted, false);
  assert.equal(trusted && "not_match" in trusted, false);
});

test("unresolved Opportunity identity without a source-local Position is rejected", () => {
  const input = source({
    planState: "UNRESOLVED",
    opportunity: { state: "UNRESOLVED" }
  });
  assert.throws(() => process(
    new InMemoryPositionBoundOpportunityTracker(),
    [input]
  ), PositionBoundOpportunityTrackingError);
});

test("Phase E materialization remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});

function targetSource(): PositionIdentityResolutionInput {
  const executionIndex = JSON.parse(readFileSync(path.join(
    repositoryRoot,
    "outputs/p2-legal-04/attachment-observation-canary-execution.json"
  ), "utf8")) as {
    readonly report: { readonly raw: { readonly local_artifact: string } };
  };
  const rawPath = executionIndex.report.raw.local_artifact;
  const rawBytes = new Uint8Array(readFileSync(rawPath));
  const targetSnapshot = JSON.parse(readFileSync(
    path.join(path.dirname(rawPath), "snapshot.json"),
    "utf8"
  )) as Snapshot;
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
