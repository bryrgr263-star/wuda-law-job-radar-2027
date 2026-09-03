import type {
  CompleteRequirementSet,
  ExtractedRecordId,
  NonCompleteRequirementSet,
  OpportunityVersion,
  OriginalText,
  RequirementCompleteness,
  RequirementCompletenessBlockerCode,
  RequirementEvidence,
  RequirementEvidenceFragment,
  RequirementEvidenceFragmentId,
  RequirementFact,
  RequirementObservation,
  SnapshotId
} from "../domain";

export interface RequirementSourceReference {
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
}

export interface RequirementParsingBlockerInput {
  readonly code: Extract<
    RequirementCompletenessBlockerCode,
    "ATTACHMENT_MISSING" | "EVIDENCE_INCOMPLETE"
  >;
  readonly evidence_fragment_ids?: readonly RequirementEvidenceFragmentId[];
  readonly description: string;
}

export interface RequirementParsingInput {
  readonly opportunity_version: OpportunityVersion;
  readonly evidence_fragments: readonly RequirementEvidenceFragment[];
  readonly expected_sources: readonly RequirementSourceReference[];
  readonly blockers?: readonly RequirementParsingBlockerInput[];
}

export const REQUIREMENT_PARSE_WARNING_CODES = [
  "NO_REQUIREMENT_TEXT",
  "NORMALIZED_TEXT_MISSING",
  "TRACEABILITY_SOURCE_MISSING",
  "CLAUSE_ALIGNMENT_FAILED",
  "EMPTY_EVIDENCE_FRAGMENT",
  "SOURCE_COVERAGE_MISSING",
  "UNPARSED_CLAUSE",
  "AMBIGUOUS_EDUCATION_SCOPE",
  "ACADEMIC_PROGRAM_DIRECTORY_MISSING",
  "AGE_REFERENCE_DATE_MISSING",
  "PREFERRED_QUALIFICATION_NOT_MANDATORY"
] as const;

export type RequirementParseWarningCode =
  (typeof REQUIREMENT_PARSE_WARNING_CODES)[number];

export interface RequirementParseWarning {
  readonly code: RequirementParseWarningCode;
  readonly message: string;
  readonly clause?: OriginalText;
}

export interface RequirementParsingResult {
  readonly facts: readonly RequirementFact[];
  readonly evidence: readonly RequirementEvidence[];
  readonly observations: readonly RequirementObservation[];
  readonly evidence_fragments: readonly RequirementEvidenceFragment[];
  readonly completeness: RequirementCompleteness;
  readonly requirement_set: CompleteRequirementSet | NonCompleteRequirementSet;
  readonly complete_requirement_set: CompleteRequirementSet | null;
  readonly warnings: readonly RequirementParseWarning[];
  readonly parser_version: string;
}
