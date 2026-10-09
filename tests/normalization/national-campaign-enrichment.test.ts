import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as binding from "../../lib/ingestion/pipeline/national-campaign-binding";
import { createExtractedRecordV2 } from "../../lib/ingestion/normalization/extracted-record-identity";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import type { SOVDiscoveryEvidence } from "../../lib/ingestion/normalization/source-discovery-support";
import { Chnenergy2027CampaignHtmlAdapter, CHNENERGY_JOBS, chnenergyEndpoint } from "../../lib/production-sources/chnenergy-2027-source";
import type { ExtractedRecord } from "../../lib/ingestion";
import { trustedFixture } from "../pipeline/position-bound-phase-fixture";

const key = "cn-chnenergy-2027-reviewed-official-html";
const campaignId = "6a152f40-7fe5-460e-ad37-0024acafd8c9";
const origin = "https://zhaopin.chnenergy.com.cn";
const campaignHtml = `<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p><p>TEST_ONLY通用条件与年龄截止2027年7月31日</p><a href="/annc/showggStationList?id=${campaignId}">岗位</a>`;
const job = CHNENERGY_JOBS[0]!;
const memberHtml = `<form id="annclistform" action="/annc/showggStationList"><input type="hidden" name="id" value="${campaignId}"></form><ul><li class="list-group-item"><a href="/annc/showgw?id=${job.id}">${job.title}</a></li></ul>`;

function fixture(role: "PACKAGE" | "POSITION_BEARING" = "POSITION_BEARING") {
  const source = trustedFixture("national-enrichment-TEST_ONLY").source;
  const sourceReference = { artifact_id: "TEST_ONLY:source", integrity_hash: canonicalHash("TEST_ONLY:source") };
  const evidence = (name: string, locator: string, body: string): SOVDiscoveryEvidence => {
    const bytes = new TextEncoder().encode(body);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const endpoint = { ...chnenergyEndpoint(job), locator };
    const snapshot = { ...source.snapshot, recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      snapshot_id: `TEST_ONLY:enrichment:${name}` as never, transport_status: "SUCCESS" as const,
      raw_blob_id: `sha256:${hash}` as never, content_hash: hash as never, content_length: bytes.length,
      request_metadata: { ...source.snapshot.request_metadata, method: "GET" as const, locator },
      response_metadata: { ...source.snapshot.response_metadata, mime_type: "text/html;charset=UTF-8", content_length: bytes.length } };
    const record = createExtractedRecordV2(snapshot, { ...source.extracted_record,
      source_definition_id: endpoint.source_definition_id,
      extraction: { extractor_name: "TEST_ONLY", extractor_version: "1.0.0", schema_version: "TEST_ONLY/1.0.0" } });
    return { scope: "SYNTHETIC_TEST", endpoint, snapshot, extracted_record: record,
      raw_blob: { raw_blob_id: snapshot.raw_blob_id, bytes, sha256: hash, byte_length: bytes.length, content_type: "text/html;charset=UTF-8" },
      acquisition: { acquisition_run_id: `TEST_ONLY:${name}`, integrity_hash: canonicalHash(name), complete: true, status: "SUCCESS" },
      source_reference: { source_definition: sourceReference, endpoint: sourceReference, admission: sourceReference,
        allowlist: sourceReference, authority_level: "OFFICIAL" } };
  };
  const campaign = evidence("campaign", `${origin}/annc/showgg?id=${campaignId}`, campaignHtml);
  const membership = evidence("membership", job.membership_url, memberHtml);
  const detailHtml = `<title>岗位详情</title><button onclick="grey5()">申请</button><div><h4 class="listTitle">岗位基本信息</h4></div><ul><li>招聘单位：${job.employer}</li><li>招聘岗位：${job.title}</li><li>工作地点：${job.location}</li></ul><div><h4 class="listTitle">岗位职责</h4></div><ol><li><div id="descDetail">TEST_ONLY职责</div></li></ol><div><h4 class="listTitle">岗位要求</h4></div><ul><li>学历要求：硕士研究生</li><li>专业要求：法学</li></ul>`;
  const detail = evidence("detail", job.url, detailHtml);
  const reference = (item: SOVDiscoveryEvidence) => ({ snapshot_id: item.snapshot.snapshot_id,
    extracted_record_id: item.extracted_record.extracted_record_id, raw_sha256: item.raw_blob.sha256 });
  const records = new Chnenergy2027CampaignHtmlAdapter({ campaign: reference(campaign), membership: reference(membership) }).extract({
    endpoint: detail.endpoint, snapshot: detail.snapshot, raw_blob: { raw_blob_id: detail.snapshot.raw_blob_id!, bytes: detail.raw_blob.bytes,
      raw_content_sha256: detail.raw_blob.sha256 as never, byte_length: detail.raw_blob.byte_length,
      mime_type: detail.raw_blob.content_type, created_at: detail.snapshot.observed_at } });
  const input = { source_role: role, endpoint: detail.endpoint, snapshot: detail.snapshot, extracted_record: records[role === "PACKAGE" ? 0 : 1]! };
  const retained = [campaign, membership];
  const calls: string[] = [];
  const reader = async (snapshotId: string, recordId: string) => {
    calls.push(snapshotId);
    const matches = retained.filter(item => item.snapshot.snapshot_id === snapshotId && item.extracted_record.extracted_record_id === recordId);
    if (matches.length !== 1) throw new Error("EVIDENCE_BLOCKED: missing retained proof");
    return structuredClone(matches[0]!);
  };
  const replace = (index: number, body: string) => {
    const current = retained[index]!;
    const bytes = new TextEncoder().encode(body);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const snapshot = { ...current.snapshot, transport_status: "SUCCESS" as const, raw_blob_id: `sha256:${hash}` as never, content_hash: hash as never,
      content_length: bytes.length, response_metadata: { ...current.snapshot.response_metadata, content_length: bytes.length } };
    retained[index] = { ...current, snapshot, extracted_record: createExtractedRecordV2(snapshot, current.extracted_record),
      raw_blob: { ...current.raw_blob, bytes, raw_blob_id: snapshot.raw_blob_id, sha256: hash, byte_length: bytes.length } };
    const metadata = input.extracted_record.adapter_metadata[key]!;
    input.extracted_record = { ...input.extracted_record, adapter_metadata: { [key]: { ...metadata,
      [index ? "membership" : "campaign"]: reference(retained[index]!) } } };
  };
  return { input, retained, calls, reader, replace, detail };
}

async function prepare(input: ReturnType<typeof fixture>["input"], reader?: ReturnType<typeof fixture>["reader"]): Promise<ExtractedRecord> {
  const helper = (binding as unknown as { prepareNationalCampaignRecord?: (input: unknown, scope: string, reader: unknown) => Promise<ExtractedRecord> }).prepareNationalCampaignRecord;
  assert.ok(helper, "root-owned campaign preparation helper must exist");
  return helper(input, "SYNTHETIC_TEST", reader);
}

for (const role of ["PACKAGE", "POSITION_BEARING"] as const) {
  test(`preparation derives only campaign claims for ${role} and final gate rereads all persisted surfaces`, async () => {
    const current = fixture(role);
    const before = canonicalHash(current.input);
    const record = await prepare(current.input, current.reader);
    assert.equal(canonicalHash(current.input), before);
    assert.equal(record.recruitment_year?.text, "2027");
    assert.equal(record.recruitment_batch?.text, "国家能源投资集团有限责任公司2027年度高校毕业生统招");
    assert.equal(record.recruitment_context?.recruitment_plan, undefined);
    assert.equal(record.deadline, undefined);
    assert.equal(record.publish_time, undefined);
    assert.deepEqual(record.raw_requirement_text, current.input.extracted_record.raw_requirement_text);
    assert.equal(record.recruitment_context?.position?.identity_state, role === "PACKAGE" ? undefined : "CONFIRMED");
    assert.equal("semantic_hash" in record, false);
    assert.equal("verified" in record, false);
    const canonical = createExtractedRecordV2(current.input.snapshot, { ...record,
      extraction: { ...record.extraction, schema_version: `${key}-extracted-record/2.0.0` } });
    current.retained.push({ ...current.detail, extracted_record: canonical });
    current.calls.length = 0;
    await binding.verifyNationalCampaignBinding({ ...current.input, extracted_record: canonical }, "SYNTHETIC_TEST", current.reader);
    assert.deepEqual(new Set(current.calls), new Set(current.retained.map(item => item.snapshot.snapshot_id)));
    current.retained.splice(0, 1);
    await assert.rejects(binding.verifyNationalCampaignBinding({ ...current.input, extracted_record: canonical }, "SYNTHETIC_TEST", current.reader));
  });
}

const rejected: readonly [string, (current: ReturnType<typeof fixture>) => void][] = [
  ["missing campaign", current => { current.retained.splice(0, 1); }],
  ["tampered bytes", current => { current.retained[0]!.raw_blob.bytes[0] ^= 1; }],
  ["cross scope", current => { current.retained[0] = { ...current.retained[0]!, scope: "PRODUCTION" }; }],
  ["incomplete receipt", current => { const item = current.retained[0]!; current.retained[0] = { ...item, acquisition: { ...item.acquisition, complete: false } }; }],
  ["wrong year", current => current.replace(0, campaignHtml.replaceAll("2027", "2028"))],
  ["ambiguous heading", current => current.replace(0, campaignHtml + '<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p>')],
  ["wrong job", current => current.replace(1, memberHtml.replace(job.id, CHNENERGY_JOBS[1]!.id))],
  ["wrong form campaign", current => current.replace(1, memberHtml.replace(campaignId, job.id))],
  ["wrong job title", current => current.replace(1, memberHtml.replace(job.title, "其他岗位"))],
  ["ambiguous membership", current => current.replace(1, memberHtml + `<li class="list-group-item"><a href="${job.url}">${job.title}</a></li>`)],
  ["wrong exact URL", current => { const item = current.retained[0]!; current.retained[0] = { ...item,
    endpoint: { ...item.endpoint, locator: item.endpoint.locator + "&extra=1" },
    snapshot: { ...item.snapshot, request_metadata: { ...item.snapshot.request_metadata, locator: item.endpoint.locator + "&extra=1" } } }; }],
  ["wrong source", current => { const item = current.retained[0]!; current.retained[0] = { ...item, endpoint: { ...item.endpoint, source_definition_id: "wrong" as never } }; }],
  ["inconsistent source proof", current => { const item = current.retained[1]!; current.retained[1] = { ...item,
    source_reference: { ...item.source_reference, source_definition: { artifact_id: "other", integrity_hash: canonicalHash("other") } } }; }],
  ["forged SHA", current => { const metadata = current.input.extracted_record.adapter_metadata[key]!; current.input.extracted_record = {
    ...current.input.extracted_record, adapter_metadata: { [key]: { ...metadata, campaign: { ...(metadata.campaign as object), raw_sha256: "c".repeat(64) } } } }; }],
  ["caller verified flag", current => { const metadata = current.input.extracted_record.adapter_metadata[key]!; current.input.extracted_record = {
    ...current.input.extracted_record, adapter_metadata: { [key]: { ...metadata, verified: true } } }; }],
  ["historical v1", current => { current.input.extracted_record = { ...current.input.extracted_record,
    extraction: { ...current.input.extracted_record.extraction, extractor_version: "1.0.0" } }; }],
  ["preexisting year", current => { current.input.extracted_record = { ...current.input.extracted_record, recruitment_year: { text: "2028", encoding: "UTF-8" } }; }],
  ["unsupported date", current => { current.input.extracted_record = { ...current.input.extracted_record, deadline: { text: "2027-07-31", encoding: "UTF-8" } }; }],
  ["wrong ordinary occurrence", current => { current.input.extracted_record = { ...current.input.extracted_record,
    raw_source_record_id: `chnenergy:${CHNENERGY_JOBS[1]!.id}:position` }; }],
  ["unsupported ordinary schema", current => { current.input.extracted_record = { ...current.input.extracted_record,
    extraction: { ...current.input.extracted_record.extraction, schema_version: "unreviewed" } } as ExtractedRecord; }]
];
for (const [name, mutate] of rejected) {
  test(`preparation rejects ${name}`, async () => {
    const current = fixture();
    mutate(current);
    await assert.rejects(prepare(current.input, current.reader));
  });
}
test("preparation requires the existing reader", async () => {
  await assert.rejects(prepare(fixture().input));
});
