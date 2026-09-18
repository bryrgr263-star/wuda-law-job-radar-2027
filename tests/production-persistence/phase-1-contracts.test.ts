import "../helpers/network-guard";

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySourceAdmissionRegister } from "../../lib/application";
import {
  InMemorySourceRegistry,
  UTF8_TEXT_ENCODING,
  type ExtractedRecord,
  type Organization,
  type OrganizationId,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type Snapshot,
  type SnapshotId,
  type SourceDefinition,
  type SourceDefinitionId
} from "../../lib/ingestion";
import {
  assertOfficialRequestAllowed,
  createRawBlobManifest,
  createSourcePersistenceVersion,
  ProductionPersistenceError,
  ProductionRawObjectBoundary,
  PostgresProductionPersistence,
  PRODUCTION_RAW_BUCKET,
  rawBlobObjectKey,
  rehydrateProductionSourceOwners,
  SupabasePrivateRawObjectStorage,
  type AcquisitionPersistenceBundle,
  type PrivateRawObjectStorage,
  type ProductionAppendOutcome,
  type ProductionPersistenceProvenance,
  type ProductionSourceFactRepository,
  type ProductionSourceRegistryRepository,
  type RawBlobManifest,
  type SourcePersistenceVersion
} from "../../lib/production-persistence";

const provenance: ProductionPersistenceProvenance = {
  scope: "PRODUCTION",
  actor_id: "phase-1-test",
  actor_role: "PERSISTENCE_CONTRACT_TEST",
  evidence_references: ["test-only:no-production-claim"]
};

function branded<Value extends string>(value: string) {
  return value as Value;
}

function traceable(text: string) {
  return { original: { text, encoding: UTF8_TEXT_ENCODING } } as const;
}

const organization: Organization = {
  organization_id: branded<OrganizationId>("org-production-foundation"),
  name: traceable("官方组织"),
  aliases: [],
  country_code: "CN"
};

const source: SourceDefinition = {
  source_definition_id: branded<SourceDefinitionId>("source-production-foundation"),
  publisher_organization_id: organization.organization_id,
  name: traceable("官方招聘来源"),
  publisher_kind: "GOVERNMENT_PORTAL",
  authority_level: "OFFICIAL",
  scope: "REGIONAL",
  enabled: true
};

const endpoint: RecruitmentEndpoint = {
  recruitment_endpoint_id: branded<RecruitmentEndpointId>("endpoint-production-foundation"),
  source_definition_id: source.source_definition_id,
  name: traceable("官方招聘公告"),
  coverage_regions: [],
  locator: "https://official.example.invalid/recruitment/2027",
  request_method: "GET",
  content_kind: "HTML",
  adapter_key: "official-html",
  decoded_text_encoding: UTF8_TEXT_ENCODING,
  collection_config: { timeout_ms: 10_000, max_pages: 1, retry_limit: 0 },
  enabled: true
};

function version(
  artifact: SourcePersistenceVersion["artifact"],
  revision = 1,
  supersedesArtifactId: string | null = null
) {
  const streamId = artifact.kind === "ORGANIZATION"
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
  return createSourcePersistenceVersion({
    stream_id: streamId,
    revision,
    supersedes_artifact_id: supersedesArtifactId,
    artifact,
    provenance,
    effective_at: `2026-09-${String(revision).padStart(2, "0")}T00:00:00.000Z`,
    created_at: `2026-09-${String(revision).padStart(2, "0")}T00:00:01.000Z`
  });
}

test("source versions are stable, immutable, and collision-addressed", () => {
  const first = version({ kind: "ORGANIZATION", payload: organization });
  const duplicate = version({ kind: "ORGANIZATION", payload: structuredClone(organization) });
  assert.deepEqual(duplicate, first);

  const changed = version({
    kind: "ORGANIZATION",
    payload: { ...organization, name: traceable("官方组织（修订）") }
  });
  assert.notEqual(changed.artifact_id, first.artifact_id);
  assert.throws(() => createSourcePersistenceVersion({
    stream_id: organization.organization_id,
    revision: 2,
    supersedes_artifact_id: null,
    artifact: { kind: "ORGANIZATION", payload: organization },
    provenance,
    effective_at: "2026-09-02T00:00:00.000Z",
    created_at: "2026-09-02T00:00:01.000Z"
  }), (error: unknown) => error instanceof ProductionPersistenceError
    && error.code === "INVALID_REVISION");
});

test("exact official host, path, method, and query policy are enforced", () => {
  const allowlist = {
    allowlist_entry_id: "allowlist-production-foundation",
    recruitment_endpoint_artifact_id: "endpoint-artifact-1",
    source_admission_artifact_id: "admission-artifact-1",
    active: true,
    scheme: "https" as const,
    host: "official.example.invalid",
    port: null,
    path_prefix: "/recruitment/2027",
    exact_path: true,
    allowed_method: "GET" as const,
    query_policy: { mode: "DENY_ALL" as const, allowed_parameters: [] },
    endpoint_purpose: "JOB_LIST",
    authority_level: "OFFICIAL",
    approval_evidence_ids: ["approval-1"]
  };
  assert.doesNotThrow(() => assertOfficialRequestAllowed(
    allowlist,
    "https://official.example.invalid/recruitment/2027",
    "GET"
  ));
  for (const candidate of [
    "https://evil.example.invalid/recruitment/2027",
    "https://official.example.invalid/recruitment/2027/attachment.xlsx",
    "https://official.example.invalid/recruitment/2027?page=1"
  ]) {
    assert.throws(() => assertOfficialRequestAllowed(allowlist, candidate, "GET"));
  }
  assert.throws(() => assertOfficialRequestAllowed(
    allowlist,
    "https://official.example.invalid/recruitment/2027",
    "POST"
  ));
});

test("persisted source revisions replay through the existing owners", async () => {
  const organizationV1 = version({ kind: "ORGANIZATION", payload: organization });
  const organizationV2 = version({
    kind: "ORGANIZATION",
    payload: { ...organization, name: traceable("官方组织第二版") }
  }, 2, organizationV1.artifact_id);
  const adapterV1 = version({
    kind: "ADAPTER_REGISTRATION",
    payload: {
      adapter_key: "official-html",
      name: traceable("Official HTML"),
      supported_content_kinds: ["HTML"]
    }
  });
  const sourceV1 = version({ kind: "SOURCE_DEFINITION", payload: source });
  const endpointV1 = version({ kind: "RECRUITMENT_ENDPOINT", payload: endpoint });
  const repository: ProductionSourceRegistryRepository = {
    appendVersion: async () => "APPENDED",
    listVersions: async () => [organizationV1, organizationV2, adapterV1, sourceV1, endpointV1]
  };
  const sourceRegistry = new InMemorySourceRegistry();
  const result = await rehydrateProductionSourceOwners({
    repository,
    source_registry: sourceRegistry,
    source_admission_register: new InMemorySourceAdmissionRegister()
  });

  assert.equal(result.restored_version_count, 5);
  assert.equal(sourceRegistry.getOrganization(organization.organization_id).name.original.text,
    "官方组织第二版");
  assert.equal(sourceRegistry.getRecruitmentEndpoint(endpoint.recruitment_endpoint_id).locator,
    endpoint.locator);
});

test("RawBlob path is content-addressed and hash is verified before storage", async () => {
  const bytes = new TextEncoder().encode("official recruitment bytes");
  const hash = createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
  const blob: RawBlob = {
    raw_blob_id: branded<RawBlobId>(`sha256:${hash}`),
    bytes,
    raw_content_sha256: hash,
    mime_type: "text/html",
    byte_length: bytes.byteLength,
    created_at: branded("2026-09-15T00:00:00.000Z")
  };
  const manifest = createRawBlobManifest({
    raw_blob: blob,
    source_definition_id: source.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    acquired_at: "2026-09-15T00:00:00.000Z",
    provenance
  });
  assert.equal(manifest.object_key, rawBlobObjectKey(hash));
  assert.equal(manifest.bucket_id, PRODUCTION_RAW_BUCKET);

  const invalid = { ...blob, raw_content_sha256: "0".repeat(64) as RawContentSha256 };
  assert.throws(() => createRawBlobManifest({
    raw_blob: invalid,
    source_definition_id: source.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    acquired_at: "2026-09-15T00:00:00.000Z",
    provenance
  }), (error: unknown) => error instanceof ProductionPersistenceError
    && error.code === "HASH_MISMATCH");
});

test("existing Raw object is re-read and mismatches remain EVIDENCE_BLOCKED", async () => {
  const bytes = new TextEncoder().encode("trusted bytes");
  const hash = createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
  const blob: RawBlob = {
    raw_blob_id: branded<RawBlobId>(`sha256:${hash}`),
    bytes,
    raw_content_sha256: hash,
    mime_type: "application/octet-stream",
    byte_length: bytes.byteLength,
    created_at: branded("2026-09-15T00:00:00.000Z")
  };
  const storage = new FakeStorage("ALREADY_EXISTS", new TextEncoder().encode("tampered"));
  const repository = new FakeSourceFactRepository();
  const boundary = new ProductionRawObjectBoundary(storage, repository);

  await assert.rejects(boundary.persistSuccessfulAcquisition({
    raw_blob: blob,
    source_definition_id: source.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    acquired_at: "2026-09-15T00:00:00.000Z",
    provenance,
    bundle: sourceFactBundle(blob)
  }), (error: unknown) => error instanceof ProductionPersistenceError
    && error.code === "EVIDENCE_BLOCKED");
  assert.equal(repository.appendCount, 0);
});

test("an existing identical Raw object is verified before its manifest transaction", async () => {
  const bytes = new TextEncoder().encode("duplicate trusted bytes");
  const hash = createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
  const blob: RawBlob = {
    raw_blob_id: branded<RawBlobId>(`sha256:${hash}`),
    bytes,
    raw_content_sha256: hash,
    mime_type: "application/octet-stream",
    byte_length: bytes.byteLength,
    created_at: branded("2026-09-15T00:00:00.000Z")
  };
  const repository = new FakeSourceFactRepository();
  const boundary = new ProductionRawObjectBoundary(
    new FakeStorage("ALREADY_EXISTS", bytes),
    repository
  );
  const result = await boundary.persistSuccessfulAcquisition({
    raw_blob: blob,
    source_definition_id: source.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    acquired_at: "2026-09-15T00:00:00.000Z",
    provenance,
    bundle: sourceFactBundle(blob)
  });
  assert.equal(result.persistence_outcome, "APPENDED");
  assert.equal(repository.appendCount, 1);
});

test("Supabase Raw adapter always disables upsert and treats only conflicts as reuse", async () => {
  const calls: Array<{ path: string; upsert: boolean }> = [];
  const adapter = new SupabasePrivateRawObjectStorage({
    from: (bucket) => ({
      upload: async (path, _bytes, options) => {
        assert.equal(bucket, PRODUCTION_RAW_BUCKET);
        calls.push({ path, upsert: options.upsert });
        return { error: { statusCode: "409", message: "object already exists" } };
      },
      download: async () => ({ data: null, error: { message: "not found" } })
    })
  });
  const outcome = await adapter.putIfAbsent({
    bucket: PRODUCTION_RAW_BUCKET,
    object_key: `${"sha256/aa/bb/"}${"a".repeat(64)}`,
    bytes: new Uint8Array([1]),
    content_type: "application/octet-stream"
  });
  assert.equal(outcome, "ALREADY_EXISTS");
  assert.deepEqual(calls, [{ path: `sha256/aa/bb/${"a".repeat(64)}`, upsert: false }]);
});

test("orphan objects and missing manifest objects never become trusted input", async () => {
  const bytes = new TextEncoder().encode("orphan bytes");
  const hash = createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
  const blob: RawBlob = {
    raw_blob_id: branded<RawBlobId>(`sha256:${hash}`),
    bytes,
    raw_content_sha256: hash,
    mime_type: "application/octet-stream",
    byte_length: bytes.byteLength,
    created_at: branded("2026-09-15T00:00:00.000Z")
  };
  const storage = new FakeStorage("CREATED", bytes);
  const failingRepository = new FakeSourceFactRepository(true);
  const boundary = new ProductionRawObjectBoundary(storage, failingRepository);

  await assert.rejects(boundary.persistSuccessfulAcquisition({
    raw_blob: blob,
    source_definition_id: source.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    acquired_at: "2026-09-15T00:00:00.000Z",
    provenance,
    bundle: sourceFactBundle(blob)
  }), /simulated database failure/);
  await assert.rejects(boundary.readVerified(blob.raw_blob_id), (error: unknown) => {
    return error instanceof ProductionPersistenceError && error.code === "EVIDENCE_BLOCKED";
  });

  const manifest = createRawBlobManifest({
    raw_blob: blob,
    source_definition_id: source.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    acquired_at: "2026-09-15T00:00:00.000Z",
    provenance
  });
  const missingStorage = new FakeStorage("ALREADY_EXISTS", null);
  const manifestRepository = new FakeSourceFactRepository(false, manifest);
  await assert.rejects(
    new ProductionRawObjectBoundary(missingStorage, manifestRepository).readVerified(blob.raw_blob_id),
    (error: unknown) => error instanceof ProductionPersistenceError
      && error.code === "EVIDENCE_BLOCKED"
  );
});

test("PostgreSQL adapter commits run, manifest, Snapshot, and ExtractedRecord in one transaction", async () => {
  const executor = new RecordingPostgresExecutor();
  const persistence = new PostgresProductionPersistence(executor);
  const bytes = new TextEncoder().encode("transaction bytes");
  const hash = createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
  const blob: RawBlob = {
    raw_blob_id: branded<RawBlobId>(`sha256:${hash}`),
    bytes,
    raw_content_sha256: hash,
    mime_type: "text/html",
    byte_length: bytes.byteLength,
    created_at: branded("2026-09-15T00:00:00.000Z")
  };
  const manifest = createRawBlobManifest({
    raw_blob: blob,
    source_definition_id: source.source_definition_id,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    acquired_at: "2026-09-15T00:00:00.000Z",
    provenance
  });
  const base = sourceFactBundle(blob);
  const record = {
    extracted_record_id: branded("extracted-production-foundation"),
    snapshot_id: base.snapshot.snapshot_id,
    source_definition_id: source.source_definition_id,
    identity_candidates: [],
    raw_location_text: [],
    source_record_locator: { kind: "HTML" as const, selector: "article" },
    adapter_metadata: {},
    extraction: {
      extractor_name: "phase-1-test",
      extractor_version: "1",
      extracted_at: branded("2026-09-15T00:00:02.000Z")
    }
  } satisfies ExtractedRecord;

  await persistence.appendAcquisitionBundle({
    ...base,
    raw_blob_manifest: manifest,
    extracted_records: [record]
  });

  assert.equal(executor.transactionCount, 1);
  assert.deepEqual(executor.calls.map((call) => call.functionName), [
    "append_acquisition_run",
    "append_raw_blob_manifest",
    "append_raw_blob_acquisition",
    "append_snapshot",
    "append_extracted_record"
  ]);
  const snapshotCall = executor.calls.find((call) => call.functionName === "append_snapshot");
  assert.match(String(snapshotCall?.parameters[0]), /acquisition-production-foundation/u);
});

function sourceFactBundle(rawBlob: RawBlob): Omit<AcquisitionPersistenceBundle, "raw_blob_manifest"> {
  const snapshot: Snapshot = {
    snapshot_id: branded<SnapshotId>("snapshot-production-foundation"),
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    request_metadata: {
      locator: endpoint.locator,
      method: "GET",
      requested_at: branded("2026-09-15T00:00:00.000Z"),
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: 200,
      headers: {},
      mime_type: rawBlob.mime_type,
      content_length: rawBlob.byte_length,
      transport_error: null
    },
    transport_status: "SUCCESS",
    raw_blob_id: rawBlob.raw_blob_id,
    content_hash: rawBlob.raw_content_sha256,
    content_length: rawBlob.byte_length,
    observed_at: branded("2026-09-15T00:00:01.000Z")
  };
  return {
    acquisition_run: {
      acquisition_run_id: "acquisition-production-foundation",
      source_admission_artifact_id: "admission-artifact-1",
      endpoint_artifact_id: "endpoint-artifact-1",
      allowlist_artifact_id: "allowlist-artifact-1",
      status: "SUCCESS",
      started_at: "2026-09-15T00:00:00.000Z",
      completed_at: "2026-09-15T00:00:01.000Z",
      request_metadata: {},
      result_metadata: {},
      provenance
    },
    snapshot,
    extracted_records: [] as readonly ExtractedRecord[]
  };
}

class FakeStorage implements PrivateRawObjectStorage {
  constructor(
    readonly outcome: "CREATED" | "ALREADY_EXISTS",
    readonly bytes: Uint8Array | null
  ) {}

  async putIfAbsent() {
    return this.outcome;
  }

  async read() {
    return this.bytes ? new Uint8Array(this.bytes) : null;
  }
}

class FakeSourceFactRepository implements ProductionSourceFactRepository {
  appendCount = 0;

  constructor(
    readonly fail = false,
    readonly manifest: RawBlobManifest | null = null
  ) {}

  async appendAcquisitionBundle(): Promise<ProductionAppendOutcome> {
    this.appendCount += 1;
    if (this.fail) throw new Error("simulated database failure");
    return "APPENDED";
  }

  async getRawBlobManifest() {
    return this.manifest;
  }
}

class RecordingPostgresExecutor {
  transactionCount = 0;
  readonly calls: Array<{ functionName: string; parameters: readonly unknown[] }> = [];

  async query<Row>(sql: string, parameters: readonly unknown[] = []) {
    const functionName = /trusted_chain\.([a-z_]+)/u.exec(sql)?.[1] ?? "unknown";
    this.calls.push({ functionName, parameters });
    return { rows: [{ outcome: "APPENDED" }] as Row[] };
  }

  async transaction<Result>(work: (executor: RecordingPostgresExecutor) => Promise<Result>) {
    this.transactionCount += 1;
    return work(this);
  }
}
