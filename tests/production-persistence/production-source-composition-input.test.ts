import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapTrustedChainCompositionRoot, createExtractedRecordV2, type PositionVersionTrackingResult,
  type PositionBoundOpportunityTrackingResult, type TrustedChainCommand, type TrustedRestorationExecution,
  type TrustedSourceOccurrenceArtifact } from "../../lib/ingestion";
import { trustedFixture, trustedPackageFixture } from "../pipeline/position-bound-phase-fixture";
import { prepareProductionSourceCompositionInput } from "../../lib/production-persistence/production-source-composition-input";
import { executeProductionTrustedChainBinding } from "../../lib/production-persistence/production-trusted-chain-execution-binding";
import type { ZeroCostProductionTrustedRunContext } from "../../lib/production-persistence/zero-cost-production-composition-root";

async function fixtureContext() {
  const fixture = trustedFixture("production-preparation");
  const executions: TrustedRestorationExecution<TrustedChainCommand>[] = [];
  const { root } = await bootstrapTrustedChainCompositionRoot({ scope: "SYNTHETIC_TEST", restoration_journal: {
    list: async () => executions.map(execution => execution.record),
    appendExecution: async execution => { executions.push(execution); return "APPENDED"; }
  } });
  const execute = (command: TrustedChainCommand) => root.execute(command,
    { actor: "composition-preparation-test", recorded_at: "2026-09-27T07:00:00Z" });
  const source = await execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input: {
    source_role: "POSITION_BEARING", endpoint: fixture.source.endpoint,
    extracted_record: fixture.source.extracted_record, snapshot: fixture.source.snapshot
  } }) as TrustedSourceOccurrenceArtifact;
  const position = await execute({ kind: "POSITION_VERSION_MATERIALIZE",
    source_references: [{ source_occurrence_version_id: source.version.source_occurrence_version_id }]
  }) as PositionVersionTrackingResult;
  const opportunity = await execute({ kind: "PBOV_MATERIALIZE", position_version_id: position.position_version.position_version_id,
    source_references: [{ source_occurrence_version_id: source.version.source_occurrence_version_id }]
  }) as PositionBoundOpportunityTrackingResult;
  const context: ZeroCostProductionTrustedRunContext = { source_occurrences: [source], snapshots: [source.snapshot],
    extracted_records: [source.extracted_record], available_artifact_references: executions.flatMap(execution =>
      execution.record.expected_artifacts), resolvers: root.resolvers, execute };
  return { context, opportunityVersionId: opportunity.opportunity_version.opportunity_version_id, executions, fixture };
}

test("captured position is not promoted to closed, authoritative, or effective requirements", async () => {
  const { context, opportunityVersionId } = await fixtureContext();
  const input = prepareProductionSourceCompositionInput(context, opportunityVersionId);
  assert.equal(input.inventory.inventory_completeness_status, "OPEN_UNRESOLVED");
  assert.equal(input.source_surfaces.length, 1);
  assert.equal(input.inventory.expected_surface_entries[0]!.authority_status, "UNRESOLVED");
  assert.equal(input.inventory.expected_surface_entries[0]!.version_selection_status, "UNRESOLVED");
  assert.equal(input.inventory.expected_surface_entries[0]!.binding_status, "RESOLVED");
  assert.equal(input.source_surface_bindings[0]!.target_id, opportunityVersionId);
  assert.equal(input.source_surfaces[0]!.locator.field_path, "raw_requirement_text");
  assert.deepEqual(input.authority_assertions, []);
  assert.deepEqual(input.source_version_selections, []);
  assert.deepEqual(prepareProductionSourceCompositionInput(context, opportunityVersionId), input);
});

test("unknown PBOV cannot be prepared from caller objects", async () => {
  const { context } = await fixtureContext();
  assert.throws(() => prepareProductionSourceCompositionInput(context, "unknown" as never), /trusted PBOV/);
});

test("same endpoint package remains reference-only and foreign endpoint package is not attached", async () => {
  const { context, opportunityVersionId, executions, fixture } = await fixtureContext();
  const packageSource = trustedPackageFixture("preparation-package").package_source;
  const foreignPackage = await context.execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input: {
    source_role: "PACKAGE", endpoint: packageSource.endpoint,
    snapshot: packageSource.snapshot, extracted_record: packageSource.extracted_record
  } }) as TrustedSourceOccurrenceArtifact;
  const endpoint = fixture.source.endpoint;
  const snapshot = { ...packageSource.snapshot, snapshot_id: `${packageSource.snapshot.snapshot_id}-same-endpoint` as never,
    recruitment_endpoint_id: endpoint.recruitment_endpoint_id,
    request_metadata: { ...packageSource.snapshot.request_metadata, locator: endpoint.locator } };
  const samePackage = await context.execute({ kind: "SOURCE_OCCURRENCE_MATERIALIZE", input: {
    source_role: "PACKAGE", endpoint, snapshot,
    extracted_record: createExtractedRecordV2(snapshot, { ...packageSource.extracted_record,
      source_definition_id: endpoint.source_definition_id })
  } }) as TrustedSourceOccurrenceArtifact;
  const input = prepareProductionSourceCompositionInput({ ...context,
    available_artifact_references: executions.flatMap(execution => execution.record.expected_artifacts)
  }, opportunityVersionId);
  assert.equal(input.source_surfaces.length, 2);
  assert.ok(!input.source_surfaces.some(surface => surface.source_occurrence_version_id === foreignPackage.version.source_occurrence_version_id));
  const entry = input.inventory.expected_surface_entries.find(item => item.expectedness === "REFERENCE_ONLY");
  assert.ok(entry);
  assert.equal(entry.requirement_level, "NON_REQUIREMENT_REFERENCE");
  const binding = input.source_surface_bindings.find(item => item.source_surface_id === entry.source_surface_id);
  assert.equal(binding?.target_type, "SYSTEM_RECORD");
  assert.equal(binding?.target_id, samePackage.version.source_occurrence_version_id);
  assert.notEqual(binding?.target_id, opportunityVersionId);
  const result = await context.execute({ kind: "SOURCE_COMPOSITION_MATERIALIZE", input: {
    opportunity_version_id: opportunityVersionId, composition_input: input
  } }) as import("../../lib/ingestion").SourceCompositionResult;
  assert.equal(result.status, "UNRESOLVED");
});

test("multiple trusted compositions do not silently select an arbitrary completeness state", async () => {
  const { context, opportunityVersionId, executions, fixture } = await fixtureContext();
  for (const compositionInput of [fixture.composition_input, prepareProductionSourceCompositionInput(context, opportunityVersionId)]) {
    await context.execute({ kind: "SOURCE_COMPOSITION_MATERIALIZE", input: {
      opportunity_version_id: opportunityVersionId, composition_input: compositionInput
    } });
  }
  await assert.rejects(executeProductionTrustedChainBinding({ ...context,
    available_artifact_references: executions.flatMap(execution => execution.record.expected_artifacts)
  }), /ambiguous trusted SourceComposition selection/);
  assert.ok(!executions.some(execution => execution.record.command_kind === "ELIGIBILITY_MATERIALIZE"));
});

test("production binding executes existing Composition and Relevance but stops at incomplete evidence", async () => {
  const { context, executions } = await fixtureContext();
  await executeProductionTrustedChainBinding(context);
  const kinds = executions.map(execution => execution.record.command_kind);
  assert.ok(kinds.includes("SOURCE_COMPOSITION_MATERIALIZE"));
  assert.ok(kinds.includes("LEGAL_RELEVANCE_ASSESS"));
  assert.ok(kinds.includes("PRESENTATION_READ_MODEL_MATERIALIZE"));
  assert.ok(!kinds.some(kind => /REQUIREMENT|ELIGIBILITY|PREDICATE|CANDIDATE_EVIDENCE/u.test(kind)));
});

test("existing complete composition is reused, Requirement runs, absent candidate evidence stops predicates", async () => {
  const { context, opportunityVersionId, executions, fixture } = await fixtureContext();
  const composition = await context.execute({ kind: "SOURCE_COMPOSITION_MATERIALIZE", input: {
    opportunity_version_id: opportunityVersionId, composition_input: fixture.composition_input
  } }) as import("../../lib/ingestion").SourceCompositionResult;
  assert.equal(composition.status, "COMPLETE");
  await executeProductionTrustedChainBinding({ ...context,
    available_artifact_references: executions.flatMap(execution => execution.record.expected_artifacts) });
  const kinds = executions.map(execution => execution.record.command_kind);
  assert.equal(kinds.filter(kind => kind === "SOURCE_COMPOSITION_MATERIALIZE").length, 1);
  assert.ok(kinds.includes("REQUIREMENT_PROJECTION_MATERIALIZE"));
  assert.ok(kinds.includes("REQUIREMENT_SET_MATERIALIZE"));
  assert.ok(!kinds.some(kind => /ELIGIBILITY|PREDICATE|CANDIDATE_EVIDENCE/u.test(kind)));
});
