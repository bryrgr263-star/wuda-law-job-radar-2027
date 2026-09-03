import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { ReadOnlyIngestionApi } from "./api";
import { ReadOnlyIngestionProjection } from "./projection";
import type { ReadOnlyIngestionProjectionOptions } from "./types";

export const IMMUTABLE_PREVIEW_DATASET_SCHEMA = "p2-07-immutable-preview-dataset/v1" as const;

export interface ImmutablePreviewDatasetManifest {
  readonly schema_version: typeof IMMUTABLE_PREVIEW_DATASET_SCHEMA;
  readonly dataset_id: string;
  readonly classification: "VERIFIED_OFFICIAL_CAPTURE_ONLY";
  readonly created_at: string;
  readonly database_sha256: string;
  readonly database_byte_length: number;
  readonly source_definition_ids: readonly string[];
  readonly source_health: NonNullable<ReadOnlyIngestionProjectionOptions["source_health"]>;
}

export interface ReadOnlyIngestionRuntimeOptions {
  readonly database_path: string;
  readonly manifest_path: string;
}

export class ImmutablePreviewDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImmutablePreviewDatasetError";
  }
}

export class ReadOnlyIngestionRuntime {
  readonly dataset: ImmutablePreviewDatasetManifest;
  readonly #api: ReadOnlyIngestionApi;
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(
    api: ReadOnlyIngestionApi,
    database: DatabaseSync,
    dataset: ImmutablePreviewDatasetManifest
  ) {
    this.#api = api;
    this.#database = database;
    this.dataset = dataset;
  }

  async handle(request: Request) {
    if (this.#closed) {
      throw new ImmutablePreviewDatasetError("P2-07 read-only runtime is closed");
    }
    return this.#api.handle(request);
  }

  close() {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }
}

export function composeReadOnlyIngestionRuntime(
  options: ReadOnlyIngestionRuntimeOptions
): ReadOnlyIngestionRuntime {
  const manifest = loadManifest(options.manifest_path);
  verifyDatabaseArtifact(options.database_path, manifest);
  const database = new DatabaseSync(options.database_path, {
    readOnly: true,
    allowExtension: false,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false
  });
  try {
    database.exec("PRAGMA query_only = ON");
    const projection = new ReadOnlyIngestionProjection(database, {
      source_health: manifest.source_health
    });
    verifySourceBindings(projection, manifest);
    return new ReadOnlyIngestionRuntime(
      new ReadOnlyIngestionApi(projection),
      database,
      manifest
    );
  } catch (error) {
    database.close();
    if (error instanceof ImmutablePreviewDatasetError) throw error;
    throw new ImmutablePreviewDatasetError(
      `Immutable Preview Data Source is not a valid P2-07 projection dataset: ${errorMessage(error)}`
    );
  }
}

function loadManifest(manifestPath: string): ImmutablePreviewDatasetManifest {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new ImmutablePreviewDatasetError(`Cannot read Preview dataset manifest: ${errorMessage(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImmutablePreviewDatasetError("Preview dataset manifest must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schema_version !== IMMUTABLE_PREVIEW_DATASET_SCHEMA) {
    throw new ImmutablePreviewDatasetError("Preview dataset manifest schema is not supported");
  }
  if (candidate.classification !== "VERIFIED_OFFICIAL_CAPTURE_ONLY") {
    throw new ImmutablePreviewDatasetError("Preview dataset must contain verified official captures only");
  }
  assertText(candidate.dataset_id, "dataset_id");
  assertText(candidate.created_at, "created_at");
  if (typeof candidate.database_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.database_sha256)) {
    throw new ImmutablePreviewDatasetError("database_sha256 must be a lowercase SHA-256 value");
  }
  if (!Number.isSafeInteger(candidate.database_byte_length) || Number(candidate.database_byte_length) < 1) {
    throw new ImmutablePreviewDatasetError("database_byte_length must be a positive safe integer");
  }
  if (!isStringArray(candidate.source_definition_ids) || candidate.source_definition_ids.length === 0) {
    throw new ImmutablePreviewDatasetError("source_definition_ids must contain at least one SourceDefinition ID");
  }
  if (!Array.isArray(candidate.source_health)) {
    throw new ImmutablePreviewDatasetError("source_health must be an array");
  }
  return deepFreeze({
    schema_version: IMMUTABLE_PREVIEW_DATASET_SCHEMA,
    dataset_id: candidate.dataset_id,
    classification: "VERIFIED_OFFICIAL_CAPTURE_ONLY",
    created_at: candidate.created_at,
    database_sha256: candidate.database_sha256,
    database_byte_length: candidate.database_byte_length,
    source_definition_ids: [...candidate.source_definition_ids],
    source_health: structuredClone(candidate.source_health)
  } as ImmutablePreviewDatasetManifest);
}

function verifyDatabaseArtifact(
  databasePath: string,
  manifest: ImmutablePreviewDatasetManifest
) {
  let bytes: Uint8Array;
  let byteLength: number;
  try {
    const stats = statSync(databasePath);
    if (!stats.isFile()) throw new Error("path is not a file");
    byteLength = stats.size;
    bytes = readFileSync(databasePath);
  } catch (error) {
    throw new ImmutablePreviewDatasetError(`Cannot read Preview database artifact: ${errorMessage(error)}`);
  }
  if (byteLength !== manifest.database_byte_length) {
    throw new ImmutablePreviewDatasetError("Preview database byte length does not match its manifest");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== manifest.database_sha256) {
    throw new ImmutablePreviewDatasetError("Preview database SHA-256 does not match its manifest");
  }
}

function verifySourceBindings(
  projection: ReadOnlyIngestionProjection,
  manifest: ImmutablePreviewDatasetManifest
) {
  const actual = projection.listSources().map((source) => source.source_definition_id).sort();
  const expected = [...manifest.source_definition_ids].sort();
  if (actual.join("\u0000") !== expected.join("\u0000")) {
    throw new ImmutablePreviewDatasetError("Preview database sources do not match its manifest");
  }
}

function assertText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ImmutablePreviewDatasetError(`${field} must be a non-empty string`);
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim().length > 0)
    && new Set(value).size === value.length;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
