import { createHash } from "node:crypto";

import type { SourceAdmission } from "../application/source-admission";
import type {
  ExtractedRecord,
  Organization,
  RawBlob,
  RecruitmentEndpoint,
  Snapshot,
  SourceDefinition
} from "../ingestion";
import type { AdapterKeyRegistration } from "../ingestion/registry/types";
import { canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";

export const PRODUCTION_RAW_BUCKET = "trusted-raw-production" as const;
export const PRODUCTION_CANDIDATE_EVIDENCE_BUCKET =
  "trusted-candidate-evidence-production" as const;

export type ProductionAppendOutcome = "APPENDED" | "IDEMPOTENT_REUSE";

export interface ProductionPersistenceProvenance {
  readonly scope: "PRODUCTION";
  readonly actor_id: string;
  readonly actor_role: string;
  readonly evidence_references: readonly string[];
}

export type SourcePersistenceArtifact =
  | { readonly kind: "ORGANIZATION"; readonly payload: Organization }
  | { readonly kind: "SOURCE_DEFINITION"; readonly payload: SourceDefinition }
  | { readonly kind: "RECRUITMENT_ENDPOINT"; readonly payload: RecruitmentEndpoint }
  | { readonly kind: "ADAPTER_REGISTRATION"; readonly payload: AdapterKeyRegistration }
  | { readonly kind: "SOURCE_ADMISSION"; readonly payload: SourceAdmission }
  | {
      readonly kind: "OFFICIAL_ENDPOINT_ALLOWLIST";
      readonly payload: OfficialEndpointAllowlist;
    };

export interface OfficialEndpointAllowlist {
  readonly allowlist_entry_id: string;
  readonly recruitment_endpoint_artifact_id: string;
  readonly source_admission_artifact_id: string;
  readonly active: boolean;
  readonly scheme: "https";
  readonly host: string;
  readonly port: number | null;
  readonly path_prefix: string;
  readonly exact_path: boolean;
  readonly allowed_method: "GET";
  readonly query_policy: {
    readonly mode: "DENY_ALL" | "ALLOW_LIST";
    readonly allowed_parameters: readonly string[];
  };
  readonly endpoint_purpose: string;
  readonly authority_level: string;
  readonly approval_evidence_ids: readonly string[];
}

export interface SourcePersistenceVersion {
  readonly artifact_id: string;
  readonly stream_id: string;
  readonly revision: number;
  readonly supersedes_artifact_id: string | null;
  readonly artifact: SourcePersistenceArtifact;
  readonly canonical_bytes: string;
  readonly content_hash: string;
  readonly integrity_bytes: string;
  readonly integrity_hash: string;
  readonly provenance: ProductionPersistenceProvenance;
  readonly effective_at: string;
  readonly created_at: string;
}

export interface CreateSourcePersistenceVersionInput {
  readonly stream_id: string;
  readonly revision: number;
  readonly supersedes_artifact_id: string | null;
  readonly artifact: SourcePersistenceArtifact;
  readonly provenance: ProductionPersistenceProvenance;
  readonly effective_at: string;
  readonly created_at: string;
}

export function createSourcePersistenceVersion(
  input: CreateSourcePersistenceVersionInput
): SourcePersistenceVersion {
  requirePositiveRevision(input.revision);
  requireText(input.stream_id, "Source persistence stream ID");
  if ((input.revision === 1) !== (input.supersedes_artifact_id === null)) {
    throw new ProductionPersistenceError(
      "INVALID_REVISION",
      "Revision 1 cannot supersede another artifact and later revisions must supersede one"
    );
  }
  validateProductionProvenance(input.provenance);
  validateSourceArtifactIdentity(input.stream_id, input.artifact);

  const canonicalBytes = canonicalSerialize(input.artifact.payload);
  const contentHash = sha256Text(canonicalBytes);
  const artifactId = [
    "source-persistence",
    input.artifact.kind.toLowerCase(),
    encodeURIComponent(input.stream_id),
    `r${input.revision}`,
    contentHash
  ].join(":");
  const integrityContent = {
    artifact_id: artifactId,
    stream_id: input.stream_id,
    revision: input.revision,
    supersedes_artifact_id: input.supersedes_artifact_id,
    artifact_kind: input.artifact.kind,
    content_hash: contentHash,
    provenance: input.provenance,
    effective_at: input.effective_at,
    created_at: input.created_at
  };
  const integrityBytes = canonicalSerialize(integrityContent);

  return structuredClone({
    artifact_id: artifactId,
    stream_id: input.stream_id,
    revision: input.revision,
    supersedes_artifact_id: input.supersedes_artifact_id,
    artifact: input.artifact,
    canonical_bytes: canonicalBytes,
    content_hash: contentHash,
    integrity_bytes: integrityBytes,
    integrity_hash: sha256Text(integrityBytes),
    provenance: input.provenance,
    effective_at: input.effective_at,
    created_at: input.created_at
  });
}

export function assertSourcePersistenceVersion(version: SourcePersistenceVersion) {
  const rebuilt = createSourcePersistenceVersion({
    stream_id: version.stream_id,
    revision: version.revision,
    supersedes_artifact_id: version.supersedes_artifact_id,
    artifact: version.artifact,
    provenance: version.provenance,
    effective_at: version.effective_at,
    created_at: version.created_at
  });
  if (canonicalSerialize(rebuilt) !== canonicalSerialize(version)) {
    throw new ProductionPersistenceError(
      "INTEGRITY_MISMATCH",
      `Source persistence artifact failed canonical verification: ${version.artifact_id}`
    );
  }
}

export function assertOfficialRequestAllowed(
  allowlist: OfficialEndpointAllowlist,
  requestUrl: string,
  method: string
) {
  if (!allowlist.active) {
    throw new ProductionPersistenceError("SOURCE_NOT_ALLOWED", "Allowlist entry is inactive");
  }
  if (method !== allowlist.allowed_method) {
    throw new ProductionPersistenceError("SOURCE_NOT_ALLOWED", "HTTP method is not approved");
  }
  const requested = new URL(requestUrl);
  if (
    requested.protocol !== `${allowlist.scheme}:`
    || requested.hostname.toLowerCase() !== allowlist.host
    || normalizedPort(requested) !== allowlist.port
  ) {
    throw new ProductionPersistenceError("SOURCE_NOT_ALLOWED", "Official host is not approved");
  }
  const pathAllowed = allowlist.exact_path
    ? requested.pathname === allowlist.path_prefix
    : requested.pathname === allowlist.path_prefix
      || requested.pathname.startsWith(`${allowlist.path_prefix.replace(/\/$/u, "")}/`);
  if (!pathAllowed) {
    throw new ProductionPersistenceError("SOURCE_NOT_ALLOWED", "Official path is not approved");
  }
  const queryNames = [...requested.searchParams.keys()].sort();
  if (allowlist.query_policy.mode === "DENY_ALL" && queryNames.length > 0) {
    throw new ProductionPersistenceError("SOURCE_NOT_ALLOWED", "Query parameters are not approved");
  }
  const approved = new Set(allowlist.query_policy.allowed_parameters);
  if (queryNames.some((name) => !approved.has(name))) {
    throw new ProductionPersistenceError("SOURCE_NOT_ALLOWED", "Query parameter is not approved");
  }
}

export interface AcquisitionRunRecord {
  readonly acquisition_run_id: string;
  readonly source_admission_artifact_id: string;
  readonly endpoint_artifact_id: string;
  readonly allowlist_artifact_id: string;
  readonly status: "SUCCESS" | "NOT_MODIFIED" | "PARTIAL" | "FAILED" | "SUSPICIOUS_EMPTY";
  readonly started_at: string;
  readonly completed_at: string;
  readonly request_metadata: Readonly<Record<string, unknown>>;
  readonly result_metadata: Readonly<Record<string, unknown>>;
  readonly provenance: ProductionPersistenceProvenance;
}

export interface RawBlobManifest {
  readonly raw_blob_id: string;
  readonly raw_content_sha256: string;
  readonly byte_length: number;
  readonly content_type: string;
  readonly bucket_id: typeof PRODUCTION_RAW_BUCKET;
  readonly object_key: string;
  readonly source_definition_id: string;
  readonly recruitment_endpoint_id: string;
  readonly first_acquired_at: string;
  readonly provenance: ProductionPersistenceProvenance;
  readonly canonical_bytes: string;
  readonly manifest_integrity_hash: string;
}

export interface AcquisitionPersistenceBundle {
  readonly acquisition_run: AcquisitionRunRecord;
  readonly raw_blob_manifest: RawBlobManifest | null;
  readonly snapshot: Snapshot;
  readonly extracted_records: readonly ExtractedRecord[];
}

export interface ProductionSourceRegistryRepository {
  appendVersion(version: SourcePersistenceVersion): Promise<ProductionAppendOutcome>;
  listVersions(): Promise<readonly SourcePersistenceVersion[]>;
}

export interface ProductionSourceFactRepository {
  appendAcquisitionBundle(
    bundle: AcquisitionPersistenceBundle
  ): Promise<ProductionAppendOutcome>;
  getRawBlobManifest(rawBlobId: string): Promise<RawBlobManifest | null>;
}

export interface PrivateRawObjectStorage {
  putIfAbsent(input: {
    readonly bucket: typeof PRODUCTION_RAW_BUCKET;
    readonly object_key: string;
    readonly bytes: Uint8Array;
    readonly content_type: string;
  }): Promise<"CREATED" | "ALREADY_EXISTS">;
  read(input: {
    readonly bucket: typeof PRODUCTION_RAW_BUCKET;
    readonly object_key: string;
  }): Promise<Uint8Array | null>;
}

export interface PrivateCandidateEvidenceObjectStorage {
  putIfAbsent(input: {
    readonly bucket: typeof PRODUCTION_CANDIDATE_EVIDENCE_BUCKET;
    readonly object_key: string;
    readonly bytes: Uint8Array;
    readonly content_type: string;
  }): Promise<"CREATED" | "ALREADY_EXISTS">;
  read(input: {
    readonly bucket: typeof PRODUCTION_CANDIDATE_EVIDENCE_BUCKET;
    readonly object_key: string;
  }): Promise<Uint8Array | null>;
}

export interface PostgresQueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface PostgresExecutor {
  query<Row>(sql: string, parameters?: readonly unknown[]): Promise<PostgresQueryResult<Row>>;
  transaction<Result>(work: (executor: PostgresExecutor) => Promise<Result>): Promise<Result>;
}

export function createRawBlobManifest(input: {
  readonly raw_blob: RawBlob;
  readonly source_definition_id: string;
  readonly recruitment_endpoint_id: string;
  readonly acquired_at: string;
  readonly provenance: ProductionPersistenceProvenance;
}): RawBlobManifest {
  validateProductionProvenance(input.provenance);
  const actualHash = sha256Bytes(input.raw_blob.bytes);
  if (actualHash !== input.raw_blob.raw_content_sha256) {
    throw new ProductionPersistenceError("HASH_MISMATCH", "RawBlob bytes do not match SHA-256");
  }
  if (input.raw_blob.byte_length !== input.raw_blob.bytes.byteLength) {
    throw new ProductionPersistenceError("HASH_MISMATCH", "RawBlob length does not match bytes");
  }
  const objectKey = rawBlobObjectKey(actualHash);
  const canonicalContent = {
    raw_blob_id: input.raw_blob.raw_blob_id,
    raw_content_sha256: actualHash,
    byte_length: input.raw_blob.byte_length,
    content_type: input.raw_blob.mime_type,
    bucket_id: PRODUCTION_RAW_BUCKET,
    object_key: objectKey,
    source_definition_id: input.source_definition_id,
    recruitment_endpoint_id: input.recruitment_endpoint_id,
    first_acquired_at: input.acquired_at,
    provenance: input.provenance
  };
  const canonicalBytes = canonicalSerialize(canonicalContent);
  return {
    ...canonicalContent,
    canonical_bytes: canonicalBytes,
    manifest_integrity_hash: sha256Text(canonicalBytes)
  };
}

export function assertRawBlobManifest(manifest: RawBlobManifest) {
  const canonicalContent = {
    raw_blob_id: manifest.raw_blob_id,
    raw_content_sha256: manifest.raw_content_sha256,
    byte_length: manifest.byte_length,
    content_type: manifest.content_type,
    bucket_id: manifest.bucket_id,
    object_key: manifest.object_key,
    source_definition_id: manifest.source_definition_id,
    recruitment_endpoint_id: manifest.recruitment_endpoint_id,
    first_acquired_at: manifest.first_acquired_at,
    provenance: manifest.provenance
  };
  validateProductionProvenance(manifest.provenance);
  if (manifest.raw_blob_id !== `sha256:${manifest.raw_content_sha256}`
      || manifest.bucket_id !== PRODUCTION_RAW_BUCKET
      || manifest.object_key !== rawBlobObjectKey(manifest.raw_content_sha256)
      || !Number.isSafeInteger(manifest.byte_length)
      || manifest.byte_length < 0
      || !manifest.content_type.trim()
      || !manifest.source_definition_id.trim()
      || !manifest.recruitment_endpoint_id.trim()
      || !manifest.first_acquired_at.trim()
      || manifest.canonical_bytes !== canonicalSerialize(canonicalContent)
      || manifest.manifest_integrity_hash !== sha256Text(manifest.canonical_bytes)) {
    throw new ProductionPersistenceError(
      "INTEGRITY_MISMATCH",
      `RawBlob manifest failed canonical verification: ${manifest.raw_blob_id}`
    );
  }
  return structuredClone(manifest);
}

export function rawBlobObjectKey(hash: string) {
  const normalized = hash.toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new ProductionPersistenceError("HASH_MISMATCH", "RawBlob SHA-256 is invalid");
  }
  return `sha256/${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}`;
}

export const PRODUCTION_PERSISTENCE_ERROR_CODES = [
  "COLLISION",
  "EVIDENCE_BLOCKED",
  "HASH_MISMATCH",
  "INTEGRITY_MISMATCH",
  "INVALID_REVISION",
  "SOURCE_NOT_ALLOWED",
  "STORAGE_WRITE_FAILED"
] as const;

export type ProductionPersistenceErrorCode =
  (typeof PRODUCTION_PERSISTENCE_ERROR_CODES)[number];

export class ProductionPersistenceError extends Error {
  readonly code: ProductionPersistenceErrorCode;

  constructor(code: ProductionPersistenceErrorCode, message: string) {
    super(message);
    this.name = "ProductionPersistenceError";
    this.code = code;
  }
}

function validateSourceArtifactIdentity(
  streamId: string,
  artifact: SourcePersistenceArtifact
) {
  const expected = artifact.kind === "ORGANIZATION"
    ? artifact.payload.organization_id
    : artifact.kind === "SOURCE_DEFINITION"
      ? artifact.payload.source_definition_id
      : artifact.kind === "RECRUITMENT_ENDPOINT"
        ? artifact.payload.recruitment_endpoint_id
        : artifact.kind === "ADAPTER_REGISTRATION"
          ? artifact.payload.adapter_key
          : artifact.kind === "SOURCE_ADMISSION"
            ? artifact.payload.source_admission_id
            : artifact.payload.allowlist_entry_id;
  if (streamId !== expected) {
    throw new ProductionPersistenceError(
      "INTEGRITY_MISMATCH",
      `${artifact.kind} stream ID does not match its stable identity`
    );
  }
  if (artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST") {
    const allowlist = artifact.payload;
    if (
      allowlist.scheme !== "https"
      || allowlist.host !== allowlist.host.toLowerCase()
      || !allowlist.path_prefix.startsWith("/")
      || allowlist.allowed_method !== "GET"
    ) {
      throw new ProductionPersistenceError(
        "SOURCE_NOT_ALLOWED",
        "Official allowlist requires lowercase HTTPS host, absolute path, and GET"
      );
    }
  }
}

function validateProductionProvenance(provenance: ProductionPersistenceProvenance) {
  if (provenance.scope !== "PRODUCTION") {
    throw new ProductionPersistenceError("INTEGRITY_MISMATCH", "Production scope is required");
  }
  requireText(provenance.actor_id, "Provenance actor ID");
  requireText(provenance.actor_role, "Provenance actor role");
}

function requirePositiveRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ProductionPersistenceError("INVALID_REVISION", "Revision must be positive");
  }
}

function requireText(value: string, label: string) {
  if (value.trim().length === 0) {
    throw new ProductionPersistenceError("INTEGRITY_MISMATCH", `${label} cannot be empty`);
  }
}

function normalizedPort(url: URL) {
  if (url.port.length === 0) return null;
  return Number(url.port);
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
