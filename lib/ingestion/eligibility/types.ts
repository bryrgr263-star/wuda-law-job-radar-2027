import type {
  CandidateProfile,
  CandidateStateAssertion,
  CompleteRequirementSet,
  Cr12EngineCapability,
  Cr12StructuredRequirementSet,
  EligibilityAssessment,
  IsoDateTime,
  MajorEquivalenceEvidence,
  OpportunityVersion,
  RequirementContextTarget,
  StructuredCandidateProfile,
  StructuredEligibilityAssessment
} from "../domain";

export interface TrustedSourceCompositionGate {
  resolve(
    reference: import("../domain").SourceCompositionReference
  ): import("../domain").SourceCompositionResult | null;
  verify(
    result: import("../domain").SourceCompositionResult
  ): import("../domain").SourceCompositionResult;
}

export interface EligibilityEvaluationInput {
  readonly opportunity_version: OpportunityVersion;
  readonly complete_requirement_set: CompleteRequirementSet;
  readonly candidate_profile: CandidateProfile;
  readonly major_equivalence_evidence?: readonly MajorEquivalenceEvidence[];
  readonly assessed_at: IsoDateTime;
}

export interface EligibilityEngine {
  evaluate(input: EligibilityEvaluationInput): EligibilityAssessment;
}

export interface StructuredRecruitmentContextSnapshot {
  readonly opportunity_version_id: OpportunityVersion["opportunity_version_id"];
  readonly effective_targets: readonly RequirementContextTarget[];
}

export interface StructuredEligibilityEvaluationInput {
  readonly model: "CR12_STRUCTURED_LOGIC_V1";
  readonly structured_requirement_set: Cr12StructuredRequirementSet;
  readonly opportunity_version: OpportunityVersion;
  readonly recruitment_context_snapshot: StructuredRecruitmentContextSnapshot;
  readonly candidate_profile: StructuredCandidateProfile;
  readonly offline_candidate_state_assertions?: readonly CandidateStateAssertion[];
  readonly supported_engine_capabilities?: readonly Cr12EngineCapability[];
  readonly assessed_at: IsoDateTime;
}

export type StructuredEligibilityGateReason =
  | "STRUCTURAL_INTEGRITY_FAILURE"
  | "CONTENT_HASH_MANIFEST_MISMATCH"
  | "CONTEXT_BINDING_MISMATCH"
  | "REQUIREMENT_SET_NOT_COMPLETE"
  | "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY"
  | "CANDIDATE_STATE_ASSERTION_INTEGRITY_FAILURE"
  | "CANDIDATE_CREDENTIAL_BINDING_INVALID"
  | "SOURCE_COMPOSITION_LEGACY_UNCOMPOSED"
  | "SOURCE_COMPOSITION_GATE_UNAVAILABLE"
  | "SOURCE_COMPOSITION_NOT_FOUND"
  | "SOURCE_COMPOSITION_VERIFICATION_FAILED"
  | "SOURCE_COMPOSITION_REFERENCE_MISMATCH";

export interface StructuredEligibilityGateResult {
  readonly status: "NOT_ALLOWED";
  readonly reason: StructuredEligibilityGateReason;
  readonly required_capabilities: readonly Cr12EngineCapability[];
  readonly supported_capabilities: readonly Cr12EngineCapability[];
  readonly missing_capabilities: readonly Cr12EngineCapability[];
  readonly assessment?: never;
}

export type StructuredEligibilityDispatchResult =
  | StructuredEligibilityGateResult
  | {
      readonly status: "ASSESSMENT";
      readonly assessment: StructuredEligibilityAssessment;
    };

export interface StructuredEligibilityEngine {
  evaluateStructured(
    input: StructuredEligibilityEvaluationInput
  ): StructuredEligibilityDispatchResult;
}

export const ELIGIBILITY_INPUT_ERROR_CODES = [
  "FACT_OPPORTUNITY_MISMATCH",
  "EVIDENCE_FACT_MISSING",
  "REQUIREMENT_SET_INCOMPLETE",
  "REQUIREMENT_SET_OPPORTUNITY_MISMATCH",
  "REQUIREMENT_SET_CONTENT_MISMATCH",
  "REQUIREMENT_SET_FACT_MISMATCH",
  "REQUIREMENT_SET_EVIDENCE_MISMATCH",
  "REQUIREMENT_SET_OBSERVATION_MISMATCH",
  "STRUCTURED_REQUIREMENT_SET_UNSUPPORTED"
] as const;

export type EligibilityInputErrorCode =
  (typeof ELIGIBILITY_INPUT_ERROR_CODES)[number];

export class EligibilityInputError extends Error {
  readonly code: EligibilityInputErrorCode;

  constructor(code: EligibilityInputErrorCode, message: string) {
    super(message);
    this.name = "EligibilityInputError";
    this.code = code;
  }
}
