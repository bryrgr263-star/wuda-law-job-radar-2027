import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RequirementEvidenceFragment,
  type Snapshot
} from "../../ingestion";
import { GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID } from "../p2-legal-01/guizhou-legal-canary-admission-preflight";
import {
  GuizhouLegalXlsxRequirementObservationAdapter,
  P2_LEGAL_05_PARSER_VERSION,
  P2_LEGAL_05_RAW_SHA256,
  P2_LEGAL_05_SNAPSHOT_ID,
  createGuizhouLegalRequirementEndpoint,
  type GuizhouLegalXlsxRequirementParseResult,
  type SourceNeutralRequirementObservationCandidate
} from "./guizhou-legal-xlsx-requirement-adapter";

const executionIndexPath = path.resolve(
  "outputs",
  "p2-legal-04",
  "attachment-observation-canary-execution.json"
);

const outputDirectory = path.resolve(
  "outputs",
  "p2-legal-05",
  "p2-legal-05-snapshot-194cfc4e-18ec-4f79-9a61-0551bafbcfa9"
);

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const rawPath = await readSealedRawPath();
  const snapshotPath = path.join(path.dirname(rawPath), "snapshot.json");
  const bytes = new Uint8Array(await readFile(rawPath));
  const hash = sha256(bytes);
  if (hash !== P2_LEGAL_05_RAW_SHA256) {
    throw new Error(`Sealed Raw SHA-256 mismatch: ${hash}`);
  }
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;
  if (
    snapshot.snapshot_id !== P2_LEGAL_05_SNAPSHOT_ID
    || snapshot.content_hash !== P2_LEGAL_05_RAW_SHA256
    || snapshot.content_length !== bytes.byteLength
    || snapshot.transport_status !== "SUCCESS"
  ) {
    throw new Error("Sealed Snapshot provenance does not match P2-LEGAL-04");
  }
  const mimeType = snapshot.response_metadata.mime_type;
  if (!mimeType) throw new Error("Sealed Snapshot has no MIME type");
  const rawBlob: RawBlob = {
    raw_blob_id: `sha256:${hash}` as RawBlobId,
    bytes,
    raw_content_sha256: hash as RawContentSha256,
    mime_type: mimeType,
    byte_length: bytes.byteLength,
    created_at: snapshot.observed_at
  };
  const result = new GuizhouLegalXlsxRequirementObservationAdapter().parse({
    endpoint: createGuizhouLegalRequirementEndpoint(GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID),
    snapshot,
    raw_blob: rawBlob
  });
  const observationArtifact = buildObservationArtifact(result, rawPath, bytes.byteLength);
  const auditReport = buildAuditReport(result, rawPath, bytes.byteLength);

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(
    path.join(outputDirectory, "offline-xlsx-requirement-observation.json"),
    observationArtifact
  );
  await writeJson(
    path.join(outputDirectory, "offline-xlsx-requirement-extraction-report.json"),
    auditReport
  );
  process.stdout.write(`${JSON.stringify(auditReport, null, 2)}\n`);
}

function buildObservationArtifact(
  result: GuizhouLegalXlsxRequirementParseResult,
  rawPath: string,
  byteLength: number
) {
  return {
    status: "OFFLINE_XLSX_REQUIREMENT_OBSERVATION_READY",
    network_requests: 0,
    parser_version: P2_LEGAL_05_PARSER_VERSION,
    sealed_input: {
      raw_path: rawPath,
      raw_sha256: P2_LEGAL_05_RAW_SHA256,
      raw_byte_length: byteLength,
      snapshot_id: P2_LEGAL_05_SNAPSHOT_ID
    },
    extracted_record: result.record,
    fields: result.fields,
    evidence_fragments: result.evidence_fragments,
    requirement_fact_candidates: result.fact_candidates,
    requirement_observation_candidates: result.observation_candidates,
    requirement_set_readiness: result.requirement_set_readiness,
    downstream_objects_created: {
      requirement_set: 0,
      eligibility_assessment: 0,
      candidate_profile: 0,
      canonical_opportunity: 0
    }
  };
}

function buildAuditReport(
  result: GuizhouLegalXlsxRequirementParseResult,
  rawPath: string,
  byteLength: number
) {
  const fragments = new Map(result.evidence_fragments.map((fragment) => [
    fragment.requirement_evidence_fragment_id,
    fragment
  ]));
  const facts = new Map(result.fact_candidates.map((fact) => [fact.fact_candidate_id, fact]));
  const unresolvedStatuses = [
    "UNPARSED_CLAUSE",
    "AMBIGUOUS",
    "DOMAIN_GAP_OBSERVED",
    "NOT_OBSERVED"
  ] as const;
  return {
    status: "P2_LEGAL_05_OFFLINE_XLSX_REQUIREMENT_EXTRACTION_COMPLETE",
    network_requests: 0,
    parser_version: P2_LEGAL_05_PARSER_VERSION,
    raw: {
      path: rawPath,
      sha256: P2_LEGAL_05_RAW_SHA256,
      byte_length: byteLength
    },
    snapshot_id: P2_LEGAL_05_SNAPSHOT_ID,
    workbook: result.workbook_audit,
    target_job: {
      job_code: result.fields.job_code,
      job_title: result.fields.title,
      organization: result.fields.organization,
      recruitment_count: result.fields.recruitment_count
    },
    requirement_fields: result.fields,
    requirement_evidence: result.observation_candidates.map((observation) => ({
      observation_candidate_id: observation.observation_candidate_id,
      dimension: observation.dimension_hint ?? null,
      scope: observation.subject_scope ?? null,
      raw_value: observation.raw_value,
      normalized_value: observation.normalized_value,
      certainty: observation.certainty,
      status: observation.status,
      clause_role: observation.clause_role,
      blocks_completeness: observation.blocks_completeness,
      evidence: observation.evidence_fragment_ids.map((fragmentId) => {
        const fragment = fragments.get(fragmentId);
        if (!fragment) throw new Error(`Missing Evidence Fragment ${fragmentId}`);
        return evidenceAudit(fragment);
      }),
      fact_candidates: observation.fact_candidate_ids.map((factId) => {
        const fact = facts.get(factId);
        if (!fact) throw new Error(`Missing Requirement Fact candidate ${factId}`);
        return fact;
      })
    })),
    legal_focus: result.legal_focus,
    unresolved_items: Object.fromEntries(unresolvedStatuses.map((status) => [
      status,
      result.observation_candidates
        .filter((observation) => observation.status === status)
        .map((observation) => unresolvedAudit(observation, fragments))
    ])),
    requirement_set_readiness: result.requirement_set_readiness,
    downstream_objects_created: {
      requirement_set: 0,
      eligibility_assessment: 0,
      candidate_profile: 0,
      canonical_opportunity: 0
    }
  };
}

function evidenceAudit(fragment: RequirementEvidenceFragment) {
  return {
    requirement_evidence_fragment_id: fragment.requirement_evidence_fragment_id,
    snapshot_id: fragment.snapshot_id,
    extracted_record_id: fragment.extracted_record_id,
    sheet: fragment.locator.kind === "SPREADSHEET" ? fragment.locator.sheet : null,
    cell_or_range: fragment.locator.kind === "SPREADSHEET"
      ? fragment.locator.cell_or_range
      : null,
    field_path: fragment.locator.field_path ?? null,
    raw_text: fragment.observed_value_state === "TEXT" ? fragment.original_text.text : null,
    normalized_text: fragment.observed_value_state === "TEXT"
      ? fragment.normalized_text?.text ?? null
      : null,
    academic_program_directory: fragment.academic_program_directory ?? null,
    extractor_version: fragment.extractor_version,
    parser_version: fragment.parser_version
  };
}

function unresolvedAudit(
  observation: SourceNeutralRequirementObservationCandidate,
  fragments: ReadonlyMap<RequirementEvidenceFragment["requirement_evidence_fragment_id"], RequirementEvidenceFragment>
) {
  return {
    observation_candidate_id: observation.observation_candidate_id,
    dimension: observation.dimension_hint ?? null,
    scope: observation.subject_scope ?? null,
    raw_value: observation.raw_value,
    normalized_value: observation.normalized_value,
    clause_role: observation.clause_role,
    evidence: observation.evidence_fragment_ids.map((fragmentId) => {
      const fragment = fragments.get(fragmentId);
      if (!fragment) throw new Error(`Missing Evidence Fragment ${fragmentId}`);
      return evidenceAudit(fragment);
    })
  };
}

async function readSealedRawPath() {
  const execution = JSON.parse(await readFile(executionIndexPath, "utf8")) as unknown;
  if (!isRecord(execution) || !isRecord(execution.report) || !isRecord(execution.report.raw)) {
    throw new Error("P2-LEGAL-04 execution record has no sealed Raw metadata");
  }
  const localArtifact = execution.report.raw.local_artifact;
  if (typeof localArtifact !== "string" || localArtifact.length === 0) {
    throw new Error("P2-LEGAL-04 execution record has no local Raw path");
  }
  return path.resolve(localArtifact);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
