import { createHash } from "node:crypto";

import type {
  AcademicProgramDirectoryReference,
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
  "deterministic-eligibility-engine/2.0.0";

type PredicateOutcome = "SATISFIED" | "NOT_SATISFIED" | "UNKNOWN";
type ApplicabilityOutcome = "APPLIES" | "DOES_NOT_APPLY" | "UNKNOWN";

interface EvaluatedFact {
  readonly fact: RequirementFact;
  readonly outcome: PredicateOutcome;
  readonly applicability: ApplicabilityOutcome;
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

    const requirementSet = input.complete_requirement_set;
    const evaluatedFacts = requirementSet.facts.map((fact): EvaluatedFact => {
      const applicability = evaluateApplicability(fact, input.candidate_profile);
      return {
        fact,
        applicability,
        outcome: applicability === "DOES_NOT_APPLY"
          ? "SATISFIED"
          : applicability === "UNKNOWN"
            ? "UNKNOWN"
            : evaluateFact(fact, input.candidate_profile)
      };
    });
    const conflicts = findConflicts(requirementSet.facts);
    const groups = evaluateGroups(evaluatedFacts);
    const result = selectResult(evaluatedFacts, groups, conflicts);
    const reasonCodes = selectReasonCodes(evaluatedFacts, groups, conflicts, result);
    const evidenceIds = requirementSet.evidence
      .map((item) => item.requirement_evidence_id)
      .sort();
    const assessmentBase = {
      eligibility_assessment_id: assessmentId(input),
      candidate_profile_id: input.candidate_profile.candidate_profile_id,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      reason_codes: asNonEmpty(reasonCodes),
      requirement_fact_ids: requirementSet.facts
        .map((fact) => fact.requirement_fact_id)
        .sort(),
      engine_version: DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION,
      parser_versions: [...new Set(requirementSet.facts
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
  const requirementSet = input.complete_requirement_set;
  if (requirementSet.completeness.status !== "COMPLETE"
      || requirementSet.completeness.blockers.length !== 0) {
    throw new EligibilityInputError(
      "REQUIREMENT_SET_INCOMPLETE",
      "Eligibility accepts only a blocker-free COMPLETE Requirement Set"
    );
  }
  if (requirementSet.opportunity_version_id
      !== input.opportunity_version.opportunity_version_id) {
    throw new EligibilityInputError(
      "REQUIREMENT_SET_OPPORTUNITY_MISMATCH",
      "Requirement Set belongs to another OpportunityVersion"
    );
  }
  if (requirementSet.requirement_set_id
      !== requirementSet.completeness.requirement_set_id) {
    throw new EligibilityInputError(
      "REQUIREMENT_SET_CONTENT_MISMATCH",
      "Requirement Set identity differs from its completeness record"
    );
  }

  for (const fact of requirementSet.facts) {
    if (fact.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id) {
      throw new EligibilityInputError(
        "FACT_OPPORTUNITY_MISMATCH",
        `RequirementFact ${fact.requirement_fact_id} belongs to another OpportunityVersion`
      );
    }
  }

  const actualFactIds = requirementSet.facts
    .map((fact) => fact.requirement_fact_id)
    .sort();
  requireExactIds(
    actualFactIds,
    requirementSet.completeness.fact_ids,
    "REQUIREMENT_SET_FACT_MISMATCH",
    "Requirement Facts do not exactly match the complete set"
  );
  const factIds = new Set(actualFactIds);
  const evidenceByFact = groupEvidenceByFact(requirementSet.evidence);
  for (const evidence of requirementSet.evidence) {
    if (!factIds.has(evidence.requirement_fact_id)) {
      throw new EligibilityInputError(
        "EVIDENCE_FACT_MISSING",
        `RequirementEvidence ${evidence.requirement_evidence_id} references an unavailable RequirementFact`
      );
    }
  }
  for (const factId of actualFactIds) {
    if ((evidenceByFact.get(factId)?.length ?? 0) === 0) {
      throw new EligibilityInputError(
        "REQUIREMENT_SET_EVIDENCE_MISMATCH",
        `RequirementFact ${factId} has no evidence in the complete set`
      );
    }
  }
  requireExactIds(
    requirementSet.evidence.map((item) => item.requirement_evidence_id).sort(),
    requirementSet.completeness.evidence_ids,
    "REQUIREMENT_SET_EVIDENCE_MISMATCH",
    "Requirement Evidence does not exactly match the complete set"
  );

  const fragmentIds = new Set(requirementSet.evidence_fragments.map((fragment) => {
    return fragment.requirement_evidence_fragment_id;
  }));
  for (const observation of requirementSet.observations) {
    if (observation.opportunity_version_id
        !== input.opportunity_version.opportunity_version_id
        || observation.status !== "CONFIRMED_REQUIREMENT") {
      throw new EligibilityInputError(
        "REQUIREMENT_SET_OBSERVATION_MISMATCH",
        "A complete set contains an unresolved or cross-opportunity Observation"
      );
    }
    if (observation.clause_role === "MANDATORY"
        && observation.requirement_fact_ids.length === 0) {
      throw new EligibilityInputError(
        "REQUIREMENT_SET_OBSERVATION_MISMATCH",
        "A mandatory Observation in a complete set must produce a Fact"
      );
    }
    if (observation.requirement_fact_ids.some((factId) => !factIds.has(factId))
        || observation.evidence_fragment_ids.some((fragmentId) => {
          return !fragmentIds.has(fragmentId);
        })) {
      throw new EligibilityInputError(
        "REQUIREMENT_SET_OBSERVATION_MISMATCH",
        "Observation references are outside the complete set"
      );
    }
  }
  requireExactIds(
    requirementSet.observations
      .map((observation) => observation.requirement_observation_id)
      .sort(),
    requirementSet.completeness.observation_ids,
    "REQUIREMENT_SET_OBSERVATION_MISMATCH",
    "Requirement Observations do not exactly match the complete set"
  );

  requireExactIds(
    uniqueSorted(requirementSet.evidence_fragments.map((fragment) => {
      return fragment.extracted_record_id;
    })),
    requirementSet.completeness.covered_extracted_record_ids,
    "REQUIREMENT_SET_CONTENT_MISMATCH",
    "Covered ExtractedRecord IDs do not match the evidence fragments"
  );
  requireExactIds(
    uniqueSorted(requirementSet.evidence_fragments.map((fragment) => {
      return fragment.snapshot_id;
    })),
    requirementSet.completeness.covered_snapshot_ids,
    "REQUIREMENT_SET_CONTENT_MISMATCH",
    "Covered Snapshot IDs do not match the evidence fragments"
  );

  const contentHash = requirementSetContentHash(requirementSet);
  if (contentHash !== requirementSet.completeness.requirement_set_content_hash
      || requirementSet.requirement_set_id !== `requirement-set:${contentHash}`) {
    throw new EligibilityInputError(
      "REQUIREMENT_SET_CONTENT_MISMATCH",
      "Requirement Set content changed after completeness evaluation"
    );
  }
}

function requireExactIds(
  actual: readonly string[],
  expected: readonly string[],
  code: ConstructorParameters<typeof EligibilityInputError>[0],
  message: string
) {
  if (new Set(actual).size !== actual.length
      || new Set(expected).size !== expected.length
      || actual.length !== expected.length
      || actual.some((value, index) => value !== [...expected].sort()[index])) {
    throw new EligibilityInputError(code, message);
  }
}

function requirementSetContentHash(
  requirementSet: EligibilityEvaluationInput["complete_requirement_set"]
) {
  const completeness = requirementSet.completeness;
  return sha256(stableSerialize({
    opportunity_version_id: requirementSet.opportunity_version_id,
    evidence_fragments: requirementSet.evidence_fragments,
    observations: requirementSet.observations,
    facts: requirementSet.facts,
    evidence: requirementSet.evidence,
    covered_extracted_record_ids: completeness.covered_extracted_record_ids,
    covered_snapshot_ids: completeness.covered_snapshot_ids,
    observation_ids: completeness.observation_ids,
    fact_ids: completeness.fact_ids,
    evidence_ids: completeness.evidence_ids,
    gate_version: completeness.gate_version,
    parser_version: requirementSet.parser_version
  }));
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

function evaluateApplicability(
  fact: RequirementFact,
  candidate: CandidateProfile
): ApplicabilityOutcome {
  if (!fact.applicability) return "APPLIES";
  const actual = candidate.candidate_cohorts;
  if (!actual || actual.length === 0) return "UNKNOWN";
  const candidateCodes = new Set(actual);
  const required = fact.applicability.candidate_cohorts;
  const applies = fact.applicability.operator === "ALL_OF"
    ? required.every((code) => candidateCodes.has(code))
    : required.some((code) => candidateCodes.has(code));
  return applies ? "APPLIES" : "DOES_NOT_APPLY";
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
    return {
      outcome: operator === "OR" ? evaluateOr(outcomes) : evaluateAnd(outcomes),
      is_certain: group.every((item) => {
        return item.applicability === "DOES_NOT_APPLY"
          || item.fact.certainty === "EXPLICIT";
      })
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
  if (groups.some((group) => group.outcome === "UNKNOWN")) return "NEEDS_REVIEW";
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
  if (facts.length === 0) codes.add("INSUFFICIENT_EVIDENCE");
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
  if (fact.dimension === "ACADEMIC_DEGREE") {
    return evaluateAcademicDegree(fact, candidate.education);
  }
  if (fact.dimension === "AGE") {
    return evaluateAge(fact, candidate.date_of_birth);
  }
  if (fact.dimension === "CANDIDATE_COHORT") {
    return compareStrings(fact, candidate.candidate_cohorts ?? []);
  }
  if (fact.dimension === "HOUSEHOLD_REGISTRATION") {
    return compareStrings(fact, candidate.household_registration_codes ?? []);
  }
  if (fact.dimension === "STUDENT_ORIGIN") {
    return compareStrings(fact, candidate.student_origin_codes ?? []);
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
  if (fact.value.code === "GRADUATE") {
    const matches = education.some((credential) => {
      return credential.level === "MASTER" || credential.level === "DOCTOR";
    });
    return applyNegativeOperator(fact.operator, matches);
  }
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
  if (fact.value.kind === "PROGRAM_REFERENCE") {
    return evaluateProgramReference(fact, credentials, fact.value.reference);
  }
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

function evaluateProgramReference(
  fact: RequirementFact,
  credentials: readonly EducationCredential[],
  expected: AcademicProgramDirectoryReference
): PredicateOutcome {
  const references = credentials.flatMap((credential) => {
    return credential.program_directory_references ?? [];
  });
  if (references.length === 0) return "UNKNOWN";
  const matches = references.some((actual) => {
    return actual.directory_namespace === expected.directory_namespace
      && actual.directory_version === expected.directory_version
      && actual.program_code === expected.program_code;
  });
  return applyNegativeOperator(fact.operator, matches);
}

function evaluateAcademicDegree(
  fact: RequirementFact,
  education: readonly EducationCredential[]
): PredicateOutcome {
  const credentials = credentialsForScope(fact, education);
  if (credentials.length === 0) return "UNKNOWN";
  const expected = codesFromValue(fact.value);
  if (expected === null) return "UNKNOWN";
  const known = credentials.filter((credential) => {
    return credential.academic_degree_codes !== undefined;
  });
  if (known.length === 0) return "UNKNOWN";
  const matches = known.some((credential) => {
    const actual = new Set(credential.academic_degree_codes);
    return fact.operator === "ALL_OF"
      ? expected.every((code) => actual.has(code))
      : expected.some((code) => actual.has(code));
  });
  return applyNegativeOperator(fact.operator, matches);
}

function evaluateAge(
  fact: RequirementFact,
  dateOfBirth: string | undefined
): PredicateOutcome {
  if (!dateOfBirth || fact.value.kind !== "AGE") return "UNKNOWN";
  const birth = parseDate(dateOfBirth);
  const reference = parseDate(fact.value.reference_date);
  if (!birth || !reference) return "UNKNOWN";
  let years = reference.year - birth.year;
  if (reference.month < birth.month
      || (reference.month === birth.month && reference.day < birth.day)) {
    years -= 1;
  }
  const matches = fact.operator === "AT_LEAST"
    ? years >= fact.value.years
    : fact.operator === "AT_MOST"
      ? years <= fact.value.years
      : years === fact.value.years;
  return applyNegativeOperator(fact.operator, matches);
}

function parseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
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
  if (fact.subject_scope === "GRADUATE") {
    return education.filter((credential) => {
      return credential.level === "MASTER" || credential.level === "DOCTOR";
    });
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
      subject_scope: fact.subject_scope,
      applicability: fact.applicability
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
    requirement_set_id: input.complete_requirement_set.requirement_set_id,
    requirement_set_content_hash:
      input.complete_requirement_set.completeness.requirement_set_content_hash,
    engine_version: DETERMINISTIC_ELIGIBILITY_ENGINE_VERSION
  }))}` as EligibilityAssessmentId;
}

function uniqueSorted<Value extends string>(values: readonly Value[]) {
  return [...new Set(values)].sort();
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
