import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HttpTransportRequest } from "../../lib/collection-runtime";
import type { IsoDateTime } from "../../lib/ingestion";
import {
  GUIZHOU_ATTACHMENT_EXPECTED_MIME,
  GUIZHOU_ATTACHMENT_OBSERVATION_TIMEOUT_MS,
  OneEndpointOneRunGuizhouAttachmentTransport,
  createGuizhouAttachmentObservationApproval,
  inspectGuizhouXlsxSafety,
  runGuizhouAttachmentObservationCanary
} from "../../lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary";
import {
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID,
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL
} from "../../lib/live-canary/p2-legal-03/guizhou-attachment-admission-preflight";

const now = "2026-09-04T12:00:00.000Z" as IsoDateTime;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("approval is an exact independent B REVIEW attachment observation canary", () => {
  const approval = createGuizhouAttachmentObservationApproval(now);
  assert.equal(approval.admission.admission_level, "B");
  assert.equal(approval.admission.admission_decision, "REVIEW");
  assert.equal(approval.admission.automation_basis, "INSUFFICIENT_EVIDENCE");
  assert.equal(approval.authorization.authorization_mode, "OBSERVATION_CANARY");
  assert.equal(approval.authorization.authorization_purpose, "OBSERVE_ACCESS_PROPERTIES");
  assert.equal(approval.authorization.endpoint, GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL);
  assert.equal(approval.authorization.endpoint_purpose, "RECRUITMENT_ATTACHMENT");
  assert.equal(approval.authorization.allowed_http_method, "GET");
  assert.equal(approval.authorization.content_kind, "FILE");
  assert.equal(approval.authorization.scope, "ONE_ENDPOINT_ONE_RUN");
  assert.equal(approval.authorization.manual_confirmation, true);
  assert.equal(approval.authorization_decision.allowed, true);
});

test("safe fake XLSX performs one credential-free GET and captures independent evidence", async () => {
  const approval = createGuizhouAttachmentObservationApproval(now);
  const bytes = safeOoxmlArchive();
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const result = await runGuizhouAttachmentObservationCanary(
    approval,
    new OneEndpointOneRunGuizhouAttachmentTransport(async (input, init) => {
      calls.push({ input, init });
      return xlsxResponse(bytes);
    }, clockOptions()),
    now
  );

  assert.equal(calls.length, 1);
  assert.equal(String(calls[0]?.input), GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.equal(calls[0]?.init?.credentials, "omit");
  assert.equal(new Headers(calls[0]?.init?.headers).has("cookie"), false);
  assert.equal(new Headers(calls[0]?.init?.headers).has("authorization"), false);
  assert.ok(result.raw_blob);
  assert.equal(result.snapshot.transport_status, "SUCCESS");
  assert.equal(result.file_safety?.classification, "PASS");
  assert.equal(result.file_safety?.actual_file_type, "XLSX_OFFICE_OPEN_XML");
  assert.equal(result.access_classification, "EVIDENCE_CAPTURED");
  assert.equal(result.offline_parsing_allowed, true);
  assert.equal(result.approval.admission.admission_decision, "REVIEW");
  assert.equal(result.authorization_replay_decision.allowed, false);
});

test("wrong endpoint, locator, method, headers, or parameters fail before egress", async () => {
  const approval = createGuizhouAttachmentObservationApproval(now);
  let calls = 0;
  for (const invalidRequest of [
    { ...request(approval), recruitment_endpoint_id: "other-endpoint" as typeof GUIZHOU_LEGAL_CANARY_ATTACHMENT_ENDPOINT_ID },
    { ...request(approval), locator: "https://rst.guizhou.gov.cn/other.xlsx" },
    { ...request(approval), method: "HEAD" as HttpTransportRequest["method"] },
    { ...request(approval), headers: { cookie: "forbidden" } },
    { ...request(approval), parameters: { page: 2 } }
  ]) {
    const transport = new OneEndpointOneRunGuizhouAttachmentTransport(async () => {
      calls += 1;
      return xlsxResponse(safeOoxmlArchive());
    });
    await assert.rejects(
      transport.execute(invalidRequest),
      /not authorized|exact authorized URL|GET only|headers or parameters/u
    );
  }
  assert.equal(calls, 0);
});

test("redirect is not followed and consumes the one-shot transport", async () => {
  const approval = createGuizhouAttachmentObservationApproval(now);
  let calls = 0;
  const transport = new OneEndpointOneRunGuizhouAttachmentTransport(async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://rst.guizhou.gov.cn/other.xlsx" }
    });
  }, clockOptions());
  const result = await transport.execute(request(approval));
  assert.equal(result.response.status, "FAILED");
  assert.equal(result.response.error.code, "REDIRECT_OBSERVED");
  await assert.rejects(transport.execute(request(approval)), /already consumed/u);
  assert.equal(calls, 1);
});

test("MIME conflict and HTML access blockers do not create Raw", async () => {
  const cases = [
    () => new Response(safeOoxmlArchive(), {
      status: 200,
      headers: { "content-type": "application/octet-stream" }
    }),
    () => htmlResponse("<html><body><input type='password'>请先登录</body></html>"),
    () => htmlResponse("<html><body>验证码 安全验证</body></html>")
  ];
  for (const response of cases) {
    const approval = createGuizhouAttachmentObservationApproval(now);
    const result = await runGuizhouAttachmentObservationCanary(
      approval,
      new OneEndpointOneRunGuizhouAttachmentTransport(async () => response(), clockOptions()),
      now
    );
    assert.equal(result.raw_blob, null);
    assert.equal(result.access_classification, "REVIEW_REQUIRED");
    assert.equal(result.offline_parsing_allowed, false);
  }
});

test("invalid OOXML and nested archives require review without business parsing", async () => {
  const invalid = new TextEncoder().encode("not an OOXML container");
  const invalidResult = inspectGuizhouXlsxSafety(
    invalid,
    GUIZHOU_ATTACHMENT_EXPECTED_MIME,
    GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    invalid.byteLength
  );
  assert.equal(invalidResult.classification, "REVIEW_REQUIRED");
  assert.equal(invalidResult.actual_file_type, "UNKNOWN");

  const nested = zipArchive([
    ...requiredEntries(),
    { name: "xl/embeddings/archive.zip", content: "nested" }
  ]);
  const nestedResult = inspectGuizhouXlsxSafety(
    nested,
    GUIZHOU_ATTACHMENT_EXPECTED_MIME,
    GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    nested.byteLength
  );
  assert.equal(nestedResult.classification, "REVIEW_REQUIRED");
  assert.equal(nestedResult.checks.nested_archive_absent, false);
  assert.equal(nestedResult.checks.embedded_object_absent, false);
});

test("module and runner contain no announcement, parser, or downstream business execution", () => {
  const moduleSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary.ts"
  ), "utf8");
  const runnerSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-04/run-guizhou-attachment-observation-canary.ts"
  ), "utf8");
  assert.doesNotMatch(moduleSource, /RequirementFact|RequirementSet|Eligibility|CandidateProfile|CanonicalOpportunity/u);
  assert.doesNotMatch(moduleSource, /parseWorkbook|readWorkbook|worksheet|cell\b/iu);
  assert.doesNotMatch(moduleSource, /globalThis\.fetch/u);
  assert.match(runnerSource, /globalThis\.fetch\.bind\(globalThis\)/u);
  assert.doesNotMatch(runnerSource, /retry|RequirementFact|Eligibility|CanonicalOpportunity/iu);
});

function request(
  approval: ReturnType<typeof createGuizhouAttachmentObservationApproval>
): HttpTransportRequest {
  return {
    recruitment_endpoint_id: approval.recruitment_endpoint.recruitment_endpoint_id,
    locator: approval.recruitment_endpoint.locator,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {},
    timeout_ms: GUIZHOU_ATTACHMENT_OBSERVATION_TIMEOUT_MS
  };
}

function xlsxResponse(bytes: Uint8Array) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": GUIZHOU_ATTACHMENT_EXPECTED_MIME,
      "content-length": String(bytes.byteLength)
    }
  });
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

function safeOoxmlArchive() {
  return zipArchive(requiredEntries());
}

function requiredEntries(): readonly ZipInput[] {
  return [{
    name: "[Content_Types].xml",
    content:
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/></Types>"
  }, {
    name: "xl/workbook.xml",
    content:
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"/>"
  }];
}

interface ZipInput {
  readonly name: string;
  readonly content: string;
}

function zipArchive(entries: readonly ZipInput[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.content);
    const local = new Uint8Array(30 + name.byteLength + content.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, content.byteLength, true);
    localView.setUint32(22, content.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(content, 30 + name.byteLength);
    localParts.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(20, content.byteLength, true);
    centralView.setUint32(24, content.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.byteLength;
  }
  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return concatenate([...localParts, ...centralParts, end]);
}

function concatenate(parts: readonly Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function clockOptions() {
  let tick = 100;
  return {
    now: () => now,
    monotonic_now: () => tick++
  };
}
