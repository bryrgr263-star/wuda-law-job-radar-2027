import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { transpileModule } from "typescript";
import os from "node:os";
import path from "node:path";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { readGitIncidentContinuousFencingContext } from "../../lib/production-persistence/git-incident-fencing-context";
import { createIncidentContinuousFencingEvidence } from "../../lib/production-persistence/continuous-fencing-evidence";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { executeContinuousRequest } from "../../lib/production-persistence/continuous-request-gate";
import { fixture, identity } from "./continuous-acquisition-fixture";

const baseline = "f40714dc001994ca140df6002138c09aa5be223b";
const recoveredAt = "2026-10-10T07:00:00.000Z";
const reservePath = "production-source-state/continuous/records/d4e160eb543706d5ff5d4a14364f6382e565100f54dabb3587593709cd8270ad.json";

test("fenced termination coverage requires exact retained intent and source metadata", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/production-persistence/zero-cost-production-composition-root.ts"), "utf8");
  const start = source.indexOf("function assertCommittedIntentCoverage(");
  const end = source.indexOf("\nfunction squashAndCommit(", start);
  assert.ok(start >= 0 && end > start);
  const javascript = transpileModule(source.slice(start, end), {}).outputText;
  const coverage = new Function("canonicalSerialize", `${javascript}; return assertCommittedIntentCoverage;`)(canonicalSerialize);
  const intent = JSON.parse(execFileSync("git", ["-c", "core.longpaths=true", "show",
    `${baseline}:production-runs/source-request-intents/3c263ab2ab56fae9d1a82e569ae30ca4b9c1490ca848191c3b5d39329cb60b16.json`],
  { encoding: "utf8", windowsHide: true }));
  const outcome = { outcome_kind: "FENCED_UNKNOWN_TERMINATION", source_execution_id: intent.source_execution_id,
    source_definition_id: intent.source_definition_id, recruitment_endpoint_id: intent.recruitment_endpoint_id,
    source_admission_artifact_id: intent.source_admission_artifact_id,
    source_version_ids: [intent.source_artifact_id, intent.endpoint_artifact_id,
      intent.source_admission_artifact_id, intent.targets[0].allowlist_artifact_id],
    continuous_authorization_ids: [intent.targets[0].authorization_id], fenced_recovery: { intent_hash: intent.integrity_hash } };
  assert.doesNotThrow(() => coverage([intent], [outcome]));
  assert.throws(() => coverage([], [outcome]), /FENCED_RECOVERY_INTENT_COVERAGE_MISMATCH/u);
  for (const altered of [
    { ...outcome, fenced_recovery: { intent_hash: "0".repeat(64) } },
    { ...outcome, source_execution_id: "wrong" },
    { ...outcome, source_definition_id: "wrong" },
    { ...outcome, recruitment_endpoint_id: "wrong" },
    { ...outcome, source_admission_artifact_id: "wrong" },
    { ...outcome, source_version_ids: [...outcome.source_version_ids].reverse() },
    { ...outcome, continuous_authorization_ids: ["wrong"] }
  ]) assert.throws(() => coverage([intent], [altered]), /FENCED_RECOVERY_INTENT_COVERAGE_MISMATCH/u);
  assert.doesNotThrow(() => coverage([intent], [{ outcome_kind: "RECOVERY_TERMINATION",
    source_execution_id: intent.source_execution_id, recovery: { intent_hash: intent.integrity_hash } }]));
  assert.doesNotThrow(() => coverage([], [{ source_execution_id: "historical-no-query" }]));
});

function setup(witnessPresent = true) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ifw-"));
  const seed = path.join(directory, "seed");
  const remote = path.join(directory, "remote.git");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "core.longpaths=true", ...args], {
    cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(directory, "clone", "--quiet", "--shared", "--no-checkout", process.cwd(), seed);
  git(seed, "checkout", "--quiet", "-B", "main", baseline);
  const reserve = JSON.parse(git(seed, "show", `HEAD:${reservePath}`));
  const intent = JSON.parse(git(seed, "show", "HEAD:production-runs/source-request-intents/3c263ab2ab56fae9d1a82e569ae30ca4b9c1490ca848191c3b5d39329cb60b16.json"));
  const content = {
    schema_version: "git-incident-fencing-witness/2.0.0", historical_parent: baseline,
    platform_capture: { captured_at: "2026-10-10T00:00:00.000Z", executor_head_sha: "a0e64bb9d4a8caf7a3006537376e0e74c8296222" },
    reserve: { record_id: reserve.record_id, integrity_hash: reserve.integrity_hash },
    intent: { integrity_hash: intent.integrity_hash, source_execution_id: intent.source_execution_id,
      introducing_commit: "804e221ed9f49ef94c959110a32157d804768831" },
    executor: { repository: "bryrgr263-star/wuda-law-job-radar-2027", run_id: "37909786610", job_id: "113751898178",
      run_attempt: 1, batch_id: "github-actions:37909786610:1", status: "completed", conclusion: "failure",
      completed_at: "2026-10-09T09:15:22.000Z", reservation_commit: "57ebf594af3b1019552edae25e9d9cd639aa48bb",
      source_execution_id: intent.source_execution_id },
    approval: { reference: "call_5e6879fe41a74f70bdc3c853658bee0e", approved_at: "2026-10-10T00:00:00.000Z",
      attempt_id: reserve.payload.attempt_id, action: "RECOVER_FENCED_UNKNOWN" }, actual_send: "UNKNOWN"
  };
  if (witnessPresent) {
    const witness = { ...content, integrity_hash: canonicalHash(content) };
    const file = `production-source-state/continuous/fencing/${witness.integrity_hash}.json`;
    mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
    writeFileSync(path.join(seed, file), canonicalSerialize(witness));
    git(seed, "add", "--", file);
    git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "--no-gpg-sign", "-qm", "TEST_ONLY witness");
  }
  git(directory, "clone", "--quiet", "--bare", "--shared", seed, remote);
  git(seed, "remote", "set-url", "origin", remote);
  const context = witnessPresent ? readGitIncidentContinuousFencingContext({ repository_path: seed, fixed_sha: git(seed, "rev-parse", "HEAD") }) : null;
  const proof = context ? createIncidentContinuousFencingEvidence(context) : null;
  const root = () => bootstrapZeroCostProductionCompositionRoot({ remote_url: remote, branch: "main",
    stream_id: "TEST_ONLY:incident-wiring", now: () => recoveredAt });
  return { directory, seed, remote, git, reserve, proof, root,
    cleanup: () => {
      const resolved = path.resolve(directory);
      if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe TEST_ONLY directory");
      rmSync(resolved, { recursive: true, force: true });
    } };
}

test("default production control recovers only committed incident proof with no caller verifier", async () => {
  const current = setup();
  try {
    assert.ok(current.proof);
    const before = current.git(current.remote, "rev-parse", "main");
    await assert.rejects(current.root().recoverContinuousAttempt({ attempt_id: current.reserve.payload.attempt_id,
      fencing_evidence: { ...current.proof, holder: "wrong" } }), /FENCING/);
    assert.equal(current.git(current.remote, "rev-parse", "main"), before);
    const result = await current.root().recoverContinuousAttempt({ attempt_id: current.reserve.payload.attempt_id,
      fencing_evidence: { ...current.proof } });
    assert.equal(result.record.kind, "RECOVER");
    assert.equal(result.record.payload.outcome, "FENCED_UNKNOWN");
    assert.equal(result.record.payload.min_interval_seconds, 86400);
    const checkout = path.join(current.directory, "readback");
    current.git(current.directory, "clone", "--quiet", current.remote, checkout);
    const repository = new GitSourceRegistryPersistence({ repository_path: checkout });
    assert.equal(repository.listContinuousRecords().at(-1)!.kind, "RECOVER");
    assert.equal(current.git(checkout, "show", `HEAD:${reservePath}`), current.git(checkout, "show", `${baseline}:${reservePath}`));
    assert.deepEqual(current.git(checkout, "diff", "--name-only", before, "HEAD").split(/\r?\n/u)
      .filter(file => !file.startsWith("production-source-state/")), []);
  } finally { current.cleanup(); }
});

test("default recovery without a committed witness remains denied", async () => {
  const current = setup(false);
  try {
    const before = current.git(current.remote, "rev-parse", "main");
    await assert.rejects(current.root().recoverContinuousAttempt({ attempt_id: current.reserve.payload.attempt_id,
      fencing_evidence: { terminated: true } }), /FENCING/);
    assert.equal(current.git(current.remote, "rev-parse", "main"), before);
  } finally { current.cleanup(); }
});

test("request gate final owner restore uses repository verifier after historical incident recovery", async () => {
  const current = setup();
  try {
    assert.ok(current.proof);
    await current.root().recoverContinuousAttempt({ attempt_id: current.reserve.payload.attempt_id, fencing_evidence: { ...current.proof } });
    current.git(current.seed, "pull", "--quiet", "--ff-only", "origin", "main");
    const controlled = fixture();
    const repository = new GitSourceRegistryPersistence({ repository_path: current.seed });
    for (const version of controlled.versions) await repository.appendVersion(version);
    current.git(current.seed, "add", "--", "production-source-state");
    current.git(current.seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "TEST_ONLY controlled source");
    current.git(current.seed, "push", "--quiet", "origin", "HEAD:main");
    const controlledRoot = bootstrapZeroCostProductionCompositionRoot({ remote_url: current.remote, branch: "main",
      stream_id: "TEST_ONLY:controlled", continuous_scope: "CONTROLLED_TEST", now: () => recoveredAt });
    const issued = await controlledRoot.issueContinuousAuthorization({ allowlist_entry_id: controlled.context.bindings.target.id,
      actor: "TEST_ONLY", effective_from: recoveredAt, min_interval_seconds: 86400 });
    current.git(current.seed, "pull", "--quiet", "--ff-only", "origin", "main");
    const grant = issued.record.payload.grant!;
    let sent = 0;
    const result = await executeContinuousRequest({ repository_path: current.seed, branch: "main", scope: "CONTROLLED_TEST",
      authorization_ids: [grant.authorization_id], source_admission_id: controlled.admitted.source_admission_id,
      recruitment_endpoint_id: controlled.endpoint.recruitment_endpoint_id, commit_identity: identity, now: () => recoveredAt,
      controlled_transport: { async execute() { sent += 1; return { status: "FAILED", responded_at: recoveredAt as never,
        http_status: null, headers: {}, mime_type: null, error: { code: "TEST_ONLY", message: "TEST_ONLY", retryable: false } }; } }
    }, { recruitment_endpoint_id: controlled.endpoint.recruitment_endpoint_id, locator: controlled.endpoint.locator,
      method: "GET", headers: {}, parameters: {}, requested_at: recoveredAt as never, timeout_ms: 1000 });
    assert.equal(sent, 1);
    assert.equal(result.response.status, "FAILED");
    const records = new GitSourceRegistryPersistence({ repository_path: current.seed }).listContinuousRecords();
    assert.equal(records.filter(record => record.kind === "RECOVER").length, 1);
    assert.equal(records.at(-1)!.kind, "COMPLETE");
    assert.notEqual(records.at(-1)!.payload.attempt_id, current.reserve.payload.attempt_id);
  } finally { current.cleanup(); }
});
