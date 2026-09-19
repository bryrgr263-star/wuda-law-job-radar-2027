import "../helpers/network-guard";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { RecruitmentAdapter, TransportResponse, TrustedSourceOccurrenceArtifact } from "../../lib/ingestion";
import { bootstrapZeroCostProductionCompositionRoot, type ZeroCostProductionRunInput } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { trustedFixture } from "../pipeline/position-bound-phase-fixture";
import { AT, LATER, TARGET, request, createRemote, provenance } from "./continuous-acquisition-fixture";

function root(remote: string, options: Partial<Parameters<typeof bootstrapZeroCostProductionCompositionRoot>[0]> = {}) {
  return bootstrapZeroCostProductionCompositionRoot({ remote_url: remote, branch: "main", stream_id: "continuous-root",
    continuous_scope: "CONTROLLED_TEST", now: () => AT, ...options });
}
function input(remote: Awaited<ReturnType<typeof createRemote>>): ZeroCostProductionRunInput {
  const template = trustedFixture("continuous-root", "学历要求：本科及以上");
  const adapter: RecruitmentAdapter = { descriptor: { adapter_key: remote.input.endpoint.adapter_key,
    name: "Controlled reused fixture", version: "1.0.0", supported_content_kinds: ["HTML"], capabilities: ["SINGLE_PAGE", "HTML_EXTRACTION"] },
    validateEndpoint: () => ({ valid: true, issues: [] }), plan: endpoint => [{ recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: request.locator, method: "GET", parameters: {}, pagination_state: { page_index: 1, cursor: null, visited_locators: [] } }],
    extract: ({ snapshot, endpoint }) => [{ ...template.source.extracted_record, snapshot_id: snapshot.snapshot_id,
      extracted_record_id: `controlled:${snapshot.snapshot_id}` as never, source_definition_id: endpoint.source_definition_id,
      announcement_url: request.locator, extraction: { extractor_name: "ControlledFixture", extractor_version: "1.0.0", extracted_at: snapshot.observed_at } }],
    nextPage: () => null, assessCompleteness: () => ({ status: "COMPLETE", reason_codes: [] }) };
  return { run_id: "controlled-continuous-root", source_versions: [], source_admission_id: remote.input.admitted.source_admission_id,
    recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id, adapter, transport: { async execute() { throw new Error("CALLER_TRANSPORT_MUST_NOT_DISPATCH"); } },
    provenance, actor: "controlled-test", started_at: AT, execute_trusted_chain: async context => {
      const source = context.source_occurrences[0] as TrustedSourceOccurrenceArtifact;
      const registration = await context.execute({ kind: "OPPORTUNITY_REGISTER", input: { source_definition_id: source.endpoint.source_definition_id,
        recruitment_endpoint_id: source.endpoint.recruitment_endpoint_id, discovery_locator: request.locator,
        snapshot_id: source.snapshot.snapshot_id, extracted_record_id: source.extracted_record.extracted_record_id,
        source_occurrence_version_id: source.version.source_occurrence_version_id, publisher_subject: null,
        discovery_evidence_ids: ["fixture:continuous-controlled"], first_observed_at: source.version.first_observed_at,
        initial_disposition: { status: "RETAINED", reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"], evidence_ids: ["fixture:continuous-controlled"], decided_at: source.version.first_observed_at } } }) as {
          candidate: import("../../lib/ingestion").OpportunityCandidate; disposition: import("../../lib/ingestion").RecallDisposition;
        };
      await context.execute({ kind: "PRESENTATION_DECIDE", input: { contract_version: "presentation-decision/2.0.0",
        expected_current_presentation_decision_id: null, opportunity_candidate_id: registration.candidate.opportunity_candidate_id,
        recall_disposition_id: registration.disposition.recall_disposition_id, relevance_assessment_id: null,
        eligibility_assessment_id: null, decided_at: source.version.first_observed_at } });
    } };
}
test("existing root runs committed source semantics through per-request gate and trusted processors; caller transport is never used", async () => {
  const remote = await createRemote(); try {
    const bytes = new TextEncoder().encode("CONTROLLED_TEST recruitment evidence"); let sent = 0;
    const runner = root(remote.remote, { controlled_continuous_transport: { async execute(): Promise<TransportResponse> {
      sent += 1; return { status: "SUCCESS", bytes, content_sha256: createHash("sha256").update(bytes).digest("hex") as never,
        responded_at: AT as never, mime_type: "text/html", http_status: 200, headers: {} };
    } } });
    const issued = await runner.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT, min_interval_seconds: 60, actor: "reviewer" });
    const runInput = { ...input(remote), continuous_authorization_ids: [issued.record.payload.grant!.authorization_id] };
    const run = await runner.run(runInput); assert.equal(run.status, "COMMITTED", JSON.stringify(run)); assert.equal(sent, 1);
    const restored = await runner.restore(); assert.equal(restored.source_version_count, remote.input.versions.length);
    assert.equal(restored.acquisition_count, 1); assert.ok(restored.restored_record_count > 0);
    assert.deepEqual(restored.continuous_records.map(record => record.kind), ["GRANT", "RESERVE", "COMPLETE"]);
    assert.equal((await runner.run({ ...runInput, run_id: "too-soon" })).status, "FAILED"); assert.equal(sent, 1);
    const changedInput = { ...runInput, source_versions: remote.input.versions };
    assert.equal((await runner.run(changedInput)).status, "FAILED"); assert.equal(sent, 1);
    await root(remote.remote, { now: () => LATER }).revokeContinuousAuthorization({ authorization_id: runInput.continuous_authorization_ids[0]!, actor: "operator", reference: "controlled:stop" });
    assert.equal((await runner.restore()).acquisition_count, 1);
    assert.equal((await runner.restore()).continuous_authorizations[0]?.state, "REVOKED");
    assert.equal((await runner.run({ ...runInput, run_id: "revoked" })).status, "FAILED"); assert.equal(sent, 1);
  } finally { remote.remove(); }
});
test("continuous permission alone never dispatches; test transport cannot be installed in production scope", async () => {
  const remote = await createRemote(); try {
    let sent = 0; const runner = root(remote.remote, { controlled_continuous_transport: { async execute() { sent += 1; throw new Error("forbidden"); } } });
    const result = await runner.run(input(remote)); assert.equal(result.status, "FAILED"); assert.equal(sent, 0);
    assert.throws(() => bootstrapZeroCostProductionCompositionRoot({ remote_url: remote.remote, branch: "main", stream_id: "deny", controlled_continuous_transport: {
      async execute() { throw new Error("forbidden"); }
    } }), /CONTROLLED_TRANSPORT_NOT_ALLOWED/);
    await assert.rejects(() => bootstrapZeroCostProductionCompositionRoot({ remote_url: remote.remote, branch: "main", stream_id: "deny" }).issueContinuousAuthorization({
      allowlist_entry_id: TARGET, effective_from: AT, min_interval_seconds: 60, actor: "test" }), /SCOPE_MISMATCH/);
  } finally { remote.remove(); }
});
test("retry re-enters the current authorization gate; a confirmed failed attempt consumes cadence before the retry", async () => {
  const remote = await createRemote({ retry_limit: 1 }); try {
    let sent = 0;
    const runner = root(remote.remote, { controlled_continuous_transport: { async execute() {
      sent += 1; return { status: "FAILED", responded_at: AT as never, http_status: 503, headers: {}, mime_type: null,
        error: { code: "CONTROLLED_RETRYABLE_HTTP_FAILURE", message: "known failed HTTP", retryable: true } };
    } } });
    const issued = await runner.issueContinuousAuthorization({ allowlist_entry_id: TARGET, effective_from: AT, min_interval_seconds: 60, actor: "reviewer" });
    const result = await runner.run({ ...input(remote), continuous_authorization_ids: [issued.record.payload.grant!.authorization_id] });
    assert.equal(result.status, "FAILED"); assert.match(result.error!, /CADENCE/); assert.equal(sent, 1);
    const restored = await runner.restore();
    assert.deepEqual(restored.continuous_records.map(record => record.kind), ["GRANT", "RESERVE", "COMPLETE"]);
    assert.equal(restored.continuous_records.at(-1)?.payload.outcome, "FAILED");
    assert.equal(restored.continuous_authorizations[0]?.pending_attempt, null);
  } finally { remote.remove(); }
});
