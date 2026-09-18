import "../helpers/network-guard";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { evaluateSourceAutomationPermission } from "../../lib/application";
import type { HttpTransportRequest } from "../../lib/collection-runtime";
import {
  InMemoryRawBlobRepository,
  InMemorySnapshotRepository,
  RawCaptureService,
  type IsoDateTime,
  type RawContentSha256,
  type TransportRequest,
  type TransportResponse
} from "../../lib/ingestion";
import {
  ZHENGHAN_2027_ANNOUNCEMENT_URL,
  ZHENGHAN_2027_DETAIL_URL,
  ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID,
  ZHENGHAN_2027_TIMEOUT_MS,
  Zhenghan2027ApprovedOfficialTransport,
  Zhenghan2027OfficialHtmlAdapter,
  assertZhenghan2027ApprovedRequest,
  createZhenghan2027RecruitmentEndpoint,
  createZhenghan2027SourceAdmission,
  createZhenghan2027SourceVersions,
  zhenghanSourceRole
} from "../../lib/live-canary/real-2027-zhenghan";
import {
  assertOfficialRequestAllowed,
  assertSourcePersistenceVersion
} from "../../lib/production-persistence";

const now = "2026-09-16T12:00:00.000Z" as IsoDateTime;
const provenance = {
  scope: "PRODUCTION" as const,
  actor_id: "real-2027-source-test",
  actor_role: "TEST",
  evidence_references: ["test:real-2027-source-contract"]
};

test("formal Source Admission and two exact allowlists preserve approved scope", () => {
  const admission = createZhenghan2027SourceAdmission(now);
  const versions = createZhenghan2027SourceVersions({ observed_at: now, provenance });
  versions.forEach(assertSourcePersistenceVersion);
  assert.deepEqual(evaluateSourceAutomationPermission(admission), {
    allowed: true,
    admission_level: "B",
    mode: "ONE_ENDPOINT_ONE_RUN",
    requires_manual_authorization: true
  });
  const allowlists = versions.filter((version) => {
    return version.artifact.kind === "OFFICIAL_ENDPOINT_ALLOWLIST";
  });
  assert.equal(allowlists.length, 2);
  for (const url of [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL]) {
    const matches = allowlists.filter((version) => {
      if (version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") return false;
      try {
        assertOfficialRequestAllowed(version.artifact.payload, url, "GET");
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(matches.length, 1);
  }
  for (const version of allowlists) {
    assert.equal(version.artifact.kind, "OFFICIAL_ENDPOINT_ALLOWLIST");
    if (version.artifact.kind !== "OFFICIAL_ENDPOINT_ALLOWLIST") continue;
    const allowlist = version.artifact.payload;
    assert.equal(allowlist.exact_path, true);
    assert.throws(() => assertOfficialRequestAllowed(
      allowlist,
      "https://www.zhenghan.com/news/9999.html",
      "GET"
    ));
  }
});

test("approved transport performs only two exact credential-free requests", async () => {
  const observed: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  const transport = new Zhenghan2027ApprovedOfficialTransport(async (input, init) => {
    const url = String(input);
    observed.push({ url, init });
    return htmlResponse(url === ZHENGHAN_2027_ANNOUNCEMENT_URL
      ? announcementHtml() : detailHtml(), url);
  }, { now: () => now });
  for (const url of [ZHENGHAN_2027_ANNOUNCEMENT_URL, ZHENGHAN_2027_DETAIL_URL]) {
    const response = await transport.execute(request(url));
    assert.equal(response.status, "SUCCESS");
  }
  assert.deepEqual(observed.map((item) => item.url), [
    ZHENGHAN_2027_ANNOUNCEMENT_URL,
    ZHENGHAN_2027_DETAIL_URL
  ]);
  for (const item of observed) {
    assert.equal(item.init?.redirect, "manual");
    assert.equal(item.init?.credentials, "omit");
    assert.equal(new Headers(item.init?.headers).has("cookie"), false);
    assert.equal(new Headers(item.init?.headers).has("authorization"), false);
  }
  await assert.rejects(transport.execute(request(ZHENGHAN_2027_ANNOUNCEMENT_URL)));
  assert.throws(() => assertZhenghan2027ApprovedRequest({
    ...request(ZHENGHAN_2027_DETAIL_URL),
    locator: "https://www.zhenghan.com/news/9999.html"
  }));
});

test("adapter extracts package plus all three disclosed positions without silent drop", () => {
  const endpoint = createZhenghan2027RecruitmentEndpoint();
  const adapter = new Zhenghan2027OfficialHtmlAdapter();
  const raw = new InMemoryRawBlobRepository();
  const snapshots = new InMemorySnapshotRepository();
  let sequence = 0;
  const capture = new RawCaptureService(raw, snapshots, {
    create_snapshot_id: () => `snapshot-zhenghan-test-${++sequence}` as never
  });
  const outputs = [
    [ZHENGHAN_2027_ANNOUNCEMENT_URL, announcementHtml()],
    [ZHENGHAN_2027_DETAIL_URL, detailHtml()]
  ] as const;
  const records = outputs.flatMap(([url, html]) => {
    const requestValue: TransportRequest = {
      recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
      locator: url,
      method: "GET",
      requested_at: now,
      headers: {},
      parameters: {}
    };
    const bytes = new TextEncoder().encode(html);
    const captured = capture.record(requestValue, {
      status: "SUCCESS",
      responded_at: now,
      bytes,
      content_sha256: createHash("sha256").update(bytes).digest("hex") as
        RawContentSha256,
      mime_type: "text/html; charset=UTF-8",
      http_status: 200,
      headers: {}
    });
    return adapter.extract({ endpoint, ...captured });
  });
  assert.deepEqual(records.map((record) => record.raw_source_record_id), [
    "post-2782:announcement-package",
    "post-2790:dispute-resolution-lawyer",
    "post-2790:campus-long-term-intern-2027",
    "post-2790:short-term-intern-2028-plus"
  ]);
  assert.deepEqual(records.map(zhenghanSourceRole), [
    "PACKAGE", "POSITION_BEARING", "POSITION_BEARING", "POSITION_BEARING"
  ]);
  assert.equal(records[0]?.recruitment_context, undefined);
  const lawyer = records[1]!;
  assert.match(lawyer.raw_description?.text ?? "", /岗位要求/u);
  assert.match(lawyer.raw_requirement_text?.text ?? "", /具有商事诉讼\/仲裁案件出庭/u);
  assert.doesNotMatch(lawyer.raw_requirement_text?.text ?? "", /岗位要求/u);
  const target = records[2]!;
  assert.equal(target.recruitment_year?.text, "2027");
  assert.deepEqual(target.raw_location_text.map((item) => item.text), ["上海", "广州"]);
  assert.match(target.raw_description?.text ?? "", /实习要求/u);
  assert.match(target.raw_requirement_text?.text ?? "", /法学专业2027年应届/u);
  assert.match(target.raw_requirement_text?.text ?? "", /非法本研究生无需遵循此条/u);
  assert.match(target.raw_requirement_text?.text ?? "", /每周实习至少4天/u);
  assert.doesNotMatch(target.raw_requirement_text?.text ?? "", /实习要求/u);
  assert.doesNotMatch(target.raw_requirement_text?.text ?? "", /工作地点/u);
  assert.doesNotMatch(target.raw_requirement_text?.text ?? "", /留用机会/u);
  const shortTerm = records[3]!;
  assert.doesNotMatch(shortTerm.raw_requirement_text?.text ?? "", /工作地点/u);
  assert.doesNotMatch(shortTerm.raw_requirement_text?.text ?? "", /留用机会/u);
});

function request(locator: string): HttpTransportRequest {
  return {
    recruitment_endpoint_id: ZHENGHAN_2027_RECRUITMENT_ENDPOINT_ID,
    locator,
    method: "GET",
    requested_at: now,
    headers: {},
    parameters: {},
    timeout_ms: ZHENGHAN_2027_TIMEOUT_MS
  };
}

function htmlResponse(body: string, url: string) {
  const bytes = new TextEncoder().encode(body);
  const response = new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "content-length": String(bytes.byteLength)
    }
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function announcementHtml() {
  return `<!doctype html><html><body>
    <h1 class="entry-title">虹桥正瀚举办2026开放日活动 | 暨2027届校园招聘正式启动</h1>
    <time class="entry-date">2026-05-13</time>
    <article id="post-2782"><div class="entry-content">
      <p>本次活动也同时拉开了2027届校园招聘工作的序幕。</p>
      <p>2027届校园招聘已正式启动，详情请见今日发布的另一篇文章。</p>
    </div></article></body></html>`;
}

function detailHtml() {
  return `<!doctype html><html><body>
    <h1 class="entry-title">【正瀚纳贤】招聘岗位 | 2026年5月</h1>
    <time class="entry-date">2026-05-13</time>
    <article id="post-2790"><div class="entry-content">
      <h2>社招岗位</h2><h3>争议解决律师</h3><p>工作地点：广州</p><p>岗位要求：</p>
      <p>1.拥有国内外知名院校的法学专业本硕学历；</p>
      <p>2.拥有3-5年律师工作经验，并持有律师执业证；</p>
      <p>3.法律专业基础扎实，有优秀的逻辑思辨能力，过硬的文书写作和表达能力，良好的沟通协作能力；</p>
      <p>4.对于商事争议解决领域有强烈志趣，愿意深耕争议解决律师职业，工作踏实勤勉，细致谨慎，有韧劲和恒心；</p>
      <p>5.具有商事诉讼/仲裁案件出庭并担任主要代理人的经验，具备独立出庭代理能力，有一定的客户服务和市场拓展能力；</p>
      <p>6.认同公司制律所的文化和价值观念。</p>
      <h2>校招岗位</h2><h3>长期实习生</h3>
      <p>（有留用机会、2027年应届毕业生）</p><p>工作地点：上海、广州（两地择一）</p>
      <p>留用岗位：培训生</p><p>实习要求：</p>
      <p>1.国内外知名院校法学专业2027年应届在校本科生或研究生；</p>
      <p>2.曾有法律相关岗位实习经历者/通过国家法律职业资格考试（本科生/非法本研究生无需遵循此条）优先；</p>
      <p>3.在校期间成绩优秀，具有极强的法律思维和运用能力；</p>
      <p>4.对法律工作有高度热情，热爱并计划长期致力于复杂争议解决领域发展；</p>
      <p>5.工作细致认真、具有优秀的沟通能力及团队合作精神，抗压能力强；</p>
      <p>6.每周实习至少4天，全勤更佳且能完整实习3个月或以上（如海外归国应届毕业生有特殊情况，可视情况安排）。</p>
      <h3>短期实习生</h3><p>无留用机会</p><p>工作地点：上海、广州（两地择一）</p><p>实习要求：</p>
      <p>1.国内外知名院校法学专业2028届及之后的在校本科生或研究生；</p>
      <p>2.曾有国内外著名律所或企业法律相关岗位实习经历者/通过国家法律职业资格考试（本科生/非法本研究生无需遵循此条）优先；</p>
      <p>3.在校期间专业成绩优秀，具有较强的法律思维和运用能力；</p>
      <p>4.对法律工作有高度热情，热爱并计划长期致力于在律师行业发展；</p>
      <p>5.工作细致认真、具有优秀的沟通能力及团队合作精神，抗压能力较强；</p>
      <p>6.每周实习至少3天，且能完整实习3个月或以上。</p>
      <h2>让我们看到你</h2>
    </div></article></body></html>`;
}
