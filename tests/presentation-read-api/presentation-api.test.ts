import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import { SqliteShadowPersistence, createInMemoryOpportunityRecallBoundary } from "../../lib/ingestion";
import { ReadOnlyPresentationApi, READ_ONLY_PRESENTATION_API_BASE_PATH } from "../../lib/presentation-read-api";
import { sealedDecision, sealedModel } from "../persistence/presentation-fixture";
import { createMigratedShadowDatabase } from "../persistence/shadow-test-database";
import { organization, recruitmentEndpoint, sourceDefinition } from "../persistence/shadow-fixture";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";

test("Presentation API returns all retained sealed statuses and hides NOT_DISPLAY", async () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistence.organizations.append(organization); persistence.source_definitions.append(sourceDefinition);
  persistence.recruitment_endpoints.append(recruitmentEndpoint);
  const models = ["DISPLAY", "DISPLAY_WITH_REVIEW", "EVIDENCE_BLOCKED", "NOT_DISPLAY"]
    .map((status, index) => persistStatus(persistence, index, status));
  const api = new ReadOnlyPresentationApi(persistence.presentation);
  const list = await json(api, "/opportunities");
  assert.equal(list.response.status, 200);
  assert.deepEqual(list.body.opportunities.map((item: any) => item.presentation_status).sort(),
    ["DISPLAY", "DISPLAY_WITH_REVIEW", "EVIDENCE_BLOCKED"]);
  assert.deepEqual(list.body.pagination, { offset: 0, limit: 50, total: 3 });
  assert.equal(list.body.sorting, "updated_at_desc");
  const paged = await json(api, "/opportunities?offset=1&limit=1");
  assert.equal(paged.body.opportunities.length, 1);
  assert.deepEqual(paged.body.pagination, { offset: 1, limit: 1, total: 3 });
  const filtered = await json(api, "/opportunities?status=DISPLAY_WITH_REVIEW");
  assert.deepEqual(filtered.body.opportunities.map((item: any) => item.presentation_status),
    ["DISPLAY_WITH_REVIEW"]);
  const invalid = await json(api, "/opportunities?sort=title_asc");
  assert.equal(invalid.response.status, 400);
  const detail = await json(api, `/opportunities/${encodeURIComponent(models[0]!.opportunity_candidate_id)}`);
  assert.equal(detail.body.presentation_status, "DISPLAY");
  const hidden = await json(api, `/opportunities/${encodeURIComponent(models[3]!.opportunity_candidate_id)}`);
  assert.equal(hidden.response.status, 404);
  const post = await api.handle(new Request(`https://test.invalid${READ_ONLY_PRESENTATION_API_BASE_PATH}/opportunities`, { method: "POST" }));
  assert.equal(post.status, 405);
  database.close();
});

async function json(api: ReadOnlyPresentationApi, path: string) {
  const response = await api.handle(new Request(`https://test.invalid${READ_ONLY_PRESENTATION_API_BASE_PATH}${path}`));
  return { response, body: await response.json() as any };
}

function persistStatus(persistence: SqliteShadowPersistence, index: number, status: string) {
  const recall = createInMemoryOpportunityRecallBoundary();
  const registered = recall.register({
    source_definition_id: sourceDefinition.source_definition_id,
    recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id,
    discovery_locator: `fixture://presentation/api/${index}`,
    snapshot_id: null, extracted_record_id: null, source_occurrence_version_id: null,
    publisher_subject: null, discovery_evidence_ids: [`api:${index}`],
    first_observed_at: "2026-09-14T08:00:00.000Z" as never,
    initial_disposition: { status: "ACQUISITION_UNSUPPORTED", reason_codes: ["FIXTURE"], evidence_ids: [`api:${index}`], decided_at: "2026-09-14T08:00:00.000Z" as never }
  });
  persistence.opportunity_recall.appendRegistration(registered.candidate, registered.disposition);
  const initial = sealedDecision(registered.candidate.opportunity_candidate_id,
    registered.disposition.recall_disposition_id, registered.disposition.integrity_hash);
  const withoutIntegrity = { ...initial, status: status as any };
  const decision = { ...withoutIntegrity, integrity_hash: canonicalHash((({ integrity_hash, ...item }) => item)(withoutIntegrity)) } as typeof initial;
  const baseModel = sealedModel(decision);
  const modelWithoutIntegrity = { ...baseModel, presentation_status: status as any };
  const model = { ...modelWithoutIntegrity, integrity_hash: canonicalHash((({ integrity_hash, ...item }) => item)(modelWithoutIntegrity)) } as typeof baseModel;
  persistence.presentation.appendDecision(decision);
  return persistence.presentation.appendReadModel(model);
}
