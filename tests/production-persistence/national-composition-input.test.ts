import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapTrustedChainCompositionRoot, createExtractedRecordV2, type TrustedSourceOccurrenceArtifact,
  type PositionVersionTrackingResult, type PositionBoundOpportunityTrackingResult } from "../../lib/ingestion";
import { nationalBindingFixture } from "../normalization/national-campaign-binding.test";
import { prepareProductionSourceCompositionInput } from "../../lib/production-persistence/production-source-composition-input";

test("national composition includes exact campaign general conditions as required evidence", async () => {
  const fixture = nationalBindingFixture();
  for (const index of [0, 1]) {
    const evidence = fixture.evidenceList[index]!;
    const { recruitment_context, ...record } = evidence.extracted_record;
    const endpoint = { ...evidence.endpoint, adapter_key: "cn-chnenergy-reviewed-supporting-html",
      recruitment_endpoint_id: `${evidence.endpoint.recruitment_endpoint_id}:support:${index}` as typeof evidence.endpoint.recruitment_endpoint_id };
    const snapshot = { ...evidence.snapshot, recruitment_endpoint_id: endpoint.recruitment_endpoint_id };
    fixture.evidenceList[index] = { ...evidence, endpoint, snapshot,
      extracted_record: createExtractedRecordV2(snapshot, { ...record,
        raw_description: { text: index === 0 ? "TEST_ONLY 公告一般招聘条件：年龄限制" : "TEST_ONLY 岗位列表", encoding: "UTF-8" },
        extraction: { extractor_name: "TEST_ONLYSupporting", extractor_version: "1.0.0", schema_version: "fixture-support/1.0.0" } }) };
  }
  const detail = fixture.evidenceList[2]!;
  const dependency = (index: number) => ({ snapshot_id: fixture.evidenceList[index]!.snapshot.snapshot_id,
    extracted_record_id: fixture.evidenceList[index]!.extracted_record.extracted_record_id, raw_sha256: fixture.evidenceList[index]!.raw_blob.sha256 });
  fixture.evidenceList[2] = { ...detail, extracted_record: createExtractedRecordV2(detail.snapshot, { ...detail.extracted_record,
    adapter_metadata: { "cn-chnenergy-2027-reviewed-official-html": { binding_contract_version: "national-campaign-membership/1.0.0",
      campaign: dependency(0), membership: dependency(1) } } }) };
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: fixture.journal });
  const execute = (command: Parameters<typeof root.execute>[0]) => root.execute(command, { actor: "TEST_ONLY", recorded_at: "2026-10-09T00:00:00.000Z" });
  for (const index of [0, 1]) {
    const source = fixture.evidenceList[index]!;
    await execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input: { source_role: "PACKAGE", endpoint: source.endpoint,
      snapshot: source.snapshot, extracted_record: source.extracted_record } });
  }
  const source = await execute(fixture.command()) as TrustedSourceOccurrenceArtifact;
  const position = await execute({ kind: "POSITION_VERSION_MATERIALIZE", source_references: [{ source_occurrence_version_id: source.version.source_occurrence_version_id }] }) as PositionVersionTrackingResult;
  const opportunity = await execute({ kind: "PBOV_MATERIALIZE", position_version_id: position.position_version.position_version_id,
    source_references: [{ source_occurrence_version_id: source.version.source_occurrence_version_id }] }) as PositionBoundOpportunityTrackingResult;
  const context = { source_occurrences: [source], snapshots: fixture.evidenceList.map(item => item.snapshot),
    extracted_records: fixture.evidenceList.map(item => item.extracted_record), execute, resolvers: root.resolvers,
    available_artifact_references: fixture.executions.flatMap(item => item.record.expected_artifacts) };
  const input = prepareProductionSourceCompositionInput(context, opportunity.opportunity_version.opportunity_version_id);
  assert.equal(input.source_surfaces.length, 3);
  const campaign = input.source_surfaces.find(surface => surface.snapshot_id === fixture.evidenceList[0]!.snapshot.snapshot_id)!;
  const entry = input.inventory.expected_surface_entries.find(item => item.source_surface_id === campaign.source_surface_id)!;
  assert.equal(entry.expectedness, "REQUIRED");
  assert.equal(entry.requirement_level, "REQUIREMENT_BEARING");
  assert.equal(campaign.locator.field_path, "raw_description");
  assert.equal(entry.authority_status, "UNRESOLVED");
  assert.equal(input.inventory.inventory_completeness_status, "OPEN_UNRESOLVED");
  const composition = await execute({ kind: "SOURCE_COMPOSITION_MATERIALIZE", input: {
    opportunity_version_id: opportunity.opportunity_version.opportunity_version_id, composition_input: input
  } }) as import("../../lib/ingestion").SourceCompositionResult;
  assert.equal(composition.status, "UNRESOLVED");
  const missing = { ...context, available_artifact_references: context.available_artifact_references.filter(reference =>
    reference.artifact_id !== campaign.source_occurrence_version_id) };
  assert.throws(() => prepareProductionSourceCompositionInput(missing, opportunity.opportunity_version.opportunity_version_id), /EVIDENCE_BLOCKED/);
});
