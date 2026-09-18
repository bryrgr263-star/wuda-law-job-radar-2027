import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HttpTransportRequest } from "../../lib/collection-runtime";
import type { IsoDateTime } from "../../lib/ingestion";
import {
  BEIJING_FIRST_CANARY_MAX_RESPONSE_BYTES,
  BEIJING_FIRST_CANARY_REVIEWER,
  BEIJING_FIRST_CANARY_TIMEOUT_MS,
  OneEndpointOneRunLiveCanaryTransport,
  createBeijingLiveCanaryApproval,
  runFirstBeijingLiveCanary
} from "../../lib/live-canary/p2-04/beijing-first-live-canary";
import {
  BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID
} from "../../lib/live-canary/p2-04/beijing-canary-authorization-preparation";

const now = "2026-09-02T12:00:00.000Z" as IsoDateTime;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("human approval produces a valid Level B one-endpoint one-run authorization", () => {
  const approval = createBeijingLiveCanaryApproval(now);
  assert.equal(approval.initial_admission.admission_decision, "REVIEW");
  assert.equal(approval.approved_admission.admission_level, "B");
  assert.equal(approval.approved_admission.admission_decision, "APPROVED");
  assert.equal(approval.approved_admission.automation_basis, "HUMAN_REVIEWED_CANARY");
  assert.equal(approval.approved_admission.terms.status, "UNKNOWN");
  assert.equal(approval.authorization.scope, "ONE_ENDPOINT_ONE_RUN");
  assert.equal(approval.authorization.manual_confirmation, true);
  assert.equal(approval.authorization.reviewer, BEIJING_FIRST_CANARY_REVIEWER);
  assert.equal(approval.authorization_decision.allowed, true);
  assert.equal(approval.evidence.evidence_type, "HUMAN_REVIEWED_CANARY");
  assert.equal(approval.evidence.decision, "APPROVED_FOR_ONE_ENDPOINT_ONE_RUN");
});

test("one controlled GET produces Raw and Snapshot without Adapter execution", async () => {
  let calls = 0;
  let observedInit: RequestInit | undefined;
  const fetchImplementation = async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    observedInit = init;
    return htmlResponse(`<!doctype html><html lang="zh-CN"><head><title>北京市事业单位招聘</title></head><body><ul class="jobs"><li><a href="/notice/1.html">招聘公告</a><span>2026-09-01</span></li><li><a href="/notice/2.html">岗位公告</a><span>2026-09-02</span></li></ul></body></html>`);
  };
  const approval = createBeijingLiveCanaryApproval(now);
  const result = await runFirstBeijingLiveCanary(
    approval,
    new OneEndpointOneRunLiveCanaryTransport(fetchImplementation, { now: () => now }),
    now
  );

  assert.equal(calls, 1);
  assert.equal(observedInit?.method, "GET");
  assert.equal(observedInit?.redirect, "manual");
  assert.equal(observedInit?.credentials, "omit");
  assert.equal(result.transport.request_count, 1);
  assert.equal(result.transport.response.status, "SUCCESS");
  assert.ok(result.raw_blob);
  assert.equal(result.snapshot.transport_status, "SUCCESS");
  assert.equal(result.snapshot.raw_blob_id, result.raw_blob.raw_blob_id);
  assert.equal(result.html_diagnostic?.page_title, "北京市事业单位招聘");
  assert.equal(result.html_diagnostic?.list_like_containers.length, 1);
  assert.equal(result.html_diagnostic?.recruitment_link_samples.length, 2);
  assert.equal(result.authorization_replay_decision.allowed, false);
  if (!result.authorization_replay_decision.allowed) {
    assert.deepEqual(result.authorization_replay_decision.reason_codes, [
      "AUTHORIZATION_ALREADY_USED"
    ]);
  }
});

test("redirect is reported and never followed", async () => {
  let calls = 0;
  const transport = new OneEndpointOneRunLiveCanaryTransport(async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://other.example.invalid/" }
    });
  }, { now: () => now });
  const result = await transport.execute(request());
  assert.equal(calls, 1);
  assert.equal(result.response.status, "FAILED");
  if (result.response.status === "FAILED") {
    assert.equal(result.response.error.code, "UNAUTHORIZED_REDIRECT");
  }
  assert.equal(result.redirect_location, "https://other.example.invalid/");
});

test("wrong Endpoint is rejected before egress", async () => {
  let calls = 0;
  const transport = new OneEndpointOneRunLiveCanaryTransport(async () => {
    calls += 1;
    return htmlResponse("<html></html>");
  });
  await assert.rejects(
    transport.execute({ ...request(), locator: "https://example.invalid/" }),
    /exact authorized Endpoint/
  );
  assert.equal(calls, 0);
});

test("transport cannot issue a second request", async () => {
  let calls = 0;
  const transport = new OneEndpointOneRunLiveCanaryTransport(async () => {
    calls += 1;
    return htmlResponse("<html><head><title>one</title></head></html>");
  }, { now: () => now });
  assert.equal((await transport.execute(request())).response.status, "SUCCESS");
  await assert.rejects(transport.execute(request()), /already been consumed/);
  assert.equal(calls, 1);
});

test("declared oversized response is rejected without Raw success", async () => {
  const transport = new OneEndpointOneRunLiveCanaryTransport(async () => {
    return new Response("", {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(BEIJING_FIRST_CANARY_MAX_RESPONSE_BYTES + 1)
      }
    });
  }, { now: () => now });
  const result = await transport.execute(request());
  assert.equal(result.response.status, "FAILED");
  if (result.response.status === "FAILED") {
    assert.equal(result.response.error.code, "RESPONSE_SIZE_LIMIT");
  }
});

test("P2-04 egress exists only in the explicit one-shot CLI composition", () => {
  const coreSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-04/beijing-first-live-canary.ts"
  ), "utf8");
  const cliSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-04/run-beijing-first-live-canary.ts"
  ), "utf8");
  assert.doesNotMatch(coreSource, /from\s+["']node:(?:http|https|net|tls|dns)["']/u);
  assert.doesNotMatch(coreSource, /globalThis\.fetch/u);
  assert.match(cliSource, /globalThis\.fetch\.bind\(globalThis\)/u);
  assert.doesNotMatch(cliSource, /LocalHttpTransport|CollectionRunner|playwright|puppeteer/iu);
});

function request(): HttpTransportRequest {
  return {
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    locator: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_ENDPOINT,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {},
    timeout_ms: BEIJING_FIRST_CANARY_TIMEOUT_MS
  };
}

function htmlResponse(html: string) {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
