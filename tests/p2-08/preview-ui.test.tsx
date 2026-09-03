import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import { GET as readOnlyRoute } from "../../app/api/ingestion/v1/[...segments]/route";
import PreviewPage from "../../app/preview/page";
import PreviewOpportunityPage from "../../app/preview/opportunities/[opportunityId]/page";
import {
  OpportunityDetailView,
  type OpportunityDetailViewProps
} from "../../lib/p2-08-preview/presentation";
import {
  loadPreviewOpportunity,
  loadPreviewOpportunities
} from "../../lib/p2-08-preview/read-only-data";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const officialUrl = "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/t20260625_4714884.html";

test("Preview list reads the immutable P2-07 runtime and renders the official opportunity", async () => {
  const html = renderToStaticMarkup(await PreviewPage({ searchParams: Promise.resolve({}) }));
  assert.match(html, /只读数据预览/u);
  assert.match(html, /北京急救中心2026年度第四批公开招聘公告/u);
  assert.match(html, /北京市人民政府事业单位招聘/u);
  assert.match(html, /北京急救中心/u);
  assert.match(html, /发布日期<\/dt><dd>未观察到/u);
  assert.match(html, /当前观察状态<\/dt><dd>已观察/u);
  assert.match(html, new RegExp(escapeRegExp(officialUrl), "u"));
  assert.doesNotMatch(html, /synthetic|example\.invalid|智联|BOSS直聘|前程无忧|猎聘/iu);
});

test("Preview detail renders complete provenance and conservative unknown states", async () => {
  const list = await loadPreviewOpportunities({ limit: 1 });
  const opportunityId = list.opportunities[0]!.opportunity_id;
  const html = renderToStaticMarkup(await PreviewOpportunityPage({
    params: Promise.resolve({ opportunityId: encodeURIComponent(opportunityId) })
  }));

  for (const label of [
    "Opportunity",
    "SourceOccurrence",
    "ExtractedRecord",
    "Snapshot",
    "Raw",
    "Collection Run",
    "RecruitmentEndpoint",
    "SourceDefinition"
  ]) {
    assert.match(html, new RegExp(label, "u"));
  }
  assert.match(html, /未观察到完整要求/u);
  assert.doesNotMatch(html, /无要求|不限专业|无学历要求|无资格限制/u);
  assert.match(html, /未评估/u);
  assert.match(html, new RegExp(escapeRegExp(officialUrl), "u"));
});

test("keyword, source, organization, observation-state, and pagination use P2-07 query semantics", async () => {
  const matching = await loadPreviewOpportunities({
    keyword: "急救",
    source: "source-cn-beijing-government-public-institution-recruitment",
    organization: "北京急救中心",
    observation_state: "OBSERVED",
    offset: 0,
    limit: 1
  });
  assert.equal(matching.pagination.total, 1);
  assert.equal(matching.opportunities.length, 1);

  const missing = await loadPreviewOpportunities({ keyword: "不存在的招聘标题" });
  assert.equal(missing.pagination.total, 0);
  assert.deepEqual(missing.opportunities, []);

  const html = renderToStaticMarkup(await PreviewPage({
    searchParams: Promise.resolve({ keyword: "急救", observation_state: "OBSERVED" })
  }));
  assert.match(html, /value="急救"/u);
  assert.match(html, /1 条已持久化机会/u);
});

test("persisted Requirement Evidence and assessed Eligibility render without front-end inference", () => {
  const realDetail = loadPreviewOpportunitySyncShape();
  const props: OpportunityDetailViewProps = {
    detail: {
      ...realDetail,
      requirements: [{
        requirement_fact_id: "requirement-fact:test-only",
        dimension: "MAJOR",
        operator: "EQUALS",
        value: { kind: "CODE", code: "TEST_ONLY" },
        subject_scope: "MASTER",
        polarity: "POSITIVE",
        certainty: "EXPLICIT",
        parser_version: "p2-08-presentation-test-only",
        evidence: [{
          requirement_evidence_id: "requirement-evidence:test-only",
          snapshot_id: realDetail.opportunity.provenance[0]!.snapshot_id,
          raw_blob_id: realDetail.opportunity.provenance[0]!.raw_blob_id,
          original_url: officialUrl,
          locator: { field_path: "test-only" },
          evidence_text: "测试证据，仅验证持久化事实的展示。",
          extractor_name: "test-only",
          extractor_version: "test-only",
          parser_version: "p2-08-presentation-test-only"
        }]
      }],
      eligibility: {
        status: "ASSESSED",
        assessments: [{
          eligibility_assessment_id: "eligibility-assessment:test-only",
          candidate_profile_id: "candidate:test-only",
          result: "REQUIRES_REVIEW",
          reason_codes: ["TEST_ONLY_PERSISTED_RESULT"],
          requirement_fact_ids: ["requirement-fact:test-only"],
          evidence_ids: ["requirement-evidence:test-only"],
          assessed_at: "2026-09-03T00:00:00.000Z"
        }]
      }
    }
  };
  const html = renderToStaticMarkup(<OpportunityDetailView {...props} />);
  assert.match(html, /测试证据，仅验证持久化事实的展示/u);
  assert.match(html, /REQUIRES_REVIEW/u);
  assert.doesNotMatch(html, /未观察到完整要求|未评估/u);
});

test("Next GET route delegates unchanged to the P2-07 API contract", async () => {
  const response = await readOnlyRoute(new Request(
    "https://preview.invalid/api/ingestion/v1/opportunities?keyword=%E6%80%A5%E6%95%91&limit=1"
  ));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.pagination.total, 1);
  assert.equal(body.opportunities[0].original_url, officialUrl);
});

test("P2-08 Web is read-only and has no forbidden ingestion or legacy dependency", async () => {
  const files = [
    "app/api/ingestion/v1/[...segments]/route.ts",
    "app/preview/layout.tsx",
    "app/preview/page.tsx",
    "app/preview/opportunities/[opportunityId]/page.tsx",
    "lib/p2-08-preview/presentation.tsx",
    "lib/p2-08-preview/read-only-data.ts"
  ];
  const source = files.map((file) => readFileSync(path.join(repositoryRoot, file), "utf8")).join("\n");
  assert.doesNotMatch(source, /(?:production-ingestion|live-canary|collection-runtime|source-scheduler|fixtures?|outputs\/p2-04|app\/api\/jobs|cron\/sync|crawler|supabase)/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/u);
  assert.doesNotMatch(source, /\bfetch\s*\(|node:(?:http|https|net|tls|dns)/u);
  assert.doesNotMatch(source, /(?:Canonicalizer|RequirementParser|EligibilityEngine|RecruitmentAdapter)/u);
  assert.doesNotMatch(source, /(?:\.pdf|\.docx?|\.xlsx?|attachment_references)/iu);
  assert.doesNotMatch(source, /(?:智联|BOSS直聘|前程无忧|猎聘|zhaopin|zhipin|51job|liepin)/iu);
  const styles = readFileSync(path.join(repositoryRoot, "app/preview/preview.css"), "utf8");
  assert.match(styles, /\.p208-root \.p208-official-link\s*\{[^}]*color:\s*#fff/gu);
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});

function loadPreviewOpportunitySyncShape() {
  return {
    opportunity: {
      opportunity_id: "opportunity:test-only",
      opportunity_version_id: "opportunity-version:test-only",
      title: "展示测试",
      organization: null,
      source: {
        source_definition_id: "source:test-only",
        name: "展示测试来源"
      },
      endpoint: {
        recruitment_endpoint_id: "endpoint:test-only",
        name: "展示测试端点",
        locator: officialUrl,
        purpose: "JOB_DETAIL"
      },
      original_url: officialUrl,
      observed_at: "2026-09-03T00:00:00.000Z",
      first_seen_at: "2026-09-03T00:00:00.000Z",
      last_seen_at: "2026-09-03T00:00:00.000Z",
      content_hash: "test-only",
      observation_state: "OBSERVED" as const,
      provenance: [{
        source_occurrence_id: "source-occurrence:test-only",
        source_occurrence_version_id: "source-occurrence-version:test-only",
        extracted_record_id: "extracted-record:test-only",
        snapshot_id: "snapshot:test-only",
        raw_blob_id: "raw:test-only",
        collection_run_id: "collection-run:test-only",
        recruitment_endpoint_id: "endpoint:test-only",
        source_definition_id: "source:test-only",
        original_url: officialUrl
      }]
    },
    requirements: [],
    eligibility: { status: "NOT_ASSESSED" as const, reason: "test-only" }
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
