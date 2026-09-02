import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import { LocalHttpTransport, createLocalHttpEgressPolicy } from "../../lib/collection-runtime";

test("shared Network Guard still blocks accidental external network access", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});

test("P2-03 Transport denies a public Live Canary target before any request", async () => {
  const transport = new LocalHttpTransport(createLocalHttpEgressPolicy(["http://127.0.0.1:1"]));
  const result = await transport.execute({
    recruitment_endpoint_id: "p2-local-endpoint" as never,
    locator: "https://example.invalid/approved-canary",
    method: "GET",
    requested_at: "2026-09-05T00:00:00.000Z" as never,
    headers: {},
    parameters: {},
    timeout_ms: 100
  });
  assert.equal(result.status, "FAILED");
  if (result.status === "FAILED") {
    assert.equal(result.error.code, "EGRESS_DENIED");
    assert.equal(result.error.retryable, false);
  }
});
