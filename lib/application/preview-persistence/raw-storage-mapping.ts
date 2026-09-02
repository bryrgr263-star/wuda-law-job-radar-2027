const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SENSITIVE_METADATA_KEY = /authorization|cookie|token|password|secret|session|api[_-]?key|bearer/iu;

export const PREVIEW_RAW_STORAGE_POLICY = {
  bucket_name: "preview-ingestion-raw-private",
  visibility: "PRIVATE",
  addressing: "SHA256_CONTENT_ADDRESSED",
  retention: "RETAIN_UNTIL_REVIEWED",
  deletion: "TOMBSTONE_THEN_PURGE",
  client_direct_read: false,
  service_write_required: true
} as const;

export interface PreviewRawBlobStorageInput {
  readonly raw_blob_id: string;
  readonly sha256: string;
  readonly mime_type: string;
  readonly byte_length: number;
  readonly created_at: string;
}

export interface PreviewRawBlobStorageReference {
  readonly bucket_name: typeof PREVIEW_RAW_STORAGE_POLICY.bucket_name;
  readonly object_path: string;
  readonly sha256: string;
  readonly mime_type: string;
  readonly byte_length: number;
  readonly raw_blob_id: string;
  readonly created_at: string;
}

function normalizedSha256(sha256: string) {
  const normalized = sha256.toLowerCase();
  if (!SHA256_HEX.test(normalized)) {
    throw new Error("Preview Raw Storage requires a lowercase SHA-256 hex digest");
  }
  return normalized;
}

export function previewRawObjectPath(sha256: string) {
  const normalized = normalizedSha256(sha256);
  return `raw/sha256/${normalized.slice(0, 2)}/${normalized}`;
}

export function mapPreviewRawBlobToStorage(
  input: PreviewRawBlobStorageInput
): PreviewRawBlobStorageReference {
  if (!input.raw_blob_id || !input.mime_type || input.byte_length < 0) {
    throw new Error("Preview Raw Storage requires immutable RawBlob metadata");
  }

  const sha256 = normalizedSha256(input.sha256);
  return {
    bucket_name: PREVIEW_RAW_STORAGE_POLICY.bucket_name,
    object_path: previewRawObjectPath(sha256),
    sha256,
    mime_type: input.mime_type,
    byte_length: input.byte_length,
    raw_blob_id: input.raw_blob_id,
    created_at: input.created_at
  };
}

export function assertPreviewStorageMetadataIsSafe(
  metadata: Readonly<Record<string, unknown>>
) {
  for (const key of Object.keys(metadata)) {
    if (SENSITIVE_METADATA_KEY.test(key)) {
      throw new Error(`Preview Raw Storage metadata rejects sensitive key: ${key}`);
    }
  }
}
