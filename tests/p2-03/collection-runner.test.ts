import assert from "node:assert/strict";
import test from "node:test";

import { endpoint, runner, startLocalTestServer } from "./test-support";

function json(outgoing: Parameters<Parameters<typeof startLocalTestServer>[0]>[1], body: string, next?: string) {
  outgoing.writeHead(200, {
    "content-type": "application/json",
    ...(next ? { "x-p2-next-page": next } : {})
  });
  outgoing.end(body);
}

test("Collection Runner paginates local HTTP, captures Raw before Adapter extraction, and rate limits", async () => {
  let origin = "";
  const server = await startLocalTestServer((incoming, outgoing) => {
    if (incoming.url === "/page-1") return json(outgoing, '{"records":[{"id":"one","title":"法律硕士（非法学）"}]}', `${origin}/page-2`);
    return json(outgoing, '{"records":[{"id":"two","title":"法务岗"}]}');
  });
  origin = server.origin;
  try {
    const runtime = runner(origin);
    const result = await runtime.runner.run({ collection_run_id: "run-pages", endpoint: endpoint(`${origin}/page-1`), adapter: runtime.adapter });
    assert.equal(result.status, "SUCCESS");
    assert.deepEqual(result.runtime_states, ["CREATED", "RUNNING", "COMPLETED"]);
    assert.equal(result.pages_collected, 2);
    assert.equal(result.extracted_records.length, 2);
    assert.equal(result.raw_blobs.length, 2);
    assert.deepEqual(result.snapshots.map((snapshot) => snapshot.transport_status), ["SUCCESS", "SUCCESS"]);
    assert.ok(runtime.waits.includes(10));
    assert.equal(runtime.rawBlobs.count(), 2);
    assert.equal(runtime.snapshots.count(), 2);
  } finally {
    await server.close();
  }
});

test("Collection Runner retains failed retry snapshots and never upgrades them to SUCCESS", async () => {
  let calls = 0;
  const server = await startLocalTestServer((_incoming, outgoing) => {
    calls += 1;
    if (calls === 1) { outgoing.writeHead(500, { "content-type": "application/json" }); outgoing.end("retry"); return; }
    json(outgoing, '{"records":[{"id":"after-retry","title":"法务"}]}');
  });
  try {
    const runtime = runner(server.origin);
    const result = await runtime.runner.run({ collection_run_id: "run-retry", endpoint: endpoint(`${server.origin}/retry`), adapter: runtime.adapter });
    assert.equal(result.status, "FAILED");
    assert.equal(result.requests_made, 2);
    assert.deepEqual(result.snapshots.map((snapshot) => snapshot.transport_status), ["FAILED", "SUCCESS"]);
    assert.equal(result.raw_blobs.length, 1);
    assert.ok(result.reason_codes.includes("TRANSPORT_FAILED"));
  } finally {
    await server.close();
  }
});

test("Collection Runner classifies empty, page limits, repeated pages, and malformed next pages conservatively", async () => {
  let origin = "";
  const server = await startLocalTestServer((incoming, outgoing) => {
    if (incoming.url === "/empty") return json(outgoing, '{"records":[]}');
    if (incoming.url === "/repeat") return json(outgoing, '{"records":[{"id":"one","title":"法务"}]}', `${origin}/repeat`);
    if (incoming.url === "/malformed") return json(outgoing, '{"records":[{"id":"one","title":"法务"}]}', "MALFORMED");
    return json(outgoing, '{"records":[{"id":"one","title":"法务"}]}', `${origin}/next`);
  });
  origin = server.origin;
  try {
    const emptyRuntime = runner(origin);
    const empty = await emptyRuntime.runner.run({ collection_run_id: "run-empty", endpoint: endpoint(`${origin}/empty`), adapter: emptyRuntime.adapter });
    assert.equal(empty.status, "SUSPICIOUS_EMPTY");

    const repeatRuntime = runner(origin);
    const repeat = await repeatRuntime.runner.run({ collection_run_id: "run-repeat", endpoint: endpoint(`${origin}/repeat`), adapter: repeatRuntime.adapter });
    assert.equal(repeat.status, "PARTIAL");
    assert.ok(repeat.reason_codes.includes("REPEATED_PAGE_BLOCKED"));

    const malformedRuntime = runner(origin);
    const malformed = await malformedRuntime.runner.run({ collection_run_id: "run-malformed", endpoint: endpoint(`${origin}/malformed`), adapter: malformedRuntime.adapter });
    assert.equal(malformed.status, "PARTIAL");
    assert.ok(malformed.reason_codes.includes("MALFORMED_NEXT_PAGE"));

    const limitedRuntime = runner(origin, { max_pages: 1 });
    const limited = await limitedRuntime.runner.run({ collection_run_id: "run-limited", endpoint: endpoint(`${origin}/limit`), adapter: limitedRuntime.adapter });
    assert.equal(limited.status, "PARTIAL");
    assert.ok(limited.reason_codes.includes("MAX_PAGES_REACHED"));

    const budgetRuntime = runner(origin, { request_budget: 1 });
    const budget = await budgetRuntime.runner.run({ collection_run_id: "run-budget", endpoint: endpoint(`${origin}/limit`), adapter: budgetRuntime.adapter });
    assert.equal(budget.status, "PARTIAL");
    assert.ok(budget.reason_codes.includes("REQUEST_BUDGET_EXHAUSTED"));
  } finally {
    await server.close();
  }
});
