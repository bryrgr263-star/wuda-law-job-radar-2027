import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HttpTransportRequest } from "../../lib/collection-runtime";
import type { IsoDateTime } from "../../lib/ingestion";
import {
  BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_MAX_RESPONSE_BYTES,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_TIMEOUT_MS,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
  OneEndpointOneRunDetailLiveCanaryTransport,
  createBeijingDetailLiveCanaryApproval,
  runBeijingDetailLiveCanary
} from "../../lib/live-canary/p2-04d/beijing-public-institution-detail-live-canary";

const now = "2026-09-02T12:00:00.000Z" as IsoDateTime;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("human approval creates a directly bound Level B detail authorization", () => {
  const approval = createBeijingDetailLiveCanaryApproval(now);
  assert.equal(approval.initial_admission.admission_decision, "REVIEW");
  assert.equal(approval.approved_admission.admission_level, "B");
  assert.equal(approval.approved_admission.admission_decision, "APPROVED");
  assert.equal(approval.approved_admission.automation_basis, "HUMAN_REVIEWED_CANARY");
  assert.equal(approval.approved_admission.robots.status, "UNKNOWN");
  assert.equal(approval.approved_admission.terms.status, "UNKNOWN");
  assert.equal(approval.authorization.endpoint, BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT);
  assert.equal(approval.authorization.recruitment_endpoint_id, BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID);
  assert.equal(approval.authorization.endpoint_purpose, "JOB_DETAIL");
  assert.equal(approval.authorization.allowed_http_method, "GET");
  assert.equal(approval.authorization.scope, "ONE_ENDPOINT_ONE_RUN");
  assert.equal(approval.authorization.manual_confirmation, true);
  assert.equal(approval.authorization_decision.allowed, true);
});

test("one controlled GET captures Raw and Snapshot, then rejects authorization replay", async () => {
  let calls = 0;
  let observedInput: string | URL | Request | undefined;
  let observedInit: RequestInit | undefined;
  const approval = createBeijingDetailLiveCanaryApproval(now);
  const result = await runBeijingDetailLiveCanary(
    approval,
    new OneEndpointOneRunDetailLiveCanaryTransport(async (input, init) => {
      calls += 1;
      observedInput = input;
      observedInit = init;
      return htmlResponse("<!doctype html><html><head><title>北京急救中心公告</title></head><body><main class=\"article\"><h1>北京急救中心2026年度第四批公开招聘公告</h1><p>发布日期：2026-06-24</p></main></body></html>");
    }, { now: () => now, monotonic_now: monotonicClock() }),
    now
  );

  assert.equal(calls, 1);
  assert.equal(observedInput, BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT);
  assert.equal(observedInit?.method, "GET");
  assert.equal(observedInit?.redirect, "manual");
  assert.equal(observedInit?.credentials, "omit");
  assert.equal(observedInit?.referrerPolicy, "no-referrer");
  assert.deepEqual(observedInit?.headers, { accept: "text/html,application/xhtml+xml" });
  assert.ok(result.raw_blob);
  assert.equal(result.snapshot.transport_status, "SUCCESS");
  assert.equal(result.snapshot.raw_blob_id, result.raw_blob?.raw_blob_id);
  assert.equal(result.html_diagnostic?.page_title, "北京急救中心公告");
  assert.equal(result.transport.access_signals.login_form_observed, false);
  assert.equal(result.authorization_replay_decision.allowed, false);
  if (!result.authorization_replay_decision.allowed) {
    assert.deepEqual(result.authorization_replay_decision.reason_codes, ["AUTHORIZATION_ALREADY_USED"]);
  }
});

test("wrong URL, endpoint reference, method, headers, or parameters are rejected before egress", async () => {
  let calls = 0;
  const transport = new OneEndpointOneRunDetailLiveCanaryTransport(async () => {
    calls += 1;
    return htmlResponse("<html></html>");
  });
  for (const invalidRequest of [
    { ...request(), locator: "https://www.beijing.gov.cn/other.html" },
    { ...request(), recruitment_endpoint_id: "other-endpoint" as HttpTransportRequest["recruitment_endpoint_id"] },
    { ...request(), method: "HEAD" as HttpTransportRequest["method"] },
    { ...request(), headers: { cookie: "forbidden" } },
    { ...request(), parameters: { page: 2 } }
  ]) {
    await assert.rejects(transport.execute(invalidRequest), /authorized|GET only|caller-supplied/u);
  }
  assert.equal(calls, 0);
});

test("manual redirects are recorded and never followed", async () => {
  let calls = 0;
  const result = await new OneEndpointOneRunDetailLiveCanaryTransport(async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://www.beijing.gov.cn/other.html" }
    });
  }, { now: () => now, monotonic_now: monotonicClock() }).execute(request());
  assert.equal(calls, 1);
  assert.equal(result.response.status, "FAILED");
  assert.deepEqual(result.redirect_chain, [{ status: 302, location: "https://www.beijing.gov.cn/other.html" }]);
  if (result.response.status === "FAILED") {
    assert.equal(result.response.error.code, "UNAUTHORIZED_REDIRECT");
  }
});

test("transport cannot issue a second request", async () => {
  let calls = 0;
  const transport = new OneEndpointOneRunDetailLiveCanaryTransport(async () => {
    calls += 1;
    return htmlResponse("<html><head><title>one</title></head></html>");
  });
  assert.equal((await transport.execute(request())).response.status, "SUCCESS");
  await assert.rejects(transport.execute(request()), /already been consumed/u);
  assert.equal(calls, 1);
});

test("oversized or blocking HTML produces no successful Raw capture", async () => {
  const tooLarge = await new OneEndpointOneRunDetailLiveCanaryTransport(async () => {
    return new Response("", {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_MAX_RESPONSE_BYTES + 1)
      }
    });
  }).execute(request());
  assert.equal(tooLarge.response.status, "FAILED");
  if (tooLarge.response.status === "FAILED") assert.equal(tooLarge.response.error.code, "RESPONSE_SIZE_LIMIT");

  const approval = createBeijingDetailLiveCanaryApproval(now);
  const blocked = await runBeijingDetailLiveCanary(
    approval,
    new OneEndpointOneRunDetailLiveCanaryTransport(async () => {
      return htmlResponse("<html><body><input type=\"password\"><p>验证码</p></body></html>");
    }),
    now
  );
  assert.equal(blocked.raw_blob, null);
  assert.equal(blocked.snapshot.transport_status, "FAILED");
  assert.equal(blocked.transport.access_signals.login_form_observed, true);
  assert.equal(blocked.transport.access_signals.captcha_observed, true);
});

test("P2-04D egress exists only in the explicit one-shot CLI composition", () => {
  const coreSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-04d/beijing-public-institution-detail-live-canary.ts"
  ), "utf8");
  const cliSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-04d/run-beijing-public-institution-detail-live-canary.ts"
  ), "utf8");
  assert.doesNotMatch(coreSource, /from\s+["']node:(?:http|https|net|tls|dns)["']/u);
  assert.doesNotMatch(coreSource, /globalThis\.fetch/u);
  assert.match(cliSource, /globalThis\.fetch\.bind\(globalThis\)/u);
  assert.doesNotMatch(cliSource, /LocalHttpTransport|CollectionRunner|playwright|puppeteer/iu);
});

function request(): HttpTransportRequest {
  return {
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {},
    timeout_ms: BEIJING_PUBLIC_INSTITUTION_DETAIL_CANARY_TIMEOUT_MS
  };
}

function htmlResponse(html: string) {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function monotonicClock() {
  let value = 100;
  return () => value++;
}
