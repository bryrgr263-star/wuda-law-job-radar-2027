import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  InMemoryPositionBoundOpportunityTracker,
  InMemoryPositionVersionTracker,
  InMemoryTrustedSourceOccurrenceTracker,
  SOURCE_COMPOSITION_SCHEMA_VERSION,
  createExtractedRecordV2,
  createPredicateCandidateEvidence,
  createTrustedArtifactChain,
  materializeSourceOccurrenceVersion,
  prepareSourceOccurrenceMaterialization,
  resolvePositionIdentity,
  type AuthorityAssertionId,
  type CandidateCredentialId,
  type CandidateProfileId,
  type CandidateStateEvidenceId,
  type DiscoveryBoundaryId,
  type ExpectedSurfaceManifestEntryId,
  type IsoDateTime,
  type PositionIdentityResolutionInput,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type Snapshot,
  type SnapshotId,
  type SourceCompositionEvidenceId,
  type SourceCompositionInput,
  type SourceDefinitionId,
  type SourcePackageInventoryId,
  type SourcePrecedenceDecisionId,
  type SourceSurfaceBindingId,
  type SourceSurfaceId,
  type SourceVersionSelectionId,
  type StructuredEducationCredential,
  type StructuredCandidateProfile,
  type TrustedArtifactChain,
  type TrustedSourceOccurrenceArtifact
} from "../../lib/ingestion";

export const OBSERVED_AT = branded<IsoDateTime>("2026-09-08T12:00:00+08:00");
export const AS_OF = branded<IsoDateTime>("2026-09-09T12:00:00+08:00");
export const CANDIDATE_ID = branded<CandidateProfileId>("candidate-trust-chain");

export interface TrustedFixture {
  readonly source: PositionIdentityResolutionInput;
  readonly pbov_tracker: InMemoryPositionBoundOpportunityTracker;
  readonly opportunity_version_id: import("../../lib/ingestion").OpportunityVersionId;
  readonly chain: TrustedArtifactChain;
  readonly composition_input: SourceCompositionInput;
}

export interface TrustedPackageFixture extends TrustedFixture {
  readonly package_source: TrustedSourceOccurrenceArtifact;
}

export function trustedFixture(
  suffix = "base",
  requirementText = "学历要求：本科及以上",
  options: {
    readonly academic_program_directory?: {
      readonly directory_namespace: string;
      readonly directory_version: string;
    };
    readonly academic_program_directories?: Readonly<Record<string, {
      readonly directory_namespace: string;
      readonly directory_version: string;
    }>>;
  } = {}
): TrustedFixture {
  const source = syntheticSource(suffix, requirementText, options);
  const resolution = resolvePositionIdentity(source);
  assert.equal(resolution.status, "RESOLVED");
  const positionVersion = new InMemoryPositionVersionTracker().process({
    position: resolution.position,
    sources: [source]
  }).position_version;
  const pbovTracker = new InMemoryPositionBoundOpportunityTracker();
  const opportunity = pbovTracker.process({
    position: resolution.position,
    position_version: positionVersion,
    sources: [source]
  });
  const chain = createTrustedArtifactChain(pbovTracker);
  return {
    source,
    pbov_tracker: pbovTracker,
    opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
    chain,
    composition_input: completeCompositionInput(
      source,
      opportunity.opportunity_version.opportunity_version_id,
      positionVersion.position_version_id
    )
  };
}

export function materializeTrustedChain(fixture = trustedFixture()) {
  const sourceComposition = fixture.chain.source_compositions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const projection = fixture.chain.requirement_projections.materialize(
    sourceComposition.source_composition_id
  );
  const requirementSet = fixture.chain.requirement_sets.materialize(
    sourceComposition.source_composition_id
  );
  return { fixture, sourceComposition, projection, requirementSet };
}

export function trustedPackageFixture(
  suffix = "package",
  packageRequirementText = "2027届"
): TrustedPackageFixture {
  const base = trustedFixture(`${suffix}-position`, "学历要求：本科及以上");
  const packageEndpointId = branded<RecruitmentEndpointId>(
    `endpoint-trust-chain-${suffix}-package`
  );
  const packageEndpoint: RecruitmentEndpoint = {
    ...structuredClone(base.source.endpoint),
    recruitment_endpoint_id: packageEndpointId,
    name: traceable("Trusted package fixture endpoint"),
    locator: `fixture://trusted-chain/${suffix}/package`
  };
  const packageHash = branded<RawContentSha256>(sha256(
    `trusted-chain-package-raw-${suffix}`
  ));
  const packageSnapshot: Snapshot = {
    snapshot_id: branded<SnapshotId>(`snapshot-trust-chain-${suffix}-package`),
    recruitment_endpoint_id: packageEndpointId,
    request_metadata: {
      locator: packageEndpoint.locator,
      method: "GET",
      requested_at: OBSERVED_AT,
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: 200,
      headers: {},
      mime_type: "text/html",
      content_length: 256,
      transport_error: null
    },
    observed_at: OBSERVED_AT,
    transport_status: "SUCCESS",
    raw_blob_id: branded<RawBlobId>(`sha256:${packageHash}`),
    content_hash: packageHash,
    content_length: 256
  };
  const packageRecord = createExtractedRecordV2(packageSnapshot, {
    source_definition_id: packageEndpoint.source_definition_id,
    identity_candidates: [{
      kind: "ANNOUNCEMENT_URL",
      value: packageEndpoint.locator,
      confidence: "HIGH"
    }],
    raw_source_record_id: packageEndpoint.locator,
    raw_title: original("Trusted announcement package"),
    raw_organization_name: original("Synthetic official publisher"),
    raw_location_text: [original("贵州省")],
    raw_requirement_text: original(packageRequirementText),
    announcement_url: packageEndpoint.locator,
    recruitment_year: original("2027"),
    source_record_locator: {
      kind: "DOCUMENT",
      section: "announcement",
      text_locator: "requirements"
    },
    adapter_metadata: {},
    extraction: {
      extractor_name: "TrustedPackageFixtureExtractor",
      extractor_version: "1.0.0",
      schema_version: "trusted-package-extracted-record/2.0.0"
    }
  });
  const sourceTracker = new InMemoryTrustedSourceOccurrenceTracker();
  const packageSource = sourceTracker.process({
    source_role: "PACKAGE",
    endpoint: packageEndpoint,
    extracted_record: packageRecord,
    snapshot: packageSnapshot
  });
  const composition = structuredClone(base.composition_input) as {
    -readonly [Key in keyof SourceCompositionInput]: SourceCompositionInput[Key]
  };
  const opportunityVersionId = base.opportunity_version_id;
  const key = sha256(`${opportunityVersionId}\0${packageSource.version.source_occurrence_version_id}`);
  const evidenceId = branded<SourceCompositionEvidenceId>(`package-evidence-${key}`);
  const surfaceId = branded<SourceSurfaceId>(`package-surface-${key}`);
  const bindingId = branded<SourceSurfaceBindingId>(`package-binding-${key}`);
  const authorityId = branded<AuthorityAssertionId>(`package-authority-${key}`);
  const selectionId = branded<SourceVersionSelectionId>(`package-selection-${key}`);
  const entryId = branded<ExpectedSurfaceManifestEntryId>(`package-entry-${key}`);
  const locator = {
    kind: "DOCUMENT" as const,
    section: "announcement",
    text_locator: "requirements"
  };
  const context = {
    source_occurrence_version_id: packageSource.version.source_occurrence_version_id,
    snapshot_id: packageSource.snapshot.snapshot_id,
    extracted_record_id: packageSource.extracted_record.extracted_record_id,
    observed_at: packageSource.snapshot.observed_at,
    resolver_version: "trusted-package-binding/1.0.0"
  };
  composition.discovery_boundary = {
    ...composition.discovery_boundary,
    boundary_kind: "ANNOUNCEMENT_PACKAGE",
    initiating_source_surface_ids: [
      ...composition.discovery_boundary.initiating_source_surface_ids,
      surfaceId
    ],
    source_metadata_references: [
      ...composition.discovery_boundary.source_metadata_references,
      packageEndpointId
    ]
  };
  composition.inventory = {
    ...composition.inventory,
    discovered_source_surface_ids: [
      ...composition.inventory.discovered_source_surface_ids,
      surfaceId
    ],
    expected_surface_entries: [
      ...composition.inventory.expected_surface_entries,
      {
        expected_surface_manifest_entry_id: entryId,
        expected_surface_key: `announcement-${key}`,
        source_surface_id: surfaceId,
        expectedness: "REQUIRED",
        requirement_level: "REQUIREMENT_BEARING",
        authority_status: "OFFICIAL_AUTHORITATIVE",
        authority_assertion_id: authorityId,
        binding_status: "RESOLVED",
        material_binding_ids: [bindingId],
        version_selection_status: "RESOLVED",
        source_version_selection_id: selectionId,
        coverage_status: "COVERED",
        resolution_status: "RESOLVED",
        target_scope: opportunityVersionId,
        evidence_ids: [evidenceId]
      }
    ]
  };
  composition.evidence_registry = [
    ...composition.evidence_registry,
    {
      source_composition_evidence_id: evidenceId,
      snapshot_id: packageSource.snapshot.snapshot_id,
      extracted_record_id: packageSource.extracted_record.extracted_record_id,
      source_occurrence_version_id:
        packageSource.version.source_occurrence_version_id,
      locator,
      observed_at: packageSource.snapshot.observed_at,
      extractor_version: packageSource.version.materialization.extractor_version
    }
  ];
  composition.source_surfaces = [
    ...composition.source_surfaces,
    {
      source_surface_id: surfaceId,
      surface_kind: "ANNOUNCEMENT_BODY",
      source_occurrence_version_id:
        packageSource.version.source_occurrence_version_id,
      snapshot_id: packageSource.snapshot.snapshot_id,
      extracted_record_id: packageSource.extracted_record.extracted_record_id,
      locator,
      surface_content_hash: packageSource.version.semantic_hash,
      effective_period: { effective_from: packageSource.version.first_observed_at },
      observed_at: packageSource.snapshot.observed_at,
      surface_status: "PARSED",
      composition_role: "PRIMARY",
      target_scope: opportunityVersionId,
      evidence_ids: [evidenceId],
      extractor_version: packageSource.version.materialization.extractor_version,
      parser_version: "trusted-package-parser/1.0.0",
      resolver_version: "trusted-package-resolver/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }
  ];
  composition.source_surface_bindings = [
    ...composition.source_surface_bindings,
    {
      source_surface_binding_id: bindingId,
      source_surface_id: surfaceId,
      target_type: "OPPORTUNITY_VERSION",
      target_id: opportunityVersionId,
      target_version_id: opportunityVersionId,
      binding_kind: "ANNOUNCEMENT_UNIFORM",
      binding_status: "RESOLVED",
      evidence_ids: [evidenceId],
      created_context: context,
      observed_context: context,
      locator,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }
  ];
  composition.authority_assertions = [
    ...composition.authority_assertions,
    {
      authority_assertion_id: authorityId,
      asserted_source_surface_id: surfaceId,
      authority_basis_source_surface_id: surfaceId,
      authority_basis_binding_id: bindingId,
      issuer: "synthetic-official-publisher",
      authority_state: "OFFICIAL_AUTHORITATIVE",
      target_scope: opportunityVersionId,
      effective_period: { effective_from: packageSource.version.first_observed_at },
      evidence_ids: [evidenceId],
      resolver_version: "trusted-package-authority/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }
  ];
  composition.source_version_selections = [
    ...composition.source_version_selections,
    {
      source_version_selection_id: selectionId,
      source_identity: packageSource.occurrence.source_occurrence_id,
      target_scope: opportunityVersionId,
      candidate_source_surface_ids: [surfaceId],
      selected_source_surface_id: surfaceId,
      excluded_source_surface_ids: [],
      selection_status: "RESOLVED",
      effective_period: { effective_from: packageSource.version.first_observed_at },
      observation_time: packageSource.snapshot.observed_at,
      evidence_ids: [evidenceId],
      resolver_version: "trusted-package-selection/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }
  ];
  composition.precedence_decisions = composition.precedence_decisions.map((decision) => {
    return {
      ...decision,
      selected_source_surface_ids: [...decision.selected_source_surface_ids, surfaceId],
      authority_assertion_ids: [...decision.authority_assertion_ids, authorityId],
      evidence_ids: [...decision.evidence_ids, evidenceId]
    };
  });
  return {
    ...base,
    package_source: packageSource,
    chain: createTrustedArtifactChain(base.pbov_tracker, sourceTracker),
    composition_input: composition
  };
}

export function bachelorEvidence(suffix = "bachelor") {
  const credential: StructuredEducationCredential = {
    candidate_credential_id: branded<CandidateCredentialId>(`credential-${suffix}`),
    level: "BACHELOR",
    institution: traceable("Synthetic University"),
    program_name: traceable("法学"),
    normalized_program_codes: ["LAW"],
    academic_background: "LAW",
    major_identity_assertion: {
      semantic_code: "LAW_GENERAL",
      identity_label: original("法学"),
      credential_level: "BACHELOR",
      major_code: "LAW",
      provenance_state: "COMPLETE"
    },
    provenance: "SYNTHETIC_TEST",
    completeness: "COMPLETE"
  };
  return createPredicateCandidateEvidence({
    candidate_profile_id: CANDIDATE_ID,
    candidate_credential_id: credential.candidate_credential_id,
    value: { kind: "EDUCATION_CREDENTIAL", credential },
    original_value: original("synthetic education credential"),
    normalized_value: normalized("synthetic education credential"),
    observation_status: "CONFIRMED",
    observed_at: OBSERVED_AT,
    provenance: "SYNTHETIC_TEST",
    source_references: [{
      candidate_state_evidence_id: branded<CandidateStateEvidenceId>(`candidate-evidence-${suffix}`),
      evidence_class: "SYNTHETIC_TEST",
      captured_at: OBSERVED_AT,
      issuer: "trusted-chain-fixture"
    }]
  });
}

export function syntheticCandidateProfile(
  suffix = "candidate"
): StructuredCandidateProfile {
  const bachelorId = branded<CandidateCredentialId>(`credential-${suffix}-bachelor`);
  const masterId = branded<CandidateCredentialId>(`credential-${suffix}-master`);
  return {
    candidate_profile_id: CANDIDATE_ID,
    education: [{
      candidate_credential_id: bachelorId,
      level: "BACHELOR",
      institution: traceable("Synthetic Undergraduate University"),
      program_name: traceable("经济学"),
      normalized_program_codes: [],
      degree_type: "ACADEMIC",
      program_type: "OTHER",
      academic_background: "NON_LAW",
      graduation_year: 2025,
      major_identity_assertion: {
        semantic_code: "OTHER_EXPLICIT",
        identity_label: original("经济学"),
        credential_level: "BACHELOR",
        provenance_state: "COMPLETE"
      },
      provenance: "SYNTHETIC_TEST",
      completeness: "COMPLETE"
    }, {
      candidate_credential_id: masterId,
      level: "MASTER",
      institution: traceable("武汉大学"),
      program_name: traceable("法律硕士（非法学）"),
      normalized_program_codes: ["JURIS_MASTER_NON_LAW"],
      program_directory_references: [{
        directory_namespace: "研究生教育学科专业目录",
        directory_version: "2022年",
        program_code: "0351",
        program_label: normalized("法律")
      }],
      academic_degree_codes: ["MASTER_DEGREE"],
      degree_type: "PROFESSIONAL",
      program_type: "LAW_MASTER_NON_LAW",
      academic_background: "NON_LAW",
      graduation_year: 2027,
      major_identity_assertion: {
        semantic_code: "LAW_MASTER_NON_LAW",
        identity_label: original("法律硕士（非法学）"),
        credential_level: "MASTER",
        provenance_state: "COMPLETE"
      },
      provenance: "SYNTHETIC_TEST",
      completeness: "COMPLETE"
    }],
    target_graduation_year: 2027,
    candidate_cohorts: ["FRESH_GRADUATE"],
    professional_qualifications: [],
    languages: []
  };
}

export function materializeSyntheticCandidateEvidence(
  fixture: TrustedFixture,
  suffix = "candidate"
) {
  return fixture.chain.candidate_evidence.materialize_synthetic_fixture({
    candidate_profile: syntheticCandidateProfile(suffix),
    observed_at: OBSERVED_AT,
    effective_from: OBSERVED_AT
  });
}

function syntheticSource(
  suffix: string,
  requirementText: string,
  options: {
    readonly academic_program_directory?: {
      readonly directory_namespace: string;
      readonly directory_version: string;
    };
    readonly academic_program_directories?: Readonly<Record<string, {
      readonly directory_namespace: string;
      readonly directory_version: string;
    }>>;
  }
): PositionIdentityResolutionInput {
  const sourceDefinitionId = branded<SourceDefinitionId>("source-trust-chain-official");
  const endpointId = branded<RecruitmentEndpointId>(`endpoint-trust-chain-${suffix}`);
  const endpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: endpointId,
    source_definition_id: sourceDefinitionId,
    name: traceable("Trusted chain fixture endpoint"),
    coverage_regions: [{ raw_text: original("贵州省") }],
    locator: `fixture://trusted-chain/${suffix}`,
    request_method: "GET",
    content_kind: "FILE",
    adapter_key: "trusted-chain-fixture",
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
  const rawHash = branded<RawContentSha256>(sha256(`trusted-chain-raw-${suffix}`));
  const snapshot: Snapshot = {
    snapshot_id: branded<SnapshotId>(`snapshot-trust-chain-${suffix}`),
    recruitment_endpoint_id: endpointId,
    request_metadata: {
      locator: endpoint.locator,
      method: "GET",
      requested_at: OBSERVED_AT,
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
    observed_at: OBSERVED_AT,
    transport_status: "SUCCESS",
    raw_blob_id: branded<RawBlobId>(`sha256:${rawHash}`),
    content_hash: rawHash,
    content_length: 128
  };
  const record = createExtractedRecordV2(snapshot, {
    source_definition_id: sourceDefinitionId,
    identity_candidates: [{
      kind: "SOURCE_RECORD_ID",
      value: `Sheet1!row:${suffix}`,
      confidence: "HIGH"
    }],
    raw_source_record_id: `Sheet1!row:${suffix}`,
    raw_title: original("助理研究员"),
    raw_organization_name: original("贵州省法治研究服务保障中心"),
    raw_location_text: [original("贵州省")],
    raw_requirement_text: original(requirementText),
    announcement_url: "https://official.example.test/notice",
    recruitment_year: original("2025"),
    recruitment_context: {
      recruitment_plan: {
        identity_state: "CONFIRMED",
        official_identifier: original("PLAN-2025"),
        identifier_namespace: "official:recruitment-plan",
        evidence_locator: { kind: "SOURCE_RECORD", locator: "recruitment-plan" }
      },
      recruitment_batch: { applicability: "NOT_APPLICABLE" },
      position: {
        identity_state: "CONFIRMED",
        official_identifier: original(`001-${suffix}`),
        identifier_namespace: "official:plan-2025:position",
        evidence_locator: {
          kind: "SPREADSHEET",
          sheet: "Sheet1",
          cell_or_range: "E4",
          field_path: "position_code"
        }
      },
      opportunity: {
        identity_state: "CONFIRMED",
        official_identifier: original(`OPPORTUNITY-${suffix}`),
        identifier_namespace: "official:opportunity",
        evidence_locator: { kind: "SOURCE_RECORD", locator: "opportunity-id" }
      }
    },
    source_record_locator: {
      kind: "DOCUMENT",
      section: "Sheet1",
      text_locator: "A4:O4"
    },
    adapter_metadata: options.academic_program_directory
      || options.academic_program_directories
      ? {
          "approved-requirement-projection/1.0.0": {
            ...(options.academic_program_directory
              ? { academic_program_directory: options.academic_program_directory }
              : {}),
            ...(options.academic_program_directories
              ? { academic_program_directories: options.academic_program_directories }
              : {})
          }
        }
      : {},
    extraction: {
      extractor_name: "TrustedChainFixtureExtractor",
      extractor_version: "1.0.0",
      schema_version: "trusted-chain-extracted-record/2.0.0"
    }
  });
  const materialized = materializeSourceOccurrenceVersion({
    prepared: prepareSourceOccurrenceMaterialization(endpoint, record, snapshot),
    existing_occurrence: null,
    existing_versions: []
  });
  return {
    endpoint,
    occurrence: materialized.occurrence,
    version: materialized.version,
    extracted_record: record,
    snapshot
  };
}

function completeCompositionInput(
  source: PositionIdentityResolutionInput,
  opportunityVersionId: import("../../lib/ingestion").OpportunityVersionId,
  positionVersionId: import("../../lib/ingestion").PositionVersionId
): SourceCompositionInput {
  const sourceVersionId = source.version.source_occurrence_version_id;
  const snapshotId = source.snapshot.snapshot_id;
  const extractedRecordId = source.extracted_record.extracted_record_id;
  const suffix = sha256(opportunityVersionId);
  const evidenceId = branded<SourceCompositionEvidenceId>(`evidence-${suffix}`);
  const surfaceId = branded<SourceSurfaceId>(`surface-${suffix}`);
  const bindingId = branded<SourceSurfaceBindingId>(`binding-${suffix}`);
  const authorityId = branded<AuthorityAssertionId>(`authority-${suffix}`);
  const selectionId = branded<SourceVersionSelectionId>(`selection-${suffix}`);
  const entryId = branded<ExpectedSurfaceManifestEntryId>(`entry-${suffix}`);
  const boundaryId = branded<DiscoveryBoundaryId>(`boundary-${suffix}`);
  const locator = {
    kind: "SPREADSHEET" as const,
    sheet: "Sheet1",
    cell_or_range: "A4:O4",
    field_path: "position"
  };
  const context = {
    source_occurrence_version_id: sourceVersionId,
    snapshot_id: snapshotId,
    extracted_record_id: extractedRecordId,
    observed_at: source.snapshot.observed_at,
    resolver_version: "trusted-chain-binding/1.0.0"
  };
  return {
    opportunity_version_id: opportunityVersionId,
    composition_as_of: source.snapshot.observed_at,
    discovery_boundary: {
      discovery_boundary_id: boundaryId,
      opportunity_version_id: opportunityVersionId,
      boundary_kind: "POSITION_PACKAGE",
      initiating_source_surface_ids: [surfaceId],
      source_metadata_references: [source.endpoint.recruitment_endpoint_id],
      discovery_scope: "validated Position-bound requirement package",
      admissible_relation_kinds: ["ORIGINAL", "SUPPLEMENT", "CORRECTION"],
      evidence_ids: [evidenceId],
      composition_as_of: source.snapshot.observed_at,
      observed_at: source.snapshot.observed_at,
      extractor_version: "trusted-chain-discovery/1.0.0",
      discovery_resolver_version: "trusted-chain-discovery/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    inventory: {
      source_package_inventory_id: branded<SourcePackageInventoryId>(`inventory-${suffix}`),
      discovery_boundary_id: boundaryId,
      composition_as_of: source.snapshot.observed_at,
      discovered_source_surface_ids: [surfaceId],
      expected_surface_entries: [{
        expected_surface_manifest_entry_id: entryId,
        expected_surface_key: `position-row-${suffix}`,
        source_surface_id: surfaceId,
        expectedness: "REQUIRED",
        requirement_level: "REQUIREMENT_BEARING",
        authority_status: "OFFICIAL_AUTHORITATIVE",
        authority_assertion_id: authorityId,
        binding_status: "RESOLVED",
        material_binding_ids: [bindingId],
        version_selection_status: "RESOLVED",
        source_version_selection_id: selectionId,
        coverage_status: "COVERED",
        resolution_status: "RESOLVED",
        target_scope: opportunityVersionId,
        evidence_ids: [evidenceId]
      }],
      inventory_completeness_status: "CLOSED",
      unexpected_surface_dispositions: [],
      discovery_resolver_version: "trusted-chain-discovery/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    evidence_registry: [{
      source_composition_evidence_id: evidenceId,
      snapshot_id: snapshotId,
      extracted_record_id: extractedRecordId,
      source_occurrence_version_id: sourceVersionId,
      locator,
      observed_at: source.snapshot.observed_at,
      extractor_version: source.version.materialization.extractor_version
    }],
    source_surfaces: [{
      source_surface_id: surfaceId,
      surface_kind: "POSITION_TABLE_ROW",
      source_occurrence_version_id: sourceVersionId,
      snapshot_id: snapshotId,
      extracted_record_id: extractedRecordId,
      locator,
      surface_content_hash: source.version.semantic_hash,
      effective_period: { effective_from: source.version.first_observed_at },
      observed_at: source.snapshot.observed_at,
      surface_status: "PARSED",
      composition_role: "PRIMARY",
      target_scope: opportunityVersionId,
      evidence_ids: [evidenceId],
      extractor_version: source.version.materialization.extractor_version,
      parser_version: "trusted-chain-parser/1.0.0",
      resolver_version: "trusted-chain-resolver/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_surface_bindings: [{
      source_surface_binding_id: bindingId,
      source_surface_id: surfaceId,
      target_type: "OPPORTUNITY_VERSION",
      target_id: opportunityVersionId,
      target_version_id: opportunityVersionId,
      binding_kind: "SURFACE_DECLARATION",
      binding_status: "RESOLVED",
      evidence_ids: [evidenceId],
      created_context: context,
      observed_context: context,
      locator,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    authority_assertions: [{
      authority_assertion_id: authorityId,
      asserted_source_surface_id: surfaceId,
      authority_basis_source_surface_id: surfaceId,
      authority_basis_binding_id: bindingId,
      issuer: "synthetic-official-publisher",
      authority_state: "OFFICIAL_AUTHORITATIVE",
      target_scope: opportunityVersionId,
      effective_period: { effective_from: source.version.first_observed_at },
      evidence_ids: [evidenceId],
      resolver_version: "trusted-chain-authority/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_version_selections: [{
      source_version_selection_id: selectionId,
      source_identity: source.occurrence.source_occurrence_id,
      target_scope: opportunityVersionId,
      candidate_source_surface_ids: [surfaceId],
      selected_source_surface_id: surfaceId,
      excluded_source_surface_ids: [],
      selection_status: "RESOLVED",
      effective_period: { effective_from: source.version.first_observed_at },
      observation_time: source.snapshot.observed_at,
      evidence_ids: [evidenceId],
      resolver_version: "trusted-chain-selection/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    surface_revision_relations: [],
    precedence_decisions: [{
      precedence_decision_id: branded<SourcePrecedenceDecisionId>(`precedence-${suffix}`),
      selected_source_surface_ids: [surfaceId],
      excluded_source_surface_ids: [],
      applicable_scope: opportunityVersionId,
      effective_period: { effective_from: source.version.first_observed_at },
      composition_as_of: source.snapshot.observed_at,
      authority_assertion_ids: [authorityId],
      precedence_rule: "EXPLICIT_TARGET_SCOPE",
      evidence_ids: [evidenceId],
      decision_status: "RESOLVED",
      resolver_version: "trusted-chain-precedence/1.0.0",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_conflicts: [],
    extractor_version: source.version.materialization.extractor_version,
    parser_version: "trusted-chain-parser/1.0.0",
    discovery_resolver_version: "trusted-chain-discovery/1.0.0",
    composition_resolver_version: "trusted-chain-composer/1.0.0",
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    serialization_version: "trusted-chain-composition-serialization/1.0.0"
  };
}

function original(text: string) {
  return { text, encoding: "UTF-8" as const };
}

function normalized(text: string) {
  return {
    text,
    unicode_form: "NFKC" as const,
    normalizer_version: "trusted-chain-test-normalizer/1.0.0",
    operations: ["UNICODE_NORMALIZATION" as const]
  };
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
