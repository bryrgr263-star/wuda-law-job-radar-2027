import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FixtureAdapter,
  FixtureTransport,
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  RawCaptureService,
  UTF8_TEXT_ENCODING,
  type AdapterExtractionInput,
  type IsoDateTime,
  type RecruitmentEndpoint,
  type RecruitmentEndpointId,
  type SnapshotId,
  type SourceDefinitionId,
  type TransportRequest
} from "../../lib/ingestion";
import {
  runAdapterContractTests,
  type AdapterContractCases
} from "./adapter-contract-harness";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "fixtures", "adapters");
const fixtureFiles = {
  html: "official-html.html",
  page1: "paged-json-1.json",
  page2: "paged-json-2.json",
  document: "document-preprocessed.txt",
  empty: "empty.json",
  malformed: "malformed.json",
  duplicate: "duplicate.json"
} as const;

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string) {
  return { text, encoding: UTF8_TEXT_ENCODING } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

const sourceDefinitionId = branded<SourceDefinitionId>("source-fixture-adapter");
const observedAt = branded<IsoDateTime>("2026-09-01T10:00:01+08:00");
const requestedAt = branded<IsoDateTime>("2026-09-01T10:00:00+08:00");

const locators = Object.fromEntries(Object.entries(fixtureFiles).map(([key, fileName]) => [
  key,
  `fixture://adapters/${fileName}`
])) as Record<keyof typeof fixtureFiles, string>;

function endpoint(
  id: string,
  locator: string,
  contentKind: RecruitmentEndpoint["content_kind"]
): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: branded<RecruitmentEndpointId>(id),
    source_definition_id: sourceDefinitionId,
    name: traceable(`Fixture ${contentKind} Endpoint`),
    description: traceable("仅用于离线 Adapter Contract 测试"),
    coverage_regions: [{ raw_text: original("全国") }],
    locator,
    content_kind: contentKind,
    adapter_key: "fixture",
    decoded_text_encoding: "UTF-8",
    collection_config: { max_pages: 2, max_items: 100 },
    enabled: true
  };
}

function request(endpointValue: RecruitmentEndpoint, locator = endpointValue.locator): TransportRequest {
  return {
    recruitment_endpoint_id: endpointValue.recruitment_endpoint_id,
    locator,
    method: null,
    requested_at: requestedAt,
    headers: {},
    parameters: {}
  };
}

async function setupContractCases(): Promise<AdapterContractCases> {
  const endpoints = {
    html: endpoint("endpoint-adapter-html", locators.html, "HTML"),
    json: endpoint("endpoint-adapter-json", locators.page1, "JSON"),
    document: endpoint("endpoint-adapter-document", locators.document, "PDF"),
    empty: endpoint("endpoint-adapter-empty", locators.empty, "JSON"),
    malformed: endpoint("endpoint-adapter-malformed", locators.malformed, "JSON"),
    duplicate: endpoint("endpoint-adapter-duplicate", locators.duplicate, "JSON")
  };
  const fixtureTransport = new FixtureTransport([
    entry(locators.html, fixtureFiles.html, "text/html; charset=utf-8"),
    entry(locators.page1, fixtureFiles.page1, "application/json; charset=utf-8", {
      "x-fixture-next-locator": locators.page2
    }),
    entry(locators.page2, fixtureFiles.page2, "application/json; charset=utf-8"),
    entry(locators.document, fixtureFiles.document, "text/plain; charset=utf-8"),
    entry(locators.empty, fixtureFiles.empty, "application/json; charset=utf-8"),
    entry(locators.malformed, fixtureFiles.malformed, "application/json; charset=utf-8"),
    entry(locators.duplicate, fixtureFiles.duplicate, "application/json; charset=utf-8")
  ], { now: () => observedAt });
  const rawBlobs = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  let sequence = 0;
  const capture = new RawCaptureService(rawBlobs, snapshots, {
    create_snapshot_id: () => branded<SnapshotId>(`adapter-snapshot-${++sequence}`)
  });

  async function captured(
    endpointValue: RecruitmentEndpoint,
    locator = endpointValue.locator
  ): Promise<AdapterExtractionInput> {
    const transportRequest = request(endpointValue, locator);
    const response = await fixtureTransport.execute(transportRequest);
    const result = capture.record(transportRequest, response);
    return { endpoint: endpointValue, snapshot: result.snapshot, raw_blob: result.raw_blob };
  }

  const failedEndpoint = endpoint(
    "endpoint-adapter-failed",
    "fixture://adapters/missing.json",
    "JSON"
  );
  const invalidHttpEndpoint: RecruitmentEndpoint = {
    ...endpoints.html,
    recruitment_endpoint_id: branded<RecruitmentEndpointId>("endpoint-adapter-http"),
    locator: "https://example.invalid/recruitment",
    request_method: "GET"
  };

  return {
    adapter: new FixtureAdapter(),
    valid_endpoint: endpoints.html,
    invalid_http_endpoint: invalidHttpEndpoint,
    html: await captured(endpoints.html),
    json_page_1: await captured(endpoints.json),
    json_page_2: await captured(endpoints.json, locators.page2),
    document: await captured(endpoints.document),
    empty: await captured(endpoints.empty),
    malformed: await captured(endpoints.malformed),
    duplicate: await captured(endpoints.duplicate),
    failed: await captured(failedEndpoint)
  };
}

function entry(
  locator: string,
  fileName: string,
  mimeType: string,
  headers: Readonly<Record<string, string>> = {}
) {
  return {
    locator,
    bytes: new Uint8Array(readFileSync(path.join(fixtureRoot, fileName))),
    mime_type: mimeType,
    headers
  };
}

runAdapterContractTests("FixtureAdapter", setupContractCases);

test("ExtractedRecord contract preserves raw fields and identity candidates", async () => {
  const cases = await setupContractCases();
  const [record] = cases.adapter.extract(cases.html);
  assert.equal(record.raw_source_record_id, "html-legal-001");
  assert.equal(record.raw_title?.text, "法律事务岗（2027届）");
  assert.equal(record.raw_organization_name?.text, "中国科学院某研究所");
  assert.deepEqual(record.raw_location_text.map((location) => location.text), ["北京市", "武汉市"]);
  assert.equal(record.raw_requirement_text?.text, "法律硕士（非法学）专业；通过法律职业资格考试者优先。");
  assert.equal(record.announcement_url, "fixture://announcement/html-legal-001");
  assert.equal(record.application_url, "fixture://apply/html-legal-001");
  assert.equal(record.publish_time?.text, "2026年9月1日");
  assert.equal(record.deadline?.text, "2026年10月31日");
  assert.equal(record.recruitment_year?.text, "2027届");
  assert.equal(record.recruitment_batch?.text, "秋季校园招聘");
  assert.deepEqual(record.identity_candidates, [{
    kind: "SOURCE_RECORD_ID",
    value: "html-legal-001",
    confidence: "HIGH"
  }]);
});

test("SourceRecordLocator supports HTML, JSON, and DOCUMENT locations", async () => {
  const cases = await setupContractCases();
  const html = cases.adapter.extract(cases.html)[0].source_record_locator;
  const json = cases.adapter.extract(cases.json_page_1)[0].source_record_locator;
  const document = cases.adapter.extract(cases.document)[0].source_record_locator;
  assert.equal(html.kind, "HTML");
  assert.equal(html.kind === "HTML" ? html.selector : null, '[data-fixture-record="html-legal-001"]');
  assert.equal(json.kind, "JSON");
  assert.equal(json.kind === "JSON" ? json.json_path : null, "$.records[0]");
  assert.equal(document.kind, "DOCUMENT");
  assert.equal(document.kind === "DOCUMENT" ? document.page_number : null, 3);
  assert.equal(document.kind === "DOCUMENT" ? document.section : null, "二、招聘岗位");
});

test("ExtractedRecord traces through Snapshot to the exact RawBlob", async () => {
  const cases = await setupContractCases();
  const [record] = cases.adapter.extract(cases.json_page_1);
  assert.equal(record.snapshot_id, cases.json_page_1.snapshot.snapshot_id);
  assert.equal(cases.json_page_1.snapshot.transport_status, "SUCCESS");
  assert.ok(cases.json_page_1.raw_blob);
  assert.equal(cases.json_page_1.snapshot.raw_blob_id, cases.json_page_1.raw_blob.raw_blob_id);
  assert.equal(cases.json_page_1.snapshot.content_hash, cases.json_page_1.raw_blob.raw_content_sha256);
});

test("adapter_metadata is isolated under adapter_key and raw text remains unnormalized", async () => {
  const cases = await setupContractCases();
  const htmlRecord = cases.adapter.extract(cases.html)[0];
  const documentRecord = cases.adapter.extract(cases.document)[0];
  assert.deepEqual(Object.keys(htmlRecord.adapter_metadata), [cases.adapter.descriptor.adapter_key]);
  assert.equal(htmlRecord.raw_title?.text, "法律事务岗（2027届）");
  assert.equal(documentRecord.raw_requirement_text?.text, "法律硕士(非法学)、法学等相关专业");
  assert.equal("normalized" in (htmlRecord.raw_title ?? {}), false);
});

test("Fixture document parsing is explicitly preprocessed text and does not claim PDF OCR", async () => {
  const cases = await setupContractCases();
  const [record] = cases.adapter.extract(cases.document);
  assert.deepEqual(record.adapter_metadata.fixture, {
    format: "DOCUMENT_TEXT_FIXTURE",
    record_index: 0,
    preprocessed: true
  });
});
