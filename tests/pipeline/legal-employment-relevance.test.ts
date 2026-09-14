import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryLegalEmploymentRelevanceTracker,
  LegalEmploymentRelevanceError,
  assertLegalEmploymentRelevanceAssessmentIntegrity,
  assertTrustedLegalEmploymentRelevanceResolver,
  validateNotRelevantDecisionBasis,
  type IsoDateTime,
  type LegalEmploymentRelevanceAssessment,
  type LegalEmploymentRelevanceCommand,
  type SourceCompositionInput
} from "../../lib/ingestion";
import {
  InMemoryPositionBoundSourceCompositionTracker
} from "../../lib/ingestion/pipeline/position-bound-source-composition";
import {
  CanonicalArtifactRegistryError,
  createCanonicalArtifactRegistryAuthority
} from "../../lib/ingestion/normalization/canonical-artifact-registry";
import {
  AS_OF,
  trustedFixture
} from "./position-bound-phase-fixture";

let fixtureSequence = 0;

const relevantCases = [
  ["法务岗", "岗位名称：法务岗；岗位职责：提供法律咨询"],
  ["法律事务岗", "岗位名称：法律事务岗；岗位职责：处理法律事务"],
  ["法律合规岗", "岗位名称：法律合规岗；岗位职责：建设合规体系"],
  ["合同法律审查", "岗位职责：负责合同法律审查和合同起草"],
  ["诉讼仲裁", "岗位职责：负责诉讼、仲裁和合同纠纷处理"],
  ["法律风险", "岗位职责：负责法律风险识别和防控"],
  ["法律专业", "岗位职责：综合管理；专业要求：法学类"],
  ["法律职业资格", "岗位职责：案件管理；资格要求：A类法律职业资格"]
] as const;

for (const [name, text] of relevantCases) {
  test(`${name} with closed Position-bound Evidence is RELEVANT`, () => {
    assert.equal(assess(context(text)).assessment.assessment_state, "RELEVANT");
  });
}

const possiblyRelevantCases = [
  ["contract boundary", "岗位名称：合同管理岗；岗位职责：合同台账和履约跟踪"],
  ["risk boundary", "岗位名称：风险管理岗；岗位职责：识别和管理风险"],
  ["general management boundary", "岗位名称：综合管理岗；岗位职责：制度建设、合同管理与综合协调"],
  ["ordinary audit boundary", "岗位名称：审计岗；岗位职责：开展审计监督"],
  ["discipline inspection boundary", "岗位名称：纪检监察岗；岗位职责：开展监督检查"],
  ["investment boundary", "岗位名称：投资管理岗；岗位职责：开展尽调与投资分析"],
  ["employee relations boundary", "岗位名称：人力资源岗；岗位职责：负责员工关系"],
  ["financial control boundary", "岗位名称：财务岗；岗位职责：负责内控工作"],
  ["software privacy boundary", "岗位名称：软件工程师；岗位职责：负责隐私治理"],
  ["mechanical certification boundary", "岗位名称：机械工程师；岗位职责：负责产品认证"]
] as const;

for (const [name, text] of possiblyRelevantCases) {
  test(`${name} is POSSIBLY_RELEVANT without direct legal proof`, () => {
    assert.equal(
      assess(context(text)).assessment.assessment_state,
      "POSSIBLY_RELEVANT"
    );
  });
}

const notRelevantCases = [
  ["mechanical engineering", "岗位名称：机械设计工程师；岗位职责：机械设计、产品研发和工艺设计；专业要求：机械工程"],
  ["software engineering", "岗位名称：软件工程师；岗位职责：软件开发、软件测试和系统架构；专业要求：计算机"],
  ["financial accounting", "岗位名称：财务岗；岗位职责：会计核算、财务报表和资金管理；专业要求：会计学"],
  ["sales execution", "岗位名称：销售岗；岗位职责：客户开发、销售执行和销售指标；专业要求：不限"],
  ["administration", "岗位名称：行政岗；岗位职责：行政事务、会议组织和后勤保障；专业要求：不限"],
  ["technical compliance", "岗位名称：合规管理岗；岗位职责：技术质量合规和质量标准执行"],
  ["market risk", "岗位名称：风险管理岗；岗位职责：市场风险、信用风险和量化风险管理"],
  ["financial audit", "岗位名称：审计岗；岗位职责：财务审计和会计报表检查"]
] as const;

for (const [name, text] of notRelevantCases) {
  test(`complete ${name} Evidence can be NOT_RELEVANT`, () => {
    const assessment = assess(context(text)).assessment;
    assert.equal(assessment.coverage_state, "CLOSED");
    assert.equal(assessment.assessment_state, "NOT_RELEVANT");
  });
}

test("Source conflict is REVIEW_REQUIRED even with direct legal text", () => {
  const assessment = assess(context(
    "岗位名称：法务岗；岗位职责：法律咨询",
    addMaterialConflict
  )).assessment;
  assert.equal(assessment.assessment_state, "REVIEW_REQUIRED");
  assert.equal(assessment.decision_basis.material_conflict, "PRESENT");
});

test("uncertain Position binding is REVIEW_REQUIRED", () => {
  const assessment = assess(context(
    "岗位名称：法务岗；岗位职责：法律咨询",
    makeBindingUncertain
  )).assessment;
  assert.equal(assessment.assessment_state, "REVIEW_REQUIRED");
  assert.equal(assessment.decision_basis.position_binding, "UNKNOWN");
});

test("missing material attachment is EVIDENCE_BLOCKED", () => {
  const assessment = assess(context("岗位名称：综合管理岗", makeSurfaceMissing))
    .assessment;
  assert.equal(assessment.assessment_state, "EVIDENCE_BLOCKED");
  assert.ok(assessment.decision_basis.evidence_gap_codes.includes(
    "MATERIAL_ATTACHMENT_MISSING"
  ));
});

test("unparsed XLSX is EVIDENCE_BLOCKED", () => {
  const assessment = assess(context("岗位名称：综合管理岗", makeXlsxUnparsed))
    .assessment;
  assert.equal(assessment.assessment_state, "EVIDENCE_BLOCKED");
  assert.ok(assessment.decision_basis.evidence_gap_codes.includes(
    "SPREADSHEET_PARSING_UNSUPPORTED"
  ));
});

test("unparsed PDF is EVIDENCE_BLOCKED", () => {
  const assessment = assess(context("岗位名称：综合管理岗", makePdfUnparsed))
    .assessment;
  assert.equal(assessment.assessment_state, "EVIDENCE_BLOCKED");
  assert.ok(assessment.decision_basis.evidence_gap_codes.includes(
    "DOCUMENT_PARSING_UNSUPPORTED"
  ));
});

test("only a 综合管理 title cannot become NOT_RELEVANT", () => {
  const assessment = assess(context("岗位名称：综合管理岗")).assessment;
  assert.equal(assessment.assessment_state, "EVIDENCE_BLOCKED");
});

test("only 专业不限 cannot become NOT_RELEVANT", () => {
  const assessment = assess(context("专业要求：不限")).assessment;
  assert.equal(assessment.assessment_state, "EVIDENCE_BLOCKED");
});

test("Candidate-side extra input is rejected and cannot change Relevance", () => {
  const current = context("岗位名称：法务岗；岗位职责：法律咨询");
  const command = relevanceCommand(current);
  const baseline = current.tracker.process(command);
  for (const extra of [
    { candidate_profile_id: "candidate-a" },
    { institution: "武汉大学" },
    { candidate_result: "INELIGIBLE" },
    { candidate_result: "ELIGIBLE" }
  ]) {
    assert.throws(() => current.tracker.process({
      ...command,
      ...extra
    } as never), LegalEmploymentRelevanceError);
  }
  const replay = current.tracker.process(command);
  assert.equal(replay.version_created, false);
  assert.deepEqual(replay.assessment, baseline.assessment);
  assert.equal(replay.assessment.assessment_state, "RELEVANT");
});

test("caller cannot inject an Assessment or replace trusted upstream resolvers", () => {
  const current = context("岗位名称：法务岗；岗位职责：法律咨询");
  const command = relevanceCommand(current);
  const artifact = current.tracker.process(command).assessment;
  assert.throws(() => current.tracker.process({
    ...command,
    assessment: artifact
  } as never), LegalEmploymentRelevanceError);
  assert.throws(() => new InMemoryLegalEmploymentRelevanceTracker(
    { resolve: () => null, resolveSources: () => null },
    current.compositions
  ), /Trusted PBOV resolver/);
  assert.throws(() => new InMemoryLegalEmploymentRelevanceTracker(
    current.fixture.pbov_tracker,
    { resolve: () => null }
  ), /Trusted SourceComposition resolver/);
  assert.throws(() => assertTrustedLegalEmploymentRelevanceResolver({
    resolve: () => null,
    list: () => []
  }), LegalEmploymentRelevanceError);
});

test("trusted resolver returns defensive immutable snapshots", () => {
  const current = context("岗位名称：法务岗；岗位职责：法律咨询");
  const assessment = assess(current).assessment;
  const resolved = current.tracker.resolve(assessment.assessment_id)!;
  (resolved.findings as unknown[]).push({ forged: true });
  (resolved.decision_basis.evidence_gap_codes as string[]).push("FORGED");
  assert.deepEqual(current.tracker.resolve(assessment.assessment_id), assessment);
});

test("same complete trusted input is idempotent", () => {
  const current = context("岗位名称：法务岗；岗位职责：法律咨询");
  const first = assess(current);
  const second = current.tracker.process({
    ...relevanceCommand(current),
    created_at: "2026-09-10T12:00:00+08:00" as IsoDateTime
  });
  assert.equal(first.version_created, true);
  assert.equal(second.version_created, false);
  assert.deepEqual(second.assessment, first.assessment);
});

test("new trusted provenance creates a new append-only revision", () => {
  const current = context("岗位名称：法务岗；岗位职责：法律咨询");
  const first = assess(current).assessment;
  const revisedInput = structuredClone(current.fixture.composition_input);
  mutable(revisedInput).parser_version = "relevance-fixture-parser/2.0.0";
  mutable(revisedInput).source_surfaces[0].parser_version =
    "relevance-fixture-parser/2.0.0";
  const revisedComposition = current.compositions.process({
    opportunity_version_id: current.fixture.opportunity_version_id,
    composition_input: revisedInput
  });
  const second = current.tracker.process({
    opportunity_version_id: current.fixture.opportunity_version_id,
    source_composition_id: revisedComposition.source_composition_id,
    created_at: "2026-09-10T12:00:00+08:00" as IsoDateTime
  }).assessment;

  assert.equal(first.assessment_version, 1);
  assert.equal(second.assessment_version, 2);
  assert.notEqual(second.assessment_id, first.assessment_id);
  assert.notEqual(second.source_composition_id, first.source_composition_id);
  assert.deepEqual(
    current.tracker.list(first.position_id).map((item) => item.assessment_id),
    [first.assessment_id, second.assessment_id]
  );
});

test("forged Assessment mutation fails integrity validation", () => {
  const assessment = assess(context(
    "岗位名称：法务岗；岗位职责：法律咨询"
  )).assessment;
  const forged = structuredClone(assessment);
  mutable(forged).assessment_state = "NOT_RELEVANT";
  assert.throws(
    () => assertLegalEmploymentRelevanceAssessmentIntegrity(forged),
    LegalEmploymentRelevanceError
  );
});

test("assessment registry rejects same ID with different canonical bytes", () => {
  const assessment = assess(context(
    "岗位名称：法务岗；岗位职责：法律咨询"
  )).assessment;
  const registry = createCanonicalArtifactRegistryAuthority(
    (artifact: LegalEmploymentRelevanceAssessment) => artifact.assessment_id
  );
  registry.writer.seal(assessment.assessment_id, assessment);
  assert.throws(() => registry.writer.seal(assessment.assessment_id, {
    ...assessment,
    created_at: "2026-09-11T12:00:00+08:00" as IsoDateTime
  }), (error: unknown) => {
    return error instanceof CanonicalArtifactRegistryError
      && error.code === "IDENTITY_COLLISION";
  });
});

test("NOT_RELEVANT validator rejects every non-closed proof state", () => {
  const assessment = assess(context(
    "岗位名称：机械设计工程师；岗位职责：机械设计、产品研发和工艺设计"
  )).assessment;
  assert.equal(assessment.assessment_state, "NOT_RELEVANT");
  const cases = [
    ["EVIDENCE_BLOCKED", assessment.decision_basis],
    ["CLOSED", { ...assessment.decision_basis, position_binding: "UNKNOWN" }],
    ["CLOSED", { ...assessment.decision_basis, non_law_function: "UNKNOWN" }],
    ["CLOSED", { ...assessment.decision_basis, direct_legal_evidence: "UNKNOWN" }],
    ["CLOSED", { ...assessment.decision_basis, legal_major_evidence: "PRESENT" }],
    ["CLOSED", { ...assessment.decision_basis, legal_qualification_evidence: "PRESENT" }],
    ["CLOSED", { ...assessment.decision_basis, material_conflict: "PRESENT" }]
  ] as const;
  for (const [coverage, basis] of cases) {
    assert.throws(() => validateNotRelevantDecisionBasis(
      coverage,
      basis
    ), LegalEmploymentRelevanceError);
  }
});

test("every admitted Position produces an auditable state without silent loss", () => {
  const contexts = [
    context("岗位名称：法务岗；岗位职责：法律咨询"),
    context("岗位名称：合同管理岗；岗位职责：合同台账"),
    context("岗位名称：综合管理岗"),
    context("岗位名称：机械工程师；岗位职责：机械设计"),
    context("岗位名称：法务岗；岗位职责：法律咨询", addMaterialConflict)
  ];
  const assessments = contexts.map((item) => assess(item).assessment);
  assert.equal(assessments.length, contexts.length);
  assert.deepEqual(new Set(assessments.map((item) => item.assessment_state)), new Set([
    "RELEVANT",
    "POSSIBLY_RELEVANT",
    "EVIDENCE_BLOCKED",
    "NOT_RELEVANT",
    "REVIEW_REQUIRED"
  ]));
  for (const assessment of assessments) {
    assert.ok(assessment.integrity_hash);
    assert.ok(assessment.findings.length > 0);
  }
});

interface RelevanceContext {
  readonly fixture: ReturnType<typeof trustedFixture>;
  readonly compositions: InMemoryPositionBoundSourceCompositionTracker;
  readonly composition: ReturnType<InMemoryPositionBoundSourceCompositionTracker["process"]>;
  readonly tracker: InMemoryLegalEmploymentRelevanceTracker;
}

function context(
  sourceText: string,
  mutateComposition?: (input: SourceCompositionInput) => void
): RelevanceContext {
  fixtureSequence += 1;
  const fixture = trustedFixture(`relevance-${fixtureSequence}`, sourceText);
  const input = structuredClone(fixture.composition_input);
  mutateComposition?.(input);
  const compositions = new InMemoryPositionBoundSourceCompositionTracker(
    fixture.pbov_tracker
  );
  const composition = compositions.process({
    opportunity_version_id: fixture.opportunity_version_id,
    composition_input: input
  });
  const tracker = new InMemoryLegalEmploymentRelevanceTracker(
    fixture.pbov_tracker,
    compositions
  );
  return { fixture, compositions, composition, tracker };
}

function assess(current: RelevanceContext) {
  return current.tracker.process(relevanceCommand(current));
}

function relevanceCommand(
  current: RelevanceContext
): LegalEmploymentRelevanceCommand {
  return {
    opportunity_version_id: current.fixture.opportunity_version_id,
    source_composition_id: current.composition.source_composition_id,
    created_at: AS_OF
  };
}

function addMaterialConflict(input: SourceCompositionInput) {
  const firstSurface = input.source_surfaces[0]!;
  const firstEvidence = input.evidence_registry[0]!;
  mutable(input).source_conflicts = [{
    source_conflict_id: "source-conflict:relevance-test",
    competing_source_surface_ids: [firstSurface.source_surface_id],
    target_scope: input.opportunity_version_id,
    requirement_scope: "position relevance",
    competing_observation_ids: [firstEvidence.extracted_record_id],
    authority_assertion_ids: input.authority_assertions.map((item) => {
      return item.authority_assertion_id;
    }),
    effective_period: { effective_from: input.composition_as_of },
    evidence_ids: [firstEvidence.source_composition_evidence_id],
    status: "DETECTED",
    affects_required_coverage: true,
    resolver_version: "relevance-conflict-test/1.0.0",
    schema_version: input.schema_version
  }];
}

function makeBindingUncertain(input: SourceCompositionInput) {
  mutable(input).source_surface_bindings[0].binding_status = "UNRESOLVED";
  mutable(input).inventory.expected_surface_entries[0].binding_status = "UNRESOLVED";
  mutable(input).inventory.expected_surface_entries[0].resolution_status = "UNRESOLVED";
}

function makeSurfaceMissing(input: SourceCompositionInput) {
  mutable(input).source_surfaces[0].surface_status = "MISSING";
  const entry = mutable(input).inventory.expected_surface_entries[0];
  entry.coverage_status = "UNRESOLVED";
  entry.resolution_status = "UNRESOLVED";
  mutable(input).inventory.inventory_completeness_status = "OPEN_MISSING_REQUIRED";
}

function makeXlsxUnparsed(input: SourceCompositionInput) {
  mutable(input).source_surfaces[0].surface_status = "ACQUIRED";
  mutable(input).inventory.expected_surface_entries[0].coverage_status = "UNRESOLVED";
  mutable(input).inventory.expected_surface_entries[0].resolution_status = "UNRESOLVED";
  mutable(input).inventory.inventory_completeness_status = "OPEN_UNRESOLVED";
}

function makePdfUnparsed(input: SourceCompositionInput) {
  makeXlsxUnparsed(input);
  mutable(input).source_surfaces[0].locator = {
    kind: "DOCUMENT",
    section: "attachment.pdf",
    field_path: "position"
  };
  mutable(input).source_surface_bindings[0].locator =
    structuredClone(mutable(input).source_surfaces[0].locator);
  mutable(input).evidence_registry[0].locator =
    structuredClone(mutable(input).source_surfaces[0].locator);
}

function mutable<Value>(value: Value): any {
  return value;
}
