import type {
  IsoDateTime,
  LegalEmploymentRelevanceAssessmentId,
  OpportunityCandidateId,
  OpportunityVersionId,
  PositionId,
  PositionVersionId,
  PresentationDecisionId,
  PresentationReadModelId,
  RecallDispositionId
} from "./primitives";

export const PRESENTATION_DECISION_SCHEMA_VERSION =
  "presentation-decision/1.0.0" as const;
export const PRESENTATION_POLICY_V1_ID =
  "approved-presentation-policy" as const;
export const PRESENTATION_POLICY_V1_VERSION = "1.0.0" as const;
export const PRESENTATION_READ_MODEL_SCHEMA_VERSION =
  "presentation-read-model/1.0.0" as const;

export const PRESENTATION_DECISION_STATUSES = [
  "DISPLAY",
  "DISPLAY_WITH_REVIEW",
  "EVIDENCE_BLOCKED",
  "NOT_DISPLAY"
] as const;

export type PresentationDecisionStatus =
  (typeof PRESENTATION_DECISION_STATUSES)[number];

export interface PresentationDecisionV1 {
  readonly presentation_decision_id: PresentationDecisionId;
  readonly opportunity_candidate_id: OpportunityCandidateId;
  readonly recall_disposition_id: RecallDispositionId;
  readonly recall_disposition_integrity_hash: string;
  readonly relevance_assessment_id: LegalEmploymentRelevanceAssessmentId | null;
  readonly relevance_integrity_hash: string | null;
  readonly opportunity_version_id: OpportunityVersionId | null;
  readonly position_id: PositionId | null;
  readonly position_version_id: PositionVersionId | null;
  readonly source_composition_id: string | null;
  readonly source_composition_hash: string | null;
  readonly requirement_set_version_id: string | null;
  readonly eligibility_assessment_id: string | null;
  readonly eligibility_integrity_hash: string | null;
  readonly eligibility_assessment_scope: "PRODUCTION" | "SYNTHETIC_TEST" | null;
  readonly policy_id: typeof PRESENTATION_POLICY_V1_ID;
  readonly policy_version: typeof PRESENTATION_POLICY_V1_VERSION;
  readonly status: PresentationDecisionStatus;
  readonly reason_codes: readonly string[];
  readonly decision_basis: {
    readonly recall_status: string;
    readonly relevance_state: string | null;
    readonly eligibility_result: string | null;
    readonly candidate_source_binding: "BOUND" | "UNBOUND" | "NOT_APPLICABLE";
    readonly approved_exclusion: boolean;
  };
  readonly revision: number;
  readonly supersedes_presentation_decision_id: PresentationDecisionId | null;
  readonly decided_at: IsoDateTime;
  readonly schema_version: typeof PRESENTATION_DECISION_SCHEMA_VERSION;
  readonly integrity_hash: string;
}

export const PRESENTATION_DECISION_V2_SCHEMA_VERSION = "presentation-decision/2.0.0" as const;
export const PRESENTATION_SEMANTIC_PROJECTION_VERSION = "presentation-semantic-projection/2.0.0" as const;
export const PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION = "presentation-read-model/2.0.0" as const;
export type PresentationScope = "PRODUCTION" | "SYNTHETIC_TEST";
export type PresentationSemanticValue = null | string | number | boolean
  | readonly PresentationSemanticValue[]
  | { readonly [key: string]: PresentationSemanticValue };
export type PresentationSemanticField =
  | { readonly state: "AVAILABLE"; readonly value: PresentationSemanticValue }
  | { readonly state: "NOT_YET_AVAILABLE"; readonly reason_code: string };
export interface PresentationSemanticRequirementSummary {
  readonly dimension: string;
  readonly operator: string;
  readonly value: PresentationSemanticValue;
  readonly subject_scope: string;
  readonly polarity: string;
  readonly certainty: string;
  readonly applicability: PresentationSemanticValue;
  readonly parser_version: string;
}
export interface PresentationSemanticDisplay {
  readonly employer: PresentationField<string>;
  readonly position_title: PresentationField<string>;
  readonly locations: PresentationField<readonly string[]>;
  readonly recruitment_year: PresentationField<number>;
  readonly recruitment_batch: PresentationField<string>;
  readonly announcement_link: PresentationField<string>;
  readonly application_link: PresentationField<string>;
  readonly requirement_summary: PresentationField<readonly PresentationSemanticRequirementSummary[]>;
  readonly effective_at: PresentationField<IsoDateTime>;
}
export interface PresentationSemanticProjectionV2 {
  readonly projection_version: typeof PRESENTATION_SEMANTIC_PROJECTION_VERSION;
  readonly scope: PresentationScope;
  readonly subject: {
    readonly position_id: PositionId;
    readonly identity_state: string;
    readonly identity_hash: string;
    readonly identity_resolver_version: string;
  };
  readonly policy: { readonly policy_id: string; readonly policy_version: string };
  readonly decision: {
    readonly status: PresentationDecisionStatus;
    readonly reason_codes: readonly string[];
    readonly decision_basis: PresentationDecisionV1["decision_basis"];
    readonly approved_exclusion: PresentationSemanticValue;
  };
  readonly relevance: PresentationSemanticField;
  readonly eligibility: PresentationSemanticField;
  readonly requirement: PresentationSemanticField;
  readonly source_trust: PresentationSemanticField;
  readonly display: PresentationSemanticDisplay;
}
interface PresentationDecisionV2Base extends Omit<PresentationDecisionV1,
  "schema_version" | "revision" | "supersedes_presentation_decision_id"> {
  readonly schema_version: typeof PRESENTATION_DECISION_V2_SCHEMA_VERSION;
  readonly scope: PresentationScope;
}
export interface PositionPresentationDecisionV2 extends PresentationDecisionV2Base {
  readonly record_kind: "POSITION_PRESENTATION";
  readonly public_series_member: true;
  readonly position_id: PositionId;
  readonly revision: number;
  readonly supersedes_presentation_decision_id: PresentationDecisionId | null;
  readonly semantic_projection: PresentationSemanticProjectionV2;
  readonly semantic_hash: string;
  readonly origin: "PRODUCTION_FIRST" | "V1_MIGRATION";
  readonly migration_id: string | null;
}
export interface UnboundPresentationDecisionV2 extends PresentationDecisionV2Base {
  readonly record_kind: "UNBOUND_RETAINED_OUTCOME";
  readonly public_series_member: false;
  readonly position_id: null;
  readonly revision: null;
  readonly supersedes_presentation_decision_id: null;
}
export type PresentationDecision = PresentationDecisionV1
  | PositionPresentationDecisionV2 | UnboundPresentationDecisionV2;

export interface PresentationV1MigrationReference {
  readonly presentation_decision_id: PresentationDecisionId;
  readonly integrity_hash: string;
  readonly envelope_integrity_hash: string;
  readonly issuance_sequence: number;
}
export interface PresentationMigrationAudit {
  readonly migration_id: string;
  readonly schema_version: "presentation-v1-migration/2.0.0";
  readonly scope: PresentationScope;
  readonly position_id: PositionId;
  readonly anchored_input_head: string;
  readonly inventory: readonly PresentationV1MigrationReference[];
  readonly classification: "EQUIVALENT" | "BLOCKED";
  readonly reason_code: string;
  readonly primary_issuance_sequence: number | null;
  readonly output_decision_id: PresentationDecisionId | null;
  readonly output_decision_integrity_hash: string | null;
  readonly semantic_hash: string | null;
  readonly actor: string;
  readonly created_at: IsoDateTime;
  readonly integrity_hash: string;
}

export type PresentationField<Value> =
  | { readonly state: "AVAILABLE"; readonly value: Value }
  | { readonly state: "NOT_YET_AVAILABLE"; readonly reason: string };

export interface PresentationRequirementSummary {
  readonly requirement_fact_id: string;
  readonly dimension: string;
  readonly subject_scope: string;
  readonly polarity: string;
  readonly certainty: string;
}

export interface PresentationReadModelV1 {
  readonly presentation_read_model_id: PresentationReadModelId;
  readonly presentation_decision_id: PresentationDecisionId;
  readonly opportunity_candidate_id: OpportunityCandidateId;
  readonly decision_revision: number;
  readonly presentation_status: PresentationDecisionStatus;
  readonly reason_codes: readonly string[];
  readonly policy_id: typeof PRESENTATION_POLICY_V1_ID;
  readonly policy_version: typeof PRESENTATION_POLICY_V1_VERSION;
  readonly opportunity_version_id: OpportunityVersionId | null;
  readonly position_id: PositionId | null;
  readonly position_version_id: PositionVersionId | null;
  readonly employer: PresentationField<string>;
  readonly position_title: PresentationField<string>;
  readonly locations: PresentationField<readonly string[]>;
  readonly recruitment_year: PresentationField<number>;
  readonly recruitment_batch: PresentationField<string>;
  readonly announcement_link: PresentationField<string>;
  readonly application_link: PresentationField<string>;
  readonly requirement_summary: PresentationField<
    readonly PresentationRequirementSummary[]
  >;
  readonly updated_at: IsoDateTime;
  readonly effective_at: PresentationField<IsoDateTime>;
  readonly upstream: {
    readonly decision_integrity_hash: string;
    readonly recall_disposition_id: RecallDispositionId;
    readonly recall_disposition_integrity_hash: string;
    readonly relevance_assessment_id: LegalEmploymentRelevanceAssessmentId | null;
    readonly relevance_integrity_hash: string | null;
    readonly requirement_set_version_id: string | null;
    readonly eligibility_assessment_id: string | null;
    readonly eligibility_integrity_hash: string | null;
    readonly eligibility_assessment_scope: "PRODUCTION" | "SYNTHETIC_TEST" | null;
    readonly source_composition_id: string | null;
    readonly source_composition_hash: string | null;
    readonly opportunity_version_semantic_hash: string | null;
    readonly opportunity_version_integrity_hash: string | null;
    readonly position_version_semantic_hash: string | null;
    readonly position_version_integrity_hash: string | null;
    readonly source_occurrence_version_ids: readonly string[];
  };
  readonly schema_version: typeof PRESENTATION_READ_MODEL_SCHEMA_VERSION;
  readonly integrity_hash: string;
}

interface PresentationReadModelV2Base extends Omit<PresentationReadModelV1,
  "schema_version" | "decision_revision" | "requirement_summary"> {
  readonly schema_version: typeof PRESENTATION_READ_MODEL_V2_SCHEMA_VERSION;
  readonly scope: PresentationScope;
  readonly requirement_summary: PresentationField<readonly PresentationSemanticRequirementSummary[]>;
}
export interface PositionPresentationReadModelV2 extends PresentationReadModelV2Base {
  readonly record_kind: "POSITION_PRESENTATION";
  readonly public_series_member: true;
  readonly position_id: PositionId;
  readonly decision_revision: number;
  readonly semantic_hash: string;
}
export interface UnboundPresentationReadModelV2 extends PresentationReadModelV2Base {
  readonly record_kind: "UNBOUND_RETAINED_OUTCOME";
  readonly public_series_member: false;
  readonly position_id: null;
  readonly decision_revision: null;
}
export type PresentationReadModel = PresentationReadModelV1
  | PositionPresentationReadModelV2 | UnboundPresentationReadModelV2;
