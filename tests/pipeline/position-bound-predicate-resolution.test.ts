import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  PREDICATE_RESOLUTION_RULE_VERSION,
  assertPositionBoundPredicateResolutionIntegrity
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

test("Phase H resolves only trusted E/F/G IDs", () => {
  const { fixture, sourceComposition, requirementSet } = materializeTrustedChain(
    trustedFixture("h-trusted")
  );
  const evidence = materializeSyntheticCandidateEvidence(fixture, "h-trusted");
  const result = fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    source_composition_id: sourceComposition.source_composition_id,
    requirement_set_version_id: requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidence.evidence_ids,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.equal(result.status, "RESOLUTION_SET");
  assert.equal(result.resolutions[0]?.resolution_status, "RESOLVED_MATCH");
});

test("caller-forged RequirementSetVersion ID is blocked", () => {
  const { fixture, sourceComposition } = materializeTrustedChain(
    trustedFixture("h-forged-rsv")
  );
  const evidence = materializeSyntheticCandidateEvidence(fixture, "h-forged-rsv");
  const result = fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    source_composition_id: sourceComposition.source_composition_id,
    requirement_set_version_id: "requirement-set-version:forged",
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidence.evidence_ids,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.equal(result.status, "BLOCKED");
});

test("missing evidence remains INSUFFICIENT and never NOT_MATCH", () => {
  const { fixture, sourceComposition, requirementSet } = materializeTrustedChain(
    trustedFixture("h-recall-first")
  );
  const result = fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    source_composition_id: sourceComposition.source_composition_id,
    requirement_set_version_id: requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: [],
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.equal(result.status, "RESOLUTION_SET");
  assert.equal(result.resolutions[0]?.resolution_status, "INSUFFICIENT");
  assert.notEqual(result.resolutions[0]?.resolution_status, "RESOLVED_NOT_MATCH");
});

test("PredicateResolution resolver returns defensive snapshots", () => {
  const { fixture, sourceComposition, requirementSet } = materializeTrustedChain(
    trustedFixture("h-isolation")
  );
  const evidence = materializeSyntheticCandidateEvidence(fixture, "h-isolation");
  const result = fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: fixture.opportunity_version_id,
    source_composition_id: sourceComposition.source_composition_id,
    requirement_set_version_id: requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidence.evidence_ids,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.equal(result.status, "RESOLUTION_SET");
  const resolution = result.resolutions[0]!;
  (resolution.reason_codes as string[])[0] = "FORGED";
  assert.notEqual(
    fixture.chain.predicate_resolutions.resolve(resolution.predicate_resolution_id)
      ?.reason_codes[0],
    "FORGED"
  );
});

test("2027 target graduation evidence resolves the exact graduation requirement", () => {
  const { result } = resolveSyntheticRequirement(
    "h-graduation-2027",
    "2027届"
  );
  assert.equal(result.status, "RESOLUTION_SET");
  assert.equal(result.resolutions[0]?.resolution_status, "RESOLVED_MATCH");
  assert.equal(result.resolutions[0]?.logical_result, "TRUE");
  assert.equal(
    result.resolutions[0]?.candidate_evidence_references[0]?.synthetic_test,
    true
  );
});

test("approved exact major identity resolves without keyword similarity", () => {
  const { result } = resolveSyntheticRequirement(
    "h-major-law-master-non-law",
    "研究生：法律硕士（非法学）"
  );
  assert.equal(result.status, "RESOLUTION_SET");
  assert.equal(result.resolutions[0]?.resolution_status, "RESOLVED_MATCH");
});

test("an upstream-unresolved major requirement cannot become a negative result", () => {
  const { requirementSet, result } = resolveSyntheticRequirement(
    "h-major-law-master-law-unresolved",
    "研究生：法律硕士（法学）"
  );
  assert.equal(requirementSet.requirement_set.completeness.status,
    "REVIEW_REQUIRED");
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.status === "BLOCKED" ? result.blocker_code : null,
    "REQUIREMENT_SET_NOT_COMPLETE");
  assert.equal(JSON.stringify(result).includes("RESOLVED_NOT_MATCH"), false);
});

test("program references compare exact directory namespace, version, and code", () => {
  const options = {
    academic_program_directory: {
      directory_namespace: "研究生教育学科专业目录",
      directory_version: "2022年"
    }
  } as const;
  const exact = resolveSyntheticRequirement(
    "h-program-0351",
    "研究生：法律（0351）",
    options
  ).result;
  const different = resolveSyntheticRequirement(
    "h-program-0301",
    "研究生：法学（0301）",
    options
  ).result;

  assert.equal(exact.status, "RESOLUTION_SET");
  assert.equal(exact.resolutions[0]?.resolution_status, "RESOLVED_MATCH");
  assert.equal(different.status, "RESOLUTION_SET");
  assert.equal(different.resolutions[0]?.resolution_status,
    "RESOLVED_NOT_MATCH");
  assert.equal(
    exact.resolutions[0]?.reason_codes.includes(
      "LAW_0351_APPLICABILITY_UNRESOLVED"
    ),
    false
  );
});

test("explicit bachelor non-law evidence contradicts a bachelor law requirement", () => {
  const { result } = resolveSyntheticRequirement(
    "h-bachelor-law-contradiction",
    "本科：法学类",
    {
      academic_program_directory: {
        directory_namespace: "普通高等学校本科专业目录",
        directory_version: "2024年"
      }
    }
  );
  assert.equal(result.status, "RESOLUTION_SET");
  assert.equal(result.resolutions[0]?.resolution_status, "RESOLVED_NOT_MATCH");
  assert.equal(result.resolutions[0]?.logical_result, "FALSE");
  assert.deepEqual(result.resolutions[0]?.reason_codes,
    ["EXPLICIT_CANDIDATE_EVIDENCE_CONTRADICTION"]);
});

test("claimed candidate evidence cannot produce a negative resolution", () => {
  const context = materializeTrustedChain(trustedFixture(
    "h-claimed-no-negative",
    "本科：法学类",
    {
      academic_program_directory: {
        directory_namespace: "普通高等学校本科专业目录",
        directory_version: "2024年"
      }
    }
  ));
  const claimed = context.fixture.chain.candidate_evidence.materialize_claimed({
    candidate_profile: syntheticCandidateProfile("h-claimed-no-negative"),
    observed_at: OBSERVED_AT
  });
  const result = context.fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: claimed.evidence_ids,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.equal(result.status, "RESOLUTION_SET");
  assert.equal(result.resolutions[0]?.resolution_status, "INSUFFICIENT");
  assert.notEqual(result.resolutions[0]?.logical_result, "FALSE");
});

test("PredicateResolution seals complete Candidate Evidence provenance", () => {
  const { fixture, result } = resolveSyntheticRequirement(
    "h-provenance",
    "学历要求：本科及以上"
  );
  assert.equal(result.status, "RESOLUTION_SET");
  const resolution = result.resolutions[0]!;
  assertPositionBoundPredicateResolutionIntegrity(resolution);
  assert.equal(resolution.candidate_profile_id, CANDIDATE_ID);
  assert.ok(resolution.candidate_evidence_references.every((reference) => {
    return reference.observed_at === OBSERVED_AT
      && reference.effective_from === OBSERVED_AT
      && reference.observation_status === "CONFIRMED"
      && reference.provenance === "SYNTHETIC_TEST"
      && reference.synthetic_test
      && reference.source_references.every((source) => {
        return source.evidence_class === "SYNTHETIC_TEST"
          && source.captured_at === OBSERVED_AT
          && source.issuer === "synthetic-candidate-fixture";
      });
  }));

  const changed = structuredClone(resolution);
  (changed.candidate_evidence_references[0] as {
    observed_at: typeof OBSERVED_AT;
  }).observed_at = AS_OF;
  assert.throws(() => assertPositionBoundPredicateResolutionIntegrity(changed));
  assert.deepEqual(
    fixture.chain.predicate_resolutions.resolve(resolution.predicate_resolution_id),
    resolution
  );
});

test("same evidence is idempotent while provenance changes create a new resolution", () => {
  const context = materializeTrustedChain(trustedFixture("h-provenance-version"));
  const profile = syntheticCandidateProfile("h-provenance-version");
  const firstEvidence = context.fixture.chain.candidate_evidence
    .materialize_synthetic_fixture({
      candidate_profile: profile,
      observed_at: OBSERVED_AT,
      effective_from: OBSERVED_AT
    });
  const command = {
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: firstEvidence.evidence_ids,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  };
  const first = context.fixture.chain.predicate_resolutions.materialize(command);
  const replay = context.fixture.chain.predicate_resolutions.materialize(command);
  assert.ok(first.status === "RESOLUTION_SET");
  assert.ok(replay.status === "RESOLUTION_SET");
  assert.equal(replay.resolutions[0]?.predicate_resolution_id,
    first.resolutions[0]?.predicate_resolution_id);
  assert.equal(replay.resolutions[0]?.version_created, false);

  const laterObservedAt = "2026-09-08T13:00:00+08:00" as typeof OBSERVED_AT;
  const laterEvidence = context.fixture.chain.candidate_evidence
    .materialize_synthetic_fixture({
      candidate_profile: profile,
      observed_at: laterObservedAt,
      effective_from: OBSERVED_AT
    });
  const later = context.fixture.chain.predicate_resolutions.materialize({
    ...command,
    candidate_evidence_ids: laterEvidence.evidence_ids
  });
  assert.ok(later.status === "RESOLUTION_SET");
  assert.notEqual(later.resolutions[0]?.predicate_resolution_id,
    first.resolutions[0]?.predicate_resolution_id);
  assert.notEqual(later.resolutions[0]?.semantic_hash,
    first.resolutions[0]?.semantic_hash);
  assert.equal(later.resolutions[0]?.revision, 2);
});

function resolveSyntheticRequirement(
  suffix: string,
  requirementText: string,
  options: Parameters<typeof trustedFixture>[2] = {}
) {
  const context = materializeTrustedChain(
    trustedFixture(suffix, requirementText, options)
  );
  const evidence = materializeSyntheticCandidateEvidence(context.fixture, suffix);
  const result = context.fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidence.evidence_ids,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  return { ...context, evidence, result };
}
