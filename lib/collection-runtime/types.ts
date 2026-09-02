import type {
  AdapterRequestPlan,
  ExtractedRecord,
  IsoDateTime,
  RawBlob,
  Snapshot,
  TransportRequest,
  TransportResponse
} from "../ingestion";

export const COLLECTION_RUN_STATUSES = [
  "SUCCESS",
  "PARTIAL",
  "FAILED",
  "SUSPICIOUS_EMPTY"
] as const;

export type CollectionRunStatus = (typeof COLLECTION_RUN_STATUSES)[number];

export const COLLECTION_RUN_RUNTIME_STATES = [
  "CREATED",
  "RUNNING",
  "COMPLETED"
] as const;

export type CollectionRunRuntimeState =
  (typeof COLLECTION_RUN_RUNTIME_STATES)[number];

export const COLLECTION_RUN_REASON_CODES = [
  "COMPLETE_NON_EMPTY",
  "ZERO_EXTRACTED_RECORDS",
  "TRANSPORT_FAILED",
  "RETRIED_TRANSPORT_FAILURE",
  "MAX_PAGES_REACHED",
  "REQUEST_BUDGET_EXHAUSTED",
  "REPEATED_PAGE_BLOCKED",
  "MALFORMED_NEXT_PAGE",
  "ADAPTER_EXTRACTION_FAILED",
  "ADAPTER_REPORTED_PARTIAL"
] as const;

export type CollectionRunReasonCode =
  (typeof COLLECTION_RUN_REASON_CODES)[number];

export interface HttpTransportRequest extends TransportRequest {
  readonly timeout_ms: number;
  readonly body?: Uint8Array;
}

export interface HttpTransport {
  execute(request: HttpTransportRequest): Promise<TransportResponse>;
}

export interface CollectionRuntimeClock {
  now(): IsoDateTime;
  now_ms(): number;
  sleep(delay_ms: number): Promise<void>;
}

export interface CollectionRuntimePolicy {
  readonly timeout_ms: number;
  readonly retry_limit: number;
  readonly retry_backoff_ms: number;
  readonly rate_limit_ms: number;
  readonly max_pages: number;
  readonly request_budget: number;
}

export interface CollectionRequestResult {
  readonly plan: AdapterRequestPlan;
  readonly attempt: number;
  readonly request: TransportRequest;
  readonly response: TransportResponse;
  readonly snapshot: Snapshot;
  readonly raw_blob: RawBlob | null;
}

export interface CollectionRunRuntimeResult {
  readonly collection_run_id: string;
  readonly source_definition_id: string;
  readonly recruitment_endpoint_id: string;
  readonly started_at: IsoDateTime;
  readonly completed_at: IsoDateTime;
  readonly status: CollectionRunStatus;
  readonly runtime_states: readonly CollectionRunRuntimeState[];
  readonly reason_codes: readonly CollectionRunReasonCode[];
  readonly request_results: readonly CollectionRequestResult[];
  readonly snapshots: readonly Snapshot[];
  readonly raw_blobs: readonly RawBlob[];
  readonly extracted_records: readonly ExtractedRecord[];
  readonly pages_collected: number;
  readonly requests_made: number;
}
