import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  UTF8_TEXT_ENCODING,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type Snapshot
} from "../../ingestion";
import {
  BEIJING_ATTACHMENT_ENDPOINT,
  BEIJING_ATTACHMENT_EXPECTED_MIME,
  BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
  BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID
} from "./beijing-public-institution-attachment-contract";
import {
  BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION,
  BEIJING_PUBLIC_INSTITUTION_XLSX_RAW_SHA256,
  BeijingPublicInstitutionXlsxJobTableAdapter,
  type LegalDegreeObservation,
  type DerivedSourceFactEvidence,
  type ScopedMajorEvidence,
  type XlsxCellEvidence
} from "./beijing-public-institution-xlsx-job-table-adapter";

const outputDirectory = path.resolve(
  "outputs",
  "p2-04e",
  "p2-04e-observation-run-c240b387-9ed7-415a-b7f1-4b53cc95bf6c"
);

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const rawPath = path.join(outputDirectory, "raw.xlsx");
  const snapshotPath = path.join(outputDirectory, "snapshot.json");
  const bytes = new Uint8Array(await readFile(rawPath));
  const hash = sha256(bytes);
  if (hash !== BEIJING_PUBLIC_INSTITUTION_XLSX_RAW_SHA256) {
    throw new Error(`Sealed Raw SHA-256 mismatch: ${hash}`);
  }
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;
  if (snapshot.snapshot_id !== "p2-04e-observation-snapshot:d6368e80-f6b9-4f18-ad9a-2727a7dd8c8b") {
    throw new Error(`Unexpected sealed Snapshot: ${snapshot.snapshot_id}`);
  }
  const rawBlob: RawBlob = {
    raw_blob_id: `sha256:${hash}` as RawBlobId,
    bytes,
    raw_content_sha256: hash as RawContentSha256,
    mime_type: BEIJING_ATTACHMENT_EXPECTED_MIME,
    byte_length: bytes.byteLength,
    created_at: snapshot.observed_at
  };
  const result = new BeijingPublicInstitutionXlsxJobTableAdapter().parse({
    endpoint: endpoint(),
    snapshot,
    raw_blob: rawBlob
  });
  const recordAudits = result.records.map((record) => {
    const metadata = record.adapter_metadata[
      BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY
    ] as unknown as JobMetadata;
    return {
      extracted_record_id: record.extracted_record_id,
      raw_source_record_id: record.raw_source_record_id,
      title: record.raw_title?.text ?? null,
      organization: record.raw_organization_name?.text ?? null,
      source_record_locator: record.source_record_locator,
      fields: metadata.fields,
      scoped_major_evidence: metadata.scoped_major_evidence,
      requested_source_facts: metadata.requested_source_facts,
      legal_degree_observations: metadata.legal_degree_observations,
      completeness: metadata.completeness
    };
  });
  const report = {
    status: "REAL_XLSX_OFFLINE_PARSED",
    network_requests: 0,
    parser_version: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_PARSER_VERSION,
    raw: {
      path: rawPath,
      sha256: hash,
      byte_length: bytes.byteLength
    },
    snapshot_id: snapshot.snapshot_id,
    workbook: result.workbook_audit,
    jobs: {
      total_rows: result.workbook_audit.total_candidate_rows,
      successful_rows: result.workbook_audit.successful_rows,
      empty_rows: result.workbook_audit.empty_rows,
      unparseable_rows: result.workbook_audit.unparseable_rows,
      records: recordAudits
    },
    legal_focus: legalFocus(recordAudits),
    completeness: aggregateCompleteness(recordAudits),
    downstream_objects_created: {
      requirement: 0,
      eligibility: 0,
      candidate_profile: 0,
      canonical_opportunity: 0
    }
  };
  await writeFile(
    path.join(outputDirectory, "offline-parse-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(outputDirectory, "extracted-records.json"),
    `${JSON.stringify(result.records, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

interface JobMetadata {
  readonly fields: Readonly<Record<string, XlsxCellEvidence>>;
  readonly scoped_major_evidence: readonly ScopedMajorEvidence[];
  readonly requested_source_facts: Readonly<Record<string, DerivedSourceFactEvidence>>;
  readonly legal_degree_observations: LegalDegreeObservation;
  readonly completeness: {
    readonly not_observed: readonly string[];
    readonly unparsed_clause: readonly string[];
    readonly ambiguous: readonly string[];
    readonly domain_gap_observed: readonly string[];
  };
}

function legalFocus(records: readonly ReturnType<typeof recordAuditShape>[]) {
  return {
    explicit_juris_master_non_law: records.filter(
      (record) => record.legal_degree_observations.explicit_juris_master_non_law
    ).map(summary),
    ambiguous_juris_master: records.filter(
      (record) => record.legal_degree_observations.ambiguous_juris_master
    ).map(summary),
    law_academic_master: records.filter(
      (record) => record.legal_degree_observations.law_academic_master
    ).map(summary),
    bachelor_law_or_legal_category: records.filter((record) => {
      const bachelor = record.scoped_major_evidence.find((item) => item.scope === "BACHELOR");
      return bachelor?.extracted_raw_text
        ? /(?:法学|法律)/u.test(bachelor.extracted_raw_text)
        : false;
    }).map(summary),
    bachelor_explicit_unrestricted_with_legal_master: records.filter((record) => {
      const bachelor = record.scoped_major_evidence.find((item) => item.scope === "BACHELOR");
      const master = record.scoped_major_evidence.find((item) => item.scope === "MASTER");
      return bachelor?.extracted_raw_text === "不限"
        && Boolean(master?.extracted_raw_text && /(?:法学|法律)/u.test(master.extracted_raw_text));
    }).map(summary),
    legal_professional_qualification: records.filter(
      (record) => record.legal_degree_observations.legal_professional_qualification
    ).map(summary)
  };
}

function aggregateCompleteness(records: readonly ReturnType<typeof recordAuditShape>[]) {
  return {
    not_observed: records.reduce((sum, record) => sum + record.completeness.not_observed.length, 0),
    unparsed_clause: records.reduce(
      (sum, record) => sum + record.completeness.unparsed_clause.length,
      0
    ),
    ambiguous: records.reduce((sum, record) => sum + record.completeness.ambiguous.length, 0),
    domain_gap_observed: records.reduce(
      (sum, record) => sum + record.completeness.domain_gap_observed.length,
      0
    )
  };
}

function recordAuditShape(value: {
  readonly title: string | null;
  readonly organization: string | null;
  readonly fields: Readonly<Record<string, XlsxCellEvidence>>;
  readonly scoped_major_evidence: readonly ScopedMajorEvidence[];
  readonly requested_source_facts: Readonly<Record<string, DerivedSourceFactEvidence>>;
  readonly legal_degree_observations: LegalDegreeObservation;
  readonly completeness: JobMetadata["completeness"];
}) {
  return value;
}

function summary(record: ReturnType<typeof recordAuditShape>) {
  return { title: record.title, organization: record.organization };
}

function endpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: BEIJING_ATTACHMENT_SOURCE_DEFINITION_ID,
    name: traceable("北京急救中心2026年度第四批公开招聘工作人员职位及要求表"),
    description: traceable("已封存 P2-04E Observation Canary Raw 的离线岗位级解析。"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_ATTACHMENT_ENDPOINT,
    request_method: "GET",
    content_kind: "FILE",
    adapter_key: BEIJING_PUBLIC_INSTITUTION_XLSX_JOB_TABLE_ADAPTER_KEY,
    decoded_text_encoding: UTF8_TEXT_ENCODING,
    collection_config: {
      timeout_ms: 15_000,
      max_items: 1,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}
