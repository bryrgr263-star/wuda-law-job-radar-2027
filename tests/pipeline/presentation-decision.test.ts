import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  ELIGIBILITY_ASSESSMENT_RULE_VERSION,
  PREDICATE_RESOLUTION_RULE_VERSION,
  InMemoryLegalEmploymentRelevanceTracker,
  SqliteShadowPersistence,
  UTF8_TEXT_ENCODING,
  PresentationDecisionError,
  assertPresentationDecisionIntegrity,
  assertTrustedPresentationDecisionResolver,
  createApprovedPresentationPolicyV1,
  createApprovedRecallExclusionPolicyV1,
  createInMemoryOpportunityRecallBoundary,
  createPresentationDecisionBoundary,
  createPresentationReadModelMaterializer,
  createPresentationPersistenceBoundary,
  type PresentationDecision,
  type PresentationPersistenceRepository,
  type PresentationReadModel,
  type Organization,
  type SourceDefinition,
  type IsoDateTime
} from "../../lib/ingestion";
import {
  ReadOnlyPresentationApi,
  READ_ONLY_PRESENTATION_API_BASE_PATH
} from "../../lib/presentation-read-api";
import {
  InMemoryPositionBoundSourceCompositionTracker
} from "../../lib/ingestion/pipeline/position-bound-source-composition";
import {
  CanonicalArtifactRegistryError,
  createCanonicalArtifactRegistryAuthority
} from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { createMigratedShadowDatabase } from "../persistence/shadow-test-database";
import { buildAuthoritativePresentationCurrentSnapshot } from "../../lib/ingestion/pipeline/presentation-persistence";
import { canonicalHash, canonicalSerialize } from "../../lib/ingestion/normalization/canonical-artifact-registry";
import { buildPresentationSemanticProjectionV2, presentationSemanticHash, PresentationSemanticProjectionError } from "../../lib/ingestion/pipeline/presentation-semantic-projection";
import {
  AS_OF,
  CANDIDATE_ID,
  OBSERVED_AT,
  materializeSyntheticCandidateEvidence,
  materializeTrustedChain,
  syntheticCandidateProfile,
  trustedFixture
} from "./position-bound-phase-fixture";

test("PresentationPolicy V1 is an approved root-owned boundary", () => {
  const policy = createApprovedPresentationPolicyV1();
  assert.equal(policy.policy_id, "approved-presentation-policy");
  assert.equal(policy.policy_version, "1.0.0");
});

test("trusted eligible legal Position is DISPLAY and idempotent", () => {
  const context = presentationContext("presentation-eligible", true);
  const first = context.boundary.decide(context.command());
  const replay = context.boundary.decide(context.command());

  assert.equal(first.decision.status, "DISPLAY");
  assert.equal(first.version_created, true);
  assert.equal(replay.version_created, false);
  assert.equal(replay.decision.presentation_decision_id,
    first.decision.presentation_decision_id);
  assert.equal(first.decision.decision_basis.candidate_source_binding, "BOUND");
});

test("trusted NEEDS_REVIEW remains visible with review", () => {
  const context = presentationContext("presentation-review", false);
  const decision = context.boundary.decide(context.command()).decision;

  assert.equal(decision.status, "DISPLAY_WITH_REVIEW");
  assert.equal(decision.decision_basis.eligibility_result, "NEEDS_REVIEW");
});

test("missing trusted eligibility is EVIDENCE_BLOCKED and appends a revision", () => {
  const context = presentationContext("presentation-gap", true);
  const incomplete = context.boundary.decide(context.command(null));
  const complete = context.boundary.decide(context.command());

  assert.equal(incomplete.decision.status, "EVIDENCE_BLOCKED");
  assert.notEqual(incomplete.decision.status, "NOT_DISPLAY");
  assert.equal(complete.decision.revision, 2);
  assert.equal(complete.decision.supersedes_presentation_decision_id,
    incomplete.decision.presentation_decision_id);
});

test("legacy display fields and caller profile-shaped extras cannot alter a decision", () => {
  const context = presentationContext("presentation-legacy-fields", true);
  const trusted = context.boundary.decide(context.command()).decision;
  const withIgnoredExtras = context.boundary.decide({
    ...context.command(),
    match_score: 100,
    non_law_rule: "FORGED",
    is_published: false,
    candidate_profile: { institution: "武汉大学" }
  } as unknown as Parameters<typeof context.boundary.decide>[0]).decision;

  assert.equal(withIgnoredExtras.presentation_decision_id,
    trusted.presentation_decision_id);
  assert.equal(withIgnoredExtras.status, "DISPLAY");
});

test("only approved Recall exclusion can hide before Position materialization", () => {
  const fixture = trustedFixture("presentation-excluded");
  const recall = createInMemoryOpportunityRecallBoundary({
    exclusion_policy: createApprovedRecallExclusionPolicyV1()
  });
  const registered = recall.register({
    source_definition_id: fixture.source.endpoint.source_definition_id,
    recruitment_endpoint_id: fixture.source.endpoint.recruitment_endpoint_id,
    discovery_locator: fixture.source.endpoint.locator,
    snapshot_id: fixture.source.snapshot.snapshot_id,
    extracted_record_id: fixture.source.extracted_record.extracted_record_id,
    source_occurrence_version_id: fixture.source.version.source_occurrence_version_id,
    publisher_subject: {
      subject_identity: "organization:中国建筑",
      subject_display_name: "中国建筑",
      evidence_id: "publisher:china-state-construction"
    },
    discovery_evidence_ids: ["publisher:china-state-construction"],
    first_observed_at: OBSERVED_AT,
    initial_disposition: {
      status: "RETAINED",
      reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
      evidence_ids: ["publisher:china-state-construction"],
      decided_at: OBSERVED_AT
    }
  });
  const excluded = recall.recordApprovedExclusion({
    opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
    decided_at: AS_OF
  }).disposition;
  const relevance = new InMemoryLegalEmploymentRelevanceTracker(
    fixture.pbov_tracker,
    new InMemoryPositionBoundSourceCompositionTracker(fixture.pbov_tracker)
  );
  const boundary = createPresentationDecisionBoundary({
    candidates: recall.candidates,
    recall_dispositions: recall.dispositions,
    position_bound_opportunities: fixture.pbov_tracker,
    relevance,
    eligibility: fixture.chain.eligibility_assessments
  });
  const decision = boundary.decide({
    opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
    recall_disposition_id: excluded.recall_disposition_id,
    relevance_assessment_id: null,
    eligibility_assessment_id: null,
    decided_at: AS_OF
  }).decision;

  assert.equal(decision.status, "NOT_DISPLAY");
  assert.equal(decision.decision_basis.approved_exclusion, true);
});

test("trusted strict NOT_RELEVANT can hide only after closed Position evidence", () => {
  const context = relevanceOnlyContext("presentation-not-relevant",
    "岗位名称：机械设计工程师；岗位职责：机械设计、产品研发和工艺设计；专业要求：机械工程");
  const decision = context.boundary.decide(context.command()).decision;

  assert.equal(decision.status, "NOT_DISPLAY");
  assert.equal(decision.reason_codes[0], "TRUSTED_NOT_RELEVANT");
  assert.equal(decision.decision_basis.approved_exclusion, false);
});

test("forged resolvers and mutations cannot alter sealed presentation decisions", () => {
  const context = presentationContext("presentation-isolation", true);
  assert.throws(() => createPresentationDecisionBoundary({
    candidates: {} as never,
    recall_dispositions: context.recall.dispositions,
    position_bound_opportunities: context.fixture.pbov_tracker,
    relevance: context.relevance,
    eligibility: context.fixture.chain.eligibility_assessments
  }));

  const decision = context.boundary.decide(context.command()).decision;
  const resolved = context.boundary.decisions.resolve(
    decision.presentation_decision_id
  )!;
  (resolved.reason_codes as string[])[0] = "FORGED";
  assert.notEqual(
    context.boundary.decisions.resolve(decision.presentation_decision_id)
      ?.reason_codes[0],
    "FORGED"
  );
  const forged = structuredClone(decision);
  (forged as { status: string }).status = "NOT_DISPLAY";
  assert.throws(() => assertPresentationDecisionIntegrity(forged),
    PresentationDecisionError);
  assert.equal(assertTrustedPresentationDecisionResolver(context.boundary.decisions),
    context.boundary.decisions);
});

test("PresentationDecision canonical identity collision is rejected", () => {
  const context = presentationContext("presentation-collision", true);
  const decision = context.boundary.decide(context.command()).decision;
  const registry = createCanonicalArtifactRegistryAuthority(
    (artifact: typeof decision) => artifact.presentation_decision_id
  );
  registry.writer.seal(decision.presentation_decision_id, decision);
  assert.throws(() => registry.writer.seal(decision.presentation_decision_id, {
    ...decision,
    status: "DISPLAY_WITH_REVIEW" as const
  }), (error: unknown) => {
    return error instanceof CanonicalArtifactRegistryError
      && error.code === "IDENTITY_COLLISION";
  });
});

test("sealed PresentationDecision materializes an immutable read model", () => {
  const context = presentationContext("presentation-read-model", true);
  const decision = context.boundary.decide(context.command()).decision;
  const materializer = createPresentationReadModelMaterializer({
    decisions: context.boundary.decisions,
    position_bound_opportunities: context.fixture.pbov_tracker,
    requirement_sets: context.fixture.chain.requirement_set_resolver
  });
  const first = materializer.materialize(decision.presentation_decision_id);
  const replay = materializer.materialize(decision.presentation_decision_id);
  assert.equal(first.version_created, true);
  assert.equal(replay.version_created, false);
  assert.equal(first.read_model.presentation_status, "DISPLAY");
  assert.equal(first.read_model.position_title.state, "AVAILABLE");
  assert.equal(first.read_model.requirement_summary.state, "AVAILABLE");
  const clone = materializer.resolve(first.read_model.presentation_read_model_id)!;
  (clone.reason_codes as string[])[0] = "FORGED";
  assert.notEqual(materializer.resolve(first.read_model.presentation_read_model_id)
    ?.reason_codes[0], "FORGED");
});

test("only root-owned sealed artifacts can enter Presentation persistence", () => {
  const context = presentationContext("presentation-persistence-boundary", true);
  const decision = context.boundary.decide(context.command()).decision;
  const materializer = createPresentationReadModelMaterializer({
    decisions: context.boundary.decisions,
    position_bound_opportunities: context.fixture.pbov_tracker,
    requirement_sets: context.fixture.chain.requirement_set_resolver
  });
  const persistence = inMemoryPresentationPersistence();
  const boundary = createPresentationPersistenceBoundary({
    decisions: context.boundary.decisions,
    materializer,
    persistence
  });
  const first = boundary.persist(decision.presentation_decision_id);
  const replay = boundary.persist(decision.presentation_decision_id);

  assert.equal(first.decision.integrity_hash, decision.integrity_hash);
  assert.equal(replay.read_model.integrity_hash, first.read_model.integrity_hash);
  (first.read_model.reason_codes as string[])[0] = "FORGED";
  assert.notEqual(boundary.persist(decision.presentation_decision_id)
    .read_model.reason_codes[0], "FORGED");
  assert.throws(() => createPresentationPersistenceBoundary({
    decisions: {} as never,
    materializer,
    persistence
  }), /composition-root controlled/);
  assert.throws(() => createPresentationPersistenceBoundary({
    decisions: context.boundary.decisions,
    materializer: {} as never,
    persistence
  }), /composition-root controlled/);
});

test("synthetic trusted chain persists a provenance-marked ReadModel for the read-only API", async () => {
  const context = presentationContext("presentation-api-e2e", true);
  const decision = context.boundary.decide(context.command()).decision;
  const database = createMigratedShadowDatabase();
  const persistence = new SqliteShadowPersistence(database);
  persistSyntheticRecallPrerequisites(persistence, context);
  const materializer = createPresentationReadModelMaterializer({
    decisions: context.boundary.decisions,
    position_bound_opportunities: context.fixture.pbov_tracker,
    requirement_sets: context.fixture.chain.requirement_set_resolver
  });
  const writer = createPresentationPersistenceBoundary({
    decisions: context.boundary.decisions,
    materializer,
    persistence: persistence.presentation
  });
  const persisted = writer.persist(decision.presentation_decision_id);
  const api = new ReadOnlyPresentationApi(persistence.presentation);
  const list = await api.handle(new Request(
    `https://test.invalid${READ_ONLY_PRESENTATION_API_BASE_PATH}/opportunities`
  ));
  const listed = await list.json() as { opportunities: readonly PresentationReadModel[] };
  const detail = await api.handle(new Request(
    `https://test.invalid${READ_ONLY_PRESENTATION_API_BASE_PATH}/opportunities/${encodeURIComponent(String(decision.opportunity_candidate_id))}`
  ));
  const detailed = await detail.json() as PresentationReadModel;

  assert.equal(persisted.decision.eligibility_assessment_scope, "SYNTHETIC_TEST");
  assert.equal(persisted.read_model.upstream.eligibility_assessment_scope, "SYNTHETIC_TEST");
  assert.equal(list.status, 200);
  assert.equal(listed.opportunities.length, 1);
  assert.equal(listed.opportunities[0]?.presentation_status, "DISPLAY");
  assert.equal(detail.status, 200);
  assert.equal(detailed.presentation_decision_id, persisted.decision.presentation_decision_id);
  assert.equal(detailed.upstream.eligibility_assessment_scope, "SYNTHETIC_TEST");
  database.close();
});

test("diagnostic: repeated discovery of the same trusted Position currently duplicates API presentation", async () => {
  const context = presentationContext("presentation-repeat-discovery-probe", true);
  const v2Command = {
    ...context.command(),
    contract_version: "presentation-decision/2.0.0" as const,
    expected_current_presentation_decision_id: null
  };
  const first = context.boundary.decide(v2Command).decision;
  const repeated = context.recall.register({
    source_definition_id: context.fixture.source.endpoint.source_definition_id,
    recruitment_endpoint_id: context.fixture.source.endpoint.recruitment_endpoint_id,
    discovery_locator: context.fixture.source.endpoint.locator,
    snapshot_id: context.fixture.source.snapshot.snapshot_id,
    extracted_record_id: context.fixture.source.extracted_record.extracted_record_id,
    source_occurrence_version_id: context.fixture.source.version.source_occurrence_version_id,
    publisher_subject: null,
    discovery_evidence_ids: ["official:fixture"],
    first_observed_at: AS_OF,
    initial_disposition: {
      status: "RETAINED",
      reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
      evidence_ids: ["official:fixture"],
      decided_at: AS_OF
    }
  });
  const second = context.boundary.decide({
    ...v2Command,
    expected_current_presentation_decision_id: first.presentation_decision_id,
    opportunity_candidate_id: repeated.candidate.opportunity_candidate_id,
    recall_disposition_id: repeated.disposition.recall_disposition_id
  }).decision;
  assert.notEqual(first.opportunity_candidate_id, repeated.candidate.opportunity_candidate_id);
  assert.ok(context.recall.candidates.resolve(first.opportunity_candidate_id));
  assert.ok(context.recall.candidates.resolve(repeated.candidate.opportunity_candidate_id));
  assert.equal(first.position_id, second.position_id);
  assert.equal(first.position_version_id, second.position_version_id);
  assert.equal(first.opportunity_version_id, second.opportunity_version_id);
  assert.equal(first.presentation_decision_id, second.presentation_decision_id);
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1);

  const database = createMigratedShadowDatabase();
  try {
    const persistence = new SqliteShadowPersistence(database);
    persistSyntheticRecallPrerequisites(persistence, context);
    persistence.opportunity_recall.appendRegistration(repeated.candidate, repeated.disposition);
    const materializer = createPresentationReadModelMaterializer({
      decisions: context.boundary.decisions,
      position_bound_opportunities: context.fixture.pbov_tracker,
      requirement_sets: context.fixture.chain.requirement_set_resolver
    });
    const writer = createPresentationPersistenceBoundary({
      decisions: context.boundary.decisions,
      materializer,
      persistence: persistence.presentation
    });
    const firstPersisted = writer.persist(first.presentation_decision_id);
    const secondPersisted = writer.persist(second.presentation_decision_id);
    assert.equal(firstPersisted.read_model.presentation_read_model_id,
      secondPersisted.read_model.presentation_read_model_id);
    assert.throws(() => database.prepare("UPDATE shadow_presentation_v2_decisions SET payload_json = '{}' WHERE presentation_decision_id = ?").run(first.presentation_decision_id), /append-only/);
    assert.throws(() => database.prepare("DELETE FROM shadow_presentation_v2_read_models WHERE presentation_read_model_id = ?").run(firstPersisted.read_model.presentation_read_model_id), /append-only/);
    const changed = { ...first, decided_at: "2026-09-17T00:00:00.000Z" as IsoDateTime };
    const { integrity_hash: _previousHash, ...changedPayload } = changed;
    assert.throws(() => persistence.presentation.appendDecision({ ...changedPayload, integrity_hash: canonicalHash(changedPayload) }), /collision/);
    assert.throws(() => database.prepare(`INSERT INTO shadow_presentation_v2_decisions
      (presentation_decision_id, opportunity_candidate_id, scope, record_kind, position_id, revision, semantic_hash, projection_version, integrity_hash, payload_json)
      VALUES ('invalid-null-revision', ?, 'SYNTHETIC_TEST', 'POSITION_PRESENTATION', ?, NULL, ?, 'presentation-semantic-projection/2.0.0', ?, '{}')`)
      .run(first.opportunity_candidate_id, first.position_id, "a".repeat(64), "b".repeat(64)), /CHECK constraint/);
    const api = new ReadOnlyPresentationApi(writer.read_repository);
    const response = await api.handle(new Request(
      `https://test.invalid${READ_ONLY_PRESENTATION_API_BASE_PATH}/opportunities`
    ));
    const listed = await response.json() as { opportunities: readonly PresentationReadModel[] };
    assert.equal(response.status, 200);
    assert.equal(listed.opportunities.length, 1);
    assert.equal(new Set(listed.opportunities.map((model) => model.position_id)).size, 1);
    assert.equal(new Set(listed.opportunities.map((model) => model.opportunity_version_id)).size, 1);
    assert.ok(listed.opportunities.every((model) => model.presentation_status === "DISPLAY"
      && model.upstream.eligibility_assessment_scope === "SYNTHETIC_TEST"));
  } finally {
    database.close();
  }
});

test("V2 compares only the Position head and appends a state reversal", () => {
  const context = presentationContext("presentation-v2-reversal", true);
  const first = context.boundary.decide({ ...context.command(), contract_version: "presentation-decision/2.0.0",
    expected_current_presentation_decision_id: null }).decision;
  const second = context.boundary.decide({ ...context.command(null), contract_version: "presentation-decision/2.0.0",
    expected_current_presentation_decision_id: first.presentation_decision_id }).decision;
  const third = context.boundary.decide({ ...context.command(), contract_version: "presentation-decision/2.0.0",
    expected_current_presentation_decision_id: second.presentation_decision_id }).decision;
  assert.equal(first.status, "DISPLAY");
  assert.equal(second.status, "EVIDENCE_BLOCKED");
  assert.equal(third.status, "DISPLAY");
  assert.deepEqual([first.revision, second.revision, third.revision], [1, 2, 3]);
  assert.notEqual(first.presentation_decision_id, third.presentation_decision_id);
  assert.equal(third.supersedes_presentation_decision_id, second.presentation_decision_id);
  assert.equal(context.boundary.decisions.resolvePositionCurrent("SYNTHETIC_TEST", first.position_id!)?.presentation_decision_id,
    third.presentation_decision_id);
});

test("V2 rejects a stale writer without replacing the Position head", () => {
  const context = presentationContext("presentation-v2-stale", true);
  const command = { ...context.command(), contract_version: "presentation-decision/2.0.0" as const,
    expected_current_presentation_decision_id: null };
  const first = context.boundary.decide(command).decision;
  assert.throws(() => context.boundary.decide(command), /stale/);
  assert.deepEqual(context.boundary.decisions.resolve(first.presentation_decision_id), first);
});

test("V2 DISPLAY to DISPLAY_WITH_REVIEW to DISPLAY appends rather than resurrects history", () => {
  const context = presentationContext("presentation-v2-review-reversal", true);
  const requirement = context.materialized.requirementSet;
  const reviewEvidence = context.fixture.chain.candidate_evidence.materialize_synthetic_fixture({
    candidate_profile: syntheticCandidateProfile("presentation-v2-review"),
    observed_at: OBSERVED_AT, effective_from: OBSERVED_AT
  });
  const reviewEvidenceIds = reviewEvidence.evidence_ids.filter((id) => context.fixture.chain.candidate_evidence.resolve(id)?.value?.kind !== "EDUCATION_CREDENTIAL");
  const predicates = context.fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id, source_composition_id: requirement.source_composition_id,
    requirement_set_version_id: requirement.requirement_set_version_id, candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: reviewEvidenceIds, as_of: AS_OF, predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.equal(predicates.status, "RESOLUTION_SET");
  const review = context.fixture.chain.eligibility_assessments.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id, source_composition_id: requirement.source_composition_id,
    requirement_set_version_id: requirement.requirement_set_version_id, candidate_profile_id: CANDIDATE_ID,
    predicate_resolution_ids: predicates.resolutions.map((item) => item.predicate_resolution_id), candidate_evidence_ids: reviewEvidenceIds,
    as_of: AS_OF, predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION, assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  });
  assert.equal(review.status, "ASSESSMENT");
  const first = context.boundary.decide({ ...context.command(), contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: null }).decision;
  const second = context.boundary.decide({ ...context.command(review.assessment.eligibility_assessment_id), contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: first.presentation_decision_id }).decision;
  const third = context.boundary.decide({ ...context.command(), contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: second.presentation_decision_id }).decision;
  assert.deepEqual([first.status, second.status, third.status], ["DISPLAY", "DISPLAY_WITH_REVIEW", "DISPLAY"]);
  assert.deepEqual([first.revision, second.revision, third.revision], [1, 2, 3]);
  assert.equal(third.supersedes_presentation_decision_id, second.presentation_decision_id);
  assert.notEqual(first.presentation_decision_id, third.presentation_decision_id);
});

test("V2 semantic projection preserves display, Requirement values, availability and source trust differences", () => {
  const context = presentationContext("presentation-v2-semantic-differences", true);
  const decision = context.boundary.decide({ ...context.command(), contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: null }).decision;
  const graph = context.fixture.pbov_tracker.resolve(context.fixture.opportunity_version_id)!;
  const input = { scope: "SYNTHETIC_TEST" as const, graph,
    source_bindings: context.fixture.pbov_tracker.resolveSources(context.fixture.opportunity_version_id)!, decision,
    recall: context.recall.dispositions.resolve(decision.recall_disposition_id)!,
    relevance: context.relevance.resolve(decision.relevance_assessment_id as never),
    eligibility: context.fixture.chain.eligibility_assessments.resolve(decision.eligibility_assessment_id!),
    requirement: context.materialized.requirementSet, requirement_projection: context.materialized.projection,
    composition: context.materialized.sourceComposition };
  const initial = buildPresentationSemanticProjectionV2(input);
  assert.ok(input.eligibility);
  const eventOnlyEligibility = { ...input.eligibility, decision_basis: { ...input.eligibility.decision_basis,
    predicate_resolutions: input.eligibility.decision_basis.predicate_resolutions.map((predicate) => ({ ...predicate,
      predicate_resolution_id: "nonsemantic-local-predicate-id" as never })) } };
  assert.equal(presentationSemanticHash(buildPresentationSemanticProjectionV2({ ...input, eligibility: eventOnlyEligibility })), presentationSemanticHash(initial));
  const changedPredicate = { ...eventOnlyEligibility, decision_basis: { ...eventOnlyEligibility.decision_basis,
    predicate_resolutions: eventOnlyEligibility.decision_basis.predicate_resolutions.map((predicate) => ({ ...predicate,
      predicate_resolution_semantic_hash: "b".repeat(64) })) } };
  assert.notEqual(presentationSemanticHash(buildPresentationSemanticProjectionV2({ ...input, eligibility: changedPredicate })), presentationSemanticHash(initial));
  for (const field of ["recruitment_year", "announcement_locator", "application_locator"] as const) {
    const changed = structuredClone(graph);
    const content = changed.opportunity_version.content;
    const update = field === "recruitment_year" ? 2029 : "https://test.invalid/changed";
    const revised = { ...changed, opportunity_version: { ...changed.opportunity_version, content: { ...content, [field]: update } } };
    assert.notEqual(presentationSemanticHash(buildPresentationSemanticProjectionV2({ ...input, graph: revised })), presentationSemanticHash(initial));
  }
  const requirement = structuredClone(input.requirement);
  const firstFact = requirement.requirement_set.fact_registry[0]!;
  const changedRequirement = { ...requirement, requirement_set: { ...requirement.requirement_set,
    fact_registry: [{ ...firstFact, value: { kind: "CODE" as const, code: "DOCTOR" } }, ...requirement.requirement_set.fact_registry.slice(1)] } };
  assert.notEqual(presentationSemanticHash(buildPresentationSemanticProjectionV2({ ...input, requirement: changedRequirement })), presentationSemanticHash(initial));
  assert.notEqual(presentationSemanticHash(buildPresentationSemanticProjectionV2({ ...input, requirement: null, requirement_projection: null, eligibility: null })), presentationSemanticHash(initial));
  const composition = structuredClone(input.composition);
  const changedSurface = { ...composition.source_surfaces[0]!, surface_content_hash: "a".repeat(64) };
  const changedComposition = { ...composition, source_surfaces: [changedSurface, ...composition.source_surfaces.slice(1)] };
  assert.notEqual(presentationSemanticHash(buildPresentationSemanticProjectionV2({ ...input, composition: changedComposition })), presentationSemanticHash(initial));
  const changedStatus = { ...composition, status: "INCOMPLETE" as const };
  assert.notEqual(presentationSemanticHash(buildPresentationSemanticProjectionV2({ ...input, composition: changedStatus })), presentationSemanticHash(initial));
  assert.ok(composition.authority_assertions.length > 0);
  const changedAuthority = { ...composition, authority_assertions: composition.authority_assertions.map((authority) => ({
    ...authority, authority_state: "UNKNOWN" as const })) };
  assert.notEqual(presentationSemanticHash(buildPresentationSemanticProjectionV2({ ...input, composition: changedAuthority })), presentationSemanticHash(initial));
  const unsupportedComposition = { ...composition, unexpected_business_field: true };
  assert.throws(() => buildPresentationSemanticProjectionV2({ ...input, composition: unsupportedComposition }), PresentationSemanticProjectionError);
  assert.equal(canonicalSerialize(initial), canonicalSerialize(buildPresentationSemanticProjectionV2(input)));
});

test("V2 positionless outcomes retain null public revision and later bind without rewriting audit bytes", () => {
  const context = presentationContext("presentation-v2-unbound", true);
  const command = { ...context.command(null), relevance_assessment_id: null,
    contract_version: "presentation-decision/2.0.0" as const, expected_current_presentation_decision_id: null };
  const audit = context.boundary.decide(command).decision;
  assert.equal(audit.schema_version, "presentation-decision/2.0.0");
  assert.equal(audit.position_id, null);
  assert.equal(audit.revision, null);
  assert.equal(audit.supersedes_presentation_decision_id, null);
  const anotherAudit = context.boundary.decide({ ...command,
    decided_at: "2026-09-18T00:00:00.000Z" as IsoDateTime }).decision;
  const auditInput = { scope: "SYNTHETIC_TEST" as const, authoritative_head: "test-audit-head",
    decisions: [audit, anotherAudit], read_models: [], candidate_associations: [] };
  const retained = buildAuthoritativePresentationCurrentSnapshot(auditInput);
  assert.equal(retained.retention.unbound_outcome_count, 2);
  assert.equal(retained.retention.pending_candidate_count, 1);
  assert.equal(canonicalSerialize(retained), canonicalSerialize(buildAuthoritativePresentationCurrentSnapshot({
    ...auditInput, decisions: [anotherAudit, audit] })));
  const bound = context.boundary.decide({ ...command, opportunity_version_id: context.fixture.opportunity_version_id }).decision;
  assert.equal(bound.position_id, context.fixture.pbov_tracker.resolve(context.fixture.opportunity_version_id)!.position.position_id);
  assert.equal(bound.revision, 1);
  assert.equal(bound.status, "EVIDENCE_BLOCKED");
  const materializer = createPresentationReadModelMaterializer({ decisions: context.boundary.decisions,
    position_bound_opportunities: context.fixture.pbov_tracker, requirement_sets: context.fixture.chain.requirement_set_resolver });
  const model = materializer.materialize(bound.presentation_decision_id).read_model;
  const transitioned = buildAuthoritativePresentationCurrentSnapshot({ ...auditInput,
    decisions: [audit, anotherAudit, bound], read_models: [model] });
  assert.equal(transitioned.retention.unbound_outcome_count, 2);
  assert.equal(transitioned.retention.pending_candidate_count, 0);
  assert.deepEqual(transitioned.candidate_details[bound.opportunity_candidate_id], model);
  assert.deepEqual(context.boundary.decisions.resolve(audit.presentation_decision_id), audit);
});

test("V2 current NOT_DISPLAY retains its history and never falls back to historical DISPLAY", async () => {
  const context = presentationContext("presentation-v2-negative-head", true, "法务岗", true);
  const first = context.boundary.decide({ ...context.command(), contract_version: "presentation-decision/2.0.0", expected_current_presentation_decision_id: null }).decision;
  const excluded = context.recall.recordApprovedExclusion({ opportunity_candidate_id: first.opportunity_candidate_id, decided_at: AS_OF }).disposition;
  const second = context.boundary.decide({ ...context.command(null), contract_version: "presentation-decision/2.0.0",
    opportunity_version_id: context.fixture.opportunity_version_id, relevance_assessment_id: null,
    recall_disposition_id: excluded.recall_disposition_id, expected_current_presentation_decision_id: first.presentation_decision_id }).decision;
  assert.equal(second.status, "NOT_DISPLAY");
  assert.equal(second.revision, 2);
  const materializer = createPresentationReadModelMaterializer({ decisions: context.boundary.decisions,
    position_bound_opportunities: context.fixture.pbov_tracker, requirement_sets: context.fixture.chain.requirement_set_resolver });
  const models = [first, second].map((decision) => materializer.materialize(decision.presentation_decision_id).read_model);
  const snapshot = buildAuthoritativePresentationCurrentSnapshot({ scope: "SYNTHETIC_TEST", authoritative_head: "test-negative-head",
    decisions: [first, second], read_models: models, candidate_associations: [] });
  assert.equal(snapshot.current_position_read_models[0]?.presentation_status, "NOT_DISPLAY");
  const api = new ReadOnlyPresentationApi({ readCurrentSnapshot: () => snapshot, listCurrentReadModels: () => { throw new Error("no historical fallback"); } });
  const response = await api.handle(new Request("https://test.invalid/api/presentation/v1/opportunities"));
  assert.equal((await response.json()).pagination.total, 0);
  const detail = await api.handle(new Request(`https://test.invalid/api/presentation/v1/opportunities/${first.opportunity_candidate_id}`));
  assert.equal(detail.status, 404);
  assert.deepEqual(context.boundary.decisions.resolve(first.presentation_decision_id), first);
});

test("V2 current validates every revision/model and preserves Candidate association details", () => {
  const context = presentationContext("presentation-v2-current-integrity", true);
  const first = context.boundary.decide({ ...context.command(), contract_version: "presentation-decision/2.0.0",
    expected_current_presentation_decision_id: null }).decision;
  const second = context.boundary.decide({ ...context.command(null), contract_version: "presentation-decision/2.0.0",
    expected_current_presentation_decision_id: first.presentation_decision_id }).decision;
  const materializer = createPresentationReadModelMaterializer({ decisions: context.boundary.decisions,
    position_bound_opportunities: context.fixture.pbov_tracker, requirement_sets: context.fixture.chain.requirement_set_resolver });
  const models = [first, second].map((decision) => materializer.materialize(decision.presentation_decision_id).read_model);
  const input = { scope: "SYNTHETIC_TEST" as const, authoritative_head: "test-anchored-state",
    decisions: [first, second], read_models: models,
    candidate_associations: [{ opportunity_candidate_id: "verified-rediscovery-candidate", presentation_decision_id: first.presentation_decision_id }] };
  const snapshot = buildAuthoritativePresentationCurrentSnapshot(input);
  assert.equal(snapshot.current_position_read_models.length, 1);
  assert.equal(snapshot.current_position_read_models[0]?.presentation_decision_id, second.presentation_decision_id);
  assert.deepEqual(snapshot.candidate_details["verified-rediscovery-candidate"], models[1]);
  assert.equal(canonicalSerialize(snapshot), canonicalSerialize(buildAuthoritativePresentationCurrentSnapshot({
    ...input, decisions: [second, first], read_models: [...models].reverse() })));
  assert.throws(() => buildAuthoritativePresentationCurrentSnapshot({ ...input, read_models: [models[0]!] }), /matching ReadModel/);
  assert.throws(() => buildAuthoritativePresentationCurrentSnapshot({ ...input, decisions: [second] }), /predecessor/);
  assert.throws(() => buildAuthoritativePresentationCurrentSnapshot({ ...input, scope: "PRODUCTION" }), /scope mixing/);
  const mutated = structuredClone(second);
  const { integrity_hash: _hash, ...payload } = mutated;
  const branched = { ...payload, supersedes_presentation_decision_id: "different-predecessor" as never };
  assert.throws(() => buildAuthoritativePresentationCurrentSnapshot({ ...input,
    decisions: [first, { ...branched, integrity_hash: canonicalHash(branched) }] }), /predecessor/);
  Reflect.set(snapshot.current_position_read_models[0]!.reason_codes, 0, "forged");
  assert.deepEqual(buildAuthoritativePresentationCurrentSnapshot(input).current_position_read_models[0], models[1]);
});

test("V2 Candidate compatibility lookup follows its associated Position head", () => {
  const context = presentationContext("presentation-v2-candidate-current", true);
  const command = { ...context.command(), contract_version: "presentation-decision/2.0.0" as const,
    expected_current_presentation_decision_id: null };
  const first = context.boundary.decide(command).decision;
  const registered = context.recall.register({
    source_definition_id: context.fixture.source.endpoint.source_definition_id,
    recruitment_endpoint_id: context.fixture.source.endpoint.recruitment_endpoint_id,
    discovery_locator: context.fixture.source.endpoint.locator,
    snapshot_id: context.fixture.source.snapshot.snapshot_id,
    extracted_record_id: context.fixture.source.extracted_record.extracted_record_id,
    source_occurrence_version_id: context.fixture.source.version.source_occurrence_version_id,
    publisher_subject: null, discovery_evidence_ids: ["official:fixture"], first_observed_at: AS_OF,
    initial_disposition: { status: "RETAINED", reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
      evidence_ids: ["official:fixture"], decided_at: AS_OF }
  });
  context.boundary.decide({ ...command, expected_current_presentation_decision_id: first.presentation_decision_id,
    opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
    recall_disposition_id: registered.disposition.recall_disposition_id });
  const next = context.boundary.decide({ ...command, eligibility_assessment_id: null,
    expected_current_presentation_decision_id: first.presentation_decision_id }).decision;
  assert.equal(context.boundary.decisions.resolveCurrent(registered.candidate.opportunity_candidate_id)?.presentation_decision_id,
    next.presentation_decision_id);
  assert.deepEqual(context.boundary.decisions.list(registered.candidate.opportunity_candidate_id), [first]);
});

test("V2 derived read index cannot promote independently resealed rows into authoritative state", async () => {
  const context = presentationContext("presentation-v2-derived-trust", true);
  const decision = context.boundary.decide({ ...context.command(), contract_version: "presentation-decision/2.0.0",
    expected_current_presentation_decision_id: null }).decision;
  const materializer = createPresentationReadModelMaterializer({ decisions: context.boundary.decisions,
    position_bound_opportunities: context.fixture.pbov_tracker,
    requirement_sets: context.fixture.chain.requirement_set_resolver });
  const model = materializer.materialize(decision.presentation_decision_id).read_model;
  let indexedModel = model;
  const persistence: PresentationPersistenceRepository = { ...inMemoryPresentationPersistence(),
    readPresentationHistory: () => ({ decisions: [decision], read_models: [indexedModel], migration_audits: [] }) };
  const boundary = createPresentationPersistenceBoundary({ decisions: context.boundary.decisions, materializer, persistence });
  const snapshot = await boundary.read_repository.readCurrentSnapshot?.();
  assert.equal(snapshot?.current_position_read_models.length, 1);
  const { integrity_hash: previousHash, ...payload } = model;
  const changed = { ...payload, upstream: { ...payload.upstream, source_occurrence_version_ids: ["unissued-source-version"] } };
  indexedModel = { ...changed, integrity_hash: canonicalHash(changed) };
  assert.notEqual(indexedModel.integrity_hash, previousHash);
  assert.throws(() => boundary.read_repository.readCurrentSnapshot?.(), /authoritative resolver/);
});

function persistSyntheticRecallPrerequisites(
  persistence: SqliteShadowPersistence,
  context: ReturnType<typeof presentationContext>
) {
  const organization: Organization = {
    organization_id: "organization-synthetic-presentation-e2e" as never,
    name: { original: { text: "Synthetic presentation test organization", encoding: UTF8_TEXT_ENCODING } },
    aliases: [],
    country_code: "CN"
  };
  const sourceDefinition: SourceDefinition = {
    source_definition_id: context.fixture.source.endpoint.source_definition_id,
    publisher_organization_id: organization.organization_id,
    name: { original: { text: "Synthetic presentation test source", encoding: UTF8_TEXT_ENCODING } },
    publisher_kind: "RESEARCH_INSTITUTE",
    authority_level: "OFFICIAL",
    scope: "SINGLE_ORGANIZATION",
    enabled: false
  };
  const command = context.command();
  const candidate = context.recall.candidates.resolve(command.opportunity_candidate_id);
  const disposition = context.recall.dispositions.resolve(command.recall_disposition_id);
  if (!candidate || !disposition) throw new Error("Synthetic Recall prerequisites are unavailable");
  persistence.organizations.append(organization);
  persistence.source_definitions.append(sourceDefinition);
  persistence.recruitment_endpoints.append(context.fixture.source.endpoint);
  persistence.opportunity_recall.appendRegistration(candidate, disposition);
}

function inMemoryPresentationPersistence(): PresentationPersistenceRepository {
  const decisions = new Map<string, PresentationDecision>();
  const models = new Map<string, PresentationReadModel>();
  return {
    appendDecision(decision) {
      const existing = decisions.get(decision.presentation_decision_id);
      if (existing && existing.integrity_hash !== decision.integrity_hash) {
        throw new Error("Presentation decision collision");
      }
      decisions.set(decision.presentation_decision_id, structuredClone(decision));
      const stored = decisions.get(decision.presentation_decision_id);
      if (!stored) throw new Error("Presentation decision persistence failed");
      return structuredClone(stored);
    },
    appendReadModel(model) {
      const existing = models.get(model.presentation_read_model_id);
      if (existing && existing.integrity_hash !== model.integrity_hash) {
        throw new Error("Presentation read model collision");
      }
      models.set(model.presentation_read_model_id, structuredClone(model));
      const stored = models.get(model.presentation_read_model_id);
      if (!stored) throw new Error("Presentation read model persistence failed");
      return structuredClone(stored);
    },
    getDecision(id) { return structuredClone(decisions.get(id) ?? null); },
    getReadModel(id) { return structuredClone(models.get(id) ?? null); },
    listCurrentReadModels() {
      return [...models.values()].map((model) => structuredClone(model));
    }
  };
}

function presentationContext(
  suffix: string,
  withEvidence: boolean,
  rawTitle = "法务岗",
  approvedExclusion = false
) {
  const fixture = trustedFixture(suffix, "学历要求：本科及以上", {
    raw_title: rawTitle
  });
  const materialized = materializeTrustedChain(fixture);
  const compositions = new InMemoryPositionBoundSourceCompositionTracker(
    fixture.pbov_tracker
  );
  const composition = compositions.process({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const relevance = new InMemoryLegalEmploymentRelevanceTracker(
    fixture.pbov_tracker,
    compositions
  );
  const relevanceAssessment = relevance.process({
    opportunity_version_id: fixture.opportunity_version_id,
    source_composition_id: composition.source_composition_id,
    created_at: AS_OF
  }).assessment;
  const evidence = withEvidence
    ? materializeSyntheticCandidateEvidence(fixture, suffix)
    : null;
  const evidenceIds = evidence?.evidence_ids ?? [];
  const predicates = fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    source_composition_id: materialized.sourceComposition.source_composition_id,
    requirement_set_version_id: materialized.requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidenceIds,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.equal(predicates.status, "RESOLUTION_SET");
  const assessment = fixture.chain.eligibility_assessments.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    source_composition_id: materialized.sourceComposition.source_composition_id,
    requirement_set_version_id: materialized.requirementSet.requirement_set_version_id,
    predicate_resolution_ids: predicates.resolutions.map((item) => item.predicate_resolution_id),
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidenceIds,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
    assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  });
  assert.equal(assessment.status, "ASSESSMENT");
  const recall = createInMemoryOpportunityRecallBoundary(approvedExclusion ? { exclusion_policy: createApprovedRecallExclusionPolicyV1() } : undefined);
  const registered = recall.register({
    source_definition_id: fixture.source.endpoint.source_definition_id,
    recruitment_endpoint_id: fixture.source.endpoint.recruitment_endpoint_id,
    discovery_locator: fixture.source.endpoint.locator,
    snapshot_id: fixture.source.snapshot.snapshot_id,
    extracted_record_id: fixture.source.extracted_record.extracted_record_id,
    source_occurrence_version_id: fixture.source.version.source_occurrence_version_id,
    publisher_subject: approvedExclusion ? { subject_identity: "organization:中国建筑", subject_display_name: "中国建筑", evidence_id: "fixture:approved-publisher" } : null,
    discovery_evidence_ids: approvedExclusion ? ["official:fixture", "fixture:approved-publisher"] : ["official:fixture"],
    first_observed_at: OBSERVED_AT,
    initial_disposition: {
      status: "RETAINED",
      reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
      evidence_ids: ["official:fixture"],
      decided_at: OBSERVED_AT
    }
  });
  const boundary = createPresentationDecisionBoundary({
    candidates: recall.candidates,
    recall_dispositions: recall.dispositions,
    position_bound_opportunities: fixture.pbov_tracker,
    relevance,
    eligibility: fixture.chain.eligibility_assessments,
    scope: "SYNTHETIC_TEST",
    source_compositions: compositions,
    requirement_sets: fixture.chain.requirement_set_resolver,
    requirement_projections: fixture.chain.requirement_projections
  });
  const eligibilityId = assessment.status === "ASSESSMENT"
    ? assessment.assessment.eligibility_assessment_id
    : null;
  return {
    fixture,
    materialized,
    recall,
    relevance,
    boundary,
    command(assessmentId: string | null = eligibilityId) {
      return {
        opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
        recall_disposition_id: registered.disposition.recall_disposition_id,
        relevance_assessment_id: relevanceAssessment.assessment_id,
        eligibility_assessment_id: assessmentId,
        decided_at: AS_OF as IsoDateTime
      };
    }
  };
}

function relevanceOnlyContext(suffix: string, sourceText: string) {
  const fixture = trustedFixture(suffix, sourceText);
  const compositions = new InMemoryPositionBoundSourceCompositionTracker(
    fixture.pbov_tracker
  );
  const composition = compositions.process({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: fixture.composition_input
  });
  const relevance = new InMemoryLegalEmploymentRelevanceTracker(
    fixture.pbov_tracker,
    compositions
  );
  const assessment = relevance.process({
    opportunity_version_id: fixture.opportunity_version_id,
    source_composition_id: composition.source_composition_id,
    created_at: AS_OF
  }).assessment;
  assert.equal(assessment.assessment_state, "NOT_RELEVANT");
  const recall = createInMemoryOpportunityRecallBoundary();
  const registered = recall.register({
    source_definition_id: fixture.source.endpoint.source_definition_id,
    recruitment_endpoint_id: fixture.source.endpoint.recruitment_endpoint_id,
    discovery_locator: fixture.source.endpoint.locator,
    snapshot_id: fixture.source.snapshot.snapshot_id,
    extracted_record_id: fixture.source.extracted_record.extracted_record_id,
    source_occurrence_version_id: fixture.source.version.source_occurrence_version_id,
    publisher_subject: null,
    discovery_evidence_ids: ["official:fixture"],
    first_observed_at: OBSERVED_AT,
    initial_disposition: {
      status: "RETAINED",
      reason_codes: ["OFFICIAL_RECRUITMENT_DISCOVERED"],
      evidence_ids: ["official:fixture"],
      decided_at: OBSERVED_AT
    }
  });
  const boundary = createPresentationDecisionBoundary({
    candidates: recall.candidates,
    recall_dispositions: recall.dispositions,
    position_bound_opportunities: fixture.pbov_tracker,
    relevance,
    eligibility: fixture.chain.eligibility_assessments
  });
  return {
    boundary,
    command() {
      return {
        opportunity_candidate_id: registered.candidate.opportunity_candidate_id,
        recall_disposition_id: registered.disposition.recall_disposition_id,
        relevance_assessment_id: assessment.assessment_id,
        eligibility_assessment_id: null,
        decided_at: AS_OF
      };
    }
  };
}
