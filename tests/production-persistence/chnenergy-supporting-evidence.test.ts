import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { ChnenergySupportingEvidenceAdapter, chnenergySupportingEndpoint } from "../../lib/production-sources/chnenergy-supporting-evidence";
import { CHNENERGY_CAMPAIGN_URL, CHNENERGY_JOBS } from "../../lib/production-sources/chnenergy-2027-source";
import { InMemoryRawBlobRepository, InMemorySnapshotRepository, RawCaptureService } from "../../lib/ingestion";

const at = "2026-10-09T00:00:00.000Z";
const campaignId = "6a152f40-7fe5-460e-ad37-0024acafd8c9";
const campaign = `<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p><div id="anncTxt"><p>TEST_ONLY 年龄条件必须保留</p><a href="/annc/showggStationList?id=${campaignId}">招聘岗位</a></div>`;
function capture(url: string, html: string) {
  const endpoint = chnenergySupportingEndpoint(url);
  const bytes = new TextEncoder().encode(html);
  const receipt = new RawCaptureService(new InMemoryRawBlobRepository(), new InMemorySnapshotRepository()).record({
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id, locator: url, requested_at: at as never,
    method: "GET", headers: {}, parameters: {} }, { status: "SUCCESS", responded_at: at as never, bytes,
    mime_type: "text/html;charset=UTF-8", http_status: 200, headers: {},
    content_sha256: createHash("sha256").update(bytes).digest("hex") as never });
  return { endpoint, snapshot: receipt.snapshot, raw_blob: receipt.raw_blob };
}
test("support campaign preserves general conditions without issuing position or qualification", () => {
  const adapter = new ChnenergySupportingEvidenceAdapter();
  const input = capture(CHNENERGY_CAMPAIGN_URL, campaign);
  assert.equal(adapter.plan(input.endpoint).length, 1);
  const records = adapter.extract(input);
  assert.equal(records.length, 1);
  assert.match(records[0]!.raw_description!.text, /年龄条件必须保留/);
  assert.equal(records[0]!.recruitment_year, undefined);
  assert.equal(records[0]!.recruitment_context, undefined);
  assert.equal(records[0]!.application_url, undefined);
  assert.equal(records[0]!.adapter_metadata[adapter.descriptor.adapter_key]!.source_role, "PACKAGE");
  assert.equal(adapter.assessCompleteness({ records, snapshots: [input.snapshot], extraction_errors: [] }).status, "COMPLETE");
  assert.deepEqual(adapter.extract(input), records);
});
for (const job of CHNENERGY_JOBS) {
  test(`support membership exact chain ${job.title}`, () => {
    const html = `<form id="annclistform" action="/annc/showggStationList"><input type="hidden" name="id" value="${campaignId}"></form><div class="list-group-item"><h4><a href="${job.url}">${job.title}</a></h4><p class="list-group-item-text"><span title="${job.employer}">单位</span></p></div>`;
    const adapter = new ChnenergySupportingEvidenceAdapter();
    assert.equal(adapter.extract(capture(job.membership_url, html)).length, 1);
    assert.throws(() => adapter.extract(capture(job.membership_url, html.replace(job.id, "unapproved"))));
  });
}
test("support surface refuses empty/ambiguous content and unauthorized targets", () => {
  const adapter = new ChnenergySupportingEvidenceAdapter();
  assert.throws(() => adapter.extract(capture(CHNENERGY_CAMPAIGN_URL, "<p>login</p>")));
  assert.throws(() => adapter.extract(capture(CHNENERGY_CAMPAIGN_URL, campaign + campaign)));
  assert.throws(() => chnenergySupportingEndpoint(CHNENERGY_CAMPAIGN_URL + "&page=2"));
  const input = capture(CHNENERGY_CAMPAIGN_URL, campaign);
  assert.equal(adapter.validateEndpoint({ ...input.endpoint, collection_config: { ...input.endpoint.collection_config, retry_limit: 1 } }).valid, false);
  assert.equal(adapter.assessCompleteness({ records: [], snapshots: [input.snapshot], extraction_errors: [] }).status, "FAILED");
});
test("support adapter rejects tampered capture and missing campaign body", () => {
  const adapter = new ChnenergySupportingEvidenceAdapter();
  const input = capture(CHNENERGY_CAMPAIGN_URL, campaign);
  assert.throws(() => adapter.extract({ ...input, raw_blob: { ...input.raw_blob!, bytes: new TextEncoder().encode(campaign.replace("年龄", "伪造")) } }));
  assert.throws(() => adapter.extract({ ...input, snapshot: { ...input.snapshot, request_metadata: { ...input.snapshot.request_metadata, method: "POST" } } }));
  assert.throws(() => adapter.extract(capture(CHNENERGY_CAMPAIGN_URL, '<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p>')));
});
test("support capture rejects forged content address and link-only announcement", () => {
  const adapter = new ChnenergySupportingEvidenceAdapter();
  const input = capture(CHNENERGY_CAMPAIGN_URL, campaign);
  assert.throws(() => adapter.extract({ ...input, raw_blob: { ...input.raw_blob!, raw_blob_id: `sha256:${"0".repeat(64)}` as never },
    snapshot: { ...input.snapshot, raw_blob_id: `sha256:${"0".repeat(64)}` as never } }));
  assert.throws(() => adapter.extract(capture(CHNENERGY_CAMPAIGN_URL, campaign.replace('<p>TEST_ONLY 年龄条件必须保留</p>', ''))));
});

const outsideBodyCampaign = `<p class="lead text-center">国家能源投资集团有限责任公司2027年度高校毕业生统招公告</p><div id="anncTxt"><p>TEST_ONLY 年龄条件必须保留</p></div><a href="/annc/showggStationList?id=${campaignId}">招聘职位列表</a>`;

test("opt-in supporting parser accepts one exact page-global link outside announcement prose", () => {
  const adapter = new ChnenergySupportingEvidenceAdapter("1.1.0");
  const input = capture(CHNENERGY_CAMPAIGN_URL, outsideBodyCampaign);
  const records = adapter.extract(input);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.extraction.extractor_version, "1.1.0");
  assert.match(records[0]!.raw_description!.text, /年龄条件必须保留/);
  assert.equal(records[0]!.recruitment_context, undefined);
  assert.deepEqual(adapter.extract(input), records);
});

test("opt-in supporting parser rejects duplicate or wrong global links and empty prose", () => {
  const adapter = new ChnenergySupportingEvidenceAdapter("1.1.0");
  for (const html of [
    outsideBodyCampaign + `<a href="/annc/showggStationList?id=${campaignId}">重复</a>`,
    outsideBodyCampaign.replace(campaignId, "unapproved"),
    outsideBodyCampaign.replace('<p>TEST_ONLY 年龄条件必须保留</p>', '<script>fake prose</script><style>fake prose</style>'),
    outsideBodyCampaign.replace('<div id="anncTxt">', '<div>'),
    outsideBodyCampaign + '<div id="anncTxt">重复正文</div>'
  ]) assert.throws(() => adapter.extract(capture(CHNENERGY_CAMPAIGN_URL, html)));
});

test("default supporting parser preserves historical v1 output and rejection", () => {
  const input = capture(CHNENERGY_CAMPAIGN_URL, campaign);
  const historical = new ChnenergySupportingEvidenceAdapter();
  assert.deepEqual(historical.extract(input), new ChnenergySupportingEvidenceAdapter("1.0.0").extract(input));
  assert.equal(historical.descriptor.version, "1.0.0");
  assert.throws(() => historical.extract(capture(CHNENERGY_CAMPAIGN_URL, outsideBodyCampaign)));
});
