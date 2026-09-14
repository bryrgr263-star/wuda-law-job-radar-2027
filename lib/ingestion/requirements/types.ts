import type {
  CandidateCredentialApplicability,
  CandidateStateApplicability,
  Cr11CandidateCredentialCompleteness,
  Cr11CandidateMajorIdentityDescriptor,
  Cr11ExecutionGate,
  Cr11MajorPredicateProjection,
  MajorConnectorObservation,
  MajorExpression,
  MajorMatchRelation,
  CompleteRequirementSet,
  ConditionalRequirementBranchSet,
  Cr12EngineCapability,
  Cr12RequirementCompletenessBlocker,
  Cr12RequirementCondition,
  Cr12RequirementLogicTree,
  Cr12RequirementSourceReference,
  Cr12StructuredRequirementSet,
  ExtractedRecordId,
  NonCompleteRequirementSet,
  NonEmptyReadonlyArray,
  OpportunityVersion,
  OpportunityVersionId,
  OriginalText,
  RequirementConditionId,
  RequirementCompleteness,
  RequirementCompletenessBlockerCode,
  RequirementContextBinding,
  RequirementContextBindingId,
  RequirementEvidence,
  RequirementEvidenceFragment,
  RequirementEvidenceFragmentId,
  RequirementFact,
  RequirementFactId,
  RequirementPredicate,
  RequirementLogicTreeId,
  RequirementMandatoryRoot,
  RequirementObservation,
  RequirementSourceReferenceId,
  SelectorLogicTree,
  SnapshotId,
  SourceCompositionReference,
  SourceCompositionResult
} from "../domain";

export interface SourceCompositionVerifier {
  resolve(reference: SourceCompositionReference): SourceCompositionResult | null;
  verify(result: SourceCompositionResult): SourceCompositionResult;
}

export interface LegacyRequirementSourceReference {
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
}

export type RequirementSourceReference =
  | LegacyRequirementSourceReference
  | Cr12RequirementSourceReference;

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
  "WORK_EXPERIENCE_SCOPE_UNRESOLVED",
  "MAJOR_MATCH_EXCEPTION_REQUIRES_REVIEW",
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

export interface GeneralEligibilityPredicateProjectionInput {
  readonly requirement_fact_id: RequirementFactId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly predicate: RequirementPredicate;
  readonly subject_scope: import("../domain").RequirementSubjectScope;
  readonly logic_group: import("../domain").RequirementLogicGroup;
  readonly polarity: import("../domain").RequirementPolarity;
  readonly certainty: import("../domain").RequirementCertainty;
  readonly candidate_state_applicability_id:
    import("../domain").CandidateStateApplicabilityId;
  readonly context_binding_ids: NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly parser_version: string;
}

export interface GeneralEligibilityClauseClassificationInput {
  readonly original_text: OriginalText;
}

export interface GeneralEligibilityClauseClassification {
  readonly status: "UNPARSED_CLAUSE" | "DOMAIN_GAP_OBSERVED";
  readonly predicate: null;
}

interface Cr12LogicTokenBase {
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_order: number;
}

export type Cr12LogicToken =
  | (Cr12LogicTokenBase & {
      readonly kind: "PREDICATE";
      readonly requirement_fact_id: RequirementFactId;
    })
  | (Cr12LogicTokenBase & {
      readonly kind: "AND" | "OR" | "NOT";
    })
  | (Cr12LogicTokenBase & {
      readonly kind: "LPAREN" | "RPAREN";
    });

export interface Cr12LogicExpressionInput {
  readonly requirement_condition_id: RequirementConditionId;
  readonly requirement_logic_tree_id: RequirementLogicTreeId;
  readonly tokens: NonEmptyReadonlyArray<Cr12LogicToken>;
  readonly parser_version: string;
  readonly serialization_version: string;
}

export type Cr11MajorListContext =
  | "SINGLE_EXPRESSION"
  | "MAJOR_CANDIDATE_LIST"
  | "UNRESOLVED";

export interface Cr11ProfessionalQualificationReference {
  readonly requirement_fact_id: RequirementFactId;
  readonly evidence_fragment_ids: NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
}

export interface Cr11MajorSemanticClassificationInput {
  readonly raw_expression: OriginalText;
  readonly normalized_expression?: import("../domain").NormalizedText;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: import("../domain").EvidenceLocator;
  readonly list_context: Cr11MajorListContext;
  readonly directory_reference?: import("../domain").MajorDirectoryReference;
  readonly professional_qualification?: Cr11ProfessionalQualificationReference;
  readonly parser_version: string;
  readonly resolver_version: string;
}

export type Cr11MajorSemanticClassificationResult =
  | {
      readonly status: "RESOLVED";
      readonly expressions: NonEmptyReadonlyArray<MajorExpression>;
      readonly connector_observations: readonly MajorConnectorObservation[];
    }
  | {
      readonly status: "UNRESOLVED";
      readonly expressions: NonEmptyReadonlyArray<MajorExpression>;
      readonly connector_observations: readonly [];
      readonly diagnostic:
        | "PROTECTED_ATOMIC_SPAN"
        | "MAJOR_LIST_CONTEXT_UNPROVEN"
        | "DIRECTORY_VERSION_UNRESOLVED"
        | "MAJOR_EXPRESSION_UNRESOLVED";
    };

export interface Cr11MajorMatchRelationInput {
  readonly source_major_expression: MajorExpression;
  readonly candidate_major_identity: Cr11CandidateMajorIdentityDescriptor;
  readonly candidate_credential_applicability_id:
    import("../domain").CandidateCredentialApplicabilityId;
  readonly relation_kind: MajorMatchRelation["relation_kind"];
  readonly directory_reference?: import("../domain").MajorDirectoryReference;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: import("../domain").EvidenceLocator;
  readonly evidence_version: string;
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly certainty: MajorMatchRelation["certainty"];
}

export interface Cr11MajorPredicateProjectionInput {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly subject_scope: import("../domain").RequirementSubjectScope;
  readonly candidate_credential_applicability_id:
    import("../domain").CandidateCredentialApplicabilityId;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly expressions: NonEmptyReadonlyArray<MajorExpression>;
  readonly connector_observations: readonly MajorConnectorObservation[];
  readonly major_match_relations?: readonly MajorMatchRelation[];
  readonly source_order: number;
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly projection_version: string;
}

export type Cr11MajorPredicateProjectionResult =
  | {
      readonly status: "RESOLVED";
      readonly projections: NonEmptyReadonlyArray<Cr11MajorPredicateProjection>;
      readonly facts: NonEmptyReadonlyArray<RequirementFact>;
      readonly tokens: NonEmptyReadonlyArray<Cr12LogicToken>;
      readonly execution_gate: Cr11ExecutionGate;
    }
  | {
      readonly status: "UNRESOLVED";
      readonly diagnostic:
        | "SOURCE_SEMANTICS_UNRESOLVED"
        | "CONNECTOR_SEQUENCE_UNRESOLVED"
        | "RELATION_TARGET_MISMATCH";
      readonly execution_gate: Cr11ExecutionGate;
    };

export interface Cr11SourceExclusionProjectionInput {
  readonly source_exclusion_observation: import("../domain").SourceExclusionObservation;
  readonly requirement_fact_id: RequirementFactId;
  readonly source_order: number;
}

export type Cr12LogicExpressionResult =
  | {
      readonly status: "RESOLVED";
      readonly tree: Cr12RequirementLogicTree;
    }
  | {
      readonly status: "UNRESOLVED";
      readonly diagnostic_code:
        | "LOGIC_CONNECTOR_UNRESOLVED"
        | "NEGATION_SCOPE_UNRESOLVED"
        | "INVALID_LOGIC_STRUCTURE";
      readonly message: string;
    };

export type Cr12ConnectorContext =
  | "MAJOR_CANDIDATE_LIST"
  | "GENERAL_REQUIREMENT"
  | "PROTECTED_ATOMIC_SPAN";

export type Cr12ConnectorClassification =
  | { readonly status: "RESOLVED"; readonly kind: "AND" | "OR" }
  | {
      readonly status: "NON_BOOLEAN";
      readonly kind: "LABEL_DELIMITER" | "PROTECTED_CONTENT";
    }
  | { readonly status: "CLAUSE_BOUNDARY" }
  | {
      readonly status: "UNRESOLVED";
      readonly diagnostic_code: "LOGIC_CONNECTOR_UNRESOLVED";
    };

export interface Cr12StructuredRequirementSetInput {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly mandatory_root: RequirementMandatoryRoot;
  readonly conditions: readonly Cr12RequirementCondition[];
  readonly requirement_logic_trees: readonly Cr12RequirementLogicTree[];
  readonly facts: readonly RequirementFact[];
  readonly candidate_credential_applicabilities:
    readonly CandidateCredentialApplicability[];
  readonly candidate_state_applicabilities:
    readonly CandidateStateApplicability[];
  readonly context_bindings: readonly RequirementContextBinding[];
  readonly source_references: readonly Cr12RequirementSourceReference[];
  readonly selector_predicates:
    readonly import("../domain").RequirementSelectorPredicate[];
  readonly selector_logic_trees: readonly SelectorLogicTree[];
  readonly conditional_branch_sets:
    readonly ConditionalRequirementBranchSet[];
  readonly evidence_fragments: readonly RequirementEvidenceFragment[];
  readonly requirement_evidence: readonly RequirementEvidence[];
  readonly observations: readonly RequirementObservation[];
  readonly source_composition_result?: SourceCompositionResult;
  readonly external_blockers?: readonly Cr12RequirementCompletenessBlocker[];
  readonly supported_engine_capabilities?: readonly Cr12EngineCapability[];
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly serialization_version: string;
}

export interface Cr9LegacyProjectionInput {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly requirement_condition_id: RequirementConditionId;
  readonly requirement_logic_tree_id: RequirementLogicTreeId;
  readonly facts: NonEmptyReadonlyArray<RequirementFact>;
  readonly requirement_evidence: NonEmptyReadonlyArray<RequirementEvidence>;
  readonly candidate_credential_applicability_id:
    import("../domain").CandidateCredentialApplicabilityId;
  readonly candidate_state_applicability_id:
    import("../domain").CandidateStateApplicabilityId;
  readonly context_binding_ids:
    NonEmptyReadonlyArray<RequirementContextBindingId>;
  readonly source_reference_ids:
    NonEmptyReadonlyArray<RequirementSourceReferenceId>;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly source_locator: import("../domain").EvidenceLocator;
  readonly source_order: number;
  readonly parser_version: string;
  readonly resolver_version: string;
  readonly serialization_version: string;
}

export interface Cr9LegacyProjectionResult {
  readonly projected_facts: readonly RequirementFact[];
  readonly projected_requirement_evidence: readonly RequirementEvidence[];
  readonly condition: Cr12RequirementCondition;
  readonly tree: Cr12RequirementLogicTree;
}

export interface Cr12StructuredRequirementParsingResult {
  readonly structured_requirement_set: Cr12StructuredRequirementSet;
  readonly complete_requirement_set: null;
}
