import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  SqliteShadowPersistence,
  createInMemoryOpportunityRecallBoundary,
} from "../../lib/ingestion";
import { sealedDecision, sealedModel } from "./presentation-fixture";
import { canonicalHash } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createMigratedShadowDatabase } from "./shadow-test-database";
import { organization, recruitmentEndpoint, sourceDefinition } from "./shadow-fixture";

test("Presentation persistence is immutable, idempotent, and current-revision ordered", () => {
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistence.organizations.append(organization);
  persistence.source_definitions.append(sourceDefinition);
  persistence.recruitment_endpoints.append(recruitmentEndpoint);
  const recall = createInMemoryOpportunityRecallBoundary();
  const registered = recall.register({
    source_definition_id: sourceDefinition.source_definition_id,
    recruitment_endpoint_id: recruitmentEndpoint.recruitment_endpoint_id,
    discovery_locator: "fixture://presentation/persisted",
    snapshot_id: null,
    extracted_record_id: null,
    source_occurrence_version_id: null,
    publisher_subject: null,
    discovery_evidence_ids: ["presentation:evidence"],
    first_observed_at: "2026-09-14T08:00:00.000Z" as never,
    initial_disposition: {
      status: "ACQUISITION_UNSUPPORTED",
      reason_codes: ["FIXTURE"], evidence_ids: ["presentation:evidence"],
      decided_at: "2026-09-14T08:00:00.000Z" as never
    }
  });
  persistence.opportunity_recall.appendRegistration(registered.candidate, registered.disposition);
  const decision = sealedDecision(registered.candidate.opportunity_candidate_id,
    registered.disposition.recall_disposition_id, registered.disposition.integrity_hash);
  const model = sealedModel(decision);
  assert.deepEqual(persistence.presentation.appendDecision(decision), decision);
  assert.deepEqual(persistence.presentation.appendDecision(decision), decision);
  assert.deepEqual(persistence.presentation.appendReadModel(model), model);
  assert.deepEqual(persistence.presentation.listCurrentReadModels(), [model]);
  const changed = { ...decision, status: "DISPLAY_WITH_REVIEW" as const };
  assert.throws(() => persistence.presentation.appendDecision({ ...changed,
    integrity_hash: canonicalHash((({ integrity_hash, ...item }) => item)(changed)) }), /collision/);
  assert.throws(() => database.prepare("UPDATE shadow_presentation_read_models SET payload_json = '{}' WHERE presentation_read_model_id = ?")
    .run(model.presentation_read_model_id), /append-only/);
  assert.throws(() => database.prepare("DELETE FROM shadow_presentation_decisions WHERE presentation_decision_id = ?")
    .run(decision.presentation_decision_id), /append-only/);
  database.close();
});
