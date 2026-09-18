import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalSerialize } from
  "../../ingestion/normalization/canonical-artifact-registry";
import {
  bootstrapZeroCostProductionCompositionRoot,
  type ProductionPersistenceProvenance
} from "../../production-persistence";
import {
  ZHENGHAN_2027_ANNOUNCEMENT_URL,
  ZHENGHAN_2027_DETAIL_URL,
  ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID,
  ZHENGHAN_2027_SOURCE_ADMISSION_ID,
  Zhenghan2027ApprovedOfficialTransport,
  Zhenghan2027OfficialHtmlAdapter,
  createZhenghan2027SourceVersions,
  zhenghanSourceRole
} from "./zhenghan-2027-source";
import { createZhenghan2027TrustedRun } from "./zhenghan-2027-trusted-run";

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const startedAt = new Date().toISOString();
  const runId = `real-2027-zhenghan-${startedAt.replace(/[^0-9A-Za-z]/gu, "-")}`;
  const outputDirectory = path.resolve("outputs", "real-2027-zhenghan", runId);
  const remotePath = path.join(outputDirectory, "authoritative.git");
  mkdirSync(outputDirectory, { recursive: true });
  initializeAuthoritativeRemote(remotePath, startedAt);
  const provenance: ProductionPersistenceProvenance = {
    scope: "PRODUCTION",
    actor_id: "user-approved-real-2027-canary",
    actor_role: "SOURCE_APPROVER_AND_CANARY_OPERATOR",
    evidence_references: [
      "user-approval:b951d518-87c3-4205-88e5-1b1e94148ca7",
      ZHENGHAN_2027_ANNOUNCEMENT_URL,
      ZHENGHAN_2027_DETAIL_URL
    ]
  };
  const trustedRun = createZhenghan2027TrustedRun(startedAt as never);
  const root = bootstrapZeroCostProductionCompositionRoot({
    remote_url: remotePath,
    branch: "main",
    stream_id: "real-2027-zhenghan-trusted-chain",
    commit_identity: {
      name: "Real 2027 Zhenghan Canary",
      email: "real-2027-zhenghan@invalid.local"
    }
  });
  const processA = await root.run({
    run_id: runId,
    source_versions: createZhenghan2027SourceVersions({
      observed_at: startedAt,
      provenance
    }),
    source_admission_id: ZHENGHAN_2027_SOURCE_ADMISSION_ID,
    recruitment_endpoint_id: ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID,
    adapter: new Zhenghan2027OfficialHtmlAdapter(),
    transport: new Zhenghan2027ApprovedOfficialTransport(
      globalThis.fetch.bind(globalThis)
    ),
    provenance,
    actor: "real-2027-zhenghan-canary",
    started_at: startedAt,
    execute_trusted_chain: trustedRun.execute,
    source_role_for_record: zhenghanSourceRole
  });
  if (processA.status !== "COMMITTED" || !processA.committed_head) {
    const failedReport = {
      status: "NOT_VERIFIED",
      run_id: runId,
      accessed_urls: [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL],
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
  const comparison = compareProcesses(trusted, processA.committed_head, processB);
  const report = {
    status: comparison.identical && comparison.full_trusted_chain_completed
      ? "VERIFIED" : "NOT_VERIFIED",
    run_id: runId,
    approved_scope: {
      organization: "上海虹桥正瀚律师事务所",
      accessed_urls: [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL]
    },
    source_identity: {
      source_admission_id: ZHENGHAN_2027_SOURCE_ADMISSION_ID,
      recruitment_endpoint_id: ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID
    },
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
  if (!comparison.identical || !comparison.full_trusted_chain_completed) {
    process.exitCode = 1;
  }
}

function compareProcesses(
  processA: ReturnType<ReturnType<typeof createZhenghan2027TrustedRun>["report"]>,
  committedHead: string,
  processB: Awaited<ReturnType<
    ReturnType<typeof bootstrapZeroCostProductionCompositionRoot>["restore"]
  >>
) {
  const decisionById = new Map(processB.presentation_decisions.map((item) => {
    return [item.presentation_decision_id, item] as const;
  }));
  const readModelById = new Map(processB.read_models.map((item) => {
    return [item.presentation_read_model_id, item] as const;
  }));
  const positionComparisons = processA.positions.map((position) => {
    const decision = decisionById.get(position.presentation_decision_id as never);
    const readModel = readModelById.get(position.presentation_read_model_id as never);
    return {
      source_record_id: position.source_record_id,
      decision_bytes_identical: decision
        ? canonicalSerialize(decision) === position.presentation_decision_bytes
        : false,
      read_model_bytes_identical: readModel
        ? canonicalSerialize(readModel) === position.presentation_read_model_bytes
        : false,
      decision_id_restored: decision?.presentation_decision_id ?? null,
      read_model_id_restored: readModel?.presentation_read_model_id ?? null
    };
  });
  const identical = processB.committed_head === committedHead
    && processB.runs.length === 1
    && processB.acquisition_count === 2
    && positionComparisons.length === 3
    && positionComparisons.every((item) => {
      return item.decision_bytes_identical && item.read_model_bytes_identical;
    });
  const fullTrustedChainCompleted = processA.positions.every((position) => {
    return position.predicate_resolution_execution_status === "RESOLUTION_SET"
      && position.eligibility_execution_status === "ASSESSMENT"
      && position.eligibility_assessment_id !== null;
  });
  return {
    identical,
    full_trusted_chain_completed: fullTrustedChainCompleted,
    evidence_blockers: processA.positions.filter((position) => {
      return position.eligibility_assessment_id === null;
    }).map((position) => ({
      source_record_id: position.source_record_id,
      requirement_completeness: position.requirement_completeness,
      requirement_blocker_codes: position.requirement_blocker_codes,
      predicate_resolution_blocker_code: position.predicate_resolution_blocker_code,
      eligibility_blocker_code: position.eligibility_blocker_code,
      presentation_status: position.presentation_status
    })),
    committed_head_identical: processB.committed_head === committedHead,
    process_a_position_count: processA.positions.length,
    process_b_decision_count: processB.presentation_decisions.length,
    process_b_read_model_count: processB.read_models.length,
    position_comparisons: positionComparisons
  };
}

function initializeAuthoritativeRemote(remotePath: string, observedAt: string) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "zhenghan-canary-seed-"));
  const seed = path.join(temporaryRoot, "seed");
  try {
    git(temporaryRoot, "init", "--bare", remotePath);
    git(temporaryRoot, "init", "-b", "main", seed);
    git(seed, "config", "user.name", "Real 2027 Zhenghan Canary");
    git(seed, "config", "user.email", "real-2027-zhenghan@invalid.local");
    mkdirSync(path.join(seed, "bootstrap"), { recursive: true });
    writeFileSync(path.join(seed, "bootstrap", "initial.json"), `${JSON.stringify({
      schema_version: "zero-cost-authoritative-repository/1.0.0",
      initialized_at: observedAt,
      purpose: "REAL_OFFICIAL_2027_SOURCE_CANARY"
    }, null, 2)}\n`, "utf8");
    git(seed, "add", "bootstrap/initial.json");
    git(seed, "commit", "-m", "Initialize real 2027 canary state repository");
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
