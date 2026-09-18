import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  normalizeExtractedRecord,
  type AdapterExtractionInput,
  type IsoDateTime,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type Snapshot,
  type SnapshotId
} from "../../lib/ingestion";
import {
  createNtscOfflinePreparationComposition,
  NTSC_LIVE_STRUCTURE_STATUS,
  NTSC_OFFICIAL_HTML_ADAPTER_KEY,
  NTSC_ORGANIZATION_ID,
  NTSC_RECRUITMENT_ENDPOINT_ID,
  NTSC_SOURCE_DEFINITION_ID,
  NTSC_TALENT_LIST_LOCATOR
} from "../../lib/live-canary/p2-04";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const syntheticFixturePath = path.join(
  repositoryRoot,
  "fixtures",
  "p2-04",
  "ntsc-talent-list.synthetic.html"
);
const syntheticHtml = readFileSync(syntheticFixturePath, "utf8");
const observedAt = "2026-09-04T09:00:01+08:00" as IsoDateTime;

test("synthetic/test-only HTML extracts traceable recruitment list records", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  const records = adapter.extract(captured(endpoint, syntheticHtml));

  assert.equal(records.length, 2);
  assert.equal(records[0].raw_title?.text, "法务与合规岗位（测试）");
  assert.equal(records[0].raw_organization_name?.text, "中国科学院国家授时中心");
  assert.equal(records[0].publish_time?.text, "2026-09-01");
  assert.equal(
    records[0].announcement_url,
    "https://ntsc.cas.cn/xwzx_/rczp/2026/synthetic-legal-001.html"
  );
  assert.deepEqual(records[0].identity_candidates, [{
    kind: "ANNOUNCEMENT_URL",
    value: records[0].announcement_url,
    confidence: "HIGH"
  }]);
  assert.equal(records[0].source_record_locator.kind, "HTML");
  assert.deepEqual(Object.keys(records[0].adapter_metadata), [NTSC_OFFICIAL_HTML_ADAPTER_KEY]);
  assert.equal(records[0].raw_requirement_text, undefined);

  const normalized = normalizeExtractedRecord(records[0]);
  assert.equal(normalized.content.title.normalized?.text, "法务与合规岗位(测试)");
  assert.equal(normalized.content.organization.name.original.text, "中国科学院国家授时中心");
  assert.equal(normalized.content.announcement_locator, records[0].announcement_url);
});

test("empty synthetic list remains SUSPICIOUS_EMPTY", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  const records = adapter.extract(captured(endpoint, page("")));
  assert.deepEqual(records, []);
  assert.deepEqual(adapter.assessCompleteness({
    snapshots: [captured(endpoint, page("")).snapshot],
    records,
    extraction_errors: []
  }), {
    status: "SUSPICIOUS_EMPTY",
    reason_codes: ["ZERO_EXTRACTED_RECORDS"]
  });
});

test("unconfirmed HTML structure change fails instead of becoming an empty result", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  const changed = page(record("公告", "/xwzx_/rczp/2026/notice.html"))
    .replace("data-p2-04-synthetic-ntsc-list", "data-unknown-live-list");
  assert.throws(
    () => adapter.extract(captured(endpoint, changed)),
    /Synthetic list structure is missing; live selectors remain unconfirmed/
  );
});

test("missing title is rejected as malformed source content", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  assert.throws(
    () => adapter.extract(captured(endpoint, page(record("", "/xwzx_/rczp/2026/notice.html")))),
    /missing a title/
  );
});

test("missing detail locator is rejected as malformed source content", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  assert.throws(
    () => adapter.extract(captured(endpoint, page(record("招聘公告", null)))),
    /missing a detail locator/
  );
});

test("unexpected external, credentialed, fragment, and non-HTTPS links are rejected", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  const invalidLocators = [
    "https://example.invalid/recruitment.html",
    "https://user:secret@ntsc.cas.cn/recruitment.html",
    "#notice",
    "http://ntsc.cas.cn/recruitment.html",
    "javascript:alert(1)"
  ];
  for (const locator of invalidLocators) {
    assert.throws(
      () => adapter.extract(captured(endpoint, page(record("招聘公告", locator)))),
      /Detail locator/
    );
  }
});

test("duplicate announcement locators produce one ExtractedRecord", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  const duplicate = record("招聘公告 A", "/xwzx_/rczp/2026/duplicate.html")
    + record("招聘公告 A 重复", "/xwzx_/rczp/2026/duplicate.html");
  const records = adapter.extract(captured(endpoint, page(duplicate)));
  assert.equal(records.length, 1);
  assert.equal(records[0].raw_title?.text, "招聘公告 A");
});

test("invalid UTF-8 Raw bytes are rejected before HTML parsing", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  assert.throws(
    () => adapter.extract(captured(endpoint, new Uint8Array([0xc3, 0x28]))),
    /Raw HTML bytes are not valid UTF-8/
  );
});

test("Adapter extraction has no network execution capability", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Network must not be called");
  };
  try {
    assert.equal(adapter.extract(captured(endpoint, syntheticHtml)).length, 2);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const adapterSource = readFileSync(path.join(
    repositoryRoot,
    "lib",
    "live-canary",
    "p2-04",
    "ntsc-official-html-adapter.ts"
  ), "utf8");
  assert.doesNotMatch(adapterSource, /from\s+["']node:(?:http|https|net|tls)["']/u);
  assert.doesNotMatch(adapterSource, /\bfetch\s*\(/u);
});

test("P2-04 offline preparation depends on frozen P1 only and adds no runtime egress", () => {
  const moduleRoot = path.join(repositoryRoot, "lib", "live-canary", "p2-04");
  for (const fileName of [
    "ntsc-official-html-adapter.ts",
    "ntsc-offline-composition.ts",
    "index.ts"
  ]) {
    const source = readFileSync(path.join(moduleRoot, fileName), "utf8");
    assert.doesNotMatch(source, /(?:application\/source-admission|preview-persistence|collection-runtime)/u);
    assert.doesNotMatch(source, /(?:lib\/jobs|lib\/sync|source-catalog|supabase|app\/api)/u);
    assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls)["']/u);
    assert.doesNotMatch(source, /\bfetch\s*\(/u);
  }
});

test("offline composition registers stable disabled P1 instances", () => {
  const composition = createNtscOfflinePreparationComposition();
  assert.equal(composition.organization.organization_id, NTSC_ORGANIZATION_ID);
  assert.equal(composition.source_definition.source_definition_id, NTSC_SOURCE_DEFINITION_ID);
  assert.equal(
    composition.recruitment_endpoint.recruitment_endpoint_id,
    NTSC_RECRUITMENT_ENDPOINT_ID
  );
  assert.equal(composition.recruitment_endpoint.locator, NTSC_TALENT_LIST_LOCATOR);
  assert.equal(composition.recruitment_endpoint.request_method, "GET");
  assert.equal(composition.recruitment_endpoint.content_kind, "HTML");
  assert.equal(composition.recruitment_endpoint.adapter_key, NTSC_OFFICIAL_HTML_ADAPTER_KEY);
  assert.deepEqual(composition.recruitment_endpoint.collection_config, {
    timeout_ms: 5_000,
    max_items: 1,
    max_pages: 1,
    follow_redirects: false,
    retry_limit: 0
  });
  assert.equal(composition.source_definition.enabled, false);
  assert.equal(composition.recruitment_endpoint.enabled, false);
  assert.deepEqual(composition.registry.listCollectableEndpoints(), []);
  assert.equal(composition.live_structure_status, NTSC_LIVE_STRUCTURE_STATUS);
  assert.equal(composition.live_structure_status, "TODO_HUMAN_CONFIRM_SELECTORS");
});

test("synthetic selectors cannot validate an enabled Live Endpoint", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  const validation = adapter.validateEndpoint({ ...endpoint, enabled: true });
  assert.equal(validation.valid, false);
  if (!validation.valid) {
    assert.match(validation.issues.join("; "), /Synthetic selectors cannot be used/);
  }
});

test("Adapter plans exactly one GET and never emits a next page", () => {
  const { adapter, recruitment_endpoint: endpoint } = createNtscOfflinePreparationComposition();
  const plans = adapter.plan(endpoint);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].locator, NTSC_TALENT_LIST_LOCATOR);
  assert.equal(plans[0].method, "GET");
  assert.equal(adapter.nextPage({
    endpoint,
    snapshot: captured(endpoint, syntheticHtml).snapshot,
    pagination_state: plans[0].pagination_state
  }), null);
});

test("synthetic fixture declares its test-only status", () => {
  assert.match(syntheticHtml, /SYNTHETIC\/TEST-ONLY/);
  assert.match(syntheticHtml, /synthetic\/test-only/);
});

function captured(
  endpoint: ReturnType<typeof createNtscOfflinePreparationComposition>["recruitment_endpoint"],
  content: string | Uint8Array
): AdapterExtractionInput {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const hash = createHash("sha256").update(bytes).digest("hex") as RawContentSha256;
  const rawBlob: RawBlob = {
    raw_blob_id: `raw:${hash}` as RawBlobId,
    bytes: new Uint8Array(bytes),
    raw_content_sha256: hash,
    mime_type: "text/html; charset=utf-8",
    byte_length: bytes.byteLength,
    created_at: observedAt
  };
  const snapshot: Snapshot = {
    snapshot_id: `snapshot:${hash}` as SnapshotId,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    request_metadata: {
      locator: endpoint.locator,
      method: "GET",
      requested_at: "2026-09-04T09:00:00+08:00" as IsoDateTime,
      headers: {},
      parameters: {}
    },
    response_metadata: {
      http_status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      mime_type: "text/html; charset=utf-8",
      content_length: bytes.byteLength,
      transport_error: null
    },
    raw_blob_id: rawBlob.raw_blob_id,
    observed_at: observedAt,
    transport_status: "SUCCESS",
    content_hash: hash,
    content_length: bytes.byteLength
  };
  return { endpoint, snapshot, raw_blob: rawBlob };
}

function page(records: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>synthetic/test-only</title></head>
  <body>
    <header data-p2-04-synthetic-organization>中国科学院国家授时中心</header>
    <main data-p2-04-synthetic-ntsc-list>${records}</main>
  </body>
</html>`;
}

function record(title: string, detailLocator: string | null) {
  const linkStart = detailLocator === null
    ? "<span data-p2-04-synthetic-detail>"
    : `<a data-p2-04-synthetic-detail href="${detailLocator}">`;
  const linkEnd = detailLocator === null ? "</span>" : "</a>";
  return `<article data-p2-04-synthetic-ntsc-record>
    ${linkStart}<span data-p2-04-synthetic-title>${title}</span>${linkEnd}
    <time data-p2-04-synthetic-publish-date>2026-09-01</time>
  </article>`;
}
