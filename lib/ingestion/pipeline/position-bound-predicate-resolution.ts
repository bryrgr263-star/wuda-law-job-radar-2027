import { createHash } from "node:crypto";

import type {
  CandidateProfileId,
  CandidateStateAssertion,
  CandidateStateEvidenceReference,
  CandidateStateObservationStatus,
  CandidateCredentialId,
  CandidateCredentialProvenance,
  CandidateWorkExperience,
  Cr12RequirementCondition,
  Cr12StructuredRequirementSet,
  IsoDate,
  IsoDateTime,
  NormalizedText,
  Position,
  PositionBoundOpportunityVersion,
  PositionVersion,
  ProfessionalQualification,
  RequirementFact,
  RequirementFactId,
  RequirementPredicate,
  StructuredEducationCredential,
  SourceCompositionResult
} from "../domain";
import {
  assertCandidateStateAssertionIntegrity,
  validatePosition,
  validatePositionVersion
} from "../domain";
import {
  assertPositionBoundOpportunityGraphMatchesTrustedArtifact,
  assertPositionBoundOpportunityVersionIntegrity,
  type TrustedPositionBoundOpportunityGate
} from "../normalization";
import {
  assertCr12StructuredRequirementSetIntegrity,
  assertSourceCompositionResultIntegrity
} from "../requirements";
import {
  POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION,
  assertPositionBoundRequirementSetVersionIntegrity,
  type PositionBoundRequirementSetVersion
} from "./position-bound-requirement-set";

export const PREDICATE_RESOLUTION_MATERIALIZATION_VERSION =
  "position-bound-predicate-resolution/1.0.0" as const;
export const PREDICATE_RESOLUTION_RULE_VERSION =
  "predicate-resolution-rules/1.0.0" as const;
export const PREDICATE_CANDIDATE_EVIDENCE_SCHEMA_VERSION =
  "predicate-candidate-evidence/1.0.0" as const;

export type PredicateCandidateEvidenceValue =
  | {
      readonly kind: "CANDIDATE_STATE_ASSERTION";
      readonly assertion: CandidateStateAssertion;
    }
  | {
      readonly kind: "EDUCATION_CREDENTIAL";
      readonly credential: StructuredEducationCredential;
    }
  | {
      readonly kind: "DATE_OF_BIRTH";
      readonly date_of_birth: IsoDate;
    }
  | {
      readonly kind: "GENDER";
      readonly gender: "MALE" | "FEMALE" | "UNKNOWN";
    }
  | {
      readonly kind: "PROFESSIONAL_QUALIFICATION";
      readonly qualification: ProfessionalQualification;
    }
  | {
      readonly kind: "WORK_EXPERIENCE";
      readonly work_experience: CandidateWorkExperience;
    }
  | {
      readonly kind: "CANDIDATE_COHORT";
      readonly candidate_cohort: string;
    }
  | {
      readonly kind: "TARGET_GRADUATION_YEAR";
      readonly graduation_year: number;
    };

export type PredicateCandidateEvidenceProvenance = CandidateCredentialProvenance;

export interface PredicateCandidateEvidenceSourceReference {
  readonly candidate_state_evidence_id:
    CandidateStateEvidenceReference["candidate_state_evidence_id"];
  readonly evidence_class: PredicateCandidateEvidenceProvenance;
  readonly captured_at: IsoDateTime;
  readonly issuer: string;
}

export interface PredicateCandidateEvidence {
  readonly predicate_candidate_evidence_id: string;
  readonly candidate_profile_id: CandidateProfileId;
  readonly candidate_credential_id?: CandidateCredentialId;
  readonly value: PredicateCandidateEvidenceValue | null;
  readonly original_value: import("../domain").OriginalText;
  readonly normalized_value: NormalizedText;
  readonly observation_status: CandidateStateObservationStatus;
  readonly observed_at: IsoDateTime;
  readonly effective_from?: IsoDateTime;
  readonly effective_to?: IsoDateTime;
  readonly provenance: PredicateCandidateEvidenceProvenance;
  readonly source_references: readonly PredicateCandidateEvidenceSourceReference[];
  readonly schema_version: typeof PREDICATE_CANDIDATE_EVIDENCE_SCHEMA_VERSION;
  readonly predicate_candidate_evidence_hash: string;
}

export type PredicateCandidateEvidenceInput = Omit<
  PredicateCandidateEvidence,
  | "predicate_candidate_evidence_id"
  | "predicate_candidate_evidence_hash"
  | "schema_version"
>;

export const PREDICATE_RESOLUTION_STATUSES = [
  "RESOLVED_MATCH",
  "RESOLVED_NOT_MATCH",
  "UNKNOWN",
  "INSUFFICIENT",
  "REVIEW_REQUIRED",
  "BLOCKED"
] as const;

export type PredicateResolutionStatus =
  (typeof PREDICATE_RESOLUTION_STATUSES)[number];

export type PredicateResolutionReasonCode =
  | "EXPLICIT_CANDIDATE_EVIDENCE_MATCH"
  | "EXPLICIT_CANDIDATE_EVIDENCE_CONTRADICTION"
  | "CANDIDATE_EVIDENCE_MISSING"
  | "CANDIDATE_EVIDENCE_INSUFFICIENT"
  | "CANDIDATE_EVIDENCE_CONFLICT"
  | "CANDIDATE_EVIDENCE_OUTSIDE_AS_OF"
  | "APPLICABILITY_UNKNOWN"
  | "CONDITION_NOT_APPLICABLE"
  | "SOURCE_REQUIREMENT_UNRESOLVED"
  | "TEMPORAL_CONTEXT_UNRESOLVED"
  | "LAW_0351_APPLICABILITY_UNRESOLVED"
  | "SAFE_RULE_NOT_IMPLEMENTED";

export interface PredicateCandidateEvidenceReference {
  readonly predicate_candidate_evidence_id: string;
  readonly predicate_candidate_evidence_hash: string;
  readonly candidate_credential_id?: CandidateCredentialId;
  readonly observation_status: CandidateStateObservationStatus;
  readonly provenance: PredicateCandidateEvidenceProvenance;
  readonly observed_at: IsoDateTime;
  readonly effective_from?: IsoDateTime;
  readonly effective_to?: IsoDateTime;
  readonly source_references:
    readonly PredicateCandidateEvidenceSourceReference[];
  readonly synthetic_test: boolean;
  readonly candidate_state_assertion_id?: string;
  readonly candidate_state_assertion_hash?: string;
}

export interface PositionBoundPredicateResolution {
  readonly predicate_resolution_id: string;
  readonly candidate_profile_id: CandidateProfileId;
  readonly requirement_set_version_id: string;
  readonly requirement_set_id: string;
  readonly requirement_set_content_hash: string;
  readonly requirement_fact_id: RequirementFactId;
  readonly requirement_predicate_id?: string;
  readonly position_id: Position["position_id"];
  readonly position_version_id: PositionVersion["position_version_id"];
  readonly opportunity_version_id:
    PositionBoundOpportunityVersion["opportunity_version_id"];
  readonly source_composition_id: SourceCompositionResult["source_composition_id"];
  readonly source_composition_hash: SourceCompositionResult["composition_hash"];
  readonly source_occurrence_version_ids:
    PositionBoundOpportunityVersion["source_occurrence_version_ids"];
  readonly requirement_source_reference_ids: readonly string[];
  readonly requirement_evidence_fragment_ids: readonly string[];
  readonly requirement_evidence_ids: readonly string[];
  readonly candidate_evidence_references:
    readonly PredicateCandidateEvidenceReference[];
  readonly applicability: "APPLIES" | "DOES_NOT_APPLY" | "UNKNOWN";
  readonly resolution_status: PredicateResolutionStatus;
  readonly logical_result: "TRUE" | "FALSE" | "UNKNOWN";
  readonly reason_codes: readonly PredicateResolutionReasonCode[];
  readonly predicate_rule_version: string;
  readonly as_of: IsoDateTime;
  readonly revision: number;
  readonly semantic_hash: string;
  readonly integrity_hash: string;
  readonly materialization_version:
    typeof PREDICATE_RESOLUTION_MATERIALIZATION_VERSION;
  readonly version_created: boolean;
  readonly eligibility_assessment?: never;
}

export type PredicateResolutionBlockerCode =
  | "POSITION_BINDING_FAILURE"
  | "SOURCE_COMPOSITION_INTEGRITY_FAILURE"
  | "SOURCE_COMPOSITION_INCOMPLETE"
  | "SOURCE_COMPOSITION_BINDING_FAILURE"
  | "REQUIREMENT_SET_MISSING"
  | "REQUIREMENT_SET_INTEGRITY_FAILURE"
  | "REQUIREMENT_SET_BINDING_FAILURE"
  | "REQUIREMENT_SET_NOT_COMPLETE"
  | "CANDIDATE_EVIDENCE_INTEGRITY_FAILURE";

export type PositionBoundPredicateResolutionResult =
  | {
      readonly status: "BLOCKED";
      readonly blocker_code: PredicateResolutionBlockerCode;
      readonly blocker_detail: string;
      readonly resolutions: readonly [];
      readonly eligibility_assessment?: never;
    }
  | {
      readonly status: "RESOLUTION_SET";
      readonly resolutions: readonly PositionBoundPredicateResolution[];
      readonly eligibility_assessment?: never;
    };

export interface PositionBoundPredicateResolutionInput {
  readonly position: Position;
  readonly position_version: PositionVersion;
  readonly opportunity_version: PositionBoundOpportunityVersion;
  readonly position_bound_opportunity_gate:
    TrustedPositionBoundOpportunityGate | null;
  readonly source_composition_result: SourceCompositionResult;
  readonly requirement_set_version: PositionBoundRequirementSetVersion | null;
  readonly candidate_profile_id: CandidateProfileId;
  readonly candidate_evidence: readonly PredicateCandidateEvidence[];
  readonly as_of: IsoDateTime;
  readonly predicate_rule_version: string;
}

export class PredicateCandidateEvidenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredicateCandidateEvidenceIntegrityError";
  }
}

export function createPredicateCandidateEvidence(
  input: PredicateCandidateEvidenceInput
): PredicateCandidateEvidence {
  const base = {
    ...input,
    source_references: clone(input.source_references),
    schema_version: PREDICATE_CANDIDATE_EVIDENCE_SCHEMA_VERSION
  };
  const hash = predicateCandidateEvidenceHash(base);
  return {
    ...base,
    predicate_candidate_evidence_id: `predicate-candidate-evidence:${hash.slice(7)}`,
    predicate_candidate_evidence_hash: hash
  };
}

export function predicateCandidateEvidenceHash(
  evidence: Omit<
    PredicateCandidateEvidence,
    "predicate_candidate_evidence_id" | "predicate_candidate_evidence_hash"
  > | PredicateCandidateEvidence
) {
  return `sha256:${sha256(stableSerialize(
    predicateCandidateEvidenceCanonicalForm(evidence)
  ))}`;
}

export function predicateCandidateEvidenceCanonicalForm(
  evidence: Omit<
    PredicateCandidateEvidence,
    "predicate_candidate_evidence_id" | "predicate_candidate_evidence_hash"
  > | PredicateCandidateEvidence
) {
  const {
    predicate_candidate_evidence_id: _id,
    predicate_candidate_evidence_hash: _hash,
    ...canonical
  } = evidence as PredicateCandidateEvidence;
  return {
    ...canonical,
    source_references: [...canonical.source_references].sort((left, right) => {
      return left.candidate_state_evidence_id.localeCompare(
        right.candidate_state_evidence_id
      );
    })
  };
}

export function assertPredicateCandidateEvidenceIntegrity(
  evidence: PredicateCandidateEvidence
) {
  if (evidence.schema_version !== PREDICATE_CANDIDATE_EVIDENCE_SCHEMA_VERSION
      || !["CANDIDATE_ASSERTED", "DOCUMENT_VERIFIED", "SYNTHETIC_TEST"]
        .includes(evidence.provenance)
      || evidence.source_references.length === 0
      || evidence.source_references.some((reference) => {
        return reference.evidence_class !== evidence.provenance
          || !reference.issuer.trim();
      })) {
    throw new PredicateCandidateEvidenceIntegrityError(
      "Predicate Candidate Evidence provenance does not match its evidence source"
    );
  }
  requireIsoDateTime(evidence.observed_at, "Candidate Evidence observed_at");
  if (evidence.effective_from) {
    requireIsoDateTime(evidence.effective_from, "Candidate Evidence effective_from");
  }
  if (evidence.effective_to) {
    requireIsoDateTime(evidence.effective_to, "Candidate Evidence effective_to");
  }
  if (evidence.effective_from && evidence.effective_to
      && instant(evidence.effective_from) > instant(evidence.effective_to)) {
    throw new PredicateCandidateEvidenceIntegrityError(
      "Candidate Evidence effective period is invalid"
    );
  }
  if (!evidence.original_value.text.trim()
      || !evidence.normalized_value.text.trim()
      || (evidence.observation_status === "CONFIRMED" && evidence.value === null)
      || (evidence.provenance === "CANDIDATE_ASSERTED"
        && evidence.observation_status === "CONFIRMED")
      || new Set(evidence.source_references.map((reference) => {
        return reference.candidate_state_evidence_id;
      })).size !== evidence.source_references.length) {
    throw new PredicateCandidateEvidenceIntegrityError(
      "Predicate Candidate Evidence is incomplete or contains duplicate provenance"
    );
  }
  if (evidence.value?.kind === "CANDIDATE_STATE_ASSERTION") {
    const assertion = assertCandidateStateAssertionIntegrity(evidence.value.assertion);
    if (assertion.candidate_profile_id !== evidence.candidate_profile_id
        || assertion.state_observation_status !== evidence.observation_status
        || assertion.observed_at !== evidence.observed_at
        || (assertion.effective_from ?? null) !== (evidence.effective_from ?? null)
        || (assertion.effective_to ?? null) !== (evidence.effective_to ?? null)
        || !sameCandidateStateEvidence(
          assertion.evidence_references,
          evidence.source_references
        )) {
      throw new PredicateCandidateEvidenceIntegrityError(
        "CandidateStateAssertion wrapper does not preserve the immutable assertion provenance"
      );
    }
  }
  if (evidence.value?.kind === "EDUCATION_CREDENTIAL") {
    if (!evidence.candidate_credential_id
        || evidence.candidate_credential_id
          !== evidence.value.credential.candidate_credential_id
        || evidence.value.credential.provenance !== evidence.provenance) {
      throw new PredicateCandidateEvidenceIntegrityError(
        "Education Candidate Evidence does not preserve credential identity and provenance"
      );
    }
  } else if (evidence.candidate_credential_id !== undefined) {
    throw new PredicateCandidateEvidenceIntegrityError(
      "Non-credential Candidate Evidence cannot claim a credential identity"
    );
  }
  const expectedHash = predicateCandidateEvidenceHash(evidence);
  if (!/^sha256:[a-f0-9]{64}$/u.test(evidence.predicate_candidate_evidence_hash)
      || expectedHash !== evidence.predicate_candidate_evidence_hash
      || evidence.predicate_candidate_evidence_id
        !== `predicate-candidate-evidence:${expectedHash.slice(7)}`) {
    throw new PredicateCandidateEvidenceIntegrityError(
      "Predicate Candidate Evidence hash or identity is missing, malformed, or mismatched"
    );
  }
  return evidence;
}

export class InMemoryPositionBoundPredicateResolutionTracker {
  readonly #versions = new Map<string, PositionBoundPredicateResolution[]>();

  process(
    input: PositionBoundPredicateResolutionInput
  ): PositionBoundPredicateResolutionResult {
    const prerequisite = validatePrerequisites(input);
    if (prerequisite) return prerequisite;
    const requirementSetVersion = input.requirement_set_version!;
    const requirementSet = requirementSetVersion.requirement_set;
    const factContexts = collectFactContexts(requirementSet);
    const resolutions = requirementSet.fact_registry.map((fact) => {
      const context = factContexts.get(fact.requirement_fact_id);
      return this.#materializeResolution(
        input,
        requirementSetVersion,
        requirementSet,
        fact,
        context
      );
    });
    return { status: "RESOLUTION_SET", resolutions: clone(resolutions) };
  }

  listVersions(
    requirementSetVersionId: string,
    candidateProfileId: CandidateProfileId,
    requirementFactId: RequirementFactId,
    predicateRuleVersion: string,
    asOf: IsoDateTime
  ) {
    return clone(this.#versions.get(resolutionSeriesKey(
      requirementSetVersionId,
      candidateProfileId,
      requirementFactId,
      predicateRuleVersion,
      asOf
    )) ?? []);
  }

  #materializeResolution(
    input: PositionBoundPredicateResolutionInput,
    requirementSetVersion: PositionBoundRequirementSetVersion,
    requirementSet: Cr12StructuredRequirementSet,
    fact: RequirementFact,
    context: FactContext | undefined
  ): PositionBoundPredicateResolution {
    const evaluation = evaluatePredicate(
      fact,
      context,
      requirementSet,
      input.candidate_evidence,
      input.as_of
    );
    const evidenceReferences = candidateEvidenceReferences(evaluation.evidence);
    const requirementTrace = requirementTraceFor(fact, context, requirementSet);
    const semanticHash = resolutionSemanticHash(
      fact,
      context,
      evaluation,
      input.predicate_rule_version,
      input.as_of
    );
    const seriesKey = resolutionSeriesKey(
      requirementSetVersion.requirement_set_version_id,
      input.candidate_profile_id,
      fact.requirement_fact_id,
      input.predicate_rule_version,
      input.as_of
    );
    const versions = this.#versions.get(seriesKey) ?? [];
    const existing = versions.find((version) => version.semantic_hash === semanticHash);
    const revision = existing?.revision ?? versions.length + 1;
    const resolutionId = existing?.predicate_resolution_id
      ?? predicateResolutionId(
        requirementSetVersion.requirement_set_version_id,
        input.candidate_profile_id,
        fact.requirement_fact_id,
        input.predicate_rule_version,
        input.as_of,
        revision,
        semanticHash
      );
    const base: Omit<PositionBoundPredicateResolution, "integrity_hash"> = {
      predicate_resolution_id: resolutionId,
      candidate_profile_id: input.candidate_profile_id,
      requirement_set_version_id: requirementSetVersion.requirement_set_version_id,
      requirement_set_id: requirementSet.requirement_set_id,
      requirement_set_content_hash:
        requirementSet.completeness.requirement_set_content_hash,
      requirement_fact_id: fact.requirement_fact_id,
      ...(fact.value.kind === "GENERAL_ELIGIBILITY_PREDICATE" ? {
        requirement_predicate_id: fact.value.predicate.requirement_predicate_id
      } : {}),
      position_id: input.position.position_id,
      position_version_id: input.position_version.position_version_id,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      source_composition_id: input.source_composition_result.source_composition_id,
      source_composition_hash: input.source_composition_result.composition_hash,
      source_occurrence_version_ids: clone(
        input.opportunity_version.source_occurrence_version_ids
      ),
      requirement_source_reference_ids: requirementTrace.sourceReferenceIds,
      requirement_evidence_fragment_ids: requirementTrace.evidenceFragmentIds,
      requirement_evidence_ids: requirementTrace.requirementEvidenceIds,
      candidate_evidence_references: evidenceReferences,
      applicability: evaluation.applicability,
      resolution_status: evaluation.status,
      logical_result: logicalResult(evaluation.status),
      reason_codes: evaluation.reasons,
      predicate_rule_version: input.predicate_rule_version,
      as_of: input.as_of,
      revision,
      semantic_hash: semanticHash,
      materialization_version: PREDICATE_RESOLUTION_MATERIALIZATION_VERSION,
      version_created: !existing
    };
    const resolution: PositionBoundPredicateResolution = {
      ...base,
      integrity_hash: positionBoundPredicateResolutionIntegrityHash(base)
    };
    if (!existing) {
      this.#versions.set(seriesKey, [...versions, clone(resolution)]);
    }
    return resolution;
  }
}

interface FactContext {
  readonly condition: Cr12RequirementCondition;
  readonly evidenceFragmentIds: readonly string[];
}

interface PredicateEvaluation {
  readonly status: PredicateResolutionStatus;
  readonly applicability: "APPLIES" | "DOES_NOT_APPLY" | "UNKNOWN";
  readonly reasons: readonly PredicateResolutionReasonCode[];
  readonly evidence: readonly PredicateCandidateEvidence[];
}

function validatePrerequisites(
  input: PositionBoundPredicateResolutionInput
): Extract<PositionBoundPredicateResolutionResult, { status: "BLOCKED" }> | null {
  if (!input.predicate_rule_version.trim()) {
    return blocked("REQUIREMENT_SET_INTEGRITY_FAILURE", "Predicate rule version is required");
  }
  try {
    requireIsoDateTime(input.as_of, "PredicateResolution as_of");
    const position = validatePosition(input.position);
    const positionVersion = validatePositionVersion(input.position_version, position);
    assertPositionBoundOpportunityVersionIntegrity(
      input.opportunity_version,
      position,
      positionVersion
    );
  } catch (error) {
    return blocked("POSITION_BINDING_FAILURE", errorMessage(error));
  }
  if (!input.position_bound_opportunity_gate) {
    return blocked(
      "POSITION_BINDING_FAILURE",
      "A trusted Position-bound Opportunity resolver is required"
    );
  }
  try {
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
      opportunity_version: input.opportunity_version
    }, trustedArtifact);
  } catch (error) {
    return blocked("POSITION_BINDING_FAILURE", errorMessage(error));
  }
  let composition: SourceCompositionResult;
  try {
    composition = assertSourceCompositionResultIntegrity(
      input.source_composition_result
    );
  } catch (error) {
    return blocked("SOURCE_COMPOSITION_INTEGRITY_FAILURE", errorMessage(error));
  }
  if (composition.opportunity_version_id
      !== input.opportunity_version.opportunity_version_id) {
    return blocked(
      "SOURCE_COMPOSITION_BINDING_FAILURE",
      "SourceCompositionResult belongs to another OpportunityVersion"
    );
  }
  if (composition.status !== "COMPLETE") {
    return blocked(
      "SOURCE_COMPOSITION_INCOMPLETE",
      "Trusted PredicateResolution requires a verified COMPLETE SourceCompositionResult"
    );
  }
  if (!input.requirement_set_version) {
    return blocked("REQUIREMENT_SET_MISSING", "No Phase G RequirementSet was supplied");
  }
  const version = input.requirement_set_version;
  const requirementSet = version.requirement_set;
  if (version.materialization_version
      !== POSITION_BOUND_REQUIREMENT_SET_MATERIALIZATION_VERSION) {
    return blocked(
      "REQUIREMENT_SET_INTEGRITY_FAILURE",
      "RequirementSet version materialization contract is invalid"
    );
  }
  try {
    assertCr12StructuredRequirementSetIntegrity(requirementSet);
  } catch (error) {
    return blocked("REQUIREMENT_SET_INTEGRITY_FAILURE", errorMessage(error));
  }
  if (version.opportunity_version_id !== input.opportunity_version.opportunity_version_id
      || version.position_version_id !== input.position_version.position_version_id
      || version.source_composition_id !== composition.source_composition_id
      || requirementSet.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id
      || !sameStringSet(
        version.source_occurrence_version_ids,
        input.opportunity_version.source_occurrence_version_ids
      )) {
    return blocked(
      "REQUIREMENT_SET_BINDING_FAILURE",
      "RequirementSet version does not match PositionVersion, PBOV, or source provenance"
    );
  }
  try {
    assertPositionBoundRequirementSetVersionIntegrity(version);
  } catch (error) {
    return blocked("REQUIREMENT_SET_INTEGRITY_FAILURE", errorMessage(error));
  }
  const reference = requirementSet.source_composition_reference;
  if (requirementSet.source_composition_state !== "COMPOSITION_BACKED"
      || !reference
      || reference.source_composition_id !== composition.source_composition_id
      || reference.opportunity_version_id !== composition.opportunity_version_id
      || reference.composition_hash !== composition.composition_hash
      || reference.composition_manifest_hash !== composition.composition_manifest_hash
      || reference.composition_status !== "COMPLETE") {
    return blocked(
      "SOURCE_COMPOSITION_BINDING_FAILURE",
      "RequirementSet does not retain the exact verified SourceComposition reference"
    );
  }
  if (requirementSet.completeness.status !== "COMPLETE"
      || requirementSet.completeness.blockers.length !== 0) {
    return blocked(
      "REQUIREMENT_SET_NOT_COMPLETE",
      "PredicateResolution cannot trust an incomplete RequirementSet"
    );
  }
  try {
    for (const evidence of input.candidate_evidence) {
      assertPredicateCandidateEvidenceIntegrity(evidence);
      if (evidence.candidate_profile_id !== input.candidate_profile_id) {
        throw new PredicateCandidateEvidenceIntegrityError(
          "Candidate Evidence belongs to another CandidateProfile"
        );
      }
    }
  } catch (error) {
    return blocked("CANDIDATE_EVIDENCE_INTEGRITY_FAILURE", errorMessage(error));
  }
  return null;
}

function blocked(
  blockerCode: PredicateResolutionBlockerCode,
  blockerDetail: string
): Extract<PositionBoundPredicateResolutionResult, { status: "BLOCKED" }> {
  return {
    status: "BLOCKED",
    blocker_code: blockerCode,
    blocker_detail: blockerDetail,
    resolutions: []
  };
}

function collectFactContexts(requirementSet: Cr12StructuredRequirementSet) {
  const conditions = new Map(requirementSet.condition_registry.map((condition) => {
    return [condition.requirement_condition_id, condition] as const;
  }));
  const contexts = new Map<string, FactContext>();
  for (const tree of requirementSet.requirement_logic_tree_registry) {
    const condition = conditions.get(tree.requirement_condition_id);
    if (!condition) continue;
    for (const node of tree.nodes) {
      if (node.kind !== "PREDICATE") continue;
      contexts.set(node.requirement_fact_id, {
        condition,
        evidenceFragmentIds: node.evidence_fragment_ids
      });
    }
  }
  return contexts;
}

function evaluatePredicate(
  fact: RequirementFact,
  context: FactContext | undefined,
  requirementSet: Cr12StructuredRequirementSet,
  candidateEvidence: readonly PredicateCandidateEvidence[],
  asOf: IsoDateTime
): PredicateEvaluation {
  if (!context || context.condition.resolution_state !== "RESOLVED"
      || fact.certainty === "AMBIGUOUS") {
    return review("SOURCE_REQUIREMENT_UNRESOLVED", []);
  }
  const applicability = resolveApplicability(
    fact,
    context.condition,
    requirementSet,
    candidateEvidence,
    asOf
  );
  if (applicability.result === "UNKNOWN") {
    return {
      status: "UNKNOWN",
      applicability: "UNKNOWN",
      reasons: ["APPLICABILITY_UNKNOWN"],
      evidence: applicability.evidence
    };
  }
  if (applicability.result === "DOES_NOT_APPLY") {
    return {
      status: "UNKNOWN",
      applicability: "DOES_NOT_APPLY",
      reasons: ["CONDITION_NOT_APPLICABLE"],
      evidence: applicability.evidence
    };
  }
  if (fact.value.kind === "GENERAL_ELIGIBILITY_PREDICATE") {
    return evaluateGeneralPredicate(fact.value.predicate, candidateEvidence, asOf);
  }
  const usable = applicableEvidence(candidateEvidence, asOf);
  const outsideAsOf = candidateEvidence.filter((evidence) => {
    return !evidenceAppliesAt(evidence, asOf)
      && evidenceCanAddressFact(evidence, fact);
  });
  if (usable.length === 0 && outsideAsOf.length > 0) {
    return insufficient("CANDIDATE_EVIDENCE_OUTSIDE_AS_OF", outsideAsOf);
  }
  if (fact.dimension === "EDUCATION_LEVEL") {
    return evaluateEducationLevel(fact, applicability.credentials);
  }
  if (fact.dimension === "MAJOR") {
    return evaluateMajor(fact, applicability.credentials);
  }
  if (fact.dimension === "GRADUATION_YEAR") {
    return evaluateGraduationYear(fact, usable);
  }
  if (fact.dimension === "AGE") return evaluateAge(fact, usable, asOf);
  if (fact.dimension === "GENDER") return evaluateGender(fact, usable);
  if (fact.dimension === "PROFESSIONAL_QUALIFICATION") {
    return evaluateProfessionalQualification(fact, usable);
  }
  return review("SAFE_RULE_NOT_IMPLEMENTED", usable);
}

function resolveApplicability(
  fact: RequirementFact,
  condition: Cr12RequirementCondition,
  requirementSet: Cr12StructuredRequirementSet,
  candidateEvidence: readonly PredicateCandidateEvidence[],
  asOf: IsoDateTime
) {
  const credentialApplicability = requirementSet
    .candidate_credential_applicability_registry.find((item) => {
      return item.candidate_credential_applicability_id
        === condition.candidate_credential_applicability_id;
    });
  const stateApplicability = requirementSet
    .candidate_state_applicability_registry.find((item) => {
      return item.candidate_state_applicability_id
        === condition.candidate_state_applicability_id;
    });
  if (!credentialApplicability || !stateApplicability
      || credentialApplicability.mode === "UNRESOLVED"
      || stateApplicability.mode === "UNRESOLVED"
      || stateApplicability.mode === "STATE_SELECTOR") {
    return { result: "UNKNOWN" as const, evidence: [], credentials: [] };
  }
  const usable = applicableEvidence(candidateEvidence, asOf);
  const cohortEvidence = usable.filter((evidence) => {
    return evidence.value?.kind === "CANDIDATE_COHORT"
      && evidence.observation_status === "CONFIRMED";
  });
  if (stateApplicability.mode === "COHORT_ANY_OF"
      || stateApplicability.mode === "COHORT_ALL_OF") {
    const known = cohortEvidence.flatMap((evidence) => {
      return evidence.value?.kind === "CANDIDATE_COHORT"
        ? [evidence.value.candidate_cohort]
        : [];
    });
    if (known.length === 0) {
      return { result: "UNKNOWN" as const, evidence: cohortEvidence, credentials: [] };
    }
    const applies = stateApplicability.mode === "COHORT_ANY_OF"
      ? stateApplicability.candidate_cohorts.some((cohort) => known.includes(cohort))
      : stateApplicability.candidate_cohorts.every((cohort) => known.includes(cohort));
    if (!applies) {
      return {
        result: "DOES_NOT_APPLY" as const,
        evidence: cohortEvidence,
        credentials: []
      };
    }
  }
  const credentialEvidence = usable.filter((evidence) => {
    return evidence.value?.kind === "EDUCATION_CREDENTIAL";
  });
  const credentials = selectCredentialEvidence(
    credentialEvidence,
    credentialApplicability
  );
  if (fact.dimension === "MAJOR" || fact.dimension === "EDUCATION_LEVEL"
      || fact.dimension === "ACADEMIC_DEGREE") {
    return {
      result: "APPLIES" as const,
      evidence: [...cohortEvidence, ...credentials],
      credentials
    };
  }
  return { result: "APPLIES" as const, evidence: cohortEvidence, credentials: [] };
}

function selectCredentialEvidence(
  evidence: readonly PredicateCandidateEvidence[],
  applicability: Cr12StructuredRequirementSet[
    "candidate_credential_applicability_registry"
  ][number]
) {
  const level = (item: PredicateCandidateEvidence) => {
    return item.value?.kind === "EDUCATION_CREDENTIAL"
      ? item.value.credential.level
      : null;
  };
  if (applicability.mode === "CANDIDATE_WIDE"
      || applicability.mode === "ANY_DEGREE"
      || applicability.mode === "ALL_DEGREES"
      || applicability.mode === "EITHER_LEVEL") {
    if ("applicable_degrees" in applicability) {
      return evidence.filter((item) => {
        const candidateLevel = level(item);
        return candidateLevel && applicability.applicable_degrees.some((requiredLevel) => {
          return requiredLevel === "GRADUATE"
            ? candidateLevel === "MASTER" || candidateLevel === "DOCTOR"
            : requiredLevel === candidateLevel;
        });
      });
    }
    return [...evidence];
  }
  if (applicability.mode === "UNDERGRADUATE") {
    return evidence.filter((item) => level(item) === "BACHELOR");
  }
  if (applicability.mode === "GRADUATE") {
    return evidence.filter((item) => {
      return level(item) === "MASTER" || level(item) === "DOCTOR";
    });
  }
  if (applicability.mode === "SPECIFIC_DEGREE") {
    return evidence.filter((item) => level(item) === applicability.degree);
  }
  if (applicability.mode === "HIGHEST_DEGREE") {
    const ranks = { OTHER: 0, BACHELOR: 1, MASTER: 2, DOCTOR: 3 } as const;
    const maximum = Math.max(...evidence.map((item) => {
      const candidateLevel = level(item);
      return candidateLevel ? ranks[candidateLevel] : 0;
    }), 0);
    return evidence.filter((item) => {
      const candidateLevel = level(item);
      return candidateLevel ? ranks[candidateLevel] === maximum : false;
    });
  }
  return [];
}

function evaluateGeneralPredicate(
  predicate: RequirementPredicate,
  evidence: readonly PredicateCandidateEvidence[],
  asOf: IsoDateTime
): PredicateEvaluation {
  if (predicate.source_resolution_state !== "RESOLVED"
      || predicate.temporal_relation === "UNRESOLVED") {
    return review("SOURCE_REQUIREMENT_UNRESOLVED", []);
  }
  const relevant = evidence.filter((item) => {
    return item.value?.kind === "CANDIDATE_STATE_ASSERTION"
      && item.value.assertion.dimension === predicate.dimension
      && candidateAssertionAddressesPredicate(item.value.assertion, predicate);
  });
  const applicable = relevant.filter((item) => {
    return item.value?.kind === "CANDIDATE_STATE_ASSERTION"
      && stateAssertionApplies(item.value.assertion, predicate, asOf);
  });
  if (applicable.length === 0) {
    return relevant.length === 0
      ? insufficient("CANDIDATE_EVIDENCE_MISSING", [])
      : insufficient("CANDIDATE_EVIDENCE_OUTSIDE_AS_OF", relevant);
  }
  if (applicable.some((item) => item.observation_status === "REVIEW_REQUIRED")) {
    return review("CANDIDATE_EVIDENCE_CONFLICT", applicable);
  }
  const confirmed = applicable.filter((item) => {
    return item.observation_status === "CONFIRMED"
      && item.value?.kind === "CANDIDATE_STATE_ASSERTION";
  });
  if (confirmed.length === 0) {
    return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", applicable);
  }
  const values = new Set(confirmed.map((item) => {
    return stableSerialize(item.value?.kind === "CANDIDATE_STATE_ASSERTION"
      ? item.value.assertion.value
      : null);
  }));
  if (values.size > 1) return review("CANDIDATE_EVIDENCE_CONFLICT", confirmed);
  const assertion = confirmed[0].value;
  if (assertion?.kind !== "CANDIDATE_STATE_ASSERTION" || !assertion.assertion.value) {
    return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", confirmed);
  }
  const value = assertion.assertion.value;
  if (predicate.predicate_kind === "CITIZENSHIP_EQUALS"
      && predicate.target.kind === "CITIZENSHIP"
      && value.kind === "CITIZENSHIP") {
    return resolved(value.citizenship_code === predicate.target.citizenship_code, confirmed);
  }
  if (predicate.predicate_kind === "CITIZENSHIP_EXCLUDED"
      && predicate.target.kind === "CITIZENSHIP"
      && value.kind === "CITIZENSHIP") {
    return resolved(value.citizenship_code !== predicate.target.citizenship_code, confirmed);
  }
  if ((predicate.predicate_kind === "STATUS_MUST_BE_PRESENT"
        || predicate.predicate_kind === "STATUS_MUST_BE_ABSENT")
      && predicate.target.kind === "SERVICE_OR_ENROLMENT_STATUS"
      && value.kind === "SERVICE_OR_ENROLMENT_STATUS") {
    const same = value.status === predicate.target.status;
    if (predicate.predicate_kind === "STATUS_MUST_BE_PRESENT") {
      return same ? resolved(true, confirmed)
        : insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", confirmed);
    }
    return same ? resolved(false, confirmed)
      : insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", confirmed);
  }
  if (predicate.predicate_kind === "DISQUALIFYING_RECORD_ABSENT"
      && predicate.target.kind === "DISQUALIFICATION_RECORD"
      && value.kind === "DISQUALIFICATION_RECORD") {
    const same = value.record_kind === predicate.target.record_kind
      && value.authority === predicate.target.authority
      && value.jurisdiction === predicate.target.jurisdiction;
    return same ? resolved(false, confirmed)
      : insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", confirmed);
  }
  if (predicate.predicate_kind === "FORMAL_CLEARANCE_REQUIRED"
      && predicate.target.kind === "FORMAL_CLEARANCE_DECISION"
      && value.kind === "FORMAL_CLEARANCE_DECISION") {
    if (value.issuer !== predicate.target.issuer
        || value.decision_kind !== predicate.target.decision_kind) {
      return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", confirmed);
    }
    return resolved(value.decision_status === predicate.target.decision_status, confirmed);
  }
  return review("SAFE_RULE_NOT_IMPLEMENTED", confirmed);
}

function evaluateEducationLevel(
  fact: RequirementFact,
  evidence: readonly PredicateCandidateEvidence[]
): PredicateEvaluation {
  const credentials = confirmedCredentials(evidence);
  if (credentials.result) return credentials.result;
  if (fact.value.kind !== "CODE") return review("SAFE_RULE_NOT_IMPLEMENTED", evidence);
  const ranks: Readonly<Record<string, number>> = {
    OTHER: 0,
    BACHELOR: 1,
    MASTER: 2,
    DOCTOR: 3
  };
  const required = ranks[fact.value.code];
  if (required === undefined) return review("SAFE_RULE_NOT_IMPLEMENTED", evidence);
  const matches = credentials.credentials.map((item) => {
    const actual = ranks[item.value.credential.level] ?? 0;
    return fact.operator === "AT_LEAST" ? actual >= required
      : fact.operator === "AT_MOST" ? actual <= required
        : fact.operator === "EQUALS" ? actual === required
          : false;
  });
  if (!["AT_LEAST", "AT_MOST", "EQUALS"].includes(fact.operator)) {
    return review("SAFE_RULE_NOT_IMPLEMENTED", evidence);
  }
  return matches.some(Boolean)
    ? resolved(true, credentials.credentials)
    : insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", credentials.credentials);
}

function evaluateMajor(
  fact: RequirementFact,
  evidence: readonly PredicateCandidateEvidence[]
): PredicateEvaluation {
  const credentials = confirmedCredentials(evidence);
  if (credentials.result) return credentials.result;
  const items = credentials.credentials;
  if (fact.value.kind === "PROGRAM_REFERENCE") {
    return evaluateProgramReference(fact, items);
  }
  const hasProtected0351 = (fact.value.kind === "CODE"
      && fact.value.code === "0351")
    || (fact.value.kind === "CODE_SET" && fact.value.codes.includes("0351"));
  if (hasProtected0351 && items.some((item) => {
    return item.value?.kind === "EDUCATION_CREDENTIAL"
      && item.value.credential.program_type === "LAW_MASTER_NON_LAW";
  })) {
    return review("LAW_0351_APPLICABILITY_UNRESOLVED", items);
  }
  if (fact.value.kind === "CR11_MAJOR_SEMANTIC") {
    return evaluateCr11Major(fact.value.projection, items);
  }
  const expectedCodes: readonly string[] = fact.value.kind === "CODE" ? [fact.value.code]
    : fact.value.kind === "CODE_SET" ? fact.value.codes
      : [];
  if (expectedCodes.length === 0) return review("SAFE_RULE_NOT_IMPLEMENTED", items);
  const expectedBackgrounds = expectedCodes.filter((code): code is "LAW" | "NON_LAW" => {
    return code === "LAW" || code === "NON_LAW";
  });
  if (expectedBackgrounds.length > 0) {
    const backgrounds = items.map((item) => {
      return item.value.credential.academic_background;
    });
    if (backgrounds.some((background) => background === "UNKNOWN")) {
      return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", items);
    }
    return resolved(backgrounds.some((background) => {
      return expectedBackgrounds.some((expected) => expected === background);
    }), items);
  }
  if (expectedCodes.includes("LAW_STUDIES_FAMILY")
      && items.every((item) => {
        return item.value.credential.academic_background === "NON_LAW";
      })) {
    return resolved(false, items);
  }
  const knownCodes = items.flatMap((item) => {
    return item.value?.kind === "EDUCATION_CREDENTIAL"
      ? item.value.credential.normalized_program_codes
      : [];
  });
  if (knownCodes.length === 0) {
    return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", items);
  }
  return knownCodes.some((code) => expectedCodes.includes(code))
    ? resolved(true, items)
    : items.every(hasCompleteMajorIdentity)
      ? resolved(false, items)
      : insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", items);
}

function evaluateProgramReference(
  fact: RequirementFact,
  evidence: readonly PredicateEducationEvidence[]
): PredicateEvaluation {
  if (fact.value.kind !== "PROGRAM_REFERENCE") {
    return review("SAFE_RULE_NOT_IMPLEMENTED", evidence);
  }
  const expected = fact.value.reference;
  const comparable = evidence.flatMap((item) => {
    return (item.value.credential.program_directory_references ?? []).filter(
      (reference) => {
        return reference.directory_namespace === expected.directory_namespace
          && reference.directory_version === expected.directory_version;
      }
    );
  });
  if (comparable.length === 0) {
    return expected.program_code === "0351" && evidence.some((item) => {
      return item.value.credential.program_type === "LAW_MASTER_NON_LAW";
    })
      ? review("LAW_0351_APPLICABILITY_UNRESOLVED", evidence)
      : insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", evidence);
  }
  return resolved(comparable.some((reference) => {
    return reference.program_code === expected.program_code;
  }), evidence);
}

function evaluateCr11Major(
  projection: Extract<
    RequirementFact["value"],
    { kind: "CR11_MAJOR_SEMANTIC" }
  >["projection"],
  evidence: readonly PredicateEducationEvidence[]
): PredicateEvaluation {
  if (projection.source_resolution_state !== "SOURCE_RESOLVED") {
    return review("SOURCE_REQUIREMENT_UNRESOLVED", evidence);
  }
  const sourceIdentity = projection.major_expression.major_identity;
  if (projection.major_expression.semantic_type === "EXACT_IDENTITY"
      && sourceIdentity?.identity_kind === "EXACT") {
    const expected = sourceIdentity.semantic_code;
    const identities = evidence.map((item) => {
      return item.value.credential.major_identity_assertion;
    });
    if (identities.some((identity) => identity.provenance_state !== "COMPLETE")) {
      return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", evidence);
    }
    return resolved(identities.some((identity) => {
      return identity.semantic_code === expected;
    }), evidence);
  }
  const results = evidence.map((item) => {
    if (item.value?.kind !== "EDUCATION_CREDENTIAL") return "UNKNOWN" as const;
    const candidate = item.value.credential.major_identity_assertion;
    const relations = projection.major_match_relations.filter((relation) => {
      return stableSerialize(semanticObject(relation.candidate_major_identity))
        === stableSerialize(semanticObject(candidate));
    });
    if (relations.some((relation) => {
      return relation.relation_state === "ESTABLISHED"
        && relation.certainty !== "UNRESOLVED"
        && ["EXACT_IDENTITY", "EXPLICIT_INCLUDED", "UNRESTRICTED"].includes(
          relation.relation_kind
        );
    })) return "TRUE" as const;
    if (relations.some((relation) => {
      return relation.relation_state === "ESTABLISHED"
        && relation.certainty === "EXPLICIT"
        && relation.relation_kind === "EXPLICIT_EXCLUDED";
    })) return "FALSE" as const;
    return "UNKNOWN" as const;
  });
  if (results.includes("TRUE") && results.includes("FALSE")) {
    return review("CANDIDATE_EVIDENCE_CONFLICT", evidence);
  }
  if (results.includes("TRUE")) return resolved(true, evidence);
  if (results.includes("FALSE")) return resolved(false, evidence);
  return review("LAW_0351_APPLICABILITY_UNRESOLVED", evidence);
}

function evaluateGraduationYear(
  fact: RequirementFact,
  evidence: readonly PredicateCandidateEvidence[]
): PredicateEvaluation {
  const years = evidence.filter((item) => {
    return item.value?.kind === "TARGET_GRADUATION_YEAR";
  });
  if (years.length === 0) {
    return insufficient("CANDIDATE_EVIDENCE_MISSING", []);
  }
  if (years.some((item) => item.observation_status === "REVIEW_REQUIRED")) {
    return review("CANDIDATE_EVIDENCE_CONFLICT", years);
  }
  if (years.some((item) => item.observation_status !== "CONFIRMED")) {
    return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", years);
  }
  const values = new Set(years.flatMap((item) => {
    return item.value?.kind === "TARGET_GRADUATION_YEAR"
      ? [item.value.graduation_year]
      : [];
  }));
  if (values.size !== 1) return review("CANDIDATE_EVIDENCE_CONFLICT", years);
  if (fact.value.kind !== "GRADUATION_WINDOW") {
    return review("SAFE_RULE_NOT_IMPLEMENTED", years);
  }
  const actual = [...values][0]!;
  if (fact.value.exact_graduation_year !== undefined) {
    return resolved(actual === fact.value.exact_graduation_year, years);
  }
  const range = fact.value.graduation_year_range;
  if (!range) return review("SAFE_RULE_NOT_IMPLEMENTED", years);
  return resolved(
    (range.start_inclusive
      ? actual >= range.start_year
      : actual > range.start_year)
      && (range.end_inclusive
        ? actual <= range.end_year
        : actual < range.end_year),
    years
  );
}

function hasCompleteMajorIdentity(evidence: PredicateEducationEvidence) {
  return evidence.value.credential.completeness === "COMPLETE"
    && evidence.value.credential.major_identity_assertion.provenance_state
      === "COMPLETE";
}

function evaluateAge(
  fact: RequirementFact,
  evidence: readonly PredicateCandidateEvidence[],
  asOf: IsoDateTime
): PredicateEvaluation {
  const dates = evidence.filter((item) => item.value?.kind === "DATE_OF_BIRTH");
  if (dates.length === 0) return insufficient("CANDIDATE_EVIDENCE_MISSING", []);
  if (dates.some((item) => item.observation_status !== "CONFIRMED")) {
    return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", dates);
  }
  const values = new Set(dates.map((item) => {
    return item.value?.kind === "DATE_OF_BIRTH" ? item.value.date_of_birth : "";
  }));
  if (values.size !== 1) return review("CANDIDATE_EVIDENCE_CONFLICT", dates);
  const referenceDate = fact.value.kind === "AGE"
    || fact.value.kind === "AGE_RANGE" ? fact.value.reference_date : null;
  if (!referenceDate || instant(`${referenceDate}T00:00:00Z`) > instant(asOf)) {
    return review("TEMPORAL_CONTEXT_UNRESOLVED", dates);
  }
  const birthDate = [...values][0];
  const age = ageOnDate(birthDate, referenceDate);
  if (fact.value.kind === "AGE") {
    const match = fact.operator === "AT_LEAST" ? age >= fact.value.years
      : fact.operator === "AT_MOST" ? age <= fact.value.years
        : fact.operator === "EQUALS" ? age === fact.value.years
          : null;
    return match === null ? review("SAFE_RULE_NOT_IMPLEMENTED", dates)
      : resolved(match, dates);
  }
  if (fact.value.kind === "AGE_RANGE") {
    const lower = !fact.value.lower_bound
      || (fact.value.lower_bound.inclusive
        ? age >= fact.value.lower_bound.years
        : age > fact.value.lower_bound.years);
    const upper = !fact.value.upper_bound
      || (fact.value.upper_bound.inclusive
        ? age <= fact.value.upper_bound.years
        : age < fact.value.upper_bound.years);
    return resolved(lower && upper, dates);
  }
  return review("SAFE_RULE_NOT_IMPLEMENTED", dates);
}

function evaluateGender(
  fact: RequirementFact,
  evidence: readonly PredicateCandidateEvidence[]
): PredicateEvaluation {
  const genders = evidence.filter((item) => item.value?.kind === "GENDER");
  if (genders.length === 0) return insufficient("CANDIDATE_EVIDENCE_MISSING", []);
  if (genders.some((item) => item.observation_status !== "CONFIRMED")) {
    return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", genders);
  }
  const values = new Set(genders.map((item) => {
    return item.value?.kind === "GENDER" ? item.value.gender : "UNKNOWN";
  }));
  if (values.size !== 1 || values.has("UNKNOWN")) {
    return values.size > 1 ? review("CANDIDATE_EVIDENCE_CONFLICT", genders)
      : insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", genders);
  }
  if (fact.value.kind !== "CODE" || fact.operator !== "EQUALS") {
    return review("SAFE_RULE_NOT_IMPLEMENTED", genders);
  }
  const expectedGender = fact.value.code;
  return resolved([...values].some((value) => value === expectedGender), genders);
}

function evaluateProfessionalQualification(
  fact: RequirementFact,
  evidence: readonly PredicateCandidateEvidence[]
): PredicateEvaluation {
  const qualifications = evidence.filter((item) => {
    return item.value?.kind === "PROFESSIONAL_QUALIFICATION";
  });
  if (qualifications.length === 0) {
    return insufficient("CANDIDATE_EVIDENCE_MISSING", []);
  }
  if (fact.value.kind !== "PROFESSIONAL_QUALIFICATION") {
    return review("SAFE_RULE_NOT_IMPLEMENTED", qualifications);
  }
  const expected = fact.value;
  const matching = qualifications.filter((item) => {
    if (item.value?.kind !== "PROFESSIONAL_QUALIFICATION") return false;
    const actual = item.value.qualification;
    return actual.qualification_type === expected.qualification_type
      && (!expected.qualification_class
        || actual.qualification_class === expected.qualification_class);
  });
  if (matching.length === 0) {
    return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", qualifications);
  }
  if (matching.some((item) => item.observation_status === "REVIEW_REQUIRED")) {
    return review("CANDIDATE_EVIDENCE_CONFLICT", matching);
  }
  if (matching.some((item) => item.observation_status !== "CONFIRMED")) {
    return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", matching);
  }
  if (matching.some((item) => {
    return item.value?.kind === "PROFESSIONAL_QUALIFICATION"
      && item.value.qualification.status === "UNKNOWN";
  })) return insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", matching);
  const outcomes = new Set(matching.map((item) => {
    if (item.value?.kind !== "PROFESSIONAL_QUALIFICATION") return "UNKNOWN";
    return ["OBTAINED", "PASSED_PENDING_CERTIFICATE"].includes(
      item.value.qualification.status
    ) ? "SATISFIED" : "CONTRARY";
  }));
  if (outcomes.size > 1) {
    return review("CANDIDATE_EVIDENCE_CONFLICT", matching);
  }
  return resolved(matching.some((item) => {
    return item.value?.kind === "PROFESSIONAL_QUALIFICATION"
      && ["OBTAINED", "PASSED_PENDING_CERTIFICATE"].includes(
        item.value.qualification.status
      );
  }), matching);
}

function confirmedCredentials(evidence: readonly PredicateCandidateEvidence[]) {
  if (evidence.length === 0) {
    return {
      result: insufficient("CANDIDATE_EVIDENCE_MISSING", []),
      credentials: [] as PredicateEducationEvidence[]
    };
  }
  const confirmed = evidence.filter((item): item is PredicateEducationEvidence => {
    return item.observation_status === "CONFIRMED"
      && item.value?.kind === "EDUCATION_CREDENTIAL"
      && item.value.credential.completeness === "COMPLETE";
  });
  if (confirmed.length === 0) {
    return {
      result: insufficient("CANDIDATE_EVIDENCE_INSUFFICIENT", evidence),
      credentials: [] as PredicateEducationEvidence[]
    };
  }
  return { result: null, credentials: confirmed };
}

function applicableEvidence(
  evidence: readonly PredicateCandidateEvidence[],
  asOf: IsoDateTime
) {
  return evidence.filter((item) => evidenceAppliesAt(item, asOf));
}

type PredicateEducationEvidence = PredicateCandidateEvidence & {
  readonly value: Extract<
    PredicateCandidateEvidenceValue,
    { readonly kind: "EDUCATION_CREDENTIAL" }
  >;
};

function evidenceAppliesAt(
  evidence: PredicateCandidateEvidence,
  asOf: IsoDateTime
) {
  const asOfInstant = instant(asOf);
  return instant(evidence.observed_at) <= asOfInstant
    && (!evidence.effective_from
      || instant(evidence.effective_from) <= asOfInstant)
    && (!evidence.effective_to
      || instant(evidence.effective_to) >= asOfInstant);
}

function evidenceCanAddressFact(
  evidence: PredicateCandidateEvidence,
  fact: RequirementFact
) {
  const value = evidence.value;
  const kind = value?.kind;
  if (fact.value.kind === "GENERAL_ELIGIBILITY_PREDICATE") {
    return value?.kind === "CANDIDATE_STATE_ASSERTION"
      && value.assertion.dimension
        === fact.value.predicate.dimension
      && candidateAssertionAddressesPredicate(
        value.assertion,
        fact.value.predicate
      );
  }
  if (fact.dimension === "EDUCATION_LEVEL" || fact.dimension === "MAJOR"
      || fact.dimension === "ACADEMIC_DEGREE") {
    return kind === "EDUCATION_CREDENTIAL";
  }
  if (fact.dimension === "AGE") return kind === "DATE_OF_BIRTH";
  if (fact.dimension === "GENDER") return kind === "GENDER";
  if (fact.dimension === "PROFESSIONAL_QUALIFICATION") {
    return kind === "PROFESSIONAL_QUALIFICATION";
  }
  return false;
}

function candidateAssertionAddressesPredicate(
  assertion: CandidateStateAssertion,
  predicate: RequirementPredicate
) {
  const value = assertion.value;
  if (!value) return assertion.dimension === predicate.dimension;
  if (predicate.target.kind === "CITIZENSHIP") {
    return value.kind === "CITIZENSHIP";
  }
  if (predicate.target.kind === "SERVICE_OR_ENROLMENT_STATUS") {
    return value.kind === "SERVICE_OR_ENROLMENT_STATUS"
      && value.status === predicate.target.status;
  }
  if (predicate.target.kind === "DISQUALIFICATION_RECORD") {
    return value.kind === "DISQUALIFICATION_RECORD"
      && value.record_kind === predicate.target.record_kind
      && value.authority === predicate.target.authority
      && value.jurisdiction === predicate.target.jurisdiction;
  }
  return value.kind === "FORMAL_CLEARANCE_DECISION"
    && value.issuer === predicate.target.issuer
    && value.decision_kind === predicate.target.decision_kind;
}

function stateAssertionApplies(
  assertion: CandidateStateAssertion,
  predicate: RequirementPredicate,
  asOf: IsoDateTime
) {
  const referenceDate = predicate.target.kind === "SERVICE_OR_ENROLMENT_STATUS"
    || predicate.target.kind === "DISQUALIFICATION_RECORD"
    ? predicate.target.reference_date
    : predicate.target.kind === "FORMAL_CLEARANCE_DECISION"
      ? predicate.target.effective_from
      : asOf.slice(0, 10);
  const reference = instant(`${referenceDate}T00:00:00Z`);
  return instant(assertion.observed_at) <= instant(asOf)
    && (!assertion.effective_from || instant(assertion.effective_from) <= reference)
    && (!assertion.effective_to || instant(assertion.effective_to) >= reference);
}

function resolved(
  matched: boolean,
  evidence: readonly PredicateCandidateEvidence[]
): PredicateEvaluation {
  return {
    status: matched ? "RESOLVED_MATCH" : "RESOLVED_NOT_MATCH",
    applicability: "APPLIES",
    reasons: [matched
      ? "EXPLICIT_CANDIDATE_EVIDENCE_MATCH"
      : "EXPLICIT_CANDIDATE_EVIDENCE_CONTRADICTION"],
    evidence
  };
}

function insufficient(
  reason: Extract<
    PredicateResolutionReasonCode,
    | "CANDIDATE_EVIDENCE_MISSING"
    | "CANDIDATE_EVIDENCE_INSUFFICIENT"
    | "CANDIDATE_EVIDENCE_OUTSIDE_AS_OF"
  >,
  evidence: readonly PredicateCandidateEvidence[]
): PredicateEvaluation {
  return {
    status: "INSUFFICIENT",
    applicability: "APPLIES",
    reasons: [reason],
    evidence
  };
}

function review(
  reason: Extract<
    PredicateResolutionReasonCode,
    | "CANDIDATE_EVIDENCE_CONFLICT"
    | "SOURCE_REQUIREMENT_UNRESOLVED"
    | "TEMPORAL_CONTEXT_UNRESOLVED"
    | "LAW_0351_APPLICABILITY_UNRESOLVED"
    | "SAFE_RULE_NOT_IMPLEMENTED"
  >,
  evidence: readonly PredicateCandidateEvidence[]
): PredicateEvaluation {
  return {
    status: "REVIEW_REQUIRED",
    applicability: "APPLIES",
    reasons: [reason],
    evidence
  };
}

function candidateEvidenceReferences(
  evidence: readonly PredicateCandidateEvidence[]
) {
  const byId = new Map<string, PredicateCandidateEvidenceReference>();
  for (const item of evidence) {
    const assertion = item.value?.kind === "CANDIDATE_STATE_ASSERTION"
      ? item.value.assertion
      : null;
    byId.set(item.predicate_candidate_evidence_id, {
      predicate_candidate_evidence_id: item.predicate_candidate_evidence_id,
      predicate_candidate_evidence_hash: item.predicate_candidate_evidence_hash,
      ...(item.candidate_credential_id ? {
        candidate_credential_id: item.candidate_credential_id
      } : {}),
      observation_status: item.observation_status,
      provenance: item.provenance,
      observed_at: item.observed_at,
      ...(item.effective_from ? { effective_from: item.effective_from } : {}),
      ...(item.effective_to ? { effective_to: item.effective_to } : {}),
      source_references: clone(item.source_references),
      synthetic_test: item.provenance === "SYNTHETIC_TEST",
      ...(assertion ? {
        candidate_state_assertion_id: assertion.candidate_state_assertion_id,
        candidate_state_assertion_hash: assertion.candidate_state_assertion_hash
      } : {})
    });
  }
  return [...byId.values()].sort((left, right) => {
    return left.predicate_candidate_evidence_id.localeCompare(
      right.predicate_candidate_evidence_id
    );
  });
}

function requirementTraceFor(
  fact: RequirementFact,
  context: FactContext | undefined,
  requirementSet: Cr12StructuredRequirementSet
) {
  const sourceReferenceIds = context
    ? context.condition.source_reference_ids
    : [];
  const evidenceFragmentIds = uniqueSorted([
    ...(context?.condition.evidence_fragment_ids ?? []),
    ...(context?.evidenceFragmentIds ?? []),
    ...(fact.value.kind === "GENERAL_ELIGIBILITY_PREDICATE"
      ? fact.value.predicate.evidence_fragment_ids
      : [])
  ]);
  const requirementEvidenceIds = requirementSet.requirement_evidence_registry
    .filter((evidence) => evidence.requirement_fact_id === fact.requirement_fact_id)
    .map((evidence) => evidence.requirement_evidence_id);
  return {
    sourceReferenceIds: uniqueSorted(sourceReferenceIds),
    evidenceFragmentIds,
    requirementEvidenceIds: uniqueSorted(requirementEvidenceIds)
  };
}

function resolutionSemanticHash(
  fact: RequirementFact,
  context: FactContext | undefined,
  evaluation: PredicateEvaluation,
  ruleVersion: string,
  asOf: IsoDateTime
) {
  return sha256(stableSerialize({
    requirement: semanticObject(fact),
    condition: context ? semanticObject({
      modality: context.condition.modality,
      representation_kind: context.condition.representation_kind,
      resolution_state: context.condition.resolution_state
    }) : null,
    candidate_evidence: uniqueCanonical(evaluation.evidence.map((evidence) => {
      return semanticCandidateEvidence(evidence);
    })),
    applicability: evaluation.applicability,
    resolution_status: evaluation.status,
    logical_result: logicalResult(evaluation.status),
    reason_codes: uniqueSorted(evaluation.reasons),
    predicate_rule_version: ruleVersion,
    as_of: asOf
  }));
}

function semanticCandidateEvidence(evidence: PredicateCandidateEvidence) {
  return {
    predicate_candidate_evidence_id: evidence.predicate_candidate_evidence_id,
    predicate_candidate_evidence_hash: evidence.predicate_candidate_evidence_hash,
    candidate_credential_id: evidence.candidate_credential_id ?? null,
    value: semanticObject(evidence.value),
    original_value: evidence.original_value,
    normalized_value: evidence.normalized_value,
    observation_status: evidence.observation_status,
    observed_at: evidence.observed_at,
    effective_from: evidence.effective_from ?? null,
    effective_to: evidence.effective_to ?? null,
    provenance: evidence.provenance,
    source_references: uniqueCanonical(evidence.source_references),
    schema_version: evidence.schema_version
  };
}

export function positionBoundPredicateResolutionIntegrityHash(
  resolution: Omit<PositionBoundPredicateResolution, "integrity_hash">
    | PositionBoundPredicateResolution
) {
  const {
    integrity_hash: _integrityHash,
    version_created: _versionCreated,
    ...canonical
  } = resolution as PositionBoundPredicateResolution;
  return sha256(stableSerialize({
    ...canonical,
    source_occurrence_version_ids:
      uniqueSorted(canonical.source_occurrence_version_ids),
    requirement_source_reference_ids:
      uniqueSorted(canonical.requirement_source_reference_ids),
    requirement_evidence_fragment_ids:
      uniqueSorted(canonical.requirement_evidence_fragment_ids),
    requirement_evidence_ids: uniqueSorted(canonical.requirement_evidence_ids),
    candidate_evidence_references: canonical.candidate_evidence_references.map(
      (reference) => ({
        ...reference,
        candidate_credential_id: reference.candidate_credential_id ?? null,
        effective_from: reference.effective_from ?? null,
        effective_to: reference.effective_to ?? null,
        candidate_state_assertion_id:
          reference.candidate_state_assertion_id ?? null,
        candidate_state_assertion_hash:
          reference.candidate_state_assertion_hash ?? null,
        source_references: [...reference.source_references].sort(
          compareCandidateStateEvidence
        )
      })
    ).sort((left, right) => {
      return left.predicate_candidate_evidence_id.localeCompare(
        right.predicate_candidate_evidence_id
      );
    }),
    reason_codes: uniqueSorted(canonical.reason_codes)
  }));
}

export function assertPositionBoundPredicateResolutionIntegrity(
  resolution: PositionBoundPredicateResolution
) {
  const expectedId = predicateResolutionId(
    resolution.requirement_set_version_id,
    resolution.candidate_profile_id,
    resolution.requirement_fact_id,
    resolution.predicate_rule_version,
    resolution.as_of,
    resolution.revision,
    resolution.semantic_hash
  );
  if (resolution.materialization_version
      !== PREDICATE_RESOLUTION_MATERIALIZATION_VERSION
      || !resolution.candidate_profile_id.trim()
      || !Number.isSafeInteger(resolution.revision)
      || resolution.revision < 1
      || !/^[a-f0-9]{64}$/u.test(resolution.semantic_hash)
      || !/^[a-f0-9]{64}$/u.test(resolution.integrity_hash)
      || resolution.predicate_resolution_id !== expectedId
      || resolution.logical_result !== logicalResult(resolution.resolution_status)
      || resolution.integrity_hash
        !== positionBoundPredicateResolutionIntegrityHash(resolution)
      || new Set(resolution.candidate_evidence_references.map((reference) => {
        return reference.predicate_candidate_evidence_id;
      })).size !== resolution.candidate_evidence_references.length
      || resolution.candidate_evidence_references.some((reference) => {
        return reference.synthetic_test
            !== (reference.provenance === "SYNTHETIC_TEST")
          || !/^sha256:[a-f0-9]{64}$/u.test(
            reference.predicate_candidate_evidence_hash
          )
          || reference.source_references.length === 0
          || reference.source_references.some((source) => {
            return source.evidence_class !== reference.provenance
              || !source.issuer.trim();
          });
      })) {
    throw new Error(
      "PredicateResolution identity, integrity, or evidence provenance is invalid"
    );
  }
  requireIsoDateTime(resolution.as_of, "PredicateResolution as_of");
  for (const reference of resolution.candidate_evidence_references) {
    requireIsoDateTime(reference.observed_at, "Candidate Evidence observed_at");
    if (reference.effective_from) {
      requireIsoDateTime(reference.effective_from, "Candidate Evidence effective_from");
    }
    if (reference.effective_to) {
      requireIsoDateTime(reference.effective_to, "Candidate Evidence effective_to");
    }
  }
  return resolution;
}

function predicateResolutionId(
  requirementSetVersionId: string,
  candidateProfileId: CandidateProfileId,
  factId: RequirementFactId,
  ruleVersion: string,
  asOf: IsoDateTime,
  revision: number,
  semanticHash: string
) {
  return `predicate-resolution:${sha256(stableSerialize({
    requirement_set_version_id: requirementSetVersionId,
    candidate_profile_id: candidateProfileId,
    requirement_fact_id: factId,
    predicate_rule_version: ruleVersion,
    as_of: asOf,
    revision,
    semantic_hash: semanticHash
  }))}`;
}

function resolutionSeriesKey(
  requirementSetVersionId: string,
  candidateProfileId: CandidateProfileId,
  factId: RequirementFactId,
  ruleVersion: string,
  asOf: IsoDateTime
) {
  return stableSerialize({
    requirement_set_version_id: requirementSetVersionId,
    candidate_profile_id: candidateProfileId,
    requirement_fact_id: factId,
    predicate_rule_version: ruleVersion,
    as_of: asOf
  });
}

function logicalResult(status: PredicateResolutionStatus) {
  return status === "RESOLVED_MATCH" ? "TRUE" as const
    : status === "RESOLVED_NOT_MATCH" ? "FALSE" as const
      : "UNKNOWN" as const;
}

function sameCandidateStateEvidence(
  left: readonly CandidateStateEvidenceReference[],
  right: readonly PredicateCandidateEvidenceSourceReference[]
) {
  return stableSerialize([...left].sort(compareCandidateStateEvidence))
    === stableSerialize([...right].sort(compareCandidateStateEvidence));
}

function compareCandidateStateEvidence(
  left: CandidateStateEvidenceReference | PredicateCandidateEvidenceSourceReference,
  right: CandidateStateEvidenceReference | PredicateCandidateEvidenceSourceReference
) {
  return left.candidate_state_evidence_id.localeCompare(
    right.candidate_state_evidence_id
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return stableSerialize(uniqueSorted(left)) === stableSerialize(uniqueSorted(right));
}

function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort();
}

function uniqueCanonical(values: readonly unknown[]) {
  const byCanonical = new Map<string, unknown>();
  for (const value of values) byCanonical.set(stableSerialize(value), value);
  return [...byCanonical.entries()].sort(([left], [right]) => {
    return left.localeCompare(right);
  }).map(([, value]) => value);
}

function semanticObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(semanticObject);
    return items.every((item) => typeof item === "string")
      ? [...new Set(items as string[])].sort()
      : items;
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const omitted = new Set([
    "observed_at",
    "captured_at",
    "parser_version",
    "resolver_version",
    "source_locator",
    "locator",
    "source_order"
  ]);
  return Object.fromEntries(Object.keys(record).sort().filter((key) => {
    return !omitted.has(key) && !key.endsWith("_id") && !key.endsWith("_ids")
      && !key.endsWith("_hash");
  }).map((key) => [key, semanticObject(record[key])]));
}

function ageOnDate(birthDate: string, referenceDate: string) {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [referenceYear, referenceMonth, referenceDay] = referenceDate
    .split("-").map(Number);
  let age = referenceYear - birthYear;
  if (referenceMonth < birthMonth
      || (referenceMonth === birthMonth && referenceDay < birthDay)) age -= 1;
  return age;
}

function requireIsoDateTime(value: string, label: string) {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new PredicateCandidateEvidenceIntegrityError(`${label} must be an ISO datetime`);
  }
}

function instant(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new PredicateCandidateEvidenceIntegrityError("Invalid temporal value");
  }
  return parsed;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
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
