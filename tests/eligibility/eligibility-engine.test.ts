import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicEligibilityEngine,
  EligibilityInputError,
  UTF8_TEXT_ENCODING,
  type AcademicProgramCode,
  type CandidateProfile,
  type CandidateProfileId,
  type IsoDateTime,
  type LogicGroupId,
  type OpportunityVersion,
  type OpportunityVersionId,
  type RequirementEvidence,
  type RequirementEvidenceId,
  type RequirementFact,
  type RequirementFactId,
  type RequirementSubjectScope,
  type SemanticHash,
  type SnapshotId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

const opportunityVersionId = branded<OpportunityVersionId>("opportunity-version-eligibility");
const assessedAt = branded<IsoDateTime>("2026-09-01T12:00:00+08:00");

const opportunityVersion: OpportunityVersion = {
  opportunity_version_id: opportunityVersionId,
  canonical_opportunity_id: branded("canonical-eligibility"),
  revision: 1,
  semantic_hash: branded<SemanticHash>("semantic-eligibility"),
  content: {
    organization: {
      name: {
        original: { text: "示例研究院", encoding: UTF8_TEXT_ENCODING }
      }
    },
    title: {
      original: { text: "法律事务岗", encoding: UTF8_TEXT_ENCODING }
    },
    locations: []
  },
  source_occurrence_version_ids: [branded("source-version-eligibility")],
  effective_from: assessedAt
};

function candidate(
  qualificationStatus: "OBTAINED" | "PASSED_PENDING_CERTIFICATE"
    | "NOT_OBTAINED" | "UNKNOWN" = "UNKNOWN",
  masterCodes: readonly AcademicProgramCode[] = [
    "JURIS_MASTER",
    "JURIS_MASTER_NON_LAW"
  ]
): CandidateProfile {
  return {
    candidate_profile_id: branded<CandidateProfileId>("candidate-wuhan-jm-non-law-2027"),
    education: [
      {
        level: "BACHELOR",
        institution: {
          original: { text: "示例本科院校", encoding: UTF8_TEXT_ENCODING }
        },
        program_name: {
          original: { text: "经济学", encoding: UTF8_TEXT_ENCODING }
        },
        normalized_program_codes: [],
        academic_background: "NON_LAW",
        graduation_year: 2024
      },
      {
        level: "MASTER",
        institution: {
          original: { text: "武汉大学", encoding: UTF8_TEXT_ENCODING }
        },
        program_name: {
          original: { text: "法律硕士（非法学）", encoding: UTF8_TEXT_ENCODING }
        },
        normalized_program_codes: masterCodes,
        academic_background: "NON_LAW",
        graduation_year: 2027
      }
    ],
    target_graduation_year: 2027,
    professional_qualifications: [{
      qualification_code: "LEGAL_PROFESSIONAL_QUALIFICATION",
      status: qualificationStatus,
      name: {
        original: { text: "法律职业资格", encoding: UTF8_TEXT_ENCODING }
      }
    }],
    languages: []
  };
}

interface FactOptions {
  readonly code: string;
  readonly scope?: RequirementSubjectScope;
  readonly group?: string;
  readonly group_operator?: "AND" | "OR";
  readonly certainty?: RequirementFact["certainty"];
  readonly dimension?: RequirementFact["dimension"];
  readonly operator?: RequirementFact["operator"];
}

function fact(id: string, options: FactOptions): RequirementFact {
  return {
    requirement_fact_id: branded<RequirementFactId>(id),
    opportunity_version_id: opportunityVersionId,
    dimension: options.dimension ?? "MAJOR",
    operator: options.operator ?? "EQUALS",
    value: { kind: "CODE", code: options.code },
    subject_scope: options.scope ?? "MASTER",
    logic_group: {
      logic_group_id: branded<LogicGroupId>(options.group ?? `group-${id}`),
      operator: options.group_operator ?? "AND"
    },
    polarity: "POSITIVE",
    certainty: options.certainty ?? "EXPLICIT",
    parser_version: "deterministic-requirement-parser/1.0.0"
  };
}

function evidence(requirementFact: RequirementFact): RequirementEvidence {
  return {
    requirement_evidence_id: branded<RequirementEvidenceId>(
      `evidence-${requirementFact.requirement_fact_id}`
    ),
    requirement_fact_id: requirementFact.requirement_fact_id,
    snapshot_id: branded<SnapshotId>("snapshot-eligibility"),
    locator: { field_path: "raw_requirement_text", start_offset: 0, end_offset: 18 },
    evidence_text: {
      text: "招聘公告中的中文原始条件",
      encoding: UTF8_TEXT_ENCODING
    },
    extractor_name: "fixture-extractor",
    extractor_version: "1.0.0",
    parser_version: requirementFact.parser_version
  };
}

function evaluate(
  facts: readonly RequirementFact[],
  profile: CandidateProfile = candidate(),
  evidenceItems: readonly RequirementEvidence[] = facts.map(evidence)
) {
  return new DeterministicEligibilityEngine().evaluate({
    opportunity_version: opportunityVersion,
    requirement_facts: facts,
    requirement_evidence: evidenceItems,
    candidate_profile: profile,
    assessed_at: assessedAt
  });
}

test("explicit 法律硕士（非法学） master requirement is ELIGIBLE with evidence", () => {
  const requirement = fact("fact-explicit-jm-non-law", {
    code: "JURIS_MASTER_NON_LAW"
  });
  const assessment = evaluate([requirement]);

  assert.equal(assessment.result, "ELIGIBLE");
  assert.deepEqual(assessment.requirement_fact_ids, [requirement.requirement_fact_id]);
  assert.deepEqual(assessment.evidence_ids, [evidence(requirement).requirement_evidence_id]);
  assert.ok(assessment.reason_codes.includes("REQUIREMENT_SATISFIED"));
});

test("master 法学、法律 alternatives are not treated as explicit JM non-law acceptance", () => {
  const lawStudies = fact("fact-master-law-studies", {
    code: "LAW_STUDIES",
    group: "group-master-law-or-law-studies",
    group_operator: "OR"
  });
  const law = fact("fact-master-law", {
    code: "LAW",
    group: "group-master-law-or-law-studies",
    group_operator: "OR"
  });
  const assessment = evaluate([lawStudies, law]);

  assert.equal(assessment.result, "INELIGIBLE");
  assert.ok(assessment.reason_codes.includes("REQUIREMENT_NOT_SATISFIED"));
});

test("bachelor law restriction makes the non-law bachelor candidate INELIGIBLE", () => {
  const assessment = evaluate([fact("fact-bachelor-law", {
    code: "LAW_STUDIES",
    scope: "BACHELOR"
  })]);

  assert.equal(assessment.result, "INELIGIBLE");
});

test("bachelor-and-master law requirements remain AND and are INELIGIBLE", () => {
  const bachelor = fact("fact-both-bachelor-law", {
    code: "LAW_STUDIES",
    scope: "BACHELOR",
    group: "group-bachelor-and-master-law"
  });
  const master = fact("fact-both-master-law", {
    code: "LAW_STUDIES",
    scope: "MASTER",
    group: "group-bachelor-and-master-law"
  });

  assert.equal(evaluate([bachelor, master]).result, "INELIGIBLE");
});

test("法律、法学、知识产权 alternatives are evaluated as OR, not AND", () => {
  const alternatives = [
    fact("fact-law", {
      code: "LAW",
      scope: "ANY_EDUCATION",
      group: "group-related-major-alternatives",
      group_operator: "OR",
      certainty: "AMBIGUOUS"
    }),
    fact("fact-law-studies", {
      code: "LAW_STUDIES",
      scope: "ANY_EDUCATION",
      group: "group-related-major-alternatives",
      group_operator: "OR",
      certainty: "AMBIGUOUS"
    }),
    fact("fact-intellectual-property", {
      code: "INTELLECTUAL_PROPERTY",
      scope: "ANY_EDUCATION",
      group: "group-related-major-alternatives",
      group_operator: "OR",
      certainty: "AMBIGUOUS"
    })
  ];
  const matchingProfile = candidate("UNKNOWN", ["INTELLECTUAL_PROPERTY"]);

  assert.equal(evaluate(alternatives, matchingProfile).result, "LIKELY_ELIGIBLE");
  assert.equal(evaluate(alternatives).result, "LIKELY_INELIGIBLE");
});

test("missing evidence or absent structured requirements requires review", () => {
  const requirement = fact("fact-without-evidence", {
    code: "JURIS_MASTER_NON_LAW"
  });
  const missingEvidence = evaluate([requirement], candidate(), []);
  const noRequirements = evaluate([], candidate(), []);

  assert.equal(missingEvidence.result, "NEEDS_REVIEW");
  assert.ok(missingEvidence.reason_codes.includes("INSUFFICIENT_EVIDENCE"));
  assert.equal(noRequirements.result, "NEEDS_REVIEW");
  assert.notEqual(missingEvidence.result, "ELIGIBLE");
});

test("unknown legal qualification status requires review; known failure is ineligible", () => {
  const qualification = fact("fact-legal-qualification", {
    code: "LEGAL_PROFESSIONAL_QUALIFICATION",
    scope: "CANDIDATE",
    dimension: "PROFESSIONAL_QUALIFICATION",
    operator: "EXISTS"
  });

  assert.equal(evaluate([qualification], candidate("UNKNOWN")).result, "NEEDS_REVIEW");
  assert.equal(evaluate([qualification], candidate("NOT_OBTAINED")).result, "INELIGIBLE");
  assert.equal(evaluate([qualification], candidate("OBTAINED")).result, "ELIGIBLE");
});

test("all five frozen Eligibility results are reachable by deterministic rules", () => {
  const explicitMatch = fact("fact-five-explicit-match", {
    code: "JURIS_MASTER_NON_LAW"
  });
  const ambiguousMatch = fact("fact-five-ambiguous-match", {
    code: "JURIS_MASTER_NON_LAW",
    certainty: "AMBIGUOUS"
  });
  const ambiguousMismatch = fact("fact-five-ambiguous-mismatch", {
    code: "INTELLECTUAL_PROPERTY",
    certainty: "AMBIGUOUS"
  });
  const explicitMismatch = fact("fact-five-explicit-mismatch", {
    code: "LAW_STUDIES",
    scope: "BACHELOR"
  });

  assert.deepEqual(new Set([
    evaluate([explicitMatch]).result,
    evaluate([ambiguousMatch]).result,
    evaluate([], candidate(), []).result,
    evaluate([ambiguousMismatch]).result,
    evaluate([explicitMismatch]).result
  ]), new Set([
    "ELIGIBLE",
    "LIKELY_ELIGIBLE",
    "NEEDS_REVIEW",
    "LIKELY_INELIGIBLE",
    "INELIGIBLE"
  ]));
});

test("assessment identity is deterministic and excludes the assessment timestamp", () => {
  const requirement = fact("fact-deterministic", {
    code: "JURIS_MASTER_NON_LAW"
  });
  const engine = new DeterministicEligibilityEngine();
  const first = evaluate([requirement]);
  const second = engine.evaluate({
    opportunity_version: opportunityVersion,
    requirement_facts: [requirement],
    requirement_evidence: [evidence(requirement)],
    candidate_profile: candidate(),
    assessed_at: branded<IsoDateTime>("2026-09-02T12:00:00+08:00")
  });

  assert.equal(first.eligibility_assessment_id, second.eligibility_assessment_id);
  assert.notEqual(first.assessed_at, second.assessed_at);
});

test("Facts from another OpportunityVersion are rejected", () => {
  const mismatched = {
    ...fact("fact-wrong-opportunity", { code: "JURIS_MASTER_NON_LAW" }),
    opportunity_version_id: branded<OpportunityVersionId>("another-opportunity-version")
  };

  assert.throws(() => evaluate([mismatched]), (error) => {
    return error instanceof EligibilityInputError
      && error.code === "FACT_OPPORTUNITY_MISMATCH";
  });
});

test("orphan Evidence is rejected instead of being silently attached", () => {
  const requirement = fact("fact-present", { code: "JURIS_MASTER_NON_LAW" });
  const orphanFact = fact("fact-orphan", { code: "LAW_STUDIES" });

  assert.throws(() => evaluate([requirement], candidate(), [evidence(orphanFact)]),
    (error) => {
      return error instanceof EligibilityInputError
        && error.code === "EVIDENCE_FACT_MISSING";
    });
});

test("Eligibility consumes structured values and does not inspect Chinese Evidence text", () => {
  const requirement = fact("fact-no-substring", {
    code: "JURIS_MASTER_NON_LAW"
  });
  const misleadingEvidence = {
    ...evidence(requirement),
    evidence_text: {
      text: "此处原文故意写成完全不同的专业名称，判断不得重新解析该字符串。",
      encoding: UTF8_TEXT_ENCODING
    }
  };

  assert.equal(evaluate([requirement], candidate(), [misleadingEvidence]).result,
    "ELIGIBLE");
});

test("P1-09 Eligibility remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});
