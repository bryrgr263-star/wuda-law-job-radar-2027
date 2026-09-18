import "../helpers/network-guard";
import { readHistoricalEvidenceBytes, readHistoricalEvidenceJson } from "../helpers/historical-evidence";

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSourceCompositionResultIntegrity,
  createInMemoryOpportunityRecallBoundary,
  createPresentationDecisionBoundary,
  createPresentationPersistenceBoundary,
  createPresentationReadModelMaterializer,
  InMemoryLegalEmploymentRelevanceTracker,
  SqliteShadowPersistence,
  UTF8_TEXT_ENCODING,
  type Organization,
  type SourceDefinition,
  type Snapshot
} from "../../lib/ingestion";
import { ReadOnlyPresentationApi, READ_ONLY_PRESENTATION_API_BASE_PATH } from "../../lib/presentation-read-api";
import {
  P2_LEGAL_08B_COMPOSITION_VERSION,
  discoverP2Legal08bAttachmentInventory,
  materializeP2Legal08bTarget
} from "../../lib/live-canary/p2-legal-08b";
import {
  GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
  GUIZHOU_NOTICE_RAW_SHA256
} from "../../lib/live-canary/p2-legal-03/guizhou-attachment-admission-preflight";
import {
  P2_LEGAL_05_RAW_SHA256,
  P2_LEGAL_05_TARGET_JOB_CODE
} from "../../lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter";
import {
  GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
} from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";
import { createGuizhouLegalRequirementEndpoint } from "../../lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter";
import { createMigratedShadowDatabase } from "../persistence/shadow-test-database";

const evidence = archivedEvidence();

test("offline discovery records all four official attachment identities", () => {
  const inventory = discoverP2Legal08bAttachmentInventory(evidence.notice_raw_bytes);

  assert.deepEqual(inventory.map((entry) => entry.attachment_index), [1, 2, 3, 4]);
  assert.deepEqual(inventory.map((entry) => entry.filename), [
    "P020250210600360721175.xlsx",
    "P020250210600360755415.wps",
    "P020250210600360787709.doc",
    "P020250210600360810960.wps"
  ]);
  assert.equal(inventory[0]?.disposition, "REQUIRED");
  assert.deepEqual(inventory.slice(1).map((entry) => entry.disposition), [
    "UNRESOLVED",
    "UNRESOLVED",
    "UNRESOLVED"
  ]);
  assert.equal(inventory[0]?.locally_archived, true);
  assert.equal(inventory.slice(1).every((entry) => !entry.locally_archived), true);
});

test("target root reuses frozen Raw and Snapshot hashes", () => {
  const result = materializeP2Legal08bTarget(evidence);

  assert.equal(result.announcement_source.snapshot.content_hash, GUIZHOU_NOTICE_RAW_SHA256);
  assert.equal(result.target_source.snapshot.content_hash, P2_LEGAL_05_RAW_SHA256);
  assert.equal(result.announcement_source.source_role, "PACKAGE");
  assert.equal(result.announcement_record.recruitment_context, undefined);
  assert.equal(result.target_source.source_role, "POSITION_BEARING");
  assert.ok(result.target_record.recruitment_context);
});

test("target identity chain is root-owned and remains PROVISIONAL", () => {
  const result = materializeP2Legal08bTarget(evidence);

  assert.equal(result.position.identity_basis.kind, "SOURCE_LOCAL_RECORD");
  assert.equal(result.position.identity_state, "PROVISIONAL");
  assert.equal(
    result.position.source_local_record_identifier?.original.text,
    P2_LEGAL_05_TARGET_JOB_CODE
  );
  assert.equal(result.position_version.position_id, result.position.position_id);
  assert.deepEqual(result.position_version.source_occurrence_version_ids, [
    result.target_source.version.source_occurrence_version_id
  ]);
  assert.equal(
    result.opportunity_version.position_version_id,
    result.position_version.position_version_id
  );
  assert.deepEqual(result.opportunity_version.source_occurrence_version_ids, [
    result.target_source.version.source_occurrence_version_id
  ]);
  assert.equal(
    result.opportunity_version.source_occurrence_version_ids.includes(
      result.announcement_source.version.source_occurrence_version_id
    ),
    false
  );
});

test("Phase F consumes package SOV without weakening the PBOV source closure", () => {
  const result = materializeP2Legal08bTarget(evidence);
  const noticeSurface = result.source_composition.source_surfaces.find((surface) => {
    return surface.surface_kind === "ANNOUNCEMENT_BODY";
  });
  const rowSurface = result.source_composition.source_surfaces.find((surface) => {
    return surface.surface_kind === "POSITION_TABLE_ROW";
  });
  const rowBinding = result.source_composition.source_surface_bindings.find((binding) => {
    return binding.binding_kind === "ATTACHMENT_ROW";
  });

  assert.equal(
    noticeSurface?.source_occurrence_version_id,
    result.announcement_source.version.source_occurrence_version_id
  );
  assert.equal(
    rowSurface?.source_occurrence_version_id,
    result.target_source.version.source_occurrence_version_id
  );
  assert.equal(rowBinding?.source_surface_id, rowSurface?.source_surface_id);
  assert.equal(
    result.position_version.source_occurrence_version_ids.includes(
      noticeSurface!.source_occurrence_version_id
    ),
    false
  );
});

test("unresolved attachment dispositions keep Source Composition non-COMPLETE", () => {
  const result = materializeP2Legal08bTarget(evidence);
  const unresolvedEntries = result.source_composition.inventory.expected_surface_entries.filter(
    (entry) => entry.expected_surface_key.includes("P0202502106003607")
      || entry.expected_surface_key.includes("P0202502106003608")
  ).filter((entry) => entry.coverage_status === "UNRESOLVED");

  assert.equal(result.source_composition.status, "UNRESOLVED");
  assert.equal(result.source_composition.inventory.inventory_completeness_status,
    "OPEN_UNRESOLVED");
  assert.equal(unresolvedEntries.length, 3);
  assert.equal(
    assertSourceCompositionResultIntegrity(result.source_composition),
    result.source_composition
  );
});

test("target composition includes exact publication and row bindings", () => {
  const result = materializeP2Legal08bTarget(evidence);
  const bindings = result.source_composition.source_surface_bindings;

  assert.equal(bindings.filter((binding) => {
    return binding.binding_kind === "ATTACHMENT_PUBLICATION";
  }).length, 2);
  const rowBinding = bindings.find((binding) => binding.binding_kind === "ATTACHMENT_ROW") as
    | (typeof bindings[number] & { row_locator?: string; cell_locator?: string })
    | undefined;
  assert.equal(rowBinding?.row_locator, "4");
  assert.equal(rowBinding?.cell_locator, "A4:O4");
  assert.equal(rowBinding?.target_id, result.opportunity_version.opportunity_version_id);
  assert.equal(result.source_composition.composition_resolver_version,
    P2_LEGAL_08B_COMPOSITION_VERSION);
  assert.equal(result.attachment_inventory[0]?.exact_locator,
    GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL);
});

test("target remains blocked before Requirement Projection and Eligibility", () => {
  const result = materializeP2Legal08bTarget(evidence);

  assert.deepEqual(result.downstream_boundary, {
    requirement_projection_created: false,
    requirement_set_version_created: false,
    predicate_resolution_created: false,
    eligibility_assessment_created: false
  });
  assert.equal(result.source_composition.status === "COMPLETE", false);
});

test("real target persists an evidence-blocked Presentation decision without downstream invention", async () => {
  const result = materializeP2Legal08bTarget(evidence);
  const relevance = new InMemoryLegalEmploymentRelevanceTracker(
    result.trusted_root.position_bound_opportunities,
    result.trusted_root.chain.source_composition_resolver
  );
  const relevanceAssessment = relevance.process({
    opportunity_version_id: result.opportunity_version.opportunity_version_id,
    source_composition_id: result.source_composition.source_composition_id,
    created_at: "2026-09-14T08:00:00.000Z" as never
  }).assessment;
  assert.equal(relevanceAssessment.assessment_state, "REVIEW_REQUIRED");

  const recall = createInMemoryOpportunityRecallBoundary();
  const registered = recall.register({
    source_definition_id: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
    recruitment_endpoint_id: createGuizhouLegalRequirementEndpoint(
      GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
    ).recruitment_endpoint_id,
    discovery_locator: GUIZHOU_LEGAL_CANARY_ATTACHMENT_URL,
    snapshot_id: result.target_source.snapshot.snapshot_id,
    extracted_record_id: result.target_source.extracted_record.extracted_record_id,
    source_occurrence_version_id: result.target_source.version.source_occurrence_version_id,
    publisher_subject: null,
    discovery_evidence_ids: [result.target_source.version.source_occurrence_version_id],
    first_observed_at: result.target_source.snapshot.observed_at,
    initial_disposition: {
      status: "RETAINED",
      reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
      evidence_ids: [result.target_source.version.source_occurrence_version_id],
      decided_at: result.target_source.snapshot.observed_at
    }
  });
  const decisions = createPresentationDecisionBoundary({
    candidates: recall.candidates,
    recall_dispositions: recall.dispositions,
    position_bound_opportunities: result.trusted_root.position_bound_opportunities,
    relevance,
    eligibility: result.trusted_root.chain.eligibility_assessments
  });
  const decision = decisions.decide({
    opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
    recall_disposition_id: registered.disposition.recall_disposition_id,
    relevance_assessment_id: relevanceAssessment.assessment_id,
    eligibility_assessment_id: null,
    decided_at: "2026-09-14T08:00:00.000Z" as never
  }).decision;
  assert.equal(decision.status, "EVIDENCE_BLOCKED");
  assert.equal(decision.requirement_set_version_id, null);
  assert.equal(decision.eligibility_assessment_id, null);

  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistRealRecallPrerequisites(persistence, registered.candidate, registered.disposition);
  const materializer = createPresentationReadModelMaterializer({
    decisions: decisions.decisions,
    position_bound_opportunities: result.trusted_root.position_bound_opportunities,
    requirement_sets: result.trusted_root.chain.requirement_set_resolver
  });
  const persisted = createPresentationPersistenceBoundary({
    decisions: decisions.decisions,
    materializer,
    persistence: persistence.presentation
  }).persist(decision.presentation_decision_id);
  const api = new ReadOnlyPresentationApi(persistence.presentation);
  const list = await api.handle(new Request(
    `https://test.invalid${READ_ONLY_PRESENTATION_API_BASE_PATH}/opportunities`
  ));
  const listed = await list.json() as { opportunities: readonly { presentation_status: string }[] };
  const detail = await api.handle(new Request(
    `https://test.invalid${READ_ONLY_PRESENTATION_API_BASE_PATH}/opportunities/${encodeURIComponent(String(decision.opportunity_candidate_id))}`
  ));
  const detailed = await detail.json() as typeof persisted.read_model;

  assert.equal(persisted.read_model.presentation_status, "EVIDENCE_BLOCKED");
  assert.equal(persisted.read_model.requirement_summary.state, "NOT_YET_AVAILABLE");
  assert.equal(persisted.read_model.upstream.source_composition_id,
    result.source_composition.source_composition_id);
  assert.equal(list.status, 200);
  assert.deepEqual(listed.opportunities.map((item) => item.presentation_status), ["EVIDENCE_BLOCKED"]);
  assert.equal(detail.status, 200);
  assert.equal(detailed.integrity_hash, persisted.read_model.integrity_hash);
  database.close();
});

function persistRealRecallPrerequisites(
  persistence: SqliteShadowPersistence,
  candidate: ReturnType<ReturnType<typeof createInMemoryOpportunityRecallBoundary>["candidates"]["resolve"]> extends infer Value ? NonNullable<Value> : never,
  disposition: ReturnType<ReturnType<typeof createInMemoryOpportunityRecallBoundary>["dispositions"]["resolve"]> extends infer Value ? NonNullable<Value> : never
) {
  const organization: Organization = {
    organization_id: "organization-guizhou-justice" as never,
    name: { original: { text: "贵州省司法厅", encoding: UTF8_TEXT_ENCODING } },
    aliases: [],
    country_code: "CN"
  };
  const sourceDefinition: SourceDefinition = {
    source_definition_id: GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID,
    publisher_organization_id: organization.organization_id,
    name: { original: { text: "贵州省司法厅官方招聘公告", encoding: UTF8_TEXT_ENCODING } },
    publisher_kind: "GOVERNMENT_PORTAL",
    authority_level: "OFFICIAL",
    scope: "SINGLE_ORGANIZATION",
    enabled: false
  };
  persistence.organizations.append(organization);
  persistence.source_definitions.append(sourceDefinition);
  persistence.recruitment_endpoints.append(createGuizhouLegalRequirementEndpoint(
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
  ));
  persistence.opportunity_recall.appendRegistration(candidate, disposition);
}

function archivedEvidence() {
  return {
    notice_raw_bytes: new Uint8Array(readHistoricalEvidenceBytes("guizhou-notice-html")),
    notice_snapshot: readHistoricalEvidenceJson<Snapshot>("guizhou-notice-snapshot"),
    attachment_1_raw_bytes: new Uint8Array(readHistoricalEvidenceBytes("guizhou-attachment-xlsx")),
    attachment_1_snapshot: readHistoricalEvidenceJson<Snapshot>("guizhou-attachment-snapshot")
  };
}
