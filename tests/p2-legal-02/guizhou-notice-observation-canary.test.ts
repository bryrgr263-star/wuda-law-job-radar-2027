import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HttpTransportRequest } from "../../lib/collection-runtime";
import type { IsoDateTime } from "../../lib/ingestion";
import {
  GUIZHOU_NOTICE_OBSERVATION_TIMEOUT_MS,
  OneEndpointOneRunGuizhouNoticeTransport,
  createGuizhouNoticeObservationApproval,
  discoverGuizhouAttachmentLocators,
  runGuizhouNoticeObservationCanary
} from "../../lib/live-canary/p2-legal-02/guizhou-notice-observation-canary";
import {
  GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_NOTICE_URL
} from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";

const now = "2026-09-04T12:00:00.000Z" as IsoDateTime;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("approval is an exact B REVIEW observation canary", () => {
  const approval = createGuizhouNoticeObservationApproval(now);
  assert.equal(approval.admission.admission_level, "B");
  assert.equal(approval.admission.admission_decision, "REVIEW");
  assert.equal(approval.admission.automation_basis, "INSUFFICIENT_EVIDENCE");
  assert.equal(approval.authorization.authorization_mode, "OBSERVATION_CANARY");
  assert.equal(approval.authorization.authorization_purpose, "OBSERVE_ACCESS_PROPERTIES");
  assert.equal(approval.authorization.endpoint, GUIZHOU_LEGAL_CANARY_NOTICE_URL);
  assert.equal(approval.authorization.endpoint_purpose, "RECRUITMENT_NOTICE");
  assert.equal(approval.authorization.allowed_http_method, "GET");
  assert.equal(approval.authorization.content_kind, "HTML");
  assert.equal(approval.authorization.scope, "ONE_ENDPOINT_ONE_RUN");
  assert.equal(approval.authorization.manual_confirmation, true);
  assert.equal(approval.authorization_decision.allowed, true);
});

test("successful fake response performs one credential-free GET and captures Raw/Snapshot", async () => {
  const approval = createGuizhouNoticeObservationApproval(now);
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const body = "<!doctype html><html><body><h1>公开招聘公告</h1></body></html>";
  const result = await runGuizhouNoticeObservationCanary(
    approval,
    new OneEndpointOneRunGuizhouNoticeTransport(async (input, init) => {
      calls.push({ input, init });
      return htmlResponse(body);
    }, clockOptions()),
    now
  );

  assert.equal(calls.length, 1);
  assert.equal(String(calls[0]?.input), GUIZHOU_LEGAL_CANARY_NOTICE_URL);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.equal(calls[0]?.init?.credentials, "omit");
  assert.equal(new Headers(calls[0]?.init?.headers).has("cookie"), false);
  assert.equal(new Headers(calls[0]?.init?.headers).has("authorization"), false);
  assert.ok(result.raw_blob);
  assert.equal(result.snapshot.transport_status, "SUCCESS");
  assert.equal(result.access_classification, "EVIDENCE_CAPTURED");
  assert.equal(result.approval.admission.admission_decision, "REVIEW");
  assert.equal(result.authorization_replay_decision.allowed, false);
});

test("wrong endpoint, locator, method, headers, or parameters fail before egress", async () => {
  const approval = createGuizhouNoticeObservationApproval(now);
  let calls = 0;
  for (const invalidRequest of [
    { ...request(approval), recruitment_endpoint_id: "other-endpoint" as typeof GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT_ID },
    { ...request(approval), locator: "https://rst.guizhou.gov.cn/other.html" },
    { ...request(approval), method: "HEAD" as HttpTransportRequest["method"] },
    { ...request(approval), headers: { cookie: "forbidden" } },
    { ...request(approval), parameters: { page: 2 } }
  ]) {
    const transport = new OneEndpointOneRunGuizhouNoticeTransport(async () => {
      calls += 1;
      return htmlResponse("<html><body>unexpected</body></html>");
    });
    await assert.rejects(
      transport.execute(invalidRequest),
      /not authorized|exact authorized URL|GET only|headers or parameters/u
    );
  }
  assert.equal(calls, 0);
});

test("redirect is not followed and consumes the one-shot transport", async () => {
  const approval = createGuizhouNoticeObservationApproval(now);
  let calls = 0;
  const transport = new OneEndpointOneRunGuizhouNoticeTransport(async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://rst.guizhou.gov.cn/other.html" }
    });
  }, clockOptions());
  const result = await transport.execute(request(approval));
  assert.equal(result.response.status, "FAILED");
  assert.equal(result.response.error.code, "REDIRECT_OBSERVED");
  assert.deepEqual(result.redirect_chain, [{
    status: 302,
    location: "https://rst.guizhou.gov.cn/other.html"
  }]);
  await assert.rejects(transport.execute(request(approval)), /already consumed/u);
  assert.equal(calls, 1);
});

test("access blockers and MIME anomalies do not produce Raw evidence", async () => {
  const cases = [
    () => new Response(new TextEncoder().encode("%PDF"), {
      status: 200,
      headers: { "content-type": "application/pdf" }
    }),
    () => htmlResponse("<html><body><input type='password'>请先登录</body></html>"),
    () => htmlResponse("<html><body>验证码 安全验证</body></html>")
  ];
  for (const response of cases) {
    const approval = createGuizhouNoticeObservationApproval(now);
    const result = await runGuizhouNoticeObservationCanary(
      approval,
      new OneEndpointOneRunGuizhouNoticeTransport(async () => response(), clockOptions()),
      now
    );
    assert.equal(result.raw_blob, null);
    assert.equal(result.access_classification, "REVIEW_REQUIRED");
  }
});

test("attachment locator discovery is offline, exact, and limited to attachment 1 XLSX", () => {
  const bytes = new TextEncoder().encode(`
    <html><body>
      <a href="./W020250210-job-table.xlsx">附件1：贵州省司法厅所属事业单位2025年公开招聘工作人员岗位一览表</a>
      <a href="./other.xlsx">无关表格</a>
      <a href="./notice.docx">附件2：其他材料</a>
    </body></html>
  `);
  const locators = discoverGuizhouAttachmentLocators(
    bytes,
    "text/html; charset=utf-8",
    "snapshot-test" as Parameters<typeof discoverGuizhouAttachmentLocators>[2],
    "sha256:test" as Parameters<typeof discoverGuizhouAttachmentLocators>[3]
  );
  assert.deepEqual(locators.map((item) => item.exact_locator), [
    "https://rst.guizhou.gov.cn/zwgk/zdlyxx/sydwgkzp/202502/W020250210-job-table.xlsx"
  ]);
  assert.equal(locators[0]?.requested, false);
  assert.equal(locators[0]?.same_origin_as_notice, true);
});

test("module and runner contain no scheduler or downstream business execution", () => {
  const moduleSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-02/guizhou-notice-observation-canary.ts"
  ), "utf8");
  const runnerSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-02/run-guizhou-notice-observation-canary.ts"
  ), "utf8");
  assert.doesNotMatch(moduleSource, /Scheduler|RequirementFact|RequirementSet|Eligibility|CanonicalOpportunity/u);
  assert.doesNotMatch(moduleSource, /crawler|cron\/sync|app\/api\/jobs/iu);
  assert.doesNotMatch(moduleSource, /globalThis\.fetch/u);
  assert.match(runnerSource, /globalThis\.fetch\.bind\(globalThis\)/u);
  assert.doesNotMatch(runnerSource, /retry|Scheduler|RequirementFact|Eligibility|CanonicalOpportunity/iu);
});

function request(
  approval: ReturnType<typeof createGuizhouNoticeObservationApproval>
): HttpTransportRequest {
  return {
    recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
    locator: approval.recruitment_endpoint.locator,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {},
    timeout_ms: GUIZHOU_NOTICE_OBSERVATION_TIMEOUT_MS
  };
}

function htmlResponse(body: string) {
  const bytes = new TextEncoder().encode(body);
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(bytes.byteLength)
    }
  });
}

function clockOptions() {
  let tick = 100;
  return {
    now: () => now,
    monotonic_now: () => tick++
  };
}
