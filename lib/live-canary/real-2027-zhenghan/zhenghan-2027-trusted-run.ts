import { createHash } from "node:crypto";

import {
  ELIGIBILITY_ASSESSMENT_RULE_VERSION,
  PREDICATE_RESOLUTION_RULE_VERSION,
  SOURCE_COMPOSITION_SCHEMA_VERSION,
  UTF8_TEXT_ENCODING,
  createCandidateEvidenceSourceManifest,
  type CandidateCredentialId,
  type CandidateProfileId,
  type CandidateEvidenceIssuanceResult,
  type AuthorityAssertionId,
  type DiscoveryBoundaryId,
  type ExpectedSurfaceManifestEntryId,
  type IsoDateTime,
  type OpportunityCandidateId,
  type OpportunityVersionId,
  type PositionBoundEligibilityAssessmentResult,
  type PositionBoundPredicateResolutionResult,
  type PositionVersionId,
  type PresentationDecision,
  type PresentationReadModel,
  type RecallDispositionId,
  type SourceCompositionEvidenceId,
  type SourceCompositionInput,
  type SourceCompositionResult,
  type SourcePackageInventoryId,
  type SourcePrecedenceDecisionId,
  type SourceSurfaceBindingId,
  type SourceSurfaceId,
  type SourceVersionSelectionId,
  type StructuredEducationCredential,
  type TrustedSourceOccurrenceArtifact
} from "../../ingestion";
import type { PositionBoundRequirementSetMaterializationResult } from
  "../../ingestion/pipeline/position-bound-requirement-set";
import type {
  ZeroCostProductionRunInput,
  ZeroCostProductionTrustedRunContext
} from "../../production-persistence";
import { canonicalSerialize } from
  "../../ingestion/normalization/canonical-artifact-registry";
import {
  ZHENGHAN_2027_ADAPTER_KEY,
  ZHENGHAN_2027_ANNOUNCEMENT_URL,
  ZHENGHAN_2027_DETAIL_URL
} from "./zhenghan-2027-source";

const CANDIDATE_PROFILE_ID =
  "candidate-profile:zhenghan-2027-canary-asserted" as CandidateProfileId;
const COMPOSITION_VERSION = "zhenghan-2027-source-composition/1.0.0";

export interface RealOfficial2027TrustedRunConfig {
  readonly report_name: string;
  readonly candidate_profile_id: CandidateProfileId;
  readonly candidate_manifest_stream_id: string;
  readonly candidate_claim_locator: string;
  readonly candidate_actor: string;
  readonly candidate_evidence_prefix: string;
  readonly package_source_record_id: string;
  readonly position_source_record_ids: readonly string[];
  readonly publisher_subject_identity: string;
  readonly publisher_subject_display_name: string;
  readonly adapter_key: string;
  readonly source_urls: readonly string[];
  readonly composition_version: string;
  readonly discovery_scope: string;
  readonly package_selector: string;
  readonly package_field_path: string;
  readonly authority_issuer: string;
}

const ZHENGHAN_TRUSTED_RUN_CONFIG: RealOfficial2027TrustedRunConfig = {
  report_name: "Zhenghan",
  candidate_profile_id: CANDIDATE_PROFILE_ID,
  candidate_manifest_stream_id: "zhenghan-2027-canary-candidate-assertion",
  candidate_claim_locator: "candidate-claim://zhenghan-2027-canary/education",
  candidate_actor: "user-approved-real-2027-canary",
  candidate_evidence_prefix: "zhenghan-canary",
  package_source_record_id: "post-2782:announcement-package",
  position_source_record_ids: [
    "post-2790:dispute-resolution-lawyer",
    "post-2790:campus-long-term-intern-2027",
    "post-2790:short-term-intern-2028-plus"
  ],
  publisher_subject_identity: "organization-cn-zhenghan-law-firm",
  publisher_subject_display_name: "上海虹桥正瀚律师事务所",
  adapter_key: ZHENGHAN_2027_ADAPTER_KEY,
  source_urls: [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL],
  composition_version: COMPOSITION_VERSION,
  discovery_scope: "Zhenghan 2027 announcement and same-day recruitment detail",
  package_selector: "article#post-2782 .entry-content",
  package_field_path: "announcement_body",
  authority_issuer: "上海虹桥正瀚律师事务所"
};

export interface Zhenghan2027PositionRunReport {
  readonly source_record_id: string;
  readonly extracted_record_id: string;
  readonly source_occurrence_version_id: string;
  readonly opportunity_candidate_id: string;
  readonly recall_disposition_id: string;
  readonly position_id: string;
  readonly position_version_id: string;
  readonly opportunity_version_id: string;
  readonly source_composition_id: string;
  readonly source_composition_status: string;
  readonly relevance_assessment_id: string;
  readonly relevance_state: string;
  readonly requirement_projection_id: string;
  readonly requirement_set_version_id: string;
  readonly raw_requirement_clause_count: number;
  readonly requirement_observation_count: number;
  readonly requirement_fact_count: number;
  readonly unresolved_requirement_clauses: readonly {
    readonly status: string;
    readonly clause_role: string;
    readonly text: string | null;
  }[];
  readonly requirement_completeness: string;
  readonly requirement_blocker_codes: readonly string[];
  readonly predicate_resolution_execution_status: string;
  readonly predicate_resolution_blocker_code: string | null;
  readonly predicate_resolution_ids: readonly string[];
  readonly predicate_resolution_statuses: readonly string[];
  readonly eligibility_execution_status: string;
  readonly eligibility_blocker_code: string | null;
  readonly eligibility_assessment_id: string | null;
  readonly eligibility_result: string | null;
  readonly presentation_decision_id: string;
  readonly presentation_status: string;
  readonly presentation_decision_bytes: string;
  readonly presentation_read_model_id: string;
  readonly presentation_read_model_hash: string;
  readonly presentation_read_model_bytes: string;
}

export interface Zhenghan2027TrustedRunReport {
  readonly candidate_evidence_manifest_id: string;
  readonly candidate_evidence_ids: readonly string[];
  readonly candidate_evidence_provenance: "CANDIDATE_ASSERTED";
  readonly positions: readonly Zhenghan2027PositionRunReport[];
}

export function createZhenghan2027TrustedRun(observedAt: IsoDateTime): {
  readonly execute: ZeroCostProductionRunInput["execute_trusted_chain"];
  report(): Zhenghan2027TrustedRunReport;
} {
  return createRealOfficial2027TrustedRun(observedAt, ZHENGHAN_TRUSTED_RUN_CONFIG);
}

export function createRealOfficial2027TrustedRun(
  observedAt: IsoDateTime,
  config: RealOfficial2027TrustedRunConfig
): {
  readonly execute: ZeroCostProductionRunInput["execute_trusted_chain"];
  report(): Zhenghan2027TrustedRunReport;
} {
  let report: Zhenghan2027TrustedRunReport | null = null;
  return {
    async execute(context) {
      const sources = trustedSources(context);
      const packageSource = requireSource(sources, config.package_source_record_id);
      const positionSources = config.position_source_record_ids.map((sourceRecordId) => {
        return requireSource(sources, sourceRecordId);
      });
      const candidateEvidence = await issueCandidateAssertion(
        context,
        observedAt,
        config
      );
      const positions: Zhenghan2027PositionRunReport[] = [];
      for (const source of positionSources) {
        positions.push(await materializePosition({
          context,
          package_source: packageSource,
          position_source: source,
          candidate_evidence: candidateEvidence,
          observed_at: observedAt,
          config
        }));
      }
      report = {
        candidate_evidence_manifest_id:
          candidateEvidence.source_manifest.candidate_evidence_source_manifest_id,
        candidate_evidence_ids: candidateEvidence.evidence_ids,
        candidate_evidence_provenance: "CANDIDATE_ASSERTED",
        positions
      };
    },
    report() {
      if (!report) throw new Error(`${config.report_name} trusted run has not completed`);
      return structuredClone(report);
    }
  };
}

async function materializePosition(input: {
  readonly context: ZeroCostProductionTrustedRunContext;
  readonly package_source: TrustedSourceOccurrenceArtifact;
  readonly position_source: TrustedSourceOccurrenceArtifact;
  readonly candidate_evidence: CandidateEvidenceIssuanceResult;
  readonly observed_at: IsoDateTime;
  readonly config: RealOfficial2027TrustedRunConfig;
}): Promise<Zhenghan2027PositionRunReport> {
  const { context, position_source: source, observed_at: observedAt } = input;
  const sourceRecordId = source.extracted_record.raw_source_record_id;
  if (!sourceRecordId) throw new Error("Position source record ID is missing");
  const registration = await context.execute({
    kind: "OPPORTUNITY_REGISTER",
    input: {
      source_definition_id: source.extracted_record.source_definition_id,
      recruitment_endpoint_id: source.endpoint.recruitment_endpoint_id,
      discovery_locator: opportunityDiscoveryLocator(source, sourceRecordId),
      snapshot_id: source.snapshot.snapshot_id,
      extracted_record_id: source.extracted_record.extracted_record_id,
      source_occurrence_version_id: source.version.source_occurrence_version_id,
      publisher_subject: {
        subject_identity: input.config.publisher_subject_identity,
        subject_display_name: input.config.publisher_subject_display_name,
        evidence_id: source.version.source_occurrence_version_id
      },
      discovery_evidence_ids: [
        source.version.source_occurrence_version_id,
        source.snapshot.raw_blob_id ?? source.snapshot.snapshot_id
      ],
      first_observed_at: source.snapshot.observed_at,
      initial_disposition: {
        status: "RETAINED",
        reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
        evidence_ids: [source.version.source_occurrence_version_id],
        decided_at: observedAt
      }
    }
  }) as RecallRegistrationResult;
  const position = await context.execute({
    kind: "POSITION_VERSION_MATERIALIZE",
    source_references: [{
      source_occurrence_version_id: source.version.source_occurrence_version_id
    }]
  }) as PositionMaterializationResult;
  const opportunity = await context.execute({
    kind: "PBOV_MATERIALIZE",
    position_version_id: position.position_version.position_version_id as PositionVersionId,
    source_references: [{
      source_occurrence_version_id: source.version.source_occurrence_version_id
    }]
  }) as OpportunityMaterializationResult;
  const composition = await context.execute({
    kind: "SOURCE_COMPOSITION_MATERIALIZE",
    input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      composition_input: compositionInput(
        input.package_source,
        source,
        opportunity.opportunity_version.opportunity_version_id,
        input.config
      )
    }
  }) as SourceCompositionResult;
  if (composition.status !== "COMPLETE") {
    throw new Error(`EVIDENCE_BLOCKED: SourceComposition is ${composition.status}`);
  }
  const relevance = await context.execute({
    kind: "LEGAL_RELEVANCE_ASSESS",
    input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      source_composition_id: composition.source_composition_id,
      created_at: observedAt
    }
  }) as RelevanceResult;
  const projection = await context.execute({
    kind: "REQUIREMENT_PROJECTION_MATERIALIZE",
    source_composition_id: composition.source_composition_id
  }) as RequirementProjectionResult;
  const requirement = await context.execute({
    kind: "REQUIREMENT_SET_MATERIALIZE",
    source_composition_id: composition.source_composition_id
  }) as PositionBoundRequirementSetMaterializationResult;
  const predicates = await context.execute({
    kind: "PREDICATE_RESOLUTION_MATERIALIZE",
    input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      source_composition_id: composition.source_composition_id,
      requirement_set_version_id: requirement.requirement_set_version_id,
      candidate_profile_id: input.config.candidate_profile_id,
      candidate_evidence_ids: input.candidate_evidence.evidence_ids,
      as_of: observedAt,
      predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
    }
  }) as PositionBoundPredicateResolutionResult;
  const eligibility = await context.execute({
    kind: "ELIGIBILITY_MATERIALIZE",
    input: {
      opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
      source_composition_id: composition.source_composition_id,
      requirement_set_version_id: requirement.requirement_set_version_id,
      predicate_resolution_ids: predicates.resolutions.map((item) => {
        return item.predicate_resolution_id;
      }),
      candidate_profile_id: input.config.candidate_profile_id,
      candidate_evidence_ids: input.candidate_evidence.evidence_ids,
      as_of: observedAt,
      predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
      assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
    }
  }) as PositionBoundEligibilityAssessmentResult;
  const eligibilityAssessment = eligibility.status === "ASSESSMENT"
    ? eligibility.assessment
    : null;
  const decision = await context.execute({
    kind: "PRESENTATION_DECIDE",
    input: {
      opportunity_candidate_id: registration.candidate.opportunity_candidate_id,
      recall_disposition_id: registration.disposition.recall_disposition_id,
      relevance_assessment_id: relevance.assessment.assessment_id,
      eligibility_assessment_id:
        eligibilityAssessment?.eligibility_assessment_id ?? null,
      decided_at: observedAt
    }
  }) as PresentationDecisionResult;
  const readModel = await context.execute({
    kind: "PRESENTATION_READ_MODEL_MATERIALIZE",
    presentation_decision_id: decision.decision.presentation_decision_id
  }) as PresentationReadModelResult;
  return {
    source_record_id: sourceRecordId,
    extracted_record_id: source.extracted_record.extracted_record_id,
    source_occurrence_version_id: source.version.source_occurrence_version_id,
    opportunity_candidate_id: registration.candidate.opportunity_candidate_id,
    recall_disposition_id: registration.disposition.recall_disposition_id,
    position_id: position.position.position_id,
    position_version_id: position.position_version.position_version_id,
    opportunity_version_id: opportunity.opportunity_version.opportunity_version_id,
    source_composition_id: composition.source_composition_id,
    source_composition_status: composition.status,
    relevance_assessment_id: relevance.assessment.assessment_id,
    relevance_state: relevance.assessment.assessment_state,
    requirement_projection_id: projection.requirement_projection_id,
    requirement_set_version_id: requirement.requirement_set_version_id,
    raw_requirement_clause_count:
      source.extracted_record.raw_requirement_text?.text.split(/\r?\n/u)
        .filter((clause) => clause.trim().length > 0).length ?? 0,
    requirement_observation_count:
      requirement.requirement_set.observation_registry.length,
    requirement_fact_count: requirement.requirement_set.fact_registry.length,
    unresolved_requirement_clauses:
      requirement.requirement_set.observation_registry.filter((observation) => {
        return observation.status !== "CONFIRMED_REQUIREMENT";
      }).map((observation) => ({
        status: observation.status,
        clause_role: observation.clause_role,
        text: observation.original_clause?.text ?? null
      })),
    requirement_completeness: requirement.requirement_set.completeness.status,
    requirement_blocker_codes: requirement.requirement_set.completeness.blockers.map(
      (blocker) => blocker.code
    ),
    predicate_resolution_execution_status: predicates.status,
    predicate_resolution_blocker_code: predicates.status === "BLOCKED"
      ? predicates.blocker_code : null,
    predicate_resolution_ids: predicates.resolutions.map((item) => {
      return item.predicate_resolution_id;
    }),
    predicate_resolution_statuses: predicates.resolutions.map((item) => {
      return item.resolution_status;
    }),
    eligibility_execution_status: eligibility.status,
    eligibility_blocker_code: eligibility.status === "BLOCKED"
      ? eligibility.blocker_code
      : eligibility.status === "NOT_ALLOWED" ? eligibility.reason : null,
    eligibility_assessment_id:
      eligibilityAssessment?.eligibility_assessment_id ?? null,
    eligibility_result: eligibilityAssessment?.result ?? null,
    presentation_decision_id: decision.decision.presentation_decision_id,
    presentation_status: decision.decision.status,
    presentation_decision_bytes: canonicalSerialize(decision.decision),
    presentation_read_model_id: readModel.read_model.presentation_read_model_id,
    presentation_read_model_hash: readModel.read_model.integrity_hash,
    presentation_read_model_bytes: canonicalSerialize(readModel.read_model)
  };
}

async function issueCandidateAssertion(
  context: ZeroCostProductionTrustedRunContext,
  observedAt: IsoDateTime,
  config: RealOfficial2027TrustedRunConfig
) {
  const manifest = createCandidateEvidenceSourceManifest({
    manifest_stream_id: config.candidate_manifest_stream_id,
    candidate_profile_id: config.candidate_profile_id,
    evidence_class: "CANDIDATE_ASSERTED",
    scope: "PRODUCTION",
    revision: 1,
    supersedes_manifest_id: null,
    locator: {
      kind: "CANDIDATE_CLAIM",
      value: config.candidate_claim_locator
    },
    evidence_object: null,
    verifier: null,
    actor: config.candidate_actor,
    issued_at: observedAt,
    provenance_references: [
      `${config.candidate_evidence_prefix}:candidate-assertion:non-law-bachelor`,
      `${config.candidate_evidence_prefix}:candidate-assertion:juris-master-non-law`,
      `${config.candidate_evidence_prefix}:candidate-assertion:graduation-year-2027`
    ]
  });
  const bachelor = assertedCredential({
    id: `credential-${config.candidate_evidence_prefix}-bachelor`,
    level: "BACHELOR",
    program: "本科非法学（具体专业未提供）",
    programType: "OTHER",
    background: "NON_LAW",
    graduationYear: undefined,
    semanticCode: "OTHER_EXPLICIT"
  });
  const master = assertedCredential({
    id: `credential-${config.candidate_evidence_prefix}-master`,
    level: "MASTER",
    program: "法律硕士（非法学）",
    programType: "LAW_MASTER_NON_LAW",
    background: "NON_LAW",
    graduationYear: 2027,
    semanticCode: "LAW_MASTER_NON_LAW"
  });
  return await context.execute({
    kind: "CANDIDATE_EVIDENCE_ISSUE",
    input: {
      source_manifest: manifest,
      evidence: [
        ...[bachelor, master].map((credential) => ({
          candidate_credential_id: credential.candidate_credential_id,
          value: { kind: "EDUCATION_CREDENTIAL" as const, credential },
          original_value: credential.program_name.original,
          normalized_value: normalized(
            credential.program_name.original.text,
            config.candidate_evidence_prefix
          ),
          observation_status: "INSUFFICIENT" as const,
          observed_at: observedAt
        })),
        {
          value: { kind: "TARGET_GRADUATION_YEAR" as const, graduation_year: 2027 },
          original_value: original("候选人自述目标毕业年份：2027"),
          normalized_value: normalized("2027", config.candidate_evidence_prefix),
          observation_status: "INSUFFICIENT" as const,
          observed_at: observedAt
        }
      ]
    }
  }) as CandidateEvidenceIssuanceResult;
}

function assertedCredential(input: {
  readonly id: string;
  readonly level: "BACHELOR" | "MASTER";
  readonly program: string;
  readonly programType: "LAW_MASTER_NON_LAW" | "OTHER";
  readonly background: "NON_LAW";
  readonly graduationYear: number | undefined;
  readonly semanticCode: "LAW_MASTER_NON_LAW" | "OTHER_EXPLICIT";
}): StructuredEducationCredential {
  return {
    candidate_credential_id: input.id as CandidateCredentialId,
    level: input.level,
    institution: traceable("候选人自述院校（未核验）"),
    program_name: traceable(input.program),
    normalized_program_codes: input.programType === "LAW_MASTER_NON_LAW"
      ? ["JURIS_MASTER_NON_LAW" as never] : [],
    degree_type: input.level === "MASTER" ? "PROFESSIONAL" : "ACADEMIC",
    program_type: input.programType,
    academic_background: input.background,
    ...(input.graduationYear ? { graduation_year: input.graduationYear } : {}),
    major_identity_assertion: {
      semantic_code: input.semanticCode,
      identity_label: original(input.program),
      credential_level: input.level,
      provenance_state: "PARTIAL"
    },
    provenance: "CANDIDATE_ASSERTED",
    completeness: "PARTIAL"
  };
}

function trustedSources(context: ZeroCostProductionTrustedRunContext) {
  return context.source_occurrences.map((item) => item as TrustedSourceOccurrenceArtifact);
}

function requireSource(
  sources: readonly TrustedSourceOccurrenceArtifact[],
  sourceRecordId: string
) {
  const source = sources.find((item) => {
    return item.extracted_record.raw_source_record_id === sourceRecordId;
  });
  if (!source) throw new Error(`Trusted source occurrence is unavailable: ${sourceRecordId}`);
  return source;
}

function opportunityDiscoveryLocator(
  source: TrustedSourceOccurrenceArtifact,
  sourceRecordId: string
) {
  return `${source.snapshot.request_metadata.locator}#source-record=${encodeURIComponent(
    sourceRecordId
  )}`;
}

function compositionInput(
  packageSource: TrustedSourceOccurrenceArtifact,
  positionSource: TrustedSourceOccurrenceArtifact,
  opportunityVersionId: OpportunityVersionId,
  config: RealOfficial2027TrustedRunConfig
): SourceCompositionInput {
  const seed = sha256Text(`${opportunityVersionId}|${positionSource.version.semantic_hash}`);
  const packageEvidenceId = id<SourceCompositionEvidenceId>(
    "source-composition-evidence", `${seed}:package`
  );
  const positionEvidenceId = id<SourceCompositionEvidenceId>(
    "source-composition-evidence", `${seed}:position`
  );
  const packageSurfaceId = id<SourceSurfaceId>("source-surface", `${seed}:package`);
  const positionSurfaceId = id<SourceSurfaceId>("source-surface", `${seed}:position`);
  const packageBindingId = id<SourceSurfaceBindingId>(
    "source-surface-binding", `${seed}:package`
  );
  const positionBindingId = id<SourceSurfaceBindingId>(
    "source-surface-binding", `${seed}:position`
  );
  const packageAuthorityId = id<AuthorityAssertionId>(
    "authority-assertion", `${seed}:package`
  );
  const positionAuthorityId = id<AuthorityAssertionId>(
    "authority-assertion", `${seed}:position`
  );
  const packageSelectionId = id<SourceVersionSelectionId>(
    "source-version-selection", `${seed}:package`
  );
  const positionSelectionId = id<SourceVersionSelectionId>(
    "source-version-selection", `${seed}:position`
  );
  const boundaryId = id<DiscoveryBoundaryId>("discovery-boundary", seed);
  const packageLocator = {
    kind: "HTML" as const,
    selector: config.package_selector,
    field_path: config.package_field_path
  };
  const positionLocator = {
    kind: "HTML" as const,
    selector: positionSource.extracted_record.source_record_locator.kind === "HTML"
      ? positionSource.extracted_record.source_record_locator.selector
      : "article#post-2790 .entry-content",
    field_path: "position_requirement"
  };
  const packageContext = bindingContext(packageSource, config.composition_version);
  const positionContext = bindingContext(positionSource, config.composition_version);
  return {
    opportunity_version_id: opportunityVersionId,
    composition_as_of: positionSource.snapshot.observed_at,
    discovery_boundary: {
      discovery_boundary_id: boundaryId,
      opportunity_version_id: opportunityVersionId,
      boundary_kind: "ANNOUNCEMENT_PACKAGE",
      initiating_source_surface_ids: [packageSurfaceId, positionSurfaceId],
      source_metadata_references: [...config.source_urls],
      discovery_scope: config.discovery_scope,
      admissible_relation_kinds: ["ORIGINAL", "SUPPLEMENT"],
      evidence_ids: [packageEvidenceId, positionEvidenceId],
      composition_as_of: positionSource.snapshot.observed_at,
      observed_at: positionSource.snapshot.observed_at,
      extractor_version: config.adapter_key,
      discovery_resolver_version: config.composition_version,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    inventory: {
      source_package_inventory_id: id<SourcePackageInventoryId>(
        "source-package-inventory", seed
      ),
      discovery_boundary_id: boundaryId,
      composition_as_of: positionSource.snapshot.observed_at,
      discovered_source_surface_ids: [packageSurfaceId, positionSurfaceId],
      expected_surface_entries: [{
        expected_surface_manifest_entry_id: id<ExpectedSurfaceManifestEntryId>(
          "expected-surface", `${seed}:package`
        ),
        expected_surface_key: config.source_urls[0]!,
        source_surface_id: packageSurfaceId,
        expectedness: "REQUIRED",
        requirement_level: "NON_REQUIREMENT_REFERENCE",
        authority_status: "OFFICIAL_AUTHORITATIVE",
        authority_assertion_id: packageAuthorityId,
        binding_status: "RESOLVED",
        material_binding_ids: [packageBindingId],
        version_selection_status: "RESOLVED",
        source_version_selection_id: packageSelectionId,
        coverage_status: "COVERED",
        resolution_status: "RESOLVED",
        target_scope: opportunityVersionId,
        evidence_ids: [packageEvidenceId]
      }, {
        expected_surface_manifest_entry_id: id<ExpectedSurfaceManifestEntryId>(
          "expected-surface", `${seed}:position`
        ),
        expected_surface_key:
          `${config.source_urls.at(-1)!}#${positionSource.extracted_record.raw_source_record_id}`,
        source_surface_id: positionSurfaceId,
        expectedness: "REQUIRED",
        requirement_level: "REQUIREMENT_BEARING",
        authority_status: "OFFICIAL_AUTHORITATIVE",
        authority_assertion_id: positionAuthorityId,
        binding_status: "RESOLVED",
        material_binding_ids: [positionBindingId],
        version_selection_status: "RESOLVED",
        source_version_selection_id: positionSelectionId,
        coverage_status: "COVERED",
        resolution_status: "RESOLVED",
        target_scope: opportunityVersionId,
        evidence_ids: [positionEvidenceId]
      }],
      inventory_completeness_status: "CLOSED",
      unexpected_surface_dispositions: [],
      discovery_resolver_version: config.composition_version,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    evidence_registry: [
      compositionEvidence(packageSource, packageEvidenceId, packageLocator),
      compositionEvidence(positionSource, positionEvidenceId, positionLocator)
    ],
    source_surfaces: [{
      source_surface_id: packageSurfaceId,
      surface_kind: "ANNOUNCEMENT_BODY",
      source_occurrence_version_id: packageSource.version.source_occurrence_version_id,
      snapshot_id: packageSource.snapshot.snapshot_id,
      extracted_record_id: packageSource.extracted_record.extracted_record_id,
      locator: packageLocator,
      surface_content_hash: packageSource.version.semantic_hash,
      effective_period: { effective_from: packageSource.version.first_observed_at },
      observed_at: packageSource.snapshot.observed_at,
      surface_status: "PARSED",
      composition_role: "PRIMARY",
      target_scope: opportunityVersionId,
      evidence_ids: [packageEvidenceId],
      extractor_version: packageSource.version.materialization.extractor_version,
      parser_version: config.composition_version,
      resolver_version: config.composition_version,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }, {
      source_surface_id: positionSurfaceId,
      surface_kind: "OTHER_REQUIREMENT_SURFACE",
      source_occurrence_version_id: positionSource.version.source_occurrence_version_id,
      snapshot_id: positionSource.snapshot.snapshot_id,
      extracted_record_id: positionSource.extracted_record.extracted_record_id,
      locator: positionLocator,
      surface_content_hash: positionSource.version.semantic_hash,
      effective_period: { effective_from: positionSource.version.first_observed_at },
      observed_at: positionSource.snapshot.observed_at,
      surface_status: "PARSED",
      composition_role: "SUPPLEMENT",
      target_scope: opportunityVersionId,
      evidence_ids: [positionEvidenceId],
      extractor_version: positionSource.version.materialization.extractor_version,
      parser_version: config.composition_version,
      resolver_version: config.composition_version,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_surface_bindings: [
      binding(packageBindingId, packageSurfaceId, opportunityVersionId,
        "ANNOUNCEMENT_UNIFORM", packageEvidenceId, packageContext, packageLocator,
        config.composition_version),
      binding(positionBindingId, positionSurfaceId, opportunityVersionId,
        "SURFACE_DECLARATION", positionEvidenceId, positionContext, positionLocator,
        config.composition_version)
    ],
    authority_assertions: [
      authority(packageAuthorityId, packageSurfaceId, packageBindingId,
        opportunityVersionId, packageEvidenceId, packageSource, config),
      authority(positionAuthorityId, positionSurfaceId, positionBindingId,
        opportunityVersionId, positionEvidenceId, positionSource, config)
    ],
    source_version_selections: [
      selection(packageSelectionId, packageSurfaceId, packageSource,
        opportunityVersionId, packageEvidenceId, config.composition_version),
      selection(positionSelectionId, positionSurfaceId, positionSource,
        opportunityVersionId, positionEvidenceId, config.composition_version)
    ],
    surface_revision_relations: [],
    precedence_decisions: [{
      precedence_decision_id: id<SourcePrecedenceDecisionId>(
        "source-precedence", seed
      ),
      selected_source_surface_ids: [packageSurfaceId, positionSurfaceId],
      excluded_source_surface_ids: [],
      applicable_scope: opportunityVersionId,
      effective_period: { effective_from: packageSource.version.first_observed_at },
      composition_as_of: positionSource.snapshot.observed_at,
      authority_assertion_ids: [packageAuthorityId, positionAuthorityId],
      precedence_rule: "SAME_OFFICIAL_PUBLISHER_ANNOUNCEMENT_PLUS_DETAIL",
      evidence_ids: [packageEvidenceId, positionEvidenceId],
      decision_status: "RESOLVED",
      resolver_version: config.composition_version,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_conflicts: [],
    extractor_version: config.adapter_key,
    parser_version: config.composition_version,
    discovery_resolver_version: config.composition_version,
    composition_resolver_version: config.composition_version,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    serialization_version: "trusted-chain-composition-serialization/1.0.0"
  };
}

function compositionEvidence(
  source: TrustedSourceOccurrenceArtifact,
  evidenceId: string,
  locator: { readonly kind: "HTML"; readonly selector: string;
    readonly field_path: string }
) {
  return {
    source_composition_evidence_id: evidenceId as never,
    snapshot_id: source.snapshot.snapshot_id,
    extracted_record_id: source.extracted_record.extracted_record_id,
    source_occurrence_version_id: source.version.source_occurrence_version_id,
    locator,
    observed_at: source.snapshot.observed_at,
    extractor_version: source.version.materialization.extractor_version
  };
}

function bindingContext(
  source: TrustedSourceOccurrenceArtifact,
  compositionVersion: string
) {
  return {
    source_occurrence_version_id: source.version.source_occurrence_version_id,
    snapshot_id: source.snapshot.snapshot_id,
    extracted_record_id: source.extracted_record.extracted_record_id,
    observed_at: source.snapshot.observed_at,
    resolver_version: compositionVersion
  };
}

function binding(
  bindingId: string,
  surfaceId: string,
  opportunityVersionId: OpportunityVersionId,
  kind: "ANNOUNCEMENT_UNIFORM" | "SURFACE_DECLARATION",
  evidenceId: string,
  context: ReturnType<typeof bindingContext>,
  locator: { readonly kind: "HTML"; readonly selector: string;
    readonly field_path: string },
  compositionVersion: string
) {
  return {
    source_surface_binding_id: bindingId as never,
    source_surface_id: surfaceId as never,
    target_type: "OPPORTUNITY_VERSION" as const,
    target_id: opportunityVersionId,
    target_version_id: opportunityVersionId,
    binding_kind: kind,
    binding_status: "RESOLVED" as const,
    evidence_ids: [evidenceId as never],
    created_context: context,
    observed_context: context,
    locator,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    resolver_version: compositionVersion
  };
}

function authority(
  authorityId: string,
  surfaceId: string,
  bindingId: string,
  opportunityVersionId: OpportunityVersionId,
  evidenceId: string,
  source: TrustedSourceOccurrenceArtifact,
  config: RealOfficial2027TrustedRunConfig
) {
  return {
    authority_assertion_id: authorityId as never,
    asserted_source_surface_id: surfaceId as never,
    authority_basis_source_surface_id: surfaceId as never,
    authority_basis_binding_id: bindingId as never,
    issuer: config.authority_issuer,
    authority_state: "OFFICIAL_AUTHORITATIVE" as const,
    target_scope: opportunityVersionId,
    effective_period: { effective_from: source.version.first_observed_at },
    evidence_ids: [evidenceId as never],
    resolver_version: config.composition_version,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  };
}

function selection(
  selectionId: string,
  surfaceId: string,
  source: TrustedSourceOccurrenceArtifact,
  opportunityVersionId: OpportunityVersionId,
  evidenceId: string,
  compositionVersion: string
) {
  return {
    source_version_selection_id: selectionId as never,
    source_identity: source.occurrence.source_occurrence_id,
    target_scope: opportunityVersionId,
    candidate_source_surface_ids: [surfaceId as never],
    selected_source_surface_id: surfaceId as never,
    excluded_source_surface_ids: [],
    selection_status: "RESOLVED" as const,
    effective_period: { effective_from: source.version.first_observed_at },
    observation_time: source.snapshot.observed_at,
    evidence_ids: [evidenceId as never],
    resolver_version: compositionVersion,
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
  };
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function normalized(text: string, evidencePrefix: string) {
  return {
    text: text.normalize("NFKC"),
    unicode_form: "NFKC" as const,
    normalizer_version: `${evidencePrefix}-candidate-assertion/1.0.0`,
    operations: ["UNICODE_NORMALIZATION" as const]
  };
}

function traceable(text: string) {
  return { original: original(text) };
}

function id<Type>(prefix: string, seed: string) {
  return `${prefix}:${sha256Text(seed)}` as Type;
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

interface RecallRegistrationResult {
  readonly candidate: { readonly opportunity_candidate_id: OpportunityCandidateId };
  readonly disposition: { readonly recall_disposition_id: RecallDispositionId };
}

interface PositionMaterializationResult {
  readonly position: { readonly position_id: string };
  readonly position_version: { readonly position_version_id: PositionVersionId };
}

interface OpportunityMaterializationResult {
  readonly opportunity_version: {
    readonly opportunity_version_id: OpportunityVersionId;
  };
}

interface RelevanceResult {
  readonly assessment: {
    readonly assessment_id: string;
    readonly assessment_state: string;
  };
}

interface RequirementProjectionResult {
  readonly requirement_projection_id: string;
}

interface PresentationDecisionResult {
  readonly decision: PresentationDecision;
}

interface PresentationReadModelResult {
  readonly read_model: PresentationReadModel;
}
