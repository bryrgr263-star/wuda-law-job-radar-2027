import "../helpers/network-guard";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveProductionAdapter } from "../../lib/production-automation";
import { HAIER_2027_ADAPTER_KEY, HAIER_2027_SOURCE_ADMISSION_ID,
  HAIER_2027_RECRUITMENT_ENDPOINT_ID, HAIER_2027_LEGAL_URL } from "../../lib/production-sources/haier-2027-source";
import { bootstrapProductionSchedulerBatch } from "../../lib/production-persistence/production-scheduler-batch";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";

const runOneHead = "f43683441fd2b16d0672b312761363780507dc31";
const runTwoTime = "2026-09-28T05:17:29.442Z";
const haierExecutionId = "scheduler-source:dd97035a83ffe789733c4b1e1eb7755d4417a58f2a81cb38f5290331bba4ce8c";
const haierAuthorizationId = "continuous-authorization:456ed6f134db36330ad8fdb20454df9cf9bc619b6e1405617c2afcb8f86ec95c";
const committedBodies = new Map([
  ["https://www.zhenghan.com/news/2782.html", {
    hash: "cf85b01309aa9da0286fe1aceb3aaa7788397d1844c1cfed3b47819e574276d9",
    contentType: "text/html; charset=UTF-8"
  }],
  ["https://www.zhenghan.com/news/2790.html", {
    hash: "cd045bfc9415bfd52b76dc2f890098b15f95f67d33c8a9307f2414a59d5934cb",
    contentType: "text/html; charset=UTF-8"
  }],
  [HAIER_2027_LEGAL_URL, {
    hash: "9b442f746a6c5af303019e8f680808069724f82544f27c50ff18e11edee78efc",
    contentType: "text/html; charset=utf-8"
  }]
]);

function offlineRemote() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "run2-scheduler-replay-"));
  const remote = path.join(directory, "remote.git");
  execFileSync("git", ["init", "--bare", "--quiet", remote]);
  execFileSync("git", ["push", "--quiet", remote, `${runOneHead}:refs/heads/main`], { cwd: process.cwd() });
  execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: remote });
  return { remote, remove: () => rmSync(directory, { recursive: true, force: true }) };
}

function mockCommittedResponses(contentTypeOverride?: string) {
  const previous = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    const committed = committedBodies.get(url);
    assert.ok(committed, `Unapproved offline target: ${url}`);
    assert.equal(options?.method, "GET");
    assert.equal(options?.redirect, "manual");
    assert.equal(options?.credentials, "omit");
    requested.push(url);
    const hash = committed.hash;
    const bytes = readFileSync(path.join(process.cwd(), "trusted-objects", "objects", "sha256",
      hash.slice(0, 2), hash.slice(2, 4), hash));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    return new Response(bytes, { status: 200, headers: {
      "content-type": contentTypeOverride ?? committed.contentType
    } });
  };
  return { requested, restore: () => { globalThis.fetch = previous; } };
}

function options(remote: string) {
  return { remote_url: remote, branch: "main", stream_id: "initial-production-source-activation",
    execution_mode: "PRODUCTION" as const, continuous_scope: "PRODUCTION" as const,
    now: () => runTwoTime,
    commit_identity: { name: "Offline Run 2 Replay", email: "offline-run2-replay@invalid.local" } };
}

test("Run 2 Haier pending outcome is caused by the old replay fixture changing committed MIME bytes", async (context) => {
  const fork = offlineRemote();
  const mock = mockCommittedResponses("text/html; charset=UTF-8");
  try {
    const root = bootstrapZeroCostProductionCompositionRoot(options(fork.remote));
    const adapter = resolveProductionAdapter(HAIER_2027_ADAPTER_KEY);
    assert.ok(adapter);
    const result = await root.runProduction({ run_id: haierExecutionId,
      continuous_authorization_ids: [haierAuthorizationId], source_versions: [],
      source_admission_id: HAIER_2027_SOURCE_ADMISSION_ID,
      recruitment_endpoint_id: HAIER_2027_RECRUITMENT_ENDPOINT_ID, adapter,
      transport: { async execute() { throw new Error("Offline test must use the authorized request gate"); } },
      provenance: { scope: "PRODUCTION", actor_id: "offline-run2-replay",
        actor_role: "PRODUCTION_SCHEDULER", evidence_references: [haierAuthorizationId] },
      actor: "offline-run2-replay", started_at: "2026-09-28T05:16:36.000Z" });
    assert.equal(result.status, "EVIDENCE_BLOCKED");
    assert.match(result.error ?? "", /Raw manifest reuse requires exact original source and bytes/u);
    assert.equal(result.committed_head, null);
    const restored = await root.restore();
    const complete = restored.continuous_records.find(record => record.kind === "COMPLETE"
      && !restored.source_execution_outcomes.some(outcome =>
        outcome.request_attempt_ids.includes(record.payload.attempt_id!)));
    assert.ok(complete);
    const reservation = restored.continuous_records.find(record => record.kind === "RESERVE"
      && record.payload.attempt_id === complete.payload.attempt_id);
    assert.equal(reservation?.payload.authorization_id, haierAuthorizationId);
    context.diagnostic(`pending attempt=${complete.payload.attempt_id} source_execution=${haierExecutionId} authorization=${haierAuthorizationId}`);
    assert.equal(mock.requested.length, 1);
  } finally { mock.restore(); fork.remove(); }
});

test("full committed Run 2 evidence replays through Scheduler and Process B without an unsettled source outcome", async () => {
  const fork = offlineRemote();
  const mock = mockCommittedResponses();
  try {
    const scheduler = bootstrapProductionSchedulerBatch({ ...options(fork.remote),
      resolve_adapter: resolveProductionAdapter });
    const batch = await scheduler.runBatch({ batch_id: "github-actions:36381175745:1",
      actor: "offline-run2-replay", started_at: "2026-09-28T05:16:36.000Z" });
    const restored = await bootstrapZeroCostProductionCompositionRoot(options(fork.remote)).restore();
    assert.equal(batch.manifest.source_executions.length, 2);
    assert.equal(batch.manifest.batch_status, "SUCCESS");
    assert.equal(mock.requested.length, 3);
    assert.equal(new Set(mock.requested).size, 3);
    const runTwoOutcomes = restored.source_execution_outcomes.filter(outcome =>
      batch.manifest.source_executions.some(item => item.source_execution_id === outcome.source_execution_id));
    assert.equal(runTwoOutcomes.length, 2);
    const zhenghan = runTwoOutcomes.find(outcome => outcome.source_execution_id !== haierExecutionId);
    assert.ok(zhenghan);
    assert.equal(zhenghan.status, "SUCCESS");
    assert.equal(zhenghan.trusted_chain_status, "COMMITTED");
    assert.equal(runTwoOutcomes.find(outcome => outcome.source_execution_id === haierExecutionId)?.status, "NOT_MODIFIED");
    const zhenghanRun = restored.runs.find(run => run.run_id === zhenghan.source_execution_id);
    assert.equal(zhenghanRun?.presentation_read_model_ids.length, 3);
    const advanced = restored.historical_read_models.filter(model =>
      zhenghanRun?.presentation_read_model_ids.includes(model.presentation_read_model_id));
    assert.equal(advanced.length, 3);
    assert.equal(new Set(advanced.map(model => model.position_id)).size, 3);
    assert.ok(advanced.every(model => model.decision_revision === 2
      && model.presentation_status === "EVIDENCE_BLOCKED"
      && !model.reason_codes.includes("RELEVANCE_ASSESSMENT_MISSING")));
    assert.equal(restored.read_models.length, 4);
    assert.ok(advanced.every(model => restored.read_models.some(current =>
      current.presentation_read_model_id === model.presentation_read_model_id)));
    assert.ok(advanced.every(model => restored.historical_read_models.some(previous =>
      previous.position_id === model.position_id && previous.decision_revision === 1)));
    const bound = new Set(restored.source_execution_outcomes.flatMap(outcome => outcome.request_attempt_ids));
    assert.ok(restored.continuous_records.filter(record => record.kind === "COMPLETE")
      .every(record => bound.has(record.payload.attempt_id!)));
    assert.equal(restored.committed_head, batch.manifest_commit);
  } finally { mock.restore(); fork.remove(); }
});
