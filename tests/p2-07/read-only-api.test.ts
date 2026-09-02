import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  READ_ONLY_INGESTION_API_BASE_PATH,
  ReadOnlyIngestionApi,
  ReadOnlyIngestionProjection,
  ReadOnlyProjectionIntegrityError
} from "../../lib/read-only-api";
import { createProjectionTestDatabase } from "./test-support";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Opportunity list filters persisted projections and paginates without collection", async () => {
  const fixture = createProjectionTestDatabase();
  const api = apiFor(fixture);
  const all = await requestJson(api, "/opportunities?limit=20");
  assert.equal(all.response.status, 200);
  assert.deepEqual(all.body.pagination, { offset: 0, limit: 20, total: 2 });
  assert.equal(all.body.opportunities.length, 2);

  const keyword = await requestJson(api, "/opportunities?keyword=%E6%80%A5%E6%95%91");
  assert.equal(keyword.body.pagination.total, 1);
  assert.equal(keyword.body.opportunities[0].title, "北京急救中心2026年度第四批公开招聘公告");

  const organization = await requestJson(api, "/opportunities?organization=%E5%8C%97%E4%BA%AC%E6%80%A5%E6%95%91%E4%B8%AD%E5%BF%83");
  assert.equal(organization.body.pagination.total, 1);
  assert.equal(organization.body.opportunities[0].organization.name, "北京急救中心");

  const source = await requestJson(api, "/opportunities?source=source-cn-beijing-government-public-institution-recruitment");
  assert.equal(source.body.pagination.total, 1);
  const observed = await requestJson(api, "/opportunities?observation_state=OBSERVED");
  assert.equal(observed.body.pagination.total, 2);

  const firstPage = await requestJson(api, "/opportunities?limit=1&offset=0");
  const secondPage = await requestJson(api, "/opportunities?limit=1&offset=1");
  assert.equal(firstPage.body.opportunities.length, 1);
  assert.equal(secondPage.body.opportunities.length, 1);
  assert.notEqual(firstPage.body.opportunities[0].opportunity_id, secondPage.body.opportunities[0].opportunity_id);

  const invalid = await requestJson(api, "/opportunities?limit=101");
  assert.equal(invalid.response.status, 400);
  fixture.database.close();
});

test("Beijing detail projects exact production provenance and returns NOT_ASSESSED without invention", async () => {
  const fixture = createProjectionTestDatabase();
  const api = apiFor(fixture);
  const opportunityId = fixture.beijingResult.canonical_opportunity_ids[0]!;
  const result = await requestJson(api, `/opportunities/${encodeURIComponent(opportunityId)}`);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.opportunity.title, "北京急救中心2026年度第四批公开招聘公告");
  assert.equal(result.body.opportunity.organization.name, "北京急救中心");
  assert.equal(result.body.opportunity.original_url, "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/t20260625_4714884.html");
  assert.equal(result.body.opportunity.endpoint.purpose, "JOB_DETAIL");
  assert.equal(result.body.opportunity.observation_state, "OBSERVED");
  assert.deepEqual(result.body.opportunity.provenance[0], {
    source_occurrence_id: fixture.beijingResult.source_occurrence_ids[0],
    source_occurrence_version_id: fixture.beijingResult.source_occurrence_version_ids[0],
    extracted_record_id: fixture.beijing.extractedRecords[0]!.extracted_record_id,
    snapshot_id: fixture.beijing.input.snapshot.snapshot_id,
    raw_blob_id: fixture.beijing.input.raw_blob.raw_blob_id,
    collection_run_id: fixture.beijing.input.collection_run.collection_run_id,
    recruitment_endpoint_id: fixture.beijing.input.endpoint.recruitment_endpoint_id,
    source_definition_id: fixture.beijing.input.source_definition.source_definition_id,
    original_url: fixture.beijing.input.original_url
  });
  assert.deepEqual(result.body.requirements, []);
  assert.equal(result.body.eligibility.status, "NOT_ASSESSED");
  assert.match(result.body.eligibility.reason, /No job-level Requirement facts were observed/u);
  fixture.database.close();
});

test("Requirement and Eligibility projections return only persisted, evidence-backed records", async () => {
  const fixture = createProjectionTestDatabase();
  const api = apiFor(fixture);
  const opportunityId = fixture.syntheticResult.canonical_opportunity_ids[0]!;
  const result = await requestJson(api, `/opportunities/${encodeURIComponent(opportunityId)}`);

  assert.equal(result.body.requirements.length, 1);
  assert.equal(result.body.requirements[0].requirement_fact_id, fixture.fact.requirement_fact_id);
  assert.equal(result.body.requirements[0].evidence[0].requirement_evidence_id, fixture.evidence.requirement_evidence_id);
  assert.equal(result.body.requirements[0].evidence[0].snapshot_id, fixture.synthetic.input.snapshot.snapshot_id);
  assert.equal(result.body.requirements[0].evidence[0].raw_blob_id, fixture.synthetic.input.raw_blob.raw_blob_id);
  assert.equal(result.body.requirements[0].evidence[0].original_url, fixture.synthetic.input.original_url);
  assert.equal(result.body.eligibility.status, "ASSESSED");
  assert.equal(result.body.eligibility.assessments[0].candidate_profile_id, fixture.candidate.candidate_profile_id);
  assert.equal(result.body.eligibility.assessments[0].result, "ELIGIBLE");
  assert.deepEqual(result.body.eligibility.assessments[0].requirement_fact_ids, [fixture.fact.requirement_fact_id]);
  assert.deepEqual(result.body.eligibility.assessments[0].evidence_ids, [fixture.evidence.requirement_evidence_id]);
  fixture.database.close();
});

test("Source and health endpoints expose only exact persisted bindings", async () => {
  const fixture = createProjectionTestDatabase();
  const api = apiFor(fixture);
  const sources = await requestJson(api, "/sources");
  const health = await requestJson(api, "/source-health");

  assert.equal(sources.response.status, 200);
  assert.equal(sources.body.sources.length, 2);
  const beijingSource = sources.body.sources.find((source: { source_definition_id: string }) => {
    return source.source_definition_id === fixture.beijing.input.source_definition.source_definition_id;
  });
  assert.equal(beijingSource.endpoints[0].health.status, "HEALTHY");
  assert.deepEqual(health.body.source_health, [{
    source_definition_id: fixture.beijing.input.source_definition.source_definition_id,
    source_admission_id: fixture.beijing.input.authorization.source_admission_id,
    recruitment_endpoint_id: fixture.beijing.input.endpoint.recruitment_endpoint_id,
    status: "HEALTHY",
    consecutive_success: 1,
    consecutive_failure: 0,
    last_success: fixture.beijing.input.snapshot.observed_at,
    last_failure: null,
    last_http_status: 200,
    last_content_hash: fixture.beijing.input.raw_blob.raw_content_sha256,
    structure_change_detected: false,
    robots_status: "ALLOWED",
    terms_status: "UNKNOWN"
  }]);
  fixture.database.close();
});

test("API is read-only, ignores Preview rows, and rejects every non-GET route", async () => {
  const fixture = createProjectionTestDatabase();
  const api = apiFor(fixture);
  fixture.database.exec("CREATE TABLE preview_ingestion_opportunities (id TEXT PRIMARY KEY); INSERT INTO preview_ingestion_opportunities VALUES ('preview-only');");
  const before = ingestionCounts(fixture.database);
  const post = await api.handle(new Request(`https://p2-07.invalid${READ_ONLY_INGESTION_API_BASE_PATH}/opportunities`, { method: "POST" }));
  assert.equal(post.status, 405);
  const list = await requestJson(api, "/opportunities");
  assert.equal(list.body.pagination.total, 2);
  assert.deepEqual(ingestionCounts(fixture.database), before);
  assert.doesNotMatch(JSON.stringify(list.body), /(?:zhaopin|zhipin|51job|liepin)/iu);
  fixture.database.close();
});

test("projection refuses an untraceable P2-05 health snapshot instead of hiding it", () => {
  const fixture = createProjectionTestDatabase();
  const invalidHealth = {
    ...fixture.sourceHealth[0],
    source_admission_id: "admission-not-persisted" as never
  };
  const projection = new ReadOnlyIngestionProjection(fixture.database, { source_health: [invalidHealth] });
  assert.throws(() => projection.listSourceHealth(), ReadOnlyProjectionIntegrityError);
  fixture.database.close();
});

test("P2-07 source is read-only and has no collection, scheduler, HTTP, legacy, or Preview dependency", async () => {
  const source = [
    "lib/read-only-api/api.ts",
    "lib/read-only-api/projection.ts",
    "lib/read-only-api/types.ts"
  ].map((file) => readFileSync(path.join(repositoryRoot, file), "utf8")).join("\n");
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/u);
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dns)|\bfetch\s*\(|InMemorySourceScheduler|collection-runtime|live-canary|supabase|preview_ingestion|lib\/jobs|lib\/sync|next\/server/u);
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});

function apiFor(fixture: ReturnType<typeof createProjectionTestDatabase>) {
  return new ReadOnlyIngestionApi(new ReadOnlyIngestionProjection(fixture.database, {
    source_health: fixture.sourceHealth
  }));
}

async function requestJson(api: ReadOnlyIngestionApi, endpoint: string) {
  const response = await api.handle(new Request(`https://p2-07.invalid${READ_ONLY_INGESTION_API_BASE_PATH}${endpoint}`));
  return { response, body: await response.json() as any };
}

function ingestionCounts(database: ReturnType<typeof createProjectionTestDatabase>["database"]) {
  const tables = [
    "ingestion_organizations",
    "ingestion_source_definitions",
    "ingestion_recruitment_endpoints",
    "ingestion_authorization_audits",
    "ingestion_collection_runs",
    "ingestion_raw_blobs",
    "ingestion_snapshots",
    "ingestion_extracted_records",
    "ingestion_source_occurrences",
    "ingestion_source_occurrence_versions",
    "ingestion_canonical_opportunities",
    "ingestion_opportunity_versions",
    "ingestion_requirement_facts",
    "ingestion_requirement_evidence",
    "ingestion_eligibility_assessments"
  ];
  return Object.fromEntries(tables.map((table) => {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return [table, row.count];
  }));
}
