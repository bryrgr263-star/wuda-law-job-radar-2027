import { execFileSync } from "node:child_process";
import { pendingContinuousAttempt, currentContinuousGrant } from "../lib/application/source-admission/continuous-acquisition";
import { GitSourceRegistryPersistence } from "../lib/production-persistence/git-source-registry-persistence";
import { bootstrapZeroCostProductionCompositionRoot } from "../lib/production-persistence/zero-cost-production-composition-root";
import { CHNENERGY_JOBS, Chnenergy2027HtmlAdapter, chnenergyEndpoint, chnenergyAdmissionId,
  chnenergyAllowlistId, createChnenergy2027SourceVersions } from "../lib/production-sources/chnenergy-2027-source";

const remote = "https://github.com/bryrgr263-star/wuda-law-job-radar-2027.git";
const provenance = { scope: "PRODUCTION" as const, actor_id: "approved-first-source-expansion-2026-10-06",
  actor_role: "HUMAN_APPROVED_CONTINUOUS_SCOPE", evidence_references: ["user-approval:2026-10-06-first-production-source-expansion"] };
const identity = { name: "Approved Official Source Expansion", email: "source-expansion@invalid.local" };
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

async function main() {
  const [mode, expected, selectedIndex] = process.argv.slice(2);
  if (!['--stage-sources', '--issue-grants', '--acquire'].includes(mode ?? '') || !/^[0-9a-f]{40}$/.test(expected ?? '')) {
    throw new Error("EXPLICIT_SOURCE_EXPANSION_MODE_AND_EXPECTED_SHA_REQUIRED");
  }
  if (git("rev-parse", "HEAD") !== expected || git("status", "--porcelain")) throw new Error("CLEAN_EXACT_LOCAL_BASE_REQUIRED");
  if (git("ls-remote", remote, "refs/heads/main").split(/\s+/)[0] !== expected) throw new Error("AUTHORITATIVE_REMOTE_ADVANCED");
  const store = new GitSourceRegistryPersistence({ repository_path: process.cwd() });
  const records = store.listContinuousRecords();
  if (pendingContinuousAttempt(records)) throw new Error("UNRESOLVED_RESERVE_EXISTS");
  const at = new Date().toISOString();
  if (mode === '--stage-sources') {
    for (const version of createChnenergy2027SourceVersions({ observed_at: at, provenance })) await store.appendVersion(version);
    console.log(JSON.stringify({ source_count: 1, endpoint_count: 2, exact_target_count: 2, real_requests: 0, status: "SOURCE_VERSIONS_STAGED_NOT_YET_COMMITTED" }));
    return;
  }
  const root = bootstrapZeroCostProductionCompositionRoot({ remote_url: remote, branch: "main", stream_id: "initial-production-source-activation",
    execution_mode: "PRODUCTION", continuous_scope: "PRODUCTION", commit_identity: identity });
  if (mode === '--issue-grants') {
    if (records.some(record => record.kind === "GRANT" && CHNENERGY_JOBS.some(job => record.payload.grant?.canonical_payload.exact_endpoint === job.url))) {
      throw new Error("FIRST_EXPANSION_GRANT_ALREADY_EXISTS");
    }
    for (const job of CHNENERGY_JOBS) {
      const result = await root.issueContinuousAuthorization({ allowlist_entry_id: chnenergyAllowlistId(job), effective_from: at,
        min_interval_seconds: 86400, actor: provenance.actor_id });
      console.log(JSON.stringify({ target: job.url, authorization_id: result.record.payload.grant!.authorization_id, status: "ISSUED", real_requests: 0 }));
    }
    return;
  }
  if (selectedIndex !== "0" && selectedIndex !== "1") throw new Error("ONE_EXACT_REVIEWED_JOB_REQUIRED");
  const job = CHNENERGY_JOBS[Number(selectedIndex)]!;
  const ids = [...new Set(records.filter(record => record.kind === "GRANT" && record.payload.grant?.canonical_payload.exact_endpoint === job.url)
    .map(record => record.payload.grant!.authorization_id))];
  if (ids.length !== 1) throw new Error("ONE_EXACT_ACTIVE_AUTHORIZATION_REQUIRED");
  const grant = currentContinuousGrant(records, ids[0]!);
  if (grant.canonical_payload.scope !== "PRODUCTION") throw new Error("PRODUCTION_SCOPE_REQUIRED");
  const result = await root.runProduction({ run_id: `first-source-expansion:chnenergy:${job.id}:${at}`, source_versions: [],
    source_admission_id: chnenergyAdmissionId(job), recruitment_endpoint_id: chnenergyEndpoint(job).recruitment_endpoint_id,
    continuous_authorization_ids: ids, adapter: new Chnenergy2027HtmlAdapter(), provenance, actor: provenance.actor_id, started_at: at,
    transport: { async execute() { throw new Error("CALLER_TRANSPORT_FORBIDDEN"); } } });
  console.log(JSON.stringify({ target: job.url, result }));
  if (result.status !== "COMMITTED") process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : "SOURCE_EXPANSION_FAILED"); process.exitCode = 1; });
