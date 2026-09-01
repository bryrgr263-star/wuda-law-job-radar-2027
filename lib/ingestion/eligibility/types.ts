import type {
  CandidateProfile,
  EligibilityAssessment,
  IsoDateTime,
  OpportunityVersion,
  RequirementEvidence,
  RequirementFact
} from "../domain";

export interface EligibilityEvaluationInput {
  readonly opportunity_version: OpportunityVersion;
  readonly requirement_facts: readonly RequirementFact[];
  readonly requirement_evidence: readonly RequirementEvidence[];
  readonly candidate_profile: CandidateProfile;
  readonly assessed_at: IsoDateTime;
}

export interface EligibilityEngine {
  evaluate(input: EligibilityEvaluationInput): EligibilityAssessment;
}

export const ELIGIBILITY_INPUT_ERROR_CODES = [
  "FACT_OPPORTUNITY_MISMATCH",
  "EVIDENCE_FACT_MISSING"
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
