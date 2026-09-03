import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type {
  IsoDateTime,
  Organization,
  RawBlob,
  RawBlobId,
  RawContentSha256,
  RecruitmentEndpoint,
  Snapshot,
  SourceDefinition
} from "../lib/ingestion";
import {
  BeijingPublicInstitutionDetailHtmlAdapter
} from "../lib/live-canary/p2-04d/beijing-public-institution-detail-html-adapter";
import {
  LOCAL_PRODUCTION_LIKE_MIGRATION,
  ProductionIngestionRepository,
  type ProductionCaptureWriteInput
} from "../lib/production-ingestion";
import {
  IMMUTABLE_PREVIEW_DATASET_SCHEMA,
  type ImmutablePreviewDatasetManifest
} from "../lib/read-only-api/runtime-composition";
import type { SourceHealth } from "../lib/source-scheduler/types";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canaryDirectory = path.join(
  repositoryRoot,
  "outputs",
  "p2-04d",
  "p2-04d-run-3648affe-5bd5-471c-b557-085bfed0a3be"
);
const outputDirectory = path.join(repositoryRoot, "immutable-preview", "p2-07");
const databasePath = path.join(outputDirectory, "beijing-official-preview.sqlite");
const manifestPath = path.join(outputDirectory, "beijing-official-preview.manifest.json");
const temporaryDatabasePath = `${databasePath}.preparing`;

interface CanaryReport {
  readonly authorization: {
    readonly authorization_id: string;
    readonly source_admission_id: string;
    readonly endpoint: string;
    readonly recruitment_endpoint_id: string;
    readonly endpoint_purpose: "JOB_DETAIL";
    readonly allowed_http_method: "GET";
    readonly collection_run_id: string;
    readonly reviewer: string;
    readonly issued_at: string;
    readonly evidence_id: string;
    readonly scope: "ONE_ENDPOINT_ONE_RUN";
    readonly manual_confirmation: true;
  };
  readonly admission: {
    readonly admission_level: "B";
    readonly admission_decision: "APPROVED";
    readonly automation_basis: "HUMAN_REVIEWED_CANARY";
    readonly robots: "UNKNOWN";
    readonly terms: "UNKNOWN";
  };
  readonly network: {
    readonly requested_at: string;
    readonly http_status: number;
    readonly response_size: number;
  };
  readonly raw: {
    readonly raw_blob_id: string;
    readonly sha256: string;
    readonly mime_type: string;
    readonly byte_length: number;
    readonly created_at: string;
  };
  readonly snapshot: Snapshot;
}

prepare();

function prepare() {
  if (existsSync(databasePath) || existsSync(manifestPath) || existsSync(temporaryDatabasePath)) {
    throw new Error("Immutable Preview Data Source already exists; preparation refuses to overwrite it");
  }
  mkdirSync(outputDirectory, { recursive: true });
  const report = JSON.parse(readFileSync(path.join(canaryDirectory, "canary-report.json"), "utf8")) as CanaryReport;
  const rawBytes = new Uint8Array(readFileSync(path.join(canaryDirectory, "raw.html")));
  verifyCanaryRaw(report, rawBytes);

  const database = new DatabaseSync(temporaryDatabasePath);
  try {
    database.exec(LOCAL_PRODUCTION_LIKE_MIGRATION);
    const repository = new ProductionIngestionRepository(database);
    const capture = officialBeijingCapture(report, rawBytes);
    const result = repository.writeCapturedRecords(capture);
    if (result.status !== "CREATED" || result.canonical_opportunity_ids.length !== 1) {
      throw new Error("Official Beijing preparation did not produce exactly one canonical opportunity");
    }
    if (result.requirement_fact_ids.length !== 0 || result.eligibility_assessment_id !== null) {
      throw new Error("Immutable Preview preparation must not create Requirement or Eligibility results");
    }
  } catch (error) {
    database.close();
    rmSync(temporaryDatabasePath, { force: true });
    throw error;
  }
  database.close();
  renameSync(temporaryDatabasePath, databasePath);

  const databaseBytes = readFileSync(databasePath);
  const manifest: ImmutablePreviewDatasetManifest = {
    schema_version: IMMUTABLE_PREVIEW_DATASET_SCHEMA,
    dataset_id: "p2-07-preview:beijing-official:2026-09-02",
    classification: "VERIFIED_OFFICIAL_CAPTURE_ONLY",
    created_at: report.snapshot.observed_at,
    database_sha256: createHash("sha256").update(databaseBytes).digest("hex"),
    database_byte_length: statSync(databasePath).size,
    source_definition_ids: ["source-cn-beijing-government-public-institution-recruitment"],
    source_health: [sourceHealth(report)]
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
}

function officialBeijingCapture(
  report: CanaryReport,
  rawBytes: Uint8Array
): ProductionCaptureWriteInput {
  const sourceDefinitionId = "source-cn-beijing-government-public-institution-recruitment" as SourceDefinition["source_definition_id"];
  const organizations: readonly Organization[] = [{
    organization_id: "organization-cn-beijing-municipal-government" as Organization["organization_id"],
    name: traceable("北京市人民政府"),
    aliases: [],
    country_code: "CN"
  }, {
    organization_id: "organization-cn-beijing-emergency-medical-center" as Organization["organization_id"],
    name: traceable("北京急救中心"),
    aliases: [],
    country_code: "CN"
  }];
  const sourceDefinition: SourceDefinition = {
    source_definition_id: sourceDefinitionId,
    publisher_organization_id: organizations[0]!.organization_id,
    name: traceable("北京市人民政府事业单位招聘"),
    publisher_kind: "GOVERNMENT_PORTAL",
    authority_level: "OFFICIAL",
    scope: "REGIONAL",
    enabled: false
  };
  const endpoint: RecruitmentEndpoint = {
    recruitment_endpoint_id: report.authorization.recruitment_endpoint_id as RecruitmentEndpoint["recruitment_endpoint_id"],
    source_definition_id: sourceDefinitionId,
    name: traceable("北京急救中心2026年度第四批公开招聘公告详情"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: report.authorization.endpoint,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: "cn-beijing-government-public-institution-detail-html",
    decoded_text_encoding: "UTF-8",
    collection_config: {
      timeout_ms: 10_000,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
  const rawBlob: RawBlob = {
    raw_blob_id: report.raw.raw_blob_id as RawBlobId,
    bytes: rawBytes,
    raw_content_sha256: report.raw.sha256 as RawContentSha256,
    mime_type: report.raw.mime_type,
    byte_length: report.raw.byte_length,
    created_at: report.raw.created_at as IsoDateTime
  };
  const extractedRecords = new BeijingPublicInstitutionDetailHtmlAdapter().extract({
    endpoint,
    snapshot: report.snapshot,
    raw_blob: rawBlob
  });
  return {
    organizations,
    source_definition: sourceDefinition,
    endpoint,
    authorization: {
      ...report.authorization,
      admission_level: report.admission.admission_level,
      admission_decision: report.admission.admission_decision,
      automation_basis: report.admission.automation_basis,
      authorization_consumed: true,
      replay_denial_code: "AUTHORIZATION_ALREADY_USED"
    },
    collection_run: {
      collection_run_id: report.authorization.collection_run_id,
      source_definition_id: sourceDefinitionId,
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      authorization_id: report.authorization.authorization_id,
      started_at: report.network.requested_at,
      completed_at: report.snapshot.observed_at,
      status: "SUCCESS",
      request_metadata: { locator: endpoint.locator, method: "GET" },
      result_metadata: {
        request_count: 1,
        page_count: 1,
        transport_status: "SUCCESS",
        http_status: report.network.http_status,
        response_size: report.network.response_size
      },
      scheduler_dispatch_reference: null
    },
    raw_blob: rawBlob,
    raw_object_path: `verified-canary-raw://${report.raw.sha256}`,
    original_url: endpoint.locator,
    snapshot: report.snapshot,
    extracted_records: extractedRecords
  };
}

function verifyCanaryRaw(report: CanaryReport, bytes: Uint8Array) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== report.raw.sha256 || bytes.byteLength !== report.raw.byte_length) {
    throw new Error("P2-04D Raw does not match its verified Canary report");
  }
}

function sourceHealth(report: CanaryReport): SourceHealth {
  return {
    source_admission_id: report.authorization.source_admission_id as SourceHealth["source_admission_id"],
    recruitment_endpoint_id: report.authorization.recruitment_endpoint_id as SourceHealth["recruitment_endpoint_id"],
    consecutive_success: 1,
    consecutive_failure: 0,
    last_success: report.snapshot.observed_at,
    last_failure: null,
    last_http_status: report.network.http_status,
    last_content_hash: report.raw.sha256,
    structure_change_detected: false,
    robots_status: report.admission.robots,
    terms_status: report.admission.terms,
    status: "HEALTHY"
  };
}

function original(text: string) {
  return { text, encoding: "UTF-8" } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}
