import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HttpTransportRequest } from "../../lib/collection-runtime";
import type { IsoDateTime } from "../../lib/ingestion";
import {
  BEIJING_ATTACHMENT_ENDPOINT,
  BEIJING_ATTACHMENT_EXPECTED_MIME,
  BEIJING_ATTACHMENT_OBSERVATION_TIMEOUT_MS,
  BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
  OneEndpointOneRunAttachmentObservationTransport,
  createBeijingAttachmentObservationApproval,
  inspectXlsxContainer,
  runBeijingAttachmentObservationCanary
} from "../../lib/live-canary/p2-04e/beijing-public-institution-attachment-observation-canary";

const now = "2026-09-03T08:00:00.000Z" as IsoDateTime;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("manual approval is exactly bound to one attachment observation run", () => {
  const approval = createBeijingAttachmentObservationApproval(now);
  assert.equal(approval.admission.admission_level, "B");
  assert.equal(approval.admission.admission_decision, "REVIEW");
  assert.equal(approval.admission.automation_basis, "INSUFFICIENT_EVIDENCE");
  assert.equal(approval.admission.login_requirement, "UNKNOWN");
  assert.equal(approval.admission.captcha, "UNKNOWN");
  assert.equal(approval.authorization.authorization_mode, "OBSERVATION_CANARY");
  assert.equal(approval.authorization.authorization_purpose, "OBSERVE_ACCESS_PROPERTIES");
  assert.equal(approval.authorization.endpoint, BEIJING_ATTACHMENT_ENDPOINT);
  assert.equal(
    approval.authorization.recruitment_endpoint_id,
    BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID
  );
  assert.equal(approval.authorization.endpoint_purpose, "RECRUITMENT_ATTACHMENT");
  assert.equal(approval.authorization.allowed_http_method, "GET");
  assert.equal(approval.authorization.content_kind, "FILE");
  assert.equal(approval.authorization.scope, "ONE_ENDPOINT_ONE_RUN");
  assert.equal(approval.authorization.manual_confirmation, true);
  assert.equal(approval.authorization.collection_run_id, approval.execution.collection_run_id);
  assert.equal(approval.authorization_decision.allowed, true);
});

test("one fake GET captures Raw and Snapshot without upgrading Admission", async () => {
  const bytes = safeOoxmlArchive();
  let calls = 0;
  let observedInput: string | URL | Request | undefined;
  let observedInit: RequestInit | undefined;
  const approval = createBeijingAttachmentObservationApproval(now);
  const result = await runBeijingAttachmentObservationCanary(
    approval,
    new OneEndpointOneRunAttachmentObservationTransport(async (input, init) => {
      calls += 1;
      observedInput = input;
      observedInit = init;
      return xlsxResponse(bytes);
    }, { now: () => now, monotonic_now: monotonicClock() }),
    now
  );

  assert.equal(calls, 1);
  assert.equal(observedInput, BEIJING_ATTACHMENT_ENDPOINT);
  assert.equal(observedInit?.method, "GET");
  assert.equal(observedInit?.redirect, "manual");
  assert.equal(observedInit?.credentials, "omit");
  assert.equal(new Headers(observedInit?.headers).has("cookie"), false);
  assert.equal(new Headers(observedInit?.headers).has("authorization"), false);
  assert.ok(result.raw_blob);
  assert.equal(result.snapshot.transport_status, "SUCCESS");
  assert.equal(result.snapshot.raw_blob_id, result.raw_blob?.raw_blob_id);
  assert.equal(result.file_safety?.classification, "PASS");
  assert.equal(result.access_classification, "EVIDENCE_CAPTURED");
  assert.equal(result.approval.admission.admission_decision, "REVIEW");
  assert.equal(result.transport.access_signals.login, "NONE_OBSERVED");
  assert.equal(result.transport.access_signals.captcha, "NONE_OBSERVED");
  assert.equal(result.transport.access_signals.anti_bot, "NONE_OBSERVED");
  assert.equal(result.transport.access_signals.request_cookie_sent, false);
  assert.equal(result.transport.access_signals.request_authorization_sent, false);
  assert.equal(result.authorization_replay_decision.allowed, false);
  if (!result.authorization_replay_decision.allowed) {
    assert.deepEqual(result.authorization_replay_decision.reason_codes, [
      "AUTHORIZATION_ALREADY_USED"
    ]);
  }
});

test("wrong URL, endpoint ID, method, headers, and parameters fail before egress", async () => {
  let calls = 0;
  for (const invalidRequest of [
    { ...request(), locator: "https://www.beijing.gov.cn/other.xlsx" },
    {
      ...request(),
      recruitment_endpoint_id:
        "endpoint-cn-beijing-government-public-institution-job-detail-html" as
          HttpTransportRequest["recruitment_endpoint_id"]
    },
    { ...request(), method: "HEAD" as HttpTransportRequest["method"] },
    { ...request(), headers: { cookie: "forbidden" } },
    { ...request(), parameters: { page: 2 } }
  ]) {
    const transport = new OneEndpointOneRunAttachmentObservationTransport(async () => {
      calls += 1;
      return xlsxResponse(safeOoxmlArchive());
    });
    await assert.rejects(
      transport.execute(invalidRequest),
      /not authorized|exact authorized URL|GET only|forbids caller headers/u
    );
  }
  assert.equal(calls, 0);
});

test("redirect is recorded, never followed, and consumes the transport", async () => {
  let calls = 0;
  const transport = new OneEndpointOneRunAttachmentObservationTransport(async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://www.beijing.gov.cn/other.xlsx" }
    });
  }, { now: () => now, monotonic_now: monotonicClock() });
  const result = await transport.execute(request());
  assert.equal(calls, 1);
  assert.equal(result.response.status, "FAILED");
  assert.deepEqual(result.redirect_chain, [{
    status: 302,
    location: "https://www.beijing.gov.cn/other.xlsx"
  }]);
  await assert.rejects(transport.execute(request()), /already consumed/u);
  assert.equal(calls, 1);
});

test("HTML and wrong MIME responses cannot produce Raw evidence", async () => {
  for (const response of [
    new Response("<!doctype html><html><body>登录 验证码</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    }),
    new Response(safeOoxmlArchive(), {
      status: 200,
      headers: { "content-type": "application/octet-stream" }
    })
  ]) {
    const result = await runBeijingAttachmentObservationCanary(
      createBeijingAttachmentObservationApproval(now),
      new OneEndpointOneRunAttachmentObservationTransport(
        async () => response,
        { now: () => now, monotonic_now: monotonicClock() }
      ),
      now
    );
    assert.equal(result.raw_blob, null);
    assert.equal(result.snapshot.transport_status, "FAILED");
    assert.equal(result.access_classification, "REVIEW_REQUIRED");
  }
});

test("safe in-memory OOXML passes container checks", () => {
  const bytes = safeOoxmlArchive();
  const result = inspectXlsxContainer(
    bytes,
    BEIJING_ATTACHMENT_EXPECTED_MIME,
    BEIJING_ATTACHMENT_ENDPOINT,
    bytes.byteLength
  );
  assert.equal(result.classification, "PASS");
  assert.equal(result.checks.required_ooxml_entries_present, true);
  assert.equal(result.checks.path_traversal_absent, true);
  assert.equal(result.checks.nested_archive_absent, true);
  assert.equal(result.checks.encrypted_workbook_absent, true);
  assert.equal(result.checks.vba_ole_embedded_absent, true);
  assert.equal(result.checks.external_workbook_relationship_absent, true);
});

test("unsafe ZIP paths and external workbook relationships require review", () => {
  const traversal = zipArchive([
    ...requiredEntries(),
    { name: "../outside.bin", content: "blocked" }
  ]);
  const traversalResult = inspectXlsxContainer(
    traversal,
    BEIJING_ATTACHMENT_EXPECTED_MIME,
    BEIJING_ATTACHMENT_ENDPOINT,
    traversal.byteLength
  );
  assert.equal(traversalResult.classification, "REVIEW_REQUIRED");
  assert.equal(traversalResult.checks.path_traversal_absent, false);

  const external = zipArchive([
    ...requiredEntries(),
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        "<Relationships><Relationship Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink\" Target=\"externalLinks/externalLink1.xml\"/></Relationships>"
    }
  ]);
  const externalResult = inspectXlsxContainer(
    external,
    BEIJING_ATTACHMENT_EXPECTED_MIME,
    BEIJING_ATTACHMENT_ENDPOINT,
    external.byteLength
  );
  assert.equal(externalResult.classification, "REVIEW_REQUIRED");
  assert.equal(externalResult.checks.external_workbook_relationship_absent, false);
});

test("P2-04E business parsing is absent and egress exists only in one-shot CLI", () => {
  const coreSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-04e/beijing-public-institution-attachment-observation-canary.ts"
  ), "utf8");
  const cliSource = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-04e/run-beijing-public-institution-attachment-observation-canary.ts"
  ), "utf8");
  assert.doesNotMatch(coreSource, /globalThis\.fetch/u);
  assert.doesNotMatch(coreSource, /from\s+["'][^"']*\/(?:requirements|eligibility|canonicalization)[^"']*["']/u);
  assert.doesNotMatch(coreSource, /(?:worksheet|sheetData|sharedStrings|cell value)/iu);
  assert.match(cliSource, /globalThis\.fetch\.bind\(globalThis\)/u);
  assert.doesNotMatch(cliSource, /LocalHttpTransport|CollectionRunner|Scheduler|playwright|puppeteer/iu);
});

function request(): HttpTransportRequest {
  return {
    recruitment_endpoint_id: BEIJING_ATTACHMENT_RECRUITMENT_ENDPOINT_ID,
    locator: BEIJING_ATTACHMENT_ENDPOINT,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {},
    timeout_ms: BEIJING_ATTACHMENT_OBSERVATION_TIMEOUT_MS
  };
}

function xlsxResponse(bytes: Uint8Array) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": BEIJING_ATTACHMENT_EXPECTED_MIME,
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
  readonly flags?: number;
}

function zipArchive(entries: readonly ZipInput[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.content);
    const flags = entry.flags ?? 0;
    const local = new Uint8Array(30 + name.byteLength + content.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
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
    centralView.setUint16(8, flags, true);
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

function monotonicClock() {
  let value = 100;
  return () => value++;
}
