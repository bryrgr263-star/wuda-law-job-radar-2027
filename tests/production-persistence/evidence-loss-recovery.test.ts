import "../helpers/network-guard";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { executeContinuousRequest } from "../../lib/production-persistence/continuous-request-gate";
import { sealSourceExecutionRequestIntent, writeSourceExecutionRequestIntent } from "../../lib/production-persistence/source-execution-request-intent";
import { readSourceExecutionOutcomes, writeSourceExecutionOutcome } from "../../lib/production-persistence/source-execution-outcome";
import { reserveContinuousRecord } from "../../lib/application/source-admission/continuous-acquisition";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { createSourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { AT, LATER, TARGET, URL, createRemote, git, identity } from "./continuous-acquisition-fixture";

const decisionAt = "2026-09-18T00:03:00.000Z";
const executionId = "controlled-evidence-loss";

test("evidence-loss preparation is a separate read-only production-root operation", () => {
  const root = bootstrapZeroCostProductionCompositionRoot({ remote_url: "unused-offline", branch: "main", stream_id: "recovery" });
  assert.equal(typeof root.prepareEvidenceLossRecovery, "function");
});

test("a completed lost execution restores as explicit failed termination without invented acquisition or history changes", async () => {
  const remote = await lostExecution();
  try {
    const before = await remote.root.restore();
    assert.equal(before.source_execution_outcomes.length, 0);
    assert.equal(before.continuous_records.at(-1)?.kind, "COMPLETE");
    const parent = git(remote.checkout, "rev-parse", "HEAD");
    const prepared = await remote.root.prepareEvidenceLossRecovery({ expected_parent: parent,
      source_execution_id: executionId, actor: "controlled-operator", approval_reference: "TEST_ONLY:loss-confirmation",
      incident_baseline: parent, decided_at: decisionAt, original_evidence_available: false });
    assert.equal(git(remote.directory, "--git-dir", remote.remote, "rev-parse", "main"), parent);
    assert.equal(prepared.outcome.status, "FAILED");
    assert.equal(prepared.outcome.outcome_kind, "RECOVERY_TERMINATION");
    assert.equal(prepared.outcome.recovery?.reason, "UNPUBLISHED_EVIDENCE_LOST");
    assert.deepEqual(prepared.outcome.raw_blob_ids, []);
    assert.deepEqual(prepared.outcome.snapshot_ids, []);
    assert.deepEqual(prepared.outcome.acquisition_run_ids, []);
    assert.equal(prepared.outcome.request_plan, undefined);
    const { integrity_hash: originalHash, ...content } = prepared.outcome;
    const invented = { ...content, snapshot_ids: ["invented-snapshot"] };
    assert.throws(() => writeSourceExecutionOutcome(remote.checkout, { ...invented,
      integrity_hash: canonicalHash(invented) }), /RECOVERY_SCHEMA_INVALID/);
    const malformed = { ...content, snapshot_ids: "" };
    assert.throws(() => writeSourceExecutionOutcome(remote.checkout, { ...malformed,
      integrity_hash: canonicalHash(malformed) } as never), /RECOVERY_SCHEMA_INVALID/);
    const tampered = { ...content, recovery: { ...content.recovery!, reserve: {
      ...content.recovery!.reserve, integrity_hash: "0".repeat(64) } } };
    const badCheckout = remote.clone();
    writeSourceExecutionOutcome(badCheckout, { ...tampered, integrity_hash: canonicalHash(tampered) });
    git(badCheckout, "add", "production-runs/source-executions");
    git(badCheckout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled invalid recovery proof");
    await assert.rejects(() => readSourceExecutionOutcomes(badCheckout, [], remote.input.versions,
      before.continuous_records, async () => null), /RECOVERY_UPSTREAM_MISMATCH/);
    assert.equal(originalHash, prepared.outcome.integrity_hash);
    writeSourceExecutionOutcome(remote.checkout, prepared.outcome);
    writeSourceExecutionOutcome(remote.checkout, prepared.outcome);
    git(remote.checkout, "add", "production-runs/source-executions");
    git(remote.checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled explicit failed recovery");
    git(remote.checkout, "push", "origin", "HEAD:main");
    const ending = git(remote.checkout, "rev-parse", "HEAD");
    assert.equal(git(remote.checkout, "rev-parse", "HEAD^"), parent);
    assert.equal(git(remote.checkout, "diff", parent, ending, "--", "trusted-state", "trusted-objects", "production-source-state"), "");
    const after = await remote.root.restore();
    assert.equal(after.acquisition_count, 0);
    assert.equal(after.restored_record_count, 0);
    assert.equal(after.read_models.length, 0);
    assert.equal(after.source_execution_outcomes.length, 1);
    assert.equal(canonicalSerialize(after.continuous_records), canonicalSerialize(before.continuous_records));
    assert.equal(remote.sent(), 1);
    const modulePath = pathToFileURL(path.resolve("lib/production-persistence/zero-cost-production-composition-root.ts")).href;
    const guardPath = pathToFileURL(path.resolve("tests/helpers/network-guard.ts")).href;
    const child = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import ${JSON.stringify(guardPath)};import {bootstrapZeroCostProductionCompositionRoot} from ${JSON.stringify(modulePath)};const state=await bootstrapZeroCostProductionCompositionRoot(${JSON.stringify(remote.options)}).restore();console.log(JSON.stringify({head:state.committed_head,outcome:state.source_execution_outcomes[0],records:state.continuous_records,acquisitions:state.acquisition_count,models:state.read_models.length}));`],
    { encoding: "utf8", timeout: 120000 });
    const fresh = JSON.parse(child.trim());
    assert.equal(fresh.head, ending);
    assert.equal(canonicalHash(fresh.outcome), canonicalHash(prepared.outcome));
    assert.equal(canonicalHash(fresh.records), canonicalHash(before.continuous_records));
    assert.equal(fresh.acquisitions, 0);
    assert.equal(fresh.models, 0);
    await assert.rejects(() => remote.root.prepareEvidenceLossRecovery({ expected_parent: ending,
      source_execution_id: executionId, actor: "controlled-operator", approval_reference: "TEST_ONLY:loss-confirmation",
      incident_baseline: parent, decided_at: decisionAt, original_evidence_available: false }), /RECOVERY_ALREADY_COVERED/);
  } finally { remote.remove(); }
});

test("recovery preparation rejects stale parent, missing approval, surviving bytes and wrong execution", async () => {
  const remote = await lostExecution();
  try {
    const parent = git(remote.checkout, "rev-parse", "HEAD");
    const input = { expected_parent: parent, source_execution_id: executionId, actor: "controlled-operator",
      approval_reference: "TEST_ONLY:loss-confirmation", incident_baseline: parent,
      decided_at: decisionAt, original_evidence_available: false };
    for (const change of [{ expected_parent: "0".repeat(40) }, { approval_reference: "" },
      { original_evidence_available: true }, { source_execution_id: "different-execution" },
      { decided_at: AT }, { incident_baseline: "0".repeat(40) }]) {
      await assert.rejects(() => remote.root.prepareEvidenceLossRecovery({ ...input, ...change }), /RECOVERY_|CAS_MISMATCH/);
    }
    assert.equal(git(remote.directory, "--git-dir", remote.remote, "rev-parse", "main"), parent);
    assert.equal(remote.sent(), 1);
  } finally { remote.remove(); }
});

test("Process B rejects every acquisition sibling, not only acquisition number one", async () => {
  const remote = await lostExecution();
  try {
    const parent = git(remote.checkout, "rev-parse", "HEAD");
    const prepared = await remote.root.prepareEvidenceLossRecovery({ expected_parent: parent,
      source_execution_id: executionId, actor: "controlled-operator", approval_reference: "TEST_ONLY:loss-confirmation",
      incident_baseline: parent, decided_at: decisionAt, original_evidence_available: false });
    commitRecovery(remote.checkout, prepared.outcome);
    const records = new GitSourceRegistryPersistence({ repository_path: remote.checkout }).listContinuousRecords();
    for (const number of [1, 2]) {
      await assert.rejects(() => readSourceExecutionOutcomes(remote.checkout,
        [{ acquisition_run: { acquisition_run_id: `${executionId}:acquisition:${number}` } }] as never,
        remote.input.versions, records, async () => { throw new Error("Raw read must not occur"); }), /RECOVERY_ACQUISITION_ALREADY_PRESENT/);
    }
  } finally { remote.remove(); }
});

test("a later grant and unrelated intent cannot invalidate a previously verified recovery", async () => {
  const remote = await lostExecution();
  try {
    const parent = git(remote.checkout, "rev-parse", "HEAD");
    const prepared = await remote.root.prepareEvidenceLossRecovery({ expected_parent: parent,
      source_execution_id: executionId, actor: "controlled-operator", approval_reference: "TEST_ONLY:loss-confirmation",
      incident_baseline: parent, decided_at: decisionAt, original_evidence_available: false });
    commitRecovery(remote.checkout, prepared.outcome);
    const checkout = remote.clone();
    const repository = new GitSourceRegistryPersistence({ repository_path: checkout });
    const mapping = new Map(remote.input.versions.map(version => [version.stream_id, `${version.stream_id}-later`]));
    mapping.set(URL, `${URL}/later`);
    mapping.set("/recruitment", "/recruitment/later");
    const remap = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value,
      (_key, field) => typeof field === "string" ? mapping.get(field) ?? field : field));
    for (const version of remote.input.versions) {
      const laterVersion = createSourcePersistenceVersion({ stream_id: mapping.get(version.stream_id)!, revision: 1,
        supersedes_artifact_id: null, artifact: remap(version.artifact), provenance: version.provenance,
        effective_at: decisionAt, created_at: decisionAt });
      mapping.set(version.artifact_id, laterVersion.artifact_id);
      await repository.appendVersion(laterVersion);
    }
    git(checkout, "add", "production-source-state");
    git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled independent future source");
    git(checkout, "push", "origin", "HEAD:main");
    const laterRoot = bootstrapZeroCostProductionCompositionRoot({ ...remote.options, now: () => decisionAt });
    const laterGrant = await laterRoot.issueContinuousAuthorization({ allowlist_entry_id: mapping.get(TARGET)!,
      effective_from: decisionAt, min_interval_seconds: 90, actor: "controlled-reviewer" });
    const intentCheckout = remote.clone();
    const { schema_version, integrity_hash, ...intentContent } = remote.intent;
    assert.ok(schema_version && integrity_hash);
    writeSourceExecutionRequestIntent(intentCheckout, sealSourceExecutionRequestIntent({ ...remap(intentContent),
      source_execution_id: "later-execution", targets: remap(remote.intent.targets).map(target => ({ ...target,
        authorization_id: laterGrant.record.payload.grant!.authorization_id })) }));
    git(intentCheckout, "add", "production-runs/source-request-intents");
    git(intentCheckout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled later intent");
    git(intentCheckout, "push", "origin", "HEAD:main");
    const restored = await laterRoot.restore();
    assert.equal(restored.source_execution_outcomes[0]!.integrity_hash, prepared.outcome.integrity_hash);
    assert.equal(restored.source_execution_request_intents.length, 2);
    assert.equal(remote.sent(), 1);
  } finally { remote.remove(); }
});

test("an older execution cannot claim a later uncovered intent and request attempt", async () => {
  const remote = await lostExecution();
  try {
    const { schema_version, integrity_hash, ...intentContent } = remote.intent;
    assert.ok(schema_version && integrity_hash);
    const later = sealSourceExecutionRequestIntent({ ...intentContent, source_execution_id: "later-uncovered-execution" });
    writeSourceExecutionRequestIntent(remote.checkout, later);
    git(remote.checkout, "add", "production-runs/source-request-intents");
    git(remote.checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled different execution intent");
    const laterIntentCommit = git(remote.checkout, "rev-parse", "HEAD");
    git(remote.checkout, "push", "origin", "HEAD:main");
    await executeContinuousRequest({ repository_path: remote.checkout, branch: "main", authorization_ids: [remote.authorization],
      source_admission_id: remote.input.admitted.source_admission_id, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id,
      scope: "CONTROLLED_TEST", commit_identity: identity, now: () => decisionAt, controlled_transport: { async execute() {
        return { status: "SUCCESS", bytes: new Uint8Array([1]), content_sha256: createHash("sha256").update(new Uint8Array([1])).digest("hex") as never,
          responded_at: decisionAt as never, mime_type: "text/html", http_status: 200, headers: {} };
      } } }, { locator: URL, method: "GET", headers: {}, parameters: {},
      recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, timeout_ms: 1000, requested_at: decisionAt as never });
    const prepared = await remote.root.prepareEvidenceLossRecovery({ expected_parent: git(remote.checkout, "rev-parse", "HEAD"),
      source_execution_id: later.source_execution_id, actor: "controlled-operator", approval_reference: "TEST_ONLY:later-loss",
      incident_baseline: laterIntentCommit, decided_at: decisionAt, original_evidence_available: false });
    const { integrity_hash: hash, ...content } = prepared.outcome;
    assert.ok(hash);
    const forged = { ...content, source_execution_id: executionId,
      recovery: { ...content.recovery!, intent_hash: remote.intent.integrity_hash, intent_commit: laterIntentCommit } };
    writeSourceExecutionOutcome(remote.checkout, { ...forged, integrity_hash: canonicalHash(forged) });
    git(remote.checkout, "add", "production-runs/source-executions");
    git(remote.checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled forged old execution association");
    const records = new GitSourceRegistryPersistence({ repository_path: remote.checkout }).listContinuousRecords();
    await assert.rejects(() => readSourceExecutionOutcomes(remote.checkout, [], remote.input.versions, records,
      async () => null), /RECOVERY_ORIGINAL_INTENT_MISMATCH/);
  } finally { remote.remove(); }
});

test("recovery never finalizes an unresolved reservation or invents a missing completion", async () => {
  const remote = await lostExecution(true);
  try {
    const parent = git(remote.checkout, "rev-parse", "HEAD");
    await assert.rejects(() => remote.root.prepareEvidenceLossRecovery({ expected_parent: parent,
      source_execution_id: executionId, actor: "controlled-operator", approval_reference: "TEST_ONLY:loss-confirmation",
      incident_baseline: parent, decided_at: decisionAt, original_evidence_available: false }), /RECOVERY_COMPLETED_ATTEMPT_REQUIRED/);
    const restored = await remote.root.restore();
    assert.equal(restored.continuous_records.at(-1)?.kind, "RESERVE");
    assert.equal(restored.source_execution_outcomes.length, 0);
    assert.equal(remote.sent(), 0);
    assert.equal(git(remote.directory, "--git-dir", remote.remote, "rev-parse", "main"), parent);
  } finally { remote.remove(); }
});

test("failed termination after later revocation neither changes cadence history nor reactivates authorization", async () => {
  const remote = await lostExecution();
  try {
    const incident = git(remote.checkout, "rev-parse", "HEAD");
    const control = bootstrapZeroCostProductionCompositionRoot({ ...remote.options, now: () => decisionAt });
    const revoked = await control.revokeContinuousAuthorization({ authorization_id: remote.authorization,
      actor: "controlled-reviewer", reference: "TEST_ONLY:revoked-after-original-request" });
    const prepared = await control.prepareEvidenceLossRecovery({ expected_parent: revoked.committed_head,
      source_execution_id: executionId, actor: "controlled-operator", approval_reference: "TEST_ONLY:loss-confirmation",
      incident_baseline: incident, decided_at: decisionAt, original_evidence_available: false });
    const checkout = remote.clone();
    writeSourceExecutionOutcome(checkout, prepared.outcome);
    git(checkout, "add", "production-runs/source-executions");
    git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled revoked failed recovery");
    git(checkout, "push", "origin", "HEAD:main");
    const restored = await control.restore();
    assert.deepEqual(restored.continuous_records.map(record => record.kind), ["GRANT", "RESERVE", "COMPLETE", "REVOKE"]);
    assert.equal(restored.continuous_records.find(record => record.kind === "COMPLETE")?.payload.at, LATER);
    assert.throws(() => reserveContinuousRecord(restored.continuous_records, remote.authorization, remote.input.context,
      { locator: URL, method: "GET", headers: {}, parameters: {} }, "forbidden-new-attempt", "holder",
      "2026-09-19T00:00:00.000Z", "CONTROLLED_TEST"), /AUTHORIZATION_REVOKED/);
    assert.equal(remote.sent(), 1);
  } finally { remote.remove(); }
});

async function lostExecution(pending = false) {
  const remote = await createRemote();
  const options = { remote_url: remote.remote, branch: "main", stream_id: "loss-recovery-test",
    execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
    commit_identity: identity, now: () => AT };
  const root = bootstrapZeroCostProductionCompositionRoot(options);
  const issued = await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET,
    effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
  const checkout = remote.clone();
  const versions = remote.input.versions;
  const source = versions.find(version => version.artifact.kind === "SOURCE_DEFINITION")!;
  const endpoint = versions.find(version => version.artifact.kind === "RECRUITMENT_ENDPOINT")!;
  const admission = versions.find(version => version.artifact.kind === "SOURCE_ADMISSION")!;
  const allowlist = versions.find(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST")!;
  const authorization = issued.record.payload.grant!.authorization_id;
  const intent = sealSourceExecutionRequestIntent({ source_execution_id: executionId,
    source_definition_id: remote.input.endpoint.source_definition_id, source_artifact_id: source.artifact_id,
    source_revision: source.revision, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id,
    endpoint_artifact_id: endpoint.artifact_id, source_admission_artifact_id: admission.artifact_id,
    targets: [{ allowlist_entry_id: TARGET, allowlist_artifact_id: allowlist.artifact_id, exact_url: URL,
      authorization_id: authorization, source_admission_artifact_id: admission.artifact_id,
      endpoint_purpose: "JOB_LIST", request_policy: { method: "GET", redirect: "DENY", query: "DENY" } }] });
  writeSourceExecutionRequestIntent(checkout, intent);
  git(checkout, "add", "production-runs/source-request-intents");
  git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled original intent");
  git(checkout, "push", "origin", "HEAD:main");
  let sent = 0;
  const execution = executeContinuousRequest({ repository_path: checkout, branch: "main", authorization_ids: [authorization],
    source_admission_id: remote.input.admitted.source_admission_id,
    recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, scope: "CONTROLLED_TEST",
    commit_identity: identity, now: () => LATER,
    after_reservation: pending ? () => { throw new Error("controlled interruption before send"); } : undefined,
    controlled_transport: { async execute() {
      sent += 1;
      const bytes = new TextEncoder().encode("Controlled acquired bytes lost before source outcome");
      return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
        responded_at: LATER as never, mime_type: "text/html", http_status: 200, headers: {} };
    } } }, { locator: URL, method: "GET", headers: {}, parameters: {},
      recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id,
      timeout_ms: 1000, requested_at: LATER as never });
  if (pending) await assert.rejects(() => execution, /controlled interruption before send/);
  else await execution;
  return { ...remote, checkout, options, root, authorization, intent, sent: () => sent };
}

function commitRecovery(checkout: string, outcome: Parameters<typeof writeSourceExecutionOutcome>[1]) {
  writeSourceExecutionOutcome(checkout, outcome);
  git(checkout, "add", "production-runs/source-executions");
  git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled failed recovery");
  git(checkout, "push", "origin", "HEAD:main");
}
