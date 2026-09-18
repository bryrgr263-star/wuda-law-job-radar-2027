import "../helpers/network-guard";
import { readHistoricalEvidenceJson } from "../helpers/historical-evidence";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { RequirementSetCompositionResult } from "../../lib/live-canary/p2-legal-06/guizhou-legal-requirement-set-composer";
import {
  P2_LEGAL_07_INPUT_SNAPSHOT_IDS,
  auditRequirementBlockers
} from "../../lib/live-canary/p2-legal-07/guizhou-requirement-blocker-audit";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composition = readHistoricalEvidenceJson<RequirementSetCompositionResult>("guizhou-requirement-composition");
const actual = auditRequirementBlockers(composition);

test("all 24 composition blockers are audited exactly once", () => {
  assert.equal(composition.composition_blockers.length, 24);
  assert.equal(actual.blocker_total, 24);
  assert.equal(new Set(actual.blocker_audits.map((item) => item.blocker_id)).size, 24);
  assert.equal(new Set(actual.blocker_audits.flatMap((item) => item.observation_ids)).size, 24);
  assert.ok(actual.blocker_audits.every((item) => item.evidence.length > 0));
});

test("the audit does not infer away or remove any blocker", () => {
  assert.equal(actual.completeness_decision.resolved_blocker_count, 0);
  assert.equal(actual.completeness_decision.remaining_blocker_count, 24);
  assert.ok(actual.blocker_audits.every((item) => item.retained_after_audit));
  assert.deepEqual(actual.resolution_classification.resolvable_with_existing_snapshots, []);
});

test("0351 is protected by explicit negative-inference guards", () => {
  assert.equal(actual.negative_inference_guard.observed, "法律（0351）");
  assert.deepEqual(actual.negative_inference_guard.prohibited_equivalences, [
    "法律（0351） != 法律（非法学）",
    "法律（0351） != 法律硕士（非法学）",
    "法律（非法学） != 法律硕士（非法学）"
  ]);
});

test("legal master non-law acceptance remains NOT_CONFIRMED", () => {
  assert.equal(actual.negative_inference_guard.legal_master_non_law_confirmed, "NOT_CONFIRMED");
  const blocker = actual.blocker_audits.find(
    (item) => item.blocker_id === "p2-legal-07-blocker:law-0351-non-law-applicability"
  );
  assert.equal(blocker?.unresolved_reason, "MISSING_EVIDENCE");
  assert.equal(blocker?.additional_official_evidence_required, true);
});

test("the gender restriction remains a blocking DOMAIN_GAP", () => {
  assert.deepEqual(actual.gender_restriction, {
    raw_text: "限男性",
    status: "DOMAIN_GAP_OBSERVED",
    retained: true,
    blocks_requirement_complete: true,
    blocks_eligibility: true
  });
  const blocker = actual.blocker_audits.find(
    (item) => item.blocker_id === "p2-legal-07-blocker:gender-restriction"
  );
  assert.equal(blocker?.unresolved_reason, "DOMAIN_GAP");
  assert.equal(blocker?.evidence[0]?.locator.kind, "SPREADSHEET");
  assert.equal(blocker?.evidence[0]?.raw_text, "限男性");
});

test("bachelor and graduate applicability remains AMBIGUOUS", () => {
  assert.deepEqual(actual.bachelor_graduate_relationship, {
    status: "AMBIGUOUS",
    highest_education_rule_observed: false,
    retained: true
  });
  const blocker = actual.blocker_audits.find(
    (item) => item.blocker_id === "p2-legal-07-blocker:bachelor-graduate-applicability"
  );
  assert.equal(blocker?.unresolved_reason, "SEMANTIC_AMBIGUITY");
  assert.equal(blocker?.additional_official_evidence_required, true);
});

test("all four UNPARSED_CLAUSE blockers remain retained", () => {
  assert.equal(actual.blocker_type_counts.UNPARSED_CLAUSE, 4);
  assert.equal(actual.unresolved_reason_counts.UNPARSED_CLAUSE, 4);
  assert.equal(actual.resolution_classification.unparsed_clause.length, 4);
  assert.ok(actual.blocker_audits.filter(
    (item) => item.blocker_type === "UNPARSED_CLAUSE"
  ).every((item) => item.retained_after_audit));
});

test("the audit preserves original blocker counts and classifies their root causes", () => {
  assert.equal(actual.blocker_type_counts.AMBIGUOUS, 5);
  assert.equal(actual.blocker_type_counts.UNPARSED_CLAUSE, 4);
  assert.equal(actual.blocker_type_counts.DOMAIN_GAP_OBSERVED, 15);
  assert.equal(actual.unresolved_reason_counts.DOMAIN_GAP, 17);
  assert.equal(actual.unresolved_reason_counts.SEMANTIC_AMBIGUITY, 2);
  assert.equal(actual.unresolved_reason_counts.MISSING_EVIDENCE, 1);
});

test("REVIEW_REQUIRED correctly prevents COMPLETE", () => {
  assert.equal(actual.completeness_decision.status, "REVIEW_REQUIRED");
  assert.equal(actual.completeness_decision.complete, false);
  assert.equal(actual.completeness_decision.remaining_blocker_ids.length, 24);
  assert.ok(actual.blocker_audits.every((item) => item.blocks_requirement_complete));
});

test("REVIEW_REQUIRED correctly prevents Eligibility", () => {
  assert.equal(actual.eligibility_gate.status, "NOT_ALLOWED");
  assert.equal(actual.eligibility_gate.eligibility_executed, false);
  assert.ok(actual.blocker_audits.every((item) => item.blocks_eligibility));
});

test("the audit is limited to the two sealed Snapshots and performs zero network requests", () => {
  assert.deepEqual([...actual.input_snapshot_ids].sort(), [...P2_LEGAL_07_INPUT_SNAPSHOT_IDS].sort());
  assert.equal(actual.network_requests, 0);
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-07/guizhou-requirement-blocker-audit.ts"
  ), "utf8");
  assert.doesNotMatch(source, /globalThis\.fetch|node:(?:http|https|net|tls|dns)/u);
});

test("the audit creates neither CandidateProfile nor EligibilityAssessment", () => {
  assert.deepEqual(actual.downstream_objects_created, {
    candidate_profile: 0,
    eligibility_assessment: 0
  });
  assert.equal("candidate_profile" in actual, false);
  assert.equal("eligibility_assessment" in actual, false);
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/live-canary/p2-legal-07/guizhou-requirement-blocker-audit.ts"
  ), "utf8");
  assert.doesNotMatch(source, /EligibilityEngine|new\s+CandidateProfile|new\s+EligibilityAssessment/u);
});
