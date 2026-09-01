import { createHash, randomUUID } from "node:crypto";

import type {
  IsoDateTime,
  RawBlob,
  RawBlobId,
  RawContentSha256,
  Snapshot,
  SnapshotId,
  TransportHeaders,
  TransportParameters,
  TransportRequest,
  TransportResponse
} from "../domain";
import type { RawBlobRepository, SnapshotRepository } from "./repositories";

export interface RawCaptureOptions {
  readonly create_snapshot_id?: () => SnapshotId;
}

export class RawCaptureService {
  readonly #rawBlobs: RawBlobRepository;
  readonly #snapshots: SnapshotRepository;
  readonly #createSnapshotId: () => SnapshotId;

  constructor(
    rawBlobs: RawBlobRepository,
    snapshots: SnapshotRepository,
    options: RawCaptureOptions = {}
  ) {
    this.#rawBlobs = rawBlobs;
    this.#snapshots = snapshots;
    this.#createSnapshotId = options.create_snapshot_id
      ?? (() => randomUUID() as SnapshotId);
  }

  record(request: TransportRequest, response: TransportResponse) {
    if (response.status === "FAILED") {
      const snapshot: Snapshot = {
        snapshot_id: this.#createSnapshotId(),
        recruitment_endpoint_id: request.recruitment_endpoint_id,
        request_metadata: requestMetadata(request),
        response_metadata: {
          http_status: response.http_status,
          headers: sanitizeHeaders(response.headers),
          mime_type: response.mime_type,
          content_length: null,
          transport_error: response.error
        },
        transport_status: "FAILED",
        raw_blob_id: null,
        content_hash: null,
        content_length: null,
        observed_at: response.responded_at
      };
      return { snapshot: this.#snapshots.append(snapshot), raw_blob: null } as const;
    }

    const verifiedHash = sha256(response.bytes);
    if (verifiedHash !== response.content_sha256) {
      throw new Error("Transport response SHA-256 does not match its raw bytes");
    }
    const rawBlob = this.#rawBlobs.append(createRawBlob(
      response.bytes,
      response.content_sha256,
      response.mime_type,
      response.responded_at
    ));
    const snapshot: Snapshot = {
      snapshot_id: this.#createSnapshotId(),
      recruitment_endpoint_id: request.recruitment_endpoint_id,
      request_metadata: requestMetadata(request),
      response_metadata: {
        http_status: response.http_status,
        headers: sanitizeHeaders(response.headers),
        mime_type: response.mime_type,
        content_length: response.bytes.byteLength,
        transport_error: null
      },
      transport_status: "SUCCESS",
      raw_blob_id: rawBlob.raw_blob_id,
      content_hash: rawBlob.raw_content_sha256,
      content_length: rawBlob.byte_length,
      observed_at: response.responded_at
    };
    return { snapshot: this.#snapshots.append(snapshot), raw_blob: rawBlob } as const;
  }
}

function createRawBlob(
  bytes: Uint8Array,
  hash: RawContentSha256,
  mimeType: string,
  createdAt: IsoDateTime
): RawBlob {
  return {
    raw_blob_id: `sha256:${hash}` as RawBlobId,
    bytes: new Uint8Array(bytes),
    raw_content_sha256: hash,
    mime_type: mimeType,
    byte_length: bytes.byteLength,
    created_at: createdAt
  };
}

function requestMetadata(request: TransportRequest) {
  return {
    locator: redactLocator(request.locator),
    method: request.method,
    requested_at: request.requested_at,
    headers: sanitizeHeaders(request.headers),
    parameters: sanitizeParameters(request.parameters)
  };
}

export function sanitizeHeaders(headers: TransportHeaders): TransportHeaders {
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => {
    return !isSensitiveName(name) && !/^bearer\s/i.test(value);
  }));
}

export function sanitizeParameters(parameters: TransportParameters): TransportParameters {
  return Object.fromEntries(Object.entries(parameters).filter(([name]) => !isSensitiveName(name)));
}

function redactLocator(locator: string) {
  const parsed = new URL(locator);
  parsed.username = "";
  parsed.password = "";
  for (const name of [...parsed.searchParams.keys()]) {
    if (isSensitiveName(name)) parsed.searchParams.delete(name);
  }
  return parsed.toString();
}

function isSensitiveName(name: string) {
  return /(?:authorization|cookie|api[-_]?key|token|password|passwd|session|secret)/i.test(name);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}
