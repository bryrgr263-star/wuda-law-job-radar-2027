import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  executeProductionSchedulerAutomation,
  registeredProductionAdapterKeys,
  resolveProductionAdapter
} from "../lib/production-automation";
import { bootstrapZeroCostProductionCompositionRoot } from "../lib/production-persistence/zero-cost-production-composition-root";

interface SafeFailureReport {
  readonly status: "FAILED";
  readonly error_code: string;
}

async function main() {
  const reportPath = path.resolve(process.env.PRODUCTION_AUTOMATION_REPORT_PATH
    ?? "production-automation-report.json");
  try {
    const remoteUrl = required("AUTHORITATIVE_REMOTE_URL");
    assertSafeRemoteUrl(remoteUrl);
    const branch = required("AUTHORITATIVE_BRANCH");
    const streamId = required("PRODUCTION_STREAM_ID");
    const options = {
      remote_url: remoteUrl,
      branch,
      stream_id: streamId,
      continuous_scope: "PRODUCTION" as const,
      resolve_adapter: resolveProductionAdapter
    };

    const preflight = await bootstrapZeroCostProductionCompositionRoot(options).restore();
    const checkoutHead = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    if (checkoutHead !== preflight.committed_head) throw new Error("ACTIONS_CHECKOUT_HEAD_MISMATCH");
    if (process.env.PRODUCTION_SCHEDULER_ACTIVATION !== "ENABLED") {
      throw new Error("PRODUCTION_SCHEDULER_NOT_ACTIVATED");
    }
    if (registeredProductionAdapterKeys().length === 0) {
      throw new Error("PRODUCTION_ADAPTER_REGISTRY_EMPTY");
    }

    const result = await executeProductionSchedulerAutomation(options, {
      batch_id: required("PRODUCTION_BATCH_ID"),
      actor: required("PRODUCTION_ACTOR"),
      started_at: required("PRODUCTION_STARTED_AT"),
      expected_starting_sha: checkoutHead
    });
    const report = {
      status: result.batch_status === "FAILED" ? "FAILED" : "COMPLETED",
      starting_sha: result.starting_sha,
      ending_sha: result.ending_sha,
      batch_id: result.batch_id,
      batch_status: result.batch_status,
      source_execution_ids: result.source_execution_ids,
      source_outcomes: result.manifest.source_executions.map(item => ({
        source_execution_id: item.source_execution_id, status: item.outcome_status
      })),
      position_ids: result.position_ids,
      presentation_decision_ids: result.presentation_decision_ids,
      presentation_read_model_ids: result.presentation_read_model_ids,
      pre_run_process_b: result.pre_run_process_b,
      post_push_process_b: result.post_push_process_b,
      cas_result: "COMMITTED",
      publication_handoff: result.publication_handoff
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report));
    if (result.batch_status === "FAILED") process.exitCode = 1;
  } catch (error) {
    const report: SafeFailureReport = { status: "FAILED", error_code: safeErrorCode(error) };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(report));
    process.exitCode = 1;
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`ACTIONS_ENV_MISSING_${name}`);
  return value.trim();
}

function assertSafeRemoteUrl(remoteUrl: string) {
  const url = new URL(remoteUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("AUTHORITATIVE_REMOTE_URL_UNSAFE");
  }
}

function safeErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "AUTOMATION_EXECUTION_FAILED";
  const allowed = [
    /^ACTIONS_ENV_MISSING_[A-Z_]+$/u,
    /^ACTIONS_[A-Z_]+$/u,
    /^PRODUCTION_[A-Z_]+$/u,
    /^AUTHORITATIVE_REMOTE_URL_UNSAFE$/u,
    /^SCHEDULER_[A-Z_:]+$/u
  ];
  return allowed.some(pattern => pattern.test(error.message))
    ? error.message
    : "AUTOMATION_EXECUTION_FAILED";
}

void main();
