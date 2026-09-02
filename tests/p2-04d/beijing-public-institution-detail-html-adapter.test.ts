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
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
  BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID,
  BeijingPublicInstitutionDetailHtmlAdapter
} from "../../lib/live-canary/p2-04d/beijing-public-institution-detail-html-adapter";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(
  repositoryRoot,
  "fixtures",
  "p2-04d",
  "beijing-public-institution-job-detail.html"
);
const provenancePath = path.join(
  repositoryRoot,
  "fixtures",
  "p2-04d",
  "beijing-public-institution-job-detail.fixture.json"
);
const fixtureBytes = new Uint8Array(readFileSync(fixturePath));
const fixtureHtml = new TextDecoder("utf-8", { fatal: true }).decode(fixtureBytes);
const provenance = JSON.parse(readFileSync(provenancePath, "utf8")) as {
  readonly fixture_status: string;
  readonly offline_only: boolean;
  readonly source_canary_run_id: string;
  readonly raw_sha256: string;
  readonly raw_byte_length: number;
};
const observedAt = "2026-09-02T13:49:21.756Z" as IsoDateTime;

test("real Detail Canary fixture is byte-identical to recorded Raw provenance", () => {
  assert.equal(provenance.fixture_status, "TEST_FIXTURE_FROM_REAL_P2_04D_CANARY");
  assert.equal(provenance.offline_only, true);
  assert.equal(provenance.source_canary_run_id, "p2-04d-run:3648affe-5bd5-471c-b557-085bfed0a3be");
  assert.equal(fixtureBytes.byteLength, provenance.raw_byte_length);
  assert.equal(sha256(fixtureBytes), provenance.raw_sha256);
  assert.equal(sha256(fixtureBytes), "8a44dad79da041e1aefb7d9aed442df40f5de844eefe5d1708cb52996f511d8a");
});

test("real Detail Canary fixture becomes one traceable source record", () => {
  const record = new BeijingPublicInstitutionDetailHtmlAdapter().extract(captured(fixtureBytes))[0]!;
  assert.equal(record.raw_title?.text, "北京急救中心2026年度第四批公开招聘公告");
  assert.equal(record.raw_organization_name?.text, "北京急救中心");
  assert.equal(record.publish_time?.text, "2026-06-24 09:38");
  assert.equal(record.recruitment_year?.text, "2026");
  assert.equal(record.recruitment_batch?.text, "第四批");
  assert.equal(record.announcement_url, BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT);
  assert.deepEqual(record.identity_candidates, [{
    kind: "ANNOUNCEMENT_URL",
    value: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    confidence: "HIGH"
  }]);
  assert.equal(record.source_record_locator.kind, "HTML");
  if (record.source_record_locator.kind === "HTML") {
    assert.equal(record.source_record_locator.selector, "#mainText > .view");
  }
});

test("detail source facts preserve article text, sections, and unaccessed attachment locators", () => {
  const record = new BeijingPublicInstitutionDetailHtmlAdapter().extract(captured(fixtureBytes))[0]!;
  const metadata = record.adapter_metadata[BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY]! as {
    readonly content_source_meta: string;
    readonly content_text: string;
    readonly sections: readonly { readonly heading: string }[];
    readonly attachment_references: readonly { readonly text: string; readonly raw_locator: string; readonly locator: string }[];
    readonly explicitly_named_position_mentions: readonly { readonly text: string; readonly classification: string }[];
    readonly position_table_status: string;
  };
  assert.equal(metadata.content_source_meta, "北京市卫生健康委员会");
  assert.match(metadata.content_text, /符合岗位要求的学历、学位、专业技术/u);
  assert.ok(metadata.sections.some((section) => section.heading.includes("招聘对象")));
  assert.ok(metadata.sections.some((section) => section.heading.includes("招聘条件")));
  assert.ok(metadata.sections.some((section) => section.heading.includes("招聘岗位及要求")));
  assert.deepEqual(metadata.attachment_references, [{
    text: "附件1：北京急救中心2026年度第四批公开招聘工作人员职位及要求表",
    raw_locator: "./P020260625349755441673.xlsx",
    locator: "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/P020260625349755441673.xlsx",
    selector: "#filerider a[href]"
  }, {
    text: "附件2：北京急救中心公开招聘登记报名表",
    raw_locator: "./P020260625349755579014.docx",
    locator: "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/P020260625349755579014.docx",
    selector: "#filerider a[href]"
  }]);
  assert.deepEqual(metadata.explicitly_named_position_mentions, [{
    text: "院前急救学科骨干",
    evidence_text: "例如“张三+院前急救学科骨干”",
    classification: "EXPLICIT_MENTION_NOT_COMPLETE_POSITION_TABLE"
  }]);
  assert.equal(metadata.position_table_status, "LINKED_ATTACHMENT_NOT_FETCHED");
});

test("legal-degree terms remain source observations, with no inference when absent", () => {
  const record = new BeijingPublicInstitutionDetailHtmlAdapter().extract(captured(fixtureBytes))[0]!;
  const observations = record.adapter_metadata[BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY]!
    .legal_term_observations as Readonly<Record<string, boolean>>;
  assert.deepEqual(observations, {
    "法律硕士": false,
    "法律硕士（非法学）": false,
    "法学硕士": false,
    "法学专业": false,
    "法学类": false,
    "法律专业": false,
    "本科专业": false,
    "硕士专业": false,
    "法律职业资格": false
  });
  assert.ok(record.raw_requirement_text?.text.includes("招聘条件"));
});

test("organization remains missing when the explicit introductory source fact is absent", () => {
  const withoutIntroduction = fixtureHtml.replaceAll(
    "北京急救中心是北京市卫生健康委员会直属的公共卫生单位和非营利性医疗机构，为公益一类事业单位。",
    "该单位为公益一类事业单位。"
  );
  const record = new BeijingPublicInstitutionDetailHtmlAdapter().extract(captured(withoutIntroduction))[0]!;
  assert.equal(record.raw_organization_name, undefined);
});

test("the Adapter plans only its exact offline page and never paginates", () => {
  const adapter = new BeijingPublicInstitutionDetailHtmlAdapter();
  const plans = adapter.plan(endpoint());
  assert.deepEqual(plans, [{
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    method: "GET",
    parameters: {},
    pagination_state: {
      page_index: 1,
      cursor: null,
      visited_locators: [BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT]
    }
  }]);
  assert.equal(adapter.nextPage({
    endpoint: endpoint(),
    snapshot: captured(fixtureBytes).snapshot,
    pagination_state: plans[0]!.pagination_state
  }), null);
});

test("malformed or empty detail HTML stays bounded and does not turn absence into success", () => {
  const adapter = new BeijingPublicInstitutionDetailHtmlAdapter();
  assert.throws(
    () => adapter.extract(captured("<html><body>unexpected</body></html>")),
    /#mainText > .view is missing/u
  );
  assert.throws(
    () => adapter.extract(captured("<html><body><div id=\"mainText\"><div class=\"view\"></div></div></body></html>")),
    /missing an article title/u
  );
  assert.deepEqual(adapter.assessCompleteness({
    snapshots: [captured(fixtureBytes).snapshot],
    records: [],
    extraction_errors: []
  }), {
    status: "SUSPICIOUS_EMPTY",
    reason_codes: ["ZERO_EXTRACTED_RECORDS"]
  });
});

test("Adapter is pure/offline and does not construct downstream decisions", () => {
  const adapter = new BeijingPublicInstitutionDetailHtmlAdapter();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Network must not be called");
  };
  try {
    assert.equal(adapter.extract(captured(fixtureBytes)).length, 1);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-04d/beijing-public-institution-detail-html-adapter.ts"
  ), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls|dns)["']/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /from\s+["'][^"']*\/(?:requirements|eligibility|canonicalization)[^"']*["']/u);
  assert.doesNotMatch(source, /(?:application\/source-admission|collection-runtime|supabase|lib\/jobs|lib\/sync|app\/api)/u);
});

function endpoint(): RecruitmentEndpoint {
  return {
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    source_definition_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_SOURCE_DEFINITION_ID,
    name: traceable("北京急救中心2026年度第四批公开招聘公告详情"),
    description: traceable("真实 P2-04D Canary Raw 的离线 Adapter Fixture。"),
    coverage_regions: [{ raw_text: original("北京市") }],
    locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
    request_method: "GET",
    content_kind: "HTML",
    adapter_key: BEIJING_PUBLIC_INSTITUTION_DETAIL_ADAPTER_KEY,
    decoded_text_encoding: "UTF-8",
    collection_config: {
      timeout_ms: 10_000,
      max_items: 1,
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
    raw_blob_id: `sha256:${hash}` as RawBlobId,
    bytes: new Uint8Array(bytes),
    raw_content_sha256: hash,
    mime_type: "text/html; charset=utf-8",
    byte_length: bytes.byteLength,
    created_at: observedAt
  };
  const snapshot: Snapshot = {
    snapshot_id: "p2-04d-snapshot:d46a0d70-f9d4-46d9-a9ca-bd010d0caec4" as SnapshotId,
    recruitment_endpoint_id: BEIJING_PUBLIC_INSTITUTION_DETAIL_RECRUITMENT_ENDPOINT_ID,
    request_metadata: {
      locator: BEIJING_PUBLIC_INSTITUTION_DETAIL_ENDPOINT,
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
