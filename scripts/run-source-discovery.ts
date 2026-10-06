import { readFileSync } from "node:fs";
import { canonicalHash } from "../lib/ingestion/normalization/canonical-artifact-registry";
import { DiscoveryRoot, type OfflineDirectoryFixture } from "../lib/source-discovery/discovery-root";
import type { DiscoveryPolicy } from "../lib/source-discovery/discovery-budget";
import { GitDiscoveryStore } from "../lib/source-discovery/git-discovery-store";

async function main() {
  const [repository, scopeFile, fixtureFile, runId, at, approvedHash] = process.argv.slice(2);
  if (!repository || !scopeFile || !fixtureFile || !runId || !at || !approvedHash) {
    throw new Error("Usage: run-source-discovery <isolated-git-repository> <scope-json> <offline-fixture-json> <run-id> <fixed-time> <approved-scope-hash>");
  }
  const scope: DiscoveryPolicy = JSON.parse(readFileSync(scopeFile, "utf8"));
  const fixture: OfflineDirectoryFixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
  const store = new GitDiscoveryStore(repository);
  const root = new DiscoveryRoot({ store, run_id: runId, scope, started_at: at, approved_scope_hash: approvedHash, mode: "OFFLINE_FIXTURE" });
  for (const url of scope.exact_urls) await root.discover(new URL(url).origin, url, at, fixture);
  const sha = store.head();
  DiscoveryRoot.restore({ store, sha, run_id: runId, approved_scope_hash: approvedHash, mode: "OFFLINE_FIXTURE" });
  console.log(JSON.stringify({ mode: "OFFLINE_FIXTURE", commit: sha, catalog_hash: canonicalHash(store.restore(sha).list()),
    candidates: store.restore(sha).current("CANDIDATE").length, production_activation: false, real_requests: 0 }));
}

main().catch(error => { console.error(error instanceof Error && /^DISCOVERY_[A-Z_]+$/.test(error.message) ? error.message : "DISCOVERY_FAILED"); process.exitCode = 1; });
