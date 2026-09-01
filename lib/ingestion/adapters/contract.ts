import type {
  ContentKind,
  ExtractedRecord,
  RawBlob,
  RecruitmentEndpoint,
  RecruitmentEndpointId,
  Snapshot,
  TransportParameters
} from "../domain";

export const ADAPTER_CAPABILITIES = [
  "SINGLE_PAGE",
  "PAGINATION",
  "HTML_EXTRACTION",
  "JSON_EXTRACTION",
  "DOCUMENT_TEXT_EXTRACTION"
] as const;

export const COMPLETENESS_STATUSES = [
  "COMPLETE",
  "PARTIAL",
  "FAILED",
  "SUSPICIOUS_EMPTY"
] as const;

export type AdapterCapability = (typeof ADAPTER_CAPABILITIES)[number];
export type CompletenessStatus = (typeof COMPLETENESS_STATUSES)[number];

export interface AdapterDescriptor {
  readonly adapter_key: string;
  readonly name: string;
  readonly version: string;
  readonly supported_content_kinds: readonly ContentKind[];
  readonly capabilities: readonly AdapterCapability[];
}

export type EndpointValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly string[] };

export interface AdapterPaginationState {
  readonly page_index: number;
  readonly cursor: string | null;
  readonly visited_locators: readonly string[];
}

export interface AdapterRequestPlan {
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly locator: string;
  readonly method: "GET" | "POST" | "HEAD" | null;
  readonly parameters: TransportParameters;
  readonly pagination_state: AdapterPaginationState;
}

export interface AdapterExtractionInput {
  readonly endpoint: RecruitmentEndpoint;
  readonly snapshot: Snapshot;
  readonly raw_blob: RawBlob | null;
}

export interface AdapterNextPageInput {
  readonly endpoint: RecruitmentEndpoint;
  readonly snapshot: Snapshot;
  readonly pagination_state: AdapterPaginationState;
}

export interface AdapterExtractionErrorSummary {
  readonly snapshot_id: Snapshot["snapshot_id"];
  readonly code: string;
  readonly message: string;
}

export interface AdapterCompletenessInput {
  readonly snapshots: readonly Snapshot[];
  readonly records: readonly ExtractedRecord[];
  readonly extraction_errors: readonly AdapterExtractionErrorSummary[];
}

export interface AdapterCompletenessAssessment {
  readonly status: CompletenessStatus;
  readonly reason_codes: readonly string[];
}

export interface RecruitmentAdapter {
  readonly descriptor: AdapterDescriptor;
  validateEndpoint(endpoint: RecruitmentEndpoint): EndpointValidationResult;
  plan(endpoint: RecruitmentEndpoint): readonly AdapterRequestPlan[];
  extract(input: AdapterExtractionInput): readonly ExtractedRecord[];
  nextPage(input: AdapterNextPageInput): AdapterRequestPlan | null;
  assessCompleteness(input: AdapterCompletenessInput): AdapterCompletenessAssessment;
}
