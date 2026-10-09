import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as national from "../../lib/production-sources/chnenergy-2027-source";
import { InMemoryRawBlobRepository, InMemorySnapshotRepository, RawCaptureService,
  type RecruitmentAdapter } from "../../lib/ingestion";
import { canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createExtractedRecordV2 } from "../../lib/ingestion/normalization/extracted-record-identity";
import { verifyNationalCampaignBinding } from "../../lib/ingestion/pipeline/national-campaign-binding";
import { resolveProductionAdapter } from "../../lib/production-automation/production-adapter-registry";

const at = "2026-10-06T07:00:00.000Z";
function input(index = 0, project = true) {
  const job = national.CHNENERGY_JOBS[index]!;
  const endpoint = national.chnenergyEndpoint(job);
  const html = `<title>岗位详情</title><button onclick="${project ? `apply('${job.id}','e929662a-324a-47d0-b4ca-9fe5ef47b8ba')` : "grey5()"}">申请</button>
<div><h4 class="listTitle">岗位基本信息</h4></div><ul><li>招聘单位：${job.employer}</li><li>招聘岗位：${job.title}</li><li>工作地点：${job.location}</li></ul>
<div><h4 class="listTitle">岗位职责</h4></div><ol><li><div id="descDetail">TEST_ONLY职责</div></li></ol>
<div><h4 class="listTitle">岗位要求</h4></div><ul><li>学历要求：硕士研究生</li><li>专业要求：法学</li><li>TEST_ONLY附加要求</li></ul>`;
  const bytes = new TextEncoder().encode(html);
  const captured = new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository()).record({
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: endpoint.locator, requested_at: at as never,
    method: "GET", headers: {}, parameters: {} }, { status: "SUCCESS", responded_at: at as never, bytes,
    mime_type: "text/html;charset=UTF-8", http_status: 200, headers: {},
    content_sha256: createHash("sha256").update(bytes).digest("hex") as never });
  return { endpoint, snapshot: { ...captured.snapshot, snapshot_id: `TEST_ONLY:baseline:${index}` as never }, raw_blob: captured.raw_blob };
}
const refs = { campaign: { snapshot_id: "TEST_ONLY:campaign", extracted_record_id: "TEST_ONLY:campaign-record", raw_sha256: "a".repeat(64) },
  membership: { snapshot_id: "TEST_ONLY:member", extracted_record_id: "TEST_ONLY:member-record", raw_sha256: "b".repeat(64) } };
function v2(references?: unknown): RecruitmentAdapter {
  const Constructor = (national as unknown as { Chnenergy2027CampaignHtmlAdapter?: new (references: unknown) => RecruitmentAdapter }).Chnenergy2027CampaignHtmlAdapter;
  assert.ok(Constructor, "explicit v2 adapter must exist");
  return new Constructor(arguments.length ? references : refs);
}

test("v1 canonical synthetic output bytes stay pinned for both jobs", () => {
  for (let index = 0; index < 2; index++) {
    const bytes = canonicalSerialize(new national.Chnenergy2027HtmlAdapter().extract(input(index)));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), [
      "c0ad985ee5c82e524838c96b12b1e27a0bc9c52fbde3fc1fe45cceb39b1fbd73",
      "9272a5204fbcbf2501c033dbaa50d1aeed4c74f2d62fab79a22320cd7c9c6fc3"
    ][index]);
  }
});
test("explicit v2 emits detail and ordinary references without inventing campaign claims", () => {
  const adapter = v2();
  const records = adapter.extract(input(0, false));
  assert.equal(adapter.descriptor.version, "2.0.0");
  assert.equal(new national.Chnenergy2027HtmlAdapter().descriptor.version, "1.0.0");
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.recruitment_year, undefined);
    assert.equal(record.recruitment_batch, undefined);
    assert.equal(record.recruitment_context, undefined);
    assert.equal(record.deadline, undefined);
    assert.equal(record.publish_time, undefined);
    assert.deepEqual(record.adapter_metadata[national.CHNENERGY_ADAPTER_KEY], {
      binding_contract_version: "national-campaign-membership/1.0.0", ...refs });
    assert.equal(record.application_url, national.CHNENERGY_JOBS[0]!.url);
  }
  assert.match(records[1]!.raw_requirement_text!.text, /TEST_ONLY附加要求/);
  assert.notEqual(adapter.assessCompleteness({ records, snapshots: [input(0, false).snapshot], extraction_errors: [] } as never).status, "COMPLETE");
});
for (const references of [undefined, {}, { ...refs, verified: true }, { ...refs, campaign: { ...refs.campaign, raw_sha256: "bad" } },
  { ...refs, membership: refs.campaign }]) {
  test(`v2 rejects unsupported references ${JSON.stringify(references)}`, () => {
    assert.throws(() => v2(references).extract(input(0, false)));
  });
}
test("v1 still rejects missing project button while v2 rejects tampered Raw", () => {
  assert.throws(() => new national.Chnenergy2027HtmlAdapter().extract(input(0, false)), /BINDING/);
  const source = input(0, false);
  assert.throws(() => v2().extract({ ...source, raw_blob: { ...source.raw_blob!, bytes: new Uint8Array([1]) } }), /MISMATCH/);
});

test("ordinary v2 references cannot pass the root proof gate or silently replace registered v1", async () => {
  const source = input(0, false);
  const record = v2().extract(source)[0]!;
  const extracted = createExtractedRecordV2(source.snapshot, { ...record,
    extraction: { ...record.extraction, schema_version: `${national.CHNENERGY_ADAPTER_KEY}-extracted-record/2.0.0` } });
  await assert.rejects(verifyNationalCampaignBinding({ endpoint: source.endpoint, snapshot: source.snapshot,
    extracted_record: extracted, source_role: "PACKAGE" }, "SYNTHETIC_TEST", undefined), /reader/);
  assert.equal(resolveProductionAdapter(national.CHNENERGY_ADAPTER_KEY)!.descriptor.version, "1.0.0");
});

test("v2 snapshots references defensively and refuses detail/dependency collision", () => {
  const mutable = structuredClone(refs);
  const adapter = v2(mutable);
  mutable.campaign.raw_sha256 = "c".repeat(64);
  const record = adapter.extract(input(0, false))[0]!;
  assert.deepEqual(record.adapter_metadata[national.CHNENERGY_ADAPTER_KEY]!.campaign, refs.campaign);
  assert.throws(() => v2({ ...refs, campaign: { ...refs.campaign, snapshot_id: input().snapshot.snapshot_id } })
    .extract(input(0, false)), /COLLISION/);
});
