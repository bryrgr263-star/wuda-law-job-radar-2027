import type {
  ExtractedRecordId,
  IsoDateTime,
  NamespacedAdapterMetadata,
  RawBlobId,
  RawContentSha256,
  RecruitmentEndpointId,
  SnapshotId,
  SourceDefinitionId
} from "./primitives";
import type { HttpRequestMethod } from "./source";
import type { OriginalText } from "./text";

export type TransportScalar = string | number | boolean | null;
export type TransportParameterValue = TransportScalar | readonly TransportScalar[];
export type TransportParameters = Readonly<Record<string, TransportParameterValue>>;
export type TransportHeaders = Readonly<Record<string, string>>;

export interface TransportRequest {
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly locator: string;
  readonly method: HttpRequestMethod | null;
  readonly requested_at: IsoDateTime;
  readonly headers: TransportHeaders;
  readonly parameters: TransportParameters;
}

export interface TransportError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface SuccessfulTransportResponse {
  readonly status: "SUCCESS";
  readonly responded_at: IsoDateTime;
  readonly bytes: Uint8Array;
  readonly content_sha256: RawContentSha256;
  readonly mime_type: string;
  readonly http_status: number | null;
  readonly headers: TransportHeaders;
}

export interface FailedTransportResponse {
  readonly status: "FAILED";
  readonly responded_at: IsoDateTime;
  readonly http_status: number | null;
  readonly headers: TransportHeaders;
  readonly mime_type: string | null;
  readonly error: TransportError;
}

export type TransportResponse = SuccessfulTransportResponse | FailedTransportResponse;

export interface RawBlob {
  readonly raw_blob_id: RawBlobId;
  readonly bytes: Uint8Array;
  readonly raw_content_sha256: RawContentSha256;
  readonly mime_type: string;
  readonly byte_length: number;
  readonly created_at: IsoDateTime;
}

export interface SnapshotRequestMetadata {
  readonly locator: string;
  readonly method: HttpRequestMethod | null;
  readonly requested_at: IsoDateTime;
  readonly headers: TransportHeaders;
  readonly parameters: TransportParameters;
}

export interface SnapshotResponseMetadata {
  readonly http_status: number | null;
  readonly headers: TransportHeaders;
  readonly mime_type: string | null;
  readonly content_length: number | null;
  readonly transport_error: TransportError | null;
}

interface SnapshotBase {
  readonly snapshot_id: SnapshotId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly request_metadata: SnapshotRequestMetadata;
  readonly response_metadata: SnapshotResponseMetadata;
  readonly observed_at: IsoDateTime;
}

export type Snapshot =
  | (SnapshotBase & {
      readonly transport_status: "SUCCESS";
      readonly raw_blob_id: RawBlobId;
      readonly content_hash: RawContentSha256;
      readonly content_length: number;
    })
  | (SnapshotBase & {
      readonly transport_status: "FAILED";
      readonly raw_blob_id: null;
      readonly content_hash: null;
      readonly content_length: null;
    });

export interface ExtractionDescriptor {
  readonly extractor_name: string;
  readonly extractor_version: string;
  readonly extracted_at: IsoDateTime;
}

export const IDENTITY_CANDIDATE_KINDS = [
  "SOURCE_RECORD_ID",
  "ANNOUNCEMENT_URL",
  "APPLICATION_URL",
  "RAW_FIELD_COMBINATION"
] as const;

export type IdentityCandidateKind =
  (typeof IDENTITY_CANDIDATE_KINDS)[number];

export interface SourceOccurrenceIdentityCandidate {
  readonly kind: IdentityCandidateKind;
  readonly value: string;
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
}

export type SourceRecordLocator =
  | {
      readonly kind: "HTML";
      readonly selector: string;
      readonly path?: string;
    }
  | {
      readonly kind: "JSON";
      readonly json_path: string;
    }
  | {
      readonly kind: "DOCUMENT";
      readonly page_number?: number;
      readonly section?: string;
      readonly text_locator?: string;
    }
  | {
      readonly kind: "OTHER";
      readonly locator: string;
    };

export interface ExtractedRecord {
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
  readonly source_definition_id: SourceDefinitionId;
  readonly identity_candidates: readonly SourceOccurrenceIdentityCandidate[];
  readonly raw_source_record_id?: string;
  readonly raw_title?: OriginalText;
  readonly raw_organization_name?: OriginalText;
  readonly raw_location_text: readonly OriginalText[];
  readonly raw_description?: OriginalText;
  readonly raw_requirement_text?: OriginalText;
  readonly announcement_url?: string;
  readonly application_url?: string;
  readonly publish_time?: OriginalText;
  readonly deadline?: OriginalText;
  readonly recruitment_year?: OriginalText;
  readonly recruitment_batch?: OriginalText;
  readonly source_record_locator: SourceRecordLocator;
  readonly adapter_metadata: NamespacedAdapterMetadata;
  readonly extraction: ExtractionDescriptor;
}
