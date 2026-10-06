import "../helpers/network-guard";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { RecruitmentAdapter, TransportResponse } from "../../lib/ingestion";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { trustedFixture } from "../pipeline/position-bound-phase-fixture";
import { AT, createRemote, identity, provenance } from "./continuous-acquisition-fixture";

test("query root persists requested, bounded-stop and pre-reservation abort states for fresh Process B", async () => {
  const remote = await createRemote({ max_pages: 3, max_items: 3 }, "JSON", 3);
  try {
    let runMode: "bounded" | "abort" | "complete" = "bounded";
    let failBeforeReserve = false;
    let clock = AT;
    const sent: string[] = [];
    const options = { remote_url: remote.remote, branch: "main", stream_id: "controlled-query-root",
      execution_mode: "TEST_ONLY" as const, continuous_scope: "CONTROLLED_TEST" as const,
      now: () => { if (failBeforeReserve) { failBeforeReserve = false; throw new Error("RUN_ABORTED"); } return clock; }, commit_identity: identity,
      controlled_continuous_transport: { async execute(request: { locator: string }): Promise<TransportResponse> {
        sent.push(request.locator);
        const empty = runMode === "bounded" && request.locator.endsWith("page=2");
        const bytes = new TextEncoder().encode(empty ? '{"records":[]}' : JSON.stringify({ records: [{ title: "法务", id: request.locator }] }));
        return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
          responded_at: clock as never, mime_type: "application/json", http_status: 200, headers: {} };
      } } };
    const root = bootstrapZeroCostProductionCompositionRoot(options);
    const grants: string[] = [];
    for (const target of remote.input.admitted.continuous_acquisition_scope.exact_targets) {
      const issued = await root.issueContinuousAuthorization({ allowlist_entry_id: target.allowlist_entry_id,
        effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
      grants.push(issued.record.payload.grant!.authorization_id);
    }
    const template = trustedFixture("query-root-record", "学历要求：本科及以上");
    const adapter: RecruitmentAdapter = { descriptor: { adapter_key: remote.input.endpoint.adapter_key,
      name: "Controlled query adapter", version: "1.0.0", supported_content_kinds: ["JSON"], capabilities: ["SINGLE_PAGE", "JSON_EXTRACTION"] },
      validateEndpoint: () => ({ valid: true, issues: [] }),
      plan: endpoint => remote.input.admitted.continuous_acquisition_scope.exact_targets.map((target, index) => ({
        recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: target.exact_url, method: "GET", parameters: {},
        pagination_state: { page_index: index + 1, cursor: null, visited_locators: [] } })),
      extract: ({ snapshot, raw_blob, endpoint }) => {
        const parsed = JSON.parse(new TextDecoder().decode(raw_blob!.bytes));
        if (!parsed.records.length) return [];
        if (runMode === "abort") failBeforeReserve = true;
        return [{ ...template.source.extracted_record, snapshot_id: snapshot.snapshot_id,
          raw_source_record_id: runMode === "complete" ? parsed.records[0].id : template.source.extracted_record.raw_source_record_id,
          extracted_record_id: `query:${snapshot.snapshot_id}` as never, source_definition_id: endpoint.source_definition_id,
          announcement_url: remote.input.admitted.endpoint, extraction: { extractor_name: "ControlledQuery", extractor_version: "1.0.0", extracted_at: snapshot.observed_at } }];
      }, nextPage: () => null, assessCompleteness: () => ({ status: "COMPLETE", reason_codes: [] }) };
    const input = { run_id: "query-bounded", source_versions: [], source_admission_id: remote.input.admitted.source_admission_id,
      recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, adapter,
      continuous_authorization_ids: grants, provenance, actor: "controlled-test", started_at: AT,
      transport: { async execute(): Promise<TransportResponse> { throw new Error("CALLER_TRANSPORT_FORBIDDEN"); } },
      execute_trusted_chain: async () => {} };
    const bounded = await root.run(input);
    assert.notEqual(bounded.status, "FAILED", JSON.stringify(bounded));
    assert.equal(sent.length, 2);
    const beforeAbort = await root.restore();
    const boundedPlan = beforeAbort.source_execution_outcomes[0]!.request_plan!;
    assert.deepEqual(boundedPlan.targets.map(target => target.execution_disposition), ["REQUESTED", "REQUESTED", "SKIPPED_BY_BOUNDED_STOP"]);
    assert.equal(boundedPlan.targets[2]!.stop_evidence!.reason, "EMPTY_PAGE_STOP");
    runMode = "abort";
    clock = "2026-09-18T00:02:00.000Z";
    await root.run({ ...input, run_id: "query-abort", started_at: clock });
    failBeforeReserve = false;
    const restored = await root.restore();
    const aborted = restored.source_execution_outcomes.find(outcome => outcome.source_execution_id === "query-abort")!;
    assert.ok(aborted);
    assert.deepEqual(aborted.request_plan!.targets.map(target => target.execution_disposition), ["REQUESTED", "NOT_REQUESTED_DUE_ABORT", "NOT_REQUESTED_DUE_ABORT"]);
    assert.equal(aborted.request_plan!.targets[1]!.abort_evidence!.stage, "BEFORE_RESERVATION");
    assert.equal(aborted.request_plan!.targets[1]!.abort_evidence!.reason, "RUN_ABORTED");
    assert.equal(sent.length, 3);
    assert.equal(restored.continuous_records.filter(record => record.kind === "RESERVE").length, 3);
    runMode = "complete";
    clock = "2026-09-18T00:04:00.000Z";
    const completed = await root.run({ ...input, run_id: "query-complete", started_at: clock });
    assert.equal(completed.error, "Production run did not produce a PresentationReadModel or verified retained outcome");
    const finalState = await root.restore();
    assert.equal(finalState.source_execution_outcomes.length, 3);
    assert.equal(finalState.continuous_records.filter(record => record.kind === "RESERVE").length, 6);
    assert.deepEqual(finalState.source_execution_outcomes.find(outcome => outcome.source_execution_id === "query-complete")!
      .request_plan!.targets.map(target => target.execution_disposition), ["REQUESTED", "REQUESTED", "REQUESTED"]);
    const expectedPath = path.join(remote.directory, "expected.json");
    writeFileSync(expectedPath, canonicalSerialize({ outcomes: finalState.source_execution_outcomes,
      intents: finalState.source_execution_request_intents, continuous: finalState.continuous_records }));
    const script = path.join(remote.directory, "fresh-query.ts");
    writeFileSync(script, `import ${JSON.stringify(path.resolve("tests/helpers/network-guard.ts"))};
import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
import { bootstrapZeroCostProductionCompositionRoot } from ${JSON.stringify(path.resolve("lib/production-persistence/zero-cost-production-composition-root.ts"))};
import { canonicalSerialize } from ${JSON.stringify(path.resolve("lib/ingestion/normalization/canonical-artifact-registry.ts"))};
(async () => { const state = await bootstrapZeroCostProductionCompositionRoot({ remote_url: process.argv[2]!, branch:'main', stream_id:'controlled-query-root', execution_mode:'TEST_ONLY', continuous_scope:'CONTROLLED_TEST' }).restore();
assert.equal(canonicalSerialize({ outcomes: state.source_execution_outcomes, intents: state.source_execution_request_intents, continuous: state.continuous_records }), readFileSync(process.argv[3]!, 'utf8')); })().catch(error => { console.error(error); process.exitCode=1; });`);
    const child = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), script, remote.remote, expectedPath],
      { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    assert.ok(readFileSync(expectedPath, "utf8").includes("NOT_REQUESTED_DUE_ABORT"));
  } finally { remote.remove(); }
});

test("query production entry denies incomplete independent grant inventory before intent, reservation or send", async () => {
  const remote = await createRemote({ max_pages: 3 }, "JSON", 3);
  try {
    let sends = 0;
    const root = bootstrapZeroCostProductionCompositionRoot({ remote_url: remote.remote, branch: "main", stream_id: "query-deny",
      execution_mode: "TEST_ONLY", continuous_scope: "CONTROLLED_TEST", now: () => AT, commit_identity: identity,
      controlled_continuous_transport: { async execute(): Promise<TransportResponse> { sends += 1; throw new Error("UNAUTHORIZED_SEND"); } } });
    const grant = await root.issueContinuousAuthorization({ allowlist_entry_id: remote.input.admitted.continuous_acquisition_scope.exact_targets[0]!.allowlist_entry_id,
      effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
    const adapter: RecruitmentAdapter = { descriptor: { adapter_key: remote.input.endpoint.adapter_key, name: "Controlled denied query",
      version: "1.0.0", supported_content_kinds: ["JSON"], capabilities: ["SINGLE_PAGE", "JSON_EXTRACTION"] },
      validateEndpoint: () => ({ valid: true, issues: [] }),
      plan: endpoint => remote.input.admitted.continuous_acquisition_scope.exact_targets.map((target, index) => ({
        recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: target.exact_url, method: "GET", parameters: {},
        pagination_state: { page_index: index + 1, cursor: null, visited_locators: [] } })),
      extract: () => [], nextPage: () => null, assessCompleteness: () => ({ status: "SUSPICIOUS_EMPTY", reason_codes: [] }) };
    const run = await root.run({ run_id: "query-denied", source_versions: [], source_admission_id: remote.input.admitted.source_admission_id,
      recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, adapter, provenance, actor: "controlled-test", started_at: AT,
      continuous_authorization_ids: [grant.record.payload.grant!.authorization_id], execute_trusted_chain: async () => {},
      transport: { async execute(): Promise<TransportResponse> { throw new Error("CALLER_TRANSPORT_FORBIDDEN"); } } });
    assert.equal(run.status, "FAILED");
    assert.equal(sends, 0);
    const restored = await root.restore();
    assert.equal(restored.source_execution_request_intents.length, 0);
    assert.equal(restored.continuous_records.filter(record => record.kind === "RESERVE").length, 0);
  } finally { remote.remove(); }
});
