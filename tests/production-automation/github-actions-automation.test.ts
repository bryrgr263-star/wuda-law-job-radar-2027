import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { RecruitmentAdapter, TransportResponse } from "../../lib/ingestion";
import {
  executeProductionSchedulerAutomation,
  retryCommittedPresentationPublication
} from "../../lib/production-automation/github-actions-automation";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence";
import { trustedFixture } from "../pipeline/position-bound-phase-fixture";
import {
  AT,
  LATER,
  TARGET,
  createRemote,
  identity
} from "../production-persistence/continuous-acquisition-fixture";

test("Actions-equivalent Run 1 and Run 2 restore Process B and reuse business identities", async () => {
  const repository = await createRemote();
  try {
    let sent = 0;
    let clock = AT;
    const options = controlledOptions(repository.remote, () => clock, () => { sent += 1; });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });

    const first = await executeProductionSchedulerAutomation(options, {
      batch_id: "actions-controlled-run-1", actor: "github-actions:test", started_at: AT
    });
    assert.equal(first.pre_run_process_b, "PASS");
    assert.equal(first.post_push_process_b, "PASS");
    assert.equal(first.batch_status, "SUCCESS");
    assert.equal(first.starting_sha, first.manifest.initial_head);
    assert.equal(first.ending_sha, first.manifest_commit);
    assert.equal(first.position_ids.length, 1);
    assert.equal(first.presentation_decision_ids.length, 1);
    assert.equal(first.presentation_read_model_ids.length, 1);
    assert.equal(sent, 1);

    const afterFirst = await root.restore();
    const firstDecisionIds = afterFirst.presentation_decisions.map(item => item.presentation_decision_id);
    const firstReadModelIds = afterFirst.read_models.map(item => item.presentation_read_model_id);
    const firstPositionIds = afterFirst.read_models.map(item => item.position_id);
    clock = LATER;

    const second = await executeProductionSchedulerAutomation(options, {
      batch_id: "actions-controlled-run-2", actor: "github-actions:test", started_at: LATER
    });
    assert.equal(second.batch_status, "SUCCESS");
    assert.deepEqual(second.manifest.source_executions.map(item => item.outcome_status), ["NOT_MODIFIED"]);
    assert.equal(second.starting_sha, first.ending_sha);
    assert.deepEqual(second.position_ids, []);
    assert.deepEqual(second.presentation_decision_ids, []);
    assert.deepEqual(second.presentation_read_model_ids, []);
    assert.equal(sent, 2);

    const afterSecond = await root.restore();
    assert.deepEqual(afterSecond.presentation_decisions.map(item => item.presentation_decision_id), firstDecisionIds);
    assert.deepEqual(afterSecond.read_models.map(item => item.presentation_read_model_id), firstReadModelIds);
    assert.deepEqual(afterSecond.read_models.map(item => item.position_id), firstPositionIds);
    assert.equal(afterSecond.continuous_authorizations[0]?.grant?.authorization_version,
      afterFirst.continuous_authorizations[0]?.grant?.authorization_version);
    console.log(`CONTROLLED_ACTIONS_RUN_1 ${JSON.stringify({ starting_sha: first.starting_sha,
      ending_sha: first.ending_sha, batch_id: first.batch_id,
      source_execution_ids: first.source_execution_ids, position_ids: first.position_ids,
      presentation_decision_ids: first.presentation_decision_ids,
      presentation_read_model_ids: first.presentation_read_model_ids })}`);
    console.log(`CONTROLLED_ACTIONS_RUN_2 ${JSON.stringify({ starting_sha: second.starting_sha,
      ending_sha: second.ending_sha, batch_id: second.batch_id,
      source_execution_ids: second.source_execution_ids, position_ids: second.position_ids,
      presentation_decision_ids: second.presentation_decision_ids,
      presentation_read_model_ids: second.presentation_read_model_ids })}`);
  } finally {
    repository.remove();
  }
});

test("publication failure is retryable from committed ReadModel without a second acquisition", async () => {
  const repository = await createRemote();
  try {
    let sent = 0;
    const options = controlledOptions(repository.remote, () => AT, () => { sent += 1; });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    const result = await executeProductionSchedulerAutomation(options, {
      batch_id: "actions-publication-retry", actor: "github-actions:test", started_at: AT
    }, async () => { throw new Error("controlled publication failure"); });
    assert.equal(result.publication_handoff, "RETRY_REQUIRED");
    assert.equal(sent, 1);

    let published = 0;
    const retry = await retryCommittedPresentationPublication(options,
      "actions-publication-retry", async models => { published = models.length; });
    assert.equal(retry.status, "PUBLISHED");
    assert.ok(published > 0);
    assert.equal(sent, 1);
  } finally {
    repository.remove();
  }
});

test("cadence denial remains authoritative and the Actions boundary sends no unauthorized request", async () => {
  const repository = await createRemote();
  try {
    let sent = 0;
    const options = controlledOptions(repository.remote, () => AT, () => { sent += 1; });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 3600, actor: "controlled-reviewer" });
    await executeProductionSchedulerAutomation(options, {
      batch_id: "actions-cadence-first", actor: "github-actions:test", started_at: AT
    });
    const denied = await executeProductionSchedulerAutomation(options, {
      batch_id: "actions-cadence-denied", actor: "github-actions:test", started_at: AT
    });
    assert.equal(denied.batch_status, "FAILED");
    assert.deepEqual(denied.manifest.deferred_sources.map(item => item.reason), ["CADENCE_DENIED"]);
    assert.equal(sent, 1);
  } finally {
    repository.remove();
  }
});

test("stale Actions checkout fails before scheduler dispatch", async () => {
  const repository = await createRemote();
  try {
    let sent = 0;
    const options = controlledOptions(repository.remote, () => AT, () => { sent += 1; });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    await assert.rejects(() => executeProductionSchedulerAutomation(options, {
      batch_id: "actions-stale-checkout", actor: "github-actions:test", started_at: AT,
      expected_starting_sha: "0".repeat(40)
    }), /ACTIONS_STARTING_HEAD_MISMATCH/u);
    assert.equal(sent, 0);
    assert.equal((await root.restore()).scheduler_batches.length, 0);
  } finally {
    repository.remove();
  }
});

test("revoked authorization is not enumerated or requested by the Actions boundary", async () => {
  const repository = await createRemote();
  try {
    let sent = 0;
    const options = controlledOptions(repository.remote, () => LATER, () => { sent += 1; });
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    const grant = await root.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT,
      min_interval_seconds: 60, actor: "controlled-reviewer" });
    await root.revokeContinuousAuthorization({ authorization_id: grant.record.payload.grant!.authorization_id,
      actor: "controlled-reviewer", reference: "controlled:revoke" });
    const result = await executeProductionSchedulerAutomation(options, {
      batch_id: "actions-revoked", actor: "github-actions:test", started_at: LATER
    });
    assert.equal(result.batch_status, "FAILED");
    assert.deepEqual(result.manifest.source_executions, []);
    assert.deepEqual(result.manifest.deferred_sources, []);
    assert.equal((await root.restore()).continuous_authorizations[0]?.state, "REVOKED");
    assert.equal(sent, 0);
  } finally {
    repository.remove();
  }
});

test("workflow is manual, deterministic, minimally privileged and isolated from Legacy", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/production-scheduler.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /AUTHORITATIVE_BRANCH:.*github\.ref_name/u);
  assert.match(workflow, /PRODUCTION_STREAM_ID:\s*\$\{\{ vars\.PRODUCTION_STREAM_ID \}\}/u);
  assert.doesNotMatch(workflow, /^\s*schedule:/mu);
  assert.match(workflow, /contents:\s*write/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.match(workflow, /uses:\s*pnpm\/setup@v2/u);
  assert.match(workflow, /version:\s*\$\{\{ env\.PNPM_VERSION \}\}/u);
  assert.match(workflow, /runtime:\s*node@\$\{\{ env\.NODE_VERSION \}\}/u);
  assert.match(workflow, /install:\s*false/u);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(workflow, /pnpm production:scheduler:actions/u);
  assert.doesNotMatch(workflow, /sync:jobs|export:mirror|crawler|scoring|app\/api\/jobs|supabase/iu);
  assert.doesNotMatch(workflow, /push\s+--force|git\s+(?:merge|rebase)/iu);
});

test("production Actions entrypoint is fail-closed and contains no Canary or Legacy dependency", () => {
  const entrypoint = readFileSync(path.join(process.cwd(), "scripts/run-production-scheduler-actions.ts"), "utf8");
  const registry = readFileSync(path.join(process.cwd(), "lib/production-automation/production-adapter-registry.ts"), "utf8");
  const automation = readFileSync(path.join(process.cwd(), "lib/production-automation/github-actions-automation.ts"), "utf8");
  const combined = `${entrypoint}\n${registry}\n${automation}`;
  assert.match(combined, /PRODUCTION_SCHEDULER_ACTIVATION/u);
  assert.match(entrypoint, /ACTIONS_CHECKOUT_HEAD_MISMATCH/u);
  assert.doesNotMatch(combined, /live-canary|crawler|scoring|sync-jobs|jobs\.ts|match_score|non_law_rule/iu);
  assert.doesNotMatch(combined, /CandidateProfile|candidate_evidence/iu);
  assert.doesNotMatch(combined, /from "\.\.\/production-persistence"/u);
});

function controlledOptions(remote: string, now: () => string, onRequest: () => void) {
  const bytes = new TextEncoder().encode("Controlled Actions official source");
  const transport = { async execute(): Promise<TransportResponse> {
    onRequest();
    return { status: "SUCCESS", bytes,
      content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
      responded_at: now() as never, mime_type: "text/html", http_status: 200, headers: {} };
  } };
  return { remote_url: remote, branch: "main", stream_id: "actions-controlled",
    execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
    controlled_continuous_transport: transport, now, commit_identity: identity,
    resolve_adapter: (adapterKey: string) => controlledAdapter(adapterKey) };
}

function controlledAdapter(adapterKey: string): RecruitmentAdapter | null {
  if (adapterKey !== "p2-05-test-only") return null;
  const template = trustedFixture("actions-controlled", "学历要求：本科及以上", { raw_title: "法务岗" });
  return { descriptor: { adapter_key: adapterKey, name: "Controlled Actions adapter", version: "1.0.0",
    supported_content_kinds: ["HTML"], capabilities: ["SINGLE_PAGE", "HTML_EXTRACTION"] },
    validateEndpoint: () => ({ valid: true, issues: [] }),
    plan: endpoint => [{ recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: endpoint.locator, method: "GET", parameters: {}, pagination_state: {
        page_index: 1, cursor: null, visited_locators: [endpoint.locator] } }],
    extract: ({ snapshot, endpoint }) => [{ ...template.source.extracted_record,
      extracted_record_id: `actions:${snapshot.snapshot_id}` as never,
      snapshot_id: snapshot.snapshot_id, source_definition_id: endpoint.source_definition_id,
      announcement_url: endpoint.locator,
      extraction: { extractor_name: "ControlledActionsAdapter", extractor_version: "1.0.0",
        extracted_at: snapshot.observed_at } }],
    nextPage: () => null,
    assessCompleteness: () => ({ status: "COMPLETE", reason_codes: [] }) };
}
