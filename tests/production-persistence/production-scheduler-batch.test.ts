import "../helpers/network-guard";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { RecruitmentAdapter, TransportResponse } from "../../lib/ingestion";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { bootstrapProductionSchedulerBatch } from "../../lib/production-persistence/production-scheduler-batch";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { createSourcePersistenceVersion, type SourcePersistenceVersion } from "../../lib/production-persistence/contracts";
import { GitSourceRegistryPersistence } from "../../lib/production-persistence/git-source-registry-persistence";
import { trustedFixture } from "../pipeline/position-bound-phase-fixture";
import { admission } from "../p2-05/test-support";
import { AT, LATER, TARGET, createRemote, git, identity, provenance } from "./continuous-acquisition-fixture";

const SECOND_URL = "https://secondary.example.invalid/recruitment";
const SECOND_TARGET = "controlled-continuous-target-secondary";

test("two committed controlled sources run independently; unchanged Run B reuses business identities", async () => {
  const repository = await twoSourceRemote();
  try {
    const bodies = new Map<string, Uint8Array>([
      [repository.input.endpoint.locator, new TextEncoder().encode("Controlled official source A")],
      [SECOND_URL, new TextEncoder().encode("Controlled official source B")]
    ]);
    let sent = 0;
    const transport = { async execute(request: { locator: string }): Promise<TransportResponse> {
      sent += 1;
      const bytes = bodies.get(request.locator);
      assert.ok(bytes);
      return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
        responded_at: AT as never, mime_type: "text/html", http_status: 200, headers: {} };
    } };
    let clock = AT;
    const options = { remote_url: repository.remote, branch: "main", stream_id: "scheduler-controlled",
      execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
      controlled_continuous_transport: transport, now: () => clock,
      commit_identity: identity };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    await root.issueContinuousAuthorization({ allowlist_entry_id: SECOND_TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: adapterKey => controlledAdapter(adapterKey) });
    const runA = await scheduler.runBatch({ batch_id: "controlled-run-a", actor: "controlled-scheduler", started_at: AT });
    assert.equal(runA.manifest.batch_status, "SUCCESS", JSON.stringify(runA));
    assert.equal(runA.manifest.source_executions.length, 2);
    assert.equal(sent, 2);
    const afterA = await root.restore();
    assert.deepEqual(afterA.scheduler_batches.map(batch => batch.batch_id), ["controlled-run-a"]);
    assert.equal(afterA.source_execution_outcomes.length, 2);
    assert.equal(afterA.source_execution_request_intents.length, 2);
    assert.ok(afterA.source_execution_request_intents.every(intent => intent.targets.length === 1));
    assert.equal(afterA.presentation_decisions.length, 2);
    assert.equal(afterA.read_models.length, 2);
    const originalSeals = afterA.artifact_seals;
    const originalReadModels = afterA.read_models;
    const originalGrants = afterA.continuous_authorizations.map(item => item.grant?.authorization_version);
    clock = LATER;
    const runB = await scheduler.runBatch({ batch_id: "controlled-run-b", actor: "controlled-scheduler", started_at: LATER });
    assert.equal(runB.manifest.batch_status, "SUCCESS", JSON.stringify(runB));
    assert.deepEqual(runB.manifest.source_executions.map(item => item.outcome_status), ["NOT_MODIFIED", "NOT_MODIFIED"]);
    assert.equal(sent, 4);
    const afterB = await root.restore();
    assert.equal(afterB.scheduler_batches.length, 2);
    assert.equal(afterB.source_execution_outcomes.length, 4);
    assert.equal(afterB.source_execution_request_intents.length, 4);
    assert.deepEqual(afterB.artifact_seals, originalSeals);
    assert.deepEqual(afterB.read_models, originalReadModels);
    assert.deepEqual(afterB.continuous_authorizations.map(item => item.grant?.authorization_version), originalGrants);
    assert.equal(await scheduler.runBatch({ batch_id: "controlled-run-b", actor: "controlled-scheduler", started_at: LATER })
      .then(result => result.manifest_commit), runB.manifest_commit);
    assert.equal(sent, 4);
  } finally { repository.remove(); }
});

test("failure, partial and suspicious-empty source outcomes remain isolated and preserve prior Presentation", async () => {
  const repository = await twoSourceRemote();
  try {
    let clock = AT;
    let round = 0;
    const modes = new Map<string, "SUCCESS" | "FAILED" | "PARTIAL" | "SUSPICIOUS_EMPTY">();
    const transport = { async execute(request: { locator: string }): Promise<TransportResponse> {
      if (modes.get(request.locator) === "FAILED") return { status: "FAILED", responded_at: clock as never,
        http_status: 503, headers: {}, mime_type: null,
        error: { code: "CONTROLLED_FAILURE", message: "controlled scheduler failure", retryable: false } };
      const bytes = new TextEncoder().encode(`Controlled source ${request.locator} round ${round}`);
      return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
        responded_at: clock as never, mime_type: "text/html", http_status: 200, headers: {} };
    } };
    const options = { remote_url: repository.remote, branch: "main", stream_id: "scheduler-isolation",
      execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
      controlled_continuous_transport: transport, now: () => clock, commit_identity: identity };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    await root.issueContinuousAuthorization({ allowlist_entry_id: SECOND_TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: adapterKey => controlledAdapter(adapterKey,
        modes.get(adapterKey === "p2-05-test-only" ? repository.input.endpoint.locator : SECOND_URL) ?? "SUCCESS") });
    modes.set(repository.input.endpoint.locator, "SUCCESS"); modes.set(SECOND_URL, "FAILED"); round = 1;
    const first = await scheduler.runBatch({ batch_id: "isolation-success-failed", actor: "scheduler", started_at: clock });
    assert.equal(first.manifest.batch_status, "PARTIAL");
    assert.deepEqual(first.manifest.source_executions.map(item => item.outcome_status), ["SUCCESS", "FAILED"]);
    const retainedAfterFirst = await root.restore();
    assert.equal(retainedAfterFirst.read_models.length, 1);
    clock = "2026-09-18T00:02:00.000Z"; round = 2;
    modes.set(repository.input.endpoint.locator, "FAILED"); modes.set(SECOND_URL, "SUCCESS");
    const second = await scheduler.runBatch({ batch_id: "isolation-failed-success", actor: "scheduler", started_at: clock });
    assert.equal(second.manifest.batch_status, "PARTIAL");
    assert.deepEqual(second.manifest.source_executions.map(item => item.outcome_status), ["FAILED", "SUCCESS"]);
    const retainedAfterSecond = await root.restore();
    assert.equal(retainedAfterSecond.read_models.length, 2);
    clock = "2026-09-18T00:04:00.000Z"; round = 3;
    modes.set(repository.input.endpoint.locator, "PARTIAL"); modes.set(SECOND_URL, "SUCCESS");
    const third = await scheduler.runBatch({ batch_id: "isolation-partial-success", actor: "scheduler", started_at: clock });
    assert.equal(third.manifest.batch_status, "PARTIAL");
    assert.deepEqual(third.manifest.source_executions.map(item => item.outcome_status), ["PARTIAL", "SUCCESS"]);
    clock = "2026-09-18T00:06:00.000Z"; round = 4;
    modes.set(repository.input.endpoint.locator, "SUSPICIOUS_EMPTY"); modes.set(SECOND_URL, "SUCCESS");
    const fourth = await scheduler.runBatch({ batch_id: "isolation-suspicious-success", actor: "scheduler", started_at: clock });
    assert.equal(fourth.manifest.batch_status, "PARTIAL");
    assert.deepEqual(fourth.manifest.source_executions.map(item => item.outcome_status), ["SUSPICIOUS_EMPTY", "SUCCESS"]);
    clock = "2026-09-18T00:08:00.000Z"; round = 5;
    modes.set(repository.input.endpoint.locator, "SUCCESS"); modes.set(SECOND_URL, "PARTIAL");
    const fifth = await scheduler.runBatch({ batch_id: "isolation-success-partial", actor: "scheduler", started_at: clock });
    assert.equal(fifth.manifest.batch_status, "PARTIAL");
    assert.deepEqual(fifth.manifest.source_executions.map(item => item.outcome_status), ["SUCCESS", "PARTIAL"]);
    clock = "2026-09-18T00:10:00.000Z"; round = 6;
    modes.set(repository.input.endpoint.locator, "FAILED"); modes.set(SECOND_URL, "FAILED");
    const sixth = await scheduler.runBatch({ batch_id: "isolation-failed-failed", actor: "scheduler", started_at: clock });
    assert.equal(sixth.manifest.batch_status, "FAILED");
    assert.deepEqual(sixth.manifest.source_executions.map(item => item.outcome_status), ["FAILED", "FAILED"]);
    const restored = await root.restore();
    assert.equal(restored.scheduler_batches.length, 6);
    assert.equal(restored.source_execution_outcomes.length, 12);
    assert.equal(restored.read_models.length, 2);
    assert.equal(restored.presentation_decisions.length, 2);
  } finally { repository.remove(); }
});

test("official closed JSON empty reaches CONFIRMED_EMPTY only through Production Root and P1 guard", async () => {
  const repository = await jsonSourceRemote();
  try {
    let clock = AT;
    let empty = false;
    const transport = { async execute(): Promise<TransportResponse> {
      const bytes = new TextEncoder().encode(empty
        ? '{"jobs":[],"total":0,"next":null}'
        : '{"jobs":[{"title":"法务岗"}],"total":1,"next":null}');
      return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
        responded_at: clock as never, mime_type: "application/json", http_status: 200, headers: {} };
    } };
    const options = { remote_url: repository.remote, branch: "main", stream_id: "scheduler-json",
      execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
      controlled_continuous_transport: transport, now: () => clock, commit_identity: identity };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: adapterKey => controlledAdapter(adapterKey, empty ? "SUSPICIOUS_EMPTY" : "SUCCESS") });
    const nonEmpty = await scheduler.runBatch({ batch_id: "json-non-empty", actor: "scheduler", started_at: AT });
    assert.deepEqual(nonEmpty.manifest.source_executions.map(item => item.outcome_status), ["SUCCESS"]);
    const before = await root.restore();
    empty = true; clock = LATER;
    const closedEmpty = await scheduler.runBatch({ batch_id: "json-confirmed-empty", actor: "scheduler", started_at: LATER });
    assert.equal(closedEmpty.manifest.batch_status, "SUCCESS");
    assert.deepEqual(closedEmpty.manifest.source_executions.map(item => item.outcome_status), ["CONFIRMED_EMPTY"]);
    const after = await root.restore();
    assert.equal(after.source_execution_outcomes.at(-1)?.acquisition_evidence.assessment?.status, "CONFIRMED_EMPTY");
    assert.deepEqual(after.read_models, before.read_models);
    assert.equal(after.presentation_decisions.length, before.presentation_decisions.length);
  } finally { repository.remove(); }
});

test("a committed source execution is recovered after a pre-manifest scheduler crash without a second request", async () => {
  const repository = await createRemote();
  try {
    let sent = 0;
    const bytes = new TextEncoder().encode("Controlled scheduler crash recovery");
    const transport = { async execute(): Promise<TransportResponse> {
      sent += 1;
      return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
        responded_at: AT as never, mime_type: "text/html", http_status: 200, headers: {} };
    } };
    const options = { remote_url: repository.remote, branch: "main", stream_id: "scheduler-crash-recovery",
      execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
      controlled_continuous_transport: transport, now: () => AT, commit_identity: identity };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    const grant = await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    const authorizationId = grant.record.payload.grant!.authorization_id;
    const batchId = "controlled-crash-before-manifest";
    const sourceExecutionId = `scheduler-source:${canonicalHash({ batch_id: batchId,
      authorization_id: authorizationId })}`;
    const committed = await root.runProduction({
      run_id: sourceExecutionId,
      continuous_authorization_ids: [authorizationId],
      source_versions: [],
      source_admission_id: repository.input.admitted.source_admission_id,
      recruitment_endpoint_id: repository.input.endpoint.recruitment_endpoint_id,
      adapter: controlledAdapter(repository.input.endpoint.adapter_key)!,
      transport: { async execute() { throw new Error("SCHEDULER_CALLER_TRANSPORT_DENIED"); } },
      provenance: { scope: "PRODUCTION", actor_id: "controlled-scheduler",
        actor_role: "PRODUCTION_SCHEDULER", evidence_references: [authorizationId] },
      actor: "controlled-scheduler",
      started_at: AT
    });
    assert.ok(committed.committed_head);
    assert.equal(sent, 1);

    const scheduler = bootstrapProductionSchedulerBatch({ ...options,
      resolve_adapter: adapterKey => controlledAdapter(adapterKey) });
    const recovered = await scheduler.runBatch({ batch_id: batchId, actor: "controlled-scheduler", started_at: AT });
    assert.equal(recovered.manifest.batch_status, "SUCCESS");
    assert.deepEqual(recovered.manifest.source_executions.map(item => item.source_execution_id), [sourceExecutionId]);
    assert.deepEqual(recovered.manifest.deferred_sources, []);
    assert.equal(sent, 1);
  } finally { repository.remove(); }
});

test("independent scheduler runners resolve a source CAS conflict without duplicate acquisition or business state", async () => {
  const repository = await createRemote();
  try {
    const root = bootstrapZeroCostProductionCompositionRoot({ remote_url: repository.remote, branch: "main",
      stream_id: "scheduler-cas-controlled", execution_mode: "TEST_ONLY",
      continuous_scope: "CONTROLLED_TEST", now: () => AT, commit_identity: identity });
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    const markerPath = path.join(repository.directory, "dispatches.txt");
    const firstResultPath = path.join(repository.directory, "runner-a.json");
    const secondResultPath = path.join(repository.directory, "runner-b.json");
    const [first, second] = await Promise.all([
      runCasWorker(repository.remote, "cas-runner-a", markerPath, firstResultPath),
      runCasWorker(repository.remote, "cas-runner-b", markerPath, secondResultPath)
    ]);
    assert.deepEqual([first.code, second.code].sort(), [0, 1], `${first.stderr}\n${second.stderr}`);
    const dispatches = existsSync(markerPath)
      ? readFileSync(markerPath, "utf8").trim().split(/\r?\n/u).filter(Boolean) : [];
    assert.equal(dispatches.length, 1);
    const results = [firstResultPath, secondResultPath].map(file => JSON.parse(readFileSync(file, "utf8")) as {
      readonly ok: boolean;
      readonly error?: string;
      readonly result?: { readonly manifest: { readonly batch_status: string;
        readonly source_executions: readonly unknown[]; readonly deferred_sources: readonly unknown[] } };
    });
    assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
    assert.equal(results.find(result => result.ok)?.result?.manifest.batch_status, "SUCCESS", JSON.stringify(results));
    assert.match(results.find(result => !result.ok)?.error ?? "", /SCHEDULER_CONCURRENT_SOURCE_DEFERRED/u);
    assert.equal(results.find(result => result.ok)?.result?.manifest.source_executions.length, 1);
    assert.equal(results.find(result => result.ok)?.result?.manifest.deferred_sources.length, 0);
    const restored = await root.restore();
    assert.equal(restored.scheduler_batches.length, 1);
    assert.equal(restored.source_execution_outcomes.length, 1);
    assert.equal(restored.presentation_decisions.length, 1);
    assert.equal(restored.read_models.length, 1);
    assert.equal(restored.continuous_authorizations.length, 1);
  } finally { repository.remove(); }
});

async function runCasWorker(remote: string, batchId: string, markerPath: string, resultPath: string) {
  const child = spawn(process.execPath, ["--import", "./node_modules/tsx/dist/loader.mjs",
    "tests/production-persistence/scheduler-cas-worker.ts", remote, batchId, markerPath, resultPath], {
    cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { code, stderr };
}

async function twoSourceRemote() {
  const repository = await createRemote();
  const checkout = repository.clone();
  const first = repository.input;
  const secondAdmissionBase = admission({ source_admission_id: "controlled-secondary-admission",
    endpoint: SECOND_URL, level: "B", automation_basis: "HUMAN_APPROVED_CONTINUOUS_SCOPE",
    robots: "UNKNOWN", terms: "UNKNOWN" });
  const secondAdmission = { ...secondAdmissionBase,
    recruitment_endpoint_id: "controlled-secondary-endpoint" as typeof secondAdmissionBase.recruitment_endpoint_id,
    continuous_acquisition_scope: { scope: "CONTROLLED_TEST" as const,
      exact_targets: [{ allowlist_entry_id: SECOND_TARGET, exact_url: SECOND_URL }],
      min_interval_seconds: 60, effective_from: AT,
      approval_review_id: secondAdmissionBase.review_records[0]!.source_admission_review_id } };
  const secondEndpoint = { ...first.endpoint,
    recruitment_endpoint_id: secondAdmission.recruitment_endpoint_id,
    source_definition_id: "controlled-secondary-source" as typeof first.endpoint.source_definition_id,
    locator: SECOND_URL, adapter_key: "controlled-secondary-adapter" };
  const secondOrganization = { ...first.context.source,
    organization_id: "controlled-secondary-organization" as typeof first.context.source.publisher_organization_id };
  const secondSource = { ...first.context.source,
    source_definition_id: secondEndpoint.source_definition_id,
    publisher_organization_id: secondOrganization.organization_id };
  const versions: SourcePersistenceVersion[] = [];
  const append = (streamId: string, artifact: SourcePersistenceVersion["artifact"]) => {
    versions.push(createSourcePersistenceVersion({ stream_id: streamId, revision: 1,
      supersedes_artifact_id: null, artifact, provenance, effective_at: AT, created_at: AT }));
  };
  append(secondOrganization.organization_id, { kind: "ORGANIZATION", payload: {
    organization_id: secondOrganization.organization_id, name: secondOrganization.name, aliases: [] } });
  append(secondEndpoint.adapter_key, { kind: "ADAPTER_REGISTRATION", payload: {
    adapter_key: secondEndpoint.adapter_key, name: secondOrganization.name, supported_content_kinds: ["HTML"] } });
  append(secondSource.source_definition_id, { kind: "SOURCE_DEFINITION", payload: secondSource });
  const endpointVersion = createSourcePersistenceVersion({ stream_id: secondEndpoint.recruitment_endpoint_id,
    revision: 1, supersedes_artifact_id: null, artifact: { kind: "RECRUITMENT_ENDPOINT", payload: secondEndpoint },
    provenance, effective_at: AT, created_at: AT });
  versions.push(endpointVersion);
  const admissionVersion = createSourcePersistenceVersion({ stream_id: secondAdmission.source_admission_id,
    revision: 1, supersedes_artifact_id: null, artifact: { kind: "SOURCE_ADMISSION", payload: secondAdmission },
    provenance, effective_at: AT, created_at: AT });
  versions.push(admissionVersion);
  append(SECOND_TARGET, { kind: "OFFICIAL_ENDPOINT_ALLOWLIST", payload: {
    allowlist_entry_id: SECOND_TARGET, recruitment_endpoint_artifact_id: endpointVersion.artifact_id,
    source_admission_artifact_id: admissionVersion.artifact_id, active: true,
    scheme: "https", host: "secondary.example.invalid", port: null, path_prefix: "/recruitment",
    exact_path: true, allowed_method: "GET", query_policy: { mode: "DENY_ALL", allowed_parameters: [] },
    endpoint_purpose: "JOB_LIST", authority_level: "OFFICIAL",
    approval_evidence_ids: secondAdmission.evidence.map(item => item.source_admission_evidence_id)
  } });
  const store = new GitSourceRegistryPersistence({ repository_path: checkout });
  for (const version of versions) await store.appendVersion(version);
  git(checkout, "add", "production-source-state");
  git(checkout, "-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`,
    "commit", "-qm", "Controlled second source");
  git(checkout, "push", "origin", "HEAD:main");
  return repository;
}

async function jsonSourceRemote() {
  return createRemote({}, "JSON");
}

function controlledAdapter(adapterKey: string,
  mode: "SUCCESS" | "FAILED" | "PARTIAL" | "SUSPICIOUS_EMPTY" = "SUCCESS"): RecruitmentAdapter | null {
  if (!["p2-05-test-only", "p2-05-test-json", "controlled-secondary-adapter"].includes(adapterKey)) return null;
  const template = trustedFixture(`scheduler-${adapterKey}`, "学历要求：本科及以上", { raw_title: "法务岗" });
  return { descriptor: { adapter_key: adapterKey, name: "Controlled scheduler adapter", version: "1.0.0",
    supported_content_kinds: [adapterKey === "p2-05-test-json" ? "JSON" : "HTML"],
    capabilities: ["SINGLE_PAGE", adapterKey === "p2-05-test-json" ? "JSON_EXTRACTION" : "HTML_EXTRACTION"] },
    validateEndpoint: () => ({ valid: true, issues: [] }),
    plan: endpoint => [{ recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: endpoint.locator, method: "GET", parameters: {}, pagination_state: {
        page_index: 1, cursor: null, visited_locators: [endpoint.locator] } }],
    extract: ({ snapshot, endpoint }) => mode === "SUSPICIOUS_EMPTY" ? [] : [{ ...template.source.extracted_record,
      extracted_record_id: `controlled:${adapterKey}:${snapshot.snapshot_id}` as never,
      snapshot_id: snapshot.snapshot_id, source_definition_id: endpoint.source_definition_id,
      announcement_url: endpoint.locator,
      extraction: { extractor_name: "ControlledSchedulerAdapter", extractor_version: "1.0.0",
        extracted_at: snapshot.observed_at } }],
    nextPage: () => {
      if (mode === "PARTIAL") throw new Error("controlled scheduler pagination failure");
      return null;
    },
    assessCompleteness: input => input.records.length
      ? { status: "COMPLETE", reason_codes: [] }
      : { status: "COMPLETE", reason_codes: ["ZERO_EXTRACTED_RECORDS"] } };
}
