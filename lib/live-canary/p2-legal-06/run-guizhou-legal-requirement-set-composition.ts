import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RequirementEvidenceFragment,
  type Snapshot,
  type SnapshotId
} from "../../ingestion";
import { GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID } from "../p2-legal-01/guizhou-legal-canary-admission-preflight";
import { GUIZHOU_ATTACHMENT_EXPECTED_MIME } from "../p2-legal-04/guizhou-attachment-observation-canary";
import {
  GuizhouLegalXlsxRequirementObservationAdapter,
  P2_LEGAL_05_RAW_SHA256,
  P2_LEGAL_05_SNAPSHOT_ID,
  createGuizhouLegalRequirementEndpoint
} from "../p2-legal-05/guizhou-legal-xlsx-requirement-adapter";
import {
  P2_LEGAL_06_COMPOSER_VERSION,
  P2_LEGAL_06_NOTICE_RAW_SHA256,
  P2_LEGAL_06_NOTICE_SNAPSHOT_ID,
  P2_LEGAL_06_TARGET_JOB_CODE,
  buildGuizhouJobTableRequirementSource,
  buildGuizhouNoticeRequirementSource,
  composeRequirementSet,
  createP2Legal06OpportunityVersionId
} from "./guizhou-legal-requirement-set-composer";

const noticeExecutionIndexPath = path.resolve(
  "outputs",
  "p2-legal-02",
  "notice-observation-canary-execution.json"
);
const attachmentExecutionIndexPath = path.resolve(
  "outputs",
  "p2-legal-04",
  "attachment-observation-canary-execution.json"
);
const outputDirectory = path.resolve(
  "outputs",
  "p2-legal-06",
  `p2-legal-06-job-${P2_LEGAL_06_TARGET_JOB_CODE}`
);

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const noticeCapture = await loadCapture(
    noticeExecutionIndexPath,
    P2_LEGAL_06_NOTICE_SNAPSHOT_ID,
    P2_LEGAL_06_NOTICE_RAW_SHA256
  );
  const attachmentCapture = await loadCapture(
    attachmentExecutionIndexPath,
    P2_LEGAL_05_SNAPSHOT_ID,
    P2_LEGAL_05_RAW_SHA256
  );
  if (attachmentCapture.snapshot.response_metadata.mime_type !== GUIZHOU_ATTACHMENT_EXPECTED_MIME) {
    throw new Error("Sealed attachment Snapshot MIME is not the admitted XLSX MIME");
  }
  const rawBlob: RawBlob = {
    raw_blob_id: `sha256:${attachmentCapture.sha256}` as RawBlobId,
    bytes: attachmentCapture.bytes,
    raw_content_sha256: attachmentCapture.sha256 as RawContentSha256,
    mime_type: GUIZHOU_ATTACHMENT_EXPECTED_MIME,
    byte_length: attachmentCapture.bytes.byteLength,
    created_at: attachmentCapture.snapshot.observed_at
  };
  const xlsxResult = new GuizhouLegalXlsxRequirementObservationAdapter().parse({
    endpoint: createGuizhouLegalRequirementEndpoint(GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID),
    snapshot: attachmentCapture.snapshot,
    raw_blob: rawBlob
  });
  const noticeSource = buildGuizhouNoticeRequirementSource(
    noticeCapture.bytes,
    noticeCapture.snapshot.snapshot_id
  );
  const jobTableSource = buildGuizhouJobTableRequirementSource(xlsxResult);
  const identity = {
    opportunity_version_id: createP2Legal06OpportunityVersionId(
      GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
      P2_LEGAL_06_TARGET_JOB_CODE,
      [noticeSource.snapshot_id, jobTableSource.snapshot_id]
    ),
    source_definition_id: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
    job_code: P2_LEGAL_06_TARGET_JOB_CODE,
    title: String(xlsxResult.fields.title.raw_value),
    organization: String(xlsxResult.fields.organization.raw_value)
  };
  const composition = composeRequirementSet(identity, [noticeSource, jobTableSource]);
  const fragmentCatalog = new Map(composition.requirement_set.evidence_fragments.map((fragment) => [
    fragment.requirement_evidence_fragment_id,
    fragment
  ]));
  const report = {
    status: "P2_LEGAL_06_REQUIREMENT_SET_COMPOSITION_COMPLETE",
    network_requests: 0,
    composer_version: P2_LEGAL_06_COMPOSER_VERSION,
    inputs: {
      announcement: captureAudit(noticeCapture),
      job_table: captureAudit(attachmentCapture)
    },
    requirement_set: {
      opportunity_source_identity: composition.identity,
      requirement_set_id: composition.requirement_set.requirement_set_id,
      completeness_status: composition.requirement_set.completeness.status,
      blocker_codes: uniqueSorted(composition.composition_blockers.map((blocker) => blocker.code)),
      covered_snapshot_ids: composition.requirement_set.completeness.covered_snapshot_ids,
      covered_extracted_record_ids: composition.requirement_set.completeness.covered_extracted_record_ids
    },
    requirements: composition.requirement_set.facts.map((fact) => {
      const audit = composition.fact_audit.find(
        (item) => item.requirement_fact_id === fact.requirement_fact_id
      );
      if (!audit) throw new Error(`Missing Fact composition audit ${fact.requirement_fact_id}`);
      return {
        requirement_fact_id: fact.requirement_fact_id,
        dimension: fact.dimension,
        scope: fact.subject_scope,
        operator: fact.operator,
        value: fact.value,
        certainty: fact.certainty,
        status: "CONFIRMED_REQUIREMENT",
        sources: audit.sources,
        evidence: audit.evidence_fragment_ids.map((fragmentId) => {
          const fragment = fragmentCatalog.get(fragmentId);
          if (!fragment) throw new Error(`Missing Fact Evidence Fragment ${fragmentId}`);
          return evidenceAudit(fragment, sourceForSnapshot(fragment.snapshot_id));
        })
      };
    }),
    observations: composition.observation_audit.map((observation) => ({
      ...observation,
      evidence: observation.evidence_fragment_ids.map((fragmentId) => {
        const fragment = fragmentCatalog.get(fragmentId);
        if (!fragment) throw new Error(`Missing Observation Evidence Fragment ${fragmentId}`);
        return evidenceAudit(fragment, observation.source);
      })
    })),
    source_absences: composition.source_absences,
    unresolved: {
      AMBIGUOUS: composition.composition_blockers.filter((blocker) => blocker.code === "AMBIGUOUS"),
      UNPARSED_CLAUSE: composition.composition_blockers.filter(
        (blocker) => blocker.code === "UNPARSED_CLAUSE"
      ),
      DOMAIN_GAP_OBSERVED: composition.composition_blockers.filter(
        (blocker) => blocker.code === "DOMAIN_GAP_OBSERVED"
      ),
      SOURCE_CONFLICT: composition.source_conflicts
    },
    legal_focus: {
      explicit_law_non_law: xlsxResult.legal_focus.explicit_law_non_law,
      explicit_juris_master_non_law: xlsxResult.legal_focus.explicit_juris_master_non_law,
      law_0351_only: xlsxResult.legal_focus.graduate_program_codes.some(
        (program) => program.code === "0351" && program.label === "法律"
      ) ? "YES" : "NOT_OBSERVED",
      explicit_acceptance_of_juris_master_non_law: "NOT_CONFIRMED",
      bachelor_requirement: "法学类",
      graduate_requirement: "法学（0301） OR 法律（0351）",
      bachelor_graduate_relationship: "AMBIGUOUS",
      legal_professional_qualification_a: xlsxResult.legal_focus.legal_professional_qualification
    },
    eligibility_precondition: {
      allowed: composition.requirement_set.completeness.status === "COMPLETE",
      eligibility_executed: false
    },
    downstream_objects_created: {
      candidate_profile: 0,
      eligibility_assessment: 0
    }
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeJson(
    path.join(outputDirectory, "requirement-set-composition.json"),
    composition
  );
  await writeJson(
    path.join(outputDirectory, "requirement-set-composition-report.json"),
    report
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

interface Capture {
  readonly raw_path: string;
  readonly snapshot_path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly snapshot: Snapshot;
}

async function loadCapture(
  executionIndexPath: string,
  expectedSnapshotId: SnapshotId,
  expectedSha256: string
): Promise<Capture> {
  const execution = JSON.parse(await readFile(executionIndexPath, "utf8")) as unknown;
  if (!isRecord(execution) || !isRecord(execution.report) || !isRecord(execution.report.raw)) {
    throw new Error(`Execution index has no sealed Raw metadata: ${executionIndexPath}`);
  }
  const localArtifact = execution.report.raw.local_artifact;
  if (typeof localArtifact !== "string" || localArtifact.length === 0) {
    throw new Error(`Execution index has no local Raw path: ${executionIndexPath}`);
  }
  const rawPath = path.resolve(localArtifact);
  const snapshotPath = path.join(path.dirname(rawPath), "snapshot.json");
  const bytes = new Uint8Array(await readFile(rawPath));
  const actualHash = sha256(bytes);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;
  if (
    actualHash !== expectedSha256
    || snapshot.snapshot_id !== expectedSnapshotId
    || snapshot.content_hash !== expectedSha256
    || snapshot.content_length !== bytes.byteLength
    || snapshot.transport_status !== "SUCCESS"
  ) {
    throw new Error(`Sealed capture provenance mismatch: ${expectedSnapshotId}`);
  }
  return { raw_path: rawPath, snapshot_path: snapshotPath, bytes, sha256: actualHash, snapshot };
}

function captureAudit(capture: Capture) {
  return {
    raw_path: capture.raw_path,
    snapshot_path: capture.snapshot_path,
    snapshot_id: capture.snapshot.snapshot_id,
    raw_sha256: capture.sha256,
    byte_length: capture.bytes.byteLength
  };
}

function evidenceAudit(
  fragment: RequirementEvidenceFragment,
  source: "ANNOUNCEMENT" | "JOB_TABLE" | "COMPOSITION"
) {
  return {
    requirement_evidence_fragment_id: fragment.requirement_evidence_fragment_id,
    source,
    snapshot_id: fragment.snapshot_id,
    extracted_record_id: fragment.extracted_record_id,
    locator: fragment.locator,
    raw_value: fragment.observed_value_state === "TEXT" ? fragment.original_text.text : null,
    normalized_value: fragment.observed_value_state === "TEXT"
      ? fragment.normalized_text?.text ?? null
      : null,
    parser_version: fragment.parser_version
  };
}

function sourceForSnapshot(snapshotId: SnapshotId) {
  if (snapshotId === P2_LEGAL_06_NOTICE_SNAPSHOT_ID) return "ANNOUNCEMENT" as const;
  if (snapshotId === P2_LEGAL_05_SNAPSHOT_ID) return "JOB_TABLE" as const;
  throw new Error(`Unknown Requirement Evidence Snapshot ${snapshotId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSorted<T extends string>(values: readonly T[]) {
  return [...new Set(values)].sort();
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
