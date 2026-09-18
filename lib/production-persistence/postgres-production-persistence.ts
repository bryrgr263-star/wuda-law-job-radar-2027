import {
  assertTrustedRestorationExecution,
  type TrustedRestorationExecution,
  type TrustedRestorationJournalRepository,
  type TrustedRestorationRecord
} from "../ingestion";
import {
  canonicalDeserialize,
  canonicalSerialize
} from "../ingestion/normalization/canonical-artifact-registry";
import {
  assertSourcePersistenceVersion,
  ProductionPersistenceError,
  type AcquisitionPersistenceBundle,
  type PostgresExecutor,
  type ProductionAppendOutcome,
  type ProductionSourceFactRepository,
  type ProductionSourceRegistryRepository,
  type RawBlobManifest,
  type SourcePersistenceVersion
} from "./contracts";
import {
  loadVerifiedPostgresJournal,
  type ProductionJournalOptions
} from "./production-journal";

const sourceAppendFunctions = {
  ORGANIZATION: "append_source_organization_version",
  SOURCE_DEFINITION: "append_source_definition_version",
  RECRUITMENT_ENDPOINT: "append_recruitment_endpoint_version",
  ADAPTER_REGISTRATION: "append_adapter_registration_version",
  SOURCE_ADMISSION: "append_source_admission_version",
  OFFICIAL_ENDPOINT_ALLOWLIST: "append_official_endpoint_allowlist_version"
} as const;

const sourceTables = [
  "source_organization_versions",
  "adapter_registration_versions",
  "source_definition_versions",
  "recruitment_endpoint_versions",
  "source_admission_versions",
  "official_endpoint_allowlist_versions"
] as const;

const sourceKindOrder = [
  "ORGANIZATION",
  "ADAPTER_REGISTRATION",
  "SOURCE_DEFINITION",
  "RECRUITMENT_ENDPOINT",
  "SOURCE_ADMISSION",
  "OFFICIAL_ENDPOINT_ALLOWLIST"
] as const;

export class PostgresProductionPersistence<Command = unknown>
implements ProductionSourceRegistryRepository,
ProductionSourceFactRepository,
TrustedRestorationJournalRepository<Command> {
  readonly #database: PostgresExecutor;
  readonly #journal: ProductionJournalOptions | null;

  constructor(database: PostgresExecutor, journal: ProductionJournalOptions | null = null) {
    this.#database = database;
    this.#journal = journal;
  }

  async list(): Promise<readonly TrustedRestorationRecord<Command>[]> {
    if (!this.#journal) throw new Error("Production journal options are required");
    return loadVerifiedPostgresJournal({ database: this.#database, options: this.#journal });
  }

  async appendExecution(execution: TrustedRestorationExecution<Command>) {
    if (!this.#journal) throw new Error("Production journal options are required");
    const validated = assertTrustedRestorationExecution(execution);
    if (validated.record.provenance.scope !== this.#journal.scope) {
      throw new ProductionPersistenceError("INTEGRITY_MISMATCH", "Journal scope mismatch");
    }
    const { integrity_hash: ignored, ...recordWithoutIntegrity } = validated.record;
    const payload = {
      stream_id: this.#journal.stream_id,
      writer_epoch: this.#journal.writer_epoch,
      command_canonical_bytes: canonicalSerialize(validated.record.command),
      record_integrity_bytes: canonicalSerialize(recordWithoutIntegrity),
      ...validated
    };
    return this.#appendJson("append_execution", payload);
  }

  async appendVersion(version: SourcePersistenceVersion) {
    assertSourcePersistenceVersion(version);
    const functionName = sourceAppendFunctions[version.artifact.kind];
    return this.#appendJson(functionName, version);
  }

  async listVersions() {
    const versions: SourcePersistenceVersion[] = [];
    for (const table of sourceTables) {
      const result = await this.#database.query<{ record_json: unknown }>(
        `select record_json from trusted_chain.${table} order by revision, created_at, artifact_id`
      );
      for (const row of result.rows) {
        const version = decodeRecord<SourcePersistenceVersion>(row.record_json);
        assertSourcePersistenceVersion(version);
        versions.push(version);
      }
    }
    return versions.sort(compareSourceVersions).map((version) => structuredClone(version));
  }

  async appendAcquisitionBundle(bundle: AcquisitionPersistenceBundle) {
    return this.#database.transaction(async (transaction) => {
      const outcomes: ProductionAppendOutcome[] = [];
      outcomes.push(await appendJson(transaction, "append_acquisition_run", bundle.acquisition_run));
      if (bundle.raw_blob_manifest) {
        outcomes.push(await appendJson(
          transaction,
          "append_raw_blob_manifest",
          bundle.raw_blob_manifest
        ));
        outcomes.push(await appendJson(transaction, "append_raw_blob_acquisition", {
          raw_blob_id: bundle.raw_blob_manifest.raw_blob_id,
          acquisition_run_id: bundle.acquisition_run.acquisition_run_id,
          acquired_at: bundle.raw_blob_manifest.first_acquired_at
        }));
      }
      outcomes.push(await appendJson(transaction, "append_snapshot", {
        ...bundle.snapshot,
        acquisition_run_id: bundle.acquisition_run.acquisition_run_id
      }));
      for (const record of bundle.extracted_records) {
        outcomes.push(await appendJson(transaction, "append_extracted_record", record));
      }
      return outcomes.every((outcome) => outcome === "IDEMPOTENT_REUSE")
        ? "IDEMPOTENT_REUSE"
        : "APPENDED";
    });
  }

  async getRawBlobManifest(rawBlobId: string) {
    const result = await this.#database.query<{ record_json: unknown }>(
      "select record_json from trusted_chain.raw_blobs where raw_blob_id = $1",
      [rawBlobId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) {
      throw new ProductionPersistenceError("COLLISION", `Duplicate RawBlob manifest: ${rawBlobId}`);
    }
    return structuredClone(decodeRecord<RawBlobManifest>(result.rows[0].record_json));
  }

  async #appendJson(functionName: string, record: unknown) {
    return appendJson(this.#database, functionName, record);
  }
}

async function appendJson(
  executor: PostgresExecutor,
  functionName: string,
  record: unknown
): Promise<ProductionAppendOutcome> {
  const result = await executor.query<{ outcome: ProductionAppendOutcome }>(
    `select trusted_chain.${functionName}($1::jsonb) as outcome`,
    [canonicalSerialize(record)]
  );
  const outcome = result.rows[0]?.outcome;
  if (outcome !== "APPENDED" && outcome !== "IDEMPOTENT_REUSE") {
    throw new ProductionPersistenceError(
      "COLLISION",
      `PostgreSQL append function returned an invalid outcome: ${functionName}`
    );
  }
  return outcome;
}

function decodeRecord<Value>(value: unknown): Value {
  if (typeof value === "string") return canonicalDeserialize<Value>(value);
  return structuredClone(value) as Value;
}

function compareSourceVersions(left: SourcePersistenceVersion, right: SourcePersistenceVersion) {
  const kindOrder = sourceKindOrder.indexOf(left.artifact.kind)
    - sourceKindOrder.indexOf(right.artifact.kind);
  if (kindOrder !== 0) return kindOrder;
  if (left.stream_id !== right.stream_id) return left.stream_id.localeCompare(right.stream_id);
  return left.revision - right.revision;
}
