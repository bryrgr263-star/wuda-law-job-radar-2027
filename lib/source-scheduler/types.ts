import type {
  LiveCanaryManualAuthorization,
  SourceAdmission
} from "../application/source-admission";
import type { CollectionRunRuntimeResult } from "../collection-runtime";
import type {
  ExtractedRecord,
  IsoDateTime,
  RecruitmentEndpoint,
  Snapshot
} from "../ingestion";

export const SCHEDULE_FREQUENCIES = [
  "SIX_HOURS",
  "TWELVE_HOURS",
  "DAILY",
  "THREE_DAYS",
  "WEEKLY"
] as const;

export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const SOURCE_SCHEDULE_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "REVIEW_REQUIRED",
  "FAILED",
  "DISABLED"
] as const;

export type SourceScheduleStatus = (typeof SOURCE_SCHEDULE_STATUSES)[number];

export interface CollectionSchedulePolicy {
  readonly frequency: ScheduleFrequency;
  readonly minimum_interval_ms: number;
}

export interface SourceSchedule {
  readonly schedule_id: string;
  readonly source_admission_id: SourceAdmission["source_admission_id"];
  readonly recruitment_endpoint_id: RecruitmentEndpoint["recruitment_endpoint_id"];
  readonly enabled: boolean;
  readonly frequency: ScheduleFrequency;
  readonly minimum_interval_ms: number;
  readonly next_run_at: IsoDateTime;
  readonly last_run_at: IsoDateTime | null;
  readonly failure_count: number;
  readonly status: SourceScheduleStatus;
}

export interface SourceSchedulingEligibility {
  readonly allowed: boolean;
  readonly requires_manual_authorization: boolean;
  readonly reason_code: string | null;
}

export interface ScheduledCollectionDispatch {
  readonly schedule_id: string;
  readonly collection_run_id: string;
  readonly source_admission_id: SourceAdmission["source_admission_id"];
  readonly recruitment_endpoint_id: RecruitmentEndpoint["recruitment_endpoint_id"];
  readonly endpoint: string;
  readonly scheduled_at: IsoDateTime;
  readonly requires_manual_authorization: boolean;
  readonly manual_authorization: LiveCanaryManualAuthorization | null;
  readonly authorization_id: LiveCanaryManualAuthorization["authorization_id"] | null;
}

export interface CollectionRunAuditView {
  readonly collection_run_id: string;
  readonly source_admission_id: SourceAdmission["source_admission_id"];
  readonly recruitment_endpoint_id: RecruitmentEndpoint["recruitment_endpoint_id"];
  readonly started_at: IsoDateTime;
  readonly completed_at: IsoDateTime;
  readonly status: CollectionRunRuntimeResult["status"];
  readonly request_count: number;
  readonly page_count: number;
  readonly bytes: number;
  readonly retry_count: number;
  readonly error_classifications: readonly string[];
}

export const SOURCE_HEALTH_STATUSES = [
  "HEALTHY",
  "DEGRADED",
  "FAILED",
  "REVIEW_REQUIRED"
] as const;

export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];

export interface SourceHealth {
  readonly source_admission_id: SourceAdmission["source_admission_id"];
  readonly recruitment_endpoint_id: RecruitmentEndpoint["recruitment_endpoint_id"];
  readonly consecutive_success: number;
  readonly consecutive_failure: number;
  readonly last_success: IsoDateTime | null;
  readonly last_failure: IsoDateTime | null;
  readonly last_http_status: number | null;
  readonly last_content_hash: string | null;
  readonly structure_change_detected: boolean;
  readonly robots_status: SourceAdmission["robots"]["status"];
  readonly terms_status: SourceAdmission["terms"]["status"];
  readonly status: SourceHealthStatus;
}

export interface SourceHealthUpdateInput {
  readonly admission: SourceAdmission;
  readonly previous: SourceHealth | null;
  readonly run: CollectionRunRuntimeResult;
  readonly structure_change_detected: boolean;
}

export const PAGE_SNAPSHOT_DIFF_STATUSES = [
  "NO_PREVIOUS",
  "UNCHANGED",
  "CHANGED",
  "CURRENT_UNAVAILABLE"
] as const;

export type PageSnapshotDiffStatus = (typeof PAGE_SNAPSHOT_DIFF_STATUSES)[number];

export interface PageSnapshotDiff {
  readonly status: PageSnapshotDiffStatus;
  readonly previous_snapshot_id: Snapshot["snapshot_id"] | null;
  readonly current_snapshot_id: Snapshot["snapshot_id"];
  readonly previous_content_hash: string | null;
  readonly current_content_hash: string | null;
}

export const INCREMENTAL_RECORD_STATUSES = [
  "NEW",
  "UPDATED",
  "UNCHANGED",
  "MISSING_OBSERVED",
  "IDENTITY_UNCERTAIN"
] as const;

export type IncrementalRecordStatus = (typeof INCREMENTAL_RECORD_STATUSES)[number];

export interface IncrementalRecordDiff {
  readonly status: IncrementalRecordStatus;
  readonly identity_fingerprint: string | null;
  readonly content_fingerprint: string | null;
  readonly previous_extracted_record_id: ExtractedRecord["extracted_record_id"] | null;
  readonly current_extracted_record_id: ExtractedRecord["extracted_record_id"] | null;
  readonly reason_code: string | null;
}

export interface SnapshotRecordSet {
  readonly snapshot: Snapshot;
  readonly records: readonly ExtractedRecord[];
}

export interface IncrementalDiscoveryInput {
  readonly previous: SnapshotRecordSet | null;
  readonly current: SnapshotRecordSet;
}

export interface IncrementalDiscoveryResult {
  readonly page_diff: PageSnapshotDiff;
  readonly record_diffs: readonly IncrementalRecordDiff[];
  readonly missing_observation_complete: boolean;
}
