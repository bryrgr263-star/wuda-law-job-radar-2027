import "../helpers/network-guard";

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IMMUTABLE_PREVIEW_DATASET_SCHEMA,
  composeReadOnlyIngestionRuntime,
  type ImmutablePreviewDatasetManifest,
  ImmutablePreviewDatasetError,
  READ_ONLY_INGESTION_API_BASE_PATH
} from "../../lib/read-only-api";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databasePath = path.join(
  repositoryRoot,
  "immutable-preview",
  "p2-07",
  "beijing-official-preview.sqlite"
);
const manifestPath = path.join(
  repositoryRoot,
  "immutable-preview",
  "p2-07",
  "beijing-official-preview.manifest.json"
);

test("runtime serves only the immutable official Beijing dataset through the P2-07 API", async () => {
  const runtime = composeReadOnlyIngestionRuntime({ database_path: databasePath, manifest_path: manifestPath });
  try {
    assert.equal(runtime.dataset.schema_version, IMMUTABLE_PREVIEW_DATASET_SCHEMA);
    assert.equal(runtime.dataset.classification, "VERIFIED_OFFICIAL_CAPTURE_ONLY");
    assert.equal(Object.isFrozen(runtime.dataset), true);
    assert.deepEqual(runtime.dataset.source_definition_ids, [
      "source-cn-beijing-government-public-institution-recruitment"
    ]);

    const list = await requestJson(runtime, "/opportunities");
    assert.equal(list.response.status, 200);
    assert.equal(list.body.pagination.total, 1);
    assert.equal(list.body.opportunities[0].title, "北京急救中心2026年度第四批公开招聘公告");
    assert.equal(
      list.body.opportunities[0].original_url,
      "https://www.beijing.gov.cn/gongkai/rsxx/sydwzp/202606/t20260625_4714884.html"
    );
    assert.doesNotMatch(JSON.stringify(list.body), /synthetic|example\.invalid|zhaopin|zhipin|51job|liepin/iu);

    const opportunityId = list.body.opportunities[0].opportunity_id as string;
    const detail = await requestJson(runtime, `/opportunities/${encodeURIComponent(opportunityId)}`);
    assert.equal(detail.response.status, 200);
    assert.deepEqual(detail.body.requirements, []);
    assert.equal(detail.body.eligibility.status, "NOT_ASSESSED");
    assert.match(detail.body.eligibility.reason, /No job-level Requirement facts were observed/u);
    assert.equal(detail.body.opportunity.provenance.length, 1);
    assert.equal(
      detail.body.opportunity.provenance[0].original_url,
      detail.body.opportunity.original_url
    );

    const sources = await requestJson(runtime, "/sources");
    const health = await requestJson(runtime, "/source-health");
    assert.equal(sources.body.sources.length, 1);
    assert.equal(health.body.source_health.length, 1);
  } finally {
    runtime.close();
  }
});

test("runtime exposes no write endpoint and refuses use after close", async () => {
  const runtime = composeReadOnlyIngestionRuntime({ database_path: databasePath, manifest_path: manifestPath });
  const response = await runtime.handle(new Request(
    `https://p2-07-runtime.invalid${READ_ONLY_INGESTION_API_BASE_PATH}/opportunities`,
    { method: "POST" }
  ));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  runtime.close();
  await assert.rejects(
    runtime.handle(new Request(`https://p2-07-runtime.invalid${READ_ONLY_INGESTION_API_BASE_PATH}/opportunities`)),
    /runtime is closed/u
  );
});

test("runtime rejects a database whose bytes do not match its immutable manifest", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "p2-07-runtime-"));
  const alteredManifestPath = path.join(temporaryRoot, "manifest.json");
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ImmutablePreviewDatasetManifest;
    writeFileSync(alteredManifestPath, JSON.stringify({ ...manifest, database_sha256: "0".repeat(64) }));
    assert.throws(
      () => composeReadOnlyIngestionRuntime({ database_path: databasePath, manifest_path: alteredManifestPath }),
      (error: unknown) => error instanceof ImmutablePreviewDatasetError
        && /SHA-256 does not match/u.test(error.message)
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("runtime composition has no collection, scheduler, adapter, write, fixture, or network dependency", async () => {
  const runtimeSource = readFileSync(path.join(
    repositoryRoot,
    "lib/read-only-api/runtime-composition.ts"
  ), "utf8");
  assert.doesNotMatch(runtimeSource, /(?:live-canary|production-ingestion|collection-runtime|source-scheduler|fixtures?|outputs\/p2-04|app\/api\/jobs|crawler|supabase)/u);
  assert.doesNotMatch(runtimeSource, /\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/u);
  assert.doesNotMatch(runtimeSource, /\bfetch\s*\(|node:(?:http|https|net|tls|dns)/u);
  assert.doesNotMatch(runtimeSource, /(?:Canonicalizer|RequirementParser|EligibilityEngine|RecruitmentAdapter)/u);
  assert.match(runtimeSource, /readOnly:\s*true/u);
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});

async function requestJson(
  runtime: ReturnType<typeof composeReadOnlyIngestionRuntime>,
  endpoint: string
) {
  const response = await runtime.handle(new Request(
    `https://p2-07-runtime.invalid${READ_ONLY_INGESTION_API_BASE_PATH}${endpoint}`
  ));
  return { response, body: await response.json() as any };
}
