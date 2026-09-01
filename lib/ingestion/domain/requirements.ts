import type {
  LogicGroupId,
  OpportunityVersionId,
  RequirementEvidenceId,
  RequirementFactId,
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
  "POLITICAL_AFFILIATION"
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
  readonly parser_version: string;
}

export interface EvidenceLocator {
  readonly field_path?: string;
  readonly section?: string;
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
