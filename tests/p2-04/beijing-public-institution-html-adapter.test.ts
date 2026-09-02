import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  type AdapterExtractionInput,
  type IsoDateTime,
  type RawBlob,
  type RawBlobId,
  type RawContentSha256,
  type RecruitmentEndpoint,
  type Snapshot,
  type SnapshotId
} from "../../lib/ingestion";
import {
  BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR,
  BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
  BEIJING_PUBLIC_INSTITUTION_SOURCE_DEFINITION_ID,
  BeijingPublicInstitutionHtmlAdapter
} from "../../lib/live-canary/p2-04/beijing-public-institution-html-adapter";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(
  repositoryRoot,
  "fixtures",
  "p2-04",
  "beijing-public-institution-job-list.html"
);
const provenancePath = path.join(
  repositoryRoot,
  "fixtures",
  "p2-04",
  "beijing-public-institution-job-list.fixture.json"
);
const fixtureBytes = new Uint8Array(readFileSync(fixturePath));
const fixtureHtml = new TextDecoder("utf-8", { fatal: true }).decode(fixtureBytes);
const provenance = JSON.parse(readFileSync(provenancePath, "utf8")) as {
  readonly fixture_status: string;
  readonly offline_only: boolean;
  readonly source_canary_run_id: string;
  readonly raw_sha256: string;
};
const observedAt = "2026-09-02T07:44:43.576Z" as IsoDateTime;

test("real Canary fixture is byte-identical to its recorded Raw SHA-256", () => {
  assert.equal(provenance.fixture_status, "TEST_FIXTURE_FROM_REAL_P2_04_CANARY");
  assert.equal(provenance.offline_only, true);
  assert.equal(provenance.source_canary_run_id, "p2-04-run:e31df3a6-d762-4d02-9e3e-df2fdacc4334");
  assert.equal(sha256(fixtureBytes), provenance.raw_sha256);
  assert.equal(sha256(fixtureBytes), "6dd2ca1ee38b37e678b4508c95dc0b05903333602e399b1facead5950c69cc58");
});

test("real Beijing job-list fixture extracts all 25 records in HTML order", () => {
  const adapter = new BeijingPublicInstitutionHtmlAdapter();
  const records = adapter.extract(captured(fixtureBytes));

  assert.equal(records.length, 25);
  assert.equal(records[0].raw_title?.text, "北京急救中心2026年度第四批公开招聘公告");
  assert.equal(records[0].publish_time?.text, "2026-06-24");
  assert.equal(
    records[0].announcement_url,
    "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/t20260625_4714884.html"
  );
  assert.equal(records[1].raw_title?.text, "西城区卫生健康系统2026年第二批事业单位公开招聘工作人员公告");
  assert.equal(records.at(-1)?.raw_title?.text, "北京清华长庚医院2026年度第三批公开招聘公告");
  assert.deepEqual(records.map((record) => {
    return record.adapter_metadata[BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY]?.document_order;
  }), Array.from({ length: 25 }, (_value, index) => index));
});

test("records retain real relative detail locators as safe absolute official URLs", () => {
  const adapter = new BeijingPublicInstitutionHtmlAdapter();
  const record = adapter.extract(captured(fixtureBytes))[0];
  assert.equal(record.identity_candidates[0].kind, "ANNOUNCEMENT_URL");
  assert.equal(record.identity_candidates[0].value, record.announcement_url);
  assert.equal(
    record.adapter_metadata[BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY]?.raw_detail_locator,
    "./202606/t20260625_4714884.html"
  );
  assert.equal(record.source_record_locator.kind, "HTML");
  if (record.source_record_locator.kind === "HTML") {
    assert.equal(
      record.source_record_locator.selector,
      ".listBox > ul.list:nth-of-type(1) > li.col-md:nth-of-type(1)"
    );
  }
});

test("the list page does not fabricate recruitment organizations or downstream facts", () => {
  const record = new BeijingPublicInstitutionHtmlAdapter().extract(captured(fixtureBytes))[0];
  assert.equal(record.raw_organization_name, undefined);
  assert.equal(record.raw_requirement_text, undefined);
  assert.equal(record.raw_description, undefined);
  assert.equal(record.application_url, undefined);
  assert.equal(record.deadline, undefined);
});

test("missing dates remain absent rather than inferred", () => {
  const withoutFirstDate = fixtureHtml.replace("<span>2026-06-24</span>", "");
  const records = new BeijingPublicInstitutionHtmlAdapter().extract(captured(withoutFirstDate));
  assert.equal(records.length, 25);
  assert.equal(records[0].publish_time, undefined);
  assert.equal(
    records[0].adapter_metadata[BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY]?.raw_publish_date_text,
    null
  );
});

test("missing detail href is malformed source content", () => {
  const withoutFirstHref = fixtureHtml.replace(
    'href="./202606/t20260625_4714884.html"',
    ""
  );
  assert.throws(
    () => new BeijingPublicInstitutionHtmlAdapter().extract(captured(withoutFirstHref)),
    /missing a detail locator/
  );
});

test("empty and malformed list input stays bounded and suspicious", () => {
  const adapter = new BeijingPublicInstitutionHtmlAdapter();
  const empty = "<!doctype html><html><body><div class=\"listBox\"></div></body></html>";
  const records = adapter.extract(captured(empty));
  assert.deepEqual(records, []);
  assert.deepEqual(adapter.assessCompleteness({
    snapshots: [captured(empty).snapshot],
    records,
    extraction_errors: []
  }), {
    status: "SUSPICIOUS_EMPTY",
    reason_codes: ["ZERO_EXTRACTED_RECORDS"]
  });
  assert.throws(
    () => adapter.extract(captured("<html><body>unexpected</body></html>")),
    /.listBox is missing/
  );
});

test("Adapter plans one offline page and never produces a next page", () => {
  const adapter = new BeijingPublicInstitutionHtmlAdapter();
  const plans = adapter.plan(endpoint());
  assert.deepEqual(plans, [{
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    locator: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR,
    method: "GET",
    parameters: {},
    pagination_state: {
      page_index: 1,
      cursor: null,
      visited_locators: [BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR]
    }
  }]);
  assert.equal(adapter.nextPage({
    endpoint: endpoint(),
    snapshot: captured(fixtureBytes).snapshot,
    pagination_state: plans[0].pagination_state
  }), null);
});

test("Adapter has no network or requirement, eligibility, or canonicalization dependency", () => {
  const adapter = new BeijingPublicInstitutionHtmlAdapter();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Network must not be called");
  };
  try {
    assert.equal(adapter.extract(captured(fixtureBytes)).length, 25);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const source = readFileSync(path.join(
    repositoryRoot,
    "lib",
    "live-canary",
    "p2-04",
    "beijing-public-institution-html-adapter.ts"
  ), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls|dns)["']/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /(?:requirements|eligibility|canonicalization|CanonicalOpportunity)/u);
  assert.doesNotMatch(source, /(?:application\/source-admission|collection-runtime|supabase|lib\/jobs|lib\/sync|app\/api)/u);
});

function endpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: BEIJING_PUBLIC_INSTITUTION_SOURCE_DEFINITION_ID,
    name: traceable("北京市事业单位招聘列表"),
    description: traceable("真实 P2-04 Canary Raw 的离线 Adapter Fixture。"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: BEIJING_PUBLIC_INSTITUTION_HTML_ADAPTER_KEY,
    decoded_text_encoding: "UTF-8",
    collection_config: {
      timeout_ms: 10_000,
      max_items: 25,
      max_pages: 1,
      follow_redirects: false,
      retry_limit: 0
    },
    enabled: false
  };
}

function captured(content: string | Uint8Array): AdapterExtractionInput {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const hash = sha256(bytes) as RawContentSha256;
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
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_RECRUITMENT_ENDPOINT_ID,
    request_metadata: {
      locator: BEIJING_PUBLIC_INSTITUTION_JOB_LIST_LOCATOR,
      method: "GET",
      requested_at: observedAt,
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
  return { endpoint: endpoint(), snapshot, raw_blob: rawBlob };
}

function original(text: string) {
  return { text, encoding: "UTF-8" } as const;
}

function traceable(text: string) {
  return { original: original(text) } as const;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
