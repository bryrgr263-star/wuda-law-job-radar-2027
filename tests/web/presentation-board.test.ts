import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const jobsPromise = import("../../lib/presentation-web/loader").then((module) => module.loadPresentationBoard(process.cwd()));

test("committed Run 1 current models render four honest cards without fabricated application links", async () => {
  const { JobBoard } = await import("../../components/job-board");
  const jobs = await jobsPromise;
  assert.equal(jobs.length, 4);
  assert.equal(new Set(jobs.map((job) => job.positionId)).size, 4);
  assert.ok(jobs.every((job) => job.status === "EVIDENCE_BLOCKED"));
  assert.ok(jobs.every((job) => job.reasonCodes.includes("RELEVANCE_ASSESSMENT_MISSING")));
  assert.equal(jobs.filter((job) => job.applicationLink === null).length, 3);
  assert.ok(jobs.every((job) => job.announcementLink));
  const html = renderToStaticMarkup(createElement(JobBoard, { initialJobs: jobs }));
  assert.equal((html.match(/class="job-card"/gu) ?? []).length, 4);
  assert.equal((html.match(/投递链接尚未取得/gu) ?? []).length, 3);
  assert.ok(html.includes("证据待完善"));
  assert.ok(!html.includes("不符合"));
});

test("display-only search, status filter, deterministic sort and CSV retain blocked records", async () => {
  const { selectBoardJobs, exportBoardCsv } = await import("../../lib/presentation-web/model");
  const jobs = await jobsPromise;
  assert.equal(selectBoardJobs(jobs, "海尔", "ALL", "title").length, 1);
  assert.equal(selectBoardJobs(jobs, "", "EVIDENCE_BLOCKED", "updated").length, 4);
  assert.equal(selectBoardJobs(jobs, "", "DISPLAY", "updated").length, 0);
  assert.deepEqual(selectBoardJobs(jobs, "", "ALL", "title"), selectBoardJobs([...jobs].reverse(), "", "ALL", "title"));
  const csv = exportBoardCsv(jobs);
  assert.ok(csv.includes("RELEVANCE_ASSESSMENT_MISSING"));
  assert.ok(csv.includes("证据待完善"));
});

test("each real detail retains decision IDs and reasons, missing requirements and distinct links", async () => {
  const { JobDetails } = await import("../../components/job-board");
  const jobs = await jobsPromise;
  for (const job of jobs) {
    const html = renderToStaticMarkup(createElement(JobDetails, { job }));
    assert.ok(html.includes(job.positionId));
    assert.ok(html.includes(job.decisionId));
    assert.ok(html.includes("RELEVANCE_ASSESSMENT_MISSING"));
    assert.ok(html.includes("尚未取得"));
    assert.ok(html.includes(`href="${job.announcementLink}"`));
    assert.equal(html.includes("前往官方投递"), job.applicationLink !== null);
  }
});

test("public API and page loader share the current repository without special Run 1 handling", async () => {
  const { composeGitReadOnlyPresentationApi } = await import("../../lib/presentation-read-api/git-runtime");
  const api = composeGitReadOnlyPresentationApi(process.cwd(), "initial-production-source-activation");
  const response = await api.handle(new Request("http://presentation.local/api/presentation/v1/opportunities"));
  assert.equal(response.status, 200);
  const body = await response.json();
  const jobs = await jobsPromise;
  assert.deepEqual(body.opportunities.map((item: { presentation_decision_id: string }) => item.presentation_decision_id).sort(),
    jobs.map((job) => job.decisionId).sort());
  const candidateId = body.opportunities.find((item: { position_id: string }) => item.position_id === jobs[0].positionId).opportunity_candidate_id;
  const detail = await api.handle(new Request(`http://presentation.local/api/presentation/v1/opportunities/${encodeURIComponent(candidateId)}`));
  assert.equal(detail.status, 200);
  const source = readFileSync("lib/presentation-web/loader.ts", "utf8");
  assert.doesNotMatch(source, /readFile|Run.?1|revision.?2|RELEVANCE_ASSESSMENT_MISSING|\.json["']/);
});

test("display functions retain all permitted statuses and protect exported spreadsheet cells", async () => {
  const { selectBoardJobs, exportBoardCsv } = await import("../../lib/presentation-web/model");
  const [job] = await jobsPromise;
  const items = (["DISPLAY", "DISPLAY_WITH_REVIEW", "EVIDENCE_BLOCKED"] as const)
    .map((status) => ({ ...job, status, title: "=UNTRUSTED()", positionId: status }));
  assert.equal(selectBoardJobs(items, "", "ALL", "updated").length, 3);
  assert.equal(selectBoardJobs(items, "", "ALL", "updated", "unknown employer").length, 0);
  assert.ok(exportBoardCsv(items).includes("'=UNTRUSTED()"));
});

test("explicit preparation page and existing API route load committed Git data with network disabled", async () => {
  const previous = process.env.PRESENTATION_WEB_PREPARATION;
  process.env.PRESENTATION_WEB_PREPARATION = "ENABLED";
  try {
    const { default: HomePage } = await import("../../app/page");
    const html = renderToStaticMarkup(await HomePage());
    assert.equal((html.match(/class="job-card"/gu) ?? []).length, 4);
    assert.ok(html.includes("准备模式"));
    const { GET } = await import("../../app/api/presentation/v1/[...segments]/route");
    const response = await GET(new Request("http://presentation.local/api/presentation/v1/opportunities"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).pagination.total, 4);
  } finally {
    if (previous === undefined) delete process.env.PRESENTATION_WEB_PREPARATION;
    else process.env.PRESENTATION_WEB_PREPARATION = previous;
  }
});

test("new Web branch has no legacy truth, Supabase, business evaluators or network acquisition", () => {
  for (const file of ["components/job-board.tsx", "lib/presentation-web/model.ts", "lib/presentation-web/loader.ts", "lib/presentation-read-api/git-runtime.ts"]) {
    const source = readFileSync(path.resolve(file), "utf8");
    assert.doesNotMatch(source, /match_score|non_law_rule|is_published|supabase|\/api\/jobs|lib\/jobs|CandidateProfile|create.*Eligibility|create.*Relevance/u);
  }
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /PRESENTATION_WEB_PREPARATION/);
  assert.match(page, /=== "ENABLED"/);
  assert.match(page, /revalidate = 300/);
  assert.match(page, /noStore\(\)/);
  const reader = readFileSync("lib/presentation-read-api/git-runtime.ts", "utf8");
  assert.match(reader, /store\.readCurrentSnapshot\(\)/);
  assert.doesNotMatch(reader, /appendExecution|\.materialize\(|bootstrapTrusted|fetch\(|production-ingestion|shadow-runtime/);
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.presentation-board \.section-heading \.secondary-button \{[^}]*color: var\(--navy\)/);
});
