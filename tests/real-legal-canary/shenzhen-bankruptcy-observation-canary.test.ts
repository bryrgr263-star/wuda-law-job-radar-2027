import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HttpTransportRequest } from "../../lib/collection-runtime";
import type { IsoDateTime } from "../../lib/ingestion";
import {
  SHENZHEN_LEGAL_NOTICE_URL,
  SHENZHEN_LEGAL_PDF_URL,
  SHENZHEN_LEGAL_TIMEOUT_MS,
  OneEndpointOneRunShenzhenObservationTransport,
  createShenzhenLegalObservationApproval,
  runShenzhenLegalObservationCanary
} from "../../lib/live-canary/real-legal-canary/shenzhen-bankruptcy-observation-canary";

const now = "2026-09-03T12:00:00.000Z" as IsoDateTime;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("notice and PDF approvals remain separate B + REVIEW observation canaries", () => {
  const notice = createShenzhenLegalObservationApproval("NOTICE", now);
  const pdf = createShenzhenLegalObservationApproval("POSITION_TABLE_PDF", now);

  assert.notEqual(notice.authorization.authorization_id, pdf.authorization.authorization_id);
  assert.notEqual(notice.authorization.collection_run_id, pdf.authorization.collection_run_id);
  assert.notEqual(notice.evidence.evidence_id, pdf.evidence.evidence_id);
  assert.equal(notice.admission.admission_level, "B");
  assert.equal(pdf.admission.admission_level, "B");
  assert.equal(notice.admission.admission_decision, "REVIEW");
  assert.equal(pdf.admission.admission_decision, "REVIEW");
  assert.equal(notice.admission.automation_basis, "INSUFFICIENT_EVIDENCE");
  assert.equal(pdf.admission.automation_basis, "INSUFFICIENT_EVIDENCE");
  assert.equal(notice.authorization.authorization_mode, "OBSERVATION_CANARY");
  assert.equal(pdf.authorization.authorization_mode, "OBSERVATION_CANARY");
  assert.equal(notice.authorization.endpoint_purpose, "RECRUITMENT_NOTICE");
  assert.equal(pdf.authorization.endpoint_purpose, "RECRUITMENT_ATTACHMENT");
  assert.equal(notice.authorization.content_kind, "HTML");
  assert.equal(pdf.authorization.content_kind, "PDF");
  assert.equal(notice.authorization.endpoint, SHENZHEN_LEGAL_NOTICE_URL);
  assert.equal(pdf.authorization.endpoint, SHENZHEN_LEGAL_PDF_URL);
});

test("each fake endpoint performs exactly one credential-free GET and captures distinct evidence", async () => {
  const noticeApproval = createShenzhenLegalObservationApproval("NOTICE", now);
  const pdfApproval = createShenzhenLegalObservationApproval("POSITION_TABLE_PDF", now);
  const observed: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const notice = await runShenzhenLegalObservationCanary(
    noticeApproval,
    new OneEndpointOneRunShenzhenObservationTransport("NOTICE", async (input, init) => {
      observed.push({ input, init });
      return htmlResponse("<!doctype html><html><body><h1>招聘公告</h1></body></html>");
    }, clockOptions()),
    now
  );
  const pdf = await runShenzhenLegalObservationCanary(
    pdfApproval,
    new OneEndpointOneRunShenzhenObservationTransport("POSITION_TABLE_PDF", async (input, init) => {
      observed.push({ input, init });
      return pdfResponse(minimalPdf());
    }, clockOptions()),
    now
  );

  assert.equal(observed.length, 2);
  assert.deepEqual(observed.map((item) => String(item.input)), [
    SHENZHEN_LEGAL_NOTICE_URL,
    SHENZHEN_LEGAL_PDF_URL
  ]);
  for (const item of observed) {
    assert.equal(item.init?.method, "GET");
    assert.equal(item.init?.redirect, "manual");
    assert.equal(item.init?.credentials, "omit");
    assert.equal(new Headers(item.init?.headers).has("cookie"), false);
    assert.equal(new Headers(item.init?.headers).has("authorization"), false);
  }
  assert.ok(notice.raw_blob);
  assert.ok(pdf.raw_blob);
  assert.equal(notice.access_classification, "EVIDENCE_CAPTURED");
  assert.equal(pdf.access_classification, "EVIDENCE_CAPTURED");
  assert.notEqual(notice.raw_blob?.raw_blob_id, pdf.raw_blob?.raw_blob_id);
  assert.notEqual(notice.snapshot.snapshot_id, pdf.snapshot.snapshot_id);
  assert.notEqual(notice.observation_evidence.evidence_id, pdf.observation_evidence.evidence_id);
  assert.equal(notice.approval.admission.admission_decision, "REVIEW");
  assert.equal(pdf.approval.admission.admission_decision, "REVIEW");
  assert.equal(notice.authorization_replay_decision.allowed, false);
  assert.equal(pdf.authorization_replay_decision.allowed, false);
});

test("wrong locator, endpoint, method, headers, or parameters fails before egress", async () => {
  const approval = createShenzhenLegalObservationApproval("NOTICE", now);
  let calls = 0;
  for (const invalidRequest of [
    { ...request(approval), locator: SHENZHEN_LEGAL_PDF_URL },
    {
      ...request(approval),
      recruitment_endpoint_id: createShenzhenLegalObservationApproval(
        "POSITION_TABLE_PDF",
        now
      ).recruitment_endpoint.recruitment_endpoint_id
    },
    { ...request(approval), method: "HEAD" as HttpTransportRequest["method"] },
    { ...request(approval), headers: { cookie: "forbidden" } },
    { ...request(approval), parameters: { page: 2 } }
  ]) {
    const transport = new OneEndpointOneRunShenzhenObservationTransport(
      "NOTICE",
      async () => {
        calls += 1;
        return htmlResponse("<html><body>unexpected</body></html>");
      }
    );
    await assert.rejects(
      transport.execute(invalidRequest),
      /not authorized|exact authorized URL|GET only|headers or parameters/u
    );
  }
  assert.equal(calls, 0);
});

test("redirect is not followed and consumes the one-shot transport", async () => {
  const approval = createShenzhenLegalObservationApproval("NOTICE", now);
  let calls = 0;
  const transport = new OneEndpointOneRunShenzhenObservationTransport(
    "NOTICE",
    async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "https://sf.sz.gov.cn/other" }
      });
    },
    clockOptions()
  );
  const result = await transport.execute(request(approval));
  assert.equal(result.response.status, "FAILED");
  assert.deepEqual(result.redirect_chain, [{
    status: 302,
    location: "https://sf.sz.gov.cn/other"
  }]);
  await assert.rejects(transport.execute(request(approval)), /already consumed/u);
  assert.equal(calls, 1);
});

test("HTML/PDF type anomalies and blocking content cannot produce Raw evidence", async () => {
  const cases = [
    {
      kind: "NOTICE" as const,
      response: () => new Response(minimalPdf(), {
        status: 200,
        headers: { "content-type": "application/pdf" }
      })
    },
    {
      kind: "NOTICE" as const,
      response: () => htmlResponse("<html><input type='password'>验证码</html>")
    },
    {
      kind: "POSITION_TABLE_PDF" as const,
      response: () => htmlResponse("<html><body>error</body></html>")
    },
    {
      kind: "POSITION_TABLE_PDF" as const,
      response: () => new Response(new TextEncoder().encode("not a PDF"), {
        status: 200,
        headers: { "content-type": "application/pdf" }
      })
    }
  ];

  for (const item of cases) {
    const approval = createShenzhenLegalObservationApproval(item.kind, now);
    const result = await runShenzhenLegalObservationCanary(
      approval,
      new OneEndpointOneRunShenzhenObservationTransport(
        item.kind,
        async () => item.response(),
        clockOptions()
      ),
      now
    );
    assert.equal(result.raw_blob, null);
    assert.equal(result.access_classification, "REVIEW_REQUIRED");
  }
});

test("live canary module contains no scheduler, candidate, eligibility, or discovery path", () => {
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/real-legal-canary/shenzhen-bankruptcy-observation-canary.ts"
  ), "utf8");
  const runner = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/real-legal-canary/run-shenzhen-bankruptcy-observation-canary.ts"
  ), "utf8");

  assert.doesNotMatch(source, /Scheduler|CandidateProfile|Eligibility|CanonicalOpportunity/u);
  assert.doesNotMatch(source, /crawler|cron\/sync|app\/api\/jobs/iu);
  assert.doesNotMatch(source, /globalThis\.fetch/u);
  assert.match(runner, /globalThis\.fetch\.bind\(globalThis\)/u);
  assert.doesNotMatch(runner, /retry|follow\s*redirect|Scheduler|CandidateProfile|Eligibility/iu);
});

function request(
  approval: ReturnType<typeof createShenzhenLegalObservationApproval>
): HttpTransportRequest {
  return {
    recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
    locator: approval.recruitment_endpoint.locator,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {},
    timeout_ms: SHENZHEN_LEGAL_TIMEOUT_MS
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

function pdfResponse(bytes: Uint8Array) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(bytes.byteLength)
    }
  });
}

function minimalPdf() {
  return new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
  );
}

function clockOptions() {
  let tick = 100;
  return {
    now: () => now,
    monotonic_now: () => tick++
  };
}
