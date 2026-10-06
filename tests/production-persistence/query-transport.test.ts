import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapZeroCostProductionCompositionRoot } from "../../lib/production-persistence/zero-cost-production-composition-root";
import { executeContinuousRequest } from "../../lib/production-persistence/continuous-request-gate";
import { AT, createRemote, identity } from "./continuous-acquisition-fixture";

test("committed query authorization reaches stateless native transport; arbitrary query never reserves or sends", async () => {
  const remote = await createRemote({ max_pages: 3 }, "JSON", 3);
  const original = globalThis.fetch;
  try {
    const root = bootstrapZeroCostProductionCompositionRoot({ remote_url: remote.remote, branch: "main",
      stream_id: "query-transport", execution_mode: "TEST_ONLY", continuous_scope: "CONTROLLED_TEST", now: () => AT, commit_identity: identity });
    const authorizationIds: string[] = [];
    for (const target of remote.input.admitted.continuous_acquisition_scope.exact_targets) {
      const result = await root.issueContinuousAuthorization({ allowlist_entry_id: target.allowlist_entry_id,
        effective_from: AT, min_interval_seconds: 60, actor: "controlled-reviewer" });
      authorizationIds.push(result.record.payload.grant!.authorization_id);
    }
    let sends = 0;
    globalThis.fetch = async (url, options) => {
      sends += 1;
      assert.equal(String(url), remote.input.admitted.continuous_acquisition_scope.exact_targets[0]!.exact_url);
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "manual");
      assert.deepEqual(options?.headers, {});
      return new Response('{"records":[]}', { status: 200, headers: { "content-type": "application/json", "set-cookie": "private-cookie-must-be-discarded" } });
    };
    const gate = { repository_path: remote.clone(), branch: "main", authorization_ids: authorizationIds,
      source_admission_id: remote.input.admitted.source_admission_id, recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id,
      scope: "CONTROLLED_TEST" as const, commit_identity: identity, now: () => AT };
    const request = { recruitment_endpoint_id: remote.input.endpoint.recruitment_endpoint_id,
      locator: remote.input.admitted.continuous_acquisition_scope.exact_targets[0]!.exact_url,
      method: "GET" as const, headers: {}, parameters: {}, timeout_ms: 1000, requested_at: AT as never };
    const execution = await executeContinuousRequest(gate, request);
    assert.equal(execution.response.status, "SUCCESS");
    assert.equal(execution.response.response_set_cookie_present, true);
    assert.equal(JSON.stringify(execution).includes("private-cookie"), false);
    const state = await root.restore();
    assert.equal(state.continuous_records.filter(record => record.kind === "RESERVE").length, 1);
    await assert.rejects(() => executeContinuousRequest(gate, { ...request, locator: request.locator.replace("page=1", "page=9") }));
    await assert.rejects(() => executeContinuousRequest(gate, { ...request, locator: request.locator + "&unknown=1" }));
    await assert.rejects(() => executeContinuousRequest(gate, { ...request, locator: request.locator.replace("page=1", "page=01") }));
    assert.equal(sends, 1);
    assert.equal((await root.restore()).continuous_records.length, state.continuous_records.length);
  } finally { globalThis.fetch = original; remote.remove(); }
});
