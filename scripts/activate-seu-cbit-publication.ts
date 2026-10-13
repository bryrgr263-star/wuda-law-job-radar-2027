import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentContinuousGrant, pendingContinuousAttempt } from "../lib/application/source-admission/continuous-acquisition";
import { GitSourceRegistryPersistence } from "../lib/production-persistence/git-source-registry-persistence";
import { bootstrapZeroCostProductionCompositionRoot } from "../lib/production-persistence/zero-cost-production-composition-root";
import { SeuCbit2027HtmlAdapter, createSeuCbit2027SourceVersions, seuCbitEndpoint, SEU_CBIT_URL,
  SEU_CBIT_SOURCE_ID, SEU_CBIT_ADMISSION_ID, SEU_CBIT_ALLOWLIST_ID } from "../lib/production-sources/seu-cbit-2027-source";

const remote = "https://github.com/bryrgr263-star/wuda-law-job-radar-2027.git";
const identity = { name: "Approved University Publication Activation", email: "source-activation@invalid.local" };
const provenance = { scope: "PRODUCTION" as const, actor_id: "approved-university-publication-activation",
  actor_role: "HUMAN_APPROVED_CONTINUOUS_SCOPE", evidence_references: ["call_5d2551504ceb40b69c016013f8748505"] };
export function parseSeuCbitActivationArgs(args: readonly string[]) {
  const [mode, expected] = args;
  if (args.length !== 2 || !["--stage-sources", "--issue-grant", "--acquire"].includes(mode ?? "") || !/^[a-f0-9]{40}$/u.test(expected ?? "")) {
    throw new Error("EXPLICIT_BOUNDED_PHASE_AND_COMMIT_REQUIRED");
  }
  return { mode: mode as "--stage-sources" | "--issue-grant" | "--acquire", expected };
}
function git(...args: string[]) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function assertSchedulerIdle() {
  const response = await fetch("https://api.github.com/repos/bryrgr263-star/wuda-law-job-radar-2027/actions/workflows/production-scheduler.yml/runs?per_page=10",
    { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(10000), headers: { Accept: "application/vnd.github+json",
      "User-Agent": "approved-university-publication-preflight", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
  if (response.status !== 200 || response.redirected) throw new Error("SCHEDULER_STATE_UNVERIFIED");
  const data = await response.json() as { workflow_runs?: { id: number; status: string }[] };
  if (!Array.isArray(data.workflow_runs) || data.workflow_runs.some(run => run.status !== "completed")) throw new Error("SCHEDULER_ACTIVE_OR_UNVERIFIED");
}
async function main() {
  const { mode, expected } = parseSeuCbitActivationArgs(process.argv.slice(2));
  if (git("rev-parse", "HEAD") !== expected || git("status", "--porcelain")) throw new Error("CLEAN_EXACT_LOCAL_BASE_REQUIRED");
  git("fetch", remote, "main");
  if (git("rev-parse", "FETCH_HEAD") !== expected) throw new Error("AUTHORITATIVE_REMOTE_ADVANCED");
  const store = new GitSourceRegistryPersistence({ repository_path: process.cwd() });
  const records = store.listContinuousRecords();
  if (pendingContinuousAttempt(records)) throw new Error("UNRESOLVED_RESERVE_EXISTS");
  const at = new Date().toISOString();
  if (mode === "--stage-sources") {
    if ((await store.listVersions()).some(version => version.stream_id === SEU_CBIT_SOURCE_ID)) throw new Error("SOURCE_ALREADY_STAGED");
    for (const version of createSeuCbit2027SourceVersions({ observed_at: at, provenance })) await store.appendVersion(version);
    console.log(JSON.stringify({ status: "SOURCE_VERSIONS_STAGED_NOT_YET_COMMITTED", sources: 1, exact_targets: 1, real_requests: 0 }));
    return;
  }
  const root = bootstrapZeroCostProductionCompositionRoot({ remote_url: remote, branch: "main", stream_id: "initial-production-source-activation",
    execution_mode: "PRODUCTION", continuous_scope: "PRODUCTION", commit_identity: identity });
  const restored = await root.restore();
  if (restored.committed_head !== expected || pendingContinuousAttempt(restored.continuous_records)) throw new Error("FRESH_RESTORATION_OR_PENDING_DENIED");
  const settled = new Set(restored.source_execution_outcomes.flatMap(outcome => outcome.request_attempt_ids));
  if (restored.continuous_records.some(record => record.kind === "COMPLETE" && record.payload.attempt_id && !settled.has(record.payload.attempt_id))) {
    throw new Error("SOURCE_OUTCOME_PENDING");
  }
  const authorizationIds = [...new Set(records.filter(record => record.kind === "GRANT"
    && record.payload.grant?.canonical_payload.exact_endpoint === SEU_CBIT_URL).map(record => record.payload.grant!.authorization_id))];
  await assertSchedulerIdle();
  if (git("ls-remote", remote, "refs/heads/main").split(/\s+/u)[0] !== expected) throw new Error("AUTHORITATIVE_REMOTE_ADVANCED");
  if (mode === "--issue-grant") {
    if (authorizationIds.length) throw new Error("EXISTING_AUTHORIZATION_MUST_NOT_BE_DUPLICATED");
    const result = await root.issueContinuousAuthorization({ allowlist_entry_id: SEU_CBIT_ALLOWLIST_ID, effective_from: at,
      min_interval_seconds: 86400, actor: provenance.actor_id });
    console.log(JSON.stringify({ status: "ISSUED", authorization_id: result.record.payload.grant!.authorization_id, real_requests: 0 }));
    return;
  }
  if (authorizationIds.length !== 1) throw new Error("ONE_EXACT_ACTIVE_AUTHORIZATION_REQUIRED");
  const grant = currentContinuousGrant(records, authorizationIds[0]!);
  if (grant.canonical_payload.scope !== "PRODUCTION") throw new Error("PRODUCTION_SCOPE_REQUIRED");
  const result = await root.runProduction({ run_id: `university-publication:seu-cbit:${new Date().toISOString()}`, source_versions: [],
    source_admission_id: SEU_CBIT_ADMISSION_ID, recruitment_endpoint_id: seuCbitEndpoint().recruitment_endpoint_id,
    continuous_authorization_ids: authorizationIds, adapter: new SeuCbit2027HtmlAdapter(), provenance, actor: provenance.actor_id,
    started_at: new Date().toISOString(), transport: { async execute() { throw new Error("CALLER_TRANSPORT_DENIED"); } } });
  console.log(JSON.stringify({ target: SEU_CBIT_URL, result }));
  if (result.status !== "COMMITTED") process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "UNIVERSITY_PUBLICATION_FAILED"); process.exitCode = 1; });
}
