import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  CR12_REQUIREMENT_SERIALIZATION_VERSION,
  CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
  SOURCE_COMPOSITION_SCHEMA_VERSION,
  UTF8_TEXT_ENCODING,
  assertCr12StructuredRequirementSetIntegrity,
  buildCr12RequirementLogicTree,
  buildCr12StructuredRequirementSet,
  buildSourceCompositionResult,
  classifyCr12Connector,
  projectCr9LegacyApplicability,
  projectCr9LegacyFactsToCr12,
  type AnnouncementId,
  type AuthorityAssertionId,
  type CandidateCredentialApplicability,
  type CandidateCredentialApplicabilityId,
  type CandidateStateApplicability,
  type CandidateStateApplicabilityId,
  type ConditionalRequirementBranchSet,
  type ConditionalRequirementBranchSetId,
  type Cr12LogicToken,
  type Cr12RequirementCondition,
  type Cr12RequirementLogicNode,
  type Cr12StructuredRequirementSet,
  type Cr12StructuredRequirementSetInput,
  type DiscoveryBoundaryId,
  type EvidenceLocator,
  type ExtractedRecordId,
  type IsoDateTime,
  type LocationAssignmentId,
  type LogicGroupId,
  type NonEmptyReadonlyArray,
  type OpportunityVersionId,
  type OriginalText,
  type PositionVersionId,
  type RecruitmentBatchId,
  type RequirementConditionId,
  type RequirementContextBinding,
  type RequirementContextBindingId,
  type RequirementEvidence,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type RequirementEvidenceId,
  type RequirementFact,
  type RequirementFactId,
  type RequirementLogicTreeId,
  type RequirementMandatoryRootId,
  type RequirementObservation,
  type RequirementObservationId,
  type RequirementSelectorPredicate,
  type RequirementSelectorPredicateId,
  type RequirementSourceReferenceId,
  type SelectorLogicNodeId,
  type SelectorLogicTree,
  type SelectorLogicTreeId,
  type SnapshotId,
  type SourceCompositionEvidenceId,
  type SourceCompositionInput,
  type SourceOccurrenceVersionId,
  type SourcePackageInventoryId,
  type SourcePrecedenceDecisionId,
  type SourceSurfaceBindingId,
  type SourceSurfaceId,
  type SourceVersionSelectionId
} from "../../lib/ingestion";

const parserVersion = CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION;
const resolverVersion = "cr12-context-resolver/1.0.0";
const serializationVersion = CR12_REQUIREMENT_SERIALIZATION_VERSION;

function branded<Value extends string>(value: string) {
  return value as Value;
}

function nonEmpty<Value>(values: readonly Value[]) {
  assert.ok(values.length > 0);
  return values as NonEmptyReadonlyArray<Value>;
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function locator(suffix: string): EvidenceLocator {
  return {
    kind: "SPREADSHEET",
    sheet: "岗位表",
    cell_or_range: `H${suffix}`,
    field_path: "requirements"
  };
}

function logicTokens(
  tokens: readonly ("A" | "B" | "C" | "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN")[],
  suffix = "logic"
): NonEmptyReadonlyArray<Cr12LogicToken> {
  const bindingId = branded<RequirementContextBindingId>(`binding-${suffix}`);
  const fragmentId = branded<RequirementEvidenceFragmentId>(`fragment-${suffix}`);
  return nonEmpty(tokens.map((token, sourceOrder): Cr12LogicToken => {
    const shared = {
      context_binding_ids: nonEmpty([bindingId]),
      evidence_fragment_ids: nonEmpty([fragmentId]),
      source_order: sourceOrder
    };
    return token === "A" || token === "B" || token === "C"
      ? {
          ...shared,
          kind: "PREDICATE",
          requirement_fact_id: branded<RequirementFactId>(`fact-${suffix}-${token}`)
        }
      : { ...shared, kind: token };
  }));
}

function resolvedTree(
  tokens: Parameters<typeof logicTokens>[0],
  suffix: string
) {
  const built = buildCr12RequirementLogicTree({
    requirement_condition_id: branded<RequirementConditionId>(`condition-${suffix}`),
    requirement_logic_tree_id: branded<RequirementLogicTreeId>(`tree-${suffix}`),
    tokens: logicTokens(tokens, suffix),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  if (built.status !== "RESOLVED") throw new Error(built.message);
  assert.equal(built.status, "RESOLVED");
  return built.tree;
}

function node(
  tree: ReturnType<typeof resolvedTree>,
  nodeId: Cr12RequirementLogicNode["requirement_logic_node_id"]
) {
  const found = tree.nodes.find((item) => item.requirement_logic_node_id === nodeId);
  assert.ok(found);
  return found;
}

interface BaseInputOptions {
  readonly suffix?: string;
  readonly modality?: Cr12RequirementCondition["modality"];
  readonly credentialApplicability?: CandidateCredentialApplicability;
  readonly stateApplicability?: CandidateStateApplicability;
  readonly contextBinding?: RequirementContextBinding;
}

function baseInput(options: BaseInputOptions = {}): Cr12StructuredRequirementSetInput {
  const suffix = options.suffix ?? "base";
  const opportunityVersionId = branded<OpportunityVersionId>(`opportunity-version-${suffix}`);
  const positionVersionId = branded<PositionVersionId>(`position-version-${suffix}`);
  const conditionId = branded<RequirementConditionId>(`condition-${suffix}`);
  const treeId = branded<RequirementLogicTreeId>(`tree-${suffix}`);
  const factId = branded<RequirementFactId>(`fact-${suffix}`);
  const fragmentId = branded<RequirementEvidenceFragmentId>(`fragment-${suffix}`);
  const bindingId = branded<RequirementContextBindingId>(`binding-${suffix}`);
  const sourceId = branded<RequirementSourceReferenceId>(`source-${suffix}`);
  const credentialId = branded<CandidateCredentialApplicabilityId>(`credential-${suffix}`);
  const stateId = branded<CandidateStateApplicabilityId>(`state-${suffix}`);
  const snapshotId = branded<SnapshotId>(`snapshot-${suffix}`);
  const extractedRecordId = branded<ExtractedRecordId>(`record-${suffix}`);
  const sourceLocator = locator(suffix);
  const evidenceFragment: RequirementEvidenceFragment = {
    requirement_evidence_fragment_id: fragmentId,
    extracted_record_id: extractedRecordId,
    snapshot_id: snapshotId,
    locator: {
      kind: "SPREADSHEET",
      sheet: "岗位表",
      cell_or_range: `H${suffix}`,
      field_path: "requirements"
    },
    observed_value_state: "TEXT",
    original_text: original("学历要求：本科及以上"),
    extractor_name: "synthetic-cr12-fixture",
    extractor_version: "1.0.0",
    parser_version: parserVersion
  };
  const fact: RequirementFact = {
    requirement_fact_id: factId,
    opportunity_version_id: opportunityVersionId,
    dimension: "EDUCATION_LEVEL",
    operator: "AT_LEAST",
    value: { kind: "CODE", code: "BACHELOR" },
    subject_scope: "CANDIDATE",
    logic_group: {
      logic_group_id: branded<LogicGroupId>(`legacy-group-${suffix}`),
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    parser_version: parserVersion
  };
  const built = buildCr12RequirementLogicTree({
    requirement_condition_id: conditionId,
    requirement_logic_tree_id: treeId,
    tokens: nonEmpty([{
      kind: "PREDICATE",
      requirement_fact_id: factId,
      context_binding_ids: nonEmpty([bindingId]),
      evidence_fragment_ids: nonEmpty([fragmentId]),
      source_order: 0
    }]),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  if (built.status !== "RESOLVED") throw new Error(built.message);
  assert.equal(built.status, "RESOLVED");

  const credentialApplicability: CandidateCredentialApplicability =
    options.credentialApplicability ?? {
      candidate_credential_applicability_id: credentialId,
      mode: "CANDIDATE_WIDE",
      evidence_fragment_ids: [fragmentId],
      certainty: "EXPLICIT",
      parser_version: parserVersion
    };
  const stateApplicability: CandidateStateApplicability =
    options.stateApplicability ?? {
      candidate_state_applicability_id: stateId,
      mode: "ALL_CANDIDATES",
      evidence_fragment_ids: [fragmentId],
      certainty: "EXPLICIT",
      parser_version: parserVersion
    };
  const contextBinding: RequirementContextBinding = options.contextBinding ?? {
    requirement_context_binding_id: bindingId,
    opportunity_version_id: opportunityVersionId,
    source_context_target: {
      kind: "POSITION_VERSION",
      position_version_id: positionVersionId
    },
    effective_targets: nonEmpty([{
      kind: "OPPORTUNITY_VERSION",
      opportunity_version_id: opportunityVersionId
    }]),
    scope: "EXACT_TARGET",
    state: "RESOLVED",
    certainty: "EXPLICIT",
    source_locator: sourceLocator,
    evidence_fragment_ids: nonEmpty([fragmentId]),
    identity_evidence_ids: [],
    resolver_version: resolverVersion
  };
  const condition: Cr12RequirementCondition = {
    requirement_condition_id: conditionId,
    opportunity_version_id: opportunityVersionId,
    modality: options.modality ?? "MANDATORY",
    resolution_state: "RESOLVED",
    representation_kind: "LOGIC_TREE",
    requirement_logic_tree_id: treeId,
    candidate_credential_applicability_id:
      credentialApplicability.candidate_credential_applicability_id,
    candidate_state_applicability_id:
      stateApplicability.candidate_state_applicability_id,
    context_binding_ids: nonEmpty([contextBinding.requirement_context_binding_id]),
    source_reference_ids: nonEmpty([sourceId]),
    evidence_fragment_ids: nonEmpty([fragmentId]),
    source_locator: sourceLocator,
    source_order: 0,
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    projected_from_legacy_fact_ids: [],
    projected_from_legacy_evidence_ids: []
  };
  const requirementEvidence: RequirementEvidence = {
    requirement_evidence_id: branded<RequirementEvidenceId>(`evidence-${suffix}`),
    requirement_fact_id: factId,
    snapshot_id: snapshotId,
    locator: sourceLocator,
    evidence_text: original("学历要求：本科及以上"),
    extractor_name: "synthetic-cr12-fixture",
    extractor_version: "1.0.0",
    parser_version: parserVersion
  };
  const observation: RequirementObservation = {
    requirement_observation_id: branded<RequirementObservationId>(`observation-${suffix}`),
    opportunity_version_id: opportunityVersionId,
    status: "CONFIRMED_REQUIREMENT",
    clause_role: options.modality === "PREFERRED" ? "PREFERRED" : "MANDATORY",
    dimension_hint: "EDUCATION_LEVEL",
    requirement_fact_ids: [factId],
    evidence_fragment_ids: nonEmpty([fragmentId]),
    parser_version: parserVersion
  };

  return {
    opportunity_version_id: opportunityVersionId,
    mandatory_root: condition.modality === "MANDATORY"
      ? {
          requirement_mandatory_root_id:
            branded<RequirementMandatoryRootId>(`mandatory-root-${suffix}`),
          kind: "SINGLE",
          requirement_condition_id: conditionId
        }
      : {
          requirement_mandatory_root_id:
            branded<RequirementMandatoryRootId>(`mandatory-root-${suffix}`),
          kind: "EMPTY_CONFIRMED",
          evidence_fragment_ids: nonEmpty([fragmentId])
        },
    conditions: [condition],
    requirement_logic_trees: [built.tree],
    facts: [fact],
    candidate_credential_applicabilities: [credentialApplicability],
    candidate_state_applicabilities: [stateApplicability],
    context_bindings: [contextBinding],
    source_references: [{
      requirement_source_reference_id: sourceId,
      snapshot_id: snapshotId,
      extracted_record_id: extractedRecordId,
      source_role: "POSITION_TABLE_ROW",
      source_context_target: {
        kind: "POSITION_VERSION",
        position_version_id: positionVersionId
      },
      applicable_binding_ids: nonEmpty([contextBinding.requirement_context_binding_id]),
      binding_evidence_fragment_ids: nonEmpty([fragmentId]),
      identity_evidence_ids: [],
      source_locator: sourceLocator,
      relationship: {
        kind: "ORIGINAL",
        target_source_reference_ids: [],
        evidence_fragment_ids: [fragmentId],
        resolver_version: resolverVersion
      },
      binding_state: "RESOLVED",
      binding_certainty: "EXPLICIT",
      extractor_version: "1.0.0",
      parser_version: parserVersion,
      resolver_version: resolverVersion
    }],
    selector_predicates: [],
    selector_logic_trees: [],
    conditional_branch_sets: [],
    evidence_fragments: [evidenceFragment],
    requirement_evidence: [requirementEvidence],
    observations: [observation],
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    serialization_version: serializationVersion
  };
}

function compositionBackedInput(
  input: Cr12StructuredRequirementSetInput
): Cr12StructuredRequirementSetInput {
  const source = input.source_references[0];
  const sourceSurfaceId = branded<SourceSurfaceId>(
    `source-surface-${source.requirement_source_reference_id}`
  );
  const evidenceId = branded<SourceCompositionEvidenceId>(
    `source-composition-evidence-${source.requirement_source_reference_id}`
  );
  const bindingId = branded<SourceSurfaceBindingId>(
    `source-composition-binding-${source.requirement_source_reference_id}`
  );
  const authorityId = branded<AuthorityAssertionId>(
    `source-composition-authority-${source.requirement_source_reference_id}`
  );
  const selectionId = branded<SourceVersionSelectionId>(
    `source-composition-selection-${source.requirement_source_reference_id}`
  );
  const asOf = branded<IsoDateTime>("2026-09-06T00:00:00.000Z");
  const compositionInput: SourceCompositionInput = {
    opportunity_version_id: input.opportunity_version_id,
    composition_as_of: asOf,
    discovery_boundary: {
      discovery_boundary_id: branded<DiscoveryBoundaryId>(
        `source-composition-boundary-${input.opportunity_version_id}`
      ),
      opportunity_version_id: input.opportunity_version_id,
      boundary_kind: "POSITION_PACKAGE",
      initiating_source_surface_ids: [sourceSurfaceId],
      source_metadata_references: ["synthetic-official-package"],
      discovery_scope: "synthetic source composition package",
      admissible_relation_kinds: ["ORIGINAL"],
      evidence_ids: [evidenceId],
      composition_as_of: asOf,
      observed_at: asOf,
      extractor_version: "synthetic-composition-extractor/1",
      discovery_resolver_version: "synthetic-composition-discovery/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    inventory: {
      source_package_inventory_id: branded<SourcePackageInventoryId>(
        `source-composition-inventory-${input.opportunity_version_id}`
      ),
      discovery_boundary_id: branded<DiscoveryBoundaryId>(
        `source-composition-boundary-${input.opportunity_version_id}`
      ),
      composition_as_of: asOf,
      discovered_source_surface_ids: [sourceSurfaceId],
      expected_surface_entries: [{
        expected_surface_manifest_entry_id: branded(
          `source-composition-entry-${source.requirement_source_reference_id}`
        ),
        expected_surface_key: `source-${source.requirement_source_reference_id}`,
        source_surface_id: sourceSurfaceId,
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
        evidence_ids: [evidenceId]
      }],
      inventory_completeness_status: "CLOSED",
      unexpected_surface_dispositions: [],
      discovery_resolver_version: "synthetic-composition-discovery/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    },
    evidence_registry: [{
      source_composition_evidence_id: evidenceId,
      snapshot_id: source.snapshot_id,
      extracted_record_id: source.extracted_record_id,
      source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
        `source-composition-occurrence-${source.requirement_source_reference_id}`
      ),
      locator: source.source_locator,
      observed_at: asOf,
      extractor_version: "synthetic-composition-extractor/1"
    }],
    source_surfaces: [{
      source_surface_id: sourceSurfaceId,
      surface_kind: "POSITION_TABLE_ROW",
      source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
        `source-composition-occurrence-${source.requirement_source_reference_id}`
      ),
      snapshot_id: source.snapshot_id,
      extracted_record_id: source.extracted_record_id,
      locator: source.source_locator,
      surface_content_hash: `source-content-${source.requirement_source_reference_id}`,
      effective_period: { effective_from: asOf },
      source_publication_time: asOf,
      observed_at: asOf,
      surface_status: "PARSED",
      composition_role: "PRIMARY",
      target_scope: `opportunity-version:${input.opportunity_version_id}`,
      evidence_ids: [evidenceId],
      extractor_version: "synthetic-composition-extractor/1",
      parser_version: "synthetic-composition-parser/1",
      resolver_version: "synthetic-composition-resolver/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_surface_bindings: [{
      source_surface_binding_id: bindingId,
      source_surface_id: sourceSurfaceId,
      target_type: "OPPORTUNITY_VERSION",
      target_id: input.opportunity_version_id,
      target_version_id: input.opportunity_version_id,
      binding_kind: "SURFACE_DECLARATION",
      binding_status: "RESOLVED",
      evidence_ids: [evidenceId],
      created_context: {
        source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
          `source-composition-occurrence-${source.requirement_source_reference_id}`
        ),
        snapshot_id: source.snapshot_id,
        extracted_record_id: source.extracted_record_id,
        observed_at: asOf,
        resolver_version: "synthetic-composition-resolver/1"
      },
      observed_context: {
        source_occurrence_version_id: branded<SourceOccurrenceVersionId>(
          `source-composition-occurrence-${source.requirement_source_reference_id}`
        ),
        snapshot_id: source.snapshot_id,
        extracted_record_id: source.extracted_record_id,
        observed_at: asOf,
        resolver_version: "synthetic-composition-resolver/1"
      },
      locator: source.source_locator,
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    authority_assertions: [{
      authority_assertion_id: authorityId,
      asserted_source_surface_id: sourceSurfaceId,
      authority_basis_source_surface_id: sourceSurfaceId,
      issuer: "synthetic-official-publisher",
      authority_state: "OFFICIAL_AUTHORITATIVE",
      target_scope: `opportunity-version:${input.opportunity_version_id}`,
      effective_period: { effective_from: asOf },
      evidence_ids: [evidenceId],
      resolver_version: "synthetic-composition-authority/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_version_selections: [{
      source_version_selection_id: selectionId,
      source_identity: `source-${source.requirement_source_reference_id}`,
      target_scope: `opportunity-version:${input.opportunity_version_id}`,
      candidate_source_surface_ids: [sourceSurfaceId],
      selected_source_surface_id: sourceSurfaceId,
      excluded_source_surface_ids: [],
      selection_status: "RESOLVED",
      source_publication_time: asOf,
      effective_period: { effective_from: asOf },
      observation_time: asOf,
      ingestion_time: asOf,
      evidence_ids: [evidenceId],
      resolver_version: "synthetic-composition-selection/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    surface_revision_relations: [],
    precedence_decisions: [{
      precedence_decision_id: branded<SourcePrecedenceDecisionId>(
        `source-composition-precedence-${source.requirement_source_reference_id}`
      ),
      selected_source_surface_ids: [sourceSurfaceId],
      excluded_source_surface_ids: [],
      applicable_scope: `opportunity-version:${input.opportunity_version_id}`,
      effective_period: { effective_from: asOf },
      composition_as_of: asOf,
      authority_assertion_ids: [authorityId],
      precedence_rule: "EXACT_TARGET_SCOPE",
      evidence_ids: [evidenceId],
      decision_status: "RESOLVED",
      resolver_version: "synthetic-composition-precedence/1",
      schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION
    }],
    source_conflicts: [],
    extractor_version: "synthetic-composition-extractor/1",
    parser_version: "synthetic-composition-parser/1",
    discovery_resolver_version: "synthetic-composition-discovery/1",
    composition_resolver_version: "synthetic-composition-resolver/1",
    schema_version: SOURCE_COMPOSITION_SCHEMA_VERSION,
    serialization_version: "synthetic-composition-serialization/1"
  };
  return {
    ...input,
    source_references: [{ ...source, source_surface_id: sourceSurfaceId }],
    source_composition_result: buildSourceCompositionResult(compositionInput)
  };
}

function conditionalInput(options: {
  readonly suffix: string;
  readonly withElse?: boolean;
  readonly selectorResolution?: "RESOLVED" | "UNRESOLVED";
  readonly branchResolution?: "RESOLVED" | "UNRESOLVED";
}): Cr12StructuredRequirementSetInput {
  const input = baseInput({ suffix: options.suffix });
  const condition = input.conditions[0];
  const bindingId = input.context_bindings[0].requirement_context_binding_id;
  const fragmentId = input.evidence_fragments[0].requirement_evidence_fragment_id;
  const branchSetId = branded<ConditionalRequirementBranchSetId>(
    `branch-set-${options.suffix}`
  );
  const selectorPredicateId = branded<RequirementSelectorPredicateId>(
    `selector-predicate-${options.suffix}`
  );
  const selectorTreeId = branded<SelectorLogicTreeId>(
    `selector-tree-${options.suffix}`
  );
  const selectorNodeId = branded<SelectorLogicNodeId>(
    `selector-node-${options.suffix}`
  );
  const selectorPredicate: RequirementSelectorPredicate = {
    requirement_selector_predicate_id: selectorPredicateId,
    conditional_branch_set_id: branchSetId,
    opportunity_version_id: input.opportunity_version_id,
    dimension: "CANDIDATE_COHORT",
    operator: "ONE_OF",
    value: { kind: "CODE_SET", codes: ["FRESH_GRADUATE"] },
    candidate_credential_applicability_id:
      input.candidate_credential_applicabilities[0]
        .candidate_credential_applicability_id,
    direct_candidate_cohorts: nonEmpty(["FRESH_GRADUATE"]),
    context_binding_ids: nonEmpty([bindingId]),
    evidence_fragment_ids: nonEmpty([fragmentId]),
    source_locator: condition.source_locator,
    parser_version: parserVersion,
    resolution_state: options.selectorResolution ?? "RESOLVED"
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

  const elseFactId = branded<RequirementFactId>(`fact-${options.suffix}-else`);
  const elseTreeId = branded<RequirementLogicTreeId>(`tree-${options.suffix}-else`);
  const elseFact: RequirementFact = {
    ...input.facts[0],
    requirement_fact_id: elseFactId,
    dimension: "WORK_EXPERIENCE",
    operator: "AT_LEAST",
    value: {
      kind: "WORK_EXPERIENCE",
      minimum_years: 2,
      experience_scope: {
        text: "法律相关工作",
        unicode_form: "NFKC",
        normalizer_version: "synthetic/1",
        operations: []
      },
      scope_definition: "EXPLICIT"
    }
  };
  const builtElse = buildCr12RequirementLogicTree({
    requirement_condition_id: condition.requirement_condition_id,
    requirement_logic_tree_id: elseTreeId,
    tokens: nonEmpty([{
      kind: "PREDICATE",
      requirement_fact_id: elseFactId,
      context_binding_ids: nonEmpty([bindingId]),
      evidence_fragment_ids: nonEmpty([fragmentId]),
      source_order: 0
    }]),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  if (builtElse.status !== "RESOLVED") throw new Error(builtElse.message);
  assert.equal(builtElse.status, "RESOLVED");

  const includeElse = options.withElse ?? true;
  const branchSet: ConditionalRequirementBranchSet = {
    conditional_branch_set_id: branchSetId,
    requirement_condition_id: condition.requirement_condition_id,
    when_selector_logic_tree_id: selectorTreeId,
    then_requirement_logic_tree_id:
      input.requirement_logic_trees[0].requirement_logic_tree_id,
    ...(includeElse
      ? { else_requirement_logic_tree_id: elseTreeId }
      : {}),
    candidate_credential_applicability_id:
      condition.candidate_credential_applicability_id,
    candidate_state_applicability_id:
      condition.candidate_state_applicability_id,
    context_binding_ids: nonEmpty([bindingId]),
    evidence_fragment_ids: nonEmpty([fragmentId]),
    branch_semantics_state: options.branchResolution ?? "RESOLVED",
    source_order: 0,
    parser_version: parserVersion,
    resolver_version: resolverVersion
  };
  const conditionalCondition: Cr12RequirementCondition = {
    ...condition,
    resolution_state: "RESOLVED",
    representation_kind: "CONDITIONAL_BRANCH_SET",
    conditional_branch_set_id: branchSetId
  };
  const facts = includeElse ? [...input.facts, elseFact] : input.facts;
  const requirementEvidence = includeElse
    ? [...input.requirement_evidence, {
        ...input.requirement_evidence[0],
        requirement_evidence_id:
          branded<RequirementEvidenceId>(`evidence-${options.suffix}-else`),
        requirement_fact_id: elseFactId
      }]
    : input.requirement_evidence;
  const observations = includeElse
    ? [{
        ...input.observations[0],
        requirement_fact_ids: [input.facts[0].requirement_fact_id, elseFactId]
      }]
    : input.observations;

  return {
    ...input,
    conditions: [conditionalCondition],
    requirement_logic_trees: includeElse
      ? [input.requirement_logic_trees[0], builtElse.tree]
      : input.requirement_logic_trees,
    facts,
    requirement_evidence: requirementEvidence,
    observations,
    selector_predicates: [selectorPredicate],
    selector_logic_trees: [selectorTree],
    conditional_branch_sets: [branchSet]
  };
}

function validationCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? (error as { readonly code: unknown }).code
    : undefined;
}

test("Control A — A AND B preserves an ordered binary AND tree", () => {
  const tree = resolvedTree(["A", "AND", "B"], "control-a");
  const root = node(tree, tree.root_node_id);
  assert.equal(root.kind, "GROUP");
  if (root.kind !== "GROUP") return;
  assert.equal(root.operator, "AND");
  assert.deepEqual(root.child_node_ids.map((childId) => {
    const child = node(tree, childId);
    return child.kind === "PREDICATE" ? child.requirement_fact_id : child.kind;
  }), ["fact-control-a-A", "fact-control-a-B"]);
});

test("Control B — A OR B preserves both ordered alternatives", () => {
  const tree = resolvedTree(["A", "OR", "B"], "control-b");
  const root = node(tree, tree.root_node_id);
  assert.equal(root.kind, "GROUP");
  if (root.kind !== "GROUP") return;
  assert.equal(root.operator, "OR");
  assert.equal(root.child_node_ids.length, 2);
});

test("Control C — A AND (B OR C) preserves explicit nesting", () => {
  const tree = resolvedTree(
    ["A", "AND", "LPAREN", "B", "OR", "C", "RPAREN"],
    "control-c"
  );
  const root = node(tree, tree.root_node_id);
  assert.equal(root.kind, "GROUP");
  if (root.kind !== "GROUP") return;
  assert.equal(root.operator, "AND");
  const right = node(tree, root.child_node_ids[1]);
  assert.equal(right.kind, "GROUP");
  if (right.kind === "GROUP") assert.equal(right.operator, "OR");
});

test("Control D — NOT A has exactly one positive predicate child", () => {
  const tree = resolvedTree(["NOT", "A"], "control-d");
  const root = node(tree, tree.root_node_id);
  assert.equal(root.kind, "NOT");
  if (root.kind !== "NOT") return;
  assert.equal(node(tree, root.child_node_id).kind, "PREDICATE");
});

test("Control E — A AND NOT B keeps NOT scoped to B", () => {
  const tree = resolvedTree(["A", "AND", "NOT", "B"], "control-e");
  const root = node(tree, tree.root_node_id);
  assert.equal(root.kind, "GROUP");
  if (root.kind !== "GROUP") return;
  const right = node(tree, root.child_node_ids[1]);
  assert.equal(right.kind, "NOT");
});

test("Control F — multi-level parentheses resolve exactly and unmatched scope blocks", () => {
  const tree = resolvedTree(
    ["LPAREN", "A", "OR", "B", "RPAREN", "AND", "NOT", "C"],
    "control-f"
  );
  assert.equal(node(tree, tree.root_node_id).kind, "GROUP");
  const unresolved = buildCr12RequirementLogicTree({
    requirement_condition_id: branded<RequirementConditionId>("condition-f-bad"),
    requirement_logic_tree_id: branded<RequirementLogicTreeId>("tree-f-bad"),
    tokens: logicTokens(["LPAREN", "A", "OR", "B"], "control-f-bad"),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  assert.equal(unresolved.status, "UNRESOLVED");
});

test("Control G — child order remains source ordered", () => {
  const leftFirst = resolvedTree(["A", "OR", "B"], "control-g-left");
  const rightFirst = resolvedTree(["B", "OR", "A"], "control-g-right");
  const leftRoot = node(leftFirst, leftFirst.root_node_id);
  const rightRoot = node(rightFirst, rightFirst.root_node_id);
  assert.equal(leftRoot.kind, "GROUP");
  assert.equal(rightRoot.kind, "GROUP");
  if (leftRoot.kind !== "GROUP" || rightRoot.kind !== "GROUP") return;
  const firstLeft = node(leftFirst, leftRoot.child_node_ids[0]);
  const firstRight = node(rightFirst, rightRoot.child_node_ids[0]);
  assert.equal(firstLeft.kind, "PREDICATE");
  assert.equal(firstRight.kind, "PREDICATE");
  if (firstLeft.kind === "PREDICATE") {
    assert.equal(firstLeft.requirement_fact_id, "fact-control-g-left-A");
  }
  if (firstRight.kind === "PREDICATE") {
    assert.equal(firstRight.requirement_fact_id, "fact-control-g-right-B");
  }
});

test("Control H — cyclic Requirement graphs are rejected", () => {
  const input = baseInput({ suffix: "control-h" });
  const tree = input.requirement_logic_trees[0];
  const leaf = tree.nodes[0];
  const cyclicNodeId = branded<Cr12RequirementLogicNode["requirement_logic_node_id"]>(
    "node-control-h-cycle"
  );
  const cyclicTree = {
    ...tree,
    root_node_id: cyclicNodeId,
    nodes: nonEmpty([leaf, {
      requirement_logic_node_id: cyclicNodeId,
      requirement_condition_id: tree.requirement_condition_id,
      kind: "GROUP" as const,
      operator: "AND" as const,
      child_node_ids: nonEmpty([leaf.requirement_logic_node_id, cyclicNodeId]),
      context_binding_ids: leaf.context_binding_ids,
      evidence_fragment_ids: leaf.evidence_fragment_ids,
      source_order: 1
    }])
  };
  assert.throws(
    () => buildCr12StructuredRequirementSet({
      ...input,
      requirement_logic_trees: [cyclicTree]
    }),
    (error) => validationCode(error) === "CYCLE_DETECTED"
  );
});

test("Control I — dangling Requirement nodes are rejected", () => {
  const input = baseInput({ suffix: "control-i" });
  const tree = input.requirement_logic_trees[0];
  const danglingRootId = branded<Cr12RequirementLogicNode["requirement_logic_node_id"]>(
    "node-control-i-root"
  );
  const danglingTree = {
    ...tree,
    root_node_id: danglingRootId,
    nodes: nonEmpty([{
      requirement_logic_node_id: danglingRootId,
      requirement_condition_id: tree.requirement_condition_id,
      kind: "NOT" as const,
      child_node_id: branded<Cr12RequirementLogicNode["requirement_logic_node_id"]>(
        "node-control-i-missing"
      ),
      context_binding_ids: tree.nodes[0].context_binding_ids,
      evidence_fragment_ids: tree.nodes[0].evidence_fragment_ids,
      source_order: 0
    }])
  };
  assert.throws(
    () => buildCr12StructuredRequirementSet({
      ...input,
      requirement_logic_trees: [danglingTree]
    }),
    (error) => validationCode(error) === "DANGLING_REFERENCE"
  );
});

test("Control J — a repeated Fact leaf is rejected", () => {
  const built = buildCr12RequirementLogicTree({
    requirement_condition_id: branded<RequirementConditionId>("condition-control-j"),
    requirement_logic_tree_id: branded<RequirementLogicTreeId>("tree-control-j"),
    tokens: logicTokens(["A", "OR", "A"], "control-j"),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  assert.equal(built.status, "UNRESOLVED");
});

test("Control K — unary AND/OR groups are rejected without collapsing", () => {
  const input = baseInput({ suffix: "control-k" });
  const tree = input.requirement_logic_trees[0];
  const leaf = tree.nodes[0];
  const rootId = branded<Cr12RequirementLogicNode["requirement_logic_node_id"]>(
    "node-control-k-root"
  );
  const unaryTree = {
    ...tree,
    root_node_id: rootId,
    nodes: nonEmpty([leaf, {
      requirement_logic_node_id: rootId,
      requirement_condition_id: tree.requirement_condition_id,
      kind: "GROUP" as const,
      operator: "OR" as const,
      child_node_ids: nonEmpty([leaf.requirement_logic_node_id]),
      context_binding_ids: leaf.context_binding_ids,
      evidence_fragment_ids: leaf.evidence_fragment_ids,
      source_order: 1
    }])
  };
  assert.throws(
    () => buildCr12StructuredRequirementSet({
      ...input,
      requirement_logic_trees: [unaryTree]
    }),
    (error) => validationCode(error) === "INVALID_UNARY_GROUP"
  );
});

test("Control L — cross-condition tree ownership is rejected", () => {
  const input = baseInput({ suffix: "control-l" });
  const foreignTree = {
    ...input.requirement_logic_trees[0],
    requirement_condition_id:
      branded<RequirementConditionId>("condition-control-l-foreign")
  };
  assert.throws(
    () => buildCr12StructuredRequirementSet({
      ...input,
      requirement_logic_trees: [foreignTree]
    }),
    (error) => validationCode(error) === "CROSS_CONDITION_REFERENCE"
  );
});

test("Control M — candidate-wide applicability is explicit and credential-neutral", () => {
  const result = buildCr12StructuredRequirementSet(baseInput({ suffix: "control-m" }));
  assert.equal(
    result.structured_requirement_set
      .candidate_credential_applicability_registry[0].mode,
    "CANDIDATE_WIDE"
  );
});

test("Control N — every credential applicability mode remains distinct", () => {
  const modes: readonly CandidateCredentialApplicability[] = [
    {
      candidate_credential_applicability_id: branded("credential-n-candidate"),
      mode: "CANDIDATE_WIDE",
      evidence_fragment_ids: [], certainty: "EXPLICIT", parser_version: parserVersion
    },
    {
      candidate_credential_applicability_id: branded("credential-n-undergraduate"),
      mode: "UNDERGRADUATE",
      evidence_fragment_ids: [], certainty: "EXPLICIT", parser_version: parserVersion
    },
    {
      candidate_credential_applicability_id: branded("credential-n-graduate"),
      mode: "GRADUATE",
      evidence_fragment_ids: [], certainty: "EXPLICIT", parser_version: parserVersion
    },
    {
      candidate_credential_applicability_id: branded("credential-n-highest"),
      mode: "HIGHEST_DEGREE",
      evidence_fragment_ids: [], certainty: "EXPLICIT", parser_version: parserVersion
    },
    {
      candidate_credential_applicability_id: branded("credential-n-specific"),
      mode: "SPECIFIC_DEGREE", degree: "MASTER",
      evidence_fragment_ids: [], certainty: "EXPLICIT", parser_version: parserVersion
    },
    {
      candidate_credential_applicability_id: branded("credential-n-any"),
      mode: "ANY_DEGREE", applicable_degrees: nonEmpty(["BACHELOR", "MASTER"]),
      evidence_fragment_ids: [], certainty: "EXPLICIT", parser_version: parserVersion
    },
    {
      candidate_credential_applicability_id: branded("credential-n-all"),
      mode: "ALL_DEGREES", applicable_degrees: nonEmpty(["BACHELOR", "MASTER"]),
      evidence_fragment_ids: [], certainty: "EXPLICIT", parser_version: parserVersion
    },
    {
      candidate_credential_applicability_id: branded("credential-n-either"),
      mode: "EITHER_LEVEL", applicable_degrees: nonEmpty(["BACHELOR", "MASTER"]),
      evidence_fragment_ids: [], certainty: "EXPLICIT", parser_version: parserVersion
    },
    {
      candidate_credential_applicability_id: branded("credential-n-unresolved"),
      mode: "UNRESOLVED",
      evidence_fragment_ids: [], certainty: "UNRESOLVED", parser_version: parserVersion
    }
  ];
  assert.deepEqual(modes.map((item) => item.mode), [
    "CANDIDATE_WIDE",
    "UNDERGRADUATE",
    "GRADUATE",
    "HIGHEST_DEGREE",
    "SPECIFIC_DEGREE",
    "ANY_DEGREE",
    "ALL_DEGREES",
    "EITHER_LEVEL",
    "UNRESOLVED"
  ]);
  for (const [index, mode] of modes.entries()) {
    const input = baseInput({ suffix: `control-n-${index}` });
    const applicability = {
      ...mode,
      candidate_credential_applicability_id:
        input.candidate_credential_applicabilities[0]
          .candidate_credential_applicability_id,
      evidence_fragment_ids: [
        input.evidence_fragments[0].requirement_evidence_fragment_id
      ]
    } as CandidateCredentialApplicability;
    const result = buildCr12StructuredRequirementSet({
      ...input,
      candidate_credential_applicabilities: [applicability]
    });
    assert.equal(
      result.structured_requirement_set
        .candidate_credential_applicability_registry[0].mode,
      mode.mode
    );
    assert.equal(
      result.structured_requirement_set.completeness.status,
      mode.mode === "UNRESOLVED" ? "REVIEW_REQUIRED" : "COMPLETE"
    );
  }
});

test("Control O — cohort applicability maps without credential leakage", () => {
  const input = baseInput({ suffix: "control-o" });
  const fact: RequirementFact = {
    ...input.facts[0],
    applicability: {
      candidate_cohorts: nonEmpty(["FRESH_GRADUATE", "SOCIAL_CANDIDATE"]),
      operator: "ANY_OF"
    }
  };
  const projection = projectCr9LegacyApplicability({
    fact,
    candidate_credential_applicability_id: branded("credential-control-o"),
    candidate_state_applicability_id: branded("state-control-o"),
    evidence_fragment_ids: nonEmpty([
      input.evidence_fragments[0].requirement_evidence_fragment_id
    ]),
    parser_version: parserVersion
  });
  assert.equal(projection.credential.mode, "CANDIDATE_WIDE");
  assert.equal(projection.state.mode, "COHORT_ANY_OF");
});

test("Control P — Batch applicability remains tied to the exact OpportunityVersion", () => {
  const input = baseInput({ suffix: "control-p" });
  const batchId = branded<RecruitmentBatchId>("batch-control-p");
  const binding: RequirementContextBinding = {
    ...input.context_bindings[0],
    source_context_target: { kind: "RECRUITMENT_BATCH", recruitment_batch_id: batchId },
    effective_targets: nonEmpty([
      { kind: "RECRUITMENT_BATCH", recruitment_batch_id: batchId },
      { kind: "OPPORTUNITY_VERSION", opportunity_version_id: input.opportunity_version_id }
    ]),
    scope: "EXPLICIT_TARGET_SET"
  };
  const result = buildCr12StructuredRequirementSet({
    ...input,
    context_bindings: [binding]
  });
  assert.equal(result.structured_requirement_set.completeness.status, "COMPLETE");
  assert.equal(
    result.structured_requirement_set.context_binding_registry[0]
      .source_context_target.kind,
    "RECRUITMENT_BATCH"
  );
});

test("Control Q — Location applicability is not generalized to sibling locations", () => {
  const input = baseInput({ suffix: "control-q" });
  const locationId = branded<LocationAssignmentId>("location-control-q");
  const binding: RequirementContextBinding = {
    ...input.context_bindings[0],
    source_context_target: {
      kind: "LOCATION_ASSIGNMENT",
      location_assignment_id: locationId
    },
    effective_targets: nonEmpty([{
      kind: "LOCATION_ASSIGNMENT",
      location_assignment_id: locationId
    }])
  };
  const result = buildCr12StructuredRequirementSet({
    ...input,
    context_bindings: [binding]
  });
  assert.deepEqual(
    result.structured_requirement_set.context_binding_registry[0].effective_targets,
    [{ kind: "LOCATION_ASSIGNMENT", location_assignment_id: locationId }]
  );
});

test("Control R — Announcement conditions project only through explicit Evidence binding", () => {
  const input = baseInput({ suffix: "control-r" });
  const announcementId = branded<AnnouncementId>("announcement-control-r");
  const binding: RequirementContextBinding = {
    ...input.context_bindings[0],
    source_context_target: { kind: "ANNOUNCEMENT", announcement_id: announcementId }
  };
  const source = {
    ...input.source_references[0],
    source_role: "ANNOUNCEMENT_UNIFORM" as const,
    source_context_target: { kind: "ANNOUNCEMENT" as const, announcement_id: announcementId }
  };
  const complete = buildCr12StructuredRequirementSet({
    ...input,
    context_bindings: [binding],
    source_references: [source]
  });
  assert.equal(complete.structured_requirement_set.completeness.status, "COMPLETE");
  const unresolved = buildCr12StructuredRequirementSet({
    ...input,
    context_bindings: [{
      ...binding,
      scope: "UNRESOLVED",
      state: "UNRESOLVED",
      certainty: "UNRESOLVED"
    }],
    source_references: [{
      ...source,
      binding_state: "UNRESOLVED",
      binding_certainty: "UNRESOLVED"
    }]
  });
  assert.equal(
    unresolved.structured_requirement_set.completeness.status,
    "REVIEW_REQUIRED"
  );
});

test("Control S — Position-row Requirements remain isolated by PositionVersion", () => {
  const left = buildCr12StructuredRequirementSet(baseInput({ suffix: "control-s-left" }));
  const right = buildCr12StructuredRequirementSet(baseInput({ suffix: "control-s-right" }));
  assert.notEqual(
    left.structured_requirement_set.requirement_set_id,
    right.structured_requirement_set.requirement_set_id
  );
  assert.notDeepEqual(
    left.structured_requirement_set.source_reference_registry[0].source_context_target,
    right.structured_requirement_set.source_reference_registry[0].source_context_target
  );
});

test("Control T — a shared source surface does not merge multiple Positions", () => {
  const sharedSnapshot = branded<SnapshotId>("snapshot-control-t-shared");
  const sharedRecord = branded<ExtractedRecordId>("record-control-t-shared");
  const sharedLocator = locator("control-t-shared");
  const shareSurface = (
    input: Cr12StructuredRequirementSetInput
  ): Cr12StructuredRequirementSetInput => ({
    ...input,
    conditions: [{ ...input.conditions[0], source_locator: sharedLocator }],
    context_bindings: [{ ...input.context_bindings[0], source_locator: sharedLocator }],
    source_references: [{
      ...input.source_references[0],
      snapshot_id: sharedSnapshot,
      extracted_record_id: sharedRecord,
      source_locator: sharedLocator
    }],
    evidence_fragments: [{
      ...input.evidence_fragments[0],
      snapshot_id: sharedSnapshot,
      extracted_record_id: sharedRecord,
      locator: {
        kind: "SPREADSHEET",
        sheet: "岗位表",
        cell_or_range: "H20",
        field_path: "requirements"
      }
    }],
    requirement_evidence: [{
      ...input.requirement_evidence[0],
      snapshot_id: sharedSnapshot,
      locator: sharedLocator
    }]
  });
  const left = buildCr12StructuredRequirementSet(
    shareSurface(baseInput({ suffix: "control-t-left" }))
  );
  const right = buildCr12StructuredRequirementSet(
    shareSurface(baseInput({ suffix: "control-t-right" }))
  );
  assert.notEqual(
    left.structured_requirement_set.opportunity_version_id,
    right.structured_requirement_set.opportunity_version_id
  );
  assert.notEqual(
    left.structured_requirement_set.requirement_set_id,
    right.structured_requirement_set.requirement_set_id
  );
});

test("Control U — Correction relationships preserve original Evidence and target one version", () => {
  const input = baseInput({ suffix: "control-u" });
  const originalSource = input.source_references[0];
  const correctionSourceId = branded<RequirementSourceReferenceId>(
    "source-control-u-correction"
  );
  const correctionSource = {
    ...originalSource,
    requirement_source_reference_id: correctionSourceId,
    source_role: "CORRECTION" as const,
    relationship: {
      kind: "CORRECTS" as const,
      target_source_reference_ids: [originalSource.requirement_source_reference_id],
      evidence_fragment_ids: originalSource.relationship.evidence_fragment_ids,
      resolver_version: resolverVersion
    }
  };
  const result = buildCr12StructuredRequirementSet({
    ...input,
    conditions: [{
      ...input.conditions[0],
      source_reference_ids: nonEmpty([
        originalSource.requirement_source_reference_id,
        correctionSourceId
      ])
    }],
    source_references: [originalSource, correctionSource]
  });
  assert.equal(result.structured_requirement_set.completeness.status, "COMPLETE");
  assert.equal(result.structured_requirement_set.source_reference_registry.length, 2);
  assert.equal(
    result.structured_requirement_set.source_reference_registry[1].relationship.kind,
    "CORRECTS"
  );
});

test("Control V — WHEN/THEN/ELSE uses separate selector and Requirement trees", () => {
  const result = buildCr12StructuredRequirementSet(conditionalInput({
    suffix: "control-v",
    withElse: true
  }));
  assert.equal(result.structured_requirement_set.completeness.status, "COMPLETE");
  assert.equal(result.structured_requirement_set.selector_logic_tree_registry.length, 1);
  assert.equal(result.structured_requirement_set.requirement_logic_tree_registry.length, 2);
  assert.equal(result.structured_requirement_set.conditional_branch_set_registry.length, 1);
});

test("Control W — Candidate-unknown selector state cannot create an assessment in CR#12", () => {
  const result = buildCr12StructuredRequirementSet(conditionalInput({
    suffix: "control-w",
    withElse: true
  }));
  assert.equal(result.structured_requirement_set.completeness.status, "COMPLETE");
  assert.equal(result.complete_requirement_set, null);
  assert.equal("eligibility_assessment" in result, false);
});

test("Control X — unresolved branch overlap remains REVIEW_REQUIRED", () => {
  const input = conditionalInput({ suffix: "control-x", withElse: true });
  const result = buildCr12StructuredRequirementSet({
    ...input,
    external_blockers: [{
      code: "AMBIGUOUS",
      diagnostic_code: "CONDITIONAL_BRANCH_UNRESOLVED",
      observation_ids: [],
      evidence_fragment_ids: [
        input.evidence_fragments[0].requirement_evidence_fragment_id
      ],
      description: "Overlapping conditional branches lack explicit precedence"
    }]
  });
  assert.equal(result.structured_requirement_set.completeness.status, "REVIEW_REQUIRED");
});

test("Control Y — missing ELSE is complete only when branch semantics are explicitly resolved", () => {
  const resolved = buildCr12StructuredRequirementSet(conditionalInput({
    suffix: "control-y-resolved",
    withElse: false,
    branchResolution: "RESOLVED"
  }));
  assert.equal(resolved.structured_requirement_set.completeness.status, "COMPLETE");
  const unresolved = buildCr12StructuredRequirementSet(conditionalInput({
    suffix: "control-y-unresolved",
    withElse: false,
    branchResolution: "UNRESOLVED"
  }));
  assert.equal(
    unresolved.structured_requirement_set.completeness.status,
    "REVIEW_REQUIRED"
  );
});

test("Control Z — source-unresolved OR blocks COMPLETE despite another preserved branch", () => {
  const input = baseInput({ suffix: "control-z" });
  const secondFactId = branded<RequirementFactId>("fact-control-z-second");
  const secondFact: RequirementFact = {
    ...input.facts[0],
    requirement_fact_id: secondFactId,
    value: { kind: "CODE", code: "MASTER" }
  };
  const condition = input.conditions[0];
  const fragmentId = input.evidence_fragments[0].requirement_evidence_fragment_id;
  const bindingId = input.context_bindings[0].requirement_context_binding_id;
  const built = buildCr12RequirementLogicTree({
    requirement_condition_id: condition.requirement_condition_id,
    requirement_logic_tree_id: input.requirement_logic_trees[0].requirement_logic_tree_id,
    tokens: nonEmpty([
      {
        kind: "PREDICATE",
        requirement_fact_id: input.facts[0].requirement_fact_id,
        context_binding_ids: nonEmpty([bindingId]),
        evidence_fragment_ids: nonEmpty([fragmentId]),
        source_order: 0
      },
      {
        kind: "OR",
        context_binding_ids: nonEmpty([bindingId]),
        evidence_fragment_ids: nonEmpty([fragmentId]),
        source_order: 1
      },
      {
        kind: "PREDICATE",
        requirement_fact_id: secondFactId,
        context_binding_ids: nonEmpty([bindingId]),
        evidence_fragment_ids: nonEmpty([fragmentId]),
        source_order: 2
      }
    ]),
    parser_version: parserVersion,
    serialization_version: serializationVersion
  });
  if (built.status !== "RESOLVED") throw new Error(built.message);
  assert.equal(built.status, "RESOLVED");
  const result = buildCr12StructuredRequirementSet({
    ...input,
    facts: [input.facts[0], secondFact],
    requirement_logic_trees: [built.tree],
    requirement_evidence: [input.requirement_evidence[0], {
      ...input.requirement_evidence[0],
      requirement_evidence_id: branded<RequirementEvidenceId>("evidence-control-z-second"),
      requirement_fact_id: secondFactId
    }],
    observations: [{
      ...input.observations[0],
      requirement_fact_ids: [input.facts[0].requirement_fact_id, secondFactId]
    }],
    external_blockers: [{
      code: "AMBIGUOUS",
      diagnostic_code: "LOGIC_CONNECTOR_UNRESOLVED",
      observation_ids: [],
      evidence_fragment_ids: [fragmentId],
      description: "One source OR branch remains semantically unresolved"
    }]
  });
  assert.equal(result.structured_requirement_set.completeness.status, "REVIEW_REQUIRED");
  assert.equal(
    result.structured_requirement_set.execution_manifest.execution_gate.reason,
    "REQUIREMENT_SET_NOT_COMPLETE"
  );
});

test("Control AA — Candidate UNKNOWN is never converted into source NOT_MATCH", () => {
  const result = buildCr12StructuredRequirementSet(baseInput({ suffix: "control-aa" }));
  assert.equal(result.structured_requirement_set.completeness.status, "COMPLETE");
  assert.equal(result.complete_requirement_set, null);
  assert.equal("decision" in result, false);
});

test("Control AB — proven professional-list punctuation defaults to OR", () => {
  for (const token of ["，", "、", "/", ";"] as const) {
    assert.deepEqual(classifyCr12Connector({
      token,
      context: "MAJOR_CANDIDATE_LIST"
    }), { status: "RESOLVED", kind: "OR" });
  }
});

test("Control AC — punctuation outside a proven list never becomes mechanical OR", () => {
  assert.equal(classifyCr12Connector({
    token: "/",
    context: "GENERAL_REQUIREMENT"
  }).status, "UNRESOLVED");
  assert.deepEqual(classifyCr12Connector({
    token: "/",
    context: "PROTECTED_ATOMIC_SPAN"
  }), { status: "NON_BOOLEAN", kind: "PROTECTED_CONTENT" });
  assert.equal(classifyCr12Connector({
    token: ";",
    context: "GENERAL_REQUIREMENT"
  }).status, "CLAUSE_BOUNDARY");
});

test("Control AD — legacy NONE_OF maps to one NOT over an OR of positive equality Facts", () => {
  const input = baseInput({ suffix: "control-ad" });
  const legacyFact: RequirementFact = {
    ...input.facts[0],
    operator: "NONE_OF",
    value: { kind: "CODE_SET", codes: ["A", "B"] },
    polarity: "POSITIVE"
  };
  const projected = projectCr9LegacyFactsToCr12({
    opportunity_version_id: input.opportunity_version_id,
    requirement_condition_id: branded<RequirementConditionId>("condition-control-ad-projected"),
    requirement_logic_tree_id: branded<RequirementLogicTreeId>("tree-control-ad-projected"),
    facts: nonEmpty([legacyFact]),
    requirement_evidence: nonEmpty(input.requirement_evidence),
    candidate_credential_applicability_id:
      input.candidate_credential_applicabilities[0].candidate_credential_applicability_id,
    candidate_state_applicability_id:
      input.candidate_state_applicabilities[0].candidate_state_applicability_id,
    context_binding_ids: nonEmpty([
      input.context_bindings[0].requirement_context_binding_id
    ]),
    source_reference_ids: nonEmpty([
      input.source_references[0].requirement_source_reference_id
    ]),
    evidence_fragment_ids: nonEmpty([
      input.evidence_fragments[0].requirement_evidence_fragment_id
    ]),
    source_locator: input.conditions[0].source_locator,
    source_order: 0,
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    serialization_version: serializationVersion
  });
  assert.equal(projected.projected_facts.length, 2);
  assert.equal(projected.projected_requirement_evidence.length, 2);
  assert.ok(projected.projected_facts.every((fact) => {
    return fact.operator === "EQUALS" && fact.polarity === "POSITIVE";
  }));
  const root = node(projected.tree, projected.tree.root_node_id);
  assert.equal(root.kind, "NOT");
  if (root.kind !== "NOT") return;
  const child = node(projected.tree, root.child_node_id);
  assert.equal(child.kind, "GROUP");
  if (child.kind === "GROUP") assert.equal(child.operator, "OR");
  const structured = buildCr12StructuredRequirementSet({
    ...input,
    mandatory_root: {
      ...input.mandatory_root,
      kind: "SINGLE",
      requirement_condition_id: projected.condition.requirement_condition_id
    },
    conditions: [projected.condition],
    requirement_logic_trees: [projected.tree],
    facts: projected.projected_facts,
    requirement_evidence: projected.projected_requirement_evidence,
    observations: [{
      ...input.observations[0],
      requirement_fact_ids: projected.projected_facts.map((fact) => {
        return fact.requirement_fact_id;
      })
    }]
  });
  assert.equal(structured.structured_requirement_set.completeness.status, "COMPLETE");
  assert.deepEqual(
    structured.structured_requirement_set.condition_registry[0]
      .projected_from_legacy_evidence_ids,
    input.requirement_evidence.map((evidence) => evidence.requirement_evidence_id)
  );
});

test("Control AE — multiple legacy negative carriers are rejected", () => {
  const input = baseInput({ suffix: "control-ae" });
  const legacyFact: RequirementFact = {
    ...input.facts[0],
    operator: "NOT_EQUALS",
    polarity: "NEGATIVE"
  };
  assert.throws(() => projectCr9LegacyFactsToCr12({
    opportunity_version_id: input.opportunity_version_id,
    requirement_condition_id: branded<RequirementConditionId>("condition-control-ae-projected"),
    requirement_logic_tree_id: branded<RequirementLogicTreeId>("tree-control-ae-projected"),
    facts: nonEmpty([legacyFact]),
    requirement_evidence: nonEmpty(input.requirement_evidence),
    candidate_credential_applicability_id:
      input.candidate_credential_applicabilities[0].candidate_credential_applicability_id,
    candidate_state_applicability_id:
      input.candidate_state_applicabilities[0].candidate_state_applicability_id,
    context_binding_ids: nonEmpty([
      input.context_bindings[0].requirement_context_binding_id
    ]),
    source_reference_ids: nonEmpty([
      input.source_references[0].requirement_source_reference_id
    ]),
    evidence_fragment_ids: nonEmpty([
      input.evidence_fragments[0].requirement_evidence_fragment_id
    ]),
    source_locator: input.conditions[0].source_locator,
    source_order: 0,
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    serialization_version: serializationVersion
  }), (error) => validationCode(error) === "DOUBLE_NEGATION");
});

test("Control AF — semantic mutation invalidates the Requirement Set hash", () => {
  const result = buildCr12StructuredRequirementSet(baseInput({ suffix: "control-af" }));
  assert.equal(result.structured_requirement_set.completeness.status, "COMPLETE");
  const mutated = structuredClone(
    result.structured_requirement_set
  ) as Cr12StructuredRequirementSet;
  (mutated.condition_registry[0] as { modality: string }).modality = "PREFERRED";
  assert.throws(
    () => assertCr12StructuredRequirementSetIntegrity(mutated),
    (error) => validationCode(error) === "CONTENT_HASH_MISMATCH"
  );
});

test("Control AG — binding target and binding Evidence mutations change the hash", () => {
  const input = baseInput({ suffix: "control-ag" });
  const baseline = buildCr12StructuredRequirementSet(input);
  const locationId = branded<LocationAssignmentId>("location-control-ag");
  const changedBinding: RequirementContextBinding = {
    ...input.context_bindings[0],
    effective_targets: nonEmpty([{
      kind: "LOCATION_ASSIGNMENT",
      location_assignment_id: locationId
    }])
  };
  const changed = buildCr12StructuredRequirementSet({
    ...input,
    context_bindings: [changedBinding]
  });
  assert.notEqual(
    baseline.structured_requirement_set.requirement_set_id,
    changed.structured_requirement_set.requirement_set_id
  );
  const mutatedEvidence = structuredClone(
    baseline.structured_requirement_set
  ) as Cr12StructuredRequirementSet;
  (mutatedEvidence.context_binding_registry[0].source_locator as {
    cell_or_range?: string;
  }).cell_or_range = "H999";
  assert.throws(
    () => assertCr12StructuredRequirementSetIntegrity(mutatedEvidence),
    (error) => validationCode(error) === "CONTENT_HASH_MISMATCH"
  );
});

test("Control AH — CR#12 stays outside the CR#10 executable slot", () => {
  const result = buildCr12StructuredRequirementSet(baseInput({ suffix: "control-ah" }));
  assert.equal(result.structured_requirement_set.completeness.status, "COMPLETE");
  assert.equal(result.complete_requirement_set, null);
  assert.deepEqual(result.structured_requirement_set.execution_manifest.execution_gate, {
    status: "NOT_ALLOWED",
    reason: "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY",
    required_capabilities:
      result.structured_requirement_set.execution_manifest.required_engine_capabilities,
    supported_capabilities: [],
    missing_capabilities:
      result.structured_requirement_set.execution_manifest.required_engine_capabilities
  });
});

test("Modality contract preserves mandatory, preferred, optional, and informational clauses", () => {
  for (const modality of [
    "MANDATORY",
    "PREFERRED",
    "OPTIONAL",
    "INFORMATIONAL"
  ] as const) {
    const result = buildCr12StructuredRequirementSet(baseInput({
      suffix: `modality-${modality.toLowerCase()}`,
      modality
    }));
    assert.equal(
      result.structured_requirement_set.condition_registry[0].modality,
      modality
    );
    assert.equal(result.structured_requirement_set.completeness.status, "COMPLETE");
    if (modality !== "MANDATORY") {
      assert.equal(result.structured_requirement_set.mandatory_root.kind, "EMPTY_CONFIRMED");
    }
  }
});

test("Source conflict remains a source blocker and never a Candidate failure", () => {
  const input = baseInput({ suffix: "source-conflict" });
  const source = input.source_references[0];
  const conflictingId = branded<RequirementSourceReferenceId>(
    "source-source-conflict-second"
  );
  const result = buildCr12StructuredRequirementSet({
    ...input,
    source_references: [source, {
      ...source,
      requirement_source_reference_id: conflictingId,
      relationship: {
        kind: "CONFLICTS_WITH",
        target_source_reference_ids: [source.requirement_source_reference_id],
        evidence_fragment_ids: source.relationship.evidence_fragment_ids,
        resolver_version: resolverVersion
      }
    }],
    conditions: [{
      ...input.conditions[0],
      source_reference_ids: nonEmpty([
        source.requirement_source_reference_id,
        conflictingId
      ])
    }]
  });
  assert.equal(result.structured_requirement_set.completeness.status, "REVIEW_REQUIRED");
  assert.ok(result.structured_requirement_set.completeness.blockers.some((blocker) => {
    return blocker.diagnostic_code === "SOURCE_CONFLICT";
  }));
  assert.equal(result.complete_requirement_set, null);
});

test("Control AI — verified Composition references enter the CR#12 manifest and content hash", () => {
  const input = compositionBackedInput(baseInput({ suffix: "control-ai" }));
  const result = buildCr12StructuredRequirementSet(input).structured_requirement_set;

  assert.equal(result.source_composition_state, "COMPOSITION_BACKED");
  assert.ok(result.source_composition_reference);
  assert.equal(
    result.completeness.manifest.source_composition_reference?.composition_hash,
    input.source_composition_result?.composition_hash
  );
  assert.ok(result.execution_manifest.required_engine_capabilities.includes(
    "SOURCE_COMPOSITION_GATE_V1"
  ));

  const mutated = structuredClone(result) as Cr12StructuredRequirementSet;
  if (!mutated.source_composition_reference) throw new Error("Missing Composition reference");
  (mutated.source_composition_reference as { composition_hash: string }).composition_hash =
    "sha256:mutated";
  assert.throws(() => assertCr12StructuredRequirementSetIntegrity(mutated));

  const unverified = structuredClone(input.source_composition_result);
  if (!unverified) throw new Error("Missing Composition Result");
  (unverified.source_surfaces[0] as { parser_version: string }).parser_version =
    "mutated-parser/2";
  assert.throws(() => buildCr12StructuredRequirementSet({
    ...input,
    source_composition_result: unverified
  }));

  assert.throws(() => buildCr12StructuredRequirementSet({
    ...input,
    source_references: [{
      ...input.source_references[0],
      source_surface_id: branded<SourceSurfaceId>("unselected-source-surface")
    }]
  }));
});
