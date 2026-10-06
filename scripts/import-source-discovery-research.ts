import { execFileSync } from "node:child_process";
import { canonicalHash } from "../lib/ingestion/normalization/canonical-artifact-registry";
import { importHistoricalResearch } from "../lib/source-discovery/research-import";
import { GitDiscoveryStore } from "../lib/source-discovery/git-discovery-store";

const [inputRepository, fixedSha, outputRepository, write] = process.argv.slice(2);
if (!inputRepository || !fixedSha || !/^[a-f0-9]{40}$/.test(fixedSha) || !outputRepository) {
  throw new Error("Usage: import-source-discovery-research <input-repository> <fixed-input-sha> <isolated-output-repository> [--write]");
}
const bytes = execFileSync("git", ["-C", inputRepository, "show", `${fixedSha}:docs/source-discovery/2026-10-01-candidate-pool.json`], { encoding: "utf8" });
const records = importHistoricalResearch(bytes);
const store = new GitDiscoveryStore(outputRepository);
const sha = write === "--write" ? store.commit(records, store.head()) : store.head();
console.log(JSON.stringify({ mode: write === "--write" ? "OFFLINE_IMPORT" : "DRY_RUN", input_sha: fixedSha,
  output_sha: sha, record_count: records.length, canonical_hash: canonicalHash(records), production_activation: false }));
