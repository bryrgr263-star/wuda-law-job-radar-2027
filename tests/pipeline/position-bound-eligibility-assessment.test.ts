import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  ELIGIBILITY_ASSESSMENT_RULE_VERSION,
  PREDICATE_RESOLUTION_RULE_VERSION,
  assertPositionBoundEligibilityAssessmentIntegrity
} from "../../lib/ingestion";
import {
  AS_OF,
  CANDIDATE_ID,
  OBSERVED_AT,
  materializeSyntheticCandidateEvidence,
  materializeTrustedChain,
  syntheticCandidateProfile,
  trustedFixture
} from "./position-bound-phase-fixture";

function resolutionFixture(suffix: string, withEvidence = true) {
  const materialized = materializeTrustedChain(trustedFixture(suffix));
  const evidence = withEvidence
    ? materializeSyntheticCandidateEvidence(materialized.fixture, suffix)
    : null;
  const evidenceIds = evidence?.evidence_ids ?? [];
  const resolutions = materialized.fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: materialized.fixture.opportunity_version_id,
    source_composition_id: materialized.sourceComposition.source_composition_id,
    requirement_set_version_id: materialized.requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidenceIds,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.equal(resolutions.status, "RESOLUTION_SET");
  return { ...materialized, evidenceIds, resolutions };
}

test("Phase I consumes only trusted PredicateResolution IDs", () => {
  const context = resolutionFixture("i-trusted");
  const result = context.fixture.chain.eligibility_assessments.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    predicate_resolution_ids: context.resolutions.resolutions.map((item) => {
      return item.predicate_resolution_id;
    }),
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: context.evidenceIds,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
    assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  });
  assert.equal(result.status, "ASSESSMENT");
  assert.equal(result.status === "ASSESSMENT" ? result.assessment.result : null,
    "ELIGIBLE");
  assert.equal(result.status === "ASSESSMENT"
    ? result.assessment.assessment_scope
    : null, "SYNTHETIC_TEST");
});

test("caller-forged PredicateResolution cannot enter Phase I", () => {
  const context = resolutionFixture("i-forged-h");
  const result = context.fixture.chain.eligibility_assessments.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    predicate_resolution_ids: ["predicate-resolution:forged"],
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: context.evidenceIds,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
    assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  });
  assert.equal(result.status, "NOT_ALLOWED");
});

test("coordinated caller IDs cannot forge F through I", () => {
  const fixture = trustedFixture("i-coordinated-forgery");
  const result = fixture.chain.eligibility_assessments.materialize({
    opportunity_version_id: "opportunity-version:forged:1" as never,
    source_composition_id: "source-composition:forged" as never,
    requirement_set_version_id: "requirement-set-version:forged",
    predicate_resolution_ids: ["predicate-resolution:forged"],
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: ["predicate-candidate-evidence:forged"],
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
    assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  });
  assert.equal(result.status, "NOT_ALLOWED");
});

test("missing evidence becomes NEEDS_REVIEW and never INELIGIBLE", () => {
  const context = resolutionFixture("i-recall-first", false);
  const result = context.fixture.chain.eligibility_assessments.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    predicate_resolution_ids: context.resolutions.resolutions.map((item) => {
      return item.predicate_resolution_id;
    }),
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: [],
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
    assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  });
  assert.equal(result.status, "ASSESSMENT");
  assert.equal(result.status === "ASSESSMENT" ? result.assessment.result : null,
    "NEEDS_REVIEW");
  assert.notEqual(result.status === "ASSESSMENT"
    ? result.assessment.result
    : null, "INELIGIBLE");
});

test("explicit bachelor law requirement and bachelor NON_LAW are INELIGIBLE", () => {
  const context = assessSyntheticRequirement(
    "i-bachelor-law-negative",
    "本科：法学类",
    {
      academic_program_directory: {
        directory_namespace: "普通高等学校本科专业目录",
        directory_version: "2024年"
      }
    }
  );
  assert.equal(context.assessment.status, "ASSESSMENT");
  assert.equal(context.assessment.status === "ASSESSMENT"
    ? context.assessment.assessment.result
    : null, "INELIGIBLE");
  assert.equal(context.assessment.status === "ASSESSMENT"
    ? context.assessment.assessment.decision_basis
      .negative_predicate_resolution_ids.length
    : null, 1);
});

test("LAW_MASTER_NON_LAW requirement matches the exact candidate program type", () => {
  const context = assessSyntheticRequirement(
    "i-law-master-non-law",
    "研究生：法律硕士（非法学）"
  );
  assert.equal(context.assessment.status, "ASSESSMENT");
  assert.equal(context.assessment.status === "ASSESSMENT"
    ? context.assessment.assessment.result
    : null, "ELIGIBLE");
});

test("exact 0301 directory evidence can prove a negative result", () => {
  const context = assessSyntheticRequirement(
    "i-program-0301-negative",
    "研究生：法学（0301）",
    {
      academic_program_directory: {
        directory_namespace: "研究生教育学科专业目录",
        directory_version: "2022年"
      }
    }
  );
  assert.equal(context.predicateResult.status, "RESOLUTION_SET");
  assert.equal(context.predicateResult.status === "RESOLUTION_SET"
    ? context.predicateResult.resolutions[0]?.resolution_status
    : null, "RESOLVED_NOT_MATCH");
  assert.equal(context.assessment.status, "ASSESSMENT");
  assert.equal(context.assessment.status === "ASSESSMENT"
    ? context.assessment.assessment.result
    : null, "INELIGIBLE");
});

test("0351 does not infer LAW_MASTER_NON_LAW without exact directory evidence", () => {
  const profile = structuredClone(
    syntheticCandidateProfile("i-0351-no-directory")
  );
  const master = profile.education.find((credential) => {
    return credential.level === "MASTER";
  })!;
  (master as { program_directory_references?: readonly never[] })
    .program_directory_references = [];
  const context = assessSyntheticRequirement(
    "i-0351-no-directory",
    "研究生：法律（0351）",
    {
      academic_program_directory: {
        directory_namespace: "研究生教育学科专业目录",
        directory_version: "2022年"
      }
    },
    profile
  );
  assert.equal(context.predicateResult.status, "RESOLUTION_SET");
  assert.notEqual(context.predicateResult.status === "RESOLUTION_SET"
    ? context.predicateResult.resolutions[0]?.logical_result
    : null, "TRUE");
  assert.equal(context.assessment.status, "ASSESSMENT");
  assert.equal(context.assessment.status === "ASSESSMENT"
    ? context.assessment.assessment.result
    : null, "NEEDS_REVIEW");
});

test("candidate institution does not affect a requirement with no institution predicate", () => {
  const Wuhan = assessSyntheticRequirement(
    "i-institution-wuhan",
    "研究生：法律硕士（非法学）"
  );
  const otherProfile = structuredClone(
    syntheticCandidateProfile("i-institution-other")
  );
  const otherMaster = otherProfile.education.find((credential) => {
    return credential.level === "MASTER";
  })!;
  (otherMaster.institution.original as { text: string }).text = "其他大学";
  const other = assessSyntheticRequirement(
    "i-institution-other",
    "研究生：法律硕士（非法学）",
    {},
    otherProfile
  );
  assert.equal(Wuhan.assessment.status === "ASSESSMENT"
    ? Wuhan.assessment.assessment.result
    : null, "ELIGIBLE");
  assert.equal(other.assessment.status === "ASSESSMENT"
    ? other.assessment.assessment.result
    : null, "ELIGIBLE");
});

test("claimed evidence remains NEEDS_REVIEW in production scope", () => {
  const context = materializeTrustedChain(trustedFixture("i-claimed"));
  const evidence = context.fixture.chain.candidate_evidence.materialize_claimed({
    candidate_profile: syntheticCandidateProfile("i-claimed"),
    observed_at: OBSERVED_AT
  });
  const result = materializeAssessment(context, evidence.evidence_ids);
  assert.equal(result.assessment.status, "ASSESSMENT");
  assert.equal(result.assessment.status === "ASSESSMENT"
    ? result.assessment.assessment.result
    : null, "NEEDS_REVIEW");
  assert.equal(result.assessment.status === "ASSESSMENT"
    ? result.assessment.assessment.assessment_scope
    : null, "PRODUCTION");
});

test("synthetic and production Candidate Evidence cannot be mixed", () => {
  const context = materializeTrustedChain(trustedFixture("i-mixed-evidence"));
  const profile = syntheticCandidateProfile("i-mixed-evidence");
  const synthetic = context.fixture.chain.candidate_evidence
    .materialize_synthetic_fixture({
      candidate_profile: profile,
      observed_at: OBSERVED_AT
    });
  const claimed = context.fixture.chain.candidate_evidence.materialize_claimed({
    candidate_profile: profile,
    observed_at: OBSERVED_AT
  });
  const result = materializeAssessment(context, [
    ...synthetic.evidence_ids,
    ...claimed.evidence_ids
  ]);
  assert.equal(result.predicateResult.status, "RESOLUTION_SET");
  assert.equal(result.assessment.status, "NOT_ALLOWED");
  assert.equal(result.assessment.status === "NOT_ALLOWED"
    ? result.assessment.reason
    : null, "CANDIDATE_EVIDENCE_SCOPE_MIXED");
});

test("assessment seals complete provenance and supporting resolutions", () => {
  const context = assessSyntheticRequirement(
    "i-provenance",
    "学历要求：本科及以上"
  );
  assert.ok(context.assessment.status === "ASSESSMENT");
  const assessment = context.assessment.assessment;
  assertPositionBoundEligibilityAssessmentIntegrity(assessment);
  assert.equal(assessment.decision_basis.candidate_evidence_scope,
    "SYNTHETIC_TEST");
  assert.ok(assessment.decision_basis.supporting_predicate_resolution_ids
    .length > 0);
  assert.deepEqual(assessment.decision_basis.negative_predicate_resolution_ids,
    []);
  assert.ok(assessment.decision_basis.candidate_evidence.every((evidence) => {
    return evidence.synthetic_test
      && evidence.provenance === "SYNTHETIC_TEST"
      && evidence.source_reference_ids.length > 0;
  }));
  assert.ok(assessment.decision_basis.predicate_resolutions.every((resolution) => {
    return resolution.requirement_source_reference_ids.length > 0
      && resolution.requirement_evidence_fragment_ids.length > 0
      && resolution.requirement_evidence_ids.length > 0
      && resolution.candidate_evidence_references.every((reference) => {
        return reference.synthetic_test
          && reference.source_references.length > 0;
      });
  }));
});

test("assessment registry is idempotent and isolates caller mutation", () => {
  const context = assessSyntheticRequirement(
    "i-assessment-isolation",
    "学历要求：本科及以上"
  );
  assert.ok(context.assessment.status === "ASSESSMENT");
  const original = structuredClone(context.assessment.assessment);
  const replay = context.fixture.chain.eligibility_assessments.materialize(
    context.assessmentCommand
  );
  assert.ok(replay.status === "ASSESSMENT");
  assert.equal(replay.assessment.eligibility_assessment_id,
    original.eligibility_assessment_id);
  assert.equal(replay.assessment.version_created, false);

  (context.assessment.assessment.decision_basis.candidate_evidence[0] as {
    observed_at: typeof AS_OF;
  }).observed_at = AS_OF;
  assert.throws(() => assertPositionBoundEligibilityAssessmentIntegrity(
    context.assessment.status === "ASSESSMENT"
      ? context.assessment.assessment
      : original
  ));
  const resolved = context.fixture.chain.eligibility_assessments.resolve(
    original.eligibility_assessment_id
  );
  assert.deepEqual(resolved, original);
  assert.ok(resolved);
  (resolved.decision_basis.supporting_predicate_resolution_ids as string[])
    .splice(0);
  assert.deepEqual(context.fixture.chain.eligibility_assessments.resolve(
    original.eligibility_assessment_id
  ), original);
});

test("caller mutation of a returned PredicateResolution cannot replace trusted truth", () => {
  const context = assessSyntheticRequirement(
    "i-predicate-mutation",
    "学历要求：本科及以上"
  );
  assert.ok(context.predicateResult.status === "RESOLUTION_SET");
  (context.predicateResult.resolutions[0] as {
    logical_result: "FALSE";
  }).logical_result = "FALSE";
  const assessment = context.fixture.chain.eligibility_assessments.materialize(
    context.assessmentCommand
  );
  assert.equal(assessment.status, "ASSESSMENT");
  assert.equal(assessment.status === "ASSESSMENT"
    ? assessment.assessment.result
    : null, "ELIGIBLE");
});

test("changed Candidate Evidence provenance creates a new assessment revision", () => {
  const context = assessSyntheticRequirement(
    "i-provenance-revision",
    "学历要求：本科及以上"
  );
  assert.ok(context.assessment.status === "ASSESSMENT");
  const laterObservedAt = "2026-09-08T13:00:00+08:00" as typeof OBSERVED_AT;
  const laterEvidence = context.fixture.chain.candidate_evidence
    .materialize_synthetic_fixture({
      candidate_profile: syntheticCandidateProfile("i-provenance-revision"),
      observed_at: laterObservedAt,
      effective_from: OBSERVED_AT
    });
  const later = materializeAssessment(context, laterEvidence.evidence_ids);
  assert.ok(later.assessment.status === "ASSESSMENT",
    JSON.stringify(later.assessment));
  assert.notEqual(later.assessment.assessment.eligibility_assessment_id,
    context.assessment.assessment.eligibility_assessment_id);
  assert.notEqual(later.assessment.assessment.semantic_hash,
    context.assessment.assessment.semantic_hash);
  assert.equal(later.assessment.assessment.revision, 2);
});

test("target 22828700101 remains blocked with no trusted upstream artifacts", () => {
  const fixture = trustedFixture("i-target-blocked");
  assert.equal(fixture.chain.requirement_sets.resolve("22828700101"), null);
  assert.equal(fixture.chain.predicate_resolutions.resolve("22828700101"), null);
  assert.equal(fixture.chain.eligibility_assessments.resolve("22828700101"), null);
});

function assessSyntheticRequirement(
  suffix: string,
  requirementText: string,
  options: Parameters<typeof trustedFixture>[2] = {},
  profile = syntheticCandidateProfile(suffix)
) {
  const context = materializeTrustedChain(
    trustedFixture(suffix, requirementText, options)
  );
  const evidence = context.fixture.chain.candidate_evidence
    .materialize_synthetic_fixture({
      candidate_profile: profile,
      observed_at: OBSERVED_AT,
      effective_from: OBSERVED_AT
    });
  return {
    ...context,
    evidence,
    ...materializeAssessment(context, evidence.evidence_ids)
  };
}

function materializeAssessment(
  context: ReturnType<typeof materializeTrustedChain>,
  candidateEvidenceIds: readonly string[]
) {
  const predicateCommand = {
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: candidateEvidenceIds,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  };
  const predicateResult = context.fixture.chain.predicate_resolutions
    .materialize(predicateCommand);
  assert.ok(predicateResult.status === "RESOLUTION_SET");
  const assessmentCommand = {
    ...predicateCommand,
    predicate_resolution_ids: predicateResult.resolutions.map((resolution) => {
      return resolution.predicate_resolution_id;
    }),
    assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  };
  const assessment = context.fixture.chain.eligibility_assessments.materialize(
    assessmentCommand
  );
  return { predicateResult, assessmentCommand, assessment };
}
