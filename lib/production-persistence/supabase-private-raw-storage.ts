import {
  PRODUCTION_RAW_BUCKET,
  PRODUCTION_CANDIDATE_EVIDENCE_BUCKET,
  ProductionPersistenceError,
  type PrivateCandidateEvidenceObjectStorage,
  type PrivateRawObjectStorage
} from "./contracts";

export interface SupabaseStorageBucketGateway {
  upload(
    path: string,
    body: Uint8Array,
    options: { readonly contentType: string; readonly upsert: false }
  ): Promise<{ readonly error: unknown | null }>;
  download(path: string): Promise<{
    readonly data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
    readonly error: unknown | null;
  }>;
}

export interface SupabaseStorageGateway {
  from(bucket: string): SupabaseStorageBucketGateway;
}

export class SupabasePrivateRawObjectStorage implements PrivateRawObjectStorage {
  readonly #storage: SupabaseStorageGateway;

  constructor(storage: SupabaseStorageGateway) {
    this.#storage = storage;
  }

  async putIfAbsent(input: {
    readonly bucket: typeof PRODUCTION_RAW_BUCKET;
    readonly object_key: string;
    readonly bytes: Uint8Array;
    readonly content_type: string;
  }) {
    if (input.bucket !== PRODUCTION_RAW_BUCKET) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        "Production Raw adapter only accepts trusted-raw-production"
      );
    }
    const result = await this.#storage.from(input.bucket).upload(
      input.object_key,
      new Uint8Array(input.bytes),
      { contentType: input.content_type, upsert: false }
    );
    if (!result.error) return "CREATED" as const;
    if (isObjectAlreadyPresent(result.error)) return "ALREADY_EXISTS" as const;
    throw new ProductionPersistenceError(
      "STORAGE_WRITE_FAILED",
      `Private Raw object upload failed: ${errorMessage(result.error)}`
    );
  }

  async read(input: {
    readonly bucket: typeof PRODUCTION_RAW_BUCKET;
    readonly object_key: string;
  }) {
    const result = await this.#storage.from(input.bucket).download(input.object_key);
    if (result.error || !result.data) return null;
    return new Uint8Array(await result.data.arrayBuffer());
  }
}

export class SupabasePrivateCandidateEvidenceObjectStorage
implements PrivateCandidateEvidenceObjectStorage {
  readonly #storage: SupabaseStorageGateway;

  constructor(storage: SupabaseStorageGateway) {
    this.#storage = storage;
  }

  async putIfAbsent(input: {
    readonly bucket: typeof PRODUCTION_CANDIDATE_EVIDENCE_BUCKET;
    readonly object_key: string;
    readonly bytes: Uint8Array;
    readonly content_type: string;
  }) {
    if (input.bucket !== PRODUCTION_CANDIDATE_EVIDENCE_BUCKET) {
      throw new ProductionPersistenceError(
        "STORAGE_WRITE_FAILED",
        "Candidate Evidence adapter accepts only the private production bucket"
      );
    }
    const result = await this.#storage.from(input.bucket).upload(
      input.object_key,
      new Uint8Array(input.bytes),
      { contentType: input.content_type, upsert: false }
    );
    if (!result.error) return "CREATED" as const;
    if (isObjectAlreadyPresent(result.error)) return "ALREADY_EXISTS" as const;
    throw new ProductionPersistenceError(
      "STORAGE_WRITE_FAILED",
      `Private Candidate Evidence upload failed: ${errorMessage(result.error)}`
    );
  }

  async read(input: {
    readonly bucket: typeof PRODUCTION_CANDIDATE_EVIDENCE_BUCKET;
    readonly object_key: string;
  }) {
    const result = await this.#storage.from(input.bucket).download(input.object_key);
    if (result.error || !result.data) return null;
    return new Uint8Array(await result.data.arrayBuffer());
  }
}

function isObjectAlreadyPresent(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const status = String(record.statusCode ?? record.status ?? "");
  const message = errorMessage(error);
  return status === "409" || /already exists|duplicate/iu.test(message);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
