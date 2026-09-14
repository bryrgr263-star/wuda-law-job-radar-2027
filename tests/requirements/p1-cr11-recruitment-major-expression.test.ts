import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCr12RequirementLogicTree,
  buildCr12StructuredRequirementSet,
  classifyCr11CandidateCredentialCompleteness,
  classifyCr11MajorExpression,
  createCr11MajorMatchRelation,
  createCr11SourceExclusionObservation,
  projectCr11MajorPredicatesToCr12Leaves,
  projectCr11SourceExclusionToCr12Tokens,
  UTF8_TEXT_ENCODING,
  type CandidateCredentialApplicabilityId,
  type CandidateStateApplicabilityId,
  type Cr11CandidateMajorIdentityDescriptor,
  type Cr11MajorSemanticClassificationInput,
  type ExtractedRecordId,
  type OpportunityVersionId,
  type PositionVersionId,
  type RequirementContextBindingId,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type RequirementEvidenceId,
  type RequirementFactId,
  type RequirementLogicTreeId,
  type RequirementMandatoryRootId,
  type RequirementObservationId,
  type RequirementSetId,
  type RequirementSourceReferenceId,
  type SnapshotId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function nonEmpty<Value>(values: readonly Value[]) {
  if (values.length === 0) throw new Error("Expected a non-empty test fixture array");
  return values as readonly [Value, ...Value[]];
}

const ids = {
  opportunityVersion: branded<OpportunityVersionId>("cr11-opportunity-version"),
  positionVersion: branded<PositionVersionId>("cr11-position-version"),
  fragment: branded<RequirementEvidenceFragmentId>("cr11-fragment"),
  snapshot: branded<SnapshotId>("cr11-snapshot"),
  extracted: branded<ExtractedRecordId>("cr11-extracted"),
  binding: branded<RequirementContextBindingId>("cr11-binding"),
  credential: branded<CandidateCredentialApplicabilityId>("cr11-credential"),
  state: branded<CandidateStateApplicabilityId>("cr11-state"),
  source: branded<RequirementSourceReferenceId>("cr11-source"),
  tree: branded<RequirementLogicTreeId>("cr11-tree"),
  root: branded<RequirementMandatoryRootId>("cr11-root"),
  evidence: branded<RequirementEvidenceId>("cr11-evidence"),
  observation: branded<RequirementObservationId>("cr11-observation"),
  requirementSet: branded<RequirementSetId>("cr11-requirement-set")
};

const parserVersion = "cr11-test-parser/1";
const resolverVersion = "cr11-test-resolver/1";
const projectionVersion = "cr11-test-projection/1";
const sourceLocator = {
  kind: "SPREADSHEET" as const,
  sheet: "岗位表",
  cell_or_range: "H2",
  field_path: "major"
};

const lawMasterNonLawCandidate: Cr11CandidateMajorIdentityDescriptor = {
  semantic_code: "LAW_MASTER_NON_LAW",
  identity_label: { text: "法律硕士（非法学）", encoding: UTF8_TEXT_ENCODING },
  credential_level: "MASTER",
  major_code: "0351",
  directory_namespace: "official-directory",
  directory_version: "2025",
  provenance_state: "COMPLETE"
};

test("CR#11 controls A-H keep distinct legal-major identities and source scopes", () => {
  const controls = [
    ["法律硕士（非法学）", "EXACT_IDENTITY", "LAW_MASTER_NON_LAW", "CLOSED", "RESOLVED"],
    ["法律（非法学）", "EXACT_IDENTITY", "LAW_NON_LAW", "CLOSED", "RESOLVED"],
    ["法律（0351）", "EXACT_IDENTITY", "LAW_0351", "CLOSED", "RESOLVED"],
    ["法律", "LAW", "LAW_GENERAL", "CLOSED", "RESOLVED"],
    ["法学", "EXACT_IDENTITY", "LAW_STUDIES", "CLOSED", "RESOLVED"],
    ["法学类", "LAW_FAMILY", "LAW_STUDIES_FAMILY", "UNRESOLVED", "UNRESOLVED"],
    ["法律类", "LAW_FAMILY", "LEGAL_PROGRAM_FAMILY", "UNRESOLVED", "UNRESOLVED"],
    ["法律相关专业", "LAW_RELATED", "LAW_RELATED", "OPEN", "RESOLVED"]
  ] as const;

  for (const [text, semanticType, identity, scope, status] of controls) {
    const classified = classifyCr11MajorExpression(classificationInput(text, {
      directory: text === "法律（0351）"
        ? versionedDirectory("0351")
        : undefined
    }));
    assert.equal(classified.status, status, text);
    const expression = classified.expressions[0];
    assert.equal(expression?.semantic_type, semanticType, text);
    assert.equal(expression?.major_identity?.semantic_code, identity, text);
    assert.equal(expression?.major_scope, scope, text);
  }
});

test("CR#11 controls I and punctuation handoff create only ordered CR#12 OR leaves", () => {
  const classification = classifyCr11MajorExpression(classificationInput(
    "法学、法律、知识产权",
    { listContext: "MAJOR_CANDIDATE_LIST" }
  ));
  assert.equal(classification.status, "RESOLVED");
  assert.equal(classification.expressions.length, 3);
  assert.equal(classification.connector_observations.length, 2);

  const projected = project(classification);
  assert.equal(projected.status, "RESOLVED");
  if (projected.status !== "RESOLVED") throw new Error("Expected CR#11 major projections");
  assert.deepEqual(projected.tokens.map((token) => token.kind), [
    "PREDICATE",
    "OR",
    "PREDICATE",
    "OR",
    "PREDICATE"
  ]);
  assert.deepEqual(projected.facts.map((fact) => fact.value.kind), [
    "CR11_MAJOR_SEMANTIC",
    "CR11_MAJOR_SEMANTIC",
    "CR11_MAJOR_SEMANTIC"
  ]);
  assert.equal(projected.execution_gate.status, "NOT_ALLOWED");
  assert.equal(projected.execution_gate.reason, "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY");
});

test("CR#11 treats unproven or protected punctuation as unresolved instead of splitting", () => {
  const unproven = classifyCr11MajorExpression(classificationInput("法学、法律", {
    listContext: "SINGLE_EXPRESSION"
  }));
  const doubleDegree = classifyCr11MajorExpression(classificationInput("法学、经济学双学位", {
    listContext: "MAJOR_CANDIDATE_LIST"
  }));
  const jointProgram = classifyCr11MajorExpression(classificationInput("法学/法律联合培养", {
    listContext: "MAJOR_CANDIDATE_LIST"
  }));
  const date = classifyCr11MajorExpression(classificationInput("2025/2026", {
    listContext: "MAJOR_CANDIDATE_LIST"
  }));
  const protectedIdentity = classifyCr11MajorExpression(classificationInput("法律硕士（非法学）"));

  assert.equal(unproven.status, "UNRESOLVED");
  assert.equal(doubleDegree.status, "UNRESOLVED");
  assert.equal(jointProgram.status, "UNRESOLVED");
  assert.equal(date.status, "UNRESOLVED");
  assert.equal(protectedIdentity.status, "RESOLVED");
  assert.equal(protectedIdentity.connector_observations.length, 0);
});

test("CR#11 control J and Q preserve ANY_MAJOR separately from legal qualification", () => {
  const classified = classifyCr11MajorExpression(classificationInput("专业不限", {
    qualification: {
      requirement_fact_id: branded<RequirementFactId>("legal-qualification-fact"),
      evidence_fragment_ids: nonEmpty([ids.fragment])
    }
  }));
  assert.equal(classified.status, "RESOLVED");
  const expression = classified.expressions[0];
  assert.equal(expression?.semantic_type, "QUALIFICATION_ORIENTED");
  assert.equal(expression?.major_scope, "UNRESTRICTED");
  assert.equal(expression?.major_identity?.semantic_code, "ANY_MAJOR");
  assert.notEqual(expression?.major_identity?.semantic_code, "LAW_STUDIES");

  const projected = project(classified);
  assert.equal(projected.status, "RESOLVED");
  if (projected.status !== "RESOLVED") throw new Error("Expected ANY_MAJOR projection");
  assert.equal(projected.facts[0]?.operator, "UNRESTRICTED");
  assert.equal(projected.facts[0]?.value.kind, "CR11_MAJOR_SEMANTIC");
});

test("CR#11 controls C, L, M, and N require versioned source directory evidence", () => {
  const missingVersion = classifyCr11MajorExpression(classificationInput("法律（0351）", {
    directory: { directory_namespace: "official-directory", program_code: "0351" }
  }));
  assert.equal(missingVersion.status, "UNRESOLVED");
  const sourceUnresolvedProjection = projectCr11MajorPredicatesToCr12Leaves({
    ...projectionInput(),
    expressions: missingVersion.expressions,
    connector_observations: missingVersion.connector_observations
  });
  assert.equal(sourceUnresolvedProjection.status, "UNRESOLVED");
  if (sourceUnresolvedProjection.status === "UNRESOLVED") {
    assert.equal(sourceUnresolvedProjection.diagnostic, "SOURCE_SEMANTICS_UNRESOLVED");
  }

  const versioned = classifyCr11MajorExpression(classificationInput("法律（0351）", {
    directory: versionedDirectory("0351")
  }));
  assert.equal(versioned.status, "RESOLVED");
  const target = versioned.expressions[0];
  if (!target) throw new Error("Expected directory-backed expression");
  const inclusion = createCr11MajorMatchRelation({
    source_major_expression: target,
    candidate_major_identity: lawMasterNonLawCandidate,
    candidate_credential_applicability_id: ids.credential,
    relation_kind: "DIRECTORY_MEMBERSHIP",
    directory_reference: versionedDirectory("0351"),
    evidence_fragment_ids: nonEmpty([ids.fragment]),
    source_locator: sourceLocator,
    evidence_version: "official-directory/2025",
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    certainty: "EXPLICIT"
  });
  assert.equal(inclusion.relation_state, "ESTABLISHED");
  assert.equal(inclusion.relation_kind, "DIRECTORY_MEMBERSHIP");
  assert.equal(classifyCr11CandidateCredentialCompleteness({
    candidate_major_identity: {
      ...lawMasterNonLawCandidate,
      directory_namespace: undefined,
      directory_version: undefined
    },
    relation_kind: "DIRECTORY_MEMBERSHIP"
  }), "PARTIAL");
});

test("CR#11 never equates LAW_0351 or LAW_NON_LAW with LAW_MASTER_NON_LAW", () => {
  const law0351 = classifyCr11MajorExpression(classificationInput("法律（0351）", {
    directory: versionedDirectory("0351")
  }));
  const lawNonLaw = classifyCr11MajorExpression(classificationInput("法律（非法学）"));
  const generalLaw = classifyCr11MajorExpression(classificationInput("法律"));
  for (const classified of [law0351, lawNonLaw, generalLaw]) {
    assert.equal(classified.status, "RESOLVED");
    const source = classified.expressions[0];
    if (!source) throw new Error("Expected a source major expression");
    const relation = createCr11MajorMatchRelation({
      source_major_expression: source,
      candidate_major_identity: lawMasterNonLawCandidate,
      candidate_credential_applicability_id: ids.credential,
      relation_kind: "NOT_ESTABLISHED",
      evidence_fragment_ids: nonEmpty([ids.fragment]),
      source_locator: sourceLocator,
      evidence_version: "source/1",
      parser_version: parserVersion,
      resolver_version: resolverVersion,
      certainty: "UNRESOLVED"
    });
    assert.equal(relation.relation_state, "NOT_ESTABLISHED");
  }
  const target = law0351.expressions[0];
  if (!target) throw new Error("Expected LAW_0351 expression");
  assert.throws(() => createCr11MajorMatchRelation({
    source_major_expression: target,
    candidate_major_identity: lawMasterNonLawCandidate,
    candidate_credential_applicability_id: ids.credential,
    relation_kind: "EXACT_IDENTITY",
    evidence_fragment_ids: nonEmpty([ids.fragment]),
    source_locator: sourceLocator,
    evidence_version: "source/1",
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    certainty: "EXPLICIT"
  }), /same explicit MajorIdentity/u);
});

test("CR#11 control A allows only an explicit exact relation and preserves candidate completeness", () => {
  const classified = classifyCr11MajorExpression(classificationInput("法律硕士（非法学）"));
  assert.equal(classified.status, "RESOLVED");
  const expression = classified.expressions[0];
  if (!expression) throw new Error("Expected exact source expression");
  const exact = createCr11MajorMatchRelation({
    source_major_expression: expression,
    candidate_major_identity: lawMasterNonLawCandidate,
    candidate_credential_applicability_id: ids.credential,
    relation_kind: "EXACT_IDENTITY",
    evidence_fragment_ids: nonEmpty([ids.fragment]),
    source_locator: sourceLocator,
    evidence_version: "source/1",
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    certainty: "EXPLICIT"
  });
  assert.equal(exact.relation_state, "ESTABLISHED");
  assert.equal(classifyCr11CandidateCredentialCompleteness({
    candidate_major_identity: lawMasterNonLawCandidate,
    relation_kind: "EXACT_IDENTITY"
  }), "COMPLETE");
  assert.equal(classifyCr11CandidateCredentialCompleteness({
    candidate_major_identity: {
      ...lawMasterNonLawCandidate,
      provenance_state: "PARTIAL"
    },
    relation_kind: "EXACT_IDENTITY"
  }), "PARTIAL");
  assert.equal(classifyCr11CandidateCredentialCompleteness({
    relation_kind: "EXACT_IDENTITY"
  }), "UNKNOWN");
});

test("CR#11 control K emits one CR#12 NOT carrier for a source exclusion", () => {
  const classified = classifyCr11MajorExpression(classificationInput("法律硕士（非法学）"));
  assert.equal(classified.status, "RESOLVED");
  const projected = project(classified);
  assert.equal(projected.status, "RESOLVED");
  if (projected.status !== "RESOLVED") throw new Error("Expected a major fact");
  const expression = classified.expressions[0];
  if (!expression) throw new Error("Expected a source expression");
  const observation = createCr11SourceExclusionObservation({
    source_major_expression_id: expression.major_expression_id,
    excluded_candidate_major_identity: lawMasterNonLawCandidate,
    candidate_credential_applicability_id: ids.credential,
    context_binding_ids: nonEmpty([ids.binding]),
    evidence_fragment_ids: nonEmpty([ids.fragment]),
    source_locator: sourceLocator,
    source_resolution_state: "SOURCE_RESOLVED",
    parser_version: parserVersion,
    resolver_version: resolverVersion
  });
  const tokens = projectCr11SourceExclusionToCr12Tokens({
    source_exclusion_observation: observation,
    requirement_fact_id: projected.facts[0]!.requirement_fact_id,
    source_order: 10
  });
  assert.deepEqual(tokens.map((token) => token.kind), ["NOT", "PREDICATE"]);
  assert.equal(tokens.filter((token) => token.kind === "NOT").length, 1);
});

test("CR#11 source-unresolved OR blocks projection and legacy facts stay non-conclusive", () => {
  const classified = classifyCr11MajorExpression(classificationInput("法律（0351）、知识产权", {
    listContext: "MAJOR_CANDIDATE_LIST"
  }));
  assert.equal(classified.status, "UNRESOLVED");
  const projected = projectCr11MajorPredicatesToCr12Leaves({
    ...projectionInput(),
    expressions: classified.expressions,
    connector_observations: classified.connector_observations
  });
  assert.equal(projected.status, "UNRESOLVED");

  const legacy = classifyCr11MajorExpression(classificationInput("法学"));
  assert.equal(legacy.status, "RESOLVED");
  const source = legacy.expressions[0];
  if (!source) throw new Error("Expected source expression");
  const observation = createCr11MajorMatchRelation({
    source_major_expression: source,
    candidate_major_identity: lawMasterNonLawCandidate,
    candidate_credential_applicability_id: ids.credential,
    relation_kind: "NOT_ESTABLISHED",
    evidence_fragment_ids: nonEmpty([ids.fragment]),
    source_locator: sourceLocator,
    evidence_version: "legacy-major-rule/1",
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    certainty: "UNRESOLVED"
  });
  assert.equal(observation.relation_kind, "NOT_ESTABLISHED");
  assert.equal(observation.relation_state, "NOT_ESTABLISHED");
});

test("CR#11 semantic payload is visible to the existing CR#12 content hash", () => {
  const classified = classifyCr11MajorExpression(classificationInput("法律"));
  assert.equal(classified.status, "RESOLVED");
  const projected = project(classified);
  assert.equal(projected.status, "RESOLVED");
  if (projected.status !== "RESOLVED") throw new Error("Expected a fact payload");

  const original = structuredSet(projected.facts, projected.tokens);
  const mutatedFacts = projected.facts.map((fact) => structuredClone(fact));
  const first = mutatedFacts[0];
  if (!first || first.value.kind !== "CR11_MAJOR_SEMANTIC") {
    throw new Error("Expected a CR#11 semantic fact");
  }
  const mutatedProjection = {
    ...first.value.projection,
    projection_version: "cr11-test-projection/2"
  };
  mutatedFacts[0] = {
    ...first,
    value: { kind: "CR11_MAJOR_SEMANTIC", projection: mutatedProjection }
  };
  const mutated = structuredSet(mutatedFacts, projected.tokens);
  assert.notEqual(
    original.structured_requirement_set.completeness.requirement_set_content_hash,
    mutated.structured_requirement_set.completeness.requirement_set_content_hash
  );
});

function classificationInput(
  text: string,
  options: {
    readonly listContext?: Cr11MajorSemanticClassificationInput["list_context"];
    readonly directory?: Cr11MajorSemanticClassificationInput["directory_reference"];
    readonly qualification?: Cr11MajorSemanticClassificationInput["professional_qualification"];
  } = {}
): Cr11MajorSemanticClassificationInput {
  return {
    raw_expression: { text, encoding: UTF8_TEXT_ENCODING },
    normalized_expression: {
      text: text.replaceAll("：", ":").replaceAll("（", "(").replaceAll("）", ")"),
      unicode_form: "NFKC",
      normalizer_version: "cr11-test-normalizer/1",
      operations: ["UNICODE_NORMALIZATION", "WIDTH_FOLDING", "PUNCTUATION_FOLDING"] as const
    },
    evidence_fragment_ids: nonEmpty([ids.fragment]),
    source_locator: sourceLocator,
    list_context: options.listContext ?? "SINGLE_EXPRESSION",
    ...(options.directory ? { directory_reference: options.directory } : {}),
    ...(options.qualification
      ? { professional_qualification: options.qualification }
      : {}),
    parser_version: parserVersion,
    resolver_version: resolverVersion
  };
}

function projectionInput() {
  return {
    opportunity_version_id: ids.opportunityVersion,
    subject_scope: "MASTER" as const,
    candidate_credential_applicability_id: ids.credential,
    context_binding_ids: nonEmpty([ids.binding]),
    source_order: 0,
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    projection_version: projectionVersion
  };
}

function project(
  classification: ReturnType<typeof classifyCr11MajorExpression>
) {
  return projectCr11MajorPredicatesToCr12Leaves({
    ...projectionInput(),
    expressions: classification.expressions,
    connector_observations: classification.connector_observations
  });
}

function versionedDirectory(programCode: string) {
  return {
    directory_namespace: "official-directory",
    directory_version: "2025",
    program_code: programCode,
    program_label: {
      text: "法律",
      unicode_form: "NFKC" as const,
      normalizer_version: "cr11-test-normalizer/1",
      operations: ["UNICODE_NORMALIZATION", "WIDTH_FOLDING", "PUNCTUATION_FOLDING"] as const
    },
    category_level: "PROGRAM" as const
  };
}

function evidenceFragment(factId: RequirementFactId): RequirementEvidenceFragment {
  return {
    requirement_evidence_fragment_id: ids.fragment,
    extracted_record_id: ids.extracted,
    snapshot_id: ids.snapshot,
    locator: sourceLocator,
    extractor_name: "cr11-synthetic-fixture",
    extractor_version: "1.0.0",
    parser_version: parserVersion,
    observed_value_state: "TEXT",
    original_text: { text: "专业：法律", encoding: UTF8_TEXT_ENCODING },
    normalized_text: {
      text: "专业:法律",
      unicode_form: "NFKC",
      normalizer_version: "cr11-test-normalizer/1",
      operations: ["UNICODE_NORMALIZATION", "WIDTH_FOLDING", "PUNCTUATION_FOLDING"]
    }
  };
}

function structuredSet(
  facts: readonly import("../../lib/ingestion").RequirementFact[],
  tokens: readonly import("../../lib/ingestion").Cr12LogicToken[]
) {
  const firstFact = facts[0];
  if (!firstFact) throw new Error("Expected a fact");
  const builtTree = buildCr12RequirementLogicTree({
    requirement_condition_id: branded("cr11-condition"),
    requirement_logic_tree_id: ids.tree,
    tokens: nonEmpty(tokens),
    parser_version: parserVersion,
    serialization_version: "cr11-test-serialization/1"
  });
  if (builtTree.status !== "RESOLVED") throw new Error(builtTree.message);

  return buildCr12StructuredRequirementSet({
    opportunity_version_id: ids.opportunityVersion,
    mandatory_root: {
      requirement_mandatory_root_id: ids.root,
      kind: "SINGLE",
      requirement_condition_id: branded("cr11-condition")
    },
    conditions: [{
      requirement_condition_id: branded("cr11-condition"),
      opportunity_version_id: ids.opportunityVersion,
      modality: "MANDATORY",
      resolution_state: "RESOLVED",
      representation_kind: "LOGIC_TREE",
      requirement_logic_tree_id: ids.tree,
      candidate_credential_applicability_id: ids.credential,
      candidate_state_applicability_id: ids.state,
      context_binding_ids: nonEmpty([ids.binding]),
      source_reference_ids: nonEmpty([ids.source]),
      evidence_fragment_ids: nonEmpty([ids.fragment]),
      source_locator: sourceLocator,
      source_order: 0,
      parser_version: parserVersion,
      resolver_version: resolverVersion,
      projected_from_legacy_fact_ids: [],
      projected_from_legacy_evidence_ids: []
    }],
    requirement_logic_trees: [builtTree.tree],
    facts,
    candidate_credential_applicabilities: [{
      candidate_credential_applicability_id: ids.credential,
      mode: "SPECIFIC_DEGREE",
      degree: "MASTER",
      evidence_fragment_ids: [ids.fragment],
      certainty: "EXPLICIT",
      parser_version: parserVersion
    }],
    candidate_state_applicabilities: [{
      candidate_state_applicability_id: ids.state,
      mode: "ALL_CANDIDATES",
      evidence_fragment_ids: [ids.fragment],
      certainty: "EXPLICIT",
      parser_version: parserVersion
    }],
    context_bindings: [{
      requirement_context_binding_id: ids.binding,
      opportunity_version_id: ids.opportunityVersion,
      source_context_target: {
        kind: "POSITION_VERSION",
        position_version_id: ids.positionVersion
      },
      effective_targets: nonEmpty([{
        kind: "OPPORTUNITY_VERSION",
        opportunity_version_id: ids.opportunityVersion
      }]),
      scope: "EXACT_TARGET",
      state: "RESOLVED",
      certainty: "EXPLICIT",
      source_locator: sourceLocator,
      evidence_fragment_ids: nonEmpty([ids.fragment]),
      identity_evidence_ids: [],
      resolver_version: resolverVersion
    }],
    source_references: [{
      requirement_source_reference_id: ids.source,
      snapshot_id: ids.snapshot,
      extracted_record_id: ids.extracted,
      source_role: "POSITION_TABLE_ROW",
      source_context_target: {
        kind: "POSITION_VERSION",
        position_version_id: ids.positionVersion
      },
      applicable_binding_ids: nonEmpty([ids.binding]),
      binding_evidence_fragment_ids: nonEmpty([ids.fragment]),
      identity_evidence_ids: [],
      source_locator: sourceLocator,
      relationship: {
        kind: "ORIGINAL",
        target_source_reference_ids: [],
        evidence_fragment_ids: [ids.fragment],
        resolver_version: resolverVersion
      },
      binding_state: "RESOLVED",
      binding_certainty: "EXPLICIT",
      extractor_version: "cr11-synthetic-fixture/1",
      parser_version: parserVersion,
      resolver_version: resolverVersion
    }],
    selector_predicates: [],
    selector_logic_trees: [],
    conditional_branch_sets: [],
    evidence_fragments: [evidenceFragment(firstFact.requirement_fact_id)],
    requirement_evidence: [{
      requirement_evidence_id: ids.evidence,
      requirement_fact_id: firstFact.requirement_fact_id,
      snapshot_id: ids.snapshot,
      locator: sourceLocator,
      evidence_text: { text: "专业：法律", encoding: UTF8_TEXT_ENCODING },
      extractor_name: "cr11-synthetic-fixture",
      extractor_version: "1.0.0",
      parser_version: parserVersion
    }],
    observations: [{
      requirement_observation_id: ids.observation,
      opportunity_version_id: ids.opportunityVersion,
      status: "CONFIRMED_REQUIREMENT",
      clause_role: "MANDATORY",
      dimension_hint: "MAJOR",
      requirement_fact_ids: facts.map((fact) => fact.requirement_fact_id),
      evidence_fragment_ids: nonEmpty([ids.fragment]),
      parser_version: parserVersion
    }],
    parser_version: parserVersion,
    resolver_version: resolverVersion,
    serialization_version: "cr11-test-serialization/1"
  });
}
