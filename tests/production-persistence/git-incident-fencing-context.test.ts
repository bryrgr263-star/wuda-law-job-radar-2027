import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createIncidentContinuousFencingEvidence } from "../../lib/production-persistence/continuous-fencing-evidence";
import { createGitIncidentContinuousFencingVerifier, readGitIncidentContinuousFencingContext,
  type GitIncidentFencingWitness, type GitIncidentFencingWitnessV2 } from "../../lib/production-persistence/git-incident-fencing-context";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { closeContinuousRecord, sealContinuousRecord } from "../../lib/application/source-admission/continuous-acquisition";
import { rehydrateProductionSourceOwners } from "../../lib/production-persistence/source-owner-rehydration";
import { InMemorySourceAdmissionRegister } from "../../lib/application/source-admission/source-admission-register";
import { InMemorySourceRegistry } from "../../lib/ingestion/registry/source-registry";
import { assertFencedUnknownSourceOutcomeBinding, createFencedUnknownSourceExecutionOutcome,
  readSourceExecutionOutcomes, writeSourceExecutionOutcome } from "../../lib/production-persistence/source-execution-outcome";

const baseline = "f40714dc001994ca140df6002138c09aa5be223b";
const reservePath = "production-source-state/continuous/records/d4e160eb543706d5ff5d4a14364f6382e565100f54dabb3587593709cd8270ad.json";
const intentPath = "production-runs/source-request-intents/3c263ab2ab56fae9d1a82e569ae30ca4b9c1490ca848191c3b5d39329cb60b16.json";
const prefix = "production-source-state/continuous/fencing/";

test("committed outcome binding and default restore reject sealed recovery before capture", async () => {
  const current = setup();
  try {
    const { integrity_hash: _hash, ...content } = current.witness;
    const changed = { ...content, platform_capture: { ...content.platform_capture, captured_at: "2026-10-10T06:00:00.000Z" } };
    const witnessHead = current.commit({ ...changed, integrity_hash: canonicalHash(changed) });
    const context = readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: witnessHead });
    assert.ok(context);
    const repository = new GitSourceRegistryPersistence({ repository_path: current.seed });
    const versions = await repository.listVersions();
    const records = repository.listContinuousRecords();
    const payload = current.reserve.payload;
    const recovered = sealContinuousRecord(records, "RECOVER", payload.attempt_id, {
      attempt_id: payload.attempt_id, holder: payload.holder, target_key: payload.target_key,
      min_interval_seconds: payload.min_interval_seconds, at: "2026-10-10T05:00:00.000Z", outcome: "FENCED_UNKNOWN",
      fencing_evidence: createIncidentContinuousFencingEvidence(context) as unknown as Readonly<Record<string, unknown>> });
    const state = JSON.parse(current.git("show", `${witnessHead}:production-source-state/state/current.json`));
    const recordPath = `production-source-state/continuous/records/${canonicalHash({ record_id: recovered.record_id })}.json`;
    const stateContent = { schema_version: state.schema_version, previous_state_hash: state.integrity_hash,
      versions: state.versions, continuous_records: [...state.continuous_records,
        { record_id: recovered.record_id, path: recordPath, integrity_hash: recovered.integrity_hash }] };
    const nextState = { ...stateContent, integrity_hash: canonicalHash(stateContent) };
    for (const [file, value] of [[recordPath, recovered], ["production-source-state/state/current.json", nextState],
      [`production-source-state/state/history/${nextState.integrity_hash}.json`, nextState]] as const) {
      mkdirSync(path.dirname(path.join(current.seed, file)), { recursive: true });
      writeFileSync(path.join(current.seed, file), canonicalSerialize(value));
      current.git("add", "--", file);
    }
    current.git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "-qm", "TEST_ONLY adverse backdated recovery");
    const parent = current.git("rev-parse", "HEAD");
    const intent = JSON.parse(current.git("show", `${parent}:${intentPath}`));
    mkdirSync(path.dirname(path.join(current.seed, intentPath)), { recursive: true });
    writeFileSync(path.join(current.seed, intentPath), canonicalSerialize(intent));
    const outcome = createFencedUnknownSourceExecutionOutcome({ intent, reserve: current.reserve, recovered,
      fencing_context: context, expected_parent: parent });
    assert.throws(() => assertFencedUnknownSourceOutcomeBinding(current.seed, outcome, versions, [...records, recovered]),
      /FENCED_SOURCE_OUTCOME_UPSTREAM_MISMATCH/);
    assert.throws(() => new GitSourceRegistryPersistence({ repository_path: current.seed }), /FENCING_NOT_VERIFIED/);
  } finally { current.cleanup(); }
});

test("fenced outcome binding reconstructs committed recovery and rejects re-sealed reference changes", async () => {
  const current = setup();
  try {
    const witnessHead = current.commit();
    const context = readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: witnessHead });
    assert.ok(context);
    const repository = new GitSourceRegistryPersistence({ repository_path: current.seed });
    const versions = await repository.listVersions();
    const records = repository.listContinuousRecords();
    const recovered = closeContinuousRecord(records, current.reserve.payload.attempt_id, current.reserve.payload.holder,
      "2026-10-10T07:00:00.000Z", "FENCED_UNKNOWN", createIncidentContinuousFencingEvidence(context) as unknown as Readonly<Record<string, unknown>>,
      repository.continuousFencingVerifier);
    const state = JSON.parse(current.git("show", `${witnessHead}:production-source-state/state/current.json`));
    const recordPath = `production-source-state/continuous/records/${canonicalHash({ record_id: recovered.record_id })}.json`;
    const content = { schema_version: state.schema_version, previous_state_hash: state.integrity_hash,
      versions: state.versions, continuous_records: [...state.continuous_records,
        { record_id: recovered.record_id, path: recordPath, integrity_hash: recovered.integrity_hash }] };
    const nextState = { ...content, integrity_hash: canonicalHash(content) };
    for (const [file, value] of [[recordPath, recovered], ["production-source-state/state/current.json", nextState],
      [`production-source-state/state/history/${nextState.integrity_hash}.json`, nextState]] as const) {
      mkdirSync(path.dirname(path.join(current.seed, file)), { recursive: true });
      writeFileSync(path.join(current.seed, file), canonicalSerialize(value));
      current.git("add", "--", file);
    }
    current.git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "-qm", "TEST_ONLY recovered prefix");
    const parent = current.git("rev-parse", "HEAD");
    const intent = JSON.parse(current.git("show", `${parent}:${intentPath}`));
    mkdirSync(path.dirname(path.join(current.seed, intentPath)), { recursive: true });
    writeFileSync(path.join(current.seed, intentPath), canonicalSerialize(intent));
    const outcome = createFencedUnknownSourceExecutionOutcome({ intent, reserve: current.reserve, recovered,
      fencing_context: context, expected_parent: parent });
    assert.doesNotThrow(() => assertFencedUnknownSourceOutcomeBinding(current.seed, outcome, versions, [...records, recovered]));
    const { integrity_hash: originalHash, ...originalContent } = outcome;
    assert.ok(originalHash);
    const forged = { ...originalContent, fenced_recovery: { ...outcome.fenced_recovery,
      recovered: { ...outcome.fenced_recovery.recovered, integrity_hash: "0".repeat(64) } } };
    assert.throws(() => assertFencedUnknownSourceOutcomeBinding(current.seed,
      { ...forged, integrity_hash: canonicalHash(forged) }, versions, [...records, recovered]), /UPSTREAM_MISMATCH/);
    writeSourceExecutionOutcome(current.seed, outcome);
    current.git("add", "--", `production-runs/source-executions/${canonicalHash({ source_execution_id: outcome.source_execution_id })}.json`);
    current.git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "-qm", "TEST_ONLY fenced outcome");
    assert.equal(current.git("diff", "--name-only", "--diff-filter=D", baseline, "HEAD"), "");
    const restored = await readSourceExecutionOutcomes(current.seed, [], versions, [...records, recovered], async () => null);
    assert.deepEqual(restored, [outcome]);
    const child = execFileSync(process.execPath, ["--import", "tsx", "-e", `
      require(${JSON.stringify(path.resolve("tests/helpers/network-guard.ts"))});
      const { GitSourceRegistryPersistence } = require(${JSON.stringify(path.resolve("lib/production-persistence/git-source-registry-persistence.ts"))});
      const { readSourceExecutionOutcomes } = require(${JSON.stringify(path.resolve("lib/production-persistence/source-execution-outcome.ts"))});
      const { bootstrapZeroCostProductionCompositionRoot } = require(${JSON.stringify(path.resolve("lib/production-persistence/zero-cost-production-composition-root.ts"))});
      (async () => {
        const repository = new GitSourceRegistryPersistence({ repository_path: process.argv[1] });
        const outcomes = await readSourceExecutionOutcomes(process.argv[1], [], await repository.listVersions(),
          repository.listContinuousRecords(), async () => null);
        const root = bootstrapZeroCostProductionCompositionRoot({ remote_url: process.argv[1],
          branch: "TEST_ONLY-fencing", stream_id: "initial-production-source-activation" });
        const restored = await root.restore();
        process.stdout.write(JSON.stringify({ outcomes,
          root_outcome: restored.source_execution_outcomes.find(value => value.source_execution_id === outcomes[0].source_execution_id),
          recovery_count: restored.continuous_records.filter(value => value.kind === "RECOVER").length,
          position_count: new Set(restored.read_models.map(value => value.position_id)).size }));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `, current.seed], { encoding: "utf8", windowsHide: true, timeout: 900000 });
    const childResult = JSON.parse(child);
    assert.deepEqual(childResult.outcomes, [outcome]);
    assert.deepEqual(childResult.root_outcome, outcome);
    assert.equal(childResult.recovery_count, 1);
    assert.equal(childResult.position_count, 4);
  } finally { current.cleanup(); }
});

test("source owner restoration uses repository-owned fencing without a caller predicate", async () => {
  const current = setup();
  try {
    const fixed = current.commit();
    const context = readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: fixed });
    assert.ok(context);
    const proof = createIncidentContinuousFencingEvidence(context);
    const repository = new GitSourceRegistryPersistence({ repository_path: current.seed });
    const records = repository.listContinuousRecords();
    const recovered = closeContinuousRecord(records, current.reserve.payload.attempt_id, current.reserve.payload.holder,
      "2026-10-10T07:00:00.000Z", "FENCED_UNKNOWN", proof as unknown as Readonly<Record<string, unknown>>,
      repository.continuousFencingVerifier);
    const admission = new InMemorySourceAdmissionRegister();
    await rehydrateProductionSourceOwners({ repository, source_registry: new InMemorySourceRegistry(),
      source_admission_register: admission, continuous_records: [...records, recovered] });
    assert.equal(admission.resolveContinuousAuthorization(current.reserve.payload.authorization_id).pending_attempt, null);
  } finally { current.cleanup(); }
});

test("default source persistence owns its fixed-commit incident verifier", () => {
  const current = setup();
  try {
    const fixed = current.commit();
    const context = readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: fixed });
    assert.ok(context);
    const proof = createIncidentContinuousFencingEvidence(context);
    const repository = new GitSourceRegistryPersistence({ repository_path: current.seed });
    assert.equal(repository.continuousFencingVerifier(current.reserve, proof as unknown as Readonly<Record<string, unknown>>, "2026-10-10T07:00:00.000Z"), true);
    assert.equal(repository.continuousFencingVerifier(current.reserve, { terminated: true }, "2026-10-10T07:00:00.000Z"), false);
  } finally { current.cleanup(); }
});

function setup() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ifc-"));
  const seed = path.join(directory, "seed");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: seed, encoding: "utf8", windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", process.cwd(), seed], { windowsHide: true });
  git("symbolic-ref", "HEAD", "refs/heads/TEST_ONLY-fencing");
  git("update-ref", "refs/heads/TEST_ONLY-fencing", baseline);
  git("read-tree", baseline);
  const reserve = JSON.parse(git("show", `${baseline}:${reservePath}`));
  const intent = JSON.parse(git("show", `${baseline}:${intentPath}`));
  const content = {
    schema_version: "git-incident-fencing-witness/2.0.0" as const, historical_parent: baseline,
    platform_capture: { captured_at: "2026-10-10T00:00:00.000Z", executor_head_sha: "a0e64bb9d4a8caf7a3006537376e0e74c8296222" },
    reserve: { record_id: reserve.record_id, integrity_hash: reserve.integrity_hash },
    intent: { integrity_hash: intent.integrity_hash, source_execution_id: intent.source_execution_id,
      introducing_commit: "804e221ed9f49ef94c959110a32157d804768831" },
    executor: { repository: "bryrgr263-star/wuda-law-job-radar-2027", run_id: "37909786610", job_id: "113751898178",
      run_attempt: 1, batch_id: "github-actions:37909786610:1", status: "completed" as const, conclusion: "failure" as const,
      completed_at: "2026-10-09T09:15:22.000Z", reservation_commit: "57ebf594af3b1019552edae25e9d9cd639aa48bb",
      source_execution_id: intent.source_execution_id },
    approval: { reference: "call_5e6879fe41a74f70bdc3c853658bee0e", approved_at: "2026-10-10T00:00:00.000Z",
      attempt_id: reserve.payload.attempt_id, action: "RECOVER_FENCED_UNKNOWN" as const }, actual_send: "UNKNOWN" as const
  };
  const witness: GitIncidentFencingWitnessV2 = { ...content, integrity_hash: canonicalHash(content) };
  const commit = (value: GitIncidentFencingWitness | GitIncidentFencingWitnessV2 = witness) => {
    const file = `${prefix}${value.integrity_hash}.json`;
    mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
    writeFileSync(path.join(seed, file), canonicalSerialize(value));
    git("add", "--", file);
    git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "--no-gpg-sign", "-qm", "TEST_ONLY witness");
    return git("rev-parse", "HEAD");
  };
  return { seed, git, reserve, witness, commit, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("legacy witness remains inspectable but cannot authorize production recovery", () => {
  const current = setup();
  try {
    const { platform_capture: _capture, integrity_hash: _hash, ...original } = current.witness;
    const content = { ...original, schema_version: "git-incident-fencing-witness/1.0.0" as const,
      approval: { ...original.approval, reference: "TEST_ONLY:historical-approval" } };
    const legacy = { ...content, integrity_hash: canonicalHash(content) };
    const bytes = canonicalSerialize(legacy);
    const fixed = current.commit(legacy);
    const options = { repository_path: current.seed, fixed_sha: fixed };
    const context = readGitIncidentContinuousFencingContext(options);
    assert.ok(context);
    assert.equal(current.git("show", `${fixed}:${prefix}${legacy.integrity_hash}.json`), bytes);
    const verifier = createGitIncidentContinuousFencingVerifier(options) as (attempt: unknown, proof: unknown, at?: string) => boolean;
    assert.equal(verifier(current.reserve, createIncidentContinuousFencingEvidence(context), "2026-10-10T07:00:00.000Z"), false);
  } finally { current.cleanup(); }
});

test("default verifier rejects missing closing time and recovery backdated before independent capture", () => {
  const current = setup();
  try {
    const content = { ...current.witness, platform_capture: { ...current.witness.platform_capture,
      captured_at: "2026-10-10T06:00:00.000Z" } };
    const { integrity_hash: _hash, ...unsealed } = content;
    const fixed = current.commit({ ...unsealed, integrity_hash: canonicalHash(unsealed) });
    const options = { repository_path: current.seed, fixed_sha: fixed };
    const context = readGitIncidentContinuousFencingContext(options);
    assert.ok(context);
    const proof = createIncidentContinuousFencingEvidence(context);
    const verifier = createGitIncidentContinuousFencingVerifier(options) as (attempt: unknown, proof: unknown, at?: string) => boolean;
    assert.equal(verifier(current.reserve, proof, "2026-10-10T05:59:59.999Z"), false);
    assert.equal(verifier(current.reserve, proof), false);
    assert.equal(verifier(current.reserve, proof, "invalid"), false);
    assert.equal(verifier(current.reserve, proof, "2026-10-10T06:00:00.000Z"), true);
    const repository = new GitSourceRegistryPersistence({ repository_path: current.seed });
    assert.throws(() => closeContinuousRecord(repository.listContinuousRecords(), current.reserve.payload.attempt_id,
      current.reserve.payload.holder, "2026-10-10T05:59:59.999Z", "FENCED_UNKNOWN",
      proof as unknown as Readonly<Record<string, unknown>>, repository.continuousFencingVerifier), /FENCING_NOT_VERIFIED/);
    assert.equal(closeContinuousRecord(repository.listContinuousRecords(), current.reserve.payload.attempt_id,
      current.reserve.payload.holder, "2026-10-10T06:00:00.000Z", "FENCED_UNKNOWN",
      proof as unknown as Readonly<Record<string, unknown>>, repository.continuousFencingVerifier).payload.at, "2026-10-10T06:00:00.000Z");
  } finally { current.cleanup(); }
});

test("fixed SHA context and verifier use committed incident history and witness only", () => {
  const current = setup();
  try {
    const fixed = current.commit();
    const options = { repository_path: current.seed, fixed_sha: fixed };
    const context = readGitIncidentContinuousFencingContext(options);
    assert.ok(context);
    const proof = createIncidentContinuousFencingEvidence(context);
    const verifier = createGitIncidentContinuousFencingVerifier(options);
    assert.equal(verifier(current.reserve, proof, "2026-10-10T07:00:00.000Z"), true);
    assert.equal(proof.actual_send, "UNKNOWN");
    assert.equal(context.executor.completed_at, "2026-10-09T09:15:22.000Z");
    mkdirSync(path.dirname(path.join(current.seed, reservePath)), { recursive: true });
    writeFileSync(path.join(current.seed, reservePath), "TEST_ONLY worktree tamper");
    writeFileSync(path.join(current.seed, `${prefix}${current.witness.integrity_hash}.json`), "{}");
    assert.equal(verifier(current.reserve, proof, "2026-10-10T07:00:00.000Z"), true);
    assert.equal(verifier({ ...current.reserve, payload: { ...current.reserve.payload, holder: "wrong" } }, proof, "2026-10-10T07:00:00.000Z"), false);
    assert.equal(verifier(current.reserve, { ...proof, terminated: true }, "2026-10-10T07:00:00.000Z"), false);
    assert.equal(current.git("show", `${fixed}:${reservePath}`), current.git("show", `${baseline}:${reservePath}`));
  } finally { current.cleanup(); }
});

test("absent witness invalid fixed SHA and wrong ancestor default deny", () => {
  const current = setup();
  try {
    assert.equal(readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: baseline }), null);
    assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: baseline })(current.reserve, {}, "2026-10-10T07:00:00.000Z"), false);
    for (const fixed of ["HEAD", "0".repeat(40), "804e221ed9f49ef94c959110a32157d804768831"]) {
      assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: fixed })(current.reserve, {}, "2026-10-10T07:00:00.000Z"), false);
    }
  } finally { current.cleanup(); }
});

test("deleted committed witness invalidates new SHA without changing prior fixed SHA", () => {
  const current = setup();
  try {
    const fixed = current.commit();
    const context = readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: fixed });
    assert.ok(context);
    const proof = createIncidentContinuousFencingEvidence(context);
    current.git("rm", "--", `${prefix}${current.witness.integrity_hash}.json`);
    current.git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "-qm", "TEST_ONLY delete");
    assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: current.git("rev-parse", "HEAD") })(current.reserve, proof, "2026-10-10T07:00:00.000Z"), false);
    assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: fixed })(current.reserve, proof, "2026-10-10T07:00:00.000Z"), true);
  } finally { current.cleanup(); }
});

test("re-sealed mismatched witness references scope and executor facts fail closed", () => {
  const current = setup();
  try {
    for (const change of [
      { reserve: { ...current.witness.reserve, integrity_hash: "0".repeat(64) } },
      { intent: { ...current.witness.intent, source_execution_id: "wrong" } },
      { intent: { ...current.witness.intent, introducing_commit: "0".repeat(40) } },
      { historical_parent: "0".repeat(40) },
      { executor: { ...current.witness.executor, completed_at: "2026-10-09T09:16:22.000Z" } },
      { approval: { ...current.witness.approval, action: "COMPLETE" } },
      { approval: { ...current.witness.approval, attempt_id: "wrong" } },
      { executor: { ...current.witness.executor, status: "in_progress" } },
      { platform_api_body: { token: "TEST_ONLY forbidden" } }
    ]) {
      current.git("update-ref", "refs/heads/TEST_ONLY-fencing", baseline);
      current.git("read-tree", baseline);
      const { integrity_hash, ...original } = current.witness;
      const content = { ...original, ...change };
      const fixed = current.commit({ ...content, integrity_hash: canonicalHash(content) } as unknown as GitIncidentFencingWitnessV2);
      assert.throws(() => readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: fixed }));
      assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: fixed })(current.reserve, {}, "2026-10-10T07:00:00.000Z"), false);
    }
  } finally { current.cleanup(); }
});

test("noncanonical or ambiguous committed witnesses cannot be accepted", () => {
  const current = setup();
  try {
    const first = current.commit();
    const context = readGitIncidentContinuousFencingContext({ repository_path: current.seed, fixed_sha: first });
    assert.ok(context);
    const proof = createIncidentContinuousFencingEvidence(context);
    writeFileSync(path.join(current.seed, `${prefix}${current.witness.integrity_hash}.json`),
      JSON.stringify(current.witness, null, 2));
    current.git("add", "--", prefix);
    current.git("-c", "user.name=TEST_ONLY", "-c", "user.email=test@invalid.local", "commit", "-qm", "TEST_ONLY noncanonical");
    assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: current.git("rev-parse", "HEAD") })(current.reserve, proof, "2026-10-10T07:00:00.000Z"), false);
    current.git("update-ref", "refs/heads/TEST_ONLY-fencing", first);
    current.git("read-tree", first);
    const { integrity_hash, ...content } = current.witness;
    const secondContent = { ...content, approval: { ...content.approval, reference: "TEST_ONLY:different-approval" } };
    const second = current.commit({ ...secondContent, integrity_hash: canonicalHash(secondContent) });
    assert.equal(createGitIncidentContinuousFencingVerifier({ repository_path: current.seed, fixed_sha: second })(current.reserve, proof, "2026-10-10T07:00:00.000Z"), false);
  } finally { current.cleanup(); }
});
