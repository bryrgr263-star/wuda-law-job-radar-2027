import "../helpers/network-guard";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { JobDetails } from "../../components/job-board";
import type { PresentationDisplayJob } from "../../lib/presentation-web/model";

const publication = "https://em.seu.edu.cn/2026/0922/c57206a584203/page.htm";
const job: PresentationDisplayJob = { positionId: "TEST_ONLY-position", decisionId: "TEST_ONLY-decision", readModelId: "TEST_ONLY-model",
  revision: 1, status: "EVIDENCE_BLOCKED", reasonCodes: ["ELIGIBILITY_ASSESSMENT_MISSING"], employer: "用人单位", title: "法务岗",
  location: "北京", year: "2027", batch: "2027年度校园招聘", requirement: "尚未取得", announcementLink: publication,
  applicationLink: null, updatedAt: "2026-10-12T06:00:00.000Z" };
test("approved university publication displays publisher separately and keeps qualification review honest", () => {
  const html = renderToStaticMarkup(createElement(JobDetails, { job }));
  assert.match(html, /东南大学官方发布\/转载/);
  assert.match(html, /雇主原站及完整条件尚待复核/);
  assert.match(html, /用人单位/);
  assert.match(html, /证据待完善/);
  assert.doesNotMatch(html, /前往官方投递/);
});
test("unrelated employers and spoofed university domains are not relabeled", () => {
  for (const announcementLink of ["https://www.zhenghan.com/news/2790.html", "https://em.seu.edu.cn.evil.invalid/2026/0922/c57206a584203/page.htm"]) {
    const html = renderToStaticMarkup(createElement(JobDetails, { job: { ...job, announcementLink } }));
    assert.doesNotMatch(html, /东南大学官方发布\/转载/);
    assert.match(html, /查看招聘公告/);
  }
});
