import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { GitAppendOnlyExecutionStore } from "../../lib/production-persistence/git-append-only-execution-store";
import { GitRawObjectPersistence, createRawValidatedRestorationJournal } from "../../lib/production-persistence/git-raw-object-persistence";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { validatedDiscoverySupport } from "../../lib/ingestion/normalization/source-discovery-support";
import type { TrustedChainCommand } from "../../lib/ingestion";

test("October 2/4/5 committed failures prove exact Haier resource-only equivalence", async () => {
  const repositoryPath = process.cwd();
  const journal = createRawValidatedRestorationJournal(new GitRawObjectPersistence({ repository_path: repositoryPath }),
    new GitAppendOnlyExecutionStore<TrustedChainCommand>({ repository_path: repositoryPath,
      stream_id: "initial-production-source-activation", scope: "PRODUCTION" }),
    new GitSourceRegistryPersistence({ repository_path: repositoryPath }));
  const issuance = JSON.parse(readFileSync("trusted-state/journal/segments/000000000020.json", "utf8"));
  const seal = issuance.expected_artifacts[0];
  const envelope = await journal.readArtifactEnvelope!(seal.artifact_kind, seal.artifact_id, "PRODUCTION");
  assert.ok(envelope);
  const original = JSON.parse(envelope.canonical_bytes);
  const first = await journal.readVerifiedDiscovery!(original.snapshot.snapshot_id, original.extracted_record.extracted_record_id);
  const failures = readdirSync("production-runs/source-executions").map(file =>
    JSON.parse(readFileSync(`production-runs/source-executions/${file}`, "utf8"))).filter(item =>
      item.trusted_chain_failure?.error_code === "SOV_DISCOVERY_SUPPORT_RAW_CHANGED");
  assert.equal(failures.length, 3);
  assert.deepEqual(failures.map(item => item.started_at.slice(0, 10)).sort(), ["2026-10-02", "2026-10-04", "2026-10-05"]);
  for (const failure of failures) {
    const next = await journal.readVerifiedDiscovery!(failure.snapshot_ids[0], failure.extracted_record_ids[0]);
    const support = validatedDiscoverySupport(original, first, next, "PRODUCTION", "trusted-sov-discovery-support/3.0.0");
    assert.equal(support.equivalence.resource_equivalence?.resource_count, 13);
    assert.equal(support.target.sov_id, seal.artifact_id);
    assert.equal(support.discovery.raw_sha256, failure.acquisition_evidence.raw_content_hashes[0]);
    assert.equal(support.equivalence.result, "VERIFIED_BUSINESS_EQUIVALENT");
  }
});
