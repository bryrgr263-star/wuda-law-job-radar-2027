import { execFileSync } from "node:child_process";
import { canonicalHash } from "../lib/ingestion/normalization/canonical-artifact-registry";
import { DiscoveryRoot } from "../lib/source-discovery/discovery-root";
import type { DiscoveryPolicy } from "../lib/source-discovery/discovery-budget";
import { GitDiscoveryStore } from "../lib/source-discovery/git-discovery-store";

async function main() {
  const [repository, sourceSha, runId] = process.argv.slice(2);
  if (!repository || !sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha) || !runId) throw new Error("DISCOVERY_PILOT_ARGUMENTS_INVALID");
  const bytes = execFileSync("git", ["show", `${sourceSha}:docs/source-discovery/2026-10-01-candidate-pool.json`], { encoding: "utf8" });
  const pool = JSON.parse(bytes);
  const entries = Array.isArray(pool) ? pool : pool.candidates ?? pool.sources;
  if (!Array.isArray(entries)) throw new Error("DISCOVERY_PILOT_SEED_POOL_INVALID");
  const seed = entries.find(entry => entry.id === "SD-023");
  const exactUrl = "https://iscas.cas.cn/rcdw/rczp/index_1.html";
  if (!seed || seed.source_url !== exactUrl || seed.official_evidence !== exactUrl
    || seed.acquisition_type !== "HTML_LISTING_OBSERVED") throw new Error("DISCOVERY_PILOT_SEED_EVIDENCE_MISMATCH");
  const now = new Date().toISOString();
  const scope: DiscoveryPolicy = { scope_id: "final-closure-official-directory-pilot", revision: 1, status: "ACTIVE",
    approved_by: "USER_MASTER_DIRECTIVE", approval_reference: `FINAL_PRODUCT_CLOSURE:EXISTING_46_HISTORICAL_SEEDS:${sourceSha}:SD-023:${canonicalHash(bytes)}`,
    effective_from: now, expires_at: new Date(Date.parse(now) + 600000).toISOString(), exact_urls: [exactUrl],
    budget: { max_organizations: 1, max_endpoints_per_organization: 1, max_requests: 1,
      max_candidate_urls: 10, max_domains: 1, redirect_depth: 0, retry_limit: 0,
      runtime_seconds: 120, cooldown_seconds: 259200, max_response_bytes: 1048576, max_total_bytes: 1048576 } };
  const store = new GitDiscoveryStore(repository);
  const hash = canonicalHash(scope);
  const root = new DiscoveryRoot({ store, scope, approved_scope_hash: hash, run_id: runId, started_at: now, mode: "REAL_DIRECTORY" });
  await root.discoverLive(new URL(exactUrl).origin, exactUrl);
  const sha = store.head();
  const restored = DiscoveryRoot.restore({ store, sha, run_id: runId, approved_scope_hash: hash, mode: "REAL_DIRECTORY" });
  if (canonicalHash(root.budgetSnapshot()) !== canonicalHash(restored.budgetSnapshot())) throw new Error("DISCOVERY_PILOT_RESTORE_MISMATCH");
  const catalog = store.restore(sha);
  console.log(JSON.stringify({ mode: "REAL_DIRECTORY", seed_sha: sourceSha, exact_url: exactUrl,
    discovery_commit: sha, scope_hash: hash, observations: catalog.list("OBSERVATION"),
    candidates: catalog.current("CANDIDATE").length, budget_hash: canonicalHash(restored.budgetSnapshot()),
    production_admission: false, production_authorization: false, production_acquisition: false }));
}

main().catch(error => {
  console.error(error instanceof Error && /^DISCOVERY_[A-Z_]+$/.test(error.message) ? error.message : "DISCOVERY_PILOT_FAILED");
  process.exitCode = 1;
});
