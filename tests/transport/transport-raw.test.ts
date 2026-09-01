import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FixtureTransport,
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  RawCaptureService,
  type IsoDateTime,
  type RawBlob,
  type RawContentSha256,
  type RecruitmentEndpointId,
  type SnapshotId,
  type SuccessfulTransportResponse,
  type TransportRequest
} from "../../lib/ingestion";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "fixtures", "transport");
const fixtureBytes = {
  html: new Uint8Array(readFileSync(path.join(fixtureRoot, "official-recruitment.html"))),
  json: new Uint8Array(readFileSync(path.join(fixtureRoot, "third-party-recruitment.json"))),
  pdf: new Uint8Array(readFileSync(path.join(fixtureRoot, "government-notice.pdf")))
};

function branded<Value extends string>(value: string) {
  return value as Value;
}

const endpointId = branded<RecruitmentEndpointId>("endpoint-fixture-transport");
const requestedAt = branded<IsoDateTime>("2026-09-01T09:00:00+08:00");
const respondedAt = branded<IsoDateTime>("2026-09-01T09:00:01+08:00");

const locators = {
  html: "fixture://transport/official-recruitment.html",
  json: "fixture://transport/third-party-recruitment.json",
  pdf: "fixture://transport/government-notice.pdf",
  file: "fixture://transport/generic-file"
};

function transport() {
  return new FixtureTransport([
    {
      locator: locators.html,
      bytes: fixtureBytes.html,
      mime_type: "text/html; charset=utf-8",
      headers: { "content-language": "zh-CN", "x-fixture-type": "official-html" }
    },
    {
      locator: locators.json,
      bytes: fixtureBytes.json,
      mime_type: "application/json; charset=utf-8",
      headers: { "content-language": "zh-CN", "x-fixture-type": "third-party-json" }
    },
    {
      locator: locators.pdf,
      bytes: fixtureBytes.pdf,
      mime_type: "application/pdf",
      headers: { "x-fixture-type": "government-pdf" }
    },
    {
      locator: locators.file,
      bytes: new Uint8Array([0, 1, 2, 255]),
      mime_type: "application/octet-stream",
      headers: { "x-fixture-type": "generic-file" }
    }
  ], { now: () => respondedAt });
}

function request(locator: string, overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    recruitment_endpoint_id: endpointId,
    locator,
    method: null,
    requested_at: requestedAt,
    headers: {},
    parameters: {},
    ...overrides
  };
}

function captureHarness() {
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  let sequence = 0;
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () => branded<SnapshotId>(`snapshot-${++sequence}`)
  });
  return { rawBlobs, snapshots, capture };
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
}

test("FixtureTransport returns the original HTML Fixture bytes and MIME", async () => {
  const response = await transport().execute(request(locators.html));
  assert.equal(response.status, "SUCCESS");
  if (response.status !== "SUCCESS") return;
  assert.equal(response.mime_type, "text/html; charset=utf-8");
  assert.deepEqual(response.bytes, fixtureBytes.html);
  assert.match(new TextDecoder("utf-8").decode(response.bytes), /法律事务岗（2027届）/);
});

test("FixtureTransport returns JSON Fixture bytes without business parsing", async () => {
  const response = await transport().execute(request(locators.json));
  assert.equal(response.status, "SUCCESS");
  if (response.status !== "SUCCESS") return;
  const decoded = JSON.parse(new TextDecoder("utf-8").decode(response.bytes)) as Record<string, unknown>;
  assert.equal(response.mime_type, "application/json; charset=utf-8");
  assert.equal(decoded["岗位名称"], "法律合规岗（2027届）");
});

test("FixtureTransport distinguishes PDF/File content by MIME rather than extension alone", async () => {
  const fixtureTransport = transport();
  const pdfResponse = await fixtureTransport.execute(request(locators.pdf));
  const fileResponse = await fixtureTransport.execute(request(locators.file));
  assert.equal(pdfResponse.status, "SUCCESS");
  assert.equal(fileResponse.status, "SUCCESS");
  if (pdfResponse.status !== "SUCCESS" || fileResponse.status !== "SUCCESS") return;
  assert.equal(pdfResponse.mime_type, "application/pdf");
  assert.equal(new TextDecoder("ascii").decode(pdfResponse.bytes.slice(0, 8)), "%PDF-1.4");
  assert.equal(fileResponse.mime_type, "application/octet-stream");
  assert.deepEqual(fileResponse.bytes, new Uint8Array([0, 1, 2, 255]));
});

test("SHA-256 is deterministic for identical bytes and changes for different bytes", async () => {
  const fixtureTransport = transport();
  const first = await fixtureTransport.execute(request(locators.html));
  const second = await fixtureTransport.execute(request(locators.html));
  const different = await fixtureTransport.execute(request(locators.json));
  assert.equal(first.status, "SUCCESS");
  assert.equal(second.status, "SUCCESS");
  assert.equal(different.status, "SUCCESS");
  if (first.status !== "SUCCESS" || second.status !== "SUCCESS" || different.status !== "SUCCESS") return;
  assert.equal(first.content_sha256, second.content_sha256);
  assert.notEqual(first.content_sha256, different.content_sha256);
  assert.equal(first.content_sha256, sha256(fixtureBytes.html));
});

test("RawBlob repository is append-only and exposes defensive byte copies", async () => {
  const response = await transport().execute(request(locators.html));
  assert.equal(response.status, "SUCCESS");
  if (response.status !== "SUCCESS") return;
  const { rawBlobs, capture } = captureHarness();
  const result = capture.record(request(locators.html), response);
  assert.ok(result.raw_blob);
  const originalFirstByte = fixtureBytes.html[0];

  result.raw_blob.bytes[0] = 0;
  const firstRead = rawBlobs.get(result.raw_blob.raw_blob_id);
  assert.ok(firstRead);
  assert.equal(firstRead.bytes[0], originalFirstByte);

  firstRead.bytes[0] = 1;
  const secondRead = rawBlobs.get(result.raw_blob.raw_blob_id);
  assert.ok(secondRead);
  assert.equal(secondRead.bytes[0], originalFirstByte);

  const otherBytes = fixtureBytes.json;
  const replacement: RawBlob = {
    raw_blob_id: result.raw_blob.raw_blob_id,
    bytes: otherBytes,
    raw_content_sha256: sha256(otherBytes),
    mime_type: "application/json",
    byte_length: otherBytes.byteLength,
    created_at: respondedAt
  };
  assert.throws(() => rawBlobs.append(replacement), /append-only/);
});

test("Snapshot persists safe request and response metadata", async () => {
  const response = await transport().execute(request(locators.html));
  const { capture } = captureHarness();
  const result = capture.record(request(locators.html, {
    headers: { "x-trace-id": "trace-1" },
    parameters: { region: "全国", page: 1 }
  }), response);
  assert.equal(result.snapshot.transport_status, "SUCCESS");
  assert.equal(result.snapshot.request_metadata.locator, locators.html);
  assert.equal(result.snapshot.request_metadata.headers["x-trace-id"], "trace-1");
  assert.equal(result.snapshot.request_metadata.parameters.region, "全国");
  assert.equal(result.snapshot.response_metadata.mime_type, "text/html; charset=utf-8");
  assert.equal(result.snapshot.response_metadata.headers["content-language"], "zh-CN");
  assert.equal(result.snapshot.observed_at, respondedAt);
});

test("successful Snapshot references the exact RawBlob hash, MIME, and length", async () => {
  const response = await transport().execute(request(locators.pdf));
  const { capture } = captureHarness();
  const result = capture.record(request(locators.pdf), response);
  assert.ok(result.raw_blob);
  assert.equal(result.snapshot.transport_status, "SUCCESS");
  assert.equal(result.snapshot.raw_blob_id, result.raw_blob.raw_blob_id);
  assert.equal(result.snapshot.content_hash, result.raw_blob.raw_content_sha256);
  assert.equal(result.snapshot.content_length, result.raw_blob.byte_length);
  assert.equal(result.snapshot.response_metadata.mime_type, result.raw_blob.mime_type);
  assert.equal(result.snapshot.response_metadata.content_length, result.raw_blob.byte_length);
  assert.deepEqual(
    [
      "recruitment_endpoint_id",
      "source_definition_id",
      "organization_id",
      "request_id",
      "snapshot_id"
    ].filter((field) => field in result.raw_blob),
    []
  );
});

test("identical content creates two Snapshots but only one RawBlob", async () => {
  const fixtureTransport = transport();
  const { rawBlobs, snapshots, capture } = captureHarness();
  const first = capture.record(
    request(locators.html),
    await fixtureTransport.execute(request(locators.html))
  );
  const second = capture.record(
    request(locators.html),
    await fixtureTransport.execute(request(locators.html))
  );
  assert.ok(first.raw_blob);
  assert.ok(second.raw_blob);
  assert.notEqual(first.snapshot.snapshot_id, second.snapshot.snapshot_id);
  assert.equal(first.raw_blob.raw_blob_id, second.raw_blob.raw_blob_id);
  assert.equal(first.snapshot.content_hash, second.snapshot.content_hash);
  assert.equal(rawBlobs.count(), 1);
  assert.equal(snapshots.count(), 2);
});

test("Transport failure creates a failed Snapshot without an artificial RawBlob or hash", async () => {
  const missingLocator = "fixture://transport/missing.html";
  const response = await transport().execute(request(missingLocator));
  assert.equal(response.status, "FAILED");
  if (response.status !== "FAILED") return;
  assert.equal(response.error.code, "FIXTURE_NOT_FOUND");

  const { rawBlobs, snapshots, capture } = captureHarness();
  const result = capture.record(request(missingLocator), response);
  assert.equal(result.snapshot.transport_status, "FAILED");
  assert.equal(result.snapshot.raw_blob_id, null);
  assert.equal(result.snapshot.content_hash, null);
  assert.equal(result.snapshot.content_length, null);
  assert.equal(result.snapshot.response_metadata.transport_error?.code, "FIXTURE_NOT_FOUND");
  assert.equal(rawBlobs.count(), 0);
  assert.equal(snapshots.count(), 1);
});

test("UTF-8 Chinese raw bytes survive capture without Unicode normalization", async () => {
  const response = await transport().execute(request(locators.html));
  const { capture } = captureHarness();
  const result = capture.record(request(locators.html), response);
  assert.ok(result.raw_blob);
  const decoded = new TextDecoder("utf-8").decode(result.raw_blob.bytes);
  assert.match(decoded, /中国科学院某研究所招聘/);
  assert.match(decoded, /法律硕士（非法学）专业/);
  assert.match(decoded, /法律硕士\(非法学\)专业/);
  assert.deepEqual(result.raw_blob.bytes, fixtureBytes.html);
  assert.equal(result.raw_blob.raw_content_sha256, sha256(fixtureBytes.html));
});

test("sensitive headers, parameters, credentials, and query values never enter Snapshot", async () => {
  assert.throws(() => new FixtureTransport([{
    locator: "fixture://transport/unsafe",
    bytes: new TextEncoder().encode("unsafe fixture"),
    mime_type: "text/plain",
    headers: { Authorization: "Bearer fixture-secret" }
  }]), /sensitive data/);

  const cleanResponse = await transport().execute(request(locators.html));
  assert.equal(cleanResponse.status, "SUCCESS");
  if (cleanResponse.status !== "SUCCESS") return;
  const sensitiveValue = "fixture-sensitive-value";
  const response: SuccessfulTransportResponse = {
    ...cleanResponse,
    headers: {
      ...cleanResponse.headers,
      "Set-Cookie": `session=${sensitiveValue}`,
      "X-Api-Key": sensitiveValue,
      "X-Unsafe-Value": `Bearer ${sensitiveValue}`
    }
  };
  const unsafeRequest = request(
    `fixture://user:${sensitiveValue}@transport/official-recruitment.html?token=${sensitiveValue}&region=全国`,
    {
      headers: {
        Authorization: `Bearer ${sensitiveValue}`,
        Cookie: `session=${sensitiveValue}`,
        "x-safe-trace": "safe-trace"
      },
      parameters: {
        api_key: sensitiveValue,
        session_id: sensitiveValue,
        region: "全国"
      }
    }
  );
  const { capture } = captureHarness();
  const result = capture.record(unsafeRequest, response);
  const persisted = JSON.stringify(result.snapshot);
  assert.doesNotMatch(persisted, /authorization|set-cookie|api.key|session.id/i);
  assert.doesNotMatch(persisted, new RegExp(sensitiveValue));
  assert.match(persisted, /safe-trace/);
  assert.match(persisted, /全国/);
});

test("Transport and Raw tests cannot use fetch, HTTP, HTTPS, TCP, or TLS", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
