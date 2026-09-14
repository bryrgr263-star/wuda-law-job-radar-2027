import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  ELIGIBILITY_ASSESSMENT_RULE_VERSION,
  PREDICATE_RESOLUTION_RULE_VERSION,
  assertTrustedCandidateEvidenceResolver,
  type PredicateCandidateEvidence
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

test("synthetic Candidate Evidence preserves independent bachelor and master credentials", () => {
  const fixture = trustedFixture("candidate-credential-boundary");
  const batch = materializeSyntheticCandidateEvidence(
    fixture,
    "candidate-credential-boundary"
  );
  const credentials = batch.evidence.filter((item) => {
    return item.value?.kind === "EDUCATION_CREDENTIAL";
  });

  assert.equal(credentials.length, 2);
  const bachelor = credentialEvidence(credentials, "BACHELOR");
  const master = credentialEvidence(credentials, "MASTER");
  assert.notEqual(bachelor.candidate_credential_id, master.candidate_credential_id);
  assert.equal(bachelor.value.credential.academic_background, "NON_LAW");
  assert.equal(master.value.credential.institution.original.text, "武汉大学");
  assert.equal(master.value.credential.program_type, "LAW_MASTER_NON_LAW");
  assert.equal(master.value.credential.academic_background, "NON_LAW");
  assert.equal(master.value.credential.graduation_year, 2027);

  const targetYear = batch.evidence.find((item) => {
    return item.value?.kind === "TARGET_GRADUATION_YEAR";
  });
  assert.equal(
    targetYear?.value?.kind === "TARGET_GRADUATION_YEAR"
      ? targetYear.value.graduation_year
      : null,
    2027
  );
});

test("0351 directory evidence does not infer LAW_MASTER_NON_LAW", () => {
  const fixture = trustedFixture("candidate-0351-independent");
  const profile = structuredClone(
    syntheticCandidateProfile("candidate-0351-independent")
  );
  const master = profile.education.find((item) => item.level === "MASTER")!;
  (master as { program_type?: string }).program_type = "OTHER";
  (master.normalized_program_codes as string[]).splice(
    0,
    master.normalized_program_codes.length
  );
  const batch = fixture.chain.candidate_evidence.materialize_synthetic_fixture({
    candidate_profile: profile,
    observed_at: OBSERVED_AT
  });
  const evidence = credentialEvidence(batch.evidence, "MASTER");

  assert.equal(evidence.value.credential.program_type, "OTHER");
  assert.deepEqual(evidence.value.credential.normalized_program_codes, []);
  assert.equal(
    evidence.value.credential.program_directory_references?.[0]?.program_code,
    "0351"
  );
});

test("CandidateProfile claims cannot self-upgrade to verified evidence", () => {
  const fixture = trustedFixture("candidate-claimed");
  const profile = structuredClone(syntheticCandidateProfile("candidate-claimed"));
  for (const credential of profile.education) {
    (credential as { provenance: string }).provenance = "DOCUMENT_VERIFIED";
  }
  const batch = fixture.chain.candidate_evidence.materialize_claimed({
    candidate_profile: profile,
    observed_at: OBSERVED_AT
  });

  assert.equal(batch.provenance, "CANDIDATE_ASSERTED");
  assert.ok(batch.evidence.every((item) => {
    return item.provenance === "CANDIDATE_ASSERTED"
      && item.observation_status === "INSUFFICIENT"
      && item.source_references.every((reference) => {
        return reference.evidence_class === "CANDIDATE_ASSERTED"
          && reference.issuer === "candidate-profile-claim";
      });
  }));
  assert.ok(batch.evidence.filter((item) => {
    return item.value?.kind === "EDUCATION_CREDENTIAL";
  }).every((item) => {
    return item.value?.kind === "EDUCATION_CREDENTIAL"
      && item.value.credential.provenance === "CANDIDATE_ASSERTED";
  }));
  assert.deepEqual(
    Object.keys(fixture.chain.candidate_evidence).sort(),
    ["materialize_claimed", "materialize_synthetic_fixture", "resolve"]
  );
});

test("claimed evidence remains insufficient through PredicateResolution", () => {
  const context = materializeTrustedChain(trustedFixture("candidate-claimed-h"));
  const claimed = context.fixture.chain.candidate_evidence.materialize_claimed({
    candidate_profile: syntheticCandidateProfile("candidate-claimed-h"),
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
  assert.ok(result.status === "RESOLUTION_SET");
  assert.equal(result.resolutions[0]?.resolution_status, "INSUFFICIENT");
  assert.notEqual(result.resolutions[0]?.resolution_status, "RESOLVED_NOT_MATCH");
});

test("Candidate Evidence materialization is idempotent and resolver snapshots are isolated", () => {
  const fixture = trustedFixture("candidate-isolation");
  const profile = syntheticCandidateProfile("candidate-isolation");
  const command = { candidate_profile: profile, observed_at: OBSERVED_AT };
  const first = fixture.chain.candidate_evidence.materialize_synthetic_fixture(command);
  const second = fixture.chain.candidate_evidence.materialize_synthetic_fixture(command);
  assert.deepEqual(second.evidence_ids, first.evidence_ids);
  assert.deepEqual(second.evidence, first.evidence);

  const masterId = credentialEvidence(first.evidence, "MASTER")
    .predicate_candidate_evidence_id;
  const trustedBefore = fixture.chain.candidate_evidence.resolve(masterId)!;
  const profileMaster = profile.education.find((item) => item.level === "MASTER")!;
  (profileMaster.institution.original as { text: string }).text = "caller mutation";
  const returnedMaster = credentialEvidence(first.evidence, "MASTER");
  (returnedMaster.value.credential.program_name.original as { text: string }).text =
    "returned batch mutation";
  const resolverMaster = fixture.chain.candidate_evidence.resolve(masterId)!;
  assert.ok(resolverMaster.value?.kind === "EDUCATION_CREDENTIAL");
  (resolverMaster.value.credential.institution.original as { text: string }).text =
    "resolver mutation";

  const trustedAfter = fixture.chain.candidate_evidence.resolve(masterId);
  assert.deepEqual(trustedAfter, trustedBefore);
  assert.equal(
    trustedAfter?.value?.kind === "EDUCATION_CREDENTIAL"
      ? trustedAfter.value.credential.institution.original.text
      : null,
    "武汉大学"
  );
});

test("caller evidence objects and unknown evidence IDs cannot enter H or I", () => {
  const context = materializeTrustedChain(trustedFixture("candidate-injection"));
  const trusted = materializeSyntheticCandidateEvidence(
    context.fixture,
    "candidate-injection"
  );
  const forged = structuredClone(trusted.evidence[0]!);
  (forged as { predicate_candidate_evidence_id: string })
    .predicate_candidate_evidence_id = "predicate-candidate-evidence:caller-forged";
  const hCommand = {
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: [forged.predicate_candidate_evidence_id],
    candidate_evidence: [forged],
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  };
  const predicateResult = context.fixture.chain.predicate_resolutions.materialize(
    hCommand
  );
  assert.equal(predicateResult.status, "BLOCKED");

  const assessmentResult = context.fixture.chain.eligibility_assessments.materialize({
    ...hCommand,
    predicate_resolution_ids: [],
    assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  });
  assert.equal(assessmentResult.status, "NOT_ALLOWED");
});

test("synthetic provenance remains explicit in PredicateResolution and Assessment", () => {
  const context = materializeTrustedChain(trustedFixture("candidate-audit"));
  const evidence = materializeSyntheticCandidateEvidence(
    context.fixture,
    "candidate-audit"
  );
  const predicateResult = context.fixture.chain.predicate_resolutions.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidence.evidence_ids,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION
  });
  assert.ok(predicateResult.status === "RESOLUTION_SET");
  assert.ok(predicateResult.resolutions.flatMap((resolution) => {
    return resolution.candidate_evidence_references;
  }).every((reference) => reference.provenance === "SYNTHETIC_TEST"));

  const assessmentResult = context.fixture.chain.eligibility_assessments.materialize({
    opportunity_version_id: context.fixture.opportunity_version_id,
    source_composition_id: context.sourceComposition.source_composition_id,
    requirement_set_version_id: context.requirementSet.requirement_set_version_id,
    predicate_resolution_ids: predicateResult.resolutions.map((resolution) => {
      return resolution.predicate_resolution_id;
    }),
    candidate_profile_id: CANDIDATE_ID,
    candidate_evidence_ids: evidence.evidence_ids,
    as_of: AS_OF,
    predicate_rule_version: PREDICATE_RESOLUTION_RULE_VERSION,
    assessment_rule_version: ELIGIBILITY_ASSESSMENT_RULE_VERSION
  });
  assert.ok(assessmentResult.status === "ASSESSMENT");
  assert.ok(assessmentResult.assessment.decision_basis.candidate_evidence.every(
    (reference) => reference.provenance === "SYNTHETIC_TEST"
  ));
});

test("fake Candidate Evidence resolvers and public resolver replacement are rejected", () => {
  assert.throws(
    () => assertTrustedCandidateEvidenceResolver({ resolve: () => null }),
    (error: unknown) => error instanceof Error
      && error.name === "TrustedCandidateEvidenceError"
      && "code" in error
      && error.code === "UNSUPPORTED_AUTHORITY"
  );

  const fixture = trustedFixture("candidate-authority");
  assert.throws(() => {
    (fixture.chain.candidate_evidence as {
      resolve(id: string): PredicateCandidateEvidence | null;
    }).resolve = () => null;
  }, TypeError);
});

function credentialEvidence(
  evidence: readonly PredicateCandidateEvidence[],
  level: "BACHELOR" | "MASTER"
) {
  const matched = evidence.find((item): item is PredicateCandidateEvidence & {
    readonly value: Extract<
      NonNullable<PredicateCandidateEvidence["value"]>,
      { readonly kind: "EDUCATION_CREDENTIAL" }
    >;
  } => {
    return item.value?.kind === "EDUCATION_CREDENTIAL"
      && item.value.credential.level === level;
  });
  assert.ok(matched);
  return matched;
}
