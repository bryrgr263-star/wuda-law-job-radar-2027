import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCr12RequirementLogicTree,
  buildCr12StructuredRequirementSet,
  buildSourceCompositionResult,
  classifyCr11MajorExpression,
  createCr11MajorMatchRelation,
  DeterministicEligibilityEngine,
  projectCr11MajorPredicatesToCr12Leaves,
  SOURCE_COMPOSITION_SCHEMA_VERSION,
  STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES,
  UTF8_TEXT_ENCODING,
  assertSourceCompositionResultIntegrity,
  type CandidateCredentialApplicabilityId,
  type CandidateCredentialId,
  type CandidateStateApplicabilityId,
  type AuthorityAssertionId,
  type ConditionalRequirementBranchSet,
  type ConditionalRequirementBranchSetId,
  type Cr11CandidateMajorIdentityDescriptor,
  type Cr11MajorMatchRelationKind,
  type Cr12LogicToken,
  type Cr12RequirementCompletenessBlocker,
  type Cr12StructuredRequirementSetInput,
  type Cr12RequirementCondition,
  type DiscoveryBoundaryId,
  type EligibilityAssessmentId,
  type ExpectedSurfaceManifestEntryId,
  type ExtractedRecordId,
  type IsoDateTime,
  type LocationAssignmentId,
  type OpportunityVersion,
  type OpportunityVersionId,
  type PositionVersionId,
  type RecruitmentBatchId,
  type RecruitmentPlanId,
  type RequirementContextBindingId,
  type RequirementContextTarget,
  type RequirementEvidenceFragmentId,
  type RequirementEvidenceId,
  type RequirementFact,
  type RequirementFactId,
  type RequirementLogicTreeId,
  type RequirementMandatoryRootId,
  type RequirementObservationId,
  type RequirementSelectorPredicateId,
  type RequirementSetId,
  type RequirementSourceReferenceId,
  type SelectorLogicNodeId,
  type SelectorLogicTree,
  type SelectorLogicTreeId,
  type SourceCompositionEvidenceId,
  type SourceCompositionInput,
  type SourceCompositionResult,
  type SourceOccurrenceVersionId,
  type SourcePackageInventoryId,
  type SourcePrecedenceDecisionId,
  type SourceSurfaceBindingId,
  type SourceSurfaceId,
  type SourceVersionSelectionId,
  type SnapshotId,
  type StructuredCandidateProfile,
  type StructuredEligibilityDispatchResult
} from "../../lib/ingestion";
import { EligibilityInputError } from "../../lib/ingestion/eligibility";

const compositionRegistry = new Map<string, SourceCompositionResult>();
const engine = new DeterministicEligibilityEngine({
  resolve(reference) {
    const result = compositionRegistry.get(reference.source_composition_id);
    return result ?? null;
  },
  verify(result) {
    return assertSourceCompositionResultIntegrity(result);
  }
});
const parserVersion = "cr10-structured-test-parser/1";
const resolverVersion = "cr10-structured-test-resolver/1";
const serializationVersion = "cr10-structured-test-content/1";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function nonEmpty<Value>(values: readonly Value[]) {
  if (values.length === 0) throw new Error("Expected non-empty values");
  return values as readonly [Value, ...Value[]];
}

function verifyComposition(result: SourceCompositionResult) {
  return assertSourceCompositionResultIntegrity(result);
}

const sourceLocator = {
  kind: "SPREADSHEET" as const,
  sheet: "synthetic",
  cell_or_range: "H2",
  field_path: "major"
};

function ids(suffix: string) {
  return {
    opportunityVersion: branded<OpportunityVersionId>(`opportunity-${suffix}`),
    positionVersion: branded<PositionVersionId>(`position-${suffix}`),
    fragment: branded<RequirementEvidenceFragmentId>(`fragment-${suffix}`),
    snapshot: branded<SnapshotId>(`snapshot-${suffix}`),
    credential: branded<CandidateCredentialApplicabilityId>(`credential-${suffix}`),
    state: branded<CandidateStateApplicabilityId>(`state-${suffix}`),
    binding: branded<RequirementContextBindingId>(`binding-${suffix}`),
    source: branded<RequirementSourceReferenceId>(`source-${suffix}`),
    tree: branded<RequirementLogicTreeId>(`tree-${suffix}`),
    root: branded<RequirementMandatoryRootId>(`root-${suffix}`),
    evidence: branded<RequirementEvidenceId>(`evidence-${suffix}`),
    observation: branded<RequirementObservationId>(`observation-${suffix}`),
    requirementSet: branded<RequirementSetId>(`set-${suffix}`)
  };
}

function candidate(options: {
  readonly masterCompleteness?: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  readonly masterDirectoryVersion?: string;
  readonly qualificationStatus?: "OBTAINED" | "NOT_OBTAINED" | "UNKNOWN";
  readonly duplicateCredentialId?: boolean;
  readonly gender?: "MALE" | "FEMALE";
  readonly candidateCohorts?: readonly ("FRESH_GRADUATE" | "SOCIAL_CANDIDATE")[];
} = {}): StructuredCandidateProfile {
  const masterCompleteness = options.masterCompleteness ?? "COMPLETE";
  const bachelorId = branded<CandidateCredentialId>("credential-bachelor-non-law");
  const masterId = options.duplicateCredentialId
    ? bachelorId
    : branded<CandidateCredentialId>("credential-master-law-master-non-law");
  return {
    candidate_profile_id: branded("candidate-law-master-non-law"),
    education: [{
      candidate_credential_id: bachelorId,
      level: "BACHELOR",
      institution: text("synthetic bachelor institution"),
      program_name: text("经济学"),
      normalized_program_codes: [],
      degree_type: "ACADEMIC",
      program_type: "OTHER",
      academic_background: "NON_LAW",
      major_identity_assertion: majorIdentity("NON_LAW", "经济学", "BACHELOR", "COMPLETE"),
      provenance: "SYNTHETIC_TEST",
      completeness: "COMPLETE"
    }, {
      candidate_credential_id: masterId,
      level: "MASTER",
      institution: text("synthetic master institution"),
      program_name: text("法律硕士（非法学）"),
      normalized_program_codes: [],
      degree_type: "PROFESSIONAL",
      program_type: "LAW_MASTER_NON_LAW",
      academic_background: "NON_LAW",
      major_identity_assertion: majorIdentity(
        "LAW_MASTER_NON_LAW",
        "法律硕士（非法学）",
        "MASTER",
        masterCompleteness,
        options.masterDirectoryVersion
      ),
      provenance: "SYNTHETIC_TEST",
      completeness: masterCompleteness
    }],
    professional_qualifications: options.qualificationStatus === undefined ? [] : [{
      qualification_code: "LEGAL_PROFESSIONAL_A",
      qualification_type: "LEGAL_PROFESSIONAL",
      qualification_class: "A",
      status: options.qualificationStatus,
      name: text("A类法律职业资格证书")
    }],
    languages: [],
    ...(options.gender ? { gender: options.gender } : {}),
    ...(options.candidateCohorts ? {
      candidate_cohorts: options.candidateCohorts
    } : {})
  };
}

function majorIdentity(
  semanticCode: Cr11CandidateMajorIdentityDescriptor["semantic_code"],
  label: string,
  level: Cr11CandidateMajorIdentityDescriptor["credential_level"],
  provenance: Cr11CandidateMajorIdentityDescriptor["provenance_state"],
  directoryVersion = "2025"
): Cr11CandidateMajorIdentityDescriptor {
  return {
    semantic_code: semanticCode,
    identity_label: { text: label, encoding: UTF8_TEXT_ENCODING },
    credential_level: level,
    major_code: "0351",
    directory_namespace: "official-directory",
    directory_version: directoryVersion,
    provenance_state: provenance
  };
}

function text(value: string) {
  return {
    original: { text: value, encoding: UTF8_TEXT_ENCODING },
    normalized: {
      text: value,
      unicode_form: "NFKC" as const,
      normalizer_version: "synthetic/1",
      operations: ["UNICODE_NORMALIZATION"] as const
    }
  };
}

function majorSet(
  suffix: string,
  expressionText: string,
  options: {
    readonly relationKind?: Cr11MajorMatchRelationKind;
    readonly listContext?: "SINGLE_EXPRESSION" | "MAJOR_CANDIDATE_LIST";
    readonly directory?: boolean;
    readonly qualification?: boolean;
    readonly externalBlockers?: readonly Cr12RequirementCompletenessBlocker[];
  } = {}
) {
  const id = ids(suffix);
  const classified = classifyCr11MajorExpression({
    raw_expression: { text: expressionText, encoding: UTF8_TEXT_ENCODING },
    normalized_expression: {
      text: expressionText,
      unicode_form: "NFKC",
      normalizer_version: "synthetic/1",
      operations: ["UNICODE_NORMALIZATION"]
    },
    evidence_fragment_ids: nonEmpty([id.fragment]),
    source_locator: sourceLocator,
    list_context: options.listContext ?? "SINGLE_EXPRESSION",
    ...(options.directory ? {
      directory_reference: {
        directory_namespace: "official-directory",
        directory_version: "2025",
        program_code: "0351",
        category_level: "PROGRAM" as const
      }
    } : {}),
    parser_version: parserVersion,
    resolver_version: resolverVersion
  });
  assert.equal(classified.status, "RESOLVED", expressionText);
  const sourceExpression = classified.expressions[0];
  if (!sourceExpression) throw new Error("Expected source major expression");
  const relations = options.relationKind ? [createCr11MajorMatchRelation({
    source_major_expression: sourceExpression,
    candidate_major_identity: majorIdentity(
      "LAW_MASTER_NON_LAW",
      "法律硕士（非法学）",
      "MASTER",
      "COMPLETE"
    ),
    candidate_credential_applicability_id: id.credential,
    relation_kind: options.relationKind,
    ...(options.relationKind === "DIRECTORY_MEMBERSHIP" ? {
      directory_reference: {
        directory_namespace: "official-directory",
        directory_version: "2025",
        program_code: "0351",
        category_level: "PROGRAM" as const
      }
    } : {}),
    evidence_fragment_ids: nonEmpty([id.fragment]),
    source_locator: sourceLocator,
    evidence_version: "official-source/1",
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    certainty: options.relationKind === "NOT_ESTABLISHED" ? "UNRESOLVED" : "EXPLICIT"
  })] : [];
  const projected = projectMajor({
    opportunity_version_id: id.opportunityVersion,
    subject_scope: "MASTER",
    candidate_credential_applicability_id: id.credential,
    context_binding_ids: nonEmpty([id.binding]),
    source_order: 0,
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    projection_version: "cr10-engine-integration/1",
    expressions: classified.expressions,
    connector_observations: classified.connector_observations,
    major_match_relations: relations
  });
  assert.equal(projected.status, "RESOLVED", expressionText);
  if (projected.status !== "RESOLVED") throw new Error("Expected major projection");
  const facts: RequirementFact[] = [...projected.facts];
  const tokens: Cr12LogicToken[] = [...projected.tokens];
  if (options.qualification) {
    const qualificationFactId = branded<RequirementFactId>(`qualification-${suffix}`);
    facts.push({
      requirement_fact_id: qualificationFactId,
      opportunity_version_id: id.opportunityVersion,
      dimension: "PROFESSIONAL_QUALIFICATION",
      operator: "EQUALS",
      value: {
        kind: "PROFESSIONAL_QUALIFICATION",
        qualification_type: "LEGAL_PROFESSIONAL",
        qualification_class: "A",
        strength: "REQUIRED"
      },
      subject_scope: "CANDIDATE",
      logic_group: {
        logic_group_id: branded(`qualification-group-${suffix}`),
        operator: "AND"
      },
      polarity: "POSITIVE",
      certainty: "EXPLICIT",
      parser_version: parserVersion
    });
    tokens.push({
      kind: "AND",
      context_binding_ids: nonEmpty([id.binding]),
      evidence_fragment_ids: nonEmpty([id.fragment]),
      source_order: tokens.length
    }, {
      kind: "PREDICATE",
      requirement_fact_id: qualificationFactId,
      context_binding_ids: nonEmpty([id.binding]),
      evidence_fragment_ids: nonEmpty([id.fragment]),
      source_order: tokens.length + 1
    });
  }
  const tree = buildCr12RequirementLogicTree({
    requirement_condition_id: branded(`condition-${suffix}`),
    requirement_logic_tree_id: id.tree,
    tokens: nonEmpty(tokens),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  if (tree.status !== "RESOLVED") throw new Error(tree.message);
  const input: Cr12StructuredRequirementSetInput = {
    opportunity_version_id: id.opportunityVersion,
    mandatory_root: {
      requirement_mandatory_root_id: id.root,
      kind: "SINGLE",
      requirement_condition_id: branded(`condition-${suffix}`)
    },
    conditions: [{
      requirement_condition_id: branded(`condition-${suffix}`),
      opportunity_version_id: id.opportunityVersion,
      modality: "MANDATORY",
      resolution_state: "RESOLVED",
      representation_kind: "LOGIC_TREE",
      requirement_logic_tree_id: id.tree,
      candidate_credential_applicability_id: id.credential,
      candidate_state_applicability_id: id.state,
      context_binding_ids: nonEmpty([id.binding]),
      source_reference_ids: nonEmpty([id.source]),
      evidence_fragment_ids: nonEmpty([id.fragment]),
      source_locator: sourceLocator,
      source_order: 0,
      parser_version: parserVersion,
      resolver_version: resolverVersion,
      projected_from_legacy_fact_ids: [],
      projected_from_legacy_evidence_ids: []
    }],
    requirement_logic_trees: [tree.tree],
    facts,
    candidate_credential_applicabilities: [{
      candidate_credential_applicability_id: id.credential,
      mode: "SPECIFIC_DEGREE",
      degree: "MASTER",
      evidence_fragment_ids: [id.fragment],
      certainty: "EXPLICIT",
      parser_version: parserVersion
    }],
    candidate_state_applicabilities: [{
      candidate_state_applicability_id: id.state,
      mode: "ALL_CANDIDATES",
      evidence_fragment_ids: [id.fragment],
      certainty: "EXPLICIT",
      parser_version: parserVersion
    }],
    context_bindings: [{
      requirement_context_binding_id: id.binding,
      opportunity_version_id: id.opportunityVersion,
      source_context_target: {
        kind: "POSITION_VERSION",
        position_version_id: id.positionVersion
      },
      effective_targets: nonEmpty([{
        kind: "OPPORTUNITY_VERSION",
        opportunity_version_id: id.opportunityVersion
      }]),
      scope: "EXACT_TARGET",
      state: "RESOLVED",
      certainty: "EXPLICIT",
      source_locator: sourceLocator,
      evidence_fragment_ids: nonEmpty([id.fragment]),
      identity_evidence_ids: [],
      resolver_version: resolverVersion
    }],
    source_references: [{
      requirement_source_reference_id: id.source,
      snapshot_id: id.snapshot,
      extracted_record_id: branded(`record-${suffix}`),
      source_role: "POSITION_TABLE_ROW",
      source_context_target: {
        kind: "POSITION_VERSION",
        position_version_id: id.positionVersion
      },
      applicable_binding_ids: nonEmpty([id.binding]),
      binding_evidence_fragment_ids: nonEmpty([id.fragment]),
      identity_evidence_ids: [],
      source_locator: sourceLocator,
      relationship: {
        kind: "ORIGINAL",
        target_source_reference_ids: [],
        evidence_fragment_ids: [id.fragment],
        resolver_version: resolverVersion
      },
      binding_state: "RESOLVED",
      binding_certainty: "EXPLICIT",
      extractor_version: "synthetic/1",
      parser_version: parserVersion,
      resolver_version: resolverVersion
    }],
    selector_predicates: [],
    selector_logic_trees: [],
    conditional_branch_sets: [],
    evidence_fragments: [{
      requirement_evidence_fragment_id: id.fragment,
      extracted_record_id: branded(`record-${suffix}`),
      snapshot_id: id.snapshot,
      locator: sourceLocator,
      extractor_name: "synthetic",
      extractor_version: "synthetic/1",
      parser_version: parserVersion,
      observed_value_state: "TEXT",
      original_text: { text: expressionText, encoding: UTF8_TEXT_ENCODING }
    }],
    requirement_evidence: facts.map((fact, index) => ({
      requirement_evidence_id: branded<RequirementEvidenceId>(`evidence-${suffix}-${index}`),
      requirement_fact_id: fact.requirement_fact_id,
      snapshot_id: id.snapshot,
      locator: sourceLocator,
      evidence_text: { text: expressionText, encoding: UTF8_TEXT_ENCODING },
      extractor_name: "synthetic",
      extractor_version: "synthetic/1",
      parser_version: parserVersion
    })),
    observations: [{
      requirement_observation_id: id.observation,
      opportunity_version_id: id.opportunityVersion,
      status: "CONFIRMED_REQUIREMENT",
      clause_role: "MANDATORY",
      dimension_hint: "MAJOR",
      requirement_fact_ids: facts.map((fact) => fact.requirement_fact_id),
      evidence_fragment_ids: nonEmpty([id.fragment]),
      parser_version: parserVersion
    }],
    ...(options.externalBlockers ? { external_blockers: options.externalBlockers } : {}),
    supported_engine_capabilities: STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES,
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    serialization_version: serializationVersion
  };
  return fixtureFromInput(input);
}

function compositionBackedInput(
  input: Cr12StructuredRequirementSetInput
): Cr12StructuredRequirementSetInput {
  const compositionAsOf = branded<IsoDateTime>("2026-09-06T00:00:00.000Z");
  const sources = input.source_references.map((source) => {
    return {
      ...source,
      source_surface_id: branded<SourceSurfaceId>(
        `source-surface-${source.requirement_source_reference_id}`
      )
    };
  });
  const evidenceIds = sources.map((source) => {
    return branded<SourceCompositionEvidenceId>(
      `composition-evidence-${source.requirement_source_reference_id}`
    );
  });
  const sourceCompositionInput: SourceCompositionInput = {
    opportunity_version_id: input.opportunity_version_id,
    composition_as_of: compositionAsOf,
    discovery_boundary: {
      discovery_boundary_id: branded<DiscoveryBoundaryId>(
        `composition-boundary-${input.opportunity_version_id}`
      ),
      opportunity_version_id: input.opportunity_version_id,
      boundary_kind: "POSITION_PACKAGE",
      initiating_source_surface_ids: sources.map((source) => source.source_surface_id),
      source_metadata_references: ["synthetic-official-package"],
      discovery_scope: "synthetic source composition package",
      admissible_relation_kinds: ["ORIGINAL"],
      evidence_ids: evidenceIds,
      composition_as_of: compositionAsOf,
      observed_at: compositionAsOf,
      extractor_version: "synthetic-composition-extractor/1",
      discovery_resolver_version: "synthetic-composition-discovery/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    inventory: {
      source_package_inventory_id: branded<SourcePackageInventoryId>(
        `composition-inventory-${input.opportunity_version_id}`
      ),
      discovery_boundary_id: branded<DiscoveryBoundaryId>(
        `composition-boundary-${input.opportunity_version_id}`
      ),
      composition_as_of: compositionAsOf,
      discovered_source_surface_ids: sources.map((source) => source.source_surface_id),
      expected_surface_entries: sources.map((source, index) => {
        const authorityId = branded<AuthorityAssertionId>(
          `composition-authority-${source.requirement_source_reference_id}`
        );
        const bindingId = branded<SourceSurfaceBindingId>(
          `composition-binding-${source.requirement_source_reference_id}`
        );
        const selectionId = branded<SourceVersionSelectionId>(
          `composition-selection-${source.requirement_source_reference_id}`
        );
        return {
          expected_surface_manifest_entry_id:
            branded<ExpectedSurfaceManifestEntryId>(
              `composition-entry-${source.requirement_source_reference_id}`
            ),
          expected_surface_key: `source-${source.requirement_source_reference_id}`,
          source_surface_id: source.source_surface_id,
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
          target_scope: `opportunity-version:${input.opportunity_version_id}`,
          evidence_ids: [evidenceIds[index]]
        } as const;
      }),
      inventory_completeness_status: "CLOSED",
      unexpected_surface_dispositions: [],
      discovery_resolver_version: "synthetic-composition-discovery/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    evidence_registry: sources.map((source, index) => {
      return {
        source_composition_evidence_id: evidenceIds[index],
        snapshot_id: source.snapshot_id,
        extracted_record_id: source.extracted_record_id,
        source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
          `composition-occurrence-${source.requirement_source_reference_id}`
        ),
        locator: source.source_locator,
        observed_at: compositionAsOf,
        extractor_version: "synthetic-composition-extractor/1"
      };
    }),
    source_surfaces: sources.map((source, index) => {
      return {
        source_surface_id: source.source_surface_id,
        surface_kind: "POSITION_TABLE_ROW",
        source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
          `composition-occurrence-${source.requirement_source_reference_id}`
        ),
        snapshot_id: source.snapshot_id,
        extracted_record_id: source.extracted_record_id,
        locator: source.source_locator,
        surface_content_hash: `synthetic-source-content-${source.requirement_source_reference_id}`,
        effective_period: { effective_from: compositionAsOf },
        source_publication_time: compositionAsOf,
        observed_at: compositionAsOf,
        surface_status: "PARSED",
        composition_role: "PRIMARY",
        target_scope: `opportunity-version:${input.opportunity_version_id}`,
        evidence_ids: [evidenceIds[index]],
        extractor_version: "synthetic-composition-extractor/1",
        parser_version: "synthetic-composition-parser/1",
        resolver_version: "synthetic-composition-resolver/1",
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      } as const;
    }),
    source_surface_bindings: sources.map((source, index) => {
      return {
        source_surface_binding_id: branded<SourceSurfaceBindingId>(
          `composition-binding-${source.requirement_source_reference_id}`
        ),
        source_surface_id: source.source_surface_id,
        target_type: "OPPORTUNITY_VERSION",
        target_id: input.opportunity_version_id,
        target_version_id: input.opportunity_version_id,
        binding_kind: "SURFACE_DECLARATION",
        binding_status: "RESOLVED",
        evidence_ids: [evidenceIds[index]],
        created_context: {
          source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
            `composition-occurrence-${source.requirement_source_reference_id}`
          ),
          snapshot_id: source.snapshot_id,
          extracted_record_id: source.extracted_record_id,
          observed_at: compositionAsOf,
          resolver_version: "synthetic-composition-resolver/1"
        },
        observed_context: {
          source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
            `composition-occurrence-${source.requirement_source_reference_id}`
          ),
          snapshot_id: source.snapshot_id,
          extracted_record_id: source.extracted_record_id,
          observed_at: compositionAsOf,
          resolver_version: "synthetic-composition-resolver/1"
        },
        locator: source.source_locator,
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      } as const;
    }),
    authority_assertions: sources.map((source, index) => {
      return {
        authority_assertion_id: branded<AuthorityAssertionId>(
          `composition-authority-${source.requirement_source_reference_id}`
        ),
        asserted_source_surface_id: source.source_surface_id,
        authority_basis_source_surface_id: source.source_surface_id,
        issuer: "synthetic-official-publisher",
        authority_state: "OFFICIAL_AUTHORITATIVE",
        target_scope: `opportunity-version:${input.opportunity_version_id}`,
        effective_period: { effective_from: compositionAsOf },
        evidence_ids: [evidenceIds[index]],
        resolver_version: "synthetic-composition-authority/1",
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      } as const;
    }),
    source_version_selections: sources.map((source, index) => {
      return {
        source_version_selection_id: branded<SourceVersionSelectionId>(
          `composition-selection-${source.requirement_source_reference_id}`
        ),
        source_identity: `synthetic-source-${source.requirement_source_reference_id}`,
        target_scope: `opportunity-version:${input.opportunity_version_id}`,
        candidate_source_surface_ids: [source.source_surface_id],
        selected_source_surface_id: source.source_surface_id,
        excluded_source_surface_ids: [],
        selection_status: "RESOLVED",
        source_publication_time: compositionAsOf,
        effective_period: { effective_from: compositionAsOf },
        observation_time: compositionAsOf,
        ingestion_time: compositionAsOf,
        evidence_ids: [evidenceIds[index]],
        resolver_version: "synthetic-composition-selection/1",
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      } as const;
    }),
    surface_revision_relations: [],
    precedence_decisions: sources.map((source, index) => {
      return {
        precedence_decision_id: branded<SourcePrecedenceDecisionId>(
          `composition-precedence-${source.requirement_source_reference_id}`
        ),
        selected_source_surface_ids: [source.source_surface_id],
        excluded_source_surface_ids: [],
        applicable_scope: `opportunity-version:${input.opportunity_version_id}`,
        effective_period: { effective_from: compositionAsOf },
        composition_as_of: compositionAsOf,
        authority_assertion_ids: [branded<AuthorityAssertionId>(
          `composition-authority-${source.requirement_source_reference_id}`
        )],
        precedence_rule: "EXACT_TARGET_SCOPE",
        evidence_ids: [evidenceIds[index]],
        decision_status: "RESOLVED",
        resolver_version: "synthetic-composition-precedence/1",
        schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
      } as const;
    }),
    source_conflicts: [],
    extractor_version: "synthetic-composition-extractor/1",
    parser_version: "synthetic-composition-parser/1",
    discovery_resolver_version: "synthetic-composition-discovery/1",
    composition_resolver_version: "synthetic-composition-resolver/1",
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    serialization_version: "synthetic-composition-serialization/1"
  };
  const compositionResult = buildSourceCompositionResult(sourceCompositionInput);
  compositionRegistry.set(
    compositionResult.source_composition_id,
    compositionResult
  );
  return {
    ...input,
    source_references: sources,
    source_composition_result: compositionResult
  };
}

function fixtureFromInput(input: Cr12StructuredRequirementSetInput) {
  const compositionBacked = compositionBackedInput(input);
  const context: readonly RequirementContextTarget[] = [{
    kind: "OPPORTUNITY_VERSION",
    opportunity_version_id: compositionBacked.opportunity_version_id
  }];
  return {
    input: compositionBacked,
    set: buildCr12StructuredRequirementSet(compositionBacked).structured_requirement_set,
    opportunity: opportunity(compositionBacked.opportunity_version_id),
    context
  };
}

type LogicTokenItem = RequirementFactId | "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN";

function logicTokens(
  fixture: ReturnType<typeof majorSet>,
  tokens: readonly LogicTokenItem[]
) {
  const bindingId = fixture.input.context_bindings[0].requirement_context_binding_id;
  const fragmentId = fixture.input.evidence_fragments[0]
    .requirement_evidence_fragment_id;
  return nonEmpty(tokens.map((token, sourceOrder): Cr12LogicToken => {
    const shared = {
      context_binding_ids: nonEmpty([bindingId]),
      evidence_fragment_ids: nonEmpty([fragmentId]),
      source_order: sourceOrder
    };
    return token === "AND" || token === "OR" || token === "NOT"
      || token === "LPAREN" || token === "RPAREN"
      ? {
        ...shared,
        kind: token as "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN"
      }
      : {
        ...shared,
        kind: "PREDICATE",
        requirement_fact_id: token
      };
  }));
}

function genericFact(
  fixture: ReturnType<typeof majorSet>,
  suffix: string,
  dimension: RequirementFact["dimension"],
  value: RequirementFact["value"]
): RequirementFact {
  const base = fixture.input.facts[0];
  return {
    ...base,
    requirement_fact_id: branded<RequirementFactId>(`generic-${suffix}`),
    dimension,
    operator: "EQUALS",
    value,
    logic_group: {
      logic_group_id: branded(`generic-group-${suffix}`),
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT"
  };
}

function fixtureWithLogic(
  fixture: ReturnType<typeof majorSet>,
  tokens: readonly LogicTokenItem[],
  facts: readonly RequirementFact[] = fixture.input.facts
) {
  const condition = fixture.input.conditions[0];
  if (condition.representation_kind !== "LOGIC_TREE") {
    throw new Error("Expected a logic-tree condition");
  }
  const built = buildCr12RequirementLogicTree({
    requirement_condition_id: condition.requirement_condition_id,
    requirement_logic_tree_id: condition.requirement_logic_tree_id,
    tokens: logicTokens(fixture, tokens),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  if (built.status !== "RESOLVED") throw new Error(built.message);
  const sourceEvidence = fixture.input.requirement_evidence[0];
  return fixtureFromInput({
    ...fixture.input,
    requirement_logic_trees: [built.tree],
    facts,
    requirement_evidence: facts.map((fact, index) => ({
      ...sourceEvidence,
      requirement_evidence_id: branded<RequirementEvidenceId>(
        `logic-evidence-${condition.requirement_condition_id}-${index}`
      ),
      requirement_fact_id: fact.requirement_fact_id
    })),
    observations: [{
      ...fixture.input.observations[0],
      requirement_fact_ids: facts.map((fact) => fact.requirement_fact_id)
    }]
  });
}

function fixtureWithModality(
  fixture: ReturnType<typeof majorSet>,
  modality: Exclude<Cr12RequirementCondition["modality"], "MANDATORY">
) {
  const condition = fixture.input.conditions[0];
  return fixtureFromInput({
    ...fixture.input,
    mandatory_root: {
      requirement_mandatory_root_id: fixture.input.mandatory_root
        .requirement_mandatory_root_id,
      kind: "EMPTY_CONFIRMED",
      evidence_fragment_ids: nonEmpty([
        fixture.input.evidence_fragments[0].requirement_evidence_fragment_id
      ])
    },
    conditions: [{ ...condition, modality }],
    observations: [{
      ...fixture.input.observations[0],
      clause_role: modality === "PREFERRED" ? "PREFERRED" : "INFORMATIONAL"
    }]
  });
}

function fixtureWithStateApplicability(
  fixture: ReturnType<typeof majorSet>
) {
  const state = fixture.input.candidate_state_applicabilities[0];
  return fixtureFromInput({
    ...fixture.input,
    candidate_state_applicabilities: [{
      ...state,
      mode: "COHORT_ANY_OF",
      candidate_cohorts: nonEmpty(["FRESH_GRADUATE"])
    }]
  });
}

function fixtureWithContextTarget(
  fixture: ReturnType<typeof majorSet>,
  target: RequirementContextTarget
) {
  const binding = fixture.input.context_bindings[0];
  return fixtureFromInput({
    ...fixture.input,
    context_bindings: [{
      ...binding,
      source_context_target: target,
      effective_targets: nonEmpty([
        target,
        {
          kind: "OPPORTUNITY_VERSION",
          opportunity_version_id: fixture.input.opportunity_version_id
        }
      ]),
      scope: "EXPLICIT_TARGET_SET"
    }],
    source_references: fixture.input.source_references.map((source) => ({
      ...source,
      source_context_target: target
    }))
  });
}

function conditionalFixture(fixture: ReturnType<typeof majorSet>) {
  const input = fixture.input;
  const condition = input.conditions[0];
  if (condition.representation_kind !== "LOGIC_TREE") {
    throw new Error("Expected a logic-tree condition");
  }
  const bindingId = input.context_bindings[0].requirement_context_binding_id;
  const fragmentId = input.evidence_fragments[0].requirement_evidence_fragment_id;
  const branchSetId = branded<ConditionalRequirementBranchSetId>(
    `branch-${condition.requirement_condition_id}`
  );
  const selectorPredicateId = branded<RequirementSelectorPredicateId>(
    `selector-${condition.requirement_condition_id}`
  );
  const selectorTreeId = branded<SelectorLogicTreeId>(
    `selector-tree-${condition.requirement_condition_id}`
  );
  const selectorNodeId = branded<SelectorLogicNodeId>(
    `selector-node-${condition.requirement_condition_id}`
  );
  const selectorPredicate = {
    requirement_selector_predicate_id: selectorPredicateId,
    conditional_branch_set_id: branchSetId,
    opportunity_version_id: input.opportunity_version_id,
    dimension: "CANDIDATE_COHORT" as const,
    operator: "ONE_OF" as const,
    value: { kind: "CODE_SET" as const, codes: ["FRESH_GRADUATE"] },
    candidate_credential_applicability_id:
      condition.candidate_credential_applicability_id,
    direct_candidate_cohorts: nonEmpty<"FRESH_GRADUATE">(["FRESH_GRADUATE"]),
    context_binding_ids: nonEmpty([bindingId]),
    evidence_fragment_ids: nonEmpty([fragmentId]),
    source_locator: condition.source_locator,
    parser_version: parserVersion,
    resolution_state: "RESOLVED" as const
  };
  const selectorTree: SelectorLogicTree = {
    selector_logic_tree_id: selectorTreeId,
    conditional_branch_set_id: branchSetId,
    root_node_id: selectorNodeId,
    nodes: nonEmpty([{
      selector_logic_node_id: selectorNodeId,
      selector_logic_tree_id: selectorTreeId,
      kind: "SELECTOR_PREDICATE",
      requirement_selector_predicate_id: selectorPredicateId,
      context_binding_ids: nonEmpty([bindingId]),
      evidence_fragment_ids: nonEmpty([fragmentId]),
      source_order: 0
    }]),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  };
  const elseFact = genericFact(fixture, `else-${condition.requirement_condition_id}`,
    "GENDER", { kind: "CODE", code: "FEMALE" });
  const elseTreeId = branded<RequirementLogicTreeId>(
    `else-tree-${condition.requirement_condition_id}`
  );
  const builtElse = buildCr12RequirementLogicTree({
    requirement_condition_id: condition.requirement_condition_id,
    requirement_logic_tree_id: elseTreeId,
    tokens: nonEmpty([{
      kind: "PREDICATE",
      requirement_fact_id: elseFact.requirement_fact_id,
      context_binding_ids: nonEmpty([bindingId]),
      evidence_fragment_ids: nonEmpty([fragmentId]),
      source_order: 0
    }]),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  if (builtElse.status !== "RESOLVED") throw new Error(builtElse.message);
  const branchSet: ConditionalRequirementBranchSet = {
    conditional_branch_set_id: branchSetId,
    requirement_condition_id: condition.requirement_condition_id,
    when_selector_logic_tree_id: selectorTreeId,
    then_requirement_logic_tree_id: condition.requirement_logic_tree_id,
    else_requirement_logic_tree_id: elseTreeId,
    candidate_credential_applicability_id:
      condition.candidate_credential_applicability_id,
    candidate_state_applicability_id: condition.candidate_state_applicability_id,
    context_binding_ids: nonEmpty([bindingId]),
    evidence_fragment_ids: nonEmpty([fragmentId]),
    branch_semantics_state: "RESOLVED",
    source_order: 0,
    parser_version: parserVersion,
    resolver_version: resolverVersion
  };
  const conditionalCondition: Cr12RequirementCondition = {
    ...condition,
    representation_kind: "CONDITIONAL_BRANCH_SET",
    conditional_branch_set_id: branchSetId
  };
  const sourceEvidence = input.requirement_evidence[0];
  return fixtureFromInput({
    ...input,
    conditions: [conditionalCondition],
    requirement_logic_trees: [input.requirement_logic_trees[0], builtElse.tree],
    facts: [...input.facts, elseFact],
    requirement_evidence: [
      ...input.requirement_evidence,
      {
        ...sourceEvidence,
        requirement_evidence_id: branded<RequirementEvidenceId>(
          `else-evidence-${condition.requirement_condition_id}`
        ),
        requirement_fact_id: elseFact.requirement_fact_id
      }
    ],
    observations: [{
      ...input.observations[0],
      requirement_fact_ids: [
        ...input.observations[0].requirement_fact_ids,
        elseFact.requirement_fact_id
      ]
    }],
    selector_predicates: [selectorPredicate],
    selector_logic_trees: [selectorTree],
    conditional_branch_sets: [branchSet]
  });
}

function projectMajor(
  input: Parameters<typeof projectCr11MajorPredicatesToCr12Leaves>[0]
) {
  return projectCr11MajorPredicatesToCr12Leaves(input);
}

function opportunity(opportunityVersionId: OpportunityVersionId): OpportunityVersion {
  return {
    opportunity_version_id: opportunityVersionId,
    canonical_opportunity_id: branded(`canonical-${opportunityVersionId}`),
    revision: 1,
    semantic_hash: branded(`semantic-${opportunityVersionId}`),
    content: {
      organization: { name: text("synthetic organization") },
      title: text("synthetic position"),
      locations: []
    },
    source_occurrence_version_ids: nonEmpty([branded(`occurrence-${opportunityVersionId}`)]),
    effective_from: branded<IsoDateTime>("2026-09-06T00:00:00.000Z")
  };
}

function evaluate(
  fixture: ReturnType<typeof majorSet>,
  profile = candidate(),
  options: { readonly supported?: readonly typeof STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES[number][]; readonly context?: readonly ReturnType<typeof majorSet>["context"][number][] } = {}
): StructuredEligibilityDispatchResult {
  return engine.evaluateStructured({
    model: "CR12_STRUCTURED_LOGIC_V1",
    structured_requirement_set: fixture.set,
    opportunity_version: fixture.opportunity,
    recruitment_context_snapshot: {
      opportunity_version_id: fixture.opportunity.opportunity_version_id,
      effective_targets: options.context ?? fixture.context
    },
    candidate_profile: profile,
    ...(options.supported ? { supported_engine_capabilities: options.supported } : {}),
    assessed_at: branded<IsoDateTime>("2026-09-06T00:00:00.000Z")
  });
}

function assessmentResult(result: StructuredEligibilityDispatchResult) {
  assert.equal(result.status, "ASSESSMENT");
  if (result.status !== "ASSESSMENT") throw new Error("Expected assessment");
  return result.assessment.result;
}

test("CR#10 structured controls cover all twelve frozen major outcomes", () => {
  const controls: readonly [
    string,
    string,
    Parameters<typeof majorSet>[2],
    "MATCH" | "NOT_MATCH" | "INSUFFICIENT"
  ][] = [
    ["A", "法律硕士（非法学）", { relationKind: "EXACT_IDENTITY" }, "MATCH"],
    ["B", "法律（非法学）", {}, "INSUFFICIENT"],
    ["C", "法律（0351）", { directory: true }, "INSUFFICIENT"],
    ["D", "法律", {}, "INSUFFICIENT"],
    ["E", "法学", {}, "INSUFFICIENT"],
    ["F", "法学类", { directory: true }, "INSUFFICIENT"],
    ["G", "法律类", { directory: true }, "INSUFFICIENT"],
    ["H", "法律相关专业", {}, "INSUFFICIENT"],
    ["I", "法学、法律、知识产权", { listContext: "MAJOR_CANDIDATE_LIST" }, "INSUFFICIENT"],
    ["J", "专业不限", {}, "MATCH"],
    ["K", "专业不限", { qualification: true }, "MATCH"],
    ["L", "法律硕士（非法学）", { relationKind: "EXPLICIT_EXCLUDED" }, "NOT_MATCH"]
  ];
  for (const [suffix, expression, options, expected] of controls) {
    const profile = suffix === "K"
      ? candidate({ qualificationStatus: "OBTAINED" })
      : candidate();
    assert.equal(assessmentResult(evaluate(majorSet(`control-${suffix}`, expression, options), profile)), expected, suffix);
  }
});

test("CR#10 credential partial/unknown and candidate directory mismatch remain INSUFFICIENT", () => {
  const exact = majorSet("partial", "法律硕士（非法学）", {
    relationKind: "EXACT_IDENTITY"
  });
  assert.equal(assessmentResult(evaluate(exact, candidate({ masterCompleteness: "PARTIAL" }))), "INSUFFICIENT");
  assert.equal(assessmentResult(evaluate(exact, candidate({ masterCompleteness: "UNKNOWN" }))), "INSUFFICIENT");
  const directory = majorSet("directory-known", "法律（0351）", {
    directory: true,
    relationKind: "DIRECTORY_MEMBERSHIP"
  });
  assert.equal(assessmentResult(evaluate(directory)), "MATCH");
  assert.equal(assessmentResult(evaluate(directory, candidate({ masterDirectoryVersion: "2024" }))), "INSUFFICIENT");
});

test("CR#10 gates unresolved source, incomplete set, context/hash/capability, and malformed credential without assessments", () => {
  const sourceBlocked = majorSet("source-blocked", "法律", {
    externalBlockers: [{
      code: "AMBIGUOUS",
      diagnostic_code: "LOGIC_CONNECTOR_UNRESOLVED",
      observation_ids: [],
      evidence_fragment_ids: [],
      description: "synthetic source unresolved"
    }]
  });
  const sourceResult = evaluate(sourceBlocked);
  assert.equal(sourceResult.status, "NOT_ALLOWED");
  assert.equal(sourceResult.reason, "REQUIREMENT_SET_NOT_COMPLETE");

  const valid = majorSet("gate-valid", "法律硕士（非法学）", {
    relationKind: "EXACT_IDENTITY"
  });
  const unsupported = evaluate(valid, candidate(), { supported: [] });
  assert.equal(unsupported.status, "NOT_ALLOWED");
  assert.equal(unsupported.reason, "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY");
  const wrongContext = evaluate(valid, candidate(), { context: [] });
  assert.equal(wrongContext.status, "NOT_ALLOWED");
  assert.equal(wrongContext.reason, "CONTEXT_BINDING_MISMATCH");
  const malformed = evaluate(valid, candidate({ duplicateCredentialId: true }));
  assert.equal(malformed.status, "NOT_ALLOWED");
  assert.equal(malformed.reason, "CANDIDATE_CREDENTIAL_BINDING_INVALID");

  const mutated = structuredClone(valid.set);
  (mutated.condition_registry[0] as { modality: string }).modality = "PREFERRED";
  const hashFailure = engine.evaluateStructured({
    model: "CR12_STRUCTURED_LOGIC_V1",
    structured_requirement_set: mutated,
    opportunity_version: valid.opportunity,
    recruitment_context_snapshot: {
      opportunity_version_id: valid.opportunity.opportunity_version_id,
      effective_targets: valid.context
    },
    candidate_profile: candidate(),
    assessed_at: branded<IsoDateTime>("2026-09-06T00:00:00.000Z")
  });
  assert.equal(hashFailure.status, "NOT_ALLOWED");
  assert.equal(hashFailure.reason, "CONTENT_HASH_MANIFEST_MISMATCH");
  for (const gate of [sourceResult, unsupported, wrongContext, malformed, hashFailure]) {
    assert.equal("assessment" in gate, false);
  }
});

test("CR#10 does not use array order, source-unresolved OR, legacy fallback, or non-mandatory clauses", () => {
  const exact = majorSet("order", "法律硕士（非法学）", {
    relationKind: "EXACT_IDENTITY"
  });
  const reordered = candidate();
  const reversedProfile = { ...reordered, education: [...reordered.education].reverse() };
  assert.equal(assessmentResult(evaluate(exact, reversedProfile)), "MATCH");
  const anyMajor = majorSet("optional", "专业不限");
  assert.equal(assessmentResult(evaluate(anyMajor, candidate({ masterCompleteness: "UNKNOWN" }))), "MATCH");
  const qualification = majorSet("qualification-unknown", "专业不限", { qualification: true });
  assert.equal(assessmentResult(evaluate(qualification, candidate())), "INSUFFICIENT");
});

test("CR#10 executes NOT, AND, OR, and nested CR#12 trees with three-valued safety", () => {
  const notBase = majorSet("logic-not", "法律硕士（非法学）", {
    relationKind: "EXACT_IDENTITY"
  });
  const majorFactId = notBase.input.facts[0].requirement_fact_id;
  assert.equal(
    assessmentResult(evaluate(fixtureWithLogic(notBase, ["NOT", majorFactId]))),
    "NOT_MATCH"
  );

  const andBase = majorSet("logic-and", "专业不限");
  const qualification = genericFact(andBase, "logic-and-qualification",
    "PROFESSIONAL_QUALIFICATION", {
      kind: "PROFESSIONAL_QUALIFICATION",
      qualification_type: "LEGAL_PROFESSIONAL",
      qualification_class: "A",
      strength: "REQUIRED"
    });
  const andFixture = fixtureWithLogic(andBase, [
    andBase.input.facts[0].requirement_fact_id,
    "AND",
    qualification.requirement_fact_id
  ], [andBase.input.facts[0], qualification]);
  assert.equal(
    assessmentResult(evaluate(andFixture, candidate({ qualificationStatus: "NOT_OBTAINED" }))),
    "NOT_MATCH"
  );

  const orBase = majorSet("logic-or", "专业不限");
  const gender = genericFact(orBase, "logic-or-gender", "GENDER", {
    kind: "CODE",
    code: "MALE"
  });
  const orQualification = genericFact(orBase, "logic-or-qualification",
    "PROFESSIONAL_QUALIFICATION", {
      kind: "PROFESSIONAL_QUALIFICATION",
      qualification_type: "LEGAL_PROFESSIONAL",
      qualification_class: "A",
      strength: "REQUIRED"
    });
  const orFixture = fixtureWithLogic(orBase, [
    gender.requirement_fact_id,
    "OR",
    orQualification.requirement_fact_id
  ], [gender, orQualification]);
  assert.equal(
    assessmentResult(evaluate(orFixture, candidate({
      gender: "FEMALE",
      qualificationStatus: "NOT_OBTAINED"
    }))),
    "NOT_MATCH"
  );

  const nestedBase = majorSet("logic-nested", "专业不限");
  const nestedGender = genericFact(nestedBase, "logic-nested-gender", "GENDER", {
    kind: "CODE",
    code: "MALE"
  });
  const nestedQualification = genericFact(nestedBase, "logic-nested-qualification",
    "PROFESSIONAL_QUALIFICATION", {
      kind: "PROFESSIONAL_QUALIFICATION",
      qualification_type: "LEGAL_PROFESSIONAL",
      qualification_class: "A",
      strength: "REQUIRED"
    });
  const nestedFixture = fixtureWithLogic(nestedBase, [
    nestedBase.input.facts[0].requirement_fact_id,
    "AND",
    "LPAREN",
    nestedGender.requirement_fact_id,
    "OR",
    nestedQualification.requirement_fact_id,
    "RPAREN"
  ], [
    nestedBase.input.facts[0],
    nestedGender,
    nestedQualification
  ]);
  assert.equal(
    assessmentResult(evaluate(nestedFixture, candidate({
      gender: "FEMALE",
      qualificationStatus: "OBTAINED"
    }))),
    "MATCH"
  );

  const andNotBase = majorSet("logic-and-not", "专业不限");
  const andNotGender = genericFact(andNotBase, "logic-and-not-gender", "GENDER", {
    kind: "CODE",
    code: "MALE"
  });
  const andNotFixture = fixtureWithLogic(andNotBase, [
    andNotBase.input.facts[0].requirement_fact_id,
    "AND",
    "NOT",
    andNotGender.requirement_fact_id
  ], [andNotBase.input.facts[0], andNotGender]);
  assert.equal(
    assessmentResult(evaluate(andNotFixture, candidate({ gender: "FEMALE" }))),
    "MATCH"
  );
});

test("CR#10 executes selectors, candidate-state applicability, and non-mandatory clauses", () => {
  const conditional = conditionalFixture(majorSet("conditional", "专业不限"));
  assert.equal(
    assessmentResult(evaluate(conditional, candidate({
      candidateCohorts: ["FRESH_GRADUATE"]
    }))),
    "MATCH"
  );
  assert.equal(
    assessmentResult(evaluate(conditional, candidate({
      candidateCohorts: ["SOCIAL_CANDIDATE"],
      gender: "FEMALE"
    }))),
    "MATCH"
  );
  assert.equal(
    assessmentResult(evaluate(conditional, candidate({
      candidateCohorts: ["SOCIAL_CANDIDATE"],
      gender: "MALE"
    }))),
    "NOT_MATCH"
  );
  assert.equal(assessmentResult(evaluate(conditional)), "INSUFFICIENT");

  const cohortBound = fixtureWithStateApplicability(
    majorSet("cohort-applicability", "专业不限")
  );
  assert.equal(
    assessmentResult(evaluate(cohortBound, candidate({
      candidateCohorts: ["FRESH_GRADUATE"]
    }))),
    "MATCH"
  );
  assert.equal(
    assessmentResult(evaluate(cohortBound, candidate({
      candidateCohorts: ["SOCIAL_CANDIDATE"]
    }))),
    "MATCH"
  );
  assert.equal(assessmentResult(evaluate(cohortBound)), "INSUFFICIENT");

  for (const modality of ["PREFERRED", "OPTIONAL", "INFORMATIONAL"] as const) {
    const nonMandatory = fixtureWithModality(
      majorSet(`modality-${modality}`, "法律硕士（非法学）", {
        relationKind: "EXACT_IDENTITY"
      }),
      modality
    );
    assert.equal(
      assessmentResult(evaluate(nonMandatory, candidate({ masterCompleteness: "UNKNOWN" }))),
      "MATCH",
      modality
    );
  }
});

test("CR#10 keeps Position, Batch, Plan, and Location bindings isolated", () => {
  const base = majorSet("context-base", "专业不限");
  const positionVersionId = base.input.context_bindings[0].source_context_target;
  if (positionVersionId.kind !== "POSITION_VERSION") {
    throw new Error("Expected PositionVersion source target");
  }
  const targets: readonly RequirementContextTarget[] = [
    positionVersionId,
    {
      kind: "RECRUITMENT_BATCH",
      recruitment_batch_id: branded<RecruitmentBatchId>("batch-context")
    },
    {
      kind: "RECRUITMENT_PLAN",
      recruitment_plan_id: branded<RecruitmentPlanId>("plan-context")
    },
    {
      kind: "LOCATION_ASSIGNMENT",
      location_assignment_id: branded<LocationAssignmentId>("location-context")
    }
  ];
  for (const target of targets) {
    const fixture = fixtureWithContextTarget(base, target);
    const blocked = evaluate(fixture);
    assert.equal(blocked.status, "NOT_ALLOWED", target.kind);
    assert.equal(blocked.reason, "CONTEXT_BINDING_MISMATCH", target.kind);
    assert.equal(
      assessmentResult(evaluate(fixture, candidate(), {
        context: [...fixture.context, target]
      })),
      "MATCH",
      target.kind
    );
  }
});

test("CR#10 blocks source-unresolved OR, capability and manifest mutation, and legacy structured dispatch", () => {
  const sourceUnresolvedOr = majorSet("source-unresolved-or", "专业不限", {
    externalBlockers: [{
      code: "AMBIGUOUS",
      diagnostic_code: "LOGIC_CONNECTOR_UNRESOLVED",
      observation_ids: [],
      evidence_fragment_ids: [],
      description: "synthetic unresolved OR branch"
    }]
  });
  const blockedBySource = evaluate(sourceUnresolvedOr);
  assert.equal(blockedBySource.status, "NOT_ALLOWED");
  assert.equal(blockedBySource.reason, "REQUIREMENT_SET_NOT_COMPLETE");

  const valid = majorSet("manifest-and-legacy", "法律硕士（非法学）", {
    relationKind: "EXACT_IDENTITY"
  });
  assert.ok(valid.set.execution_manifest.required_engine_capabilities.includes(
    "CR10_MAJOR_MATCH_RELATION_V1"
  ));
  const mutatedManifest = structuredClone(valid.set);
  (mutatedManifest.execution_manifest.required_engine_capabilities as unknown as string[])
    .splice(0, 1);
  const manifestFailure = engine.evaluateStructured({
    model: "CR12_STRUCTURED_LOGIC_V1",
    structured_requirement_set: mutatedManifest,
    opportunity_version: valid.opportunity,
    recruitment_context_snapshot: {
      opportunity_version_id: valid.opportunity.opportunity_version_id,
      effective_targets: valid.context
    },
    candidate_profile: candidate(),
    assessed_at: branded<IsoDateTime>("2026-09-06T00:00:00.000Z")
  });
  assert.equal(manifestFailure.status, "NOT_ALLOWED");
  assert.equal(manifestFailure.reason, "CONTENT_HASH_MANIFEST_MISMATCH");
  assert.throws(
    () => engine.evaluate({
      complete_requirement_set: valid.set as never,
      opportunity_version: valid.opportunity,
      candidate_profile: candidate(),
      assessed_at: branded<IsoDateTime>("2026-09-06T00:00:00.000Z")
    }),
    (error) => error instanceof EligibilityInputError
      && error.code === "STRUCTURED_REQUIREMENT_SET_UNSUPPORTED"
  );
});

test("CR#10 trusts only the exact verified Composition Result and never emits NOT_MATCH on gate failure", () => {
  const valid = majorSet("composition-gate-valid", "法律硕士（非法学）", {
    relationKind: "EXACT_IDENTITY"
  });
  const reference = valid.set.source_composition_reference;
  assert.ok(reference);
  const compositionResult = valid.input.source_composition_result;
  assert.ok(compositionResult);
  const dispatch = (selectedEngine: DeterministicEligibilityEngine) => {
    return selectedEngine.evaluateStructured({
      model: "CR12_STRUCTURED_LOGIC_V1",
      structured_requirement_set: valid.set,
      opportunity_version: valid.opportunity,
      recruitment_context_snapshot: {
        opportunity_version_id: valid.opportunity.opportunity_version_id,
        effective_targets: valid.context
      },
      candidate_profile: candidate(),
      assessed_at: branded<IsoDateTime>("2026-09-06T00:00:00.000Z")
    });
  };

  const unavailable = dispatch(new DeterministicEligibilityEngine());
  assert.equal(unavailable.status, "NOT_ALLOWED");
  assert.equal(unavailable.reason, "SOURCE_COMPOSITION_GATE_UNAVAILABLE");

  const missing = dispatch(new DeterministicEligibilityEngine({
    resolve() {
      return null;
    },
    verify: verifyComposition
  }));
  assert.equal(missing.status, "NOT_ALLOWED");
  assert.equal(missing.reason, "SOURCE_COMPOSITION_NOT_FOUND");

  const corrupted = structuredClone(compositionResult) as typeof compositionResult;
  (corrupted.source_surfaces[0] as { parser_version: string }).parser_version =
    "corrupted-parser/2";
  const verificationFailure = dispatch(new DeterministicEligibilityEngine({
    resolve() {
      return corrupted;
    },
    verify: verifyComposition
  }));
  assert.equal(verificationFailure.status, "NOT_ALLOWED");
  assert.equal(
    verificationFailure.reason,
    "SOURCE_COMPOSITION_VERIFICATION_FAILED"
  );

  const other = majorSet("composition-gate-other", "法律硕士（非法学）", {
    relationKind: "EXACT_IDENTITY"
  });
  const otherComposition = other.input.source_composition_result;
  assert.ok(otherComposition);
  const mismatch = dispatch(new DeterministicEligibilityEngine({
    resolve() {
      return otherComposition;
    },
    verify: verifyComposition
  }));
  assert.equal(mismatch.status, "NOT_ALLOWED");
  assert.equal(mismatch.reason, "SOURCE_COMPOSITION_REFERENCE_MISMATCH");

  const legacySet = buildCr12StructuredRequirementSet({
    ...valid.input,
    source_composition_result: undefined
  }).structured_requirement_set;
  const legacy = engine.evaluateStructured({
    model: "CR12_STRUCTURED_LOGIC_V1",
    structured_requirement_set: legacySet,
    opportunity_version: valid.opportunity,
    recruitment_context_snapshot: {
      opportunity_version_id: valid.opportunity.opportunity_version_id,
      effective_targets: valid.context
    },
    candidate_profile: candidate(),
    assessed_at: branded<IsoDateTime>("2026-09-06T00:00:00.000Z")
  });
  assert.equal(legacy.status, "NOT_ALLOWED");
  assert.equal(legacy.reason, "SOURCE_COMPOSITION_LEGACY_UNCOMPOSED");
  assert.equal(reference.composition_status, "COMPLETE");
});
