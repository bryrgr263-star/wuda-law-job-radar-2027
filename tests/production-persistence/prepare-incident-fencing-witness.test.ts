import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createIncidentContinuousFencingEvidence } from "../../lib/production-persistence/continuous-fencing-evidence";
import { createGitIncidentContinuousFencingVerifier, readGitIncidentContinuousFencingContext } from "../../lib/production-persistence/git-incident-fencing-context";
import { prepareIncidentFencingWitnessForTest, prepareIncidentFencingWitness } from "../../lib/production-persistence/prepare-incident-fencing-witness";

const baseline = "f40714dc001994ca140df6002138c09aa5be223b";
const head = "a0e64bb9d4a8caf7a3006537376e0e74c8296222";
const capturedAt = "2026-10-10T08:00:00.000Z";
const approval = { reference: "call_5e6879fe41a74f70bdc3c853658bee0e", approved_at: "2026-10-10T07:00:00.000Z",
  attempt_id: "continuous-attempt:bccb61fd-fdb9-4ffa-a901-69cacbe35638", action: "RECOVER_FENCED_UNKNOWN" as const };
function responses() {
  return { run: { id: 37909786610, repository: { full_name: "bryrgr263-star/wuda-law-job-radar-2027" },
    head_sha: head, run_attempt: 1, status: "completed", conclusion: "failure", token: "PRIVATE_SECRET" },
  job: { id: 113751898178, run_id: 37909786610, run_attempt: 1, head_sha: head, status: "completed",
    conclusion: "failure", completed_at: "2026-10-09T09:15:22Z", steps: [{ private: "PRIVATE_SECRET" }] } };
}
function controlled(data = responses()) {
  const calls: string[] = [];
  return { calls, collect: async (url: string) => {
    calls.push(url);
    if (url === "https://api.github.com/repos/bryrgr263-star/wuda-law-job-radar-2027/actions/runs/37909786610") return data.run;
    if (url === "https://api.github.com/repos/bryrgr263-star/wuda-law-job-radar-2027/actions/jobs/113751898178") return data.job;
    throw new Error("Unexpected endpoint");
  } };
}
function options() { return { repository_path: process.cwd(), fixed_sha: baseline, approval }; }
function setup() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "iwp-"));
  const seed = path.join(directory, "repo");
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.longpaths=true", ...args],
    { cwd: seed, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", process.cwd(), seed], { windowsHide: true });
  git("read-tree", baseline);
  git("update-ref", "HEAD", baseline);
  return { seed, git, commit: (value: unknown) => {
    const witness = value as { integrity_hash: string };
    const file = `production-source-state/continuous/fencing/${witness.integrity_hash}.json`;
    mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
    writeFileSync(path.join(seed, file), canonicalSerialize(value));
    git("add", "--", file);
    git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "--no-gpg-sign", "-qm", "TEST_ONLY witness");
    return git("rev-parse", "HEAD");
  }, cleanup: () => {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe fixture");
    rmSync(directory, { recursive: true, force: true });
  } };
}

test("preparation captures only safe schema2 fields and independently replays committed witness", async () => {
  const collector = controlled();
  const witness = await prepareIncidentFencingWitnessForTest(options(), { scope: "TEST_ONLY", collect: collector.collect, now: () => capturedAt });
  assert.equal(witness.schema_version, "git-incident-fencing-witness/2.0.0");
  assert.deepEqual(witness.platform_capture, { captured_at: capturedAt, executor_head_sha: head });
  assert.deepEqual(witness.approval, approval);
  assert.equal(witness.actual_send, "UNKNOWN");
  assert.equal(collector.calls.length, 2);
  assert.equal(canonicalSerialize(witness).includes("PRIVATE_SECRET"), false);
  const { integrity_hash, ...content } = witness;
  assert.equal(integrity_hash, canonicalHash(content));
  const current = setup();
  try {
    const fixed = current.commit(witness);
    const context = readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: fixed });
    assert.ok(context);
    assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: fixed })(
      context.reserve, createIncidentContinuousFencingEvidence(context), capturedAt), true);
    writeFileSync(path.join(current.seed, `production-source-state/continuous/fencing/${integrity_hash}.json`), "tampered worktree");
    assert.deepEqual(readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: fixed }), context);
  } finally { current.cleanup(); }
});

test("preparation denies mismatched platform identities status head completion and approval", async () => {
  const mutations = [
    (data: ReturnType<typeof responses>) => { data.run.id++; },
    (data: ReturnType<typeof responses>) => { data.job.id++; },
    (data: ReturnType<typeof responses>) => { data.job.run_id++; },
    (data: ReturnType<typeof responses>) => { data.run.repository.full_name = "wrong/repo"; },
    (data: ReturnType<typeof responses>) => { data.run.head_sha = "0".repeat(40); },
    (data: ReturnType<typeof responses>) => { data.job.head_sha = "0".repeat(40); },
    (data: ReturnType<typeof responses>) => { data.run.status = "in_progress"; },
    (data: ReturnType<typeof responses>) => { data.job.status = "in_progress"; },
    (data: ReturnType<typeof responses>) => { data.run.conclusion = "success"; },
    (data: ReturnType<typeof responses>) => { data.job.conclusion = "success"; },
    (data: ReturnType<typeof responses>) => { data.run.run_attempt = 2; },
    (data: ReturnType<typeof responses>) => { data.job.run_attempt = 2; },
    (data: ReturnType<typeof responses>) => { data.job.completed_at = "2026-10-09T09:15:23Z"; }
  ];
  for (const mutate of mutations) {
    const data = responses(); mutate(data);
    await assert.rejects(prepareIncidentFencingWitnessForTest(options(), {
      scope: "TEST_ONLY", collect: controlled(data).collect, now: () => capturedAt }));
  }
  for (const changed of [{ ...approval, reference: "unapproved" }, { ...approval, action: "COMPLETE" },
    { ...approval, attempt_id: "wrong" }, { ...approval, approved_at: "2026-10-11T00:00:00.000Z" }]) {
    await assert.rejects(prepareIncidentFencingWitnessForTest({ ...options(), approval: changed as typeof approval }, {
      scope: "TEST_ONLY", collect: controlled().collect, now: () => capturedAt }));
  }
  for (const time of ["invalid", "2026-10-09T09:15:21.000Z"]) {
    await assert.rejects(prepareIncidentFencingWitnessForTest(options(), { scope: "TEST_ONLY", collect: controlled().collect, now: () => time }));
  }
  await assert.rejects(prepareIncidentFencingWitnessForTest(options(), {
    scope: "PRODUCTION" as "TEST_ONLY", collect: controlled().collect, now: () => capturedAt }));
  await assert.rejects(prepareIncidentFencingWitness({ ...options(), collect: controlled().collect } as ReturnType<typeof options>));
});

test("schema2 replay rejects re-sealed wrong head time or extra private fields", async () => {
  const witness = await prepareIncidentFencingWitnessForTest(options(), { scope: "TEST_ONLY", collect: controlled().collect, now: () => capturedAt });
  for (const capture of [{ ...witness.platform_capture, executor_head_sha: "0".repeat(40) },
    { ...witness.platform_capture, captured_at: "2026-10-09T09:15:21.000Z" },
    { ...witness.platform_capture, captured_at: "not-a-date" },
    { ...witness.platform_capture, token: "PRIVATE_SECRET" }]) {
    const current = setup();
    try {
      const { integrity_hash: _hash, ...content } = witness;
      const forged = { ...content, platform_capture: capture };
      const fixed = current.commit({ ...forged, integrity_hash: canonicalHash(forged) });
      assert.throws(() => readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: fixed }));
    } finally { current.cleanup(); }
  }
});

test("schema1 keeps original canonical witness bytes and primitive proof identity", async () => {
  const witness = await prepareIncidentFencingWitnessForTest(options(), { scope: "TEST_ONLY", collect: controlled().collect, now: () => capturedAt });
  const { integrity_hash: _hash, platform_capture: _capture, ...base } = witness;
  const content = { ...base, schema_version: "git-incident-fencing-witness/1.0.0",
    approval: { ...approval, reference: "TEST_ONLY:historical-approval" } };
  const original = { ...content, integrity_hash: canonicalHash(content) };
  const bytes = canonicalSerialize(original);
  const current = setup();
  try {
    const fixed = current.commit(original);
    const context = readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: fixed });
    assert.ok(context);
    assert.equal(current.git("show", `${fixed}:production-source-state/continuous/fencing/${original.integrity_hash}.json`), bytes);
    const proof = createIncidentContinuousFencingEvidence(context);
    assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: fixed })(context.reserve, proof, capturedAt), false);
    assert.deepEqual(context.approval, content.approval);
    assert.equal(proof.actual_send, "UNKNOWN");
  } finally { current.cleanup(); }
});

test("official collector uses only bounded redirect-denying GitHub GET and filters response secrets", async () => {
  const originalFetch = globalThis.fetch;
  const data = responses();
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response(JSON.stringify(url.endsWith("/37909786610") ? data.run : data.job), {
      headers: { "content-type": "application/json" } });
  };
  try {
    const witness = await prepareIncidentFencingWitness(options());
    assert.deepEqual(calls, [
      "https://api.github.com/repos/bryrgr263-star/wuda-law-job-radar-2027/actions/runs/37909786610",
      "https://api.github.com/repos/bryrgr263-star/wuda-law-job-radar-2027/actions/jobs/113751898178" ]);
    assert.equal(canonicalSerialize(witness).includes("PRIVATE_SECRET"), false);
    assert.ok(Date.parse(witness.platform_capture.captured_at) >= Date.parse(approval.approved_at));
  } finally { globalThis.fetch = originalFetch; }
});

test("wrong approval scope rejects before collecting platform facts", async () => {
  const collector = controlled();
  await assert.rejects(prepareIncidentFencingWitnessForTest({ ...options(),
    approval: { ...approval, action: "COMPLETE" as "RECOVER_FENCED_UNKNOWN" } },
  { scope: "TEST_ONLY", collect: collector.collect, now: () => capturedAt }));
  assert.equal(collector.calls.length, 0);
});

test("official collector rejects redirect HTTP errors oversized bodies and suppresses sensitive errors", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    () => new Response("PRIVATE_SECRET", { status: 302, headers: { "content-type": "application/json" } }),
    () => new Response("PRIVATE_SECRET", { status: 403, headers: { "content-type": "application/json" } }),
    () => new Response("x".repeat(1024 * 1024 + 1), { headers: { "content-type": "application/json" } }),
    () => { throw new Error("PRIVATE_SECRET"); }
  ];
  try {
    for (const response of responses) {
      globalThis.fetch = async () => response();
      await assert.rejects(prepareIncidentFencingWitness(options()), (error: unknown) => {
        assert.equal((error as Error).message, "INCIDENT_FENCING_PREPARATION_DENIED");
        return true;
      });
    }
  } finally { globalThis.fetch = originalFetch; }
});
