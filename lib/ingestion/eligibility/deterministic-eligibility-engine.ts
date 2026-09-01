import { createHash } from "node:crypto";

import type {
  CandidateProfile,
  EducationCredential,
  EligibilityAssessment,
  EligibilityAssessmentId,
  EligibilityConflict,
  EligibilityReasonCode,
  EligibilityResult,
  LogicGroupId,
  NonEmptyReadonlyArray,
  ProfessionalQualification,
  RequirementEvidence,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
  RequirementValue
} from "../domain";
import {
  EligibilityInputError,
  type EligibilityEngine,
  type EligibilityEvaluationInput
} from "./types";

export const DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION =
  "deterministic-eligibility-engine/1.0.0";

type PredicateOutcome = "SATISFIED" | "NOT_SATISFIED" | "UNKNOWN";

interface EvaluatedFact {
  readonly fact: RequirementFact;
  readonly outcome: PredicateOutcome;
  readonly has_evidence: boolean;
}

interface EvaluatedGroup {
  readonly outcome: PredicateOutcome;
  readonly is_certain: boolean;
}

const educationRank = {
  OTHER: 0,
  BACHELOR: 1,
  MASTER: 2,
  DOCTOR: 3
} as const;

export class DeterministicEligibilityEngine implements EligibilityEngine {
  evaluate(input: EligibilityEvaluationInput): EligibilityAssessment {
    validateInput(input);

    const evidenceByFact = groupEvidenceByFact(input.requirement_evidence);
    const evaluatedFacts = input.requirement_facts.map((fact): EvaluatedFact => ({
      fact,
      outcome: evaluateFact(fact, input.candidate_profile),
      has_evidence: (evidenceByFact.get(fact.requirement_fact_id)?.length ?? 0) > 0
    }));
    const conflicts = findConflicts(input.requirement_facts);
    const groups = evaluateGroups(evaluatedFacts);
    const result = selectResult(evaluatedFacts, groups, conflicts);
    const reasonCodes = selectReasonCodes(evaluatedFacts, groups, conflicts, result);
    const evidenceIds = input.requirement_evidence
      .map((item) => item.requirement_evidence_id)
      .sort();
    const assessmentBase = {
      eligibility_assessment_id: assessmentId(input),
      candidate_profile_id: input.candidate_profile.candidate_profile_id,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      reason_codes: asNonEmpty(reasonCodes),
      requirement_fact_ids: input.requirement_facts
        .map((fact) => fact.requirement_fact_id)
        .sort(),
      engine_version: DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION,
      parser_versions: [...new Set(input.requirement_facts
        .map((fact) => fact.parser_version))].sort(),
      unresolved_conflicts: conflicts,
      assessed_at: input.assessed_at
    };

    if (result === "ELIGIBLE") {
      return {
        ...assessmentBase,
        result,
        evidence_ids: asNonEmpty(evidenceIds)
      };
    }
    return {
      ...assessmentBase,
      result,
      evidence_ids: evidenceIds
    };
  }
}

function validateInput(input: EligibilityEvaluationInput) {
  for (const fact of input.requirement_facts) {
    if (fact.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id) {
      throw new EligibilityInputError(
        "FACT_OPPORTUNITY_MISMATCH",
        `RequirementFact ${fact.requirement_fact_id} belongs to another OpportunityVersion`
      );
    }
  }

  const factIds = new Set(input.requirement_facts.map((fact) => {
    return fact.requirement_fact_id;
  }));
  for (const evidence of input.requirement_evidence) {
    if (!factIds.has(evidence.requirement_fact_id)) {
      throw new EligibilityInputError(
        "EVIDENCE_FACT_MISSING",
        `RequirementEvidence ${evidence.requirement_evidence_id} references an unavailable RequirementFact`
      );
    }
  }
}

function groupEvidenceByFact(evidence: readonly RequirementEvidence[]) {
  const grouped = new Map<RequirementFactId, RequirementEvidence[]>();
  for (const item of evidence) {
    const current = grouped.get(item.requirement_fact_id) ?? [];
    current.push(item);
    grouped.set(item.requirement_fact_id, current);
  }
  return grouped;
}

function evaluateGroups(facts: readonly EvaluatedFact[]) {
  const grouped = new Map<LogicGroupId, EvaluatedFact[]>();
  for (const fact of facts) {
    const groupId = fact.fact.logic_group.logic_group_id;
    const current = grouped.get(groupId) ?? [];
    current.push(fact);
    grouped.set(groupId, current);
  }

  return [...grouped.values()].map((group): EvaluatedGroup => {
    const operator = group[0].fact.logic_group.operator;
    const outcomes = group.map((item) => item.outcome);
    const outcome = operator === "OR"
      ? evaluateOr(outcomes)
      : evaluateAnd(outcomes);
    return {
      outcome,
      is_certain: group.every((item) => item.fact.certainty === "EXPLICIT")
    };
  });
}

function evaluateOr(outcomes: readonly PredicateOutcome[]): PredicateOutcome {
  if (outcomes.includes("SATISFIED")) return "SATISFIED";
  if (outcomes.includes("UNKNOWN")) return "UNKNOWN";
  return "NOT_SATISFIED";
}

function evaluateAnd(outcomes: readonly PredicateOutcome[]): PredicateOutcome {
  if (outcomes.includes("NOT_SATISFIED")) return "NOT_SATISFIED";
  if (outcomes.includes("UNKNOWN")) return "UNKNOWN";
  return "SATISFIED";
}

function selectResult(
  facts: readonly EvaluatedFact[],
  groups: readonly EvaluatedGroup[],
  conflicts: readonly EligibilityConflict[]
): EligibilityResult {
  if (conflicts.length > 0 || facts.length === 0) return "NEEDS_REVIEW";
  if (facts.some((fact) => !fact.has_evidence)) return "NEEDS_REVIEW";
  if (groups.some((group) => group.outcome === "UNKNOWN")) {
    return "NEEDS_REVIEW";
  }
  if (groups.some((group) => {
    return group.outcome === "NOT_SATISFIED" && group.is_certain;
  })) return "INELIGIBLE";
  if (groups.some((group) => group.outcome === "NOT_SATISFIED")) {
    return "LIKELY_INELIGIBLE";
  }
  if (groups.some((group) => !group.is_certain)) return "LIKELY_ELIGIBLE";
  return "ELIGIBLE";
}

function selectReasonCodes(
  facts: readonly EvaluatedFact[],
  groups: readonly EvaluatedGroup[],
  conflicts: readonly EligibilityConflict[],
  result: EligibilityResult
): EligibilityReasonCode[] {
  const codes = new Set<EligibilityReasonCode>();
  if (conflicts.length > 0) codes.add("CONFLICTING_REQUIREMENTS");
  if (facts.length === 0 || facts.some((fact) => !fact.has_evidence)) {
    codes.add("INSUFFICIENT_EVIDENCE");
  }
  if (groups.some((group) => !group.is_certain)) {
    codes.add("AMBIGUOUS_REQUIREMENT");
  }
  if (groups.some((group) => group.outcome === "UNKNOWN")) {
    codes.add("MISSING_CANDIDATE_DATA");
  }
  if (result === "ELIGIBLE" || result === "LIKELY_ELIGIBLE") {
    codes.add("REQUIREMENT_SATISFIED");
  }
  if (result === "INELIGIBLE" || result === "LIKELY_INELIGIBLE") {
    codes.add("REQUIREMENT_NOT_SATISFIED");
  }
  if (codes.size === 0) codes.add("INSUFFICIENT_EVIDENCE");
  return [...codes].sort();
}

function evaluateFact(
  fact: RequirementFact,
  candidate: CandidateProfile
): PredicateOutcome {
  const predicate = evaluatePositivePredicate(fact, candidate);
  return fact.polarity === "NEGATIVE" ? invert(predicate) : predicate;
}

function evaluatePositivePredicate(
  fact: RequirementFact,
  candidate: CandidateProfile
): PredicateOutcome {
  if (fact.operator === "UNRESTRICTED"
      || fact.value.kind === "UNRESTRICTED") return "SATISFIED";

  if (fact.dimension === "EDUCATION_LEVEL") {
    return evaluateEducationLevel(fact, candidate.education);
  }
  if (fact.dimension === "MAJOR") {
    return evaluateMajor(fact, candidate.education);
  }
  if (fact.dimension === "PROFESSIONAL_QUALIFICATION") {
    return evaluateQualification(fact, candidate.professional_qualifications);
  }
  if (fact.dimension === "GRADUATION_YEAR") {
    return compareInteger(fact, candidate.target_graduation_year);
  }
  if (fact.dimension === "WORK_EXPERIENCE") {
    return compareInteger(fact, candidate.work_experience_months);
  }
  if (fact.dimension === "LANGUAGE") {
    return compareStrings(fact, candidate.languages);
  }
  if (fact.dimension === "POLITICAL_AFFILIATION") {
    return candidate.political_affiliation === undefined
      ? "UNKNOWN"
      : compareStrings(fact, [candidate.political_affiliation]);
  }
  return "UNKNOWN";
}

function evaluateEducationLevel(
  fact: RequirementFact,
  education: readonly EducationCredential[]
): PredicateOutcome {
  if (education.length === 0 || fact.value.kind !== "CODE") return "UNKNOWN";
  const required = educationRank[fact.value.code as keyof typeof educationRank];
  if (required === undefined) return "UNKNOWN";
  const levels = education.map((credential) => educationRank[credential.level]);
  const matches = fact.operator === "AT_LEAST"
    ? levels.some((level) => level >= required)
    : fact.operator === "AT_MOST"
      ? levels.every((level) => level <= required)
      : levels.some((level) => level === required);
  return applyNegativeOperator(fact.operator, matches);
}

function evaluateMajor(
  fact: RequirementFact,
  education: readonly EducationCredential[]
): PredicateOutcome {
  const credentials = credentialsForScope(fact, education);
  if (credentials.length === 0) return "UNKNOWN";
  const expected = codesFromValue(fact.value);
  if (expected === null) return "UNKNOWN";
  const matchesCredential = (credential: EducationCredential) => {
    const actual = new Set(credential.normalized_program_codes);
    if (fact.operator === "ALL_OF") {
      return expected.every((code) => actual.has(code as never));
    }
    return expected.some((code) => actual.has(code as never));
  };
  const matches = fact.subject_scope === "ALL_EDUCATION"
    ? credentials.every(matchesCredential)
    : credentials.some(matchesCredential);
  return applyNegativeOperator(fact.operator, matches);
}

function credentialsForScope(
  fact: RequirementFact,
  education: readonly EducationCredential[]
) {
  if (fact.subject_scope === "BACHELOR") {
    return education.filter((credential) => credential.level === "BACHELOR");
  }
  if (fact.subject_scope === "MASTER") {
    return education.filter((credential) => credential.level === "MASTER");
  }
  if (fact.subject_scope === "DOCTOR") {
    return education.filter((credential) => credential.level === "DOCTOR");
  }
  return education;
}

function evaluateQualification(
  fact: RequirementFact,
  qualifications: readonly ProfessionalQualification[]
): PredicateOutcome {
  const expected = codesFromValue(fact.value);
  if (expected === null) return "UNKNOWN";
  const relevant = qualifications.filter((qualification) => {
    return expected.includes(qualification.qualification_code);
  });
  if (relevant.length === 0) return "UNKNOWN";
  if (relevant.some((qualification) => {
    return qualification.status === "OBTAINED"
      || qualification.status === "PASSED_PENDING_CERTIFICATE";
  })) return applyNegativeOperator(fact.operator, true);
  if (relevant.every((qualification) => qualification.status === "NOT_OBTAINED")) {
    return applyNegativeOperator(fact.operator, false);
  }
  return "UNKNOWN";
}

function compareInteger(
  fact: RequirementFact,
  actual: number | undefined
): PredicateOutcome {
  if (actual === undefined || fact.value.kind !== "INTEGER") return "UNKNOWN";
  const matches = fact.operator === "AT_LEAST"
    ? actual >= fact.value.value
    : fact.operator === "AT_MOST"
      ? actual <= fact.value.value
      : actual === fact.value.value;
  return applyNegativeOperator(fact.operator, matches);
}

function compareStrings(
  fact: RequirementFact,
  actual: readonly string[]
): PredicateOutcome {
  if (actual.length === 0) return "UNKNOWN";
  const expected = stringsFromValue(fact.value);
  if (expected === null) return "UNKNOWN";
  const actualSet = new Set(actual);
  const matches = fact.operator === "ALL_OF"
    ? expected.every((item) => actualSet.has(item))
    : expected.some((item) => actualSet.has(item));
  return applyNegativeOperator(fact.operator, matches);
}

function codesFromValue(value: RequirementValue): readonly string[] | null {
  if (value.kind === "CODE") return [value.code];
  if (value.kind === "CODE_SET") return value.codes;
  return null;
}

function stringsFromValue(value: RequirementValue): readonly string[] | null {
  if (value.kind === "CODE") return [value.code];
  if (value.kind === "CODE_SET") return value.codes;
  if (value.kind === "TEXT") return [value.value.text];
  return null;
}

function applyNegativeOperator(
  operator: RequirementFact["operator"],
  matches: boolean
): PredicateOutcome {
  const negative = operator === "NOT_EQUALS" || operator === "NONE_OF";
  return negative === matches ? "NOT_SATISFIED" : "SATISFIED";
}

function invert(outcome: PredicateOutcome): PredicateOutcome {
  if (outcome === "SATISFIED") return "NOT_SATISFIED";
  if (outcome === "NOT_SATISFIED") return "SATISFIED";
  return "UNKNOWN";
}

function findConflicts(facts: readonly RequirementFact[]): EligibilityConflict[] {
  const byPredicate = new Map<string, RequirementFact[]>();
  for (const fact of facts) {
    const key = stableSerialize({
      dimension: fact.dimension,
      operator: fact.operator,
      value: fact.value,
      subject_scope: fact.subject_scope
    });
    const current = byPredicate.get(key) ?? [];
    current.push(fact);
    byPredicate.set(key, current);
  }
  return [...byPredicate.entries()].flatMap(([key, group]) => {
    if (new Set(group.map((fact) => fact.polarity)).size < 2) return [];
    return [{
      code: `opposite-polarity:${sha256(key)}`,
      requirement_fact_ids: group.map((fact) => fact.requirement_fact_id).sort(),
      description: "The same structured requirement appears with opposite polarities"
    }];
  });
}

function assessmentId(input: EligibilityEvaluationInput) {
  return `eligibility-assessment:${sha256(stableSerialize({
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    candidate_profile: input.candidate_profile,
    requirement_facts: [...input.requirement_facts].sort(compareFact),
    requirement_evidence: [...input.requirement_evidence].sort(compareEvidence),
    engine_version: DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION
  }))}` as EligibilityAssessmentId;
}

function compareFact(left: RequirementFact, right: RequirementFact) {
  return left.requirement_fact_id.localeCompare(right.requirement_fact_id);
}

function compareEvidence(left: RequirementEvidence, right: RequirementEvidence) {
  return left.requirement_evidence_id.localeCompare(right.requirement_evidence_id);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableSerialize(record[key])}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asNonEmpty<Value>(values: readonly Value[]): NonEmptyReadonlyArray<Value> {
  if (values.length === 0) throw new Error("Expected a non-empty array");
  return values as NonEmptyReadonlyArray<Value>;
}
