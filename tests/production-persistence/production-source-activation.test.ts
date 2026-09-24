import "../helpers/network-guard";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { registeredProductionAdapterKeys, resolveProductionAdapter } from "../../lib/production-automation";
import { createInitialProductionActivationVersions, INITIAL_PRODUCTION_ACTIVATION_AT,
  INITIAL_PRODUCTION_CADENCE_SECONDS } from "../../lib/production-sources/initial-production-activation";
import { resolveContinuousSourceContext } from "../../lib/production-persistence/continuous-source-context";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { enumerateScheduledSources } from "../../lib/production-persistence/scheduler-source-enumeration";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { closeContinuousRecord, issueContinuousRecord, reserveContinuousRecord,
  revokeContinuousRecord, validateContinuousContext } from "../../lib/application/source-admission/continuous-acquisition";
import { createSourcePersistenceVersion } from "../../lib/production-persistence/contracts";

test("production adapter registry resolves only the two approved official adapters", () => {
  const keys = registeredProductionAdapterKeys();
  assert.deepEqual(keys, [
    "cn-haier-2027-legal-official-html",
    "cn-zhenghan-2027-official-html"
  ]);
  for (const key of keys) assert.equal(resolveProductionAdapter(key)?.descriptor.adapter_key, key);
  assert.equal(resolveProductionAdapter("unknown"), null);
});

test("committed activation restores in fresh Process B and scheduler enumerates only three exact targets", async () => {
  const repository = await createActivatedRepository();
  try {
    const first = bootstrapZeroCostProductionCompositionRoot(repository.options);
    const targets = [
      "allowlist-cn-zhenghan-2027-announcement",
      "allowlist-cn-zhenghan-2027-detail",
      "allowlist-cn-haier-2027-legal-rid-61"
    ];
    const authorizationIds: string[] = [];
    for (const allowlistEntryId of targets) {
      const issued = await first.issueContinuousAuthorization({ allowlist_entry_id: allowlistEntryId,
        effective_from: INITIAL_PRODUCTION_ACTIVATION_AT,
        min_interval_seconds: INITIAL_PRODUCTION_CADENCE_SECONDS,
        actor: "approved-initial-source-activation" });
      authorizationIds.push(issued.record.payload.grant!.authorization_id);
    }
    const second = bootstrapZeroCostProductionCompositionRoot(repository.options);
    const restored = await second.restore();
    assert.equal(restored.continuous_authorizations.length, 3);
    assert.ok(restored.continuous_authorizations.every(item => item.state === "ACTIVE"));
    const checkout = repository.clone();
    const store = new GitSourceRegistryPersistence({ repository_path: checkout });
    const versions = await store.listVersions();
    const selected = enumerateScheduledSources(versions, store.listContinuousRecords(),
      INITIAL_PRODUCTION_ACTIVATION_AT, "PRODUCTION");
    assert.equal(selected.eligible.length, 3);
    assert.deepEqual([...new Set(selected.eligible.map(item => item.source_definition_id))].sort(), [
      "source-cn-haier-2027-legal-campus-recruitment", "source-cn-zhenghan-2027-campus-recruitment"
    ]);
    assert.deepEqual(selected.deferred, []);
    for (const item of selected.eligible) {
      const adapter = resolveProductionAdapter(item.adapter_key);
      assert.ok(adapter);
      const context = resolveContinuousSourceContext(versions, targets[authorizationIds.indexOf(item.authorization_id)]!);
      assert.equal(adapter.validateEndpoint(context.endpoint).valid, true);
      assert.equal(item.exact_url, context.admission.continuous_acquisition_scope?.exact_targets.find(target =>
        target.allowlist_entry_id === context.bindings.target.id)?.exact_url);
    }
    await second.revokeContinuousAuthorization({ authorization_id: authorizationIds[1]!,
      actor: "approved-initial-source-activation", reference: "controlled-revocation-test" });
    const third = bootstrapZeroCostProductionCompositionRoot(repository.options);
    const afterRevoke = await third.restore();
    assert.equal(afterRevoke.continuous_authorizations.find(item =>
      item.grant.authorization_id === authorizationIds[1])?.state, "REVOKED");
    const revokedCheckout = repository.clone();
    const revokedStore = new GitSourceRegistryPersistence({ repository_path: revokedCheckout });
    const revokedSelection = enumerateScheduledSources(await revokedStore.listVersions(),
      revokedStore.listContinuousRecords(), INITIAL_PRODUCTION_ACTIVATION_AT, "PRODUCTION");
    assert.equal(revokedSelection.eligible.length, 2);
    assert.ok(revokedSelection.eligible.every(item => item.authorization_id !== authorizationIds[1]));
  } finally {
    repository.remove();
  }
});

test("cadence, unknown adapter, and changed endpoint purpose fail closed without network", () => {
  const versions = createInitialProductionActivationVersions();
  const context = resolveContinuousSourceContext(versions, "allowlist-cn-haier-2027-legal-rid-61");
  const approval = validateContinuousContext(context);
  assert.equal(resolveProductionAdapter("unregistered-production-adapter"), null);
  assert.equal(resolveProductionAdapter("cn-zhenghan-2027-official-html")!.validateEndpoint(context.endpoint).valid, false);
  const at = INITIAL_PRODUCTION_ACTIVATION_AT;
  const grant = issueContinuousRecord([], context, { effective_from: at,
    min_interval_seconds: INITIAL_PRODUCTION_CADENCE_SECONDS, actor: "approved-reviewer", issued_at: at });
  const authorizationId = grant.payload.grant!.authorization_id;
  const request = { locator: approval.exact_url, method: "GET", headers: {}, parameters: {} };
  const reserved = reserveContinuousRecord([grant], authorizationId, context, request,
    "attempt-one", "holder", at, "PRODUCTION");
  const completed = closeContinuousRecord([grant, reserved], "attempt-one", "holder", at, "SUCCESS");
  const records = [grant, reserved, completed];
  const hourLater = new Date(Date.parse(at) + 3_600_000).toISOString();
  assert.throws(() => reserveContinuousRecord(records, authorizationId, context, request,
    "attempt-two", "holder", hourLater, "PRODUCTION"), /CADENCE_EXCEEDED_OR_CLOCK_INVALID/u);
  const revoked = revokeContinuousRecord(records, authorizationId, "approved-reviewer", hourLater, "manual-revocation");
  assert.throws(() => reserveContinuousRecord([...records, revoked], authorizationId, context, request,
    "attempt-three", "holder", hourLater, "PRODUCTION"), /AUTHORIZATION_REVOKED/u);

  const current = versions.filter(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST"
    && version.stream_id === context.bindings.target.id).at(-1)!;
  if (current.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") throw new Error("Unexpected target kind");
  const mismatched = createSourcePersistenceVersion({ stream_id: current.stream_id,
    revision: current.revision + 1, supersedes_artifact_id: current.artifact_id,
    artifact: { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: { ...current.artifact.payload,
      endpoint_purpose: "OTHER_PURPOSE" } }, provenance: current.provenance,
    effective_at: at, created_at: at });
  assert.throws(() => validateContinuousContext(resolveContinuousSourceContext([...versions, mismatched],
    context.bindings.target.id)), /APPROVAL_BINDING_INVALID/u);

  const source = versions.find(version => version.artifact.kind === "SOURCE_DEFINITION"
    && version.stream_id === context.bindings.source.id)!;
  if (source.artifact.kind !== "SOURCE_DEFINITION") throw new Error("Unexpected source kind");
  const changedSource = createSourcePersistenceVersion({ stream_id: source.stream_id,
    revision: source.revision + 1, supersedes_artifact_id: source.artifact_id,
    artifact: { kind: "SOURCE_DEFINITION", payload: { ...source.artifact.payload,
      name: { original: { ...source.artifact.payload.name.original, text: "Changed official source" } } } },
    provenance: source.provenance, effective_at: at, created_at: at });
  const changedSelection = enumerateScheduledSources([...versions, changedSource], [grant], at, "PRODUCTION");
  assert.deepEqual(changedSelection.eligible, []);
});

async function createActivatedRepository() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "production-source-activation-"));
  const remote = path.join(directory, "remote.git");
  const seed = path.join(directory, "seed");
  const identity = { name: "Production Activation Offline Test", email: "activation@invalid.local" };
  git(directory, "init", "--bare", "--quiet", remote);
  git(directory, "init", "--quiet", "-b", "main", seed);
  writeFileSync(path.join(seed, "README.md"), "Offline activation test\n");
  git(seed, "add", "README.md");
  git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Initial state");
  git(seed, "remote", "add", "origin", remote);
  const store = new GitSourceRegistryPersistence({ repository_path: seed });
  for (const version of createInitialProductionActivationVersions()) await store.appendVersion(version);
  git(seed, "add", "production-source-state");
  git(seed, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-qm", "Approved source versions");
  git(seed, "push", "origin", "HEAD:main");
  let cloneNumber = 0;
  return { directory, remote, options: { remote_url: remote, branch: "main", stream_id: "production-source-activation-test",
    execution_mode: "TEST_ONLY" as const, continuous_scope: "PRODUCTION" as const,
    now: () => INITIAL_PRODUCTION_ACTIVATION_AT, commit_identity: identity },
    clone() { cloneNumber += 1; const checkout = path.join(directory, `reader-${cloneNumber}`);
      git(directory, "clone", "--quiet", "-b", "main", remote, checkout); return checkout; },
    remove() { rmSync(directory, { recursive: true, force: true }); } };
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("activation preserves canary identities and versions only reviewed continuous governance", () => {
  const versions = createInitialProductionActivationVersions();
  const sources = versions.filter(version => version.artifact.kind === "SOURCE_DEFINITION");
  assert.equal(sources.length, 2);
  assert.ok(sources.every(version => version.revision === 1));
  const admissions = versions.filter(version => version.artifact.kind === "SOURCE_ADMISSION");
  assert.deepEqual(admissions.map(version => version.revision), [1, 2, 1, 2]);
  const targets = [
    ["allowlist-cn-zhenghan-2027-announcement", "https://www.zhenghan.com/news/2782.html"],
    ["allowlist-cn-zhenghan-2027-detail", "https://www.zhenghan.com/news/2790.html"],
    ["allowlist-cn-haier-2027-legal-rid-61", "https://maker.haier.net/client/campus/customizedptjobdetail/sid/64/rid/61"]
  ];
  for (const [targetId, exactUrl] of targets) {
    const context = resolveContinuousSourceContext(versions, targetId);
    assert.equal(context.admission.admission_level, "B");
    assert.equal(context.admission.automation_basis, "HUMAN_APPROVED_CONTINUOUS_SCOPE");
    assert.equal(context.admission.continuous_acquisition_scope?.min_interval_seconds, 86_400);
    assert.equal(context.target.endpoint_purpose, context.admission.endpoint_purpose);
    assert.ok(context.admission.continuous_acquisition_scope?.exact_targets.some(target =>
      target.allowlist_entry_id === targetId && target.exact_url === exactUrl));
  }
});
