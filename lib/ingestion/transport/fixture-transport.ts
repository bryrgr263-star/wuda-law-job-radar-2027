import { createHash } from "node:crypto";

import type {
  IsoDateTime,
  RawContentSha256,
  TransportHeaders,
  TransportRequest,
  TransportResponse
} from "../domain";

export interface FixtureTransportEntry {
  readonly locator: string;
  readonly bytes: Uint8Array;
  readonly mime_type: string;
  readonly http_status?: number | null;
  readonly headers?: TransportHeaders;
}

export interface FixtureTransportOptions {
  readonly now?: () => IsoDateTime;
}

export class FixtureTransport {
  readonly #entries = new Map<string, FixtureTransportEntry>();
  readonly #now: () => IsoDateTime;

  constructor(entries: readonly FixtureTransportEntry[], options: FixtureTransportOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString() as IsoDateTime);
    for (const entry of entries) {
      validateFixtureEntry(entry);
      if (this.#entries.has(entry.locator)) {
        throw new Error(`Duplicate fixture locator: ${entry.locator}`);
      }
      this.#entries.set(entry.locator, cloneEntry(entry));
    }
  }

  async execute(request: TransportRequest): Promise<TransportResponse> {
    if (!request.locator.startsWith("fixture://")) {
      return {
        status: "FAILED",
        responded_at: this.#now(),
        http_status: null,
        headers: {},
        mime_type: null,
        error: {
          code: "UNSUPPORTED_LOCATOR",
          message: "FixtureTransport only supports fixture:// locators",
          retryable: false
        }
      };
    }

    const entry = this.#entries.get(request.locator);
    if (!entry) {
      return {
        status: "FAILED",
        responded_at: this.#now(),
        http_status: null,
        headers: {},
        mime_type: null,
        error: {
          code: "FIXTURE_NOT_FOUND",
          message: `Fixture not found: ${request.locator}`,
          retryable: false
        }
      };
    }

    const bytes = new Uint8Array(entry.bytes);
    return {
      status: "SUCCESS",
      responded_at: this.#now(),
      bytes,
      content_sha256: sha256(bytes),
      mime_type: entry.mime_type,
      http_status: entry.http_status ?? null,
      headers: { ...entry.headers }
    };
  }
}

function cloneEntry(entry: FixtureTransportEntry): FixtureTransportEntry {
  return {
    ...entry,
    bytes: new Uint8Array(entry.bytes),
    headers: { ...entry.headers }
  };
}

function validateFixtureEntry(entry: FixtureTransportEntry) {
  if (!entry.locator.startsWith("fixture://")) {
    throw new Error(`Fixture locator must use fixture://: ${entry.locator}`);
  }
  if (entry.mime_type.trim().length === 0) {
    throw new Error(`Fixture MIME type cannot be empty: ${entry.locator}`);
  }
  for (const [name, value] of Object.entries(entry.headers ?? {})) {
    if (isSensitiveHeader(name, value)) {
      throw new Error(`Fixture headers cannot contain sensitive data: ${name}`);
    }
  }
}

function isSensitiveHeader(name: string, value: string) {
  return /(?:authorization|cookie|api[-_]?key|token|password|session|secret)/i.test(name)
    || /^bearer\s/i.test(value);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}
