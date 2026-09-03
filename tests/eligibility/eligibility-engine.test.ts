import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicEligibilityEngine,
  DeterministicRequirementParser,
  EligibilityInputError,
  UTF8_TEXT_ENCODING,
  type AcademicProgramCode,
  type CandidateProfile,
  type CandidateProfileId,
  type CompleteRequirementSet,
  type ExtractedRecordId,
  type IsoDate,
  type IsoDateTime,
  type OpportunityVersion,
  type OpportunityVersionId,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type SemanticHash,
  type SnapshotId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

const opportunityVersionId = branded<OpportunityVersionId>(
  "opportunity-version-eligibility-v2"
);
const assessedAt = branded<IsoDateTime>("2026-09-01T12:00:00+08:00");

const opportunityVersion: OpportunityVersion = {
  opportunity_version_id: opportunityVersionId,
  canonical_opportunity_id: branded("canonical-eligibility-v2"),
  revision: 1,
  semantic_hash: branded<SemanticHash>("semantic-eligibility-v2"),
  content: {
    organization: {
      name: { original: { text: "示例研究院", encoding: UTF8_TEXT_ENCODING } }
    },
    title: {
      original: { text: "法律事务岗", encoding: UTF8_TEXT_ENCODING }
    },
    locations: []
  },
  source_occurrence_version_ids: [branded("source-version-eligibility-v2")],
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
    candidate_profile_id: branded<CandidateProfileId>(
      "candidate-wuhan-jm-non-law-2027"
    ),
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
        academic_degree_codes: ["BACHELOR_DEGREE"],
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
        program_directory_references: [{
          directory_namespace: "national-academic-program-catalog",
          directory_version: "2022",
          program_code: "0301"
        }],
        academic_degree_codes: ["MASTER_DEGREE"],
        academic_background: "NON_LAW",
        graduation_year: 2027
      }
    ],
    target_graduation_year: 2027,
    date_of_birth: branded<IsoDate>("1992-12-31"),
    candidate_cohorts: ["FRESH_GRADUATE"],
    household_registration_codes: ["北京市"],
    student_origin_codes: ["北京市"],
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

interface SetOptions {
  readonly original: string;
  readonly normalized: string;
  readonly directory?: RequirementEvidenceFragment["academic_program_directory"];
}

function parse(options: SetOptions) {
  const fragment: RequirementEvidenceFragment = {
    requirement_evidence_fragment_id: branded<RequirementEvidenceFragmentId>(
      `fragment-${options.normalized}`
    ),
    extracted_record_id: branded<ExtractedRecordId>("record-eligibility-v2"),
    snapshot_id: branded<SnapshotId>("snapshot-eligibility-v2"),
    locator: {
      kind: "HTML",
      selector: "article.requirements",
      field_path: "requirement_text"
    },
    observed_value_state: "TEXT",
    original_text: { text: options.original, encoding: UTF8_TEXT_ENCODING },
    normalized_text: {
      text: options.normalized,
      unicode_form: "NFKC",
      normalizer_version: "source-normalizer/1.0.0",
      operations: [
        "UNICODE_NORMALIZATION",
        "WIDTH_FOLDING",
        "PUNCTUATION_FOLDING"
      ]
    },
    ...(options.directory ? { academic_program_directory: options.directory } : {}),
    extractor_name: "source-neutral-fragment-builder",
    extractor_version: "1.0.0",
    parser_version: "fragment-contract/1.0.0"
  };
  return new DeterministicRequirementParser().parse({
    opportunity_version: opportunityVersion,
    evidence_fragments: [fragment],
    expected_sources: [{
      extracted_record_id: fragment.extracted_record_id,
      snapshot_id: fragment.snapshot_id
    }]
  });
}

function complete(options: SetOptions): CompleteRequirementSet {
  const parsed = parse(options);
  assert.ok(parsed.complete_requirement_set);
  return parsed.complete_requirement_set;
}

function evaluate(
  requirementSet: CompleteRequirementSet,
  profile: CandidateProfile = candidate(),
  timestamp: IsoDateTime = assessedAt
) {
  return new DeterministicEligibilityEngine().evaluate({
    opportunity_version: opportunityVersion,
    complete_requirement_set: requirementSet,
    candidate_profile: profile,
    assessed_at: timestamp
  });
}

test("explicit 法律硕士（非法学） complete set is ELIGIBLE", () => {
  const requirementSet = complete({
    original: "硕士专业：法律硕士（非法学）",
    normalized: "硕士专业:法律硕士(非法学)"
  });
  const assessment = evaluate(requirementSet);

  assert.equal(assessment.result, "ELIGIBLE");
  assert.deepEqual(assessment.requirement_fact_ids,
    requirementSet.completeness.fact_ids);
  assert.deepEqual(assessment.evidence_ids,
    requirementSet.completeness.evidence_ids);
});

test("法律硕士 is not rewritten to 法律硕士（非法学）", () => {
  const requirementSet = complete({
    original: "硕士专业：法律硕士",
    normalized: "硕士专业:法律硕士"
  });
  const withoutGenericJurisMaster = candidate("UNKNOWN", [
    "JURIS_MASTER_NON_LAW"
  ]);

  assert.deepEqual(requirementSet.facts[0].value, {
    kind: "CODE",
    code: "JURIS_MASTER"
  });
  assert.equal(evaluate(requirementSet, withoutGenericJurisMaster).result,
    "INELIGIBLE");
});

test("master 法学、法律 alternatives remain OR and do not accept a non-law JM", () => {
  const requirementSet = complete({
    original: "硕士专业：法学、法律",
    normalized: "硕士专业:法学、法律"
  });

  assert.ok(requirementSet.facts.every((fact) => {
    return fact.logic_group.operator === "OR";
  }));
  assert.equal(evaluate(requirementSet).result, "INELIGIBLE");
});

test("GRADUATE scope accepts master or doctor without becoming MASTER", () => {
  const requirementSet = complete({
    original: "研究生专业：法学",
    normalized: "研究生专业:法学"
  });
  const doctor: CandidateProfile = {
    ...candidate(),
    education: [{
      level: "DOCTOR",
      institution: {
        original: { text: "示例大学", encoding: UTF8_TEXT_ENCODING }
      },
      program_name: {
        original: { text: "法学", encoding: UTF8_TEXT_ENCODING }
      },
      normalized_program_codes: ["LAW_STUDIES"],
      academic_background: "LAW"
    }]
  };

  assert.equal(requirementSet.facts[0].subject_scope, "GRADUATE");
  assert.equal(evaluate(requirementSet, doctor).result, "ELIGIBLE");
});

test("MASTER scope is not widened to a doctor-only credential", () => {
  const requirementSet = complete({
    original: "硕士专业：法学",
    normalized: "硕士专业:法学"
  });
  const doctor: CandidateProfile = {
    ...candidate(),
    education: [{
      level: "DOCTOR",
      institution: {
        original: { text: "示例大学", encoding: UTF8_TEXT_ENCODING }
      },
      program_name: {
        original: { text: "法学", encoding: UTF8_TEXT_ENCODING }
      },
      normalized_program_codes: ["LAW_STUDIES"],
      academic_background: "LAW"
    }]
  };

  assert.equal(requirementSet.facts[0].subject_scope, "MASTER");
  assert.equal(evaluate(requirementSet, doctor).result, "NEEDS_REVIEW");
});

test("source-neutral directory references match namespace, version, and code exactly", () => {
  const requirementSet = complete({
    original: "研究生专业：0301（法学）",
    normalized: "研究生专业:0301(法学)",
    directory: {
      directory_namespace: "national-academic-program-catalog",
      directory_version: "2022"
    }
  });
  const wrongVersion: CandidateProfile = {
    ...candidate(),
    education: candidate().education.map((credential) => {
      if (credential.level !== "MASTER") return credential;
      return {
        ...credential,
        program_directory_references: [{
          directory_namespace: "national-academic-program-catalog",
          directory_version: "2012",
          program_code: "0301"
        }]
      };
    })
  };

  assert.equal(evaluate(requirementSet).result, "ELIGIBLE");
  assert.equal(evaluate(requirementSet, wrongVersion).result, "INELIGIBLE");
});

test("new degree, age, cohort, household, and student-origin dimensions evaluate deterministically", () => {
  const requirementSet = complete({
    original: "学位要求：硕士学位；年龄不超过35周岁（截至2026年12月31日）；招聘对象：应届毕业生；户籍要求：北京市；生源地要求：北京市",
    normalized: "学位要求:硕士学位;年龄不超过35周岁(截至2026年12月31日);招聘对象:应届毕业生;户籍要求:北京市;生源地要求:北京市"
  });
  const tooOld: CandidateProfile = {
    ...candidate(),
    date_of_birth: branded<IsoDate>("1990-01-01")
  };

  assert.equal(evaluate(requirementSet).result, "ELIGIBLE");
  assert.equal(evaluate(requirementSet, tooOld).result, "INELIGIBLE");
});

test("cohort applicability skips another cohort but unknown cohort requires review", () => {
  const requirementSet = complete({
    original: "应届毕业生须硕士专业：法学",
    normalized: "应届毕业生须硕士专业:法学"
  });
  const socialCandidate: CandidateProfile = {
    ...candidate(),
    candidate_cohorts: ["SOCIAL_CANDIDATE"]
  };
  const unknownCohort: CandidateProfile = {
    ...candidate(),
    candidate_cohorts: undefined
  };

  assert.equal(evaluate(requirementSet, socialCandidate).result, "ELIGIBLE");
  assert.equal(evaluate(requirementSet, unknownCohort).result, "NEEDS_REVIEW");
});

test("unknown qualification status needs review; known failure is ineligible", () => {
  const requirementSet = complete({
    original: "须通过法律职业资格考试",
    normalized: "须通过法律职业资格考试"
  });

  assert.equal(evaluate(requirementSet, candidate("UNKNOWN")).result,
    "NEEDS_REVIEW");
  assert.equal(evaluate(requirementSet, candidate("NOT_OBTAINED")).result,
    "INELIGIBLE");
  assert.equal(evaluate(requirementSet, candidate("OBTAINED")).result,
    "ELIGIBLE");
});

test("incomplete Requirement Set is rejected before any assessment exists", () => {
  const parsed = parse({
    original: "须符合其他全部条件",
    normalized: "须符合其他全部条件"
  });
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
  let assessmentCreated = false;

  assert.throws(() => {
    const assessment = new DeterministicEligibilityEngine().evaluate({
      opportunity_version: opportunityVersion,
      // @ts-expect-error Incomplete sets are intentionally rejected at compile time too.
      complete_requirement_set: parsed.requirement_set,
      candidate_profile: candidate(),
      assessed_at: assessedAt
    });
    assessmentCreated = assessment !== undefined;
  }, (error) => {
    return error instanceof EligibilityInputError
      && error.code === "REQUIREMENT_SET_INCOMPLETE";
  });
  assert.equal(assessmentCreated, false);
});

test("omitting one parsed Fact cannot bypass completeness", () => {
  const requirementSet = complete({
    original: "硕士专业：法律硕士（非法学）；须通过法律职业资格考试",
    normalized: "硕士专业:法律硕士(非法学);须通过法律职业资格考试"
  });
  const tampered = structuredClone(requirementSet);
  Object.defineProperty(tampered, "facts", {
    value: [tampered.facts[0]],
    enumerable: true
  });

  assert.throws(() => evaluate(tampered, candidate("NOT_OBTAINED")), (error) => {
    return error instanceof EligibilityInputError
      && error.code === "REQUIREMENT_SET_FACT_MISMATCH";
  });
});

test("omitting Evidence or changing complete-set content is rejected", () => {
  const requirementSet = complete({
    original: "硕士专业：法律硕士（非法学）",
    normalized: "硕士专业:法律硕士(非法学)"
  });
  const withoutEvidence = structuredClone(requirementSet);
  Object.defineProperty(withoutEvidence, "evidence", {
    value: [],
    enumerable: true
  });
  const changedFact = structuredClone(requirementSet);
  Object.defineProperty(changedFact.facts[0], "operator", {
    value: "NOT_EQUALS",
    enumerable: true
  });

  assert.throws(() => evaluate(withoutEvidence), (error) => {
    return error instanceof EligibilityInputError
      && error.code === "REQUIREMENT_SET_EVIDENCE_MISMATCH";
  });
  assert.throws(() => evaluate(changedFact), (error) => {
    return error instanceof EligibilityInputError
      && error.code === "REQUIREMENT_SET_CONTENT_MISMATCH";
  });
});

test("Requirement Set from another OpportunityVersion is rejected", () => {
  const requirementSet = complete({
    original: "硕士专业：法律硕士（非法学）",
    normalized: "硕士专业:法律硕士(非法学)"
  });
  const otherOpportunity: OpportunityVersion = {
    ...opportunityVersion,
    opportunity_version_id: branded<OpportunityVersionId>("another-opportunity")
  };

  assert.throws(() => new DeterministicEligibilityEngine().evaluate({
    opportunity_version: otherOpportunity,
    complete_requirement_set: requirementSet,
    candidate_profile: candidate(),
    assessed_at: assessedAt
  }), (error) => {
    return error instanceof EligibilityInputError
      && error.code === "REQUIREMENT_SET_OPPORTUNITY_MISMATCH";
  });
});

test("assessment identity is deterministic and excludes assessment timestamp", () => {
  const requirementSet = complete({
    original: "硕士专业：法律硕士（非法学）",
    normalized: "硕士专业:法律硕士(非法学)"
  });
  const first = evaluate(requirementSet);
  const second = evaluate(
    requirementSet,
    candidate(),
    branded<IsoDateTime>("2026-09-02T12:00:00+08:00")
  );

  assert.equal(first.eligibility_assessment_id,
    second.eligibility_assessment_id);
  assert.notEqual(first.assessed_at, second.assessed_at);
});

test("Eligibility consumes structured values and never reparses Evidence text", () => {
  const requirementSet = complete({
    original: "硕士专业：法律硕士（非法学）",
    normalized: "硕士专业:法律硕士(非法学)"
  });
  const changedEvidence = structuredClone(requirementSet);
  Object.defineProperty(changedEvidence.evidence[0], "evidence_text", {
    value: {
      text: "完全不同的专业名称",
      encoding: UTF8_TEXT_ENCODING
    },
    enumerable: true
  });

  assert.throws(() => evaluate(changedEvidence), (error) => {
    return error instanceof EligibilityInputError
      && error.code === "REQUIREMENT_SET_CONTENT_MISMATCH";
  });
  assert.equal(evaluate(requirementSet).result, "ELIGIBLE");
});

test("Requirement V2 Eligibility remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});
