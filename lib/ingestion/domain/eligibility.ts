import type {
  CandidateProfileId,
  EligibilityAssessmentId,
  IsoDateTime,
  NonEmptyReadonlyArray,
  OpportunityVersionId,
  RequirementEvidenceId,
  RequirementFactId
} from "./primitives";
import type { AcademicProgramCode } from "./requirements";
import type { TraceableText } from "./text";

export type EducationLevel = "BACHELOR" | "MASTER" | "DOCTOR" | "OTHER";
export type AcademicBackground = "LAW" | "NON_LAW" | "UNKNOWN";
export type QualificationStatus =
  | "OBTAINED"
  | "PASSED_PENDING_CERTIFICATE"
  | "NOT_OBTAINED"
  | "UNKNOWN";

export interface EducationCredential {
  readonly level: EducationLevel;
  readonly institution: TraceableText;
  readonly program_name: TraceableText;
  readonly normalized_program_codes: readonly AcademicProgramCode[];
  readonly academic_background: AcademicBackground;
  readonly graduation_year?: number;
}

export interface ProfessionalQualification {
  readonly qualification_code: string;
  readonly status: QualificationStatus;
  readonly name: TraceableText;
}

export interface CandidateProfile {
  readonly candidate_profile_id: CandidateProfileId;
  readonly education: readonly EducationCredential[];
  readonly target_graduation_year?: number;
  readonly professional_qualifications: readonly ProfessionalQualification[];
  readonly work_experience_months?: number;
  readonly languages: readonly string[];
  readonly political_affiliation?: string;
}

export const ELIGIBILITY_RESULTS = [
  "ELIGIBLE",
  "LIKELY_ELIGIBLE",
  "NEEDS_REVIEW",
  "LIKELY_INELIGIBLE",
  "INELIGIBLE"
] as const;

export const ELIGIBILITY_REASON_CODES = [
  "REQUIREMENT_SATISFIED",
  "REQUIREMENT_NOT_SATISFIED",
  "INSUFFICIENT_EVIDENCE",
  "AMBIGUOUS_REQUIREMENT",
  "CONFLICTING_REQUIREMENTS",
  "MISSING_CANDIDATE_DATA"
] as const;

export type EligibilityResult = (typeof ELIGIBILITY_RESULTS)[number];
export type EligibilityReasonCode =
  (typeof ELIGIBILITY_REASON_CODES)[number];

export interface EligibilityConflict {
  readonly code: string;
  readonly requirement_fact_ids: readonly RequirementFactId[];
  readonly description: string;
}

interface EligibilityAssessmentBase {
  readonly eligibility_assessment_id: EligibilityAssessmentId;
  readonly candidate_profile_id: CandidateProfileId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly reason_codes: NonEmptyReadonlyArray<EligibilityReasonCode>;
  readonly requirement_fact_ids: readonly RequirementFactId[];
  readonly engine_version: string;
  readonly parser_versions: readonly string[];
  readonly unresolved_conflicts: readonly EligibilityConflict[];
  readonly assessed_at: IsoDateTime;
}

export type EligibilityAssessment =
  | (EligibilityAssessmentBase & {
      readonly result: "ELIGIBLE";
      readonly evidence_ids: NonEmptyReadonlyArray<RequirementEvidenceId>;
    })
  | (EligibilityAssessmentBase & {
      readonly result: Exclude<EligibilityResult, "ELIGIBLE">;
      readonly evidence_ids: readonly RequirementEvidenceId[];
    });
