import { createHash } from "node:crypto";

import type {
  CandidateBoundMajorMatchRelationId,
  CandidateCredentialId,
  CandidateProfileId,
  CandidateStateAssertionHash,
  CandidateStateAssertionId,
  CandidateStateEvidenceId,
  EligibilityAssessmentId,
  IsoDate,
  IsoDateTime,
  NonEmptyReadonlyArray,
  OpportunityVersionId,
  RequirementEvidenceId,
  RequirementFactId,
  StructuredEligibilityAssessmentId
} from "./primitives";
import type {
  AcademicProgramCode,
  AcademicProgramDirectoryReference,
  CandidateCohortCode,
  Cr11CandidateMajorIdentityDescriptor,
  Cr11MajorMatchRelationKind,
  Cr11MajorScope,
  DisqualificationRecordKind,
  GenderCode,
  GeneralEligibilityRequirementDimension,
  ServiceOrEnrolmentStatusKind
} from "./requirements";
import type { TraceableText } from "./text";

export type EducationLevel = "BACHELOR" | "MASTER" | "DOCTOR" | "OTHER";
export type AcademicBackground = "LAW" | "NON_LAW" | "UNKNOWN";
export type CandidateGender = Exclude<GenderCode, "ANY">;
export type DegreeType = "ACADEMIC" | "PROFESSIONAL";
export const ACADEMIC_PROGRAM_TYPES = [
  "LAW_MASTER_NON_LAW",
  "LAW_NON_LAW",
  "OTHER"
] as const;
export type AcademicProgramType = (typeof ACADEMIC_PROGRAM_TYPES)[number];
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
  readonly program_directory_references?: readonly AcademicProgramDirectoryReference[];
  readonly academic_degree_codes?: readonly string[];
  readonly degree_type?: DegreeType;
  readonly program_type?: AcademicProgramType;
  readonly academic_background: AcademicBackground;
  readonly graduation_year?: number;
}

export type CandidateCredentialCompleteness = "COMPLETE" | "PARTIAL" | "UNKNOWN";
export type CandidateCredentialProvenance =
  | "CANDIDATE_ASSERTED"
  | "DOCUMENT_VERIFIED"
  | "SYNTHETIC_TEST";

export interface StructuredEducationCredential extends EducationCredential {
  readonly candidate_credential_id: CandidateCredentialId;
  readonly major_identity_assertion: Cr11CandidateMajorIdentityDescriptor;
  readonly provenance: CandidateCredentialProvenance;
  readonly completeness: CandidateCredentialCompleteness;
}

export interface ProfessionalQualification {
  readonly qualification_code: string;
  readonly qualification_type?: string;
  readonly qualification_class?: string;
  readonly status: QualificationStatus;
  readonly name: TraceableText;
}

export interface CandidateWorkExperience {
  readonly years: number;
  readonly scope: string;
}

export const MAJOR_EQUIVALENCE_STATUSES = [
  "EXPLICIT_EQUIVALENT",
  "NOT_EQUIVALENT",
  "NOT_ESTABLISHED"
] as const;
export type MajorEquivalenceStatus =
  (typeof MAJOR_EQUIVALENCE_STATUSES)[number];

export interface MajorEquivalenceEvidence {
  readonly source_namespace: string;
  readonly source_version: string;
  readonly from_code: string;
  readonly from_program_type: string;
  readonly to_code: string;
  readonly to_program_type: string;
  readonly equivalence_status: MajorEquivalenceStatus;
  readonly evidence_id: string;
  readonly evidence_version: string;
}

export type CandidateStateObservationStatus =
  | "CONFIRMED"
  | "UNKNOWN"
  | "INSUFFICIENT"
  | "REVIEW_REQUIRED";

export type CandidateStateAssertionProvenance = "SYNTHETIC_TEST";
export type CandidateStateEvidenceClass = "SYNTHETIC_TEST";

export interface CandidateStateEvidenceReference {
  readonly candidate_state_evidence_id: CandidateStateEvidenceId;
  readonly evidence_class: CandidateStateEvidenceClass;
  readonly captured_at: IsoDateTime;
  readonly issuer: string;
}

export type CandidateStateValue =
  | {
      readonly kind: "CITIZENSHIP";
      readonly citizenship_code: string;
    }
  | {
      readonly kind: "SERVICE_OR_ENROLMENT_STATUS";
      readonly status: ServiceOrEnrolmentStatusKind;
    }
  | {
      readonly kind: "DISQUALIFICATION_RECORD";
      readonly record_kind: DisqualificationRecordKind;
      readonly authority: string;
      readonly jurisdiction: string;
    }
  | {
      readonly kind: "FORMAL_CLEARANCE_DECISION";
      readonly issuer: string;
      readonly decision_kind: string;
      readonly decision_status: string;
    };

export interface CandidateStateAssertion {
  readonly candidate_state_assertion_id: CandidateStateAssertionId;
  readonly candidate_profile_id: CandidateProfileId;
  readonly dimension: GeneralEligibilityRequirementDimension;
  readonly state_kind: CandidateStateValue["kind"];
  readonly value: CandidateStateValue | null;
  readonly state_observation_status: CandidateStateObservationStatus;
  readonly observed_at: IsoDateTime;
  readonly effective_from?: IsoDateTime;
  readonly effective_to?: IsoDateTime;
  readonly provenance: CandidateStateAssertionProvenance;
  readonly evidence_references: readonly CandidateStateEvidenceReference[];
  readonly schema_version: string;
  readonly supersedes_candidate_state_assertion_id: CandidateStateAssertionId | null;
  readonly candidate_state_assertion_hash: CandidateStateAssertionHash;
}

export class CandidateStateAssertionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateStateAssertionIntegrityError";
  }
}

export type CandidateStateAssertionSetState =
  | "COMPLETE"
  | "INSUFFICIENT"
  | "REVIEW_REQUIRED";

export function createCandidateStateAssertion(
  input: Omit<CandidateStateAssertion, "candidate_state_assertion_hash">
): CandidateStateAssertion {
  const assertion = {
    ...input,
    evidence_references: [...input.evidence_references]
  } as Omit<CandidateStateAssertion, "candidate_state_assertion_hash">;
  return {
    ...assertion,
    candidate_state_assertion_hash: candidateStateAssertionHash(assertion)
  };
}

export function candidateStateAssertionHash(
  assertion: Omit<CandidateStateAssertion, "candidate_state_assertion_hash">
    | CandidateStateAssertion
): CandidateStateAssertionHash {
  return `sha256:${createHash("sha256").update(stableSerialize(
    candidateStateAssertionCanonicalForm(assertion)
  )).digest("hex")}` as CandidateStateAssertionHash;
}

export function candidateStateAssertionCanonicalForm(
  assertion: Omit<CandidateStateAssertion, "candidate_state_assertion_hash">
    | CandidateStateAssertion
) {
  const { candidate_state_assertion_hash: _hash, ...hashable } = assertion as
    CandidateStateAssertion;
  return {
    ...hashable,
    evidence_references: [...hashable.evidence_references].sort((left, right) => {
      return left.candidate_state_evidence_id.localeCompare(
        right.candidate_state_evidence_id
      );
    })
  };
}

export function assertCandidateStateAssertionIntegrity(
  assertion: CandidateStateAssertion
): CandidateStateAssertion {
  if (assertion.provenance !== "SYNTHETIC_TEST"
      || assertion.evidence_references.some((evidence) => {
        return evidence.evidence_class !== "SYNTHETIC_TEST";
      })) {
    throw new CandidateStateAssertionIntegrityError(
      "Candidate state assertions are limited to offline synthetic evidence"
    );
  }
  if (assertion.evidence_references.length === 0
      || !candidateStateValueMatchesAssertion(assertion)
      || (assertion.state_observation_status === "CONFIRMED"
        && assertion.value === null)) {
    throw new CandidateStateAssertionIntegrityError(
      "Candidate state assertion has incomplete typed evidence or value"
    );
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(assertion.candidate_state_assertion_hash)
      || candidateStateAssertionHash(assertion)
        !== assertion.candidate_state_assertion_hash) {
    throw new CandidateStateAssertionIntegrityError(
      "Candidate state assertion hash is missing, malformed, or does not match content"
    );
  }
  if (new Set(assertion.evidence_references.map((evidence) => {
    return evidence.candidate_state_evidence_id;
  })).size !== assertion.evidence_references.length) {
    throw new CandidateStateAssertionIntegrityError(
      "Candidate state assertion evidence references must be unique"
    );
  }
  return assertion;
}

function candidateStateValueMatchesAssertion(assertion: CandidateStateAssertion) {
  if (assertion.value === null) {
    return assertion.state_observation_status !== "CONFIRMED";
  }
  if (assertion.dimension === "CITIZENSHIP_STATUS") {
    return assertion.state_kind === "CITIZENSHIP"
      && assertion.value.kind === "CITIZENSHIP"
      && Boolean(assertion.value.citizenship_code);
  }
  if (assertion.dimension === "SERVICE_OR_ENROLMENT_STATUS") {
    return assertion.state_kind === "SERVICE_OR_ENROLMENT_STATUS"
      && assertion.value.kind === "SERVICE_OR_ENROLMENT_STATUS";
  }
  if (assertion.dimension === "DISQUALIFICATION_RECORD") {
    return assertion.state_kind === "DISQUALIFICATION_RECORD"
      && assertion.value.kind === "DISQUALIFICATION_RECORD"
      && Boolean(assertion.value.authority && assertion.value.jurisdiction);
  }
  return assertion.state_kind === "FORMAL_CLEARANCE_DECISION"
    && assertion.value.kind === "FORMAL_CLEARANCE_DECISION"
    && Boolean(assertion.value.issuer && assertion.value.decision_kind
      && assertion.value.decision_status);
}

export function classifyCandidateStateAssertionSet(
  assertions: readonly CandidateStateAssertion[]
): CandidateStateAssertionSetState {
  if (assertions.length === 0) return "INSUFFICIENT";
  const confirmedValues = new Map<string, Set<string>>();
  let hasInsufficient = false;
  for (const assertion of assertions) {
    assertCandidateStateAssertionIntegrity(assertion);
    if (assertion.state_observation_status === "REVIEW_REQUIRED") {
      return "REVIEW_REQUIRED";
    }
    if (assertion.state_observation_status === "UNKNOWN"
        || assertion.state_observation_status === "INSUFFICIENT") {
      hasInsufficient = true;
      continue;
    }
    const key = stableSerialize({
      candidate_profile_id: assertion.candidate_profile_id,
      dimension: assertion.dimension,
      state_kind: assertion.state_kind,
      effective_from: assertion.effective_from ?? null,
      effective_to: assertion.effective_to ?? null
    });
    const values = confirmedValues.get(key) ?? new Set<string>();
    values.add(stableSerialize(assertion.value));
    confirmedValues.set(key, values);
    if (values.size > 1) return "REVIEW_REQUIRED";
  }
  return hasInsufficient ? "INSUFFICIENT" : "COMPLETE";
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => {
    return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
  }).join(",")}}`;
}

export interface CandidateProfile {
  readonly candidate_profile_id: CandidateProfileId;
  readonly education: readonly EducationCredential[];
  readonly gender?: CandidateGender;
  readonly target_graduation_year?: number;
  readonly date_of_birth?: IsoDate;
  readonly candidate_cohorts?: readonly CandidateCohortCode[];
  readonly household_registration_codes?: readonly string[];
  readonly student_origin_codes?: readonly string[];
  readonly professional_qualifications: readonly ProfessionalQualification[];
  readonly work_experience?: readonly CandidateWorkExperience[];
  readonly work_experience_months?: number;
  readonly languages: readonly string[];
  readonly political_affiliation?: string;
}

export interface StructuredCandidateProfile extends Omit<CandidateProfile, "education"> {
  readonly education: readonly StructuredEducationCredential[];
}

export type CandidateBoundMajorRelationResult = "TRUE" | "FALSE" | "UNKNOWN";

export interface CandidateBoundMajorMatchRelation {
  readonly candidate_bound_major_match_relation_id:
    CandidateBoundMajorMatchRelationId;
  readonly candidate_credential_id: CandidateCredentialId;
  readonly source_major_expression_id: string;
  readonly target_semantic_type: string;
  readonly target_major_scope: Cr11MajorScope;
  readonly target_major_identity_semantic_code?: string;
  readonly candidate_major_identity: Cr11CandidateMajorIdentityDescriptor;
  readonly candidate_credential_applicability_id: string;
  readonly relation_template_id?: string;
  readonly relation_type: Cr11MajorMatchRelationKind | "NOT_ESTABLISHED";
  readonly relation_evidence_fragment_ids: readonly string[];
  readonly directory_namespace?: string;
  readonly directory_version?: string;
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly provenance: CandidateCredentialProvenance;
  readonly completeness: CandidateCredentialCompleteness;
  readonly result: CandidateBoundMajorRelationResult;
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
  readonly major_equivalence_evidence_ids?: readonly string[];
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

export const STRUCTURED_ELIGIBILITY_RESULTS = [
  "MATCH",
  "NOT_MATCH",
  "INSUFFICIENT"
] as const;

export type StructuredEligibilityResult =
  (typeof STRUCTURED_ELIGIBILITY_RESULTS)[number];

export const STRUCTURED_ELIGIBILITY_REASON_CODES = [
  "MANDATORY_REQUIREMENTS_SATISFIED",
  "PROVEN_MANDATORY_REQUIREMENT_NOT_SATISFIED",
  "CANDIDATE_CREDENTIAL_INCOMPLETE",
  "MAJOR_RELATION_NOT_ESTABLISHED",
  "CANDIDATE_DATA_UNKNOWN",
  "NON_MANDATORY_REQUIREMENT_UNRESOLVED"
] as const;

export type StructuredEligibilityReasonCode =
  (typeof STRUCTURED_ELIGIBILITY_REASON_CODES)[number];

export interface StructuredEligibilityAssessment {
  readonly structured_eligibility_assessment_id: StructuredEligibilityAssessmentId;
  readonly result: StructuredEligibilityResult;
  readonly candidate_profile_id: CandidateProfileId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly requirement_set_id: string;
  readonly requirement_set_content_hash: string;
  readonly candidate_credential_ids: readonly CandidateCredentialId[];
  readonly candidate_bound_major_match_relation_ids:
    readonly CandidateBoundMajorMatchRelationId[];
  readonly reason_codes: readonly StructuredEligibilityReasonCode[];
  readonly requirement_fact_ids: readonly RequirementFactId[];
  readonly evidence_ids: readonly RequirementEvidenceId[];
  readonly engine_version: string;
  readonly parser_versions: readonly string[];
  readonly resolver_versions: readonly string[];
  readonly assessed_at: IsoDateTime;
}
