import type {
  Cr12StructuredRequirementSet,
  PresentationDecisionV1,
  PresentationScope,
  PresentationSemanticDisplay,
  PresentationSemanticProjectionV2,
  PresentationSemanticRequirementSummary,
  PresentationSemanticValue,
  RecallDisposition,
  RequirementFact,
  SourceCompositionResult
} from "../domain";
import { PRESENTATION_SEMANTIC_PROJECTION_VERSION } from "../domain";
import type { PositionBoundOpportunityArtifact, PositionIdentityResolutionInput } from "../normalization";
import { canonicalHash } from "../normalization/canonical-artifact-registry";
import type { LegalEmploymentRelevanceAssessment } from "../domain";
import type { PositionBoundEligibilityAssessment } from "./position-bound-eligibility-assessment";
import type { PositionBoundRequirementSetVersion } from "./position-bound-requirement-set";
import type { RequirementProjectionArtifact } from "./trusted-requirement-projection";

type SemanticObject = { readonly [key: string]: PresentationSemanticValue };
type UnknownObject = { readonly [key: string]: unknown };
type Transform = (value: unknown) => PresentationSemanticValue;

export class PresentationSemanticProjectionError extends Error {
  readonly code = "SEMANTIC_PROJECTION_REVIEW_REQUIRED";
  constructor(message: string) {
    super(message);
    this.name = "PresentationSemanticProjectionError";
  }
}

export function buildPresentationSemanticProjectionV2(input: {
  readonly scope: PresentationScope;
  readonly graph: PositionBoundOpportunityArtifact;
  readonly source_bindings: readonly PositionIdentityResolutionInput[];
  readonly decision: Omit<PresentationDecisionV1, "presentation_decision_id" | "revision"
    | "supersedes_presentation_decision_id" | "decided_at" | "schema_version" | "integrity_hash">;
  readonly recall: RecallDisposition;
  readonly relevance: LegalEmploymentRelevanceAssessment | null;
  readonly eligibility: PositionBoundEligibilityAssessment | null;
  readonly requirement: PositionBoundRequirementSetVersion | null;
  readonly requirement_projection: RequirementProjectionArtifact | null;
  readonly composition: SourceCompositionResult | null;
}): PresentationSemanticProjectionV2 {
  const composition = input.composition ? compositionDescriptors(input.composition,
    input.graph, input.source_bindings) : null;
  const requirement = input.requirement ? requirementDescriptors(input.requirement.requirement_set,
    input.graph, composition) : null;
  const display = presentationDisplay(input.graph, input.requirement, requirement?.summary);
  const missing = (reason_code: string) => ({ state: "NOT_YET_AVAILABLE" as const, reason_code });
  const available = (value: PresentationSemanticValue) => ({ state: "AVAILABLE" as const, value });
  const projection: PresentationSemanticProjectionV2 = {
    projection_version: PRESENTATION_SEMANTIC_PROJECTION_VERSION,
    scope: input.scope,
    subject: {
      position_id: input.graph.position.position_id,
      identity_state: input.graph.position.identity_state,
      identity_hash: input.graph.position.identity_hash,
      identity_resolver_version: input.graph.position.identity_resolver_version
    },
    policy: { policy_id: input.decision.policy_id, policy_version: input.decision.policy_version },
    decision: {
      status: input.decision.status,
      reason_codes: [...input.decision.reason_codes].sort(),
      decision_basis: structuredClone(input.decision.decision_basis),
      approved_exclusion: input.recall.exclusion_rule ? project(input.recall.exclusion_rule,
        "policy_id policy_version rule_id rule_version reason_code matched_subject_identity") : null
    },
    relevance: input.relevance ? available(project(input.relevance,
      "assessment_state coverage_state taxonomy_version schema_version materialization_version decision_basis findings",
      "assessment_id position_id position_version_id opportunity_version_id source_composition_id source_composition_hash source_composition_manifest_hash source_occurrence_version_ids evidence_ids assessment_version created_at integrity_hash", {
        decision_basis: (value) => project(value,
          "position_binding direct_legal_evidence legal_major_evidence legal_qualification_evidence legal_adjacent_evidence non_law_function material_conflict evidence_gap_codes"),
        findings: (value) => items(value, (finding) => project(finding,
          "finding_kind semantic_code original_text locator source_surface_id",
          "finding_id source_composition_evidence_id source_occurrence_version_id snapshot_id extracted_record_id", {
            source_surface_id: (id) => id === null ? null : requireComposition(composition).surface(id),
            locator: nullableLocator
          }))
      })) : missing("RELEVANCE_ASSESSMENT_MISSING"),
    eligibility: input.eligibility ? available(eligibilityDescriptors(input.eligibility,
      requireRequirement(requirement))) : missing("ELIGIBILITY_ASSESSMENT_MISSING"),
    requirement: input.requirement ? available({
      materialization_version: input.requirement.materialization_version,
      projector_implementation_id: required(input.requirement_projection).projector_implementation_id,
      projector_schema_version: required(input.requirement_projection).schema_version,
      business_structure: requireRequirement(requirement).structure
    }) : missing("REQUIREMENT_SET_NOT_AVAILABLE"),
    source_trust: composition ? available(composition.structure) : missing("SOURCE_COMPOSITION_MISSING"),
    display
  };
  assertPresentationSemanticProjectionV2(projection);
  return structuredClone(projection);
}

export function presentationDisplay(graph: PositionBoundOpportunityArtifact,
  requirement: PositionBoundRequirementSetVersion | null,
  summary?: readonly PresentationSemanticRequirementSummary[]): PresentationSemanticDisplay {
  const content = graph.opportunity_version.content;
  const field = <Value>(value: Value | null | undefined, reason: string) => value == null
    ? { state: "NOT_YET_AVAILABLE" as const, reason }
    : { state: "AVAILABLE" as const, value: structuredClone(value) };
  return {
    employer: field(content.organization.name.original.text, "EMPLOYER_NOT_AVAILABLE"),
    position_title: field(graph.position_version.title.original.text, "POSITION_TITLE_NOT_AVAILABLE"),
    locations: field(content.locations.map((location) => location.raw_text.text), "LOCATION_NOT_AVAILABLE"),
    recruitment_year: field(content.recruitment_year, "RECRUITMENT_YEAR_NOT_AVAILABLE"),
    recruitment_batch: field(content.recruitment_batch?.original.text, "RECRUITMENT_BATCH_NOT_AVAILABLE"),
    announcement_link: field(content.announcement_locator, "ANNOUNCEMENT_LINK_NOT_AVAILABLE"),
    application_link: field(content.application_locator, "APPLICATION_LINK_NOT_AVAILABLE"),
    requirement_summary: field(requirement ? summary ?? requirement.requirement_set.fact_registry.map((fact) => semanticFactSummary(fact)) : null, "REQUIREMENT_SET_NOT_AVAILABLE"),
    effective_at: field(graph.opportunity_version.effective_from, "EFFECTIVE_TIME_NOT_AVAILABLE")
  };
}

export function semanticFactSummary(fact: RequirementFact, value: PresentationSemanticValue = requirementValue(fact.value)): PresentationSemanticRequirementSummary {
  return {
    dimension: fact.dimension, operator: fact.operator, value,
    subject_scope: fact.subject_scope, polarity: fact.polarity, certainty: fact.certainty,
    applicability: fact.applicability ? project(fact.applicability, "candidate_cohorts operator") : null,
    parser_version: fact.parser_version
  };
}

export function presentationRequirementSummary(input: {
  readonly requirement: PositionBoundRequirementSetVersion;
  readonly graph: PositionBoundOpportunityArtifact;
  readonly composition: SourceCompositionResult | null;
  readonly source_bindings: readonly PositionIdentityResolutionInput[];
}) {
  const composition = input.composition ? compositionDescriptors(input.composition, input.graph, input.source_bindings) : null;
  return requirementDescriptors(input.requirement.requirement_set, input.graph, composition).summary;
}

export function assertPresentationSemanticProjectionV2(projection: PresentationSemanticProjectionV2) {
  project(projection, "projection_version scope subject policy decision relevance eligibility requirement source_trust display");
  if (projection.projection_version !== PRESENTATION_SEMANTIC_PROJECTION_VERSION
      || !["PRODUCTION", "SYNTHETIC_TEST"].includes(projection.scope)) review("Unsupported projection contract");
  project(projection.subject, "position_id identity_state identity_hash identity_resolver_version");
  project(projection.policy, "policy_id policy_version");
  project(projection.decision, "status reason_codes decision_basis approved_exclusion");
  project(projection.decision.decision_basis, "recall_status relevance_state eligibility_result candidate_source_binding approved_exclusion");
  if (!projection.subject.position_id || !projection.subject.identity_resolver_version
      || !/^[a-f0-9]{64}$/u.test(projection.subject.identity_hash)
      || !["DISPLAY", "DISPLAY_WITH_REVIEW", "EVIDENCE_BLOCKED", "NOT_DISPLAY"].includes(projection.decision.status)
      || projection.decision.reason_codes.some((code) => typeof code !== "string" || !code)) review("Invalid semantic subject or decision descriptor");
  project(projection.display, "employer position_title locations recruitment_year recruitment_batch announcement_link application_link requirement_summary effective_at");
  for (const field of [projection.relevance, projection.eligibility, projection.requirement, projection.source_trust]) {
    if (field.state === "AVAILABLE") { project(field, "state value"); json(field.value); }
    else if (field.state === "NOT_YET_AVAILABLE") {
      project(field, "state reason_code");
      if (!field.reason_code) review("Missing semantic availability reason");
    }
    else review("Unsupported availability variant");
  }
  for (const [key, field] of Object.entries(projection.display)) {
    if (field.state === "AVAILABLE") {
      project(field, "state value");
      if (key === "recruitment_year" ? !Number.isInteger(field.value)
        : key === "locations" ? !Array.isArray(field.value) || field.value.some((item: unknown) => typeof item !== "string")
        : key === "requirement_summary" ? !Array.isArray(field.value)
        : typeof field.value !== "string") review(`Invalid display value: ${key}`);
      if (key === "requirement_summary") for (const summary of array(field.value)) {
        project(summary, "dimension operator value subject_scope polarity certainty applicability parser_version");
      }
    } else if (field.state === "NOT_YET_AVAILABLE") {
      project(field, "state reason");
      if (!field.reason) review("Missing display availability reason");
    } else review("Unsupported display availability variant");
  }
  return structuredClone(projection);
}

function requirementDescriptors(set: Cr12StructuredRequirementSet, graph: PositionBoundOpportunityArtifact,
  composition: ReturnType<typeof compositionDescriptors> | null) {
  const active = new Set<string>();
  const legacyGroups = set.fact_registry.map((entry) => entry.logic_group).filter((group, index, groups) => {
    const first = groups.findIndex((entry) => entry.logic_group_id === group.logic_group_id);
    if (canonicalHash(groups[first]) !== canonicalHash(group)) review("Conflicting legacy logic group identity");
    return first === index;
  });
  const resolve = (registry: readonly unknown[], ownId: string, id: unknown, transform: Transform): PresentationSemanticValue => {
    const key = `${ownId}:${String(id)}`;
    if (active.has(key)) review(`Cyclic semantic reference: ${key}`);
    const matches = registry.filter((entry) => object(entry)[ownId] === id);
    if (matches.length !== 1) review(`Missing or ambiguous semantic reference: ${key}`);
    active.add(key);
    try { return transform(matches[0]); } finally { active.delete(key); }
  };
  const fragment = (id: unknown): PresentationSemanticValue => resolve(set.evidence_fragment_registry,
    "requirement_evidence_fragment_id", id, (value) => project(value,
      "locator academic_program_directory academic_program_directories extractor_name extractor_version parser_version observed_value_state original_text normalized_text",
      "requirement_evidence_fragment_id extracted_record_id snapshot_id", { locator, original_text: nullableText, normalized_text: nullableText,
        academic_program_directory: directory, academic_program_directories: directories }));
  const fact = (id: unknown): PresentationSemanticValue => resolve(set.fact_registry, "requirement_fact_id", id,
    (value) => project(value, "dimension operator value subject_scope polarity certainty applicability parser_version logic_group",
      "requirement_fact_id opportunity_version_id", { value: semanticValue, applicability: (item) => item == null ? null : project(item, "candidate_cohorts operator"),
        logic_group: logicGroup }));
  const logicGroup = (value: unknown): PresentationSemanticValue => {
    const record = object(value);
    return project(value, "operator parent_logic_group_id", "logic_group_id", {
      parent_logic_group_id: (id) => id == null ? null : resolve(legacyGroups,
        "logic_group_id", id, logicGroup)
    });
  };
  const evidence = (id: unknown): PresentationSemanticValue => resolve(set.requirement_evidence_registry,
    "requirement_evidence_id", id, (value) => project(value,
      "requirement_fact_id locator evidence_text normalized_text extractor_name extractor_version parser_version",
      "requirement_evidence_id snapshot_id", { requirement_fact_id: fact, locator, evidence_text: text, normalized_text: nullableText }));
  const target = (value: unknown): PresentationSemanticValue => targetDescriptor(value, graph);
  const context = (id: unknown): PresentationSemanticValue => resolve(set.context_binding_registry,
    "requirement_context_binding_id", id, (value) => project(value,
      "source_context_target effective_targets scope state certainty source_locator evidence_fragment_ids resolver_version recruitment_revision_relation_id",
      "requirement_context_binding_id opportunity_version_id identity_evidence_ids", {
        source_context_target: target, effective_targets: (item) => items(item, target), source_locator: locator,
        evidence_fragment_ids: (item) => items(item, fragment)
      }));
  const credential = (id: unknown): PresentationSemanticValue => resolve(set.candidate_credential_applicability_registry,
    "candidate_credential_applicability_id", id, (value) => {
      const mode = object(value).mode;
      const fields: Record<string, string> = {
        CANDIDATE_WIDE: "", UNDERGRADUATE: "", GRADUATE: "", HIGHEST_DEGREE: "",
        SPECIFIC_DEGREE: "degree", ANY_DEGREE: "applicable_degrees", ALL_DEGREES: "applicable_degrees",
        EITHER_LEVEL: "applicable_degrees", UNRESOLVED: "raw_scope"
      };
      if (typeof mode !== "string" || !(mode in fields)) review("Unsupported credential applicability variant");
      return project(value, `mode certainty parser_version evidence_fragment_ids ${fields[String(mode)]}`,
        "candidate_credential_applicability_id", { evidence_fragment_ids: (item) => items(item, fragment), raw_scope: nullableText });
    });
  const state = (id: unknown): PresentationSemanticValue => resolve(set.candidate_state_applicability_registry,
    "candidate_state_applicability_id", id, (value) => {
      const mode = object(value).mode;
      const fields: Record<string, string> = { ALL_CANDIDATES: "", COHORT_ANY_OF: "candidate_cohorts",
        COHORT_ALL_OF: "candidate_cohorts", STATE_SELECTOR: "selector_logic_tree_id", UNRESOLVED: "raw_scope" };
      if (typeof mode !== "string" || !(mode in fields)) review("Unsupported state applicability variant");
      return project(value, `mode certainty parser_version evidence_fragment_ids ${fields[String(mode)]}`,
        "candidate_state_applicability_id", { evidence_fragment_ids: (item) => items(item, fragment),
          selector_logic_tree_id: selectorTree, raw_scope: nullableText });
    });
  const source = (id: unknown): PresentationSemanticValue => resolve(set.source_reference_registry,
    "requirement_source_reference_id", id, (value) => project(value,
      "source_role source_context_target applicable_binding_ids binding_evidence_fragment_ids source_locator source_surface_id relationship binding_state binding_certainty extractor_version parser_version resolver_version",
      "requirement_source_reference_id snapshot_id extracted_record_id identity_evidence_ids", {
        source_context_target: target, applicable_binding_ids: (item) => items(item, context),
        binding_evidence_fragment_ids: (item) => items(item, fragment), source_locator: locator,
        source_surface_id: (item) => item == null ? null : requireComposition(composition).surface(item),
        relationship: (item) => project(item, "kind target_source_reference_ids evidence_fragment_ids resolver_version", "", {
          target_source_reference_ids: (refs) => items(refs, source), evidence_fragment_ids: (refs) => items(refs, fragment)
        })
      }));
  const shared = { context_binding_ids: (item: unknown) => items(item, context),
    evidence_fragment_ids: (item: unknown) => items(item, fragment) };
  const semanticValue = (value: unknown) => requirementValue(value, { source, fragment, context, credential });
  const node = (value: unknown, registry: readonly unknown[], selector: boolean): PresentationSemanticValue => {
    const record = object(value);
    const ownId = selector ? "selector_logic_node_id" : "requirement_logic_node_id";
    const parentId = selector ? "selector_logic_tree_id" : "requirement_condition_id";
    const fields = record.kind === "GROUP" ? "operator child_node_ids" : record.kind === "NOT" ? "child_node_id"
      : record.kind === (selector ? "SELECTOR_PREDICATE" : "PREDICATE")
        ? (selector ? "requirement_selector_predicate_id" : "requirement_fact_id") : review("Unsupported logic variant");
    const child = (id: unknown) => resolve(registry, ownId, id, (item) => node(item, registry, selector));
    return project(value, `kind source_order context_binding_ids evidence_fragment_ids ${fields}`, `${ownId} ${parentId}`, {
      ...shared, child_node_ids: (item) => items(item, child), child_node_id: child,
      requirement_fact_id: fact, requirement_selector_predicate_id: selectorPredicate
    });
  };
  const tree = (id: unknown): PresentationSemanticValue => resolve(set.requirement_logic_tree_registry,
    "requirement_logic_tree_id", id, (value) => {
      const record = object(value);
      const nodes = array(record.nodes);
      return project(value, "root_node_id parser_version serialization_version", "requirement_logic_tree_id requirement_condition_id nodes", {
        root_node_id: (rootId) => resolve(nodes, "requirement_logic_node_id", rootId, (item) => node(item, nodes, false))
      });
    });
  const selectorPredicate = (id: unknown): PresentationSemanticValue => resolve(set.selector_predicate_registry,
    "requirement_selector_predicate_id", id, (value) => project(value,
      "dimension operator value candidate_credential_applicability_id direct_candidate_cohorts context_binding_ids evidence_fragment_ids source_locator parser_version resolution_state",
      "requirement_selector_predicate_id conditional_branch_set_id opportunity_version_id", {
        ...shared, value: semanticValue, candidate_credential_applicability_id: credential, source_locator: locator
      }));
  const selectorTree = (id: unknown): PresentationSemanticValue => resolve(set.selector_logic_tree_registry,
    "selector_logic_tree_id", id, (value) => {
      const record = object(value);
      const nodes = array(record.nodes);
      return project(value, "root_node_id parser_version serialization_version", "selector_logic_tree_id conditional_branch_set_id nodes", {
        root_node_id: (rootId) => resolve(nodes, "selector_logic_node_id", rootId, (item) => node(item, nodes, true))
      });
    });
  const branch = (id: unknown): PresentationSemanticValue => resolve(set.conditional_branch_set_registry,
    "conditional_branch_set_id", id, (value) => project(value,
      "when_selector_logic_tree_id then_requirement_logic_tree_id else_requirement_logic_tree_id candidate_credential_applicability_id candidate_state_applicability_id context_binding_ids evidence_fragment_ids branch_semantics_state source_order parser_version resolver_version",
      "conditional_branch_set_id requirement_condition_id", { ...shared,
        when_selector_logic_tree_id: selectorTree, then_requirement_logic_tree_id: tree,
        else_requirement_logic_tree_id: (item) => item == null ? null : tree(item),
        candidate_credential_applicability_id: credential, candidate_state_applicability_id: state
      }));
  const observation = (id: unknown): PresentationSemanticValue => resolve(set.observation_registry,
    "requirement_observation_id", id, (value) => project(value,
      "status clause_role dimension_hint original_clause clause_locator requirement_fact_ids evidence_fragment_ids parser_version",
      "requirement_observation_id opportunity_version_id", {
        original_clause: nullableText, clause_locator: nullableLocator,
        requirement_fact_ids: (item) => items(item, fact), evidence_fragment_ids: (item) => items(item, fragment)
      }));
  const condition = (id: unknown): PresentationSemanticValue => resolve(set.condition_registry,
    "requirement_condition_id", id, (value) => {
      const record = object(value);
      const fields = record.representation_kind === "LOGIC_TREE" ? "requirement_logic_tree_id"
        : record.representation_kind === "CONDITIONAL_BRANCH_SET" ? "conditional_branch_set_id"
          : record.representation_kind === "UNRESOLVED" ? "blocking_observation_ids" : review("Unsupported condition variant");
      return project(value, `modality candidate_credential_applicability_id candidate_state_applicability_id context_binding_ids source_reference_ids evidence_fragment_ids source_locator source_order parser_version resolver_version resolution_state representation_kind ${fields}`,
        "requirement_condition_id opportunity_version_id projected_from_legacy_fact_ids projected_from_legacy_evidence_ids", {
          ...shared, candidate_credential_applicability_id: credential, candidate_state_applicability_id: state,
          source_reference_ids: (item) => items(item, source), source_locator: locator,
          requirement_logic_tree_id: tree, conditional_branch_set_id: branch,
          blocking_observation_ids: (item) => items(item, observation)
        });
    });
  const rootRecord = object(set.mandatory_root);
  const rootFields = rootRecord.kind === "EMPTY_CONFIRMED" ? "evidence_fragment_ids"
    : rootRecord.kind === "SINGLE" ? "requirement_condition_id"
      : rootRecord.kind === "AND" ? "requirement_condition_ids" : review("Unsupported mandatory root");
  const root = project(set.mandatory_root, `kind ${rootFields}`, "requirement_mandatory_root_id", {
    evidence_fragment_ids: (item) => items(item, fragment), requirement_condition_id: condition,
    requirement_condition_ids: (item) => items(item, condition)
  });
  const structure = project(set,
    "logic_model_version source_composition_state mandatory_root completeness execution_manifest parser_version resolver_version",
    "requirement_set_id opportunity_version_id source_composition_reference condition_registry requirement_logic_tree_registry fact_registry candidate_credential_applicability_registry candidate_state_applicability_registry context_binding_registry source_reference_registry selector_predicate_registry selector_logic_tree_registry conditional_branch_set_registry evidence_fragment_registry requirement_evidence_registry observation_registry", {
      mandatory_root: () => root,
      completeness: (value) => project(value, "status blockers gate_version", "manifest requirement_set_content_hash", {
        blockers: (item) => items(item, (blocker) => project(blocker, "code diagnostic_code description observation_ids evidence_fragment_ids", "", {
          observation_ids: (refs) => items(refs, observation), evidence_fragment_ids: (refs) => items(refs, fragment)
        }))
      }),
      execution_manifest: (value) => project(value, "logic_model_version required_engine_capabilities execution_gate", "", {
        execution_gate: (gate) => project(gate, "status reason required_capabilities supported_capabilities missing_capabilities")
      })
    });
  const manifest = project(set.completeness.manifest,
    "logic_model_version source_composition_state parser_versions extractor_versions resolver_versions required_engine_capabilities gate_version serialization_version",
    "opportunity_version_id source_composition_reference requirement_mandatory_root_id requirement_condition_ids requirement_logic_tree_ids requirement_logic_node_ids requirement_fact_ids candidate_credential_applicability_ids candidate_state_applicability_ids requirement_context_binding_ids requirement_source_reference_ids requirement_selector_predicate_ids selector_logic_tree_ids selector_logic_node_ids conditional_branch_set_ids evidence_fragment_ids requirement_evidence_ids observation_ids completeness_blocker_fingerprints snapshot_ids extracted_record_ids");
  return { fact, condition, summary: set.fact_registry.map((item) => semanticFactSummary(item, semanticValue(item.value))), structure: { ...structure, manifest,
    observations: set.observation_registry.map((item) => observation(item.requirement_observation_id)),
    conditions: set.condition_registry.map((item) => condition(item.requirement_condition_id)),
    facts: set.fact_registry.map((item) => fact(item.requirement_fact_id)),
    evidence: set.requirement_evidence_registry.map((item) => evidence(item.requirement_evidence_id)),
    logic_trees: set.requirement_logic_tree_registry.map((item) => tree(item.requirement_logic_tree_id)),
    credentials: set.candidate_credential_applicability_registry.map((item) => credential(item.candidate_credential_applicability_id)),
    states: set.candidate_state_applicability_registry.map((item) => state(item.candidate_state_applicability_id)),
    contexts: set.context_binding_registry.map((item) => context(item.requirement_context_binding_id)),
    source_references: set.source_reference_registry.map((item) => source(item.requirement_source_reference_id)),
    selector_predicates: set.selector_predicate_registry.map((item) => selectorPredicate(item.requirement_selector_predicate_id)),
    selector_trees: set.selector_logic_tree_registry.map((item) => selectorTree(item.selector_logic_tree_id)),
    branches: set.conditional_branch_set_registry.map((item) => branch(item.conditional_branch_set_id)),
    fragments: set.evidence_fragment_registry.map((item) => fragment(item.requirement_evidence_fragment_id))
  } };
}

function eligibilityDescriptors(assessment: PositionBoundEligibilityAssessment,
  requirement: ReturnType<typeof requirementDescriptors>): PresentationSemanticValue {
  const basis = assessment.decision_basis;
  return {
    result: assessment.result, reason_codes: [...assessment.reason_codes].sort(),
    assessment_scope: assessment.assessment_scope, candidate_evidence_scope: basis.candidate_evidence_scope,
    predicate_rule_version: assessment.predicate_rule_version,
    predicate_rule_versions: [...basis.predicate_rule_versions].sort(),
    assessment_rule_version: assessment.assessment_rule_version, materialization_version: assessment.materialization_version,
    as_of: assessment.as_of, aggregation_reason: basis.aggregation_reason,
    unresolved_reason_codes: [...basis.unresolved_reason_codes].sort(),
    conditions: basis.condition_results.map((condition) => ({
      condition: requirement.condition(condition.requirement_condition_id), modality: condition.modality,
      logical_result: condition.logical_result, facts: condition.requirement_fact_ids.map(requirement.fact)
    })),
    predicates: basis.predicate_resolutions.map((predicate) => ({
      fact: requirement.fact(predicate.requirement_fact_id), applicability: predicate.applicability,
      resolution_status: predicate.resolution_status, logical_result: predicate.logical_result,
      reason_codes: [...predicate.reason_codes].sort(),
      predicate_semantic_hash: predicate.predicate_resolution_semantic_hash,
      candidate_evidence: predicate.candidate_evidence_references.map(candidateEvidence)
    })),
    candidate_evidence: basis.candidate_evidence.map(candidateEvidence)
  };
}

function candidateEvidence(value: unknown): PresentationSemanticValue {
  return project(value, "predicate_candidate_evidence_id predicate_candidate_evidence_hash candidate_state_assertion_id candidate_state_assertion_hash observation_status provenance synthetic_test observed_at effective_from effective_to",
    "candidate_credential_id source_reference_ids source_references");
}

function compositionDescriptors(composition: SourceCompositionResult, graph: PositionBoundOpportunityArtifact,
  bindings: readonly PositionIdentityResolutionInput[]) {
  const active = new Set<string>();
  const resolve = (entries: readonly unknown[], ownId: string, id: unknown, transform: Transform): PresentationSemanticValue => {
    const key = `${ownId}:${String(id)}`;
    if (active.has(key)) review(`Cyclic composition reference: ${key}`);
    const matches = entries.filter((entry) => object(entry)[ownId] === id);
    if (matches.length !== 1) review(`Missing or ambiguous composition reference: ${ownId}:${String(id)}`);
    active.add(key);
    try { return transform(matches[0]); } finally { active.delete(key); }
  };
  const surface = (id: unknown): PresentationSemanticValue => resolve(composition.source_surfaces, "source_surface_id", id, (value) => {
    const record = object(value);
    const source = bindings.find((binding) => binding.version.source_occurrence_version_id === record.source_occurrence_version_id);
    if (!source) review("Unverified surface source identity");
    return {
      source_definition_id: source!.endpoint.source_definition_id,
      recruitment_endpoint_id: source!.endpoint.recruitment_endpoint_id,
      source_occurrence_id: source!.occurrence.source_occurrence_id,
      ...project(value, "surface_kind locator surface_content_hash surface_status composition_role target_scope effective_period source_publication_time extractor_version parser_version resolver_version schema_version",
        "source_surface_id source_occurrence_version_id snapshot_id extracted_record_id observed_at evidence_ids", { locator, effective_period: period })
    };
  });
  const authority = (id: unknown): PresentationSemanticValue => resolve(composition.authority_assertions,
    "authority_assertion_id", id, (value) => project(value,
      "issuer authority_state target_scope effective_period asserted_source_surface_id authority_basis_source_surface_id authority_basis_binding_id resolver_version schema_version",
      "authority_assertion_id evidence_ids authority_assertion_hash", {
        effective_period: period, asserted_source_surface_id: surface, authority_basis_source_surface_id: surface,
        authority_basis_binding_id: (item) => item == null ? null : binding(item)
      }));
  const binding = (id: unknown): PresentationSemanticValue => resolve(composition.source_surface_bindings,
    "source_surface_binding_id", id, (value) => {
      const record = object(value);
      const fields = record.binding_kind === "ATTACHMENT_PUBLICATION"
        ? "attachment_surface_id publication_source_surface_id"
        : record.binding_kind === "ATTACHMENT_ROW"
          ? "attachment_publication_binding_id attachment_surface_id position_version_id opportunity_version_id row_locator cell_locator page_locator span_locator binding_version" : "";
      return project(value, `source_surface_id target_type target_id target_version_id binding_kind binding_status locator schema_version resolver_version created_context observed_context ${fields}`,
        "source_surface_binding_id evidence_ids binding_hash attachment_publication_binding_id attachment_to_position_binding_id", {
          source_surface_id: surface, attachment_surface_id: surface, publication_source_surface_id: surface,
          attachment_publication_binding_id: binding,
          position_version_id: () => graph.position.position_id, opportunity_version_id: () => graph.position.position_id,
          target_id: (item) => sourceTarget(record.target_type, item, graph),
          target_version_id: (item) => item == null ? null : sourceTarget(record.target_type, item, graph), locator,
          created_context: bindingContext, observed_context: bindingContext
        });
    });
  const bindingContext = (value: unknown): PresentationSemanticValue => project(value, "resolver_version source_occurrence_version_id",
    "snapshot_id extracted_record_id observed_at", { source_occurrence_version_id: (id) => {
      const source = bindings.find((item) => item.version.source_occurrence_version_id === id);
      if (!source) review("Binding context has no verified SOV descriptor");
      return { source_definition_id: source!.endpoint.source_definition_id,
        recruitment_endpoint_id: source!.endpoint.recruitment_endpoint_id, source_occurrence_id: source!.occurrence.source_occurrence_id };
    } });
  const selection = (id: unknown): PresentationSemanticValue => resolve(composition.source_version_selections,
    "source_version_selection_id", id, (value) => project(value,
      "source_identity target_scope candidate_source_surface_ids selected_source_surface_id excluded_source_surface_ids selection_status source_publication_time effective_period correction_time observation_time ingestion_time resolver_version schema_version",
      "source_version_selection_id evidence_ids source_version_selection_hash", {
        candidate_source_surface_ids: (item) => items(item, surface), selected_source_surface_id: (item) => item == null ? null : surface(item),
        excluded_source_surface_ids: (item) => items(item, surface), effective_period: period
      }));
  const entry = (value: unknown): PresentationSemanticValue => project(value,
    "expected_surface_key expectedness requirement_level authority_status binding_status version_selection_status coverage_status resolution_status target_scope source_surface_id authority_assertion_id material_binding_ids source_version_selection_id",
    "expected_surface_manifest_entry_id evidence_ids expected_surface_manifest_entry_hash", {
      source_surface_id: (item) => item === null ? null : surface(item),
      authority_assertion_id: (item) => item == null ? null : authority(item),
      material_binding_ids: (item) => items(item, binding), source_version_selection_id: (item) => item == null ? null : selection(item)
    });
  const structure: SemanticObject = {
    integrity: "VERIFIED",
    composition: project(composition, "status schema_version serialization_version extractor_version parser_version discovery_resolver_version composition_resolver_version composition_as_of",
      "opportunity_version_id discovery_boundary inventory evidence_registry source_surfaces source_surface_bindings authority_assertions source_version_selections surface_revision_relations precedence_decisions source_conflicts source_composition_id composition_hash composition_manifest_hash"),
    discovery_boundary: project(composition.discovery_boundary, "boundary_kind discovery_scope admissible_relation_kinds initiating_source_surface_ids",
      "discovery_boundary_id opportunity_version_id source_metadata_references evidence_ids composition_as_of observed_at extractor_version discovery_resolver_version schema_version discovery_boundary_hash", {
        initiating_source_surface_ids: (item) => items(item, surface)
      }),
    inventory: project(composition.inventory, "inventory_completeness_status expected_surface_entries unexpected_surface_dispositions",
      "source_package_inventory_id discovery_boundary_id composition_as_of discovered_source_surface_ids discovery_resolver_version schema_version source_package_inventory_hash", {
        expected_surface_entries: (item) => items(item, entry),
        unexpected_surface_dispositions: (item) => items(item, (value) => project(value, "expected_surface_manifest_entry_id disposition resolver_version schema_version", "evidence_ids", {
          expected_surface_manifest_entry_id: (id) => resolve(composition.inventory.expected_surface_entries, "expected_surface_manifest_entry_id", id, entry)
        }))
      }),
    surfaces: composition.source_surfaces.map((item) => surface(item.source_surface_id)),
    authority: composition.authority_assertions.map((item) => authority(item.authority_assertion_id)),
    binding: composition.source_surface_bindings.map((item) => binding(item.source_surface_binding_id)),
    selection: composition.source_version_selections.map((item) => selection(item.source_version_selection_id)),
    revision_relations: composition.surface_revision_relations.map((item) => project(item,
      "source_surface_id target_surface_ids relation_kind relation_status target_scope requirement_scope effective_period authority_assertion_ids resolver_version schema_version affects_required_coverage",
      "surface_revision_relation_id evidence_ids surface_revision_relation_hash", {
        source_surface_id: surface, target_surface_ids: (value) => items(value, surface), effective_period: period,
        authority_assertion_ids: (value) => items(value, authority)
      })),
    precedence: composition.precedence_decisions.map((item) => project(item,
      "selected_source_surface_ids excluded_source_surface_ids applicable_scope effective_period composition_as_of authority_assertion_ids precedence_rule decision_status resolver_version schema_version",
      "precedence_decision_id evidence_ids source_precedence_decision_hash", {
        selected_source_surface_ids: (value) => items(value, surface), excluded_source_surface_ids: (value) => items(value, surface),
        effective_period: period, authority_assertion_ids: (value) => items(value, authority)
      })),
    conflicts: composition.source_conflicts.map((item) => {
      if (item.competing_observation_ids.length > 0) review("Conflict observations need verified Requirement observation descriptors");
      return project(item,
      "competing_source_surface_ids target_scope requirement_scope authority_assertion_ids effective_period status affects_required_coverage resolver_version schema_version",
      "source_conflict_id competing_observation_ids evidence_ids source_conflict_hash", {
        competing_source_surface_ids: (value) => items(value, surface), authority_assertion_ids: (value) => items(value, authority), effective_period: period
      });
    })
  };
  return { surface, structure };
}

function targetDescriptor(value: unknown, graph: PositionBoundOpportunityArtifact): PresentationSemanticValue {
  const record = object(value);
  const fields: Record<string, string> = { ANNOUNCEMENT: "announcement_id", ANNOUNCEMENT_VERSION: "announcement_version_id",
    RECRUITMENT_PLAN: "recruitment_plan_id", RECRUITMENT_BATCH: "recruitment_batch_id", POSITION: "position_id",
    POSITION_VERSION: "position_version_id", OPPORTUNITY: "opportunity_id", OPPORTUNITY_VERSION: "opportunity_version_id",
    LOCATION_ASSIGNMENT: "location_assignment_id", REVISION_RELATION: "recruitment_revision_relation_id affected_target", UNRESOLVED: "raw_target" };
  const kind = String(record.kind);
  if (!(kind in fields)) review("Unsupported context target");
  return project(value, `kind ${fields[kind]}`, "", {
    position_version_id: (id) => sourceTarget("POSITION_VERSION", id, graph),
    opportunity_version_id: (id) => sourceTarget("OPPORTUNITY_VERSION", id, graph),
    affected_target: (item) => targetDescriptor(item, graph), raw_target: nullableText
  });
}

function sourceTarget(type: unknown, id: unknown, graph: PositionBoundOpportunityArtifact): PresentationSemanticValue {
  if (type === "POSITION_VERSION") {
    if (id !== graph.position_version.position_version_id && id !== graph.position.position_id) review("Unverified Position target");
    return { position_id: graph.position.position_id, effective_from: graph.position_version.effective_from };
  }
  if (type === "OPPORTUNITY_VERSION") {
    if (id !== graph.opportunity_version.opportunity_version_id && id !== graph.canonical_opportunity.canonical_opportunity_id) review("Unverified PBOV target");
    return { position_id: graph.position.position_id, effective_from: graph.opportunity_version.effective_from };
  }
  return json(id);
}

function requirementValue(value: unknown, references?: Readonly<Record<"source" | "fragment" | "context" | "credential", Transform>>): PresentationSemanticValue {
  const record = object(value);
  const kind = String(record.kind);
  if (kind === "MAJOR_SCOPE_RELATIONSHIP") return project(value, "kind relationship", "", {
    relationship: (item) => project(item, "mode undergraduate_scope graduate_scope")
  });
  if (kind === "PROGRAM_REFERENCE") return project(value, "kind reference", "", { reference: programReference });
  if (kind === "MAJOR_MATCH_RULE") return project(value, "kind rule", "", { rule: (item) => {
    const variants: Record<string, string> = { EXACT_CODE: "", EXACT_NAME: "", CATEGORY: "", CODE_SET: "codes",
      EXCEPTION_LIST: "exception_reference", EXTERNAL_DIRECTORY_REFERENCE: "directory_namespace directory_version" };
    const ruleKind = String(object(item).kind);
    if (!(ruleKind in variants)) review("Unsupported major-match rule contract");
    return project(item, `kind unresolved_behavior ${variants[ruleKind]}`, "", { exception_reference: text });
  } });
  if (kind === "GENERAL_ELIGIBILITY_PREDICATE") {
    const refs = required(references ?? null);
    return project(value, "kind predicate", "", { predicate: (item) => project(item,
      "dimension predicate_kind target temporal_relation source_reference_ids evidence_fragment_ids source_resolution_state parser_version resolver_version schema_version",
      "requirement_predicate_id", {
        source_reference_ids: (ids) => items(ids, refs.source), evidence_fragment_ids: (ids) => items(ids, refs.fragment),
        target: (target) => {
          const variants: Record<string, string> = { CITIZENSHIP: "citizenship_code", SERVICE_OR_ENROLMENT_STATUS: "status reference_date",
            DISQUALIFICATION_RECORD: "record_kind authority jurisdiction reference_date", FORMAL_CLEARANCE_DECISION: "issuer decision_kind decision_status effective_from effective_to" };
          const targetKind = String(object(target).kind);
          if (!(targetKind in variants)) review("Unsupported general-eligibility target contract");
          return project(target, `kind ${variants[targetKind]}`);
        }
      }) });
  }
  if (kind === "CR11_MAJOR_SEMANTIC") {
    const refs = required(references ?? null);
    return project(value, "kind projection", "", { projection: (item) => {
      const projection = object(item);
      const expression = projection.major_expression;
      return project(item,
        "major_expression major_match_relations candidate_credential_applicability_id context_binding_ids evidence_fragment_ids source_locator source_order source_resolution_state parser_version resolver_version projection_version required_engine_capability",
        "major_semantic_projection_id requirement_fact_id", {
          candidate_credential_applicability_id: refs.credential, context_binding_ids: (ids) => items(ids, refs.context),
          evidence_fragment_ids: (ids) => items(ids, refs.fragment), source_locator: locator,
          major_expression: (entry) => project(entry, "raw_expression normalized_expression semantic_type major_scope major_identity source_resolution_state evidence_fragment_ids source_locator parser_version resolver_version",
            "major_expression_id", { raw_expression: text, normalized_expression: nullableText, major_identity: nullableMajorIdentity,
              evidence_fragment_ids: (ids) => items(ids, refs.fragment), source_locator: locator }),
          major_match_relations: (entries) => items(entries, (entry) => {
            if (object(entry).source_major_expression_id !== object(expression).major_expression_id) review("Unverified major-expression relation");
            return project(entry, "target_semantic_type target_major_identity target_major_scope candidate_major_identity candidate_credential_applicability_id relation_kind relation_state directory_reference evidence_fragment_ids source_locator evidence_version parser_version resolver_version certainty required_engine_capability",
              "major_match_relation_id source_major_expression_id", { target_major_identity: nullableMajorIdentity,
                candidate_major_identity: (identity) => project(identity, "semantic_code identity_label normalized_label credential_level major_code directory_namespace directory_version provenance_state", "", { identity_label: text, normalized_label: nullableText }),
                candidate_credential_applicability_id: refs.credential, directory_reference: majorDirectory,
                evidence_fragment_ids: (ids) => items(ids, refs.fragment), source_locator: locator });
          })
        });
    } });
  }
  const fields: Record<string, string> = { CODE: "code label", CODE_SET: "codes labels", BOOLEAN: "value", INTEGER: "value unit",
    AGE: "years reference_date", AGE_RANGE: "lower_bound upper_bound reference_date", WORK_EXPERIENCE: "minimum_years maximum_years experience_scope reference_date scope_definition",
    GRADUATION_WINDOW: "exact_graduation_year graduation_year_range current_cohort cohort_condition",
    PROFESSIONAL_QUALIFICATION: "qualification_type qualification_class strength", TEXT: "value", UNRESTRICTED: "" };
  if (!(String(record.kind) in fields)) review(`Unsupported Requirement value contract: ${String(record.kind)}`);
  return project(value, `kind ${fields[String(record.kind)]}`, "", {
    label: nullableText, labels: (item) => item == null ? null : items(item, text),
    experience_scope: text, cohort_condition: nullableText,
    value: record.kind === "TEXT" ? text : json,
    graduation_year_range: (item) => item == null ? null : project(item, "start_year end_year start_inclusive end_inclusive"),
    lower_bound: (item) => item == null ? null : project(item, "years inclusive"),
    upper_bound: (item) => item == null ? null : project(item, "years inclusive")
  });
}

function programReference(value: unknown) { return project(value, "directory_namespace directory_version program_code program_label program_category program_type", "", { program_label: nullableText, program_category: nullableText }); }
function majorDirectory(value: unknown) { return value == null ? null : project(value, "directory_namespace directory_version program_code program_label category_level", "", { program_label: nullableText }); }
function nullableMajorIdentity(value: unknown) { return value == null ? null : project(value, "semantic_code source_label normalized_label identity_kind directory_reference", "major_identity_id", { source_label: text, normalized_label: nullableText, directory_reference: majorDirectory }); }

function project(value: unknown, fields: string, provenance = "", transforms: Readonly<Record<string, Transform>> = {}): SemanticObject {
  const record = object(value);
  const keys = fields.split(" ").filter(Boolean);
  const allowed = new Set([...keys, ...provenance.split(" ").filter(Boolean)]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) review(`Unsupported semantic field: ${key}`);
  return Object.fromEntries(keys.map((key) => [key,
    record[key] === undefined ? null : (transforms[key] ?? json)(record[key])])) as SemanticObject;
}
function object(value: unknown): UnknownObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) review("Semantic descriptor must be an object");
  return value as UnknownObject;
}
function json(value: unknown): PresentationSemanticValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  const record = object(value);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, json(item)]));
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) review("Semantic descriptor must be an array");
  return value;
}
function items(value: unknown, transform: Transform): readonly PresentationSemanticValue[] { return array(value).map(transform); }
function locator(value: unknown) { return project(value, "kind selector field_path section sheet cell_or_range json_path text_locator page_number start_offset end_offset"); }
function nullableLocator(value: unknown) { return value == null ? null : locator(value); }
function text(value: unknown) {
  return project(value, "encoding" in object(value) ? "text encoding" : "text unicode_form normalizer_version operations");
}
function nullableText(value: unknown) { return value == null ? null : text(value); }
function period(value: unknown) { return project(value, "effective_from effective_to"); }
function directory(value: unknown) { return value == null ? null : project(value, "directory_namespace directory_version program_category program_type", "", { program_category: nullableText }); }
function directories(value: unknown) {
  if (value == null) return null;
  return project(value, "BACHELOR MASTER GRADUATE DOCTOR", "", { BACHELOR: directory, MASTER: directory, GRADUATE: directory, DOCTOR: directory });
}
function requireRequirement(value: ReturnType<typeof requirementDescriptors> | null) { return required(value); }
function requireComposition(value: ReturnType<typeof compositionDescriptors> | null) { return required(value); }
function required<Value>(value: Value | null): Value { if (value === null) review("Missing verified descriptor dependency"); return value; }
function review(message: string): never { throw new PresentationSemanticProjectionError(message); }

export function presentationSemanticHash(projection: PresentationSemanticProjectionV2) {
  return canonicalHash(assertPresentationSemanticProjectionV2(projection));
}
