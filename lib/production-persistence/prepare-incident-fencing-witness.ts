import { canonicalHash } from "../ingestion/normalization/canonical-artifact-registry";
import { createIncidentContinuousFencingEvidence, type IncidentRecoveryApproval } from "./continuous-fencing-evidence";
import { readGitIncidentFencingBaseContext, type GitIncidentFencingWitnessV2 } from "./git-incident-fencing-context";

const repository = "bryrgr263-star/wuda-law-job-radar-2027";
const executorHead = "a0e64bb9d4a8caf7a3006537376e0e74c8296222";
const runUrl = `https://api.github.com/repos/${repository}/actions/runs/37909786610`;
const jobUrl = `https://api.github.com/repos/${repository}/actions/jobs/113751898178`;

export interface PrepareIncidentFencingWitnessOptions {
  readonly repository_path: string;
  readonly fixed_sha: string;
  readonly approval: IncidentRecoveryApproval;
}

function deny(): never { throw new Error("INCIDENT_FENCING_PREPARATION_DENIED"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) deny();
  return value as Record<string, unknown>;
}
function timestamp(value: string) {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) deny();
  return Date.parse(value);
}

async function prepare(options: PrepareIncidentFencingWitnessOptions,
  collect: (url: string) => Promise<unknown>, now: () => string): Promise<GitIncidentFencingWitnessV2> {
  if (!options || Object.keys(options).sort().join(",") !== "approval,fixed_sha,repository_path"
    || options.approval?.reference !== "call_5e6879fe41a74f70bdc3c853658bee0e") deny();
  const approval = structuredClone(options.approval);
  if (Object.keys(approval).sort().join(",") !== "action,approved_at,attempt_id,reference"
    || approval.action !== "RECOVER_FENCED_UNKNOWN"
    || approval.attempt_id !== "continuous-attempt:bccb61fd-fdb9-4ffa-a901-69cacbe35638"
    || timestamp(approval.approved_at) < timestamp("2026-10-09T09:15:22.000Z")) deny();
  const base = readGitIncidentFencingBaseContext(options);
  const run = object(await collect(runUrl));
  const job = object(await collect(jobUrl));
  const capturedAt = now();
  if (run.id !== 37909786610 || object(run.repository).full_name !== repository
    || run.head_sha !== executorHead || run.run_attempt !== 1 || run.status !== "completed" || run.conclusion !== "failure"
    || job.id !== 113751898178 || job.run_id !== 37909786610 || job.run_attempt !== 1 || job.head_sha !== executorHead
    || job.status !== "completed" || job.conclusion !== "failure"
    || !["2026-10-09T09:15:22Z", "2026-10-09T09:15:22.000Z"].includes(job.completed_at as string)
    || timestamp(capturedAt) < timestamp("2026-10-09T09:15:22.000Z")
    || timestamp(approval.approved_at) > timestamp(capturedAt)) deny();
  const executor = { repository, run_id: "37909786610", job_id: "113751898178", run_attempt: 1,
    batch_id: "github-actions:37909786610:1", status: "completed" as const, conclusion: "failure" as const,
    completed_at: "2026-10-09T09:15:22.000Z", reservation_commit: base.intent.reserve_commit,
    source_execution_id: base.intent.source_execution_id };
  createIncidentContinuousFencingEvidence({ ...base, executor, approval });
  const content = { schema_version: "git-incident-fencing-witness/2.0.0" as const,
    historical_parent: base.historical_parent,
    reserve: { record_id: base.reserve.record_id, integrity_hash: base.reserve.integrity_hash },
    intent: { integrity_hash: base.intent.integrity_hash, source_execution_id: base.intent.source_execution_id,
      introducing_commit: base.intent.introducing_commit }, executor, approval, actual_send: "UNKNOWN" as const,
    platform_capture: { captured_at: capturedAt, executor_head_sha: executorHead } };
  return { ...content, integrity_hash: canonicalHash(content) };
}

async function collectOfficial(url: string): Promise<unknown> {
  if (url !== runUrl && url !== jobUrl) deny();
  try {
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "incident-fencing-preparation", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (response.status !== 200 || response.redirected || !response.headers.get("content-type")?.includes("application/json")) deny();
    const reader = response.body?.getReader();
    if (!reader) deny();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 1024 * 1024) { await reader.cancel(); deny(); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { deny(); }
}

export function prepareIncidentFencingWitness(options: PrepareIncidentFencingWitnessOptions): Promise<GitIncidentFencingWitnessV2> {
  return prepare(options, collectOfficial, () => new Date().toISOString());
}

export function prepareIncidentFencingWitnessForTest(options: PrepareIncidentFencingWitnessOptions,
  controlled: { readonly scope: "TEST_ONLY"; readonly collect: (url: string) => Promise<unknown>; readonly now: () => string }): Promise<GitIncidentFencingWitnessV2> {
  const guarded = globalThis as typeof globalThis & { [key: symbol]: unknown };
  if (controlled.scope !== "TEST_ONLY" || guarded[Symbol.for("wuda-law-job-radar.network-guard")] !== true) {
    return Promise.reject(new Error("INCIDENT_FENCING_PREPARATION_DENIED"));
  }
  return prepare(options, controlled.collect, controlled.now);
}
