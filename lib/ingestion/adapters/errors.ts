export const ADAPTER_EXTRACTION_ERROR_CODES = [
  "ENDPOINT_NOT_SUPPORTED",
  "SNAPSHOT_FAILED",
  "RAW_BLOB_REQUIRED",
  "RAW_BLOB_MISMATCH",
  "MALFORMED_CONTENT"
] as const;

export type AdapterExtractionErrorCode =
  (typeof ADAPTER_EXTRACTION_ERROR_CODES)[number];

export class AdapterExtractionError extends Error {
  readonly code: AdapterExtractionErrorCode;

  constructor(code: AdapterExtractionErrorCode, message: string) {
    super(message);
    this.name = "AdapterExtractionError";
    this.code = code;
  }
}
