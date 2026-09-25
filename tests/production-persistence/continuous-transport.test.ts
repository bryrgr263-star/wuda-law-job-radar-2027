import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { executeContinuousOfficialRequest } from "../../lib/production-persistence/continuous-request-gate";
import { InMemoryRawBlobRepository, InMemorySnapshotRepository, RawCaptureService } from "../../lib/ingestion";
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

test("official policy stop records each observable branch without retaining response secrets", async () => {
  const original = globalThis.fetch;
  const redirected = new Response("redirected", { status: 200 });
  Object.defineProperty(redirected, "redirected", { value: true });
  const cases = [
    { response: new Response(null, { status: 302, headers: { location: "https://unapproved.invalid/?token=secret-redirect" } }),
      reasons: ["HTTP_STATUS_OUTSIDE_SUCCESS", "REDIRECT_RESPONSE", "REDIRECT_TARGET_NOT_APPROVED"] },
    { response: new Response(null, { status: 401 }), reasons: ["HTTP_STATUS_OUTSIDE_SUCCESS"] },
    { response: new Response(null, { status: 403 }), reasons: ["HTTP_STATUS_OUTSIDE_SUCCESS"] },
    { response: redirected, reasons: ["RESPONSE_REDIRECTED"] },
    { response: new Response(null, { status: 302 }),
      reasons: ["HTTP_STATUS_OUTSIDE_SUCCESS", "REDIRECT_RESPONSE", "REDIRECT_TARGET_UNVERIFIABLE"] },
    { response: new Response("ordinary page", { status: 200, headers: {
      "set-cookie": "session=secret-cookie", link: "<https://example.invalid/?token=secret-link>",
      "content-type": "text/html; charset=utf-8" } }), reasons: ["RESPONSE_SET_COOKIE_PRESENT"] }
  ];
  try {
    for (const { response, reasons } of cases) {
      globalThis.fetch = async () => response;
      const result = await executeContinuousOfficialRequest(transportRequest, () => AT);
      assert.equal(result.status, "FAILED");
      if (result.status !== "FAILED") continue;
      assert.equal(result.error.code, "OFFICIAL_NETWORK_POLICY_STOP");
      assert.deepEqual(result.error.policy_reason_codes, reasons);
      const capture = new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository());
      const { snapshot } = capture.record(transportRequest, result);
      assert.deepEqual(snapshot.response_metadata.transport_error?.policy_reason_codes, reasons);
      assert.doesNotMatch(JSON.stringify({ result, snapshot }), /secret-cookie|secret-redirect|secret-link/u);
    }
  } finally { globalThis.fetch = original; }
});

test("manual redirect and response cookie remain blocked even when the URL is same-origin", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 301,
      headers: { location: "https://example.invalid/canonical" } });
    const result = await executeContinuousOfficialRequest(transportRequest, () => AT);
    assert.equal(result.status, "FAILED");
    if (result.status === "FAILED") assert.deepEqual(result.error.policy_reason_codes,
      ["HTTP_STATUS_OUTSIDE_SUCCESS", "REDIRECT_RESPONSE", "REDIRECT_TARGET_NOT_APPROVED"]);
  } finally { globalThis.fetch = original; }
});

test("accepted exact response persists only safe content metadata", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("official page", { status: 200, headers: {
      "content-type": "text/html; charset=utf-8",
      link: "<https://example.invalid/other?token=secret-link>",
      location: "https://example.invalid/other?token=secret-location"
    } });
    const result = await executeContinuousOfficialRequest(transportRequest, () => AT);
    assert.equal(result.status, "SUCCESS");
    assert.deepEqual(result.headers, { "content-type": "text/html; charset=utf-8" });
    assert.doesNotMatch(JSON.stringify(result), /secret-link|secret-location/u);
  } finally { globalThis.fetch = original; }
});
