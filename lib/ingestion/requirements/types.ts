import type {
  ExtractedRecord,
  OpportunityVersion,
  OriginalText,
  RequirementEvidence,
  RequirementFact,
  SourceOccurrenceVersion
} from "../domain";

export interface RequirementParsingInput {
  readonly opportunity_version: OpportunityVersion;
  readonly source_occurrence_versions: readonly SourceOccurrenceVersion[];
  readonly extracted_records: readonly ExtractedRecord[];
}

export const REQUIREMENT_PARSE_WARNING_CODES = [
  "NO_REQUIREMENT_TEXT",
  "NORMALIZED_TEXT_MISSING",
  "TRACEABILITY_SOURCE_MISSING",
  "CLAUSE_ALIGNMENT_FAILED",
  "UNPARSED_CLAUSE",
  "AMBIGUOUS_EDUCATION_SCOPE",
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
  readonly warnings: readonly RequirementParseWarning[];
  readonly parser_version: string;
}
