import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateStateAssertionIntegrity,
  candidateStateAssertionHash,
  classifyCandidateStateAssertionSet,
  createCandidateStateAssertion,
  STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES,
  trustedStructuredEngineCapabilities,
  type CandidateProfileId,
  type CandidateStateAssertionId,
  type CandidateStateEvidenceId,
  type IsoDateTime
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

function assertion() {
  return createCandidateStateAssertion({
    candidate_state_assertion_id:
      branded<CandidateStateAssertionId>("candidate-assertion-citizenship"),
    candidate_profile_id: branded<CandidateProfileId>("synthetic-candidate"),
    dimension: "CITIZENSHIP_STATUS",
    state_kind: "CITIZENSHIP",
    value: { kind: "CITIZENSHIP", citizenship_code: "CHINA" },
    state_observation_status: "CONFIRMED",
    observed_at: branded<IsoDateTime>("2026-09-07T00:00:00.000Z"),
    effective_from: branded<IsoDateTime>("2026-09-07T00:00:00.000Z"),
    provenance: "SYNTHETIC_TEST",
    evidence_references: [{
      candidate_state_evidence_id:
        branded<CandidateStateEvidenceId>("candidate-evidence-citizenship"),
      evidence_class: "SYNTHETIC_TEST",
      captured_at: branded<IsoDateTime>("2026-09-07T00:00:00.000Z"),
      issuer: "synthetic-test"
    }],
    schema_version: "candidate-state-assertion/1",
    supersedes_candidate_state_assertion_id: null
  });
}

test("candidate assertion hashes are self-excluding, deterministic, and independently validatable", () => {
  const first = assertion();
  const second = assertion();
  assert.equal(first.candidate_state_assertion_hash,
    second.candidate_state_assertion_hash);
  assert.equal(candidateStateAssertionHash(first), first.candidate_state_assertion_hash);
  assert.equal(assertCandidateStateAssertionIntegrity(first), first);
});

test("candidate assertion hash failures reject input without creating a match conclusion", () => {
  const first = assertion();
  const tampered = {
    ...first,
    value: { kind: "CITIZENSHIP" as const, citizenship_code: "OTHER" }
  };

  assert.throws(() => assertCandidateStateAssertionIntegrity(tampered));
  assert.throws(() => assertCandidateStateAssertionIntegrity({
    ...first,
    candidate_state_assertion_hash:
      "not-a-sha256" as typeof first.candidate_state_assertion_hash
  }));
  assert.throws(() => assertCandidateStateAssertionIntegrity({
    ...first,
    candidate_state_assertion_hash:
      undefined as unknown as typeof first.candidate_state_assertion_hash
  }));
});

test("missing, insufficient, and conflicting candidate facts remain uncertainty", () => {
  assert.equal(classifyCandidateStateAssertionSet([]), "INSUFFICIENT");
  const insufficient = createCandidateStateAssertion({
    ...assertion(),
    value: null,
    state_observation_status: "INSUFFICIENT",
    candidate_state_assertion_hash: undefined
  } as unknown as Parameters<typeof createCandidateStateAssertion>[0]);
  assert.equal(classifyCandidateStateAssertionSet([insufficient]), "INSUFFICIENT");

  const first = assertion();
  const conflicting = createCandidateStateAssertion({
    ...first,
    value: { kind: "CITIZENSHIP", citizenship_code: "OTHER" },
    candidate_state_assertion_hash: undefined
  } as unknown as Parameters<typeof createCandidateStateAssertion>[0]);
  assert.equal(classifyCandidateStateAssertionSet([first, conflicting]),
    "REVIEW_REQUIRED");
});

test("all remaining closed candidate-state kinds stay fact-only and offline", () => {
  const states = [
    {
      dimension: "SERVICE_OR_ENROLMENT_STATUS" as const,
      state_kind: "SERVICE_OR_ENROLMENT_STATUS" as const,
      value: { kind: "SERVICE_OR_ENROLMENT_STATUS" as const, status: "ACTIVE_DUTY" }
    },
    ...[
      "CRIMINAL_SANCTION",
      "DISCIPLINARY_SANCTION",
      "PUBLIC_EMPLOYMENT_DISMISSAL",
      "RECRUITMENT_INTEGRITY_RECORD",
      "OFFICIAL_SERIOUS_DISHONESTY_RECORD"
    ].map((record_kind) => ({
      dimension: "DISQUALIFICATION_RECORD" as const,
      state_kind: "DISQUALIFICATION_RECORD" as const,
      value: {
        kind: "DISQUALIFICATION_RECORD" as const,
        record_kind: record_kind as "CRIMINAL_SANCTION",
        authority: "synthetic-authority",
        jurisdiction: "synthetic-jurisdiction"
      }
    })),
    {
      dimension: "FORMAL_CLEARANCE_DECISION" as const,
      state_kind: "FORMAL_CLEARANCE_DECISION" as const,
      value: {
        kind: "FORMAL_CLEARANCE_DECISION" as const,
        issuer: "synthetic-issuer",
        decision_kind: "fitness",
        decision_status: "PASSED"
      }
    }
  ];

  for (const [index, state] of states.entries()) {
    const fact = createCandidateStateAssertion({
      ...assertion(),
      candidate_state_assertion_id:
        branded<CandidateStateAssertionId>(`candidate-assertion-${index}`),
      dimension: state.dimension,
      state_kind: state.state_kind,
      value: state.value,
      candidate_state_assertion_hash: undefined
    } as unknown as Parameters<typeof createCandidateStateAssertion>[0]);
    assert.equal(assertCandidateStateAssertionIntegrity(fact).provenance,
      "SYNTHETIC_TEST");
    assert.equal("requirement_match" in fact, false);
    assert.equal("eligibility_result" in fact, false);
  }
});

test("an external capability declaration cannot spoof general-predicate engine support", () => {
  const generalCapability = "GENERAL_ELIGIBILITY_PREDICATE_V1" as const;
  assert.equal(STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES.includes(generalCapability), false);
  assert.equal(trustedStructuredEngineCapabilities([generalCapability]).includes(
    generalCapability
  ), false);
  assert.equal(trustedStructuredEngineCapabilities([
    ...STRUCTURED_ELIGIBILITY_ENGINE_CAPABILITIES,
    generalCapability
  ]).includes(generalCapability), false);
});

test("candidate facts cannot create source requirements or candidate conclusions", () => {
  const fact = assertion();
  assert.equal("requirement_predicate_id" in fact, false);
  assert.equal("requirement_match" in fact, false);
  assert.equal("predicate_match" in fact, false);
  assert.equal("eligibility_result" in fact, false);
  assert.equal("source_reference_ids" in fact, false);
  assert.equal(classifyCandidateStateAssertionSet([]), "INSUFFICIENT");
});
