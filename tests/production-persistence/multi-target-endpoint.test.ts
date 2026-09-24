import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { RecruitmentAdapter, TransportResponse } from "../../lib/ingestion";
import { bootstrapProductionSchedulerBatch } from "../../lib/production-persistence/production-scheduler-batch";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { GitRawObjectPersistence } from "../../lib/production-persistence/git-raw-object-persistence";
import { resolveContinuousSourceContext } from "../../lib/production-persistence/continuous-source-context";
import { assertSourceExecutionRequestPlanBindings, sealSourceExecutionRequestPlan } from "../../lib/production-persistence/source-execution-request-plan";
import { readSourceExecutionRequestIntents, sealSourceExecutionRequestIntent,
  writeSourceExecutionRequestIntent } from "../../lib/production-persistence/source-execution-request-intent";
import { createZhenghan2027SourceVersions, ZHENGHAN_2027_ANNOUNCEMENT_URL,
  ZHENGHAN_2027_DETAIL_URL } from "../../lib/live-canary/real-2027-zhenghan/zhenghan-2027-source";
import { trustedFixture } from "../pipeline/position-bound-phase-fixture";
import { AT, LATER, TARGET, URL as SOURCE_URL, createRemote, fixture, git, identity, provenance } from "./continuous-acquisition-fixture";

const DETAIL_URL = "https://example.invalid/recruitment/detail";
const DETAIL_TARGET = "controlled-continuous-target-detail";

test("sealed request intent is idempotent, collision-safe and integrity-checked", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "source-request-intent-"));
  try {
    const source = fixture();
    const byKind = (kind: SourcePersistenceVersion["artifact"]["kind"]) => source.versions.find(version => version.artifact.kind === kind)!;
    const allowlist = byKind("OFFICIAL_ENDPOINT_ALLOWLIST");
    const intent = sealSourceExecutionRequestIntent({ source_execution_id: "controlled-intent",
      source_definition_id: source.endpoint.source_definition_id,
      source_artifact_id: byKind("SOURCE_DEFINITION").artifact_id,
      source_revision: byKind("SOURCE_DEFINITION").revision,
      recruitment_endpoint_id: source.endpoint.recruitment_endpoint_id,
      endpoint_artifact_id: byKind("RECRUITMENT_ENDPOINT").artifact_id,
      source_admission_artifact_id: byKind("SOURCE_ADMISSION").artifact_id,
      targets: [{ allowlist_entry_id: TARGET, allowlist_artifact_id: allowlist.artifact_id,
        exact_url: SOURCE_URL, authorization_id: null,
        source_admission_artifact_id: byKind("SOURCE_ADMISSION").artifact_id,
        endpoint_purpose: source.admitted.endpoint_purpose,
        request_policy: { method: "GET", redirect: "DENY", query: "DENY" } }] });
    const first = writeSourceExecutionRequestIntent(directory, intent);
    assert.equal(first.appended, true);
    assert.equal(writeSourceExecutionRequestIntent(directory, intent).appended, false);
    assert.equal(readSourceExecutionRequestIntents(directory, source.versions, []).length, 1);
    const { schema_version: schemaVersion, integrity_hash: integrityHash, ...intentContent } = intent;
    assert.ok(schemaVersion && integrityHash);
    const conflicting = sealSourceExecutionRequestIntent({ ...intentContent,
      targets: [{ ...intent.targets[0]!, endpoint_purpose: "JOB_DETAIL" }] });
    assert.throws(() => writeSourceExecutionRequestIntent(directory, conflicting), /SOURCE_REQUEST_INTENT_COLLISION/u);
    writeFileSync(path.join(directory, first.relative), "{}");
    assert.throws(() => readSourceExecutionRequestIntents(directory, source.versions, []));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Zhenghan's two historical exact URLs require purpose supersession, not a compatibility exception", () => {
  const historical = createZhenghan2027SourceVersions({ observed_at: AT, provenance });
  const admission = historical.find(version => version.artifact.kind === "SOURCE_ADMISSION")!;
  assert.equal(admission.artifact.kind, "SOURCE_ADMISSION");
  const admissionPurpose = admission.artifact.payload.endpoint_purpose;
  const allowlists = historical.filter(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST");
  assert.equal(allowlists.length, 2);
  assert.deepEqual(allowlists.map(version => {
    assert.equal(version.artifact.kind, "OFFICIAL_ENDPOINT_ALLOWLIST");
    return `https://${version.artifact.payload.host}${version.artifact.payload.path_prefix}`;
  }), [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL]);
  assert.ok(allowlists.every(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST"
    && version.artifact.payload.endpoint_purpose !== admissionPurpose));
  const superseded = allowlists.map(version => {
    assert.equal(version.artifact.kind, "OFFICIAL_ENDPOINT_ALLOWLIST");
    return createSourcePersistenceVersion({ stream_id: version.stream_id, revision: version.revision + 1,
      supersedes_artifact_id: version.artifact_id, effective_at: AT, created_at: AT,
      provenance: { ...provenance, evidence_references: ["controlled-purpose-supersession-review"] },
      artifact: { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: {
        ...version.artifact.payload, endpoint_purpose: admissionPurpose
      } } });
  });
  const versions = [...historical, ...superseded];
  for (const revision of superseded) {
    const context = resolveContinuousSourceContext(versions, revision.stream_id);
    assert.equal(context.target.endpoint_purpose, context.admission.endpoint_purpose);
    assert.equal(context.bindings.target.revision, 2);
  }
  assert.equal(admission.artifact.payload.automation_basis, "HUMAN_REVIEWED_CANARY");
  assert.equal(admission.artifact.payload.continuous_acquisition_scope, undefined);
});

test("both Zhenghan exact URLs execute only through separate controlled authorizations", async () => {
  const remote = await createOfflineZhenghanRemote();
  try {
    const sent: string[] = [];
    const options = controlledOptions(remote.remote, async request => {
      sent.push(request.locator);
      return successfulResponse(request.locator);
    });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    for (const target of ["controlled-zhenghan-announcement", "controlled-zhenghan-detail"]) {
      await root.issueContinuousAuthorization({ allowlist_entry_id: target,
        effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
    }
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: key => key === "p2-05-test-only"
        ? multiTargetAdapter([ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL]) : null });
    const result = await scheduler.runBatch({ batch_id: "zhenghan-exact-offline",
      actor: "controlled-scheduler", started_at: AT });
    assert.equal(result.manifest.source_executions.length, 1);
    assert.deepEqual(sent, [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL]);
    const fresh = await root.restore();
    assert.deepEqual(fresh.source_execution_outcomes[0]?.request_plan?.targets.map(target => target.exact_url), sent);
    assert.equal(fresh.source_execution_outcomes[0]?.continuous_authorization_ids.length, 2);
  } finally { remote.remove(); }
});

async function createOfflineZhenghanRemote() {
  const remote = await createRemote({ max_pages: 2, max_items: 2 });
  const checkout = remote.clone();
  const repository = new GitSourceRegistryPersistence({ repository_path: checkout });
  const base = remote.input;
  const sourceId = "controlled-zhenghan-source" as typeof base.endpoint.source_definition_id;
  const endpointId = "controlled-zhenghan-endpoint" as typeof base.endpoint.recruitment_endpoint_id;
  const admissionId = "controlled-zhenghan-admission" as typeof base.admitted.source_admission_id;
  const targetIds = ["controlled-zhenghan-announcement", "controlled-zhenghan-detail"];
  const urls = [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL];
  const source = { ...base.context.source, source_definition_id: sourceId };
  const endpoint = { ...base.endpoint, recruitment_endpoint_id: endpointId,
    source_definition_id: sourceId, locator: urls[0]! };
  const admission = { ...base.admitted, source_admission_id: admissionId,
    recruitment_endpoint_id: endpointId, endpoint: urls[0]!,
    evidence: base.admitted.evidence.map(item => ({ ...item,
      source_admission_id: admissionId, endpoint: urls[0]!, source_url: urls[0]! })),
    continuous_acquisition_scope: { ...base.admitted.continuous_acquisition_scope!,
      exact_targets: targetIds.map((allowlist_entry_id, index) => ({ allowlist_entry_id, exact_url: urls[index]! })) } };
  const append = async (streamId: string, artifact: SourcePersistenceVersion["artifact"]) => {
    const version = createSourcePersistenceVersion({ stream_id: streamId, revision: 1,
      supersedes_artifact_id: null, artifact, provenance, effective_at: AT, created_at: AT });
    await repository.appendVersion(version);
    return version;
  };
  await append(sourceId, { kind: "SOURCE_DEFINITION", payload: source });
  const endpointVersion = await append(endpointId, { kind: "RECRUITMENT_ENDPOINT", payload: endpoint });
  const admissionVersion = await append(admissionId, { kind: "SOURCE_ADMISSION", payload: admission });
  for (let index = 0; index < urls.length; index += 1) {
    const url = new URL(urls[index]!);
    await append(targetIds[index]!, { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: {
      allowlist_entry_id: targetIds[index]!, recruitment_endpoint_artifact_id: endpointVersion.artifact_id,
      source_admission_artifact_id: admissionVersion.artifact_id, active: true, scheme: "https",
      host: url.hostname, port: null, path_prefix: url.pathname, exact_path: true,
      allowed_method: "GET", query_policy: { mode: "DENY_ALL", allowed_parameters: [] },
      endpoint_purpose: admission.endpoint_purpose, authority_level: "OFFICIAL",
      approval_evidence_ids: admission.evidence.map(item => item.source_admission_evidence_id)
    } });
  }
  git(checkout, "add", "production-source-state");
  git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`,
    "commit", "-qm", "Controlled two-URL offline source");
  git(checkout, "push", "origin", "HEAD:main");
  return remote;
}

test("one endpoint with two exact grants creates one source execution and preserves target evidence", async () => {
  const remote = await createMultiTargetRemote();
  try {
    const sent: string[] = [];
    const options = { remote_url: remote.remote, branch: "main", stream_id: "multi-target-controlled",
      execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
      controlled_continuous_transport: { async execute(request: { locator: string }): Promise<TransportResponse> {
        sent.push(request.locator);
        const bytes = new TextEncoder().encode(`controlled:${request.locator}`);
        return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
          responded_at: AT as never, mime_type: "text/html", http_status: 200, headers: {} };
      } }, now: () => AT, commit_identity: identity };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    for (const target of [TARGET, DETAIL_TARGET]) await root.issueContinuousAuthorization({
      allowlist_entry_id: target, effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer"
    });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: key => key === "p2-05-test-only" ? multiTargetAdapter() : null });
    const result = await scheduler.runBatch({ batch_id: "multi-target-batch", actor: "controlled-scheduler", started_at: AT });
    assert.equal(result.manifest.batch_status, "SUCCESS");
    assert.equal(result.manifest.source_executions.length, 1);
    assert.deepEqual(sent, [SOURCE_URL, DETAIL_URL]);
    const restored = await root.restore();
    assert.equal(restored.source_execution_outcomes.length, 1);
    assert.equal(restored.source_execution_outcomes[0]!.continuous_authorization_ids.length, 2);
    assert.equal(restored.source_execution_outcomes[0]!.request_attempt_ids.length, 2);
    assert.equal(restored.source_execution_outcomes[0]!.acquisition_run_ids.length, 2);
    assert.equal(restored.source_execution_request_intents.length, 1);
    assert.deepEqual(restored.source_execution_request_intents[0]?.targets.map(target => target.exact_url),
      [SOURCE_URL, DETAIL_URL]);
    assert.deepEqual(restored.source_execution_outcomes[0]!.request_plan?.targets.map(target => target.exact_url),
      [SOURCE_URL, DETAIL_URL]);
    assert.ok(restored.source_execution_outcomes[0]!.request_plan?.targets.every(target =>
      target.authorization_id && target.observations.length === 1 && target.observations[0]?.request_attempt_id));
    const checkout = remote.clone();
    const repository = new GitSourceRegistryPersistence({ repository_path: checkout });
    const acquisitions = await new GitRawObjectPersistence({ repository_path: checkout }).listVerifiedAcquisitions();
    const versions = await repository.listVersions();
    const outcome = restored.source_execution_outcomes[0]!;
    const plan = outcome.request_plan!;
    assertSourceExecutionRequestPlanBindings(plan, outcome, versions,
      repository.listContinuousRecords(), acquisitions);
    const { schema_version: schemaVersion, integrity_hash: integrityHash, ...planContent } = plan;
    assert.ok(schemaVersion && integrityHash);
    const swapped = sealSourceExecutionRequestPlan({ ...planContent,
      targets: plan.targets.map((target, index) => ({ ...target,
        authorization_id: plan.targets[1 - index]!.authorization_id })) });
    assert.throws(() => assertSourceExecutionRequestPlanBindings(swapped, outcome,
      versions, repository.listContinuousRecords(), acquisitions), /SOURCE_REQUEST_PLAN_TARGET_BINDING_MISMATCH/u);
  } finally { remote.remove(); }
});

test("revoking the second target does not authorize it through the first target", async () => {
  const remote = await createMultiTargetRemote();
  try {
    const sent: string[] = [];
    const options = controlledOptions(remote.remote, async request => {
      sent.push(request.locator);
      return successfulResponse(request.locator);
    });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    const detail = await root.issueContinuousAuthorization({ allowlist_entry_id: DETAIL_TARGET,
      effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
    await root.revokeContinuousAuthorization({ authorization_id: detail.record.payload.grant!.authorization_id,
      actor: "controlled-reviewer", reference: "controlled-revocation" });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: key => key === "p2-05-test-only" ? multiTargetAdapter() : null });
    const result = await scheduler.runBatch({ batch_id: "revoked-detail", actor: "controlled-scheduler", started_at: AT });
    const outcome = (await root.restore()).source_execution_outcomes[0]!;
    assert.deepEqual(sent, [SOURCE_URL]);
    assert.ok(["PARTIAL", "FAILED"].includes(outcome.status));
    assert.equal(result.manifest.batch_status, "FAILED");
    assert.deepEqual(outcome.request_plan?.targets.map(target => target.authorization_id === null), [false, true]);
    assert.deepEqual(outcome.request_plan?.targets.map(target => target.observations.length), [1, 0]);
  } finally { remote.remove(); }
});

test("a missing second-target grant cannot borrow the first-target grant", async () => {
  const remote = await createMultiTargetRemote();
  try {
    const sent: string[] = [];
    const options = controlledOptions(remote.remote, async request => {
      sent.push(request.locator);
      return successfulResponse(request.locator);
    });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: key => key === "p2-05-test-only" ? multiTargetAdapter() : null });
    const result = await scheduler.runBatch({ batch_id: "missing-detail-grant", actor: "controlled-scheduler", started_at: AT });
    const outcome = (await root.restore()).source_execution_outcomes[0]!;
    assert.deepEqual(sent, [SOURCE_URL]);
    assert.ok(["PARTIAL", "FAILED"].includes(outcome.status));
    assert.equal(result.manifest.batch_status, "FAILED");
    assert.equal(outcome.request_plan?.targets[1]?.authorization_id, null);
    assert.deepEqual(outcome.request_plan?.targets[1]?.observations, []);
  } finally { remote.remove(); }
});

test("failed second target retains separate failure evidence and never claims complete success", async () => {
  const remote = await createMultiTargetRemote();
  try {
    const sent: string[] = [];
    const options = controlledOptions(remote.remote, async request => {
      sent.push(request.locator);
      return request.locator === SOURCE_URL ? successfulResponse(request.locator) : {
        status: "FAILED" as const, responded_at: AT as never, mime_type: null, http_status: 503, headers: {},
        error: { code: "CONTROLLED_FAILURE", message: "second target failed", retryable: false }
      };
    });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    for (const target of [TARGET, DETAIL_TARGET]) await root.issueContinuousAuthorization({
      allowlist_entry_id: target, effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer"
    });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: key => key === "p2-05-test-only" ? multiTargetAdapter() : null });
    const result = await scheduler.runBatch({ batch_id: "failed-detail", actor: "controlled-scheduler", started_at: AT });
    const outcome = (await root.restore()).source_execution_outcomes[0]!;
    assert.deepEqual(sent, [SOURCE_URL, DETAIL_URL]);
    assert.ok(["PARTIAL", "FAILED"].includes(outcome.status));
    assert.equal(result.manifest.batch_status, "FAILED");
    assert.deepEqual(outcome.request_plan?.targets.map(target => target.observations[0]?.transport_status),
      ["SUCCESS", "FAILED"]);
    assert.equal(outcome.request_plan?.targets[1]?.observations[0]?.raw_blob_id, null);
    assert.equal(outcome.request_plan?.targets[1]?.observations[0]?.raw_content_sha256, null);
  } finally { remote.remove(); }
});

test("endpoint purpose mismatch fails closed until an append-only reviewed target revision is current", async () => {
  const remote = await createRemote();
  try {
    await appendPurposeRevision(remote, "JOB_DETAIL", "controlled-purpose-mismatch");
    const root = bootstrapZeroCostProductionCompositionRoot(controlledOptions(remote.remote,
      async request => successfulResponse(request.locator)));
    await assert.rejects(root.issueContinuousAuthorization({ allowlist_entry_id: TARGET,
      effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" }), /APPROVAL_BINDING_INVALID/u);
    await appendPurposeRevision(remote, "JOB_LIST", "controlled-purpose-reviewed-supersession");
    const issued = await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET,
      effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
    const fresh = await bootstrapZeroCostProductionCompositionRoot(controlledOptions(remote.remote,
      async request => successfulResponse(request.locator))).restore();
    assert.equal(fresh.source_version_count, remote.input.versions.length + 2);
    assert.equal(fresh.continuous_authorizations[0]?.grant.authorization_id,
      issued.record.payload.grant?.authorization_id);
    const versions = await new GitSourceRegistryPersistence({ repository_path: remote.clone() }).listVersions();
    assert.deepEqual(versions.filter(version => version.stream_id === TARGET).map(version => version.revision), [1, 2, 3]);
  } finally { remote.remove(); }
});

test("an adapter cannot silently omit an approved exact target", async () => {
  const remote = await createMultiTargetRemote();
  try {
    const sent: string[] = [];
    const options = controlledOptions(remote.remote, async request => {
      sent.push(request.locator);
      return successfulResponse(request.locator);
    });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    for (const target of [TARGET, DETAIL_TARGET]) await root.issueContinuousAuthorization({
      allowlist_entry_id: target, effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer"
    });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: key => key === "p2-05-test-only" ? multiTargetAdapter([SOURCE_URL]) : null });
    await assert.rejects(scheduler.runBatch({ batch_id: "omitted-detail", actor: "controlled-scheduler",
      started_at: AT }), /SOURCE_REQUEST_PLAN_COVERAGE_MISMATCH/u);
    assert.deepEqual(sent, []);
    assert.equal((await root.restore()).source_execution_outcomes.length, 0);
  } finally { remote.remove(); }
});

test("each target retains independent cadence and incomplete coverage cannot become NOT_MODIFIED", async () => {
  const remote = await createMultiTargetRemote();
  try {
    let clock = AT;
    const sent: string[] = [];
    const options = { ...controlledOptions(remote.remote, async request => {
      sent.push(request.locator);
      return successfulResponse(request.locator, clock);
    }), now: () => clock };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    await root.issueContinuousAuthorization({ allowlist_entry_id: DETAIL_TARGET, effective_from: AT,
      min_interval_seconds: 300, actor: "controlled-reviewer" });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: key => key === "p2-05-test-only" ? multiTargetAdapter() : null });
    const first = await scheduler.runBatch({ batch_id: "cadence-first", actor: "controlled-scheduler", started_at: AT });
    assert.equal(first.manifest.batch_status, "SUCCESS");
    clock = LATER;
    const second = await scheduler.runBatch({ batch_id: "cadence-second", actor: "controlled-scheduler", started_at: LATER });
    const outcomes = (await root.restore()).source_execution_outcomes;
    assert.deepEqual(sent, [SOURCE_URL, DETAIL_URL, SOURCE_URL]);
    assert.equal(second.manifest.deferred_sources[0]?.reason, "CADENCE_DENIED");
    assert.equal(outcomes.at(-1)?.request_plan?.targets[1]?.observations.length, 0);
    assert.notEqual(outcomes.at(-1)?.status, "SUCCESS");
    assert.notEqual(outcomes.at(-1)?.status, "NOT_MODIFIED");
    assert.notEqual(outcomes.at(-1)?.status, "CONFIRMED_EMPTY");
  } finally { remote.remove(); }
});

test("crash after the first target leaves the second reservation pending and blocks duplicate dispatch", async () => {
  const remote = await createMultiTargetRemote();
  try {
    const sent: string[] = [];
    let reservations = 0;
    const options = { ...controlledOptions(remote.remote, async request => {
      sent.push(request.locator);
      return successfulResponse(request.locator);
    }), fault_injector: (point: string) => {
      if (point === "AFTER_CONTINUOUS_RESERVATION" && ++reservations === 2) {
        throw new Error("CONTROLLED_SECOND_TARGET_CRASH");
      }
    } };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    for (const target of [TARGET, DETAIL_TARGET]) await root.issueContinuousAuthorization({
      allowlist_entry_id: target, effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer"
    });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: key => key === "p2-05-test-only" ? multiTargetAdapter() : null });
    await assert.rejects(scheduler.runBatch({ batch_id: "second-target-crash", actor: "controlled-scheduler",
      started_at: AT }), /PENDING_GATE_DENIED/u);
    const fresh = await bootstrapZeroCostProductionCompositionRoot(controlledOptions(remote.remote,
      async request => {
        sent.push(request.locator);
        return successfulResponse(request.locator);
      })).restore();
    assert.deepEqual(sent, [SOURCE_URL]);
    assert.equal(fresh.source_execution_outcomes.length, 0);
    assert.deepEqual(fresh.source_execution_request_intents[0]?.targets.map(target => target.exact_url),
      [SOURCE_URL, DETAIL_URL]);
    assert.deepEqual(fresh.continuous_records.slice(-3).map(record => record.kind),
      ["RESERVE", "COMPLETE", "RESERVE"]);
    const retry = bootstrapProductionSchedulerBatch({ ...controlledOptions(remote.remote, async request => {
      sent.push(request.locator);
      return successfulResponse(request.locator);
    }), resolve_adapter: key => key === "p2-05-test-only" ? multiTargetAdapter() : null });
    await assert.rejects(retry.runBatch({ batch_id: "second-target-crash", actor: "controlled-scheduler",
      started_at: AT }), /PENDING_GATE_DENIED/u);
    assert.deepEqual(sent, [SOURCE_URL]);
  } finally { remote.remove(); }
});

async function appendPurposeRevision(remote: Awaited<ReturnType<typeof createRemote>>,
  purpose: string, evidenceReference: string) {
  const checkout = remote.clone();
  const repository = new GitSourceRegistryPersistence({ repository_path: checkout });
  const versions = await repository.listVersions();
  const previous = versions.filter(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST"
    && version.stream_id === TARGET).at(-1)!;
  assert.equal(previous.artifact.kind, "OFFICIAL_ENDPOINT_ALLOWLIST");
  await repository.appendVersion(createSourcePersistenceVersion({ stream_id: previous.stream_id,
    revision: previous.revision + 1, supersedes_artifact_id: previous.artifact_id,
    provenance: { ...provenance, evidence_references: [evidenceReference] }, effective_at: AT, created_at: AT,
    artifact: { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: {
      ...previous.artifact.payload, endpoint_purpose: purpose
    } } }));
  git(checkout, "add", "production-source-state");
  git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`,
    "commit", "-qm", `Controlled purpose revision ${previous.revision + 1}`);
  git(checkout, "push", "origin", "HEAD:main");
}

function controlledOptions(remoteUrl: string, execute: (request: { locator: string }) => Promise<TransportResponse>) {
  return { remote_url: remoteUrl, branch: "main", stream_id: "multi-target-controlled",
    execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
    controlled_continuous_transport: { execute }, now: () => AT, commit_identity: identity };
}

function successfulResponse(locator: string, respondedAt = AT): TransportResponse {
  const bytes = new TextEncoder().encode(`controlled:${locator}`);
  return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
    responded_at: respondedAt as never, mime_type: "text/html", http_status: 200, headers: {} };
}

async function createMultiTargetRemote() {
  const remote = await createRemote({ max_pages: 2, max_items: 2 });
  const checkout = remote.clone();
  const repository = new GitSourceRegistryPersistence({ repository_path: checkout });
  const versions = await repository.listVersions();
  const admission = versions.find(version => version.artifact.kind === "SOURCE_ADMISSION")!;
  const endpoint = versions.find(version => version.artifact.kind === "RECRUITMENT_ENDPOINT")!;
  const allowlist = versions.find(version => version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST")!;
  assert.equal(admission.artifact.kind, "SOURCE_ADMISSION");
  assert.equal(endpoint.artifact.kind, "RECRUITMENT_ENDPOINT");
  assert.equal(allowlist.artifact.kind, "OFFICIAL_ENDPOINT_ALLOWLIST");
  const scope = admission.artifact.payload.continuous_acquisition_scope!;
  const revisedAdmission = createSourcePersistenceVersion({ stream_id: admission.stream_id,
    revision: 2, supersedes_artifact_id: admission.artifact_id, provenance,
    effective_at: AT, created_at: AT, artifact: { kind: "SOURCE_ADMISSION", payload: {
      ...admission.artifact.payload, continuous_acquisition_scope: { ...scope,
        exact_targets: [...scope.exact_targets, { allowlist_entry_id: DETAIL_TARGET, exact_url: DETAIL_URL }] },
      evidence: [...admission.artifact.payload.evidence, { ...admission.artifact.payload.evidence[0]!,
        source_admission_evidence_id: "multi-target-approval-evidence" as never,
        kind: "MANUAL_REVIEW", decision: "ALLOWED", locator: "controlled:multi-target" }],
      review_records: [...admission.artifact.payload.review_records, {
        ...admission.artifact.payload.review_records[0]!,
        source_admission_review_id: "multi-target-approval-review" as never,
        evidence_ids: ["multi-target-approval-evidence" as never] }]
    } } });
  await repository.appendVersion(revisedAdmission);
  const reviseTarget = (prior: SourcePersistenceVersion, id: string, url: string, revision: number) => {
    assert.equal(prior.artifact.kind, "OFFICIAL_ENDPOINT_ALLOWLIST");
    return createSourcePersistenceVersion({ stream_id: id, revision,
      supersedes_artifact_id: revision === 1 ? null : prior.artifact_id,
      provenance, effective_at: AT, created_at: AT,
      artifact: { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: {
        ...prior.artifact.payload, allowlist_entry_id: id,
        source_admission_artifact_id: revisedAdmission.artifact_id,
        path_prefix: new URL(url).pathname
      } } });
  };
  await repository.appendVersion(reviseTarget(allowlist, TARGET, SOURCE_URL, 2));
  await repository.appendVersion(reviseTarget(allowlist, DETAIL_TARGET, DETAIL_URL, 1));
  git(checkout, "add", "production-source-state");
  git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`,
    "commit", "-qm", "Multi-target controlled source");
  git(checkout, "push", "origin", "HEAD:main");
  return remote;
}

function multiTargetAdapter(locators: readonly string[] = [SOURCE_URL, DETAIL_URL]): RecruitmentAdapter {
  const fixture = trustedFixture("multi-target-controlled", "学历要求：本科及以上", { raw_title: "法务岗" });
  return {
    descriptor: { adapter_key: "p2-05-test-only", name: "Controlled multi-target", version: "1.0.0",
      supported_content_kinds: ["HTML"], capabilities: ["HTML_EXTRACTION"] },
    validateEndpoint: () => ({ valid: true, issues: [] }),
    plan: endpoint => locators.map((locator, index) => ({
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator,
      method: "GET" as const, parameters: {}, pagination_state: {
        page_index: index + 1, cursor: null, visited_locators: [locator]
      }
    })),
    extract: ({ snapshot, endpoint }) => [{ ...fixture.source.extracted_record,
      extracted_record_id: `multi-target:${snapshot.snapshot_id}` as never,
      snapshot_id: snapshot.snapshot_id, source_definition_id: endpoint.source_definition_id,
      raw_source_record_id: snapshot.request_metadata.locator === SOURCE_URL ? "multi-target-package" : "multi-target-position",
      ...(snapshot.request_metadata.locator === SOURCE_URL ? { recruitment_context: undefined } : {}),
      announcement_url: SOURCE_URL,
      extraction: { extractor_name: "ControlledMultiTarget", extractor_version: "1.0.0",
        extracted_at: snapshot.observed_at }
    }],
    nextPage: () => null,
    assessCompleteness: input => ({ status: input.snapshots.length === 2 ? "COMPLETE" : "PARTIAL", reason_codes: [] })
  };
}
