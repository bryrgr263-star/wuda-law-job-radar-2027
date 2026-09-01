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
import type { OpportunityContent } from "./opportunity";
import type { OriginalText } from "./text";

export interface RawBlob {
  readonly raw_blob_id: RawBlobId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly captured_at: IsoDateTime;
  readonly media_type: string;
  readonly byte_length: number;
  readonly raw_content_sha256: RawContentSha256;
  readonly immutable: true;
  readonly storage_locator: string;
  readonly original_text?: OriginalText;
  readonly adapter_metadata?: NamespacedAdapterMetadata;
}

export type SnapshotContent =
  | {
      readonly kind: "CAPTURED";
      readonly raw_blob_id: RawBlobId;
      readonly original_text?: OriginalText;
    }
  | {
      readonly kind: "NOT_MODIFIED";
      readonly prior_snapshot_id: SnapshotId;
    };

export interface Snapshot {
  readonly snapshot_id: SnapshotId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly captured_at: IsoDateTime;
  readonly response_status: number | null;
  readonly content: SnapshotContent;
  readonly adapter_metadata?: NamespacedAdapterMetadata;
}

export interface ExtractionDescriptor {
  readonly extractor_name: string;
  readonly extractor_version: string;
  readonly extracted_at: IsoDateTime;
}

export interface ExtractedRecord {
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
  readonly source_definition_id: SourceDefinitionId;
  readonly source_record_key?: string;
  readonly extraction: ExtractionDescriptor;
  readonly content: OpportunityContent;
}
