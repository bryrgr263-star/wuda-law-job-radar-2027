import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalSerialize } from
  "../../ingestion/normalization/canonical-artifact-registry";
import {
  bootstrapZeroCostProductionCompositionRoot,
  type ProductionPersistenceProvenance
} from "../../production-persistence";
import {
  HAIER_2027_LEGAL_URL,
  HAIER_2027_RECRUITMENT_ENDPOINT_ID,
  HAIER_2027_SOURCE_ADMISSION_ID,
  Haier2027ApprovedOfficialTransport,
  Haier2027LegalOfficialHtmlAdapter,
  createHaier2027SourceVersions,
  haierSourceRole
} from "./haier-2027-source";
import { createHaier2027TrustedRun } from "./haier-2027-trusted-run";

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const startedAt = new Date().toISOString();
  const runId = `real-2027-haier-${startedAt.replace(/[^0-9A-Za-z]/gu, "-")}`;
  const outputDirectory = path.resolve("outputs", "real-2027-haier", runId);
  const remotePath = path.join(outputDirectory, "authoritative.git");
  mkdirSync(outputDirectory, { recursive: true });
  initializeAuthoritativeRemote(remotePath, startedAt);
  const provenance: ProductionPersistenceProvenance = {
    scope: "PRODUCTION",
    actor_id: "user-approved-second-real-2027-canary",
    actor_role: "SOURCE_APPROVER_AND_CANARY_OPERATOR",
    evidence_references: [
      "user-approval:second-real-official-2027-source-haier-rid-61",
      HAIER_2027_LEGAL_URL
    ]
  };
  const trustedRun = createHaier2027TrustedRun(startedAt as never);
  const transport = new Haier2027ApprovedOfficialTransport(
    globalThis.fetch.bind(globalThis)
  );
  const root = bootstrapZeroCostProductionCompositionRoot({
    execution_mode: "CANARY",
    remote_url: remotePath,
    branch: "main",
    stream_id: "real-2027-haier-trusted-chain",
    commit_identity: {
      name: "Real 2027 Haier Canary",
      email: "real-2027-haier@invalid.local"
    }
  });
  const processA = await root.run({
    run_id: runId,
    source_versions: createHaier2027SourceVersions({
      observed_at: startedAt,
      provenance
    }),
    source_admission_id: HAIER_2027_SOURCE_ADMISSION_ID,
    recruitment_endpoint_id: HAIER_2027_RECRUITMENT_ENDPOINT_ID,
    adapter: new Haier2027LegalOfficialHtmlAdapter(),
    transport,
    provenance,
    actor: "real-2027-haier-canary",
    started_at: startedAt,
    execute_trusted_chain: trustedRun.execute,
    source_role_for_record: haierSourceRole
  });
  if (processA.status !== "COMMITTED" || !processA.committed_head) {
    const failedReport = {
      status: "NOT_VERIFIED",
      run_id: runId,
      accessed_urls: [HAIER_2027_LEGAL_URL],
      process_a: processA,
      authoritative_remote: remotePath
    };
    writeReport(outputDirectory, failedReport);
    process.stdout.write(`${JSON.stringify(failedReport, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const trusted = trustedRun.report();
  const processB = await root.restore();
  const acquisition = transport.report();
  const comparison = compareProcesses(trusted, processA.committed_head, processB);
  const report = {
    status: comparison.identical && comparison.safe_boundary_outcome
      ? "VERIFIED" : "NOT_VERIFIED",
    run_id: runId,
    approved_scope: {
      organization: "海尔集团",
      accessed_urls: [HAIER_2027_LEGAL_URL]
    },
    source_identity: {
      source_admission_id: HAIER_2027_SOURCE_ADMISSION_ID,
      recruitment_endpoint_id: HAIER_2027_RECRUITMENT_ENDPOINT_ID
    },
    acquisition,
    authoritative_remote: remotePath,
    process_a: processA,
    trusted_chain: trusted,
    process_b: {
      committed_head: processB.committed_head,
      source_version_count: processB.source_version_count,
      acquisition_count: processB.acquisition_count,
      restored_record_count: processB.restored_record_count,
      restoration_record_ids: processB.restoration_record_ids,
      artifact_seals: processB.artifact_seals,
      presentation_decisions: processB.presentation_decisions,
      read_models: processB.read_models,
      runs: processB.runs
    },
    comparison
  };
  writeReport(outputDirectory, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!comparison.identical || !comparison.safe_boundary_outcome) {
    process.exitCode = 1;
  }
}

function compareProcesses(
  processA: ReturnType<ReturnType<typeof createHaier2027TrustedRun>["report"]>,
  committedHead: string,
  processB: Awaited<ReturnType<
    ReturnType<typeof bootstrapZeroCostProductionCompositionRoot>["restore"]
  >>
) {
  const position = processA.positions[0];
  const decision = processB.presentation_decisions.find((item) => {
    return item.presentation_decision_id === position?.presentation_decision_id;
  });
  const readModel = processB.read_models.find((item) => {
    return item.presentation_read_model_id === position?.presentation_read_model_id;
  });
  const sealIds = new Set(processB.artifact_seals.map((seal) => seal.artifact_id));
  const expectedRestoredIds = position ? [
    processA.candidate_evidence_manifest_id,
    ...processA.candidate_evidence_ids,
    position.opportunity_candidate_id,
    position.recall_disposition_id,
    position.position_version_id,
    position.opportunity_version_id,
    position.source_composition_id,
    position.relevance_assessment_id,
    position.requirement_projection_id,
    position.requirement_set_version_id,
    position.presentation_decision_id,
    position.presentation_read_model_id
  ] : [];
  const restoredArtifactIds = expectedRestoredIds.filter((artifactId) => {
    return sealIds.has(artifactId);
  });
  const decisionBytesIdentical = position && decision
    ? canonicalSerialize(decision) === position.presentation_decision_bytes
    : false;
  const readModelBytesIdentical = position && readModel
    ? canonicalSerialize(readModel) === position.presentation_read_model_bytes
    : false;
  const identical = processB.committed_head === committedHead
    && processB.runs.length === 1
    && processB.acquisition_count === 1
    && processA.positions.length === 1
    && decisionBytesIdentical
    && readModelBytesIdentical
    && restoredArtifactIds.length === expectedRestoredIds.length;
  const safeBoundaryOutcome = Boolean(position
    && position.source_composition_status === "COMPLETE"
    && position.relevance_state === "RELEVANT"
    && position.requirement_completeness === "REVIEW_REQUIRED"
    && position.predicate_resolution_execution_status === "BLOCKED"
    && position.eligibility_execution_status === "NOT_ALLOWED"
    && position.eligibility_assessment_id === null
    && position.eligibility_result === null
    && position.presentation_status === "EVIDENCE_BLOCKED"
    && readModel?.presentation_status === "EVIDENCE_BLOCKED");
  return {
    identical,
    safe_boundary_outcome: safeBoundaryOutcome,
    committed_head_identical: processB.committed_head === committedHead,
    decision_bytes_identical: decisionBytesIdentical,
    read_model_bytes_identical: readModelBytesIdentical,
    restored_artifact_ids_complete:
      restoredArtifactIds.length === expectedRestoredIds.length,
    expected_restored_artifact_ids: expectedRestoredIds,
    restored_artifact_ids: restoredArtifactIds,
    missing_restored_artifact_ids: expectedRestoredIds.filter((artifactId) => {
      return !sealIds.has(artifactId);
    })
  };
}

function initializeAuthoritativeRemote(remotePath: string, observedAt: string) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "haier-canary-seed-"));
  const seed = path.join(temporaryRoot, "seed");
  try {
    git(temporaryRoot, "init", "--bare", remotePath);
    git(temporaryRoot, "init", "-b", "main", seed);
    git(seed, "config", "user.name", "Real 2027 Haier Canary");
    git(seed, "config", "user.email", "real-2027-haier@invalid.local");
    mkdirSync(path.join(seed, "bootstrap"), { recursive: true });
    writeFileSync(path.join(seed, "bootstrap", "initial.json"), `${JSON.stringify({
      schema_version: "zero-cost-authoritative-repository/1.0.0",
      initialized_at: observedAt,
      purpose: "SECOND_REAL_OFFICIAL_2027_SOURCE_CANARY"
    }, null, 2)}\n`, "utf8");
    git(seed, "add", "bootstrap/initial.json");
    git(seed, "commit", "-m", "Initialize second real 2027 canary state repository");
    git(seed, "remote", "add", "origin", remotePath);
    git(seed, "push", "-u", "origin", "main");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function writeReport(outputDirectory: string, report: unknown) {
  writeFileSync(
    path.join(outputDirectory, "canary-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
}

function git(workingDirectory: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
