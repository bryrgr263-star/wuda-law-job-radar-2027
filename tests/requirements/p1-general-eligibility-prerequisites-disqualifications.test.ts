import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  CR12_ENGINE_CAPABILITIES,
  CR12_REQUIREMENT_SERIALIZATION_VERSION,
  CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
  UTF8_TEXT_ENCODING,
  buildCr12RequirementLogicTree,
  buildCr12StructuredRequirementSet,
  classifyGeneralEligibilityClause,
  projectGeneralEligibilityPredicateToCr12Fact,
  validateGeneralEligibilityRequirementPredicate,
  type CandidateStateApplicabilityId,
  type CandidateCredentialApplicabilityId,
  type Cr12RequirementCondition,
  type Cr12StructuredRequirementSetInput,
  type RequirementContextBinding,
  type RequirementConditionId,
  type LogicGroupId,
  type OpportunityVersionId,
  type IsoDate,
  type OriginalText,
  type RequirementContextBindingId,
  type RequirementEvidenceFragmentId,
  type RequirementFactId,
  type RequirementLogicTreeId,
  type RequirementMandatoryRootId,
  type RequirementObservation,
  type RequirementObservationId,
  type RequirementPredicateId,
  type RequirementSourceReferenceId,
  type SnapshotId,
  type PositionVersionId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
}

function citizenshipPredicate() {
  return {
    requirement_predicate_id: branded<RequirementPredicateId>("predicate-citizenship-china"),
    dimension: "CITIZENSHIP_STATUS" as const,
    predicate_kind: "CITIZENSHIP_EQUALS" as const,
    target: {
      kind: "CITIZENSHIP" as const,
      citizenship_code: "CHINA"
    },
    temporal_relation: "AS_OF" as const,
    source_reference_ids: [
      branded<RequirementSourceReferenceId>("source-citizenship")
    ] as const,
    evidence_fragment_ids: [
      branded<RequirementEvidenceFragmentId>("fragment-citizenship")
    ] as const,
    source_resolution_state: "RESOLVED" as const,
    parser_version: "p1-general-test-parser/1",
    resolver_version: "p1-general-test-resolver/1",
    schema_version: "p1-general-predicate/1"
  };
}

function structuredInput(
  predicate = citizenshipPredicate()
): Cr12StructuredRequirementSetInput {
  const suffix = predicate.requirement_predicate_id;
  const opportunityVersionId = branded<OpportunityVersionId>(`opportunity-${suffix}`);
  const factId = branded<RequirementFactId>(`fact-${suffix}`);
  const fragmentId = predicate.evidence_fragment_ids[0];
  const bindingId = branded<RequirementContextBindingId>(`binding-${suffix}`);
  const sourceId = predicate.source_reference_ids[0];
  const conditionId = branded<RequirementConditionId>(`condition-${suffix}`);
  const treeId = branded<RequirementLogicTreeId>(`tree-${suffix}`);
  const credentialId = branded<CandidateCredentialApplicabilityId>(`credential-${suffix}`);
  const stateId = branded<CandidateStateApplicabilityId>(`state-${suffix}`);
  const snapshotId = branded<SnapshotId>(`snapshot-${suffix}`);
  const positionVersionId = branded<PositionVersionId>(`position-${suffix}`);
  const sourceLocator = {
    kind: "HTML" as const,
    text_locator: `synthetic-${suffix}`
  };
  const fact = projectGeneralEligibilityPredicateToCr12Fact({
    requirement_fact_id: factId,
    opportunity_version_id: opportunityVersionId,
    predicate,
    subject_scope: "CANDIDATE",
    logic_group: {
      logic_group_id: branded<LogicGroupId>(`group-${suffix}`),
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    candidate_state_applicability_id: stateId,
    context_binding_ids: [bindingId],
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  });
  const treeResult = buildCr12RequirementLogicTree({
    requirement_condition_id: conditionId,
    requirement_logic_tree_id: treeId,
    tokens: [{
      kind: "PREDICATE",
      requirement_fact_id: factId,
      context_binding_ids: [bindingId],
      evidence_fragment_ids: [fragmentId],
      source_order: 0
    }],
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    serialization_version: CR12_REQUIREMENT_SERIALIZATION_VERSION
  });
  if (treeResult.status !== "RESOLVED") throw new Error(treeResult.message);
  const binding: RequirementContextBinding = {
    requirement_context_binding_id: bindingId,
    opportunity_version_id: opportunityVersionId,
    source_context_target: {
      kind: "POSITION_VERSION",
      position_version_id: positionVersionId
    },
    effective_targets: [{
      kind: "OPPORTUNITY_VERSION",
      opportunity_version_id: opportunityVersionId
    }],
    scope: "EXACT_TARGET",
    state: "RESOLVED",
    certainty: "EXPLICIT",
    source_locator: sourceLocator,
    evidence_fragment_ids: [fragmentId],
    identity_evidence_ids: [],
    resolver_version: "p1-general-test-resolver/1"
  };
  const condition: Cr12RequirementCondition = {
    requirement_condition_id: conditionId,
    opportunity_version_id: opportunityVersionId,
    modality: "MANDATORY",
    resolution_state: "RESOLVED",
    representation_kind: "LOGIC_TREE",
    requirement_logic_tree_id: treeId,
    candidate_credential_applicability_id: credentialId,
    candidate_state_applicability_id: stateId,
    context_binding_ids: [bindingId],
    source_reference_ids: [sourceId],
    evidence_fragment_ids: [fragmentId],
    source_locator: sourceLocator,
    source_order: 0,
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    resolver_version: "p1-general-test-resolver/1",
    projected_from_legacy_fact_ids: [],
    projected_from_legacy_evidence_ids: []
  };
  const observation: RequirementObservation = {
    requirement_observation_id:
      branded<RequirementObservationId>(`observation-${suffix}`),
    opportunity_version_id: opportunityVersionId,
    status: "CONFIRMED_REQUIREMENT",
    clause_role: "MANDATORY",
    dimension_hint: predicate.dimension,
    requirement_fact_ids: [factId],
    evidence_fragment_ids: [fragmentId],
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
  };
  return {
    opportunity_version_id: opportunityVersionId,
    mandatory_root: {
      requirement_mandatory_root_id:
        branded<RequirementMandatoryRootId>(`root-${suffix}`),
      kind: "SINGLE",
      requirement_condition_id: conditionId
    },
    conditions: [condition],
    requirement_logic_trees: [treeResult.tree],
    facts: [fact],
    candidate_credential_applicabilities: [{
      candidate_credential_applicability_id: credentialId,
      mode: "CANDIDATE_WIDE",
      evidence_fragment_ids: [fragmentId],
      certainty: "EXPLICIT",
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
    }],
    candidate_state_applicabilities: [{
      candidate_state_applicability_id: stateId,
      mode: "ALL_CANDIDATES",
      evidence_fragment_ids: [fragmentId],
      certainty: "EXPLICIT",
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
    }],
    context_bindings: [binding],
    source_references: [{
      requirement_source_reference_id: sourceId,
      snapshot_id: snapshotId,
      extracted_record_id: branded(`record-${suffix}`),
      source_role: "POSITION_TABLE_ROW",
      source_context_target: binding.source_context_target,
      applicable_binding_ids: [bindingId],
      binding_evidence_fragment_ids: [fragmentId],
      identity_evidence_ids: [],
      source_locator: sourceLocator,
      relationship: {
        kind: "ORIGINAL",
        target_source_reference_ids: [],
        evidence_fragment_ids: [fragmentId],
        resolver_version: "p1-general-test-resolver/1"
      },
      binding_state: "RESOLVED",
      binding_certainty: "EXPLICIT",
      extractor_version: "synthetic/1",
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
      resolver_version: "p1-general-test-resolver/1"
    }],
    selector_predicates: [],
    selector_logic_trees: [],
    conditional_branch_sets: [],
    evidence_fragments: [{
      requirement_evidence_fragment_id: fragmentId,
      extracted_record_id: branded(`record-${suffix}`),
      snapshot_id: snapshotId,
      locator: sourceLocator,
      observed_value_state: "TEXT",
      original_text: original("具有中华人民共和国国籍"),
      normalized_text: {
        text: "具有中华人民共和国国籍",
        normalizer_version: "synthetic/1",
        unicode_form: "NFKC",
        operations: []
      },
      extractor_name: "synthetic",
      extractor_version: "1",
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
    }],
    requirement_evidence: [{
      requirement_evidence_id: branded(`evidence-${suffix}`),
      requirement_fact_id: factId,
      snapshot_id: snapshotId,
      locator: sourceLocator,
      evidence_text: original("具有中华人民共和国国籍"),
      extractor_name: "synthetic",
      extractor_version: "1",
      parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION
    }],
    observations: [observation],
    supported_engine_capabilities: CR12_ENGINE_CAPABILITIES.filter((capability) => {
      return capability !== "GENERAL_ELIGIBILITY_PREDICATE_V1";
    }),
    parser_version: CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION,
    resolver_version: "p1-general-test-resolver/1",
    serialization_version: CR12_REQUIREMENT_SERIALIZATION_VERSION
  };
}

test("accepts only a closed, evidence-backed citizenship predicate projection", () => {
  const predicate = citizenshipPredicate();
  assert.equal(validateGeneralEligibilityRequirementPredicate(predicate), predicate);

  const fact = projectGeneralEligibilityPredicateToCr12Fact({
    requirement_fact_id: branded<RequirementFactId>("fact-citizenship"),
    opportunity_version_id: branded<OpportunityVersionId>("opportunity-citizenship"),
    predicate,
    subject_scope: "CANDIDATE",
    logic_group: {
      logic_group_id: branded<LogicGroupId>("group-citizenship"),
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    candidate_state_applicability_id:
      branded<CandidateStateApplicabilityId>("state-citizenship"),
    context_binding_ids: [
      branded<RequirementContextBindingId>("binding-citizenship")
    ] as const,
    parser_version: "p1-general-test-parser/1"
  });

  assert.equal(fact.dimension, "CITIZENSHIP_STATUS");
  assert.equal(fact.value.kind, "GENERAL_ELIGIBILITY_PREDICATE");
  assert.equal(fact.value.predicate.requirement_predicate_id,
    predicate.requirement_predicate_id);
});

test("classifies generic or open eligibility clauses as blockers", () => {
  for (const text of [
    "品行良好",
    "身体健康",
    "符合有关法律法规规定",
    "其他不得报考情形",
    "具备良好职业素养"
  ]) {
    const clause = classifyGeneralEligibilityClause({ original_text: original(text) });
    assert.ok(clause.status === "UNPARSED_CLAUSE"
      || clause.status === "DOMAIN_GAP_OBSERVED");
    assert.equal(clause.predicate, null);
  }
});

test("validates every frozen general-eligibility predicate kind without open extensions", () => {
  const date = branded<IsoDate>("2026-09-07");
  const cases = [
    {
      ...citizenshipPredicate(),
      predicate_kind: "CITIZENSHIP_EXCLUDED" as const
    },
    {
      ...citizenshipPredicate(),
      requirement_predicate_id: branded<RequirementPredicateId>("predicate-service-absent"),
      dimension: "SERVICE_OR_ENROLMENT_STATUS" as const,
      predicate_kind: "STATUS_MUST_BE_ABSENT" as const,
      target: {
        kind: "SERVICE_OR_ENROLMENT_STATUS" as const,
        status: "ACTIVE_DUTY" as const,
        reference_date: date
      }
    },
    {
      ...citizenshipPredicate(),
      requirement_predicate_id: branded<RequirementPredicateId>("predicate-service-present"),
      dimension: "SERVICE_OR_ENROLMENT_STATUS" as const,
      predicate_kind: "STATUS_MUST_BE_PRESENT" as const,
      target: {
        kind: "SERVICE_OR_ENROLMENT_STATUS" as const,
        status: "CURRENT_STUDENT" as const,
        reference_date: date
      }
    },
    ...[
      "CRIMINAL_SANCTION",
      "DISCIPLINARY_SANCTION",
      "PUBLIC_EMPLOYMENT_DISMISSAL",
      "RECRUITMENT_INTEGRITY_RECORD",
      "OFFICIAL_SERIOUS_DISHONESTY_RECORD"
    ].map((record_kind, index) => ({
      ...citizenshipPredicate(),
      requirement_predicate_id:
        branded<RequirementPredicateId>(`predicate-record-${index}`),
      dimension: "DISQUALIFICATION_RECORD" as const,
      predicate_kind: "DISQUALIFYING_RECORD_ABSENT" as const,
      target: {
        kind: "DISQUALIFICATION_RECORD" as const,
        record_kind: record_kind as "CRIMINAL_SANCTION",
        authority: "synthetic-authority",
        jurisdiction: "synthetic-jurisdiction",
        reference_date: date
      }
    })),
    {
      ...citizenshipPredicate(),
      requirement_predicate_id: branded<RequirementPredicateId>("predicate-clearance"),
      dimension: "FORMAL_CLEARANCE_DECISION" as const,
      predicate_kind: "FORMAL_CLEARANCE_REQUIRED" as const,
      target: {
        kind: "FORMAL_CLEARANCE_DECISION" as const,
        issuer: "synthetic-issuer",
        decision_kind: "fitness",
        decision_status: "PASSED",
        effective_from: date
      }
    }
  ];

  for (const predicate of cases) {
    assert.equal(validateGeneralEligibilityRequirementPredicate(predicate), predicate);
  }
});

test("general predicate and source evidence mutations change only the RequirementSet hash", () => {
  const first = buildCr12StructuredRequirementSet(structuredInput())
    .structured_requirement_set;
  const changedPredicate = citizenshipPredicate();
  const second = buildCr12StructuredRequirementSet(structuredInput({
    ...changedPredicate,
    target: { kind: "CITIZENSHIP", citizenship_code: "OTHER" }
  })).structured_requirement_set;
  const changedEvidenceInput = structuredInput();
  const third = buildCr12StructuredRequirementSet({
    ...changedEvidenceInput,
    requirement_evidence: [{
      ...changedEvidenceInput.requirement_evidence[0],
      evidence_text: original("具有其他国籍")
    }]
  }).structured_requirement_set;
  const changedBindingInput = structuredInput();
  const fourth = buildCr12StructuredRequirementSet({
    ...changedBindingInput,
    context_bindings: [{
      ...changedBindingInput.context_bindings[0],
      resolver_version: "p1-general-test-resolver/changed"
    }]
  }).structured_requirement_set;

  assert.notEqual(first.completeness.requirement_set_content_hash,
    second.completeness.requirement_set_content_hash);
  assert.notEqual(first.completeness.requirement_set_content_hash,
    third.completeness.requirement_set_content_hash);
  assert.notEqual(first.completeness.requirement_set_content_hash,
    fourth.completeness.requirement_set_content_hash);
});

test("general predicates require the frozen capability and cannot use a source gap as a fallback", () => {
  const parsed = buildCr12StructuredRequirementSet(structuredInput())
    .structured_requirement_set;
  assert.ok(parsed.execution_manifest.required_engine_capabilities.includes(
    "GENERAL_ELIGIBILITY_PREDICATE_V1"
  ));
  assert.equal(parsed.execution_manifest.execution_gate.status, "NOT_ALLOWED");
  assert.equal(parsed.execution_manifest.execution_gate.reason,
    "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY");

  const missingSource = {
    ...structuredInput(),
    source_references: []
  };
  assert.throws(() => buildCr12StructuredRequirementSet(missingSource));

  const blocked = buildCr12StructuredRequirementSet({
    ...structuredInput(),
    external_blockers: [{
      code: "EVIDENCE_INCOMPLETE",
      diagnostic_code: "EVIDENCE_INCOMPLETE",
      observation_ids: [],
      evidence_fragment_ids: [],
      description: "synthetic source evidence is incomplete"
    }]
  }).structured_requirement_set;
  assert.notEqual(blocked.completeness.status, "COMPLETE");
  assert.equal(blocked.execution_manifest.execution_gate.status, "NOT_ALLOWED");
  assert.equal(blocked.execution_manifest.execution_gate.reason,
    "REQUIREMENT_SET_NOT_COMPLETE");
});

test("closed predicate validation rejects a non-whitelisted dimension and double-negation carrier", () => {
  assert.throws(() => validateGeneralEligibilityRequirementPredicate({
    ...citizenshipPredicate(),
    dimension: "GENERAL_HEALTH"
  } as unknown as ReturnType<typeof citizenshipPredicate>));
  assert.throws(() => projectGeneralEligibilityPredicateToCr12Fact({
    requirement_fact_id: branded<RequirementFactId>("fact-double-negative"),
    opportunity_version_id: branded<OpportunityVersionId>("opportunity-double-negative"),
    predicate: {
      ...citizenshipPredicate(),
      predicate_kind: "CITIZENSHIP_EXCLUDED"
    },
    subject_scope: "CANDIDATE",
    logic_group: {
      logic_group_id: branded<LogicGroupId>("group-double-negative"),
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    candidate_state_applicability_id:
      branded<CandidateStateApplicabilityId>("state-double-negative"),
    context_binding_ids: [
      branded<RequirementContextBindingId>("binding-double-negative")
    ],
    parser_version: "synthetic/1"
  }));
});
