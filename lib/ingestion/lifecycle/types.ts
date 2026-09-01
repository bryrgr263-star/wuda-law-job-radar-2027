import type {
  IsoDateTime,
  LifecycleEvent,
  RecruitmentEndpointId,
  Snapshot,
  SnapshotId,
  SourceDefinitionId,
  SourceOccurrence,
  SourceOccurrenceId
} from "../domain";

declare const sourceRunBrand: unique symbol;

export type SourceRunId = string & {
  readonly [sourceRunBrand]: "SourceRunId";
};

export const SOURCE_RUN_STATUSES = [
  "SUCCESS",
  "CONFIRMED_EMPTY",
  "NOT_MODIFIED",
  "PARTIAL",
  "SUSPICIOUS_EMPTY",
  "FAILED"
] as const;

export type SourceRunStatus = (typeof SOURCE_RUN_STATUSES)[number];

export type CollectionCompletenessStatus =
  | "COMPLETE"
  | "PARTIAL"
  | "FAILED"
  | "SUSPICIOUS_EMPTY";

export interface CollectionCompletenessAssessment {
  readonly status: CollectionCompletenessStatus;
  readonly reason_codes: readonly string[];
}

export type HistoricalEmptyComparison =
  | "CONSISTENT"
  | "ANOMALOUS"
  | "UNAVAILABLE";

export interface EmptyResultValidation {
  readonly response_structure_valid: boolean;
  readonly pagination_complete: boolean;
  readonly explicit_empty_signal: boolean;
  readonly official_result_count: number | null;
  readonly authentication_wall_detected: boolean;
  readonly captcha_detected: boolean;
  readonly error_page_detected: boolean;
  readonly structure_drift_detected: boolean;
  readonly historical_comparison: HistoricalEmptyComparison;
}

export interface SourceRunObservation {
  readonly source_run_id: SourceRunId;
  readonly source_definition_id: SourceDefinitionId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly started_at: IsoDateTime;
  readonly completed_at: IsoDateTime;
  readonly snapshots: readonly Snapshot[];
  readonly collection_completeness: CollectionCompletenessAssessment;
  readonly observed_source_occurrence_ids: readonly SourceOccurrenceId[];
  readonly not_modified: boolean;
  readonly empty_result_validation?: EmptyResultValidation;
}

export const SOURCE_RUN_REASON_CODES = [
  "COMPLETE_NON_EMPTY",
  "CONFIRMED_EMPTY_EVIDENCE",
  "NOT_MODIFIED_CONFIRMED",
  "NO_SNAPSHOTS",
  "TRANSPORT_FAILED",
  "COLLECTION_FAILED",
  "COLLECTION_PARTIAL",
  "COLLECTION_STATUS_CONTRADICTS_RECORDS",
  "ZERO_RESULT_REQUIRES_VALIDATION",
  "EMPTY_RESPONSE_STRUCTURE_INVALID",
  "EMPTY_PAGINATION_INCOMPLETE",
  "EMPTY_SIGNAL_MISSING",
  "EMPTY_AUTHENTICATION_WALL_DETECTED",
  "EMPTY_CAPTCHA_DETECTED",
  "EMPTY_ERROR_PAGE_DETECTED",
  "EMPTY_STRUCTURE_DRIFT_DETECTED",
  "EMPTY_HISTORY_ANOMALOUS",
  "EMPTY_HISTORY_UNAVAILABLE"
] as const;

export type SourceRunReasonCode =
  (typeof SOURCE_RUN_REASON_CODES)[number];

export interface SourceRunAssessment {
  readonly source_run_id: SourceRunId;
  readonly source_definition_id: SourceDefinitionId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly status: SourceRunStatus;
  readonly reason_codes: readonly SourceRunReasonCode[];
  readonly collection_reason_codes: readonly string[];
  readonly snapshot_ids: readonly SnapshotId[];
  readonly observed_source_occurrence_ids: readonly SourceOccurrenceId[];
  readonly missing_updates_allowed: boolean;
  readonly completed_at: IsoDateTime;
}

export interface MissingGuardInput {
  readonly source_run: SourceRunAssessment;
  readonly known_source_occurrences: readonly SourceOccurrence[];
  readonly previous_missing_streaks: Readonly<
    Partial<Record<SourceOccurrenceId, number>>
  >;
}

export const MISSING_DECISION_KINDS = [
  "OBSERVED_RESET",
  "MISSING_RECORDED",
  "PROTECTED_BY_RUN_STATUS"
] as const;

export type MissingDecisionKind = (typeof MISSING_DECISION_KINDS)[number];

export interface MissingGuardDecision {
  readonly source_occurrence_id: SourceOccurrenceId;
  readonly decision: MissingDecisionKind;
  readonly previous_missing_streak: number;
  readonly next_missing_streak: number;
  readonly lifecycle_event: LifecycleEvent | null;
}

export interface MissingGuardResult {
  readonly source_run_id: SourceRunId;
  readonly decisions: readonly MissingGuardDecision[];
  readonly lifecycle_events: readonly LifecycleEvent[];
}
