import "../helpers/network-guard";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { executeContinuousRequest } from "../../lib/production-persistence/continuous-request-gate";
import { canonicalSerialize, canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { createSourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { AT, LATER, TARGET, identity, request, createRemote, restoreOwner, git, provenance } from "./continuous-acquisition-fixture";

function gate(checkout: string, id: string, options: Partial<Parameters<typeof executeContinuousRequest>[0]> = {}) {
  return { repository_path: checkout, branch: "main", authorization_ids: [id],
    source_admission_id: "admission-p2-05-test", recruitment_endpoint_id: "endpoint-p2-05-test",
    scope: "CONTROLLED_TEST" as const, commit_identity: identity, now: () => AT, ...options };
}
function root(remote: string, options: Partial<Parameters<typeof bootstrapZeroCostProductionCompositionRoot>[0]> = {}) {
  return bootstrapZeroCostProductionCompositionRoot({ remote_url: remote, branch: "main", stream_id: "continuous-controlled",
    now: () => AT, continuous_scope: "CONTROLLED_TEST", ...options });
}
async function issued(remote: Awaited<ReturnType<typeof createRemote>>) {
  const result = await root(remote.remote).issueContinuousAuthorization({ allowlist_entry_id: TARGET,
    effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
  return result.record.payload.grant!.authorization_id;
}
const failed = () => ({ status: "FAILED" as const, responded_at: AT as never, http_status: 503, headers: {}, mime_type: null,
  error: { code: "CONTROLLED_HTTP_FAILURE", message: "controlled", retryable: false } });

test("request mutation after committed reservation cannot change the validated dispatch target or headers", async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote);
    const mutable = structuredClone({ ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 });
    let sent = 0;
    await executeContinuousRequest(gate(remote.clone(), id, {
      after_reservation: () => { mutable.locator = "https://unapproved.invalid/sibling"; Reflect.set(mutable.headers, "Cookie", "unexpected"); },
      controlled_transport: { async execute(dispatched) {
        assert.equal(dispatched.locator, request.locator); assert.deepEqual(dispatched.headers, {});
        sent += 1; return failed();
      } }
    }), mutable);
    assert.equal(sent, 1);
  } finally { remote.remove(); }
});

test("gate dispatch observes committed reservation; HTTP failure still completes accounting and too-soon retry sends zero HTTP", async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote); let sent = 0;
    const checkout = remote.clone();
    await executeContinuousRequest(gate(checkout, id, { controlled_transport: { async execute() {
      const observed = new GitSourceRegistryPersistence({ repository_path: remote.clone() });
      assert.equal(observed.listContinuousRecords().at(-1)?.kind, "RESERVE"); sent += 1; return failed();
    } } }), { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 });
    assert.equal(sent, 1);
    const records = new GitSourceRegistryPersistence({ repository_path: remote.clone() }).listContinuousRecords();
    assert.deepEqual(records.map(record => record.kind), ["GRANT", "RESERVE", "COMPLETE"]);
    await assert.rejects(() => executeContinuousRequest(gate(remote.clone(), id, { controlled_transport: { async execute() { sent += 1; return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 }), /CADENCE/);
    assert.equal(sent, 1);
    await executeContinuousRequest(gate(remote.clone(), id, { now: () => LATER, controlled_transport: { async execute() { sent += 1; return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: LATER as never, timeout_ms: 1000 });
    assert.equal(sent, 2);
  } finally { remote.remove(); }
});
test("CAS loser and historical ACTIVE clone never dispatch, including revocation committed before dispatch", async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote); const writerA = remote.clone(); const writerB = remote.clone(); let loserSent = 0;
    await executeContinuousRequest(gate(writerA, id, { controlled_transport: { async execute() { return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 });
    await assert.rejects(() => executeContinuousRequest(gate(writerB, id, { controlled_transport: { async execute() { loserSent += 1; return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 }), /STALE_HEAD|CAS/);
    assert.equal(loserSent, 0);
    const active = remote.clone();
    await root(remote.remote).revokeContinuousAuthorization({ authorization_id: id, actor: "operator", reference: "controlled:revoke" });
    for (const checkout of [active, remote.clone()]) await assert.rejects(() => executeContinuousRequest(gate(checkout, id, {
      now: () => LATER, controlled_transport: { async execute() { loserSent += 1; return failed(); } }
    }), { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: LATER as never, timeout_ms: 1000 }), /STALE_HEAD|REVOKED/);
    assert.equal(loserSent, 0);
  } finally { remote.remove(); }
});
test("pending gate orders revocation against dispatch; issued grant reuse has no new commit", async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote);
    const prior = (await root(remote.remote).restore()).committed_head;
    const reused = await root(remote.remote, { now: () => LATER }).issueContinuousAuthorization({ allowlist_entry_id: TARGET,
      effective_from: AT, min_interval_seconds: 60, actor: "another" });
    assert.equal(reused.committed_head, prior);
    await executeContinuousRequest(gate(remote.clone(), id, { controlled_transport: { async execute() {
      await assert.rejects(() => root(remote.remote).revokeContinuousAuthorization({ authorization_id: id, actor: "operator", reference: "race" }), /PENDING/);
      return failed();
    } } }), { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 });
    await root(remote.remote).revokeContinuousAuthorization({ authorization_id: id, actor: "operator", reference: "after-completion" });
    const state = await root(remote.remote).restore();
    assert.equal(state.continuous_authorizations[0]?.state, "REVOKED");
    assert.equal(state.continuous_records.filter(record => record.kind === "REVOKE").length, 1);
  } finally { remote.remove(); }
});
for (const crash of ["BEFORE_SEND", "UNKNOWN_SEND"] as const) test(`${crash} preserves pending gate; restart never auto-retries; recovery defaults DENY`, async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote); let sent = 0;
    await assert.rejects(() => executeContinuousRequest(gate(remote.clone(), id, {
      after_reservation: crash === "BEFORE_SEND" ? () => { throw new Error("controlled crash"); } : undefined,
      controlled_transport: { async execute() { sent += 1; throw new Error("unknown send state"); } }
    }), { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 }));
    assert.equal(sent, crash === "BEFORE_SEND" ? 0 : 1);
    const state = await root(remote.remote).restore(); const pending = state.continuous_authorizations[0]!.pending_attempt!;
    assert.ok(pending);
    await assert.rejects(() => root(remote.remote).recoverContinuousAttempt({ attempt_id: pending.payload.attempt_id!, fencing_evidence: { terminated: true } }), /FENCING/);
    await assert.rejects(() => executeContinuousRequest(gate(remote.clone(), id, { now: () => "2030-01-01T00:00:00.000Z", controlled_transport: {
      async execute() { sent += 1; return failed(); }
    } }), { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 }), /PENDING/);
    const verifier = (attempt: import("../../lib/application/source-admission/continuous-acquisition").ContinuousRecord,
      proof: Readonly<Record<string, unknown>>) => proof.terminated === true && proof.holder === attempt.payload.holder;
    await root(remote.remote, { now: () => LATER, continuous_fencing_verifier: verifier }).recoverContinuousAttempt({
      attempt_id: pending.payload.attempt_id!, fencing_evidence: { terminated: true, holder: pending.payload.holder } });
    await assert.rejects(() => root(remote.remote).restore(), /FENCING/);
    assert.equal((await root(remote.remote, { continuous_fencing_verifier: verifier }).restore()).continuous_authorizations[0]?.pending_attempt, null);
  } finally { remote.remove(); }
});
test("fresh child Process B restores committed grant bytes, seals, cadence, revocation and pending without Process A memory", async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote);
    await root(remote.remote).issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT, min_interval_seconds: 90, actor: "reviewer" });
    await executeContinuousRequest(gate(remote.clone(), id, { controlled_transport: { async execute() { return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 });
    const moduleUrl = pathToFileURL(path.resolve("lib/production-persistence/zero-cost-production-composition-root.ts")).href;
    const guardUrl = pathToFileURL(path.resolve("tests/helpers/network-guard.ts")).href;
    const script = path.join(remote.directory, "process-b.mts"); const output = path.join(remote.directory, "restored.json");
    writeFileSync(script, `import ${JSON.stringify(guardUrl)}; import {bootstrapZeroCostProductionCompositionRoot} from ${JSON.stringify(moduleUrl)};
      import {writeFileSync} from 'node:fs'; const state=await bootstrapZeroCostProductionCompositionRoot({remote_url:${JSON.stringify(remote.remote)},branch:'main',stream_id:'continuous-controlled',continuous_scope:'CONTROLLED_TEST'}).restore();
      writeFileSync(${JSON.stringify(output)},JSON.stringify(state));`);
    const execute = () => { const require = createRequire(import.meta.url);
      execFileSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, script], { stdio: ["ignore", "pipe", "pipe"] });
      return JSON.parse(readFileSync(output, "utf8")); };
    const expected = await root(remote.remote).restore(); const restored = execute();
    assert.equal(canonicalSerialize(restored.continuous_records), canonicalSerialize(expected.continuous_records));
    assert.equal(restored.continuous_authorizations[0].grant.authorization_id, id);
    assert.equal(restored.continuous_authorizations[0].grant.authorization_version, 2);
    await assert.rejects(() => executeContinuousRequest(gate(remote.clone(), id, { now: () => LATER,
      after_reservation: () => { throw new Error("controlled crash before send"); }, controlled_transport: { async execute() { throw new Error("must not send"); } }
    }), { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: LATER as never, timeout_ms: 1000 }));
    const pending = execute(); assert.ok(pending.continuous_authorizations[0].pending_attempt);
    assert.equal(canonicalSerialize(pending.continuous_records), canonicalSerialize((await root(remote.remote).restore()).continuous_records));
    const verifier = (attempt: import("../../lib/application/source-admission/continuous-acquisition").ContinuousRecord,
      proof: Readonly<Record<string, unknown>>) => proof.fenced_holder === attempt.payload.holder;
    await root(remote.remote, { now: () => LATER, continuous_fencing_verifier: verifier }).recoverContinuousAttempt({
      attempt_id: pending.continuous_authorizations[0].pending_attempt.payload.attempt_id,
      fencing_evidence: { fenced_holder: pending.continuous_authorizations[0].pending_attempt.payload.holder } });
    writeFileSync(script, readFileSync(script, "utf8").replace("continuous_scope:'CONTROLLED_TEST'", "continuous_scope:'CONTROLLED_TEST',continuous_fencing_verifier:(attempt,proof)=>proof.fenced_holder===attempt.payload.holder"));
    await root(remote.remote, { now: () => LATER, continuous_fencing_verifier: verifier }).revokeContinuousAuthorization({ authorization_id: id, actor: "operator", reference: "test" });
    assert.equal(execute().continuous_authorizations[0].state, "REVOKED");
    const another = await root(remote.remote, { continuous_fencing_verifier: verifier }).issueContinuousAuthorization({ allowlist_entry_id: TARGET,
      effective_from: AT, min_interval_seconds: 60, actor: "reviewer" }).catch(() => null);
    assert.equal(another, null);
  } finally { remote.remove(); }
});
test("binding revisions require explicit reauthorization; grants retain stream ID and cadence across revision", async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote); let sent = 0;
    await executeContinuousRequest(gate(remote.clone(), id, { controlled_transport: { async execute() { sent += 1; return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 });
    const checkout = remote.clone(); const repo = new GitSourceRegistryPersistence({ repository_path: checkout });
    const prior = (await repo.listVersions()).find(version => version.artifact.kind === "SOURCE_DEFINITION")!;
    assert.equal(prior.artifact.kind, "SOURCE_DEFINITION"); if (prior.artifact.kind !== "SOURCE_DEFINITION") throw new Error("fixture source missing");
    const revised = createSourcePersistenceVersion({ stream_id: prior.stream_id, revision: 2, supersedes_artifact_id: prior.artifact_id,
      artifact: { kind: "SOURCE_DEFINITION", payload: { ...prior.artifact.payload, name: { original: { ...prior.artifact.payload.name.original, text: "Changed official source contract" } } } },
      provenance, effective_at: AT, created_at: AT });
    await repo.appendVersion(revised); git(checkout, "add", "production-source-state");
    git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Controlled source revision");
    git(checkout, "push", "origin", "HEAD:main");
    await assert.rejects(() => executeContinuousRequest(gate(remote.clone(), id, { controlled_transport: { async execute() { sent += 1; return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 }), /REAUTHORIZE_REQUIRED/);
    assert.equal(sent, 1);
    const newGrant = await root(remote.remote).issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT, min_interval_seconds: 60, actor: "reviewer" });
    assert.equal(newGrant.record.payload.grant!.authorization_id, id); assert.equal(newGrant.record.payload.grant!.authorization_version, 2);
    await assert.rejects(() => executeContinuousRequest(gate(remote.clone(), id, { controlled_transport: { async execute() { sent += 1; return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 }), /CADENCE/);
    assert.equal(sent, 1);
  } finally { remote.remove(); }
});
test("two same-parent writers race for reservation: only CAS winner dispatches and loser sends zero HTTP", async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote); const writers = [remote.clone(), remote.clone()]; const sent = [0, 0];
    const results = await Promise.allSettled(writers.map((checkout, index) => executeContinuousRequest(gate(checkout, id,
      { controlled_transport: { async execute() { sent[index]! += 1; return failed(); } } }),
      { ...request, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, requested_at: AT as never, timeout_ms: 1000 })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.deepEqual([...sent].sort(), [0, 1]);
    const rejected = results.find(result => result.status === "rejected")!;
    if (rejected.status === "rejected") assert.match(String(rejected.reason), /CAS|STALE_HEAD/);
  } finally { remote.remove(); }
});
test("persistent same-ID same-bytes reuse is idempotent; changed sealed bytes collide", async () => {
  const remote = await createRemote(); try {
    await issued(remote); const checkout = remote.clone(); const repo = new GitSourceRegistryPersistence({ repository_path: checkout });
    const record = repo.listContinuousRecords()[0]!; const expected_parent = repo.readCommittedHead();
    assert.equal(await repo.publishContinuousRecord(record, { expected_parent, branch: "main", commit_identity: identity }), expected_parent);
    const altered = structuredClone(record); Reflect.set(altered.payload.grant!.issuance_envelope, "actor", "changed");
    const { integrity_hash: ignored, ...content } = altered; Reflect.set(altered, "integrity_hash", canonicalHash(content));
    await assert.rejects(() => repo.publishContinuousRecord(altered, { expected_parent, branch: "main", commit_identity: identity }), /COLLISION/);
    const owner = await restoreOwner(repo); assert.equal(owner.listContinuousRecords().length, 1);
    assert.equal(createHash("sha256").update(canonicalSerialize(record)).digest("hex").length, 64);
  } finally { remote.remove(); }
});
test("fresh committed restoration denies corrupt revocation, missing references and truncated append-only history", async () => {
  const remote = await createRemote(); try {
    const id = await issued(remote);
    await root(remote.remote).revokeContinuousAuthorization({ authorization_id: id, actor: "operator", reference: "controlled:revoke" });
    for (const damage of ["RECORD_BYTES", "MISSING_REFERENCE", "TRUNCATED_HISTORY"] as const) {
      const checkout = remote.clone();
      const currentPath = path.join(checkout, "production-source-state/state/current.json");
      const state = JSON.parse(readFileSync(currentPath, "utf8"));
      if (damage === "RECORD_BYTES") {
        const recordPath = path.join(checkout, state.continuous_records.at(-1).path);
        const record = JSON.parse(readFileSync(recordPath, "utf8")); record.payload.authorization_id = "forged";
        writeFileSync(recordPath, canonicalSerialize(record));
      } else {
        if (damage === "TRUNCATED_HISTORY") state.continuous_records.pop();
        else state.continuous_records.at(-1).path += ".missing";
        const { integrity_hash: ignored, ...content } = state; state.integrity_hash = canonicalHash(content);
        const bytes = canonicalSerialize(state);
        writeFileSync(currentPath, bytes);
        writeFileSync(path.join(checkout, `production-source-state/state/history/${state.integrity_hash}.json`), bytes);
      }
      git(checkout, "add", "production-source-state");
      git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", `Controlled corruption ${damage}`);
      await assert.rejects(() => root(checkout).restore(), /INTEGRITY|REFERENCE|append-only|history/u);
    }
  } finally { remote.remove(); }
});
