import assert from "node:assert/strict";
import test from "node:test";

import { LocalHttpTransport, createLocalHttpEgressPolicy } from "../../lib/collection-runtime";
import type { HttpTransportRequest } from "../../lib/collection-runtime";

import { startLocalTestServer } from "./test-support";

function request(locator: string, overrides: Partial<HttpTransportRequest> = {}): HttpTransportRequest {
  return {
    recruitment_endpoint_id: "p2-local-endpoint" as HttpTransportRequest["recruitment_endpoint_id"],
    locator,
    method: "GET",
    requested_at: "2026-09-05T00:00:00.000Z" as HttpTransportRequest["requested_at"],
    headers: {},
    parameters: {},
    timeout_ms: 100,
    ...overrides
  };
}

test("Local HTTP Transport accepts only an explicit loopback test server and returns raw bytes", async () => {
  const server = await startLocalTestServer((incoming, outgoing) => {
    assert.equal(incoming.url, "/echo?query=%E6%B3%95%E5%BE%8B");
    assert.equal(incoming.method, "POST");
    const chunks: Uint8Array[] = [];
    incoming.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    incoming.on("end", () => {
      outgoing.writeHead(200, { "content-type": "application/json", "set-cookie": "must-not-persist" });
      outgoing.end(Buffer.concat(chunks));
    });
  });
  try {
    const transport = new LocalHttpTransport(createLocalHttpEgressPolicy([server.origin]));
    const response = await transport.execute(request(`${server.origin}/echo`, {
      method: "POST",
      parameters: { query: "法律" },
      body: new TextEncoder().encode('{"岗位":"法务"}')
    }));
    assert.equal(response.status, "SUCCESS");
    if (response.status === "SUCCESS") {
      assert.equal(response.http_status, 200);
      assert.equal(response.mime_type, "application/json");
      assert.equal(new TextDecoder().decode(response.bytes), '{"岗位":"法务"}');
      assert.equal(response.headers["set-cookie"], undefined);
    }
  } finally {
    await server.close();
  }
});

test("Local HTTP Transport rejects public, unapproved, credentialed, and sensitive requests before egress", async () => {
  assert.throws(() => createLocalHttpEgressPolicy(["https://example.invalid"]), /loopback/);
  const transport = new LocalHttpTransport(createLocalHttpEgressPolicy(["http://127.0.0.1:1"]));
  const publicResult = await transport.execute(request("https://example.invalid/recruitment"));
  assert.equal(publicResult.status, "FAILED");
  if (publicResult.status === "FAILED") assert.equal(publicResult.error.code, "EGRESS_DENIED");
  const credentialResult = await transport.execute(request("http://user:pass@127.0.0.1:1/private"));
  assert.equal(credentialResult.status, "FAILED");
  const headerResult = await transport.execute(request("http://127.0.0.1:1/", { headers: { authorization: "Bearer forbidden" } }));
  assert.equal(headerResult.status, "FAILED");
  if (headerResult.status === "FAILED") assert.equal(headerResult.error.retryable, false);
});

test("Local HTTP Transport classifies retryable HTTP failures and timeouts without Raw success", async () => {
  const server = await startLocalTestServer((incoming, outgoing) => {
    if (incoming.url === "/limited") {
      outgoing.writeHead(429, { "content-type": "application/json" });
      outgoing.end("slow down");
      return;
    }
    setTimeout(() => { outgoing.writeHead(200); outgoing.end("late"); }, 80);
  });
  try {
    const transport = new LocalHttpTransport(createLocalHttpEgressPolicy([server.origin]));
    const rateLimited = await transport.execute(request(`${server.origin}/limited`));
    assert.equal(rateLimited.status, "FAILED");
    if (rateLimited.status === "FAILED") {
      assert.equal(rateLimited.error.code, "RATE_LIMITED");
      assert.equal(rateLimited.error.retryable, true);
    }
    const timedOut = await transport.execute(request(`${server.origin}/slow`, { timeout_ms: 10 }));
    assert.equal(timedOut.status, "FAILED");
    if (timedOut.status === "FAILED") assert.equal(timedOut.error.code, "TIMEOUT");
  } finally {
    await server.close();
  }
});
