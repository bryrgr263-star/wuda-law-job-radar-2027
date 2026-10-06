import "../helpers/network-guard";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { fixture, git, identity, AT } from "./continuous-acquisition-fixture";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";

const BASELINE = "695f197a4c9eb281d4dee99a938daf569345edf0";
test("committed historical no-query bytes, IDs, seals and journal survive mixed query restoration", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "query-historical-"));
  try {
    const remote = path.join(directory, "remote.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    git(process.cwd(), "push", remote, `${BASELINE}:refs/heads/main`);
    const options = { remote_url: remote, branch: "main", stream_id: "initial-production-source-activation",
      execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const, commit_identity: identity, now: () => "2026-10-01T20:00:00.000Z" };
    const before = await bootstrapZeroCostProductionCompositionRoot(options).restore();
    assert.equal(before.committed_head, BASELINE);
    assert.ok(before.restored_record_count > 0);
    const checkout = path.join(directory, "writer");
    execFileSync("git", ["clone", "--quiet", "-b", "main", remote, checkout]);
    const inventory = git(checkout, "ls-tree", "-r", BASELINE, "production-source-state", "trusted-state", "trusted-objects", "production-runs")
      .split(/\r?\n/).filter(Boolean);
    assert.ok(inventory.length > 50);
    const repository = new GitSourceRegistryPersistence({ repository_path: checkout });
    const query = fixture({ max_pages: 3 }, "JSON", 3);
    for (const version of query.versions) await repository.appendVersion(version);
    git(checkout, "add", "production-source-state");
    git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled query fixture only");
    git(checkout, "push", "origin", "HEAD:main");
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    for (const target of query.admitted.continuous_acquisition_scope.exact_targets) await root.issueContinuousAuthorization({
      allowlist_entry_id: target.allowlist_entry_id, effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
    const fresh = await root.restore();
    assert.deepEqual(fresh.restoration_record_ids, before.restoration_record_ids);
    assert.deepEqual(fresh.artifact_seals, before.artifact_seals);
    assert.ok(before.current_snapshot && fresh.current_snapshot);
    const { authoritative_head: beforeHead, ...beforeSelection } = before.current_snapshot;
    const { authoritative_head: freshHead, ...freshSelection } = fresh.current_snapshot;
    assert.equal(beforeHead, BASELINE);
    assert.equal(freshHead, fresh.committed_head);
    assert.equal(canonicalSerialize(freshSelection), canonicalSerialize(beforeSelection));
    assert.equal(canonicalSerialize(fresh.presentation_decisions), canonicalSerialize(before.presentation_decisions));
    assert.equal(canonicalSerialize(fresh.historical_read_models), canonicalSerialize(before.historical_read_models));
    assert.equal(canonicalSerialize(fresh.source_execution_outcomes), canonicalSerialize(before.source_execution_outcomes));
    assert.equal(canonicalSerialize(fresh.source_execution_request_intents), canonicalSerialize(before.source_execution_request_intents));
    assert.equal(canonicalSerialize(fresh.continuous_records.slice(0, before.continuous_records.length)), canonicalSerialize(before.continuous_records));
    git(checkout, "fetch", "origin", "main");
    const current = new Map(git(checkout, "ls-tree", "-r", "origin/main", "production-source-state", "trusted-state", "trusted-objects", "production-runs")
      .split(/\r?\n/).filter(Boolean).map(line => [line.split("\t")[1]!, line]));
    let immutableCount = 0;
    for (const line of inventory) {
      const file = line.split("\t")[1]!;
      if (file === "production-source-state/state/current.json") continue;
      assert.equal(current.get(file), line, `Historical immutable bytes changed: ${file}`);
      immutableCount += 1;
    }
    const expected = path.join(directory, "expected.json");
    writeFileSync(expected, canonicalSerialize(fresh));
    const childScript = path.join(directory, "fresh.ts");
    writeFileSync(childScript, `import ${JSON.stringify(path.resolve("tests/helpers/network-guard.ts"))};
import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';
import {bootstrapZeroCostProductionCompositionRoot} from ${JSON.stringify(path.resolve("lib/production-persistence/zero-cost-production-composition-root.ts"))};
import {canonicalSerialize} from ${JSON.stringify(path.resolve("lib/ingestion/normalization/canonical-artifact-registry.ts"))};
(async()=>{ const state=await bootstrapZeroCostProductionCompositionRoot({remote_url:process.argv[2]!,branch:'main',stream_id:'initial-production-source-activation',execution_mode:'TEST_ONLY',continuous_scope:'CONTROLLED_TEST'}).restore(); assert.equal(canonicalSerialize(state),readFileSync(process.argv[3]!,'utf8')); })().catch(error=>{console.error(error);process.exitCode=1;});`);
    const child = spawnSync(process.execPath, ["--import", "tsx", childScript, remote, expected],
      { cwd: process.cwd(), encoding: "utf8", timeout: 900_000 });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    assert.ok(readFileSync(expected, "utf8").length > 0);
    console.log(`Historical immutable artifacts verified: ${immutableCount}`);
  } finally {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe test directory");
    rmSync(resolved, { recursive: true, force: true });
  }
});
