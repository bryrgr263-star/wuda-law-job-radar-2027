import assert from "node:assert/strict";
import test from "node:test";

import { endpoint, runner, startLocalTestServer } from "./test-support";

test("Collection Runner records timeout as FAILED without creating a successful RawBlob", async () => {
  const server = await startLocalTestServer((_incoming, outgoing) => {
    setTimeout(() => { outgoing.writeHead(200, { "content-type": "application/json" }); outgoing.end('{"records":[]}'); }, 80);
  });
  try {
    const runtime = runner(server.origin, { timeout_ms: 10, retry_limit: 0 });
    const result = await runtime.runner.run({ collection_run_id: "run-timeout", endpoint: endpoint(`${server.origin}/slow`), adapter: runtime.adapter });
    assert.equal(result.status, "FAILED");
    assert.equal(result.raw_blobs.length, 0);
    assert.deepEqual(result.snapshots.map((snapshot) => snapshot.transport_status), ["FAILED"]);
    assert.ok(result.reason_codes.includes("TRANSPORT_FAILED"));
  } finally {
    await server.close();
  }
});
