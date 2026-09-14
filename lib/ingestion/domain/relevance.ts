import type {
  ExtractedRecordId,
  IsoDateTime,
  LegalEmploymentRelevanceAssessmentId,
  LegalEmploymentRelevanceFindingId,
  OpportunityVersionId,
  PositionId,
  PositionVersionId,
  SnapshotId,
  SourceCompositionEvidenceId,
  SourceCompositionHash,
  SourceCompositionManifestHash,
  SourceCompositionResultId,
  SourceOccurrenceVersionId,
  SourceSurfaceId
} from "./primitives";
import type { EvidenceLocator } from "./requirements";

export const LEGAL_EMPLOYMENT_RELEVANCE_STATES = [
  "RELEVANT",
  "POSSIBLY_RELEVANT",
  "REVIEW_REQUIRED",
  "EVIDENCE_BLOCKED",
  "NOT_RELEVANT"
] as const;

export const LEGAL_EMPLOYMENT_RELEVANCE_SCHEMA_VERSION =
  "legal-employment-relevance-assessment/1.0.0" as const;
export const LEGAL_EMPLOYMENT_RELEVANCE_TAXONOMY_VERSION =
  "legal-employment-relevance-taxonomy/1.0.0" as const;
export const LEGAL_EMPLOYMENT_RELEVANCE_MATERIALIZATION_VERSION =
  "legal-employment-relevance-materialization/1.0.0" as const;

export type LegalEmploymentRelevanceState =
  (typeof LEGAL_EMPLOYMENT_RELEVANCE_STATES)[number];

export type LegalEmploymentRelevanceFindingKind =
  | "DIRECT_LEGAL_FUNCTION"
  | "LEGAL_MAJOR_REQUIREMENT"
  | "LEGAL_QUALIFICATION_REQUIREMENT"
  | "LEGAL_ADJACENT_FUNCTION"
  | "CLEAR_NON_LEGAL_FUNCTION"
  | "EVIDENCE_GAP"
  | "MATERIAL_CONFLICT";

export interface LegalEmploymentRelevanceFinding {
  readonly finding_id: LegalEmploymentRelevanceFindingId;
  readonly finding_kind: LegalEmploymentRelevanceFindingKind;
  readonly semantic_code: string;
  readonly source_surface_id: SourceSurfaceId | null;
  readonly source_composition_evidence_id: SourceCompositionEvidenceId | null;
  readonly source_occurrence_version_id: SourceOccurrenceVersionId | null;
  readonly snapshot_id: SnapshotId | null;
  readonly extracted_record_id: ExtractedRecordId | null;
  readonly locator: EvidenceLocator | null;
  readonly original_text: string | null;
}

export type RelevanceCoverageState =
  | "CLOSED"
  | "INCOMPLETE"
  | "EVIDENCE_BLOCKED"
  | "CONFLICT";

export type RelevancePositionBindingState =
  | "TRUSTED"
  | "UNKNOWN"
  | "CONFLICT";

export type RelevanceEvidenceState = "PRESENT" | "ABSENT" | "UNKNOWN";
export type RelevanceNonLegalFunctionState = "CLEAR" | "NOT_CLEAR" | "UNKNOWN";
export type RelevanceMaterialConflictState = "NONE" | "PRESENT";

export interface LegalEmploymentRelevanceDecisionBasis {
  readonly position_binding: RelevancePositionBindingState;
  readonly direct_legal_evidence: RelevanceEvidenceState;
  readonly legal_major_evidence: RelevanceEvidenceState;
  readonly legal_qualification_evidence: RelevanceEvidenceState;
  readonly legal_adjacent_evidence: RelevanceEvidenceState;
  readonly non_law_function: RelevanceNonLegalFunctionState;
  readonly material_conflict: RelevanceMaterialConflictState;
  readonly evidence_gap_codes: readonly string[];
}

export interface LegalEmploymentRelevanceAssessment {
  readonly assessment_id: LegalEmploymentRelevanceAssessmentId;
  readonly position_id: PositionId;
  readonly position_version_id: PositionVersionId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly source_composition_id: SourceCompositionResultId;
  readonly source_composition_hash: SourceCompositionHash;
  readonly source_composition_manifest_hash: SourceCompositionManifestHash;
  readonly source_occurrence_version_ids: readonly SourceOccurrenceVersionId[];
  readonly assessment_state: LegalEmploymentRelevanceState;
  readonly evidence_ids: readonly SourceCompositionEvidenceId[];
  readonly findings: readonly LegalEmploymentRelevanceFinding[];
  readonly coverage_state: RelevanceCoverageState;
  readonly decision_basis: LegalEmploymentRelevanceDecisionBasis;
  readonly assessment_version: number;
  readonly taxonomy_version:
    typeof LEGAL_EMPLOYMENT_RELEVANCE_TAXONOMY_VERSION;
  readonly materialization_version:
    typeof LEGAL_EMPLOYMENT_RELEVANCE_MATERIALIZATION_VERSION;
  readonly schema_version: typeof LEGAL_EMPLOYMENT_RELEVANCE_SCHEMA_VERSION;
  readonly created_at: IsoDateTime;
  readonly integrity_hash: string;
}
