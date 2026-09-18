import { createHash } from "node:crypto";

import type {
  CandidateCredentialApplicability,
  CandidateCredentialApplicabilityId,
  CandidateStateApplicability,
  CandidateStateApplicabilityId,
  ConditionalRequirementBranchSet,
  ConditionalRequirementBranchSetId,
  Cr12RequirementCondition,
  Cr12RequirementLogicTree,
  Cr12RequirementSourceReference,
  LogicGroupId,
  MaterializedSourceOccurrenceVersion,
  PositionBoundOpportunityVersion,
  PositionVersionId,
  RequirementConditionId,
  RequirementContextBinding,
  RequirementContextBindingId,
  RequirementEvidence,
  RequirementEvidenceFragment,
  RequirementEvidenceFragmentId,
  RequirementFact,
  RequirementFactId,
  RequirementLogicTreeId,
  RequirementMandatoryRoot,
  RequirementMandatoryRootId,
  RequirementObservation,
  RequirementObservationId,
  RequirementSelectorPredicate,
  RequirementSelectorPredicateId,
  RequirementSourceReferenceId,
  SelectorLogicNodeId,
  SelectorLogicTree,
  SelectorLogicTreeId,
  SourceCompositionResult,
  SourceSurface
} from "../domain";
import { CR12_ENGINE_CAPABILITIES } from "../domain";
import type { PositionIdentityResolutionInput } from "../normalization";
import {
  CR12_REQUIREMENT_SERIALIZATION_VERSION,
  CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
  DETERMINISTIC_REQUIREMENT_PARSER_VERSION,
  DeterministicRequirementParser,
  buildCr12RequirementLogicTree,
  type Cr12LogicExpressionResult,
  type Cr12StructuredRequirementSetInput
} from "../requirements";
import type { RequirementProjectionOutput } from "./trusted-requirement-projection";

export interface ApprovedRequirementProjectionSource {
  readonly version: MaterializedSourceOccurrenceVersion;
  readonly extracted_record: PositionIdentityResolutionInput["extracted_record"];
  readonly snapshot: PositionIdentityResolutionInput["snapshot"];
}

interface SurfaceProjectionContext {
  readonly source: ApprovedRequirementProjectionSource;
  readonly surface: SourceSurface;
  readonly fragment: RequirementEvidenceFragment;
  readonly binding: RequirementContextBinding;
  readonly sourceReference: Cr12RequirementSourceReference;
}

interface ProjectedCondition {
  readonly condition: Cr12RequirementCondition;
  readonly trees: readonly Cr12RequirementLogicTree[];
  readonly facts: readonly RequirementFact[];
  readonly evidence: readonly RequirementEvidence[];
  readonly credentialApplicability: CandidateCredentialApplicability;
  readonly stateApplicability: CandidateStateApplicability;
}

interface ConditionalProjection extends ProjectedCondition {
  readonly selectorPredicates: readonly RequirementSelectorPredicate[];
  readonly selectorTrees: readonly SelectorLogicTree[];
  readonly branchSets: readonly ConditionalRequirementBranchSet[];
  readonly observations: readonly RequirementObservation[];
}

export function projectApprovedRequirements(input: {
  readonly source_composition: SourceCompositionResult;
  readonly position_version_id: PositionVersionId;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly sources: readonly ApprovedRequirementProjectionSource[];
  readonly projector_version: string;
}): RequirementProjectionOutput {
  const contexts = materialSurfaceContexts(input);
  if (contexts.length === 0) {
    throw new Error("Approved projector found no trusted material requirement surface");
  }

  const parsed = new DeterministicRequirementParser().parse({
    opportunity_version: input.opportunity_version,
    evidence_fragments: contexts.map((context) => context.fragment),
    expected_sources: contexts.map((context) => ({
      extracted_record_id: context.fragment.extracted_record_id,
      snapshot_id: context.fragment.snapshot_id
    }))
  });
  const factsById = new Map(parsed.facts.map((fact) => {
    return [fact.requirement_fact_id, fact] as const;
  }));
  const evidenceByFact = new Map<RequirementFactId, RequirementEvidence[]>();
  for (const evidence of parsed.evidence) {
    const current = evidenceByFact.get(evidence.requirement_fact_id) ?? [];
    current.push(evidence);
    evidenceByFact.set(evidence.requirement_fact_id, current);
  }
  const contextByFragment = new Map(contexts.map((context) => {
    return [context.fragment.requirement_evidence_fragment_id, context] as const;
  }));
  const projected: ProjectedCondition[] = [];
  const observations: RequirementObservation[] = [];

  for (const observation of parsed.observations) {
    const context = contextForObservation(observation, contextByFragment);
    const facts = observation.requirement_fact_ids.flatMap((factId) => {
      const fact = factsById.get(factId);
      return fact ? [fact] : [];
    });
    if (observation.status === "CONFIRMED_REQUIREMENT" && facts.length > 0) {
      projected.push(projectResolvedCondition(input, context, observation, facts,
        evidenceByFact));
      observations.push(observation);
      continue;
    }
    if (observation.clause_role === "PREFERRED"
        || observation.clause_role === "INFORMATIONAL"
        || observation.clause_role === "UNKNOWN") {
      observations.push({ ...observation, requirement_fact_ids: [] });
      continue;
    }
    projected.push(projectUnresolvedCondition(input, context, observation));
    observations.push({ ...observation, requirement_fact_ids: [] });
  }

  const conditionals = contexts.flatMap((context) => {
    return hasConditionalProfessionalComparison(context.fragment)
      ? [projectConditionalProfessionalComparison(input, context)]
      : [];
  });
  const allProjected = [...projected, ...conditionals];
  const mandatoryConditions = allProjected.filter((item) => {
    return item.condition.modality === "MANDATORY"
      && item.condition.resolution_state === "RESOLVED";
  }).map((item) => item.condition.requirement_condition_id);
  const mandatoryRoot = requirementMandatoryRoot(
    input.source_composition.source_composition_id,
    mandatoryConditions,
    contexts.map((context) => context.fragment.requirement_evidence_fragment_id)
  );

  return {
    mandatory_root: mandatoryRoot,
    conditions: allProjected.map((item) => item.condition),
    requirement_logic_trees: allProjected.flatMap((item) => item.trees),
    facts: allProjected.flatMap((item) => item.facts),
    candidate_credential_applicabilities:
      uniqueById(allProjected.map((item) => item.credentialApplicability),
        (item) => item.candidate_credential_applicability_id),
    candidate_state_applicabilities:
      uniqueById(allProjected.map((item) => item.stateApplicability),
        (item) => item.candidate_state_applicability_id),
    context_bindings: contexts.map((context) => context.binding),
    source_references: contexts.map((context) => context.sourceReference),
    selector_predicates: conditionals.flatMap((item) => item.selectorPredicates),
    selector_logic_trees: conditionals.flatMap((item) => item.selectorTrees),
    conditional_branch_sets: conditionals.flatMap((item) => item.branchSets),
    evidence_fragments: contexts.map((context) => context.fragment),
    requirement_evidence: allProjected.flatMap((item) => item.evidence),
    observations: [
      ...observations,
      ...conditionals.flatMap((item) => item.observations)
    ],
    supported_engine_capabilities: CR12_ENGINE_CAPABILITIES,
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    resolver_version: input.projector_version,
    serialization_version: CR12_REQUIREMENT_SERIALIZATION_VERSION
  };
}

function materialSurfaceContexts(input: {
  readonly source_composition: SourceCompositionResult;
  readonly position_version_id: PositionVersionId;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly sources: readonly ApprovedRequirementProjectionSource[];
  readonly projector_version: string;
}): SurfaceProjectionContext[] {
  const materialSurfaceIds = new Set(
    input.source_composition.inventory.expected_surface_entries.filter((entry) => {
      return entry.expectedness === "REQUIRED"
        && entry.requirement_level === "REQUIREMENT_BEARING"
        && entry.coverage_status === "COVERED"
        && entry.resolution_status === "RESOLVED"
        && entry.source_surface_id !== null;
    }).map((entry) => entry.source_surface_id)
  );
  return input.source_composition.source_surfaces.filter((surface) => {
    return materialSurfaceIds.has(surface.source_surface_id);
  }).sort((left, right) => {
    return left.source_surface_id.localeCompare(right.source_surface_id);
  }).map((surface) => surfaceProjectionContext(input, surface));
}

function surfaceProjectionContext(input: {
  readonly source_composition: SourceCompositionResult;
  readonly position_version_id: PositionVersionId;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly sources: readonly ApprovedRequirementProjectionSource[];
  readonly projector_version: string;
}, surface: SourceSurface): SurfaceProjectionContext {
  const source = input.sources.find((candidate) => {
    return candidate.version.source_occurrence_version_id
      === surface.source_occurrence_version_id;
  });
  if (!source
      || source.snapshot.snapshot_id !== surface.snapshot_id
      || source.extracted_record.extracted_record_id !== surface.extracted_record_id
      || source.version.materialization.extractor_version !== surface.extractor_version) {
    throw new Error(`Material SourceSurface lacks trusted provenance: ${surface.source_surface_id}`);
  }
  const fragmentId = branded<RequirementEvidenceFragmentId>(
    `requirement-fragment:${sha256(stableSerialize({
      source_surface_id: surface.source_surface_id,
      source_occurrence_version_id: surface.source_occurrence_version_id,
      snapshot_id: surface.snapshot_id,
      extracted_record_id: surface.extracted_record_id,
      locator: surface.locator,
      projector_version: input.projector_version
    }))}`
  );
  const requirementText = source.version.content.requirement_text;
  const academicProgramDirectory = approvedAcademicProgramDirectory(source);
  const academicProgramDirectories = approvedAcademicProgramDirectories(source);
  const fragment: RequirementEvidenceFragment = requirementText
    ? {
        requirement_evidence_fragment_id: fragmentId,
        extracted_record_id: surface.extracted_record_id,
        snapshot_id: surface.snapshot_id,
        locator: structuredClone(surface.locator) as RequirementEvidenceFragment["locator"],
        observed_value_state: "TEXT",
        original_text: requirementText.original,
        normalized_text: normalized(
          requirementText.original.text,
          input.projector_version
        ),
        ...(academicProgramDirectory
          ? { academic_program_directory: academicProgramDirectory }
          : {}),
        ...(academicProgramDirectories
          ? { academic_program_directories: academicProgramDirectories }
          : {}),
        extractor_name: source.extracted_record.extraction.extractor_name,
        extractor_version: surface.extractor_version,
        parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
      }
    : {
        requirement_evidence_fragment_id: fragmentId,
        extracted_record_id: surface.extracted_record_id,
        snapshot_id: surface.snapshot_id,
        locator: structuredClone(surface.locator) as RequirementEvidenceFragment["locator"],
        observed_value_state: "EMPTY",
        original_text: null,
        extractor_name: source.extracted_record.extraction.extractor_name,
        extractor_version: surface.extractor_version,
        parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
      };
  const bindingId = branded<RequirementContextBindingId>(
    `requirement-binding:${sha256(`${surface.source_surface_id}\0${input.position_version_id}`)}`
  );
  const binding: RequirementContextBinding = {
    requirement_context_binding_id: bindingId,
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    source_context_target: {
      kind: "POSITION_VERSION",
      position_version_id: input.position_version_id
    },
    effective_targets: [{
      kind: "OPPORTUNITY_VERSION",
      opportunity_version_id: input.opportunity_version.opportunity_version_id
    }],
    scope: "EXACT_TARGET",
    state: "RESOLVED",
    certainty: "EXPLICIT",
    source_locator: structuredClone(surface.locator),
    evidence_fragment_ids: [fragmentId],
    identity_evidence_ids: source.version.identity_evidence.map((item) => {
      return item.identity_evidence_id;
    }),
    resolver_version: input.projector_version
  };
  const sourceReference: Cr12RequirementSourceReference = {
    requirement_source_reference_id: branded<RequirementSourceReferenceId>(
      `requirement-source:${sha256(`${surface.source_surface_id}\0${fragmentId}`)}`
    ),
    snapshot_id: surface.snapshot_id,
    extracted_record_id: surface.extracted_record_id,
    source_role: sourceRole(surface),
    source_context_target: {
      kind: "OPPORTUNITY_VERSION",
      opportunity_version_id: input.opportunity_version.opportunity_version_id
    },
    applicable_binding_ids: [bindingId],
    binding_evidence_fragment_ids: [fragmentId],
    identity_evidence_ids: source.version.identity_evidence.map((item) => {
      return item.identity_evidence_id;
    }),
    source_locator: structuredClone(surface.locator),
    source_surface_id: surface.source_surface_id,
    relationship: {
      kind: "ORIGINAL",
      target_source_reference_ids: [],
      evidence_fragment_ids: [fragmentId],
      resolver_version: input.projector_version
    },
    binding_state: "RESOLVED",
    binding_certainty: "EXPLICIT",
    extractor_version: surface.extractor_version,
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    resolver_version: input.projector_version
  };
  return { source, surface, fragment, binding, sourceReference };
}

function approvedAcademicProgramDirectories(
  source: ApprovedRequirementProjectionSource
): RequirementEvidenceFragment["academic_program_directories"] | undefined {
  const metadata = source.extracted_record.adapter_metadata[
    "approved-requirement-projection/1.0.0"
  ];
  const candidate = metadata?.academic_program_directories;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }
  const result: Partial<Record<"BACHELOR" | "MASTER" | "GRADUATE" | "DOCTOR", {
    directory_namespace: string;
    directory_version: string;
  }>> = {};
  for (const scope of ["BACHELOR", "MASTER", "GRADUATE", "DOCTOR"] as const) {
    const entry = (candidate as Record<string, unknown>)[scope];
    if (entry === undefined) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Approved academic directory context is malformed: ${scope}`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.directory_namespace !== "string"
        || !record.directory_namespace.trim()
        || typeof record.directory_version !== "string"
        || !record.directory_version.trim()) {
      throw new Error(`Approved academic directory context is malformed: ${scope}`);
    }
    result[scope] = {
      directory_namespace: record.directory_namespace,
      directory_version: record.directory_version
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function approvedAcademicProgramDirectory(
  source: ApprovedRequirementProjectionSource
): RequirementEvidenceFragment["academic_program_directory"] | undefined {
  const metadata = source.extracted_record.adapter_metadata[
    "approved-requirement-projection/1.0.0"
  ];
  const candidate = metadata?.academic_program_directory;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record.directory_namespace !== "string"
      || !record.directory_namespace.trim()
      || typeof record.directory_version !== "string"
      || !record.directory_version.trim()) {
    throw new Error("Approved academic directory context is malformed");
  }
  return {
    directory_namespace: record.directory_namespace,
    directory_version: record.directory_version
  };
}

function projectResolvedCondition(
  input: { readonly source_composition: SourceCompositionResult; readonly projector_version: string },
  context: SurfaceProjectionContext,
  observation: RequirementObservation,
  facts: readonly RequirementFact[],
  evidenceByFact: ReadonlyMap<RequirementFactId, readonly RequirementEvidence[]>
): ProjectedCondition {
  const suffix = sha256(`${input.source_composition.source_composition_id}\0${observation.requirement_observation_id}`);
  const conditionId = branded<RequirementConditionId>(`condition:${suffix}`);
  const treeId = branded<RequirementLogicTreeId>(`requirement-tree:${suffix}`);
  const credentialApplicability = credentialApplicabilityFor(
    suffix,
    facts,
    observation.evidence_fragment_ids
  );
  const stateApplicability = stateApplicabilityFor(
    suffix,
    facts,
    observation.evidence_fragment_ids
  );
  const tree = requireResolvedTree(buildCr12RequirementLogicTree({
    requirement_condition_id: conditionId,
    requirement_logic_tree_id: treeId,
    tokens: logicTokens(facts, context.binding.requirement_context_binding_id,
      observation.evidence_fragment_ids),
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    serialization_version: CR12_REQUIREMENT_SERIALIZATION_VERSION
  }));
  const condition: Cr12RequirementCondition = {
    requirement_condition_id: conditionId,
    opportunity_version_id: observation.opportunity_version_id,
    modality: observation.clause_role === "PREFERRED" ? "PREFERRED" : "MANDATORY",
    resolution_state: "RESOLVED",
    representation_kind: "LOGIC_TREE",
    requirement_logic_tree_id: treeId,
    candidate_credential_applicability_id:
      credentialApplicability.candidate_credential_applicability_id,
    candidate_state_applicability_id:
      stateApplicability.candidate_state_applicability_id,
    context_binding_ids: [context.binding.requirement_context_binding_id],
    source_reference_ids: [context.sourceReference.requirement_source_reference_id],
    evidence_fragment_ids: observation.evidence_fragment_ids,
    source_locator: observationLocator(observation, context),
    source_order: sourceOrder(observation),
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    resolver_version: input.projector_version,
    projected_from_legacy_fact_ids: [],
    projected_from_legacy_evidence_ids: []
  };
  return {
    condition,
    trees: [tree],
    facts,
    evidence: facts.flatMap((fact) => evidenceByFact.get(fact.requirement_fact_id) ?? []),
    credentialApplicability,
    stateApplicability
  };
}

function projectUnresolvedCondition(
  input: { readonly projector_version: string },
  context: SurfaceProjectionContext,
  observation: RequirementObservation
): ProjectedCondition {
  if (observation.clause_role !== "MANDATORY") {
    throw new Error("Only mandatory unresolved observations may become CR#12 conditions");
  }
  const suffix = sha256(`${context.surface.source_surface_id}\0${observation.requirement_observation_id}`);
  const credentialApplicability: CandidateCredentialApplicability = {
    candidate_credential_applicability_id:
      branded<CandidateCredentialApplicabilityId>(`credential-applicability:${suffix}`),
    mode: "UNRESOLVED",
    raw_scope: observation.original_clause
      ?? (context.fragment.observed_value_state === "TEXT"
        ? context.fragment.original_text
        : undefined),
    evidence_fragment_ids: observation.evidence_fragment_ids,
    certainty: "UNRESOLVED",
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
  const stateApplicability: CandidateStateApplicability = {
    candidate_state_applicability_id:
      branded<CandidateStateApplicabilityId>(`state-applicability:${suffix}`),
    mode: "UNRESOLVED",
    raw_scope: observation.original_clause
      ?? (context.fragment.observed_value_state === "TEXT"
        ? context.fragment.original_text
        : undefined),
    evidence_fragment_ids: observation.evidence_fragment_ids,
    certainty: "UNRESOLVED",
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
  return {
    condition: {
      requirement_condition_id: branded<RequirementConditionId>(`condition:${suffix}`),
      opportunity_version_id: observation.opportunity_version_id,
      modality: "MANDATORY",
      resolution_state: "UNRESOLVED",
      representation_kind: "UNRESOLVED",
      blocking_observation_ids: [observation.requirement_observation_id],
      candidate_credential_applicability_id:
        credentialApplicability.candidate_credential_applicability_id,
      candidate_state_applicability_id:
        stateApplicability.candidate_state_applicability_id,
      context_binding_ids: [context.binding.requirement_context_binding_id],
      source_reference_ids: [context.sourceReference.requirement_source_reference_id],
      evidence_fragment_ids: observation.evidence_fragment_ids,
      source_locator: observationLocator(observation, context),
      source_order: sourceOrder(observation),
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
      resolver_version: input.projector_version,
      projected_from_legacy_fact_ids: [],
      projected_from_legacy_evidence_ids: []
    },
    trees: [],
    facts: [],
    evidence: [],
    credentialApplicability,
    stateApplicability
  };
}

function projectConditionalProfessionalComparison(
  input: {
    readonly source_composition: SourceCompositionResult;
    readonly opportunity_version: PositionBoundOpportunityVersion;
    readonly projector_version: string;
  },
  context: SurfaceProjectionContext
): ConditionalProjection {
  const suffix = sha256(`${context.surface.source_surface_id}\0conditional-professional-comparison`);
  const conditionId = branded<RequirementConditionId>(`condition:${suffix}`);
  const branchSetId = branded<ConditionalRequirementBranchSetId>(`branch-set:${suffix}`);
  const selectorTreeId = branded<SelectorLogicTreeId>(`selector-tree:${suffix}`);
  const selectorNodeId = branded<SelectorLogicNodeId>(`selector-node:${suffix}`);
  const selectorPredicateId = branded<RequirementSelectorPredicateId>(`selector-predicate:${suffix}`);
  const factId = branded<RequirementFactId>(`requirement-fact:${suffix}`);
  const treeId = branded<RequirementLogicTreeId>(`requirement-tree:${suffix}`);
  const observationId = branded<RequirementObservationId>(`requirement-observation:${suffix}`);
  const fragmentId = context.fragment.requirement_evidence_fragment_id;
  const bindingId = context.binding.requirement_context_binding_id;
  const originalText = context.fragment.observed_value_state === "TEXT"
    ? context.fragment.original_text
    : { text: "专业比对条件", encoding: "UTF-8" as const };
  const normalizedText = context.fragment.observed_value_state === "TEXT"
    ? context.fragment.normalized_text ?? normalized(originalText.text, input.projector_version)
    : normalized(originalText.text, input.projector_version);
  const reviewRule = {
    kind: "MAJOR_MATCH_RULE" as const,
    rule: {
      kind: "EXCEPTION_LIST" as const,
      exception_reference: normalizedText,
      unresolved_behavior: "REVIEW_REQUIRED" as const
    }
  };
  const credentialApplicability: CandidateCredentialApplicability = {
    candidate_credential_applicability_id:
      branded<CandidateCredentialApplicabilityId>(`credential-applicability:${suffix}`),
    mode: "UNRESOLVED",
    raw_scope: originalText,
    evidence_fragment_ids: [fragmentId],
    certainty: "UNRESOLVED",
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
  const stateApplicability: CandidateStateApplicability = {
    candidate_state_applicability_id:
      branded<CandidateStateApplicabilityId>(`state-applicability:${suffix}`),
    mode: "STATE_SELECTOR",
    selector_logic_tree_id: selectorTreeId,
    evidence_fragment_ids: [fragmentId],
    certainty: "UNRESOLVED",
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
  const fact: RequirementFact = {
    requirement_fact_id: factId,
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    dimension: "MAJOR_MATCH_RULE",
    operator: "EQUALS",
    value: reviewRule,
    subject_scope: "ANY_EDUCATION",
    logic_group: {
      logic_group_id: branded<LogicGroupId>(`logic-group:${suffix}`),
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "AMBIGUOUS",
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
  const tree = requireResolvedTree(buildCr12RequirementLogicTree({
    requirement_condition_id: conditionId,
    requirement_logic_tree_id: treeId,
    tokens: [{
      kind: "PREDICATE",
      requirement_fact_id: factId,
      context_binding_ids: [bindingId],
      evidence_fragment_ids: [fragmentId],
      source_order: 0
    }],
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    serialization_version: CR12_REQUIREMENT_SERIALIZATION_VERSION
  }));
  const selectorPredicate: RequirementSelectorPredicate = {
    requirement_selector_predicate_id: selectorPredicateId,
    conditional_branch_set_id: branchSetId,
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    dimension: "MAJOR_MATCH_RULE",
    operator: "EQUALS",
    value: reviewRule,
    candidate_credential_applicability_id:
      credentialApplicability.candidate_credential_applicability_id,
    context_binding_ids: [bindingId],
    evidence_fragment_ids: [fragmentId],
    source_locator: structuredClone(context.surface.locator),
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    resolution_state: "UNRESOLVED"
  };
  const selectorTree: SelectorLogicTree = {
    selector_logic_tree_id: selectorTreeId,
    conditional_branch_set_id: branchSetId,
    root_node_id: selectorNodeId,
    nodes: [{
      selector_logic_node_id: selectorNodeId,
      selector_logic_tree_id: selectorTreeId,
      kind: "SELECTOR_PREDICATE",
      requirement_selector_predicate_id: selectorPredicateId,
      context_binding_ids: [bindingId],
      evidence_fragment_ids: [fragmentId],
      source_order: 0
    }],
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    serialization_version: CR12_REQUIREMENT_SERIALIZATION_VERSION
  };
  const branchSet: ConditionalRequirementBranchSet = {
    conditional_branch_set_id: branchSetId,
    requirement_condition_id: conditionId,
    when_selector_logic_tree_id: selectorTreeId,
    then_requirement_logic_tree_id: treeId,
    candidate_credential_applicability_id:
      credentialApplicability.candidate_credential_applicability_id,
    candidate_state_applicability_id:
      stateApplicability.candidate_state_applicability_id,
    context_binding_ids: [bindingId],
    evidence_fragment_ids: [fragmentId],
    branch_semantics_state: "UNRESOLVED",
    source_order: 0,
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    resolver_version: input.projector_version
  };
  const observation: RequirementObservation = {
    requirement_observation_id: observationId,
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    status: "AMBIGUOUS",
    clause_role: "MANDATORY",
    dimension_hint: "MAJOR_MATCH_RULE",
    requirement_fact_ids: [factId],
    evidence_fragment_ids: [fragmentId],
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
  return {
    condition: {
      requirement_condition_id: conditionId,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      modality: "MANDATORY",
      resolution_state: "RESOLVED",
      representation_kind: "CONDITIONAL_BRANCH_SET",
      conditional_branch_set_id: branchSetId,
      candidate_credential_applicability_id:
        credentialApplicability.candidate_credential_applicability_id,
      candidate_state_applicability_id:
        stateApplicability.candidate_state_applicability_id,
      context_binding_ids: [bindingId],
      source_reference_ids: [context.sourceReference.requirement_source_reference_id],
      evidence_fragment_ids: [fragmentId],
      source_locator: structuredClone(context.surface.locator),
      source_order: 0,
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
      resolver_version: input.projector_version,
      projected_from_legacy_fact_ids: [],
      projected_from_legacy_evidence_ids: []
    },
    trees: [tree],
    facts: [fact],
    evidence: [{
      requirement_evidence_id: `requirement-evidence:${suffix}` as never,
      requirement_fact_id: factId,
      snapshot_id: context.surface.snapshot_id,
      locator: structuredClone(context.surface.locator),
      evidence_text: originalText,
      normalized_text: normalizedText,
      extractor_name: context.source.extracted_record.extraction.extractor_name,
      extractor_version: context.surface.extractor_version,
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
    }],
    credentialApplicability,
    stateApplicability,
    selectorPredicates: [selectorPredicate],
    selectorTrees: [selectorTree],
    branchSets: [branchSet],
    observations: [observation]
  };
}

function contextForObservation(
  observation: RequirementObservation,
  contexts: ReadonlyMap<RequirementEvidenceFragmentId, SurfaceProjectionContext>
) {
  for (const fragmentId of observation.evidence_fragment_ids) {
    const context = contexts.get(fragmentId);
    if (context) return context;
  }
  throw new Error(`Requirement observation lacks a material SourceSurface: ${observation.requirement_observation_id}`);
}

function logicTokens(
  facts: readonly RequirementFact[],
  bindingId: RequirementContextBindingId,
  fragmentIds: readonly RequirementEvidenceFragmentId[]
): Parameters<typeof buildCr12RequirementLogicTree>[0]["tokens"] {
  const tokens: Array<Parameters<typeof buildCr12RequirementLogicTree>[0]["tokens"][number]> = [];
  for (const [index, fact] of facts.entries()) {
    if (index > 0) {
      tokens.push({
        kind: fact.logic_group.operator,
        context_binding_ids: [bindingId],
        evidence_fragment_ids: fragmentIds as [RequirementEvidenceFragmentId],
        source_order: index * 2 - 1
      });
    }
    tokens.push({
      kind: "PREDICATE",
      requirement_fact_id: fact.requirement_fact_id,
      context_binding_ids: [bindingId],
      evidence_fragment_ids: fragmentIds as [RequirementEvidenceFragmentId],
      source_order: index * 2
    });
  }
  if (tokens.length === 0) throw new Error("Resolved Requirement condition has no Facts");
  return tokens as unknown as Parameters<typeof buildCr12RequirementLogicTree>[0]["tokens"];
}

function credentialApplicabilityFor(
  suffix: string,
  facts: readonly RequirementFact[],
  fragmentIds: readonly RequirementEvidenceFragmentId[]
): CandidateCredentialApplicability {
  const scopes = new Set(facts.map((fact) => fact.subject_scope));
  const base = {
    candidate_credential_applicability_id:
      branded<CandidateCredentialApplicabilityId>(`credential-applicability:${suffix}`),
    evidence_fragment_ids: fragmentIds,
    certainty: facts.every((fact) => fact.certainty === "EXPLICIT")
      ? "EXPLICIT" as const
      : "UNRESOLVED" as const,
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
  if (scopes.size === 1 && scopes.has("BACHELOR")) return { ...base, mode: "UNDERGRADUATE" };
  if (scopes.size === 1 && (scopes.has("MASTER") || scopes.has("GRADUATE"))) {
    return { ...base, mode: "GRADUATE" };
  }
  if (scopes.size === 1 && scopes.has("DOCTOR")) {
    return { ...base, mode: "SPECIFIC_DEGREE", degree: "DOCTOR" };
  }
  if ([...scopes].every((scope) => ["BACHELOR", "MASTER", "GRADUATE", "DOCTOR"].includes(scope))) {
    const degrees = [...scopes].map((scope) => scope as "BACHELOR" | "MASTER" | "GRADUATE" | "DOCTOR");
    return { ...base, mode: "EITHER_LEVEL", applicable_degrees: degrees as [typeof degrees[number]] };
  }
  return { ...base, mode: "CANDIDATE_WIDE" };
}

function stateApplicabilityFor(
  suffix: string,
  facts: readonly RequirementFact[],
  fragmentIds: readonly RequirementEvidenceFragmentId[]
): CandidateStateApplicability {
  const applicable = facts.flatMap((fact) => fact.applicability?.candidate_cohorts ?? []);
  if (applicable.length > 0) {
    return {
      candidate_state_applicability_id:
        branded<CandidateStateApplicabilityId>(`state-applicability:${suffix}`),
      mode: "COHORT_ANY_OF",
      candidate_cohorts: [...new Set(applicable)] as [typeof applicable[number]],
      evidence_fragment_ids: fragmentIds,
      certainty: "EXPLICIT",
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
    };
  }
  return {
    candidate_state_applicability_id:
      branded<CandidateStateApplicabilityId>(`state-applicability:${suffix}`),
    mode: "ALL_CANDIDATES",
    evidence_fragment_ids: fragmentIds,
    certainty: "EXPLICIT",
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
}

function requirementMandatoryRoot(
  compositionId: string,
  conditionIds: readonly RequirementConditionId[],
  fragmentIds: readonly RequirementEvidenceFragmentId[]
): RequirementMandatoryRoot {
  const id = branded<RequirementMandatoryRootId>(
    `mandatory-root:${sha256(stableSerialize({ compositionId, conditionIds }))}`
  );
  if (conditionIds.length === 0) {
    return {
      requirement_mandatory_root_id: id,
      kind: "EMPTY_CONFIRMED",
      evidence_fragment_ids: fragmentIds as [RequirementEvidenceFragmentId]
    };
  }
  if (conditionIds.length === 1) {
    return { requirement_mandatory_root_id: id, kind: "SINGLE", requirement_condition_id: conditionIds[0]! };
  }
  return {
    requirement_mandatory_root_id: id,
    kind: "AND",
    requirement_condition_ids: conditionIds as [RequirementConditionId, ...RequirementConditionId[]]
  };
}

function hasConditionalProfessionalComparison(fragment: RequirementEvidenceFragment) {
  return fragment.observed_value_state === "TEXT"
    && /(?:符合专业比对条件|专业相近率|课程(?:相同|相近)率).*(?:70%|百分之七十)/u.test(
      fragment.normalized_text?.text ?? fragment.original_text.text
    );
}

function sourceRole(surface: SourceSurface): Cr12RequirementSourceReference["source_role"] {
  if (surface.surface_kind === "ANNOUNCEMENT_BODY") return "ANNOUNCEMENT_UNIFORM";
  if (surface.surface_kind === "POSITION_TABLE_ROW") return "POSITION_TABLE_ROW";
  if (surface.surface_kind === "ANNOUNCEMENT_ATTACHMENT") return "REQUIREMENT_ATTACHMENT";
  if (surface.surface_kind === "SUPPLEMENT_NOTICE") return "SUPPLEMENT";
  if (surface.surface_kind === "CORRECTION_NOTICE") return "CORRECTION";
  return "OTHER_OFFICIAL_REQUIREMENT_SURFACE";
}

function requireResolvedTree(result: Cr12LogicExpressionResult) {
  if (result.status !== "RESOLVED") throw new Error(result.message);
  return result.tree;
}

function sourceOrder(observation: RequirementObservation) {
  return Number.parseInt(sha256(observation.requirement_observation_id).slice(0, 8), 16);
}

function observationLocator(
  observation: RequirementObservation,
  context: SurfaceProjectionContext
) {
  return structuredClone(observation.clause_locator ?? context.surface.locator);
}

function normalized(text: string, version: string) {
  return {
    text: text.normalize("NFKC"),
    unicode_form: "NFKC" as const,
    normalizer_version: version,
    operations: ["UNICODE_NORMALIZATION" as const]
  };
}

function uniqueById<Value>(values: readonly Value[], id: (value: Value) => string) {
  return [...new Map(values.map((value) => [id(value), value])).values()];
}

function branded<Type>(value: string) {
  return value as Type;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => {
    return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
  }).join(",")}}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
