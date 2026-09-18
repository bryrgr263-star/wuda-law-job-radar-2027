import type {
  AnnouncementId,
  AnnouncementVersionId,
  CandidateCredentialApplicabilityId,
  CandidateStateApplicabilityId,
  CanonicalOpportunityId,
  ConditionalRequirementBranchSetId,
  ExtractedRecordId,
  IdentityEvidenceId,
  IsoDate,
  IsoDateTime,
  LocationAssignmentId,
  LogicGroupId,
  MajorConnectorObservationId,
  MajorExpressionId,
  MajorIdentityId,
  MajorMatchRelationId,
  MajorSemanticProjectionId,
  NonEmptyReadonlyArray,
  OpportunityVersionId,
  PositionId,
  PositionVersionId,
  RecruitmentBatchId,
  RecruitmentPlanId,
  RecruitmentRevisionRelationId,
  RequirementConditionId,
  RequirementContextBindingId,
  RequirementEvidenceId,
  RequirementEvidenceFragmentId,
  RequirementFactId,
  RequirementPredicateId,
  RequirementLogicNodeId,
  RequirementLogicTreeId,
  RequirementMandatoryRootId,
  RequirementObservationId,
  RequirementSetId,
  RequirementSelectorPredicateId,
  RequirementSourceReferenceId,
  SelectorLogicNodeId,
  SelectorLogicTreeId,
  SnapshotId,
  SourceCompositionHash,
  SourceCompositionManifestHash,
  SourceCompositionResultId,
  SourceExclusionObservationId,
  SourceSurfaceId
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
  "GENDER",
  "MAJOR_SCOPE_RELATIONSHIP",
  "MAJOR_MATCH_RULE",
  "ACADEMIC_DEGREE",
  "AGE",
  "CANDIDATE_COHORT",
  "HOUSEHOLD_REGISTRATION",
  "STUDENT_ORIGIN",
  "CITIZENSHIP_STATUS",
  "SERVICE_OR_ENROLMENT_STATUS",
  "DISQUALIFICATION_RECORD",
  "FORMAL_CLEARANCE_DECISION"
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

export const GENERAL_ELIGIBILITY_REQUIREMENT_DIMENSIONS = [
  "CITIZENSHIP_STATUS",
  "SERVICE_OR_ENROLMENT_STATUS",
  "DISQUALIFICATION_RECORD",
  "FORMAL_CLEARANCE_DECISION"
] as const;

export type GeneralEligibilityRequirementDimension =
  (typeof GENERAL_ELIGIBILITY_REQUIREMENT_DIMENSIONS)[number];

export const GENERAL_ELIGIBILITY_PREDICATE_KINDS = [
  "CITIZENSHIP_EQUALS",
  "CITIZENSHIP_EXCLUDED",
  "STATUS_MUST_BE_ABSENT",
  "STATUS_MUST_BE_PRESENT",
  "DISQUALIFYING_RECORD_ABSENT",
  "FORMAL_CLEARANCE_REQUIRED"
] as const;

export type GeneralEligibilityPredicateKind =
  (typeof GENERAL_ELIGIBILITY_PREDICATE_KINDS)[number];

export const SERVICE_OR_ENROLMENT_STATUS_KINDS = [
  "ACTIVE_DUTY",
  "CURRENT_STUDENT",
  "DIRECTED_TRAINING",
  "SERVICE_OBLIGATION",
  "IN_SERVICE_PROBATION"
] as const;

export type ServiceOrEnrolmentStatusKind =
  (typeof SERVICE_OR_ENROLMENT_STATUS_KINDS)[number];

export const DISQUALIFICATION_RECORD_KINDS = [
  "CRIMINAL_SANCTION",
  "DISCIPLINARY_SANCTION",
  "PUBLIC_EMPLOYMENT_DISMISSAL",
  "RECRUITMENT_INTEGRITY_RECORD",
  "OFFICIAL_SERIOUS_DISHONESTY_RECORD"
] as const;

export type DisqualificationRecordKind =
  (typeof DISQUALIFICATION_RECORD_KINDS)[number];

export type GeneralEligibilityPredicateTarget =
  | {
      readonly kind: "CITIZENSHIP";
      readonly citizenship_code: string;
    }
  | {
      readonly kind: "SERVICE_OR_ENROLMENT_STATUS";
      readonly status: ServiceOrEnrolmentStatusKind;
      readonly reference_date: IsoDate;
    }
  | {
      readonly kind: "DISQUALIFICATION_RECORD";
      readonly record_kind: DisqualificationRecordKind;
      readonly authority: string;
      readonly jurisdiction: string;
      readonly reference_date: IsoDate;
    }
  | {
      readonly kind: "FORMAL_CLEARANCE_DECISION";
      readonly issuer: string;
      readonly decision_kind: string;
      readonly decision_status: string;
      readonly effective_from: IsoDate;
      readonly effective_to?: IsoDate;
    };

export interface RequirementPredicate {
  readonly requirement_predicate_id: RequirementPredicateId;
  readonly dimension: GeneralEligibilityRequirementDimension;
  readonly predicate_kind: GeneralEligibilityPredicateKind;
  readonly target: GeneralEligibilityPredicateTarget;
  readonly temporal_relation:
    | "AS_OF"
    | "DURING"
    | "BEFORE"
    | "AFTER"
    | "ON_OR_BEFORE"
    | "ON_OR_AFTER"
    | "UNRESOLVED";
  readonly source_reference_ids:
    NonEmptyReadonlyArray<RequirementSourceReferenceId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_resolution_state:
    | "RESOLVED"
    | "UNRESOLVED"
    | "UNPARSED"
    | "AMBIGUOUS"
    | "DOMAIN_GAP";
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly schema_version: string;
}

export const CANDIDATE_COHORT_CODES = [
  "FRESH_GRADUATE",
  "NON_FRESH_GRADUATE",
  "CURRENT_STUDENT",
  "OVERSEAS_RETURNING_GRADUATE",
  "SOCIAL_CANDIDATE"
] as const;

export type CandidateCohortCode = (typeof CANDIDATE_COHORT_CODES)[number];

export const GENDER_CODES = ["MALE", "FEMALE", "ANY", "UNKNOWN"] as const;
export const MAJOR_SCOPE_RELATIONSHIP_MODES = [
  "AND",
  "OR",
  "HIGHEST_DEGREE_ONLY",
  "GRADUATE_ONLY",
  "UNDERGRADUATE_ONLY",
  "EITHER_LEVEL"
] as const;
export const MAJOR_MATCH_RULE_KINDS = [
  "EXACT_CODE",
  "EXACT_NAME",
  "CATEGORY",
  "CODE_SET",
  "EXCEPTION_LIST",
  "EXTERNAL_DIRECTORY_REFERENCE"
] as const;

export type GenderCode = (typeof GENDER_CODES)[number];
export type MajorScopeRelationshipMode =
  (typeof MAJOR_SCOPE_RELATIONSHIP_MODES)[number];
export type MajorMatchRuleKind = (typeof MAJOR_MATCH_RULE_KINDS)[number];

export interface AcademicProgramDirectoryReference {
  readonly directory_namespace: string;
  readonly directory_version?: string;
  readonly program_code: string;
  readonly program_label?: NormalizedText;
  readonly program_category?: NormalizedText;
  readonly program_type?: string;
}

export interface AgeBoundary {
  readonly years: number;
  readonly inclusive: boolean;
}

export interface GraduationYearRange {
  readonly start_year: number;
  readonly end_year: number;
  readonly start_inclusive: boolean;
  readonly end_inclusive: boolean;
}

export interface MajorScopeRelationship {
  readonly mode: MajorScopeRelationshipMode;
  readonly undergraduate_scope: "BACHELOR";
  readonly graduate_scope: "GRADUATE";
}

export type MajorMatchRule =
  | {
      readonly kind: "EXACT_CODE" | "EXACT_NAME" | "CATEGORY";
      readonly unresolved_behavior: "REVIEW_REQUIRED";
    }
  | {
      readonly kind: "CODE_SET";
      readonly codes: NonEmptyReadonlyArray<string>;
      readonly unresolved_behavior: "REVIEW_REQUIRED";
    }
  | {
      readonly kind: "EXCEPTION_LIST";
      readonly exception_reference: NormalizedText;
      readonly unresolved_behavior: "REVIEW_REQUIRED";
    }
  | {
      readonly kind: "EXTERNAL_DIRECTORY_REFERENCE";
      readonly directory_namespace: string;
      readonly directory_version?: string;
      readonly unresolved_behavior: "REVIEW_REQUIRED";
    };

export const CR11_MAJOR_EXPRESSION_SEMANTIC_TYPES = [
  "EXACT_IDENTITY",
  "LAW",
  "LAW_FAMILY",
  "LAW_RELATED",
  "ANY_MAJOR",
  "QUALIFICATION_ORIENTED",
  "OTHER_EXPLICIT",
  "UNRESOLVED"
] as const;

export const CR11_MAJOR_SCOPES = [
  "CLOSED",
  "OPEN",
  "UNRESTRICTED",
  "UNRESOLVED"
] as const;

export const CR11_MAJOR_IDENTITY_SEMANTIC_CODES = [
  "LAW_MASTER_NON_LAW",
  "LAW_MASTER_LAW",
  "LAW_NON_LAW",
  "LAW_LAW",
  "LAW_0351",
  "LAW_GENERAL",
  "LAW_STUDIES",
  "LAW_STUDIES_FAMILY",
  "LEGAL_PROGRAM_FAMILY",
  "LAW_RELATED",
  "INTELLECTUAL_PROPERTY",
  "ANY_MAJOR",
  "OTHER_EXPLICIT",
  "NON_LAW",
  "UNRESOLVED"
] as const;

export const CR11_MAJOR_MATCH_RELATION_KINDS = [
  "EXACT_IDENTITY",
  "DIRECTORY_MEMBERSHIP",
  "EXPLICIT_INCLUDED",
  "EXPLICIT_EXCLUDED",
  "UNRESTRICTED",
  "NOT_ESTABLISHED"
] as const;

export type Cr11MajorExpressionSemanticType =
  (typeof CR11_MAJOR_EXPRESSION_SEMANTIC_TYPES)[number];
export type Cr11MajorScope = (typeof CR11_MAJOR_SCOPES)[number];
export type Cr11MajorIdentitySemanticCode =
  (typeof CR11_MAJOR_IDENTITY_SEMANTIC_CODES)[number];
export type Cr11MajorMatchRelationKind =
  (typeof CR11_MAJOR_MATCH_RELATION_KINDS)[number];

export interface MajorDirectoryReference {
  readonly directory_namespace: string;
  readonly directory_version?: string;
  readonly program_code?: string;
  readonly program_label?: NormalizedText;
  readonly category_level?: "DISCIPLINE" | "CATEGORY" | "PROGRAM" | "UNRESOLVED";
}

export interface MajorIdentity {
  readonly major_identity_id: MajorIdentityId;
  readonly semantic_code: Cr11MajorIdentitySemanticCode;
  readonly source_label: OriginalText;
  readonly normalized_label?: NormalizedText;
  readonly identity_kind:
    | "EXACT"
    | "CATEGORY"
    | "DIRECTORY_REFERENCE"
    | "OPEN_REFERENCE"
    | "UNRESTRICTED"
    | "UNRESOLVED";
  readonly directory_reference?: MajorDirectoryReference;
}

export interface MajorExpression {
  readonly major_expression_id: MajorExpressionId;
  readonly raw_expression: OriginalText;
  readonly normalized_expression?: NormalizedText;
  readonly semantic_type: Cr11MajorExpressionSemanticType;
  readonly major_scope: Cr11MajorScope;
  readonly major_identity?: MajorIdentity;
  readonly source_resolution_state: "SOURCE_RESOLVED" | "SOURCE_UNRESOLVED";
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: EvidenceLocator;
  readonly parser_version: string;
  readonly resolver_version: string;
}

export interface Cr11CandidateMajorIdentityDescriptor {
  readonly semantic_code: Cr11MajorIdentitySemanticCode;
  readonly identity_label: OriginalText;
  readonly normalized_label?: NormalizedText;
  readonly credential_level?: "BACHELOR" | "MASTER" | "DOCTOR" | "GRADUATE";
  readonly major_code?: string;
  readonly directory_namespace?: string;
  readonly directory_version?: string;
  readonly provenance_state: "COMPLETE" | "PARTIAL" | "UNKNOWN";
}

export interface MajorMatchRelation {
  readonly major_match_relation_id: MajorMatchRelationId;
  readonly source_major_expression_id: MajorExpressionId;
  readonly target_semantic_type: Cr11MajorExpressionSemanticType;
  readonly target_major_identity?: MajorIdentity;
  readonly target_major_scope: Cr11MajorScope;
  readonly candidate_major_identity: Cr11CandidateMajorIdentityDescriptor;
  readonly candidate_credential_applicability_id:
    CandidateCredentialApplicabilityId;
  readonly relation_kind: Cr11MajorMatchRelationKind;
  readonly relation_state: "ESTABLISHED" | "NOT_ESTABLISHED";
  readonly directory_reference?: MajorDirectoryReference;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: EvidenceLocator;
  readonly evidence_version: string;
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly certainty: "EXPLICIT" | "CORROBORATED" | "UNRESOLVED";
  readonly required_engine_capability: "CR10_MAJOR_MATCH_RELATION_V1";
}

export interface MajorConnectorObservation {
  readonly major_connector_observation_id: MajorConnectorObservationId;
  readonly left_major_expression_id: MajorExpressionId;
  readonly right_major_expression_id: MajorExpressionId;
  readonly raw_connector: OriginalText;
  readonly connector_kind: "OR";
  readonly context: "MAJOR_CANDIDATE_LIST";
  readonly source_resolution_state: "SOURCE_RESOLVED" | "SOURCE_UNRESOLVED";
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: EvidenceLocator;
  readonly parser_version: string;
}

export interface SourceExclusionObservation {
  readonly source_exclusion_observation_id: SourceExclusionObservationId;
  readonly source_major_expression_id: MajorExpressionId;
  readonly excluded_candidate_major_identity: Cr11CandidateMajorIdentityDescriptor;
  readonly candidate_credential_applicability_id:
    CandidateCredentialApplicabilityId;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: EvidenceLocator;
  readonly source_resolution_state: "SOURCE_RESOLVED" | "SOURCE_UNRESOLVED";
  readonly parser_version: string;
  readonly resolver_version: string;
}

export interface Cr11MajorPredicateProjection {
  readonly major_semantic_projection_id: MajorSemanticProjectionId;
  readonly requirement_fact_id: RequirementFactId;
  readonly major_expression: MajorExpression;
  readonly major_match_relations: readonly MajorMatchRelation[];
  readonly candidate_credential_applicability_id:
    CandidateCredentialApplicabilityId;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: EvidenceLocator;
  readonly source_order: number;
  readonly source_resolution_state: "SOURCE_RESOLVED" | "SOURCE_UNRESOLVED";
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly projection_version: string;
  readonly required_engine_capability: "CR10_MAJOR_MATCH_RELATION_V1";
}

export type Cr11CandidateCredentialCompleteness =
  | "COMPLETE"
  | "PARTIAL"
  | "UNKNOWN";

export interface Cr11ExecutionGate {
  readonly status: "NOT_ALLOWED";
  readonly reason: "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY";
  readonly required_engine_capability: "CR10_MAJOR_MATCH_RELATION_V1";
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
      readonly kind: "AGE_RANGE";
      readonly lower_bound?: AgeBoundary;
      readonly upper_bound?: AgeBoundary;
      readonly reference_date: IsoDate;
    }
  | {
      readonly kind: "WORK_EXPERIENCE";
      readonly minimum_years: number;
      readonly maximum_years?: number;
      readonly experience_scope: NormalizedText;
      readonly reference_date?: IsoDate;
      readonly scope_definition: "EXPLICIT" | "UNRESOLVED";
    }
  | {
      readonly kind: "GRADUATION_WINDOW";
      readonly exact_graduation_year?: number;
      readonly graduation_year_range?: GraduationYearRange;
      readonly current_cohort?: CandidateCohortCode;
      readonly cohort_condition?: NormalizedText;
    }
  | {
      readonly kind: "PROFESSIONAL_QUALIFICATION";
      readonly qualification_type: string;
      readonly qualification_class?: string;
      readonly strength: "REQUIRED" | "PREFERRED";
    }
  | {
      readonly kind: "MAJOR_SCOPE_RELATIONSHIP";
      readonly relationship: MajorScopeRelationship;
    }
  | {
      readonly kind: "MAJOR_MATCH_RULE";
      readonly rule: MajorMatchRule;
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
    }
  | {
      readonly kind: "CR11_MAJOR_SEMANTIC";
      readonly projection: Cr11MajorPredicateProjection;
    }
  | {
      readonly kind: "GENERAL_ELIGIBILITY_PREDICATE";
      readonly predicate: RequirementPredicate;
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
  readonly academic_program_directories?: Readonly<Partial<Record<
    "BACHELOR" | "MASTER" | "GRADUATE" | "DOCTOR",
    Omit<AcademicProgramDirectoryReference, "program_code" | "program_label">
  >>>;
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
  readonly original_clause?: OriginalText;
  readonly clause_locator?: EvidenceLocator;
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

export const CR12_LOGIC_MODEL_VERSION = "CR12_STRUCTURED_LOGIC_V1" as const;

export const REQUIREMENT_MODALITIES = [
  "MANDATORY",
  "PREFERRED",
  "OPTIONAL",
  "INFORMATIONAL"
] as const;

export const CR12_ENGINE_CAPABILITIES = [
  "LOGIC_TREE_V1",
  "NOT_V1",
  "MODALITY_V1",
  "CREDENTIAL_APPLICABILITY_V1",
  "CANDIDATE_STATE_APPLICABILITY_V1",
  "CONTEXT_BINDING_V1",
  "SOURCE_REFERENCE_MANIFEST_V1",
  "CONTENT_HASH_MANIFEST_V1",
  "CONDITIONAL_SELECTOR_V1",
  "CR10_MAJOR_MATCH_RELATION_V1",
  "SOURCE_COMPOSITION_GATE_V1",
  "GENERAL_ELIGIBILITY_PREDICATE_V1"
] as const;

export type RequirementModality = (typeof REQUIREMENT_MODALITIES)[number];
export type Cr12EngineCapability = (typeof CR12_ENGINE_CAPABILITIES)[number];
export type Cr12PositiveRequirementOperator = Exclude<
  RequirementOperator,
  "NOT_EQUALS" | "NONE_OF"
>;

export type CandidateCredentialApplicabilityMode =
  | "CANDIDATE_WIDE"
  | "UNDERGRADUATE"
  | "GRADUATE"
  | "HIGHEST_DEGREE"
  | "ANY_DEGREE"
  | "ALL_DEGREES"
  | "SPECIFIC_DEGREE"
  | "EITHER_LEVEL"
  | "UNRESOLVED";

type CandidateCredentialApplicabilityBase = {
  readonly candidate_credential_applicability_id:
    CandidateCredentialApplicabilityId;
  readonly evidence_fragment_ids:
    readonly RequirementEvidenceFragmentId[];
  readonly certainty: "EXPLICIT" | "CORROBORATED" | "UNRESOLVED";
  readonly parser_version: string;
};

export type CandidateCredentialApplicability =
  | (CandidateCredentialApplicabilityBase & {
      readonly mode:
        | "CANDIDATE_WIDE"
        | "UNDERGRADUATE"
        | "GRADUATE"
        | "HIGHEST_DEGREE";
    })
  | (CandidateCredentialApplicabilityBase & {
      readonly mode: "SPECIFIC_DEGREE";
      readonly degree: "BACHELOR" | "MASTER" | "DOCTOR";
    })
  | (CandidateCredentialApplicabilityBase & {
      readonly mode: "ANY_DEGREE" | "ALL_DEGREES" | "EITHER_LEVEL";
      readonly applicable_degrees: NonEmptyReadonlyArray<
        "BACHELOR" | "MASTER" | "DOCTOR" | "GRADUATE"
      >;
    })
  | (CandidateCredentialApplicabilityBase & {
      readonly mode: "UNRESOLVED";
      readonly raw_scope?: OriginalText;
    });

type CandidateStateApplicabilityBase = {
  readonly candidate_state_applicability_id: CandidateStateApplicabilityId;
  readonly evidence_fragment_ids:
    readonly RequirementEvidenceFragmentId[];
  readonly certainty: "EXPLICIT" | "CORROBORATED" | "UNRESOLVED";
  readonly parser_version: string;
};

export type CandidateStateApplicability =
  | (CandidateStateApplicabilityBase & {
      readonly mode: "ALL_CANDIDATES";
    })
  | (CandidateStateApplicabilityBase & {
      readonly mode: "COHORT_ANY_OF" | "COHORT_ALL_OF";
      readonly candidate_cohorts: NonEmptyReadonlyArray<CandidateCohortCode>;
    })
  | (CandidateStateApplicabilityBase & {
      readonly mode: "STATE_SELECTOR";
      readonly selector_logic_tree_id: SelectorLogicTreeId;
    })
  | (CandidateStateApplicabilityBase & {
      readonly mode: "UNRESOLVED";
      readonly raw_scope?: OriginalText;
    });

export type RequirementContextTarget =
  | { readonly kind: "ANNOUNCEMENT"; readonly announcement_id: AnnouncementId }
  | {
      readonly kind: "ANNOUNCEMENT_VERSION";
      readonly announcement_version_id: AnnouncementVersionId;
    }
  | {
      readonly kind: "RECRUITMENT_PLAN";
      readonly recruitment_plan_id: RecruitmentPlanId;
    }
  | {
      readonly kind: "RECRUITMENT_BATCH";
      readonly recruitment_batch_id: RecruitmentBatchId;
    }
  | { readonly kind: "POSITION"; readonly position_id: PositionId }
  | {
      readonly kind: "POSITION_VERSION";
      readonly position_version_id: PositionVersionId;
    }
  | {
      readonly kind: "OPPORTUNITY";
      readonly opportunity_id: CanonicalOpportunityId;
    }
  | {
      readonly kind: "OPPORTUNITY_VERSION";
      readonly opportunity_version_id: OpportunityVersionId;
    }
  | {
      readonly kind: "LOCATION_ASSIGNMENT";
      readonly location_assignment_id: LocationAssignmentId;
    }
  | {
      readonly kind: "REVISION_RELATION";
      readonly recruitment_revision_relation_id: RecruitmentRevisionRelationId;
      readonly affected_target: Exclude<
        RequirementContextTarget,
        { readonly kind: "REVISION_RELATION" } | { readonly kind: "UNRESOLVED" }
      >;
    }
  | { readonly kind: "UNRESOLVED"; readonly raw_target?: OriginalText };

export interface RequirementContextBinding {
  readonly requirement_context_binding_id: RequirementContextBindingId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly source_context_target: RequirementContextTarget;
  readonly effective_targets: NonEmptyReadonlyArray<RequirementContextTarget>;
  readonly scope:
    | "EXACT_TARGET"
    | "EXPLICIT_TARGET_SET"
    | "CONDITIONAL_CONTEXT"
    | "UNRESOLVED";
  readonly state: "RESOLVED" | "UNRESOLVED";
  readonly certainty: "EXPLICIT" | "CORROBORATED" | "UNRESOLVED";
  readonly source_locator: EvidenceLocator;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
  readonly recruitment_revision_relation_id?: RecruitmentRevisionRelationId;
  readonly resolver_version: string;
}

export const CR12_REQUIREMENT_SOURCE_ROLES = [
  "ANNOUNCEMENT_UNIFORM",
  "POSITION_TABLE_ROW",
  "REQUIREMENT_ATTACHMENT",
  "SUPPLEMENT",
  "CORRECTION",
  "REPLACEMENT",
  "DIRECTORY_REFERENCE",
  "OTHER_OFFICIAL_REQUIREMENT_SURFACE",
  "UNRESOLVED"
] as const;

export const CR12_REQUIREMENT_SOURCE_RELATIONSHIPS = [
  "ORIGINAL",
  "SUPPLEMENTS",
  "CORRECTS",
  "REPLACES",
  "SUPERSEDES",
  "REFERENCES",
  "CONFLICTS_WITH",
  "UNRESOLVED"
] as const;

export type Cr12RequirementSourceRole =
  (typeof CR12_REQUIREMENT_SOURCE_ROLES)[number];
export type Cr12RequirementSourceRelationshipKind =
  (typeof CR12_REQUIREMENT_SOURCE_RELATIONSHIPS)[number];

export interface Cr12RequirementSourceRelationship {
  readonly kind: Cr12RequirementSourceRelationshipKind;
  readonly target_source_reference_ids:
    readonly RequirementSourceReferenceId[];
  readonly evidence_fragment_ids:
    readonly RequirementEvidenceFragmentId[];
  readonly resolver_version: string;
}

export interface Cr12RequirementSourceReference {
  readonly requirement_source_reference_id: RequirementSourceReferenceId;
  readonly snapshot_id: SnapshotId;
  readonly extracted_record_id: ExtractedRecordId;
  readonly source_role: Cr12RequirementSourceRole;
  readonly source_context_target: RequirementContextTarget;
  readonly applicable_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly binding_evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
  readonly source_locator: EvidenceLocator;
  readonly source_surface_id?: SourceSurfaceId;
  readonly relationship: Cr12RequirementSourceRelationship;
  readonly binding_state: "RESOLVED" | "UNRESOLVED";
  readonly binding_certainty: "EXPLICIT" | "CORROBORATED" | "UNRESOLVED";
  readonly extractor_version: string;
  readonly parser_version: string;
  readonly resolver_version: string;
}

interface Cr12RequirementLogicNodeBase {
  readonly requirement_logic_node_id: RequirementLogicNodeId;
  readonly requirement_condition_id: RequirementConditionId;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_order: number;
}

export type Cr12RequirementLogicNode =
  | (Cr12RequirementLogicNodeBase & {
      readonly kind: "PREDICATE";
      readonly requirement_fact_id: RequirementFactId;
    })
  | (Cr12RequirementLogicNodeBase & {
      readonly kind: "GROUP";
      readonly operator: "AND" | "OR";
      readonly child_node_ids: NonEmptyReadonlyArray<RequirementLogicNodeId>;
    })
  | (Cr12RequirementLogicNodeBase & {
      readonly kind: "NOT";
      readonly child_node_id: RequirementLogicNodeId;
    });

export interface Cr12RequirementLogicTree {
  readonly requirement_logic_tree_id: RequirementLogicTreeId;
  readonly requirement_condition_id: RequirementConditionId;
  readonly root_node_id: RequirementLogicNodeId;
  readonly nodes: NonEmptyReadonlyArray<Cr12RequirementLogicNode>;
  readonly parser_version: string;
  readonly serialization_version: string;
}

export interface RequirementSelectorPredicate {
  readonly requirement_selector_predicate_id: RequirementSelectorPredicateId;
  readonly conditional_branch_set_id: ConditionalRequirementBranchSetId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly dimension: RequirementDimension;
  readonly operator: Cr12PositiveRequirementOperator;
  readonly value: RequirementValue;
  readonly candidate_credential_applicability_id:
    CandidateCredentialApplicabilityId;
  readonly direct_candidate_cohorts?:
    NonEmptyReadonlyArray<CandidateCohortCode>;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: EvidenceLocator;
  readonly parser_version: string;
  readonly resolution_state: "RESOLVED" | "UNRESOLVED";
}

interface SelectorLogicNodeBase {
  readonly selector_logic_node_id: SelectorLogicNodeId;
  readonly selector_logic_tree_id: SelectorLogicTreeId;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_order: number;
}

export type SelectorLogicNode =
  | (SelectorLogicNodeBase & {
      readonly kind: "SELECTOR_PREDICATE";
      readonly requirement_selector_predicate_id: RequirementSelectorPredicateId;
    })
  | (SelectorLogicNodeBase & {
      readonly kind: "GROUP";
      readonly operator: "AND" | "OR";
      readonly child_node_ids: NonEmptyReadonlyArray<SelectorLogicNodeId>;
    })
  | (SelectorLogicNodeBase & {
      readonly kind: "NOT";
      readonly child_node_id: SelectorLogicNodeId;
    });

export interface SelectorLogicTree {
  readonly selector_logic_tree_id: SelectorLogicTreeId;
  readonly conditional_branch_set_id: ConditionalRequirementBranchSetId;
  readonly root_node_id: SelectorLogicNodeId;
  readonly nodes: NonEmptyReadonlyArray<SelectorLogicNode>;
  readonly parser_version: string;
  readonly serialization_version: string;
}

export interface ConditionalRequirementBranchSet {
  readonly conditional_branch_set_id: ConditionalRequirementBranchSetId;
  readonly requirement_condition_id: RequirementConditionId;
  readonly when_selector_logic_tree_id: SelectorLogicTreeId;
  readonly then_requirement_logic_tree_id: RequirementLogicTreeId;
  readonly else_requirement_logic_tree_id?: RequirementLogicTreeId;
  readonly candidate_credential_applicability_id:
    CandidateCredentialApplicabilityId;
  readonly candidate_state_applicability_id: CandidateStateApplicabilityId;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly branch_semantics_state: "RESOLVED" | "UNRESOLVED";
  readonly source_order: number;
  readonly parser_version: string;
  readonly resolver_version: string;
}

interface Cr12RequirementConditionBase {
  readonly requirement_condition_id: RequirementConditionId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly modality: RequirementModality;
  readonly candidate_credential_applicability_id:
    CandidateCredentialApplicabilityId;
  readonly candidate_state_applicability_id: CandidateStateApplicabilityId;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly source_reference_ids:
    NonEmptyReadonlyArray<RequirementSourceReferenceId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: EvidenceLocator;
  readonly source_order: number;
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly projected_from_legacy_fact_ids: readonly RequirementFactId[];
  readonly projected_from_legacy_evidence_ids: readonly RequirementEvidenceId[];
}

export type Cr12RequirementCondition =
  | (Cr12RequirementConditionBase & {
      readonly resolution_state: "RESOLVED";
      readonly representation_kind: "LOGIC_TREE";
      readonly requirement_logic_tree_id: RequirementLogicTreeId;
    })
  | (Cr12RequirementConditionBase & {
      readonly resolution_state: "RESOLVED";
      readonly representation_kind: "CONDITIONAL_BRANCH_SET";
      readonly conditional_branch_set_id: ConditionalRequirementBranchSetId;
    })
  | (Cr12RequirementConditionBase & {
      readonly resolution_state: "UNRESOLVED";
      readonly representation_kind: "UNRESOLVED";
      readonly blocking_observation_ids:
        NonEmptyReadonlyArray<RequirementObservationId>;
    });

export type RequirementMandatoryRoot =
  | {
      readonly requirement_mandatory_root_id: RequirementMandatoryRootId;
      readonly kind: "EMPTY_CONFIRMED";
      readonly evidence_fragment_ids:
        NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
    }
  | {
      readonly requirement_mandatory_root_id: RequirementMandatoryRootId;
      readonly kind: "SINGLE";
      readonly requirement_condition_id: RequirementConditionId;
    }
  | {
      readonly requirement_mandatory_root_id: RequirementMandatoryRootId;
      readonly kind: "AND";
      readonly requirement_condition_ids:
        NonEmptyReadonlyArray<RequirementConditionId>;
    };

export const CR12_COMPLETENESS_DIAGNOSTIC_CODES = [
  "NOT_OBSERVED",
  "UNPARSED_CLAUSE",
  "DOMAIN_GAP_OBSERVED",
  "LOGIC_CONNECTOR_UNRESOLVED",
  "NEGATION_SCOPE_UNRESOLVED",
  "MODALITY_UNRESOLVED",
  "CREDENTIAL_APPLICABILITY_UNRESOLVED",
  "CANDIDATE_STATE_APPLICABILITY_UNRESOLVED",
  "CONTEXT_BINDING_UNRESOLVED",
  "SOURCE_ROLE_UNRESOLVED",
  "SOURCE_RELATION_UNRESOLVED",
  "CONDITIONAL_SELECTOR_UNRESOLVED",
  "CONDITIONAL_BRANCH_UNRESOLVED",
  "SOURCE_CONFLICT",
  "INVALID_LOGIC_STRUCTURE",
  "EVIDENCE_INCOMPLETE"
] as const;

export type Cr12CompletenessDiagnosticCode =
  (typeof CR12_COMPLETENESS_DIAGNOSTIC_CODES)[number];

export interface Cr12RequirementCompletenessBlocker {
  readonly code: RequirementCompletenessBlockerCode;
  readonly diagnostic_code: Cr12CompletenessDiagnosticCode;
  readonly observation_ids: readonly RequirementObservationId[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
  readonly description: string;
}

export interface Cr12RequirementSetManifest {
  readonly logic_model_version: typeof CR12_LOGIC_MODEL_VERSION;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly source_composition_state: Cr12SourceCompositionState;
  readonly source_composition_reference: SourceCompositionReference | null;
  readonly requirement_mandatory_root_id: RequirementMandatoryRootId;
  readonly requirement_condition_ids: readonly RequirementConditionId[];
  readonly requirement_logic_tree_ids: readonly RequirementLogicTreeId[];
  readonly requirement_logic_node_ids: readonly RequirementLogicNodeId[];
  readonly requirement_fact_ids: readonly RequirementFactId[];
  readonly candidate_credential_applicability_ids:
    readonly CandidateCredentialApplicabilityId[];
  readonly candidate_state_applicability_ids:
    readonly CandidateStateApplicabilityId[];
  readonly requirement_context_binding_ids:
    readonly RequirementContextBindingId[];
  readonly requirement_source_reference_ids:
    readonly RequirementSourceReferenceId[];
  readonly requirement_selector_predicate_ids:
    readonly RequirementSelectorPredicateId[];
  readonly selector_logic_tree_ids: readonly SelectorLogicTreeId[];
  readonly selector_logic_node_ids: readonly SelectorLogicNodeId[];
  readonly conditional_branch_set_ids:
    readonly ConditionalRequirementBranchSetId[];
  readonly evidence_fragment_ids:
    readonly RequirementEvidenceFragmentId[];
  readonly requirement_evidence_ids: readonly RequirementEvidenceId[];
  readonly observation_ids: readonly RequirementObservationId[];
  readonly completeness_blocker_fingerprints: readonly string[];
  readonly snapshot_ids: readonly SnapshotId[];
  readonly extracted_record_ids: readonly ExtractedRecordId[];
  readonly parser_versions: readonly string[];
  readonly extractor_versions: readonly string[];
  readonly resolver_versions: readonly string[];
  readonly required_engine_capabilities: readonly Cr12EngineCapability[];
  readonly gate_version: string;
  readonly serialization_version: string;
}

export const CR12_SOURCE_COMPOSITION_STATES = [
  "COMPOSITION_BACKED",
  "LEGACY_UNCOMPOSED"
] as const;

export type Cr12SourceCompositionState =
  (typeof CR12_SOURCE_COMPOSITION_STATES)[number];

export interface SourceCompositionReference {
  readonly source_composition_id: SourceCompositionResultId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly composition_hash: SourceCompositionHash;
  readonly composition_manifest_hash: SourceCompositionManifestHash;
  readonly composition_status: "COMPLETE";
  readonly composition_as_of: IsoDateTime;
  readonly composition_schema_version: string;
  readonly composition_gate_version: string;
}

export interface Cr12RequirementCompleteness {
  readonly status: RequirementCompletenessStatus;
  readonly blockers: readonly Cr12RequirementCompletenessBlocker[];
  readonly manifest: Cr12RequirementSetManifest;
  readonly requirement_set_content_hash: string;
  readonly gate_version: string;
}

export type Cr12ExecutionGateDecision =
  | {
      readonly status: "ALLOWED";
      readonly reason: "ENGINE_CAPABILITIES_SATISFIED";
      readonly required_capabilities: readonly Cr12EngineCapability[];
      readonly supported_capabilities: readonly Cr12EngineCapability[];
    }
  | {
      readonly status: "NOT_ALLOWED";
      readonly reason:
        | "REQUIREMENT_SET_NOT_COMPLETE"
        | "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY";
      readonly required_capabilities: readonly Cr12EngineCapability[];
      readonly supported_capabilities: readonly Cr12EngineCapability[];
      readonly missing_capabilities: readonly Cr12EngineCapability[];
    };

export interface Cr12ExecutionManifest {
  readonly logic_model_version: typeof CR12_LOGIC_MODEL_VERSION;
  readonly required_engine_capabilities:
    NonEmptyReadonlyArray<Cr12EngineCapability>;
  readonly execution_gate: Cr12ExecutionGateDecision;
}

export interface Cr12StructuredRequirementSet {
  readonly logic_model_version: typeof CR12_LOGIC_MODEL_VERSION;
  readonly requirement_set_id: RequirementSetId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly source_composition_state: Cr12SourceCompositionState;
  readonly source_composition_reference: SourceCompositionReference | null;
  readonly mandatory_root: RequirementMandatoryRoot;
  readonly condition_registry: readonly Cr12RequirementCondition[];
  readonly requirement_logic_tree_registry:
    readonly Cr12RequirementLogicTree[];
  readonly fact_registry: readonly RequirementFact[];
  readonly candidate_credential_applicability_registry:
    readonly CandidateCredentialApplicability[];
  readonly candidate_state_applicability_registry:
    readonly CandidateStateApplicability[];
  readonly context_binding_registry: readonly RequirementContextBinding[];
  readonly source_reference_registry:
    readonly Cr12RequirementSourceReference[];
  readonly selector_predicate_registry:
    readonly RequirementSelectorPredicate[];
  readonly selector_logic_tree_registry: readonly SelectorLogicTree[];
  readonly conditional_branch_set_registry:
    readonly ConditionalRequirementBranchSet[];
  readonly evidence_fragment_registry:
    readonly RequirementEvidenceFragment[];
  readonly requirement_evidence_registry: readonly RequirementEvidence[];
  readonly observation_registry: readonly RequirementObservation[];
  readonly completeness: Cr12RequirementCompleteness;
  readonly execution_manifest: Cr12ExecutionManifest;
  readonly parser_version: string;
  readonly resolver_version: string;
}
