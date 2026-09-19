import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { executeContinuousOfficialRequest } from "../../lib/production-persistence/continuous-request-gate";
import { AT, request, fixture } from "./continuous-acquisition-fixture";

const transportRequest = { ...request, recruitment_endpoint_id: fixture().endpoint.recruitment_endpoint_id,
  requested_at: AT as never, timeout_ms: 1000 };
test("native official transport explicitly prevents redirects, cookies, login/access interaction and browser fallback", async () => {
  const original = globalThis.fetch; let dispatched = 0;
  try {
    for (const response of [new Response(null, { status: 302, headers: { location: "https://unapproved.invalid/redirect" } }),
      new Response(null, { status: 401 }), new Response("captcha", { status: 403 }),
      new Response("session", { status: 200, headers: { "set-cookie": "session=x" } })]) {
      globalThis.fetch = async (_url, options) => { dispatched += 1;
        assert.equal(options?.redirect, "manual"); assert.equal(options?.credentials, "omit");
        assert.equal(options?.method, "GET"); assert.deepEqual(options?.headers, {}); assert.equal(options?.body, undefined);
        return response; };
      const result = await executeContinuousOfficialRequest(transportRequest, () => AT);
      assert.equal(result.status, "FAILED");
      if (result.status === "FAILED") assert.equal(result.error.retryable, false);
    }
    assert.equal(dispatched, 4);
  } finally { globalThis.fetch = original; }
});
test("native transport rejects URL variants and sensitive request fields before any fetch", async () => {
  const original = globalThis.fetch; let dispatched = 0;
  try {
    globalThis.fetch = async () => { dispatched += 1; throw new Error("must not fetch"); };
    const variants: Partial<typeof transportRequest & { body?: Uint8Array }>[] = [
      { locator: request.locator + "?x=1" }, { locator: request.locator + "#x" },
      { locator: "https://user:password@example.invalid/recruitment" }, { headers: { Cookie: "x" } },
      { parameters: { page: 1 } }, { body: new Uint8Array() }, { timeout_ms: -1 } ];
    for (const change of variants) await assert.rejects(() => executeContinuousOfficialRequest({ ...transportRequest, ...change }, () => AT), /EXACT_REQUEST_DENIED/);
    assert.equal(dispatched, 0);
  } finally { globalThis.fetch = original; }
});
test("global offline Network Guard rejects native dispatch; unknown send state is not downgraded into a retryable response", async () => {
  await assert.rejects(() => executeContinuousOfficialRequest(transportRequest, () => AT), /Network access is disabled/);
});
