import type {
  CandidateProfile,
  CompleteRequirementSet,
  EligibilityAssessment,
  IsoDateTime,
  OpportunityVersion
} from "../domain";

export interface EligibilityEvaluationInput {
  readonly opportunity_version: OpportunityVersion;
  readonly complete_requirement_set: CompleteRequirementSet;
  readonly candidate_profile: CandidateProfile;
  readonly assessed_at: IsoDateTime;
}

export interface EligibilityEngine {
  evaluate(input: EligibilityEvaluationInput): EligibilityAssessment;
}

export const ELIGIBILITY_INPUT_ERROR_CODES = [
  "FACT_OPPORTUNITY_MISMATCH",
  "EVIDENCE_FACT_MISSING",
  "REQUIREMENT_SET_INCOMPLETE",
  "REQUIREMENT_SET_OPPORTUNITY_MISMATCH",
  "REQUIREMENT_SET_CONTENT_MISMATCH",
  "REQUIREMENT_SET_FACT_MISMATCH",
  "REQUIREMENT_SET_EVIDENCE_MISMATCH",
  "REQUIREMENT_SET_OBSERVATION_MISMATCH"
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
