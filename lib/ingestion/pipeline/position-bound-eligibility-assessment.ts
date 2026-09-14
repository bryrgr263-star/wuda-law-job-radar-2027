import { createHash } from "node:crypto";

import type {
  CandidateProfileId,
  CanonicalOpportunity,
  Cr12EngineCapability,
  Cr12RequirementCondition,
  Cr12RequirementLogicNode,
  Cr12StructuredRequirementSet,
  EligibilityResult,
  IsoDateTime,
  Position,
  PositionBoundOpportunityVersion,
  PositionVersion,
  RequirementConditionId,
  RequirementFactId,
  SourceCompositionResult
} from "../domain";
import {
  ELIGIBILITY_RESULTS,
  SOURCE_COMPOSITION_GATE_VERSION,
  validatePosition,
  validatePositionVersion
} from "../domain";
import type { TrustedSourceCompositionGate } from "../eligibility";
import {
  assertPositionBoundOpportunityGraphMatchesTrustedArtifact,
  assertPositionBoundOpportunityVersionIntegrity,
  type TrustedPositionBoundOpportunityGate
} from "../normalization";
import { assertCr12StructuredRequirementSetIntegrity } from "../requirements";
import {
  POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION,
  assertPositionBoundRequirementSetVersionIntegrity,
  type PositionBoundRequirementSetVersion
} from "./position-bound-requirement-set";
import {
  InMemoryPositionBoundPredicateResolutionTracker,
  PREDICATE_RESOLUTION_MATERIALIZATION_VERSION,
  assertPositionBoundPredicateResolutionIntegrity,
  type PositionBoundPredicateResolution,
  type PositionBoundPredicateResolutionResult,
  type PredicateCandidateEvidence,
  type PredicateCandidateEvidenceReference,
  type PredicateResolutionReasonCode,
  type PredicateResolutionStatus
} from "./position-bound-predicate-resolution";

export const ELIGIBILITY_ASSESSMENT_MATERIALIZATION_VERSION =
  "position-bound-eligibility-assessment/1.0.0" as const;
export const ELIGIBILITY_ASSESSMENT_RULE_VERSION =
  "eligibility-assessment-rules/1.0.0" as const;

export const PHASE_I_SUPPORTED_ENGINE_CAPABILITIES = [
  "LOGIC_TREE_V1",
  "NOT_V1",
  "MODALITY_V1",
  "CREDENTIAL_APPLICABILITY_V1",
  "CANDIDATE_STATE_APPLICABILITY_V1",
  "CONTEXT_BINDING_V1",
  "SOURCE_REFERENCE_MANIFEST_V1",
  "CONTENT_HASH_MANIFEST_V1",
  "CR10_MAJOR_MATCH_RELATION_V1",
  "SOURCE_COMPOSITION_GATE_V1",
  "GENERAL_ELIGIBILITY_PREDICATE_V1"
] as const satisfies readonly Cr12EngineCapability[];

export const POSITION_BOUND_ELIGIBILITY_ASSESSMENT_RESULTS = ELIGIBILITY_RESULTS;

export type PositionBoundEligibilityAssessmentStatus =
  EligibilityResult;

export type EligibilityAssessmentScope = "PRODUCTION" | "SYNTHETIC_TEST";

export type PositionBoundEligibilityAssessmentReasonCode =
  | "MANDATORY_REQUIREMENTS_SATISFIED"
  | "PROVEN_MANDATORY_REQUIREMENT_NOT_SATISFIED"
  | "MANDATORY_REQUIREMENT_UNKNOWN"
  | "MANDATORY_REQUIREMENT_INSUFFICIENT"
  | "MANDATORY_REQUIREMENT_REVIEW_REQUIRED";

export interface EligibilityAssessmentConditionResult {
  readonly requirement_condition_id: RequirementConditionId;
  readonly modality: Cr12RequirementCondition["modality"];
  readonly logical_result: "TRUE" | "FALSE" | "UNKNOWN";
  readonly requirement_fact_ids: readonly RequirementFactId[];
}

export interface EligibilityAssessmentPredicateResolutionReference {
  readonly predicate_resolution_id: string;
  readonly predicate_resolution_revision: number;
  readonly predicate_resolution_semantic_hash: string;
  readonly requirement_fact_id: RequirementFactId;
  readonly requirement_predicate_id?: string;
  readonly applicability: PositionBoundPredicateResolution["applicability"];
  readonly resolution_status: PredicateResolutionStatus;
  readonly logical_result: PositionBoundPredicateResolution["logical_result"];
  readonly reason_codes: readonly PredicateResolutionReasonCode[];
  readonly requirement_source_reference_ids: readonly string[];
  readonly requirement_evidence_fragment_ids: readonly string[];
  readonly requirement_evidence_ids: readonly string[];
  readonly candidate_evidence_references:
    readonly PredicateCandidateEvidenceReference[];
}

export interface EligibilityAssessmentCandidateEvidenceReference {
  readonly predicate_candidate_evidence_id: string;
  readonly predicate_candidate_evidence_hash: string;
  readonly candidate_credential_id?: string;
  readonly observation_status:
    PredicateCandidateEvidence["observation_status"];
  readonly provenance: PredicateCandidateEvidence["provenance"];
  readonly observed_at: IsoDateTime;
  readonly effective_from?: IsoDateTime;
  readonly effective_to?: IsoDateTime;
  readonly source_reference_ids: readonly string[];
  readonly synthetic_test: boolean;
}

export interface EligibilityAssessmentDecisionBasis {
  readonly requirement_set_version_id: string;
  readonly requirement_set_id: string;
  readonly requirement_set_content_hash: string;
  readonly source_composition_id: string;
  readonly source_composition_hash: string;
  readonly source_occurrence_version_ids: readonly string[];
  readonly condition_results: readonly EligibilityAssessmentConditionResult[];
  readonly predicate_resolutions:
    readonly EligibilityAssessmentPredicateResolutionReference[];
  readonly supporting_predicate_resolution_ids: readonly string[];
  readonly negative_predicate_resolution_ids: readonly string[];
  readonly candidate_evidence:
    readonly EligibilityAssessmentCandidateEvidenceReference[];
  readonly candidate_evidence_scope: EligibilityAssessmentScope;
  readonly requirement_source_reference_ids: readonly string[];
  readonly requirement_evidence_fragment_ids: readonly string[];
  readonly requirement_evidence_ids: readonly string[];
  readonly predicate_rule_versions: readonly string[];
  readonly assessment_rule_version: string;
  readonly as_of: IsoDateTime;
  readonly unresolved_reason_codes: readonly PredicateResolutionReasonCode[];
  readonly aggregation_reason: PositionBoundEligibilityAssessmentReasonCode;
}

export interface PositionBoundEligibilityAssessment {
  readonly eligibility_assessment_id: string;
  readonly candidate_profile_id: CandidateProfileId;
  readonly canonical_opportunity_id:
    CanonicalOpportunity["canonical_opportunity_id"];
  readonly opportunity_version_id:
    PositionBoundOpportunityVersion["opportunity_version_id"];
  readonly position_id: Position["position_id"];
  readonly position_version_id: PositionVersion["position_version_id"];
  readonly position_version_semantic_hash: PositionVersion["semantic_hash"];
  readonly opportunity_version_semantic_hash:
    PositionBoundOpportunityVersion["semantic_hash"];
  readonly requirement_set_version_id: string;
  readonly requirement_set_id: string;
  readonly requirement_set_semantic_hash: string;
  readonly requirement_set_content_hash: string;
  readonly source_composition_id: string;
  readonly source_composition_hash: string;
  readonly assessment_scope: EligibilityAssessmentScope;
  readonly result: PositionBoundEligibilityAssessmentStatus;
  readonly reason_codes:
    readonly PositionBoundEligibilityAssessmentReasonCode[];
  readonly decision_basis: EligibilityAssessmentDecisionBasis;
  readonly predicate_rule_version: string;
  readonly assessment_rule_version: string;
  readonly as_of: IsoDateTime;
  readonly revision: number;
  readonly semantic_hash: string;
  readonly integrity_hash: string;
  readonly materialization_version:
    typeof ELIGIBILITY_ASSESSMENT_MATERIALIZATION_VERSION;
  readonly version_created: boolean;
}

export type PositionBoundEligibilityAssessmentNotAllowedReason =
  | "POSITION_BINDING_FAILURE"
  | "REQUIREMENT_SET_INTEGRITY_FAILURE"
  | "REQUIREMENT_SET_BINDING_FAILURE"
  | "REQUIREMENT_SET_NOT_COMPLETE"
  | "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY"
  | "SOURCE_COMPOSITION_GATE_UNAVAILABLE"
  | "SOURCE_COMPOSITION_NOT_FOUND"
  | "SOURCE_COMPOSITION_VERIFICATION_FAILED"
  | "SOURCE_COMPOSITION_REFERENCE_MISMATCH"
  | "CANDIDATE_EVIDENCE_INTEGRITY_FAILURE"
  | "CANDIDATE_EVIDENCE_SCOPE_MIXED"
  | "PREDICATE_RESOLUTION_INTEGRITY_FAILURE"
  | "PREDICATE_RESOLUTION_BINDING_FAILURE";

export type PositionBoundEligibilityAssessmentBlockerCode =
  | "REQUIREMENT_SET_MISSING"
  | "PREDICATE_RESOLUTION_BLOCKED"
  | "PREDICATE_RESOLUTION_MISSING";

export type PositionBoundEligibilityAssessmentResult =
  | {
      readonly status: "BLOCKED";
      readonly blocker_code: PositionBoundEligibilityAssessmentBlockerCode;
      readonly blocker_detail: string;
      readonly assessment?: never;
    }
  | {
      readonly status: "NOT_ALLOWED";
      readonly reason: PositionBoundEligibilityAssessmentNotAllowedReason;
      readonly detail: string;
      readonly assessment?: never;
    }
  | {
      readonly status: "ASSESSMENT";
      readonly assessment: PositionBoundEligibilityAssessment;
    };

export interface PositionBoundEligibilityAssessmentInput {
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly canonical_opportunity: CanonicalOpportunity;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly position_bound_opportunity_gate:
    TrustedPositionBoundOpportunityGate | null;
  readonly requirement_set_version: PositionBoundRequirementSetVersion | null;
  readonly predicate_resolution_result: PositionBoundPredicateResolutionResult;
  readonly candidate_profile_id: CandidateProfileId;
  readonly candidate_evidence: readonly PredicateCandidateEvidence[];
  readonly as_of: IsoDateTime;
  readonly predicate_rule_version: string;
  readonly assessment_rule_version: string;
  readonly source_composition_gate: TrustedSourceCompositionGate | null;
}

interface ValidatedInput {
  readonly requirementSetVersion: PositionBoundRequirementSetVersion;
  readonly requirementSet: Cr12StructuredRequirementSet;
  readonly sourceComposition: SourceCompositionResult;
}

interface AggregationResult {
  readonly result: PositionBoundEligibilityAssessmentStatus;
  readonly reason: PositionBoundEligibilityAssessmentReasonCode;
  readonly conditionResults: readonly EligibilityAssessmentConditionResult[];
  readonly mandatoryResolutionIds: ReadonlySet<string>;
}

type Truth = "TRUE" | "FALSE" | "UNKNOWN";

export class InMemoryPositionBoundEligibilityAssessmentTracker {
  readonly #versions = new Map<string, PositionBoundEligibilityAssessment[]>();

  process(
    input: PositionBoundEligibilityAssessmentInput
  ): PositionBoundEligibilityAssessmentResult {
    if (!input.requirement_set_version) {
      return blocked(
        "REQUIREMENT_SET_MISSING",
        "Phase I requires a Phase G RequirementSet version"
      );
    }
    const validated = validateTrustedInput(input);
    if ("status" in validated) return validated;
    if (input.predicate_resolution_result.status === "BLOCKED") {
      return blocked(
        "PREDICATE_RESOLUTION_BLOCKED",
        `${input.predicate_resolution_result.blocker_code}: ${input.predicate_resolution_result.blocker_detail}`
      );
    }
    if (input.predicate_resolution_result.resolutions.length === 0
        && validated.requirementSet.fact_registry.length > 0) {
      return blocked(
        "PREDICATE_RESOLUTION_MISSING",
        "Phase I requires the complete Phase H PredicateResolution set"
      );
    }

    const trustedResolutions = validatePredicateResolutions(
      input,
      validated
    );
    if ("status" in trustedResolutions) return trustedResolutions;
    const evidenceScope = candidateEvidenceScope(input.candidate_evidence);
    if (evidenceScope === "MIXED") {
      return notAllowed(
        "CANDIDATE_EVIDENCE_SCOPE_MIXED",
        "Synthetic Candidate Evidence cannot be mixed into a production assessment"
      );
    }

    let aggregation: AggregationResult;
    try {
      aggregation = aggregateMandatoryLogic(
        validated.requirementSet,
        trustedResolutions
      );
    } catch (error) {
      return notAllowed(
        "PREDICATE_RESOLUTION_INTEGRITY_FAILURE",
        errorMessage(error)
      );
    }

    const decisionBasis = decisionBasisFor(
      input,
      validated,
      trustedResolutions,
      aggregation,
      evidenceScope
    );
    const semanticHash = eligibilityAssessmentSemanticHash(
      input,
      validated,
      decisionBasis,
      aggregation
    );
    const seriesKey = assessmentSeriesKey(
      input.candidate_profile_id,
      input.canonical_opportunity.canonical_opportunity_id
    );
    const versions = this.#versions.get(seriesKey) ?? [];
    const existing = versions.find((version) => {
      return version.semantic_hash === semanticHash;
    });
    if (existing) {
      assertPositionBoundEligibilityAssessmentIntegrity(existing);
      return {
        status: "ASSESSMENT",
        assessment: { ...clone(existing), version_created: false }
      };
    }
    const revision = versions.length + 1;
    const assessmentId = eligibilityAssessmentId(
      input.candidate_profile_id,
      input.canonical_opportunity.canonical_opportunity_id,
      revision,
      semanticHash
    );
    const assessmentWithoutIntegrity: Omit<
      PositionBoundEligibilityAssessment,
      "integrity_hash"
    > = {
      eligibility_assessment_id: assessmentId,
      candidate_profile_id: input.candidate_profile_id,
      canonical_opportunity_id:
        input.canonical_opportunity.canonical_opportunity_id,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      position_id: input.position.position_id,
      position_version_id: input.position_version.position_version_id,
      position_version_semantic_hash: input.position_version.semantic_hash,
      opportunity_version_semantic_hash: input.opportunity_version.semantic_hash,
      requirement_set_version_id:
        validated.requirementSetVersion.requirement_set_version_id,
      requirement_set_id: validated.requirementSet.requirement_set_id,
      requirement_set_semantic_hash:
        validated.requirementSetVersion.semantic_hash,
      requirement_set_content_hash:
        validated.requirementSet.completeness.requirement_set_content_hash,
      source_composition_id: validated.sourceComposition.source_composition_id,
      source_composition_hash: validated.sourceComposition.composition_hash,
      assessment_scope: evidenceScope,
      result: aggregation.result,
      reason_codes: [aggregation.reason],
      decision_basis: decisionBasis,
      predicate_rule_version: input.predicate_rule_version,
      assessment_rule_version: input.assessment_rule_version,
      as_of: input.as_of,
      revision,
      semantic_hash: semanticHash,
      materialization_version:
        ELIGIBILITY_ASSESSMENT_MATERIALIZATION_VERSION,
      version_created: true
    };
    const assessment: PositionBoundEligibilityAssessment = {
      ...assessmentWithoutIntegrity,
      integrity_hash: positionBoundEligibilityAssessmentIntegrityHash(
        assessmentWithoutIntegrity
      )
    };
    assertPositionBoundEligibilityAssessmentIntegrity(assessment);
    this.#versions.set(seriesKey, [...versions, clone(assessment)]);
    return { status: "ASSESSMENT", assessment };
  }

  listVersions(
    candidateProfileId: CandidateProfileId,
    canonicalOpportunityId: CanonicalOpportunity["canonical_opportunity_id"]
  ) {
    return clone(this.#versions.get(assessmentSeriesKey(
      candidateProfileId,
      canonicalOpportunityId
    )) ?? []);
  }
}

function validateTrustedInput(
  input: PositionBoundEligibilityAssessmentInput
): ValidatedInput | Extract<PositionBoundEligibilityAssessmentResult, {
  status: "NOT_ALLOWED";
}> {
  try {
    requireIsoDateTime(input.as_of, "EligibilityAssessment as_of");
    if (!input.predicate_rule_version.trim()
        || !input.assessment_rule_version.trim()) {
      throw new Error("Assessment and predicate rule versions are required");
    }
    const position = validatePosition(input.position);
    const positionVersion = validatePositionVersion(
      input.position_version,
      position
    );
    assertPositionBoundOpportunityVersionIntegrity(
      input.opportunity_version,
      position,
      positionVersion,
      input.canonical_opportunity
    );
    if (!input.position_bound_opportunity_gate) {
      throw new Error("A trusted Position-bound Opportunity resolver is required");
    }
    const trustedArtifact = input.position_bound_opportunity_gate.resolve(
      input.opportunity_version.opportunity_version_id
    );
    if (!trustedArtifact) {
      throw new Error(
        "The Position-bound Opportunity artifact could not be resolved"
      );
    }
    assertPositionBoundOpportunityGraphMatchesTrustedArtifact({
      position: input.position,
      position_version: input.position_version,
      canonical_opportunity: input.canonical_opportunity,
      opportunity_version: input.opportunity_version
    }, trustedArtifact);
    const opportunityIdentityBasis = input.canonical_opportunity.identity_basis;
    if (opportunityIdentityBasis?.kind !== "RECRUITMENT_CONTEXT"
        || opportunityIdentityBasis.position_id !== position.position_id
        || input.canonical_opportunity.canonical_opportunity_id
          !== input.opportunity_version.canonical_opportunity_id) {
      throw new Error(
        "CanonicalOpportunity does not match Position or OpportunityVersion"
      );
    }
  } catch (error) {
    return notAllowed("POSITION_BINDING_FAILURE", errorMessage(error));
  }

  const requirementSetVersion = input.requirement_set_version!;
  const requirementSet = requirementSetVersion.requirement_set;
  if (requirementSetVersion.materialization_version
      !== POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION) {
    return notAllowed(
      "REQUIREMENT_SET_INTEGRITY_FAILURE",
      "RequirementSet version materialization contract is invalid"
    );
  }
  try {
    assertCr12StructuredRequirementSetIntegrity(requirementSet);
  } catch (error) {
    return notAllowed(
      "REQUIREMENT_SET_INTEGRITY_FAILURE",
      errorMessage(error)
    );
  }
  if (requirementSetVersion.position_version_id
      !== input.position_version.position_version_id
      || requirementSetVersion.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id
      || requirementSet.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id
      || !sameStringSet(
        requirementSetVersion.source_occurrence_version_ids,
        input.opportunity_version.source_occurrence_version_ids
      )) {
    return notAllowed(
      "REQUIREMENT_SET_BINDING_FAILURE",
      "RequirementSet version does not match PositionVersion or OpportunityVersion"
    );
  }
  try {
    assertPositionBoundRequirementSetVersionIntegrity(requirementSetVersion);
  } catch (error) {
    return notAllowed(
      "REQUIREMENT_SET_INTEGRITY_FAILURE",
      errorMessage(error)
    );
  }
  if (requirementSet.completeness.status !== "COMPLETE"
      || requirementSet.completeness.blockers.length > 0) {
    return notAllowed(
      "REQUIREMENT_SET_NOT_COMPLETE",
      "A trusted assessment requires a COMPLETE CR#12 RequirementSet"
    );
  }
  const requiredCapabilities = requirementSet.execution_manifest
    .required_engine_capabilities;
  const unsupported = requiredCapabilities.filter((capability) => {
    return !PHASE_I_SUPPORTED_ENGINE_CAPABILITIES.includes(
      capability as (typeof PHASE_I_SUPPORTED_ENGINE_CAPABILITIES)[number]
    );
  });
  if (requirementSet.execution_manifest.execution_gate.status !== "ALLOWED"
      || unsupported.length > 0) {
    return notAllowed(
      "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY",
      `Phase I does not support required capabilities: ${unsupported.join(", ")}`
    );
  }

  const reference = requirementSet.source_composition_reference;
  if (requirementSet.source_composition_state !== "COMPOSITION_BACKED"
      || !reference) {
    return notAllowed(
      "SOURCE_COMPOSITION_REFERENCE_MISMATCH",
      "Phase I accepts only composition-backed RequirementSets"
    );
  }
  if (!input.source_composition_gate) {
    return notAllowed(
      "SOURCE_COMPOSITION_GATE_UNAVAILABLE",
      "A trusted SourceComposition resolver and verifier are required"
    );
  }

  let resolved: SourceCompositionResult | null;
  try {
    resolved = input.source_composition_gate.resolve(reference);
  } catch (error) {
    return notAllowed("SOURCE_COMPOSITION_NOT_FOUND", errorMessage(error));
  }
  if (!resolved) {
    return notAllowed(
      "SOURCE_COMPOSITION_NOT_FOUND",
      "The referenced SourceCompositionResult could not be resolved"
    );
  }

  let sourceComposition: SourceCompositionResult;
  try {
    sourceComposition = input.source_composition_gate.verify(resolved);
  } catch (error) {
    return notAllowed(
      "SOURCE_COMPOSITION_VERIFICATION_FAILED",
      errorMessage(error)
    );
  }
  if (sourceComposition.status !== "COMPLETE") {
    return notAllowed(
      "SOURCE_COMPOSITION_VERIFICATION_FAILED",
      "A trusted assessment requires a verified COMPLETE SourceCompositionResult"
    );
  }
  if (sourceComposition.source_composition_id !== reference.source_composition_id
      || sourceComposition.opportunity_version_id
        !== reference.opportunity_version_id
      || sourceComposition.composition_hash !== reference.composition_hash
      || sourceComposition.composition_manifest_hash
        !== reference.composition_manifest_hash
      || sourceComposition.composition_as_of !== reference.composition_as_of
      || sourceComposition.schema_version
        !== reference.composition_schema_version
      || reference.composition_gate_version !== SOURCE_COMPOSITION_GATE_VERSION
      || requirementSetVersion.source_composition_id
        !== sourceComposition.source_composition_id
      || sourceComposition.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id) {
    return notAllowed(
      "SOURCE_COMPOSITION_REFERENCE_MISMATCH",
      "Resolved SourceCompositionResult does not exactly match its trusted reference"
    );
  }
  return { requirementSetVersion, requirementSet, sourceComposition };
}

function validatePredicateResolutions(
  input: PositionBoundEligibilityAssessmentInput,
  validated: ValidatedInput
): readonly PositionBoundPredicateResolution[] | Extract<
  PositionBoundEligibilityAssessmentResult,
  { status: "NOT_ALLOWED" }
> {
  const recomputed = new InMemoryPositionBoundPredicateResolutionTracker().process({
    position: input.position,
    position_version: input.position_version,
    opportunity_version: input.opportunity_version,
    position_bound_opportunity_gate: input.position_bound_opportunity_gate,
    source_composition_result: validated.sourceComposition,
    requirement_set_version: validated.requirementSetVersion,
    candidate_profile_id: input.candidate_profile_id,
    candidate_evidence: input.candidate_evidence,
    as_of: input.as_of,
    predicate_rule_version: input.predicate_rule_version
  });
  if (recomputed.status === "BLOCKED") {
    const reason = recomputed.blocker_code
      === "CANDIDATE_EVIDENCE_INTEGRITY_FAILURE"
      ? "CANDIDATE_EVIDENCE_INTEGRITY_FAILURE" as const
      : recomputed.blocker_code === "REQUIREMENT_SET_BINDING_FAILURE"
        ? "REQUIREMENT_SET_BINDING_FAILURE" as const
        : "PREDICATE_RESOLUTION_INTEGRITY_FAILURE" as const;
    return notAllowed(reason,
      `${recomputed.blocker_code}: ${recomputed.blocker_detail}`);
  }
  const supplied = input.predicate_resolution_result;
  if (supplied.status !== "RESOLUTION_SET") {
    return notAllowed(
      "PREDICATE_RESOLUTION_INTEGRITY_FAILURE",
      "The supplied PredicateResolution result is not a resolution set"
    );
  }
  if (supplied.resolutions.length !== recomputed.resolutions.length) {
    return notAllowed(
      "PREDICATE_RESOLUTION_INTEGRITY_FAILURE",
      "PredicateResolution set cardinality does not match the RequirementSet"
    );
  }

  const recomputedByFact = new Map(recomputed.resolutions.map((resolution) => {
    return [resolution.requirement_fact_id, resolution] as const;
  }));
  const seen = new Set<string>();
  for (const resolution of supplied.resolutions) {
    if (seen.has(resolution.requirement_fact_id)) {
      return notAllowed(
        "PREDICATE_RESOLUTION_INTEGRITY_FAILURE",
        "PredicateResolution set contains a duplicate RequirementFact"
      );
    }
    seen.add(resolution.requirement_fact_id);
    if (!isValidResolutionIdentity(resolution, input.candidate_profile_id)) {
      return notAllowed(
        "PREDICATE_RESOLUTION_INTEGRITY_FAILURE",
        "PredicateResolution identity, revision, hash, or version is invalid"
      );
    }
    const expected = recomputedByFact.get(resolution.requirement_fact_id);
    if (!expected || stableSerialize(resolutionComparable(resolution))
        !== stableSerialize(resolutionComparable(expected))) {
      return notAllowed(
        "PREDICATE_RESOLUTION_INTEGRITY_FAILURE",
        "PredicateResolution differs from independent deterministic recomputation"
      );
    }
    if (resolution.position_id !== input.position.position_id
        || resolution.position_version_id
          !== input.position_version.position_version_id
        || resolution.opportunity_version_id
          !== input.opportunity_version.opportunity_version_id
        || resolution.requirement_set_version_id
          !== validated.requirementSetVersion.requirement_set_version_id
        || resolution.requirement_set_id
          !== validated.requirementSet.requirement_set_id
        || resolution.requirement_set_content_hash
          !== validated.requirementSet.completeness.requirement_set_content_hash
        || resolution.source_composition_id
          !== validated.sourceComposition.source_composition_id
        || resolution.source_composition_hash
          !== validated.sourceComposition.composition_hash
        || !sameStringSet(
          resolution.source_occurrence_version_ids,
          input.opportunity_version.source_occurrence_version_ids
        )) {
      return notAllowed(
        "PREDICATE_RESOLUTION_BINDING_FAILURE",
        "PredicateResolution binding does not match the trusted assessment graph"
      );
    }
  }
  return [...supplied.resolutions].sort((left, right) => {
    return left.requirement_fact_id.localeCompare(right.requirement_fact_id);
  });
}

function aggregateMandatoryLogic(
  requirementSet: Cr12StructuredRequirementSet,
  resolutions: readonly PositionBoundPredicateResolution[]
): AggregationResult {
  if (resolutions.some((resolution) => {
    return resolution.resolution_status === "BLOCKED";
  })) {
    throw new Error("A BLOCKED PredicateResolution cannot enter an assessment");
  }
  const resolutionsByFact = new Map(resolutions.map((resolution) => {
    return [resolution.requirement_fact_id, resolution] as const;
  }));
  const trees = new Map(requirementSet.requirement_logic_tree_registry.map((tree) => {
    return [tree.requirement_logic_tree_id, tree] as const;
  }));
  const conditions = new Map(requirementSet.condition_registry.map((condition) => {
    return [condition.requirement_condition_id, condition] as const;
  }));
  const conditionResults = requirementSet.condition_registry.map((condition) => {
    if (condition.resolution_state !== "RESOLVED"
        || condition.representation_kind !== "LOGIC_TREE") {
      return {
        requirement_condition_id: condition.requirement_condition_id,
        modality: condition.modality,
        logical_result: "UNKNOWN" as const,
        requirement_fact_ids: []
      };
    }
    const tree = trees.get(condition.requirement_logic_tree_id);
    if (!tree) throw new Error("Requirement condition logic tree is unavailable");
    const evaluated = evaluateLogicTree(tree.nodes, tree.root_node_id,
      resolutionsByFact);
    return {
      requirement_condition_id: condition.requirement_condition_id,
      modality: condition.modality,
      logical_result: evaluated.truth,
      requirement_fact_ids: [...evaluated.factIds].sort()
    };
  }).sort((left, right) => {
    return left.requirement_condition_id.localeCompare(
      right.requirement_condition_id
    );
  });
  const conditionResultsById = new Map(conditionResults.map((result) => {
    return [result.requirement_condition_id, result] as const;
  }));
  let mandatoryTruth: Truth;
  let mandatoryConditionIds: readonly RequirementConditionId[];
  if (requirementSet.mandatory_root.kind === "EMPTY_CONFIRMED") {
    mandatoryTruth = "TRUE";
    mandatoryConditionIds = [];
  } else if (requirementSet.mandatory_root.kind === "SINGLE") {
    mandatoryConditionIds = [requirementSet.mandatory_root.requirement_condition_id];
    mandatoryTruth = requireConditionResult(
      requirementSet.mandatory_root.requirement_condition_id,
      conditions,
      conditionResultsById
    ).logical_result;
  } else {
    mandatoryConditionIds = requirementSet.mandatory_root
      .requirement_condition_ids;
    mandatoryTruth = andTruth(mandatoryConditionIds.map((conditionId) => {
      return requireConditionResult(
        conditionId,
        conditions,
        conditionResultsById
      ).logical_result;
    }));
  }
  const mandatoryFactIds = new Set(mandatoryConditionIds.flatMap((conditionId) => {
    return conditionResultsById.get(conditionId)?.requirement_fact_ids ?? [];
  }));
  const mandatoryResolutions = resolutions.filter((resolution) => {
    return mandatoryFactIds.has(resolution.requirement_fact_id);
  });
  const mandatoryResolutionIds = new Set(mandatoryResolutions.map((resolution) => {
    return resolution.predicate_resolution_id;
  }));

  if (mandatoryTruth === "TRUE") {
    return {
      result: "ELIGIBLE",
      reason: "MANDATORY_REQUIREMENTS_SATISFIED",
      conditionResults,
      mandatoryResolutionIds
    };
  }
  if (mandatoryTruth === "FALSE") {
    return {
      result: "INELIGIBLE",
      reason: "PROVEN_MANDATORY_REQUIREMENT_NOT_SATISFIED",
      conditionResults,
      mandatoryResolutionIds
    };
  }
  if (mandatoryResolutions.some((resolution) => {
    return resolution.resolution_status === "REVIEW_REQUIRED";
  })) {
    return {
      result: "NEEDS_REVIEW",
      reason: "MANDATORY_REQUIREMENT_REVIEW_REQUIRED",
      conditionResults,
      mandatoryResolutionIds
    };
  }
  if (mandatoryResolutions.some((resolution) => {
    return resolution.resolution_status === "UNKNOWN";
  })) {
    return {
      result: "NEEDS_REVIEW",
      reason: "MANDATORY_REQUIREMENT_UNKNOWN",
      conditionResults,
      mandatoryResolutionIds
    };
  }
  return {
    result: "NEEDS_REVIEW",
    reason: "MANDATORY_REQUIREMENT_INSUFFICIENT",
    conditionResults,
    mandatoryResolutionIds
  };
}

function evaluateLogicTree(
  nodes: readonly Cr12RequirementLogicNode[],
  rootNodeId: Cr12RequirementLogicNode["requirement_logic_node_id"],
  resolutions: ReadonlyMap<string, PositionBoundPredicateResolution>
) {
  const byId = new Map(nodes.map((node) => {
    return [node.requirement_logic_node_id, node] as const;
  }));
  const visiting = new Set<string>();
  const evaluate = (
    nodeId: Cr12RequirementLogicNode["requirement_logic_node_id"]
  ): { readonly truth: Truth; readonly factIds: ReadonlySet<RequirementFactId> } => {
    if (visiting.has(nodeId)) throw new Error("Requirement logic tree is cyclic");
    const node = byId.get(nodeId);
    if (!node) throw new Error("Requirement logic tree has a dangling node");
    visiting.add(nodeId);
    let result: { readonly truth: Truth; readonly factIds: ReadonlySet<RequirementFactId> };
    if (node.kind === "PREDICATE") {
      const resolution = resolutions.get(node.requirement_fact_id);
      if (!resolution) {
        throw new Error("Requirement logic leaf has no PredicateResolution");
      }
      result = {
        truth: resolution.logical_result,
        factIds: new Set([node.requirement_fact_id])
      };
    } else if (node.kind === "NOT") {
      const child = evaluate(node.child_node_id);
      result = { truth: notTruth(child.truth), factIds: child.factIds };
    } else {
      const children = node.child_node_ids.map(evaluate);
      result = {
        truth: node.operator === "AND"
          ? andTruth(children.map((child) => child.truth))
          : orTruth(children.map((child) => child.truth)),
        factIds: new Set(children.flatMap((child) => [...child.factIds]))
      };
    }
    visiting.delete(nodeId);
    return result;
  };
  return evaluate(rootNodeId);
}

function requireConditionResult(
  conditionId: RequirementConditionId,
  conditions: ReadonlyMap<RequirementConditionId, Cr12RequirementCondition>,
  results: ReadonlyMap<RequirementConditionId,
    EligibilityAssessmentConditionResult>
) {
  const condition = conditions.get(conditionId);
  const result = results.get(conditionId);
  if (!condition || !result || condition.modality !== "MANDATORY") {
    throw new Error("Mandatory root does not reference a mandatory condition");
  }
  return result;
}

function decisionBasisFor(
  input: PositionBoundEligibilityAssessmentInput,
  validated: ValidatedInput,
  resolutions: readonly PositionBoundPredicateResolution[],
  aggregation: AggregationResult,
  evidenceScope: EligibilityAssessmentScope
): EligibilityAssessmentDecisionBasis {
  const predicateResolutions = resolutions.map((resolution) => ({
    predicate_resolution_id: resolution.predicate_resolution_id,
    predicate_resolution_revision: resolution.revision,
    predicate_resolution_semantic_hash: resolution.semantic_hash,
    requirement_fact_id: resolution.requirement_fact_id,
    ...(resolution.requirement_predicate_id ? {
      requirement_predicate_id: resolution.requirement_predicate_id
    } : {}),
    applicability: resolution.applicability,
    resolution_status: resolution.resolution_status,
    logical_result: resolution.logical_result,
    reason_codes: uniqueSorted(resolution.reason_codes),
    requirement_source_reference_ids:
      uniqueSorted(resolution.requirement_source_reference_ids),
    requirement_evidence_fragment_ids:
      uniqueSorted(resolution.requirement_evidence_fragment_ids),
    requirement_evidence_ids:
      uniqueSorted(resolution.requirement_evidence_ids),
    candidate_evidence_references:
      uniqueCandidateEvidenceReferences(resolution.candidate_evidence_references)
  }));
  const candidateEvidence = uniqueCandidateEvidence(input.candidate_evidence).map(
    (evidence) => ({
      predicate_candidate_evidence_id:
        evidence.predicate_candidate_evidence_id,
      predicate_candidate_evidence_hash:
        evidence.predicate_candidate_evidence_hash,
      ...(evidence.candidate_credential_id ? {
        candidate_credential_id: evidence.candidate_credential_id
      } : {}),
      observation_status: evidence.observation_status,
      provenance: evidence.provenance,
      observed_at: evidence.observed_at,
      ...(evidence.effective_from ? {
        effective_from: evidence.effective_from
      } : {}),
      ...(evidence.effective_to ? { effective_to: evidence.effective_to } : {}),
      source_reference_ids: uniqueSorted(evidence.source_references.map((reference) => {
        return reference.candidate_state_evidence_id;
      })),
      synthetic_test: evidence.provenance === "SYNTHETIC_TEST"
    })
  );
  return {
    requirement_set_version_id:
      validated.requirementSetVersion.requirement_set_version_id,
    requirement_set_id: validated.requirementSet.requirement_set_id,
    requirement_set_content_hash:
      validated.requirementSet.completeness.requirement_set_content_hash,
    source_composition_id: validated.sourceComposition.source_composition_id,
    source_composition_hash: validated.sourceComposition.composition_hash,
    source_occurrence_version_ids: uniqueSorted(
      input.opportunity_version.source_occurrence_version_ids
    ),
    condition_results: aggregation.conditionResults,
    predicate_resolutions: predicateResolutions,
    supporting_predicate_resolution_ids: uniqueSorted(resolutions
      .filter((resolution) => resolution.logical_result === "TRUE")
      .map((resolution) => resolution.predicate_resolution_id)),
    negative_predicate_resolution_ids: uniqueSorted(resolutions
      .filter((resolution) => resolution.logical_result === "FALSE")
      .map((resolution) => resolution.predicate_resolution_id)),
    candidate_evidence: candidateEvidence,
    candidate_evidence_scope: evidenceScope,
    requirement_source_reference_ids: uniqueSorted(resolutions.flatMap((resolution) => {
      return resolution.requirement_source_reference_ids;
    })),
    requirement_evidence_fragment_ids: uniqueSorted(resolutions.flatMap((resolution) => {
      return resolution.requirement_evidence_fragment_ids;
    })),
    requirement_evidence_ids: uniqueSorted(resolutions.flatMap((resolution) => {
      return resolution.requirement_evidence_ids;
    })),
    predicate_rule_versions: uniqueSorted(resolutions.map((resolution) => {
      return resolution.predicate_rule_version;
    })),
    assessment_rule_version: input.assessment_rule_version,
    as_of: input.as_of,
    unresolved_reason_codes: uniqueSorted(resolutions
      .filter((resolution) => {
        return aggregation.mandatoryResolutionIds.has(
          resolution.predicate_resolution_id
        ) && resolution.logical_result === "UNKNOWN";
      })
      .flatMap((resolution) => resolution.reason_codes)),
    aggregation_reason: aggregation.reason
  };
}

function eligibilityAssessmentSemanticHash(
  input: PositionBoundEligibilityAssessmentInput,
  validated: ValidatedInput,
  decisionBasis: EligibilityAssessmentDecisionBasis,
  aggregation: AggregationResult
) {
  return sha256(stableSerialize(assessmentSemanticPayload({
    position_version_semantic_hash: input.position_version.semantic_hash,
    opportunity_version_semantic_hash: input.opportunity_version.semantic_hash,
    requirement_set_semantic_hash: validated.requirementSetVersion.semantic_hash,
    requirement_set_content_hash:
      validated.requirementSet.completeness.requirement_set_content_hash,
    source_composition_hash: validated.sourceComposition.composition_hash,
    assessment_scope: decisionBasis.candidate_evidence_scope,
    predicate_resolutions: decisionBasis.predicate_resolutions,
    condition_results: decisionBasis.condition_results,
    result: aggregation.result,
    aggregation_reason: aggregation.reason,
    predicate_rule_version: input.predicate_rule_version,
    assessment_rule_version: input.assessment_rule_version,
    as_of: input.as_of,
    materialization_version: ELIGIBILITY_ASSESSMENT_MATERIALIZATION_VERSION
  })));
}

export function positionBoundEligibilityAssessmentSemanticHash(
  assessment: PositionBoundEligibilityAssessment
) {
  return sha256(stableSerialize(assessmentSemanticPayload({
    position_version_semantic_hash: assessment.position_version_semantic_hash,
    opportunity_version_semantic_hash:
      assessment.opportunity_version_semantic_hash,
    requirement_set_semantic_hash: assessment.requirement_set_semantic_hash,
    requirement_set_content_hash: assessment.requirement_set_content_hash,
    source_composition_hash: assessment.source_composition_hash,
    assessment_scope: assessment.assessment_scope,
    predicate_resolutions: assessment.decision_basis.predicate_resolutions,
    condition_results: assessment.decision_basis.condition_results,
    result: assessment.result,
    aggregation_reason: assessment.decision_basis.aggregation_reason,
    predicate_rule_version: assessment.predicate_rule_version,
    assessment_rule_version: assessment.assessment_rule_version,
    as_of: assessment.as_of,
    materialization_version: assessment.materialization_version
  })));
}

export function assertPositionBoundEligibilityAssessmentIntegrity(
  assessment: PositionBoundEligibilityAssessment
) {
  const expectedHash = positionBoundEligibilityAssessmentSemanticHash(assessment);
  const expectedIntegrityHash = positionBoundEligibilityAssessmentIntegrityHash(
    assessment
  );
  const expectedId = eligibilityAssessmentId(
    assessment.candidate_profile_id,
    assessment.canonical_opportunity_id,
    assessment.revision,
    expectedHash
  );
  const expectedSupportingIds = uniqueSorted(
    assessment.decision_basis.predicate_resolutions
      .filter((resolution) => resolution.logical_result === "TRUE")
      .map((resolution) => resolution.predicate_resolution_id)
  );
  const expectedNegativeIds = uniqueSorted(
    assessment.decision_basis.predicate_resolutions
      .filter((resolution) => resolution.logical_result === "FALSE")
      .map((resolution) => resolution.predicate_resolution_id)
  );
  const candidateEvidenceScope = assessmentCandidateEvidenceScope(
    assessment.decision_basis.candidate_evidence
  );
  if (assessment.materialization_version
      !== ELIGIBILITY_ASSESSMENT_MATERIALIZATION_VERSION
      || !POSITION_BOUND_ELIGIBILITY_ASSESSMENT_RESULTS.includes(
        assessment.result
      )
      || !Number.isSafeInteger(assessment.revision)
      || assessment.revision < 1
      || assessment.reason_codes.length !== 1
      || assessment.reason_codes[0]
        !== assessment.decision_basis.aggregation_reason
      || !assessmentResultMatchesReason(
        assessment.result,
        assessment.decision_basis.aggregation_reason
      )
      || assessment.assessment_scope
        !== assessment.decision_basis.candidate_evidence_scope
      || candidateEvidenceScope === "MIXED"
      || candidateEvidenceScope !== assessment.assessment_scope
      || !sameStringSet(
        assessment.decision_basis.supporting_predicate_resolution_ids,
        expectedSupportingIds
      )
      || !sameStringSet(
        assessment.decision_basis.negative_predicate_resolution_ids,
        expectedNegativeIds
      )
      || assessment.decision_basis.candidate_evidence.some((evidence) => {
        return evidence.synthetic_test
          !== (evidence.provenance === "SYNTHETIC_TEST");
      })
      || assessment.decision_basis.predicate_resolutions.some((resolution) => {
        return resolution.candidate_evidence_references.some((reference) => {
          return reference.synthetic_test
            !== (reference.provenance === "SYNTHETIC_TEST");
        });
      })
      || assessment.requirement_set_version_id
        !== assessment.decision_basis.requirement_set_version_id
      || assessment.requirement_set_id
        !== assessment.decision_basis.requirement_set_id
      || assessment.requirement_set_content_hash
        !== assessment.decision_basis.requirement_set_content_hash
      || assessment.source_composition_id
        !== assessment.decision_basis.source_composition_id
      || assessment.source_composition_hash
        !== assessment.decision_basis.source_composition_hash
      || assessment.assessment_rule_version
        !== assessment.decision_basis.assessment_rule_version
      || assessment.as_of !== assessment.decision_basis.as_of
      || !/^[a-f0-9]{64}$/u.test(assessment.semantic_hash)
      || !/^[a-f0-9]{64}$/u.test(assessment.integrity_hash)
      || assessment.semantic_hash !== expectedHash
      || assessment.integrity_hash !== expectedIntegrityHash
      || assessment.eligibility_assessment_id !== expectedId) {
    throw new Error(
      "EligibilityAssessment integrity, semantic hash, or identity is missing, malformed, or mismatched"
    );
  }
  return assessment;
}

type PositionBoundEligibilityAssessmentIntegrityInput = Omit<
  PositionBoundEligibilityAssessment,
  "integrity_hash"
>;

export function positionBoundEligibilityAssessmentIntegrityHash(
  assessment: PositionBoundEligibilityAssessment
    | PositionBoundEligibilityAssessmentIntegrityInput
) {
  return sha256(stableSerialize({
    eligibility_assessment_id: assessment.eligibility_assessment_id,
    candidate_profile_id: assessment.candidate_profile_id,
    canonical_opportunity_id: assessment.canonical_opportunity_id,
    opportunity_version_id: assessment.opportunity_version_id,
    position_id: assessment.position_id,
    position_version_id: assessment.position_version_id,
    position_version_semantic_hash: assessment.position_version_semantic_hash,
    opportunity_version_semantic_hash:
      assessment.opportunity_version_semantic_hash,
    requirement_set_version_id: assessment.requirement_set_version_id,
    requirement_set_id: assessment.requirement_set_id,
    requirement_set_semantic_hash: assessment.requirement_set_semantic_hash,
    requirement_set_content_hash: assessment.requirement_set_content_hash,
    source_composition_id: assessment.source_composition_id,
    source_composition_hash: assessment.source_composition_hash,
    assessment_scope: assessment.assessment_scope,
    result: assessment.result,
    reason_codes: sortedStrings(assessment.reason_codes),
    decision_basis: assessmentDecisionBasisIntegrityPayload(
      assessment.decision_basis
    ),
    predicate_rule_version: assessment.predicate_rule_version,
    assessment_rule_version: assessment.assessment_rule_version,
    as_of: assessment.as_of,
    revision: assessment.revision,
    semantic_hash: assessment.semantic_hash,
    materialization_version: assessment.materialization_version
  }));
}

function assessmentDecisionBasisIntegrityPayload(
  basis: EligibilityAssessmentDecisionBasis
) {
  return {
    requirement_set_version_id: basis.requirement_set_version_id,
    requirement_set_id: basis.requirement_set_id,
    requirement_set_content_hash: basis.requirement_set_content_hash,
    source_composition_id: basis.source_composition_id,
    source_composition_hash: basis.source_composition_hash,
    source_occurrence_version_ids:
      sortedStrings(basis.source_occurrence_version_ids),
    condition_results: basis.condition_results.map((condition) => ({
      requirement_condition_id: condition.requirement_condition_id,
      modality: condition.modality,
      logical_result: condition.logical_result,
      requirement_fact_ids: sortedStrings(condition.requirement_fact_ids)
    })).sort(compareCanonical),
    predicate_resolutions: basis.predicate_resolutions.map((resolution) => ({
      predicate_resolution_id: resolution.predicate_resolution_id,
      predicate_resolution_revision: resolution.predicate_resolution_revision,
      predicate_resolution_semantic_hash:
        resolution.predicate_resolution_semantic_hash,
      requirement_fact_id: resolution.requirement_fact_id,
      requirement_predicate_id: resolution.requirement_predicate_id ?? null,
      applicability: resolution.applicability,
      resolution_status: resolution.resolution_status,
      logical_result: resolution.logical_result,
      reason_codes: sortedStrings(resolution.reason_codes),
      requirement_source_reference_ids:
        sortedStrings(resolution.requirement_source_reference_ids),
      requirement_evidence_fragment_ids:
        sortedStrings(resolution.requirement_evidence_fragment_ids),
      requirement_evidence_ids:
        sortedStrings(resolution.requirement_evidence_ids),
      candidate_evidence_references:
        resolution.candidate_evidence_references.map((reference) => ({
          predicate_candidate_evidence_id:
            reference.predicate_candidate_evidence_id,
          predicate_candidate_evidence_hash:
            reference.predicate_candidate_evidence_hash,
          candidate_credential_id: reference.candidate_credential_id ?? null,
          observation_status: reference.observation_status,
          provenance: reference.provenance,
          observed_at: reference.observed_at,
          effective_from: reference.effective_from ?? null,
          effective_to: reference.effective_to ?? null,
          source_references: reference.source_references.map((source) => ({
            candidate_state_evidence_id: source.candidate_state_evidence_id,
            evidence_class: source.evidence_class,
            captured_at: source.captured_at,
            issuer: source.issuer
          })).sort(compareCanonical),
          synthetic_test: reference.synthetic_test,
          candidate_state_assertion_id:
            reference.candidate_state_assertion_id ?? null,
          candidate_state_assertion_hash:
            reference.candidate_state_assertion_hash ?? null
        })).sort(compareCanonical)
    })).sort(compareCanonical),
    supporting_predicate_resolution_ids:
      sortedStrings(basis.supporting_predicate_resolution_ids),
    negative_predicate_resolution_ids:
      sortedStrings(basis.negative_predicate_resolution_ids),
    candidate_evidence: basis.candidate_evidence.map((evidence) => ({
      predicate_candidate_evidence_id:
        evidence.predicate_candidate_evidence_id,
      predicate_candidate_evidence_hash:
        evidence.predicate_candidate_evidence_hash,
      candidate_credential_id: evidence.candidate_credential_id ?? null,
      observation_status: evidence.observation_status,
      provenance: evidence.provenance,
      observed_at: evidence.observed_at,
      effective_from: evidence.effective_from ?? null,
      effective_to: evidence.effective_to ?? null,
      source_reference_ids: sortedStrings(evidence.source_reference_ids),
      synthetic_test: evidence.synthetic_test
    })).sort(compareCanonical),
    candidate_evidence_scope: basis.candidate_evidence_scope,
    requirement_source_reference_ids:
      sortedStrings(basis.requirement_source_reference_ids),
    requirement_evidence_fragment_ids:
      sortedStrings(basis.requirement_evidence_fragment_ids),
    requirement_evidence_ids: sortedStrings(basis.requirement_evidence_ids),
    predicate_rule_versions: sortedStrings(basis.predicate_rule_versions),
    assessment_rule_version: basis.assessment_rule_version,
    as_of: basis.as_of,
    unresolved_reason_codes: sortedStrings(basis.unresolved_reason_codes),
    aggregation_reason: basis.aggregation_reason
  };
}

function assessmentSemanticPayload(input: {
  readonly position_version_semantic_hash: string;
  readonly opportunity_version_semantic_hash: string;
  readonly requirement_set_semantic_hash: string;
  readonly requirement_set_content_hash: string;
  readonly source_composition_hash: string;
  readonly assessment_scope: EligibilityAssessmentScope;
  readonly predicate_resolutions:
    readonly EligibilityAssessmentPredicateResolutionReference[];
  readonly condition_results: readonly EligibilityAssessmentConditionResult[];
  readonly result: PositionBoundEligibilityAssessmentStatus;
  readonly aggregation_reason: PositionBoundEligibilityAssessmentReasonCode;
  readonly predicate_rule_version: string;
  readonly assessment_rule_version: string;
  readonly as_of: IsoDateTime;
  readonly materialization_version:
    typeof ELIGIBILITY_ASSESSMENT_MATERIALIZATION_VERSION;
}) {
  const predicateResolutions = input.predicate_resolutions.map((resolution) => ({
    semantic_hash: resolution.predicate_resolution_semantic_hash,
    applicability: resolution.applicability,
    resolution_status: resolution.resolution_status,
    logical_result: resolution.logical_result,
    reason_codes: uniqueSorted(resolution.reason_codes)
  })).sort(compareCanonical);
  const conditionResults = input.condition_results.map((condition) => ({
    modality: condition.modality,
    logical_result: condition.logical_result
  })).sort(compareCanonical);
  return {
    position_version_semantic_hash: input.position_version_semantic_hash,
    opportunity_version_semantic_hash: input.opportunity_version_semantic_hash,
    requirement_set_semantic_hash: input.requirement_set_semantic_hash,
    requirement_set_content_hash: input.requirement_set_content_hash,
    source_composition_hash: input.source_composition_hash,
    assessment_scope: input.assessment_scope,
    predicate_resolutions: predicateResolutions,
    condition_results: conditionResults,
    result: input.result,
    aggregation_reason: input.aggregation_reason,
    predicate_rule_version: input.predicate_rule_version,
    assessment_rule_version: input.assessment_rule_version,
    as_of: input.as_of,
    materialization_version: input.materialization_version
  };
}

function isValidResolutionIdentity(
  resolution: PositionBoundPredicateResolution,
  candidateProfileId: CandidateProfileId
) {
  try {
    assertPositionBoundPredicateResolutionIntegrity(resolution);
  } catch {
    return false;
  }
  if (resolution.candidate_profile_id !== candidateProfileId
      || resolution.materialization_version
        !== PREDICATE_RESOLUTION_MATERIALIZATION_VERSION) return false;
  const expectedId = `predicate-resolution:${sha256(stableSerialize({
    requirement_set_version_id: resolution.requirement_set_version_id,
    candidate_profile_id: candidateProfileId,
    requirement_fact_id: resolution.requirement_fact_id,
    predicate_rule_version: resolution.predicate_rule_version,
    as_of: resolution.as_of,
    revision: resolution.revision,
    semantic_hash: resolution.semantic_hash
  }))}`;
  return resolution.predicate_resolution_id === expectedId;
}

function resolutionComparable(resolution: PositionBoundPredicateResolution) {
  const {
    predicate_resolution_id: _id,
    revision: _revision,
    integrity_hash: _integrityHash,
    version_created: _versionCreated,
    ...comparable
  } = resolution;
  return semanticObject(comparable);
}

function assessmentSeriesKey(
  candidateProfileId: CandidateProfileId,
  canonicalOpportunityId: CanonicalOpportunity["canonical_opportunity_id"]
) {
  return stableSerialize({
    candidate_profile_id: candidateProfileId,
    canonical_opportunity_id: canonicalOpportunityId
  });
}

function eligibilityAssessmentId(
  candidateProfileId: CandidateProfileId,
  canonicalOpportunityId: CanonicalOpportunity["canonical_opportunity_id"],
  revision: number,
  semanticHash: string
) {
  return `eligibility-assessment:${sha256(stableSerialize({
    candidate_profile_id: candidateProfileId,
    canonical_opportunity_id: canonicalOpportunityId,
    revision,
    semantic_hash: semanticHash
  }))}`;
}

function andTruth(values: readonly Truth[]): Truth {
  if (values.some((value) => value === "FALSE")) return "FALSE";
  if (values.some((value) => value === "UNKNOWN")) return "UNKNOWN";
  return "TRUE";
}

function orTruth(values: readonly Truth[]): Truth {
  if (values.some((value) => value === "TRUE")) return "TRUE";
  if (values.some((value) => value === "UNKNOWN")) return "UNKNOWN";
  return "FALSE";
}

function notTruth(value: Truth): Truth {
  return value === "TRUE" ? "FALSE"
    : value === "FALSE" ? "TRUE"
      : "UNKNOWN";
}

function uniqueCandidateEvidence(
  evidence: readonly PredicateCandidateEvidence[]
) {
  const byHash = new Map<string, PredicateCandidateEvidence>();
  for (const item of evidence) {
    const key = stableSerialize(semanticObject({
      value: item.value,
      original_value: item.original_value,
      normalized_value: item.normalized_value,
      observation_status: item.observation_status,
      effective_from: item.effective_from ?? null,
      effective_to: item.effective_to ?? null,
      provenance: item.provenance,
      schema_version: item.schema_version
    }));
    if (!byHash.has(key)) byHash.set(key, item);
  }
  return [...byHash.entries()].sort(([left], [right]) => {
    return left.localeCompare(right);
  }).map(([, item]) => item);
}

function candidateEvidenceScope(
  evidence: readonly PredicateCandidateEvidence[]
): EligibilityAssessmentScope | "MIXED" {
  const hasSynthetic = evidence.some((item) => {
    return item.provenance === "SYNTHETIC_TEST";
  });
  const hasProduction = evidence.some((item) => {
    return item.provenance !== "SYNTHETIC_TEST";
  });
  return hasSynthetic && hasProduction ? "MIXED"
    : hasSynthetic ? "SYNTHETIC_TEST"
      : "PRODUCTION";
}

function assessmentCandidateEvidenceScope(
  evidence: readonly EligibilityAssessmentCandidateEvidenceReference[]
): EligibilityAssessmentScope | "MIXED" {
  const hasSynthetic = evidence.some((item) => item.synthetic_test);
  const hasProduction = evidence.some((item) => !item.synthetic_test);
  return hasSynthetic && hasProduction ? "MIXED"
    : hasSynthetic ? "SYNTHETIC_TEST"
      : "PRODUCTION";
}

function assessmentResultMatchesReason(
  result: PositionBoundEligibilityAssessmentStatus,
  reason: PositionBoundEligibilityAssessmentReasonCode
) {
  if (result === "ELIGIBLE") {
    return reason === "MANDATORY_REQUIREMENTS_SATISFIED";
  }
  if (result === "INELIGIBLE") {
    return reason === "PROVEN_MANDATORY_REQUIREMENT_NOT_SATISFIED";
  }
  if (result === "NEEDS_REVIEW") {
    return reason === "MANDATORY_REQUIREMENT_UNKNOWN"
      || reason === "MANDATORY_REQUIREMENT_INSUFFICIENT"
      || reason === "MANDATORY_REQUIREMENT_REVIEW_REQUIRED";
  }
  return false;
}

function uniqueCandidateEvidenceReferences(
  references: readonly PredicateCandidateEvidenceReference[]
) {
  const byId = new Map(references.map((reference) => {
    return [reference.predicate_candidate_evidence_id, reference] as const;
  }));
  return [...byId.values()].sort((left, right) => {
    return left.predicate_candidate_evidence_id.localeCompare(
      right.predicate_candidate_evidence_id
    );
  });
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return stableSerialize(uniqueSorted(left)) === stableSerialize(uniqueSorted(right));
}

function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort();
}

function sortedStrings<Value extends string>(values: readonly Value[]): Value[] {
  return [...values].sort();
}

function compareCanonical(left: unknown, right: unknown) {
  return stableSerialize(left).localeCompare(stableSerialize(right));
}

function semanticObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(semanticObject);
    return items.every((item) => typeof item === "string")
      ? [...new Set(items as string[])].sort()
      : items;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => {
      return [key, semanticObject(object[key])];
    }));
  }
  return value;
}

function notAllowed(
  reason: PositionBoundEligibilityAssessmentNotAllowedReason,
  detail: string
): Extract<PositionBoundEligibilityAssessmentResult, {
  status: "NOT_ALLOWED";
}> {
  return { status: "NOT_ALLOWED", reason, detail };
}

function blocked(
  blockerCode: PositionBoundEligibilityAssessmentBlockerCode,
  blockerDetail: string
): Extract<PositionBoundEligibilityAssessmentResult, { status: "BLOCKED" }> {
  return { status: "BLOCKED", blocker_code: blockerCode, blocker_detail: blockerDetail };
}

function requireIsoDateTime(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
      || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a valid ISO date-time`);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
