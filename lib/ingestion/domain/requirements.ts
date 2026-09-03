import type {
  ExtractedRecordId,
  IsoDate,
  LogicGroupId,
  NonEmptyReadonlyArray,
  OpportunityVersionId,
  RequirementEvidenceId,
  RequirementEvidenceFragmentId,
  RequirementFactId,
  RequirementObservationId,
  RequirementSetId,
  SnapshotId
} from "./primitives";
import type { NormalizedText, OriginalText } from "./text";

export const REQUIREMENT_DIMENSIONS = [
  "EDUCATION_LEVEL",
  "MAJOR",
  "PROFESSIONAL_QUALIFICATION",
  "GRADUATION_YEAR",
  "WORK_EXPERIENCE",
  "LANGUAGE",
  "POLITICAL_AFFILIATION",
  "ACADEMIC_DEGREE",
  "AGE",
  "CANDIDATE_COHORT",
  "HOUSEHOLD_REGISTRATION",
  "STUDENT_ORIGIN"
] as const;

export const REQUIREMENT_OPERATORS = [
  "EQUALS",
  "NOT_EQUALS",
  "ONE_OF",
  "NONE_OF",
  "ALL_OF",
  "AT_LEAST",
  "AT_MOST",
  "EXISTS",
  "UNRESTRICTED"
] as const;

export const REQUIREMENT_SUBJECT_SCOPES = [
  "CANDIDATE",
  "BACHELOR",
  "MASTER",
  "GRADUATE",
  "DOCTOR",
  "ANY_EDUCATION",
  "ALL_EDUCATION"
] as const;

export const REQUIREMENT_POLARITIES = ["POSITIVE", "NEGATIVE"] as const;
export const REQUIREMENT_CERTAINTIES = [
  "EXPLICIT",
  "INFERRED",
  "AMBIGUOUS"
] as const;
export const LOGIC_OPERATORS = ["AND", "OR"] as const;

export const ACADEMIC_PROGRAM_CODES = [
  "LAW_STUDIES",
  "LAW",
  "JURIS_MASTER",
  "JURIS_MASTER_NON_LAW",
  "INTELLECTUAL_PROPERTY",
  "ANY_MAJOR"
] as const;

export type RequirementDimension = (typeof REQUIREMENT_DIMENSIONS)[number];
export type RequirementOperator = (typeof REQUIREMENT_OPERATORS)[number];
export type RequirementSubjectScope =
  (typeof REQUIREMENT_SUBJECT_SCOPES)[number];
export type RequirementPolarity = (typeof REQUIREMENT_POLARITIES)[number];
export type RequirementCertainty = (typeof REQUIREMENT_CERTAINTIES)[number];
export type LogicOperator = (typeof LOGIC_OPERATORS)[number];
export type AcademicProgramCode = (typeof ACADEMIC_PROGRAM_CODES)[number];

export const CANDIDATE_COHORT_CODES = [
  "FRESH_GRADUATE",
  "OVERSEAS_RETURNING_GRADUATE",
  "SOCIAL_CANDIDATE"
] as const;

export type CandidateCohortCode = (typeof CANDIDATE_COHORT_CODES)[number];

export interface AcademicProgramDirectoryReference {
  readonly directory_namespace: string;
  readonly directory_version?: string;
  readonly program_code: string;
  readonly program_label?: NormalizedText;
}

export interface RequirementApplicability {
  readonly candidate_cohorts: NonEmptyReadonlyArray<CandidateCohortCode>;
  readonly operator: "ANY_OF" | "ALL_OF";
}

export interface RequirementLogicGroup {
  readonly logic_group_id: LogicGroupId;
  readonly operator: LogicOperator;
  readonly parent_logic_group_id?: LogicGroupId;
}

export type RequirementValue =
  | {
      readonly kind: "CODE";
      readonly code: string;
      readonly label?: NormalizedText;
    }
  | {
      readonly kind: "CODE_SET";
      readonly codes: readonly string[];
      readonly labels?: readonly NormalizedText[];
    }
  | {
      readonly kind: "BOOLEAN";
      readonly value: boolean;
    }
  | {
      readonly kind: "INTEGER";
      readonly value: number;
      readonly unit?: string;
    }
  | {
      readonly kind: "AGE";
      readonly years: number;
      readonly reference_date: IsoDate;
    }
  | {
      readonly kind: "PROGRAM_REFERENCE";
      readonly reference: AcademicProgramDirectoryReference;
    }
  | {
      readonly kind: "TEXT";
      readonly value: NormalizedText;
    }
  | {
      readonly kind: "UNRESTRICTED";
    };

export interface RequirementFact {
  readonly requirement_fact_id: RequirementFactId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly dimension: RequirementDimension;
  readonly operator: RequirementOperator;
  readonly value: RequirementValue;
  readonly subject_scope: RequirementSubjectScope;
  readonly logic_group: RequirementLogicGroup;
  readonly polarity: RequirementPolarity;
  readonly certainty: RequirementCertainty;
  readonly applicability?: RequirementApplicability;
  readonly parser_version: string;
}

export interface EvidenceLocator {
  readonly kind?: "HTML" | "SPREADSHEET" | "JSON" | "DOCUMENT";
  readonly field_path?: string;
  readonly section?: string;
  readonly sheet?: string;
  readonly cell_or_range?: string;
  readonly json_path?: string;
  readonly text_locator?: string;
  readonly page_number?: number;
  readonly start_offset?: number;
  readonly end_offset?: number;
}

export interface RequirementEvidence {
  readonly requirement_evidence_id: RequirementEvidenceId;
  readonly requirement_fact_id: RequirementFactId;
  readonly snapshot_id: SnapshotId;
  readonly locator: EvidenceLocator;
  readonly evidence_text: OriginalText;
  readonly normalized_text?: NormalizedText;
  readonly extractor_name: string;
  readonly extractor_version: string;
  readonly parser_version: string;
}

export const REQUIREMENT_OBSERVATION_STATUSES = [
  "CONFIRMED_REQUIREMENT",
  "NOT_OBSERVED",
  "UNPARSED_CLAUSE",
  "AMBIGUOUS",
  "DOMAIN_GAP_OBSERVED"
] as const;

export const REQUIREMENT_CLAUSE_ROLES = [
  "MANDATORY",
  "PREFERRED",
  "INFORMATIONAL",
  "UNKNOWN"
] as const;

export type RequirementObservationStatus =
  (typeof REQUIREMENT_OBSERVATION_STATUSES)[number];
export type RequirementClauseRole = (typeof REQUIREMENT_CLAUSE_ROLES)[number];

export type RequirementEvidenceFragmentLocator =
  | {
      readonly kind: "HTML";
      readonly selector?: string;
      readonly path?: string;
      readonly field_path?: string;
      readonly start_offset?: number;
      readonly end_offset?: number;
    }
  | {
      readonly kind: "SPREADSHEET";
      readonly sheet: string;
      readonly cell_or_range: string;
      readonly field_path?: string;
    }
  | {
      readonly kind: "JSON";
      readonly json_path: string;
      readonly field_path?: string;
    }
  | {
      readonly kind: "DOCUMENT";
      readonly page_number?: number;
      readonly section?: string;
      readonly text_locator?: string;
      readonly field_path?: string;
    };

interface RequirementEvidenceFragmentBase {
  readonly requirement_evidence_fragment_id: RequirementEvidenceFragmentId;
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
  readonly locator: RequirementEvidenceFragmentLocator;
  readonly academic_program_directory?: Omit<
    AcademicProgramDirectoryReference,
    "program_code" | "program_label"
  >;
  readonly extractor_name: string;
  readonly extractor_version: string;
  readonly parser_version: string;
}

export type RequirementEvidenceFragment = RequirementEvidenceFragmentBase & (
  | {
      readonly observed_value_state: "TEXT";
      readonly original_text: OriginalText;
      readonly normalized_text?: NormalizedText;
    }
  | {
      readonly observed_value_state: "EMPTY";
      readonly original_text: null;
      readonly normalized_text?: never;
    }
);

export interface RequirementObservation {
  readonly requirement_observation_id: RequirementObservationId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly status: RequirementObservationStatus;
  readonly clause_role: RequirementClauseRole;
  readonly dimension_hint?: RequirementDimension;
  readonly requirement_fact_ids: readonly RequirementFactId[];
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly parser_version: string;
}

export const REQUIREMENT_COMPLETENESS_STATUSES = [
  "COMPLETE",
  "INCOMPLETE",
  "REVIEW_REQUIRED"
] as const;

export const REQUIREMENT_COMPLETENESS_BLOCKER_CODES = [
  "NOT_OBSERVED",
  "UNPARSED_CLAUSE",
  "AMBIGUOUS",
  "DOMAIN_GAP_OBSERVED",
  "ATTACHMENT_MISSING",
  "EVIDENCE_INCOMPLETE"
] as const;

export type RequirementCompletenessStatus =
  (typeof REQUIREMENT_COMPLETENESS_STATUSES)[number];
export type RequirementCompletenessBlockerCode =
  (typeof REQUIREMENT_COMPLETENESS_BLOCKER_CODES)[number];

export interface RequirementCompletenessBlocker {
  readonly code: RequirementCompletenessBlockerCode;
  readonly observation_ids: readonly RequirementObservationId[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
  readonly description: string;
}

interface RequirementCompletenessBase {
  readonly requirement_set_id: RequirementSetId;
  readonly requirement_set_content_hash: string;
  readonly covered_extracted_record_ids: readonly ExtractedRecordId[];
  readonly covered_snapshot_ids: readonly SnapshotId[];
  readonly observation_ids: readonly RequirementObservationId[];
  readonly fact_ids: readonly RequirementFactId[];
  readonly evidence_ids: readonly RequirementEvidenceId[];
  readonly gate_version: string;
}

export interface CompleteRequirementCompleteness
  extends RequirementCompletenessBase {
  readonly status: "COMPLETE";
  readonly blockers: readonly [];
}

export interface NonCompleteRequirementCompleteness
  extends RequirementCompletenessBase {
  readonly status: "INCOMPLETE" | "REVIEW_REQUIRED";
  readonly blockers: NonEmptyReadonlyArray<RequirementCompletenessBlocker>;
}

export type RequirementCompleteness =
  | CompleteRequirementCompleteness
  | NonCompleteRequirementCompleteness;

interface RequirementSetBase {
  readonly requirement_set_id: RequirementSetId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly evidence_fragments: readonly RequirementEvidenceFragment[];
  readonly observations: readonly RequirementObservation[];
  readonly facts: readonly RequirementFact[];
  readonly evidence: readonly RequirementEvidence[];
  readonly parser_version: string;
}

export interface CompleteRequirementSet extends RequirementSetBase {
  readonly completeness: CompleteRequirementCompleteness;
}

export interface NonCompleteRequirementSet extends RequirementSetBase {
  readonly completeness: NonCompleteRequirementCompleteness;
}

export type RequirementSet = CompleteRequirementSet | NonCompleteRequirementSet;
