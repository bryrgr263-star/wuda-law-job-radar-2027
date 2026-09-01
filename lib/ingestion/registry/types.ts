import type { ContentKind, TraceableText } from "../domain";

export interface AdapterKeyRegistration {
  readonly adapter_key: string;
  readonly name: TraceableText;
  readonly supported_content_kinds: readonly ContentKind[];
}

export const SOURCE_REGISTRY_ERROR_CODES = [
  "DUPLICATE_ID",
  "DUPLICATE_ADAPTER_KEY",
  "MISSING_ORGANIZATION",
  "MISSING_SOURCE_DEFINITION",
  "MISSING_ENDPOINT",
  "UNKNOWN_ADAPTER_KEY",
  "UNSUPPORTED_CONTENT_KIND",
  "INVALID_ADAPTER_KEY",
  "INVALID_ENDPOINT",
  "INVALID_COLLECTION_CONFIG"
] as const;

export type SourceRegistryErrorCode =
  (typeof SOURCE_REGISTRY_ERROR_CODES)[number];

export class SourceRegistryError extends Error {
  readonly code: SourceRegistryErrorCode;

  constructor(code: SourceRegistryErrorCode, message: string) {
    super(message);
    this.name = "SourceRegistryError";
    this.code = code;
  }
}
