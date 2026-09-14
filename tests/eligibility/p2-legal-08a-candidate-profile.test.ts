import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicEligibilityEngine,
  DeterministicRequirementParser,
  EligibilityInputError,
  UTF8_TEXT_ENCODING,
  type CandidateProfile,
  type CandidateProfileId,
  type CompleteRequirementSet,
  type EligibilityAssessment,
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

const parser = new DeterministicRequirementParser();
const assessedAt = branded<IsoDateTime>("2026-09-04T12:00:00+08:00");

test("synthetic CandidateProfile contains only the minimal control schema", () => {
  const profile = candidate();
  assert.deepEqual(Object.keys(profile).sort(), [
    "candidate_cohorts",
    "candidate_profile_id",
    "date_of_birth",
    "education",
    "gender",
    "languages",
    "professional_qualifications",
    "target_graduation_year",
    "work_experience"
  ]);
});

test("synthetic bachelor background is NON_LAW without a fabricated major", () => {
  const bachelor = credential("BACHELOR");
  assert.equal(bachelor.academic_background, "NON_LAW");
  assert.equal(bachelor.program_name.original.text, "NOT_PROVIDED");
});

test("synthetic master program is 法律硕士（非法学）", () => {
  assert.equal(credential("MASTER").program_name.original.text, "法律硕士（非法学）");
});

test("0351 remains an independent directory code", () => {
  assert.equal(credential("MASTER").program_directory_references?.[0]?.program_code,
    "0351");
});

test("master program type is stored independently", () => {
  const master = credential("MASTER");
  assert.equal(master.degree_type, "PROFESSIONAL");
  assert.equal(master.program_type, "LAW_MASTER_NON_LAW");
});

test("Control A projects a complete satisfied assessment to MATCH", () => {
  const assessment = evaluate(complete(
    "学历要求：本科及以上；硕士专业：法律硕士（非法学）；年龄18周岁以上至35周岁以下（截至2026年12月31日）；限男性；招聘对象：应届毕业生；须取得A类法律职业资格证书",
    "学历要求:本科及以上;硕士专业:法律硕士(非法学);年龄18周岁以上至35周岁以下(截至2026年12月31日);限男性;招聘对象:应届毕业生;须取得A类法律职业资格证书"
  ), candidate({ workYears: 0 }));
  assert.equal(project(assessment), "MATCH");
});

test("Control B projects one explicit experience failure to NOT_MATCH", () => {
  const set = complete("2年以上法律实践经验");
  const assessment = evaluate(set, candidate({ workYears: 0 }));
  assert.equal(project(assessment), "NOT_MATCH");
  assert.equal(set.facts[0]?.dimension, "WORK_EXPERIENCE");
});

test("Control C projects unresolved 0351 equivalence to INSUFFICIENT", () => {
  const assessment = evaluate(completeDirectory("研究生专业：0351法律"), candidate());
  assert.equal(project(assessment), "INSUFFICIENT");
});

test("REVIEW_REQUIRED Requirement Set is rejected before assessment creation", () => {
  const parsed = parse("须符合其他全部条件");
  let assessmentCreated = false;
  assert.throws(() => {
    const assessment = new DeterministicEligibilityEngine().evaluate({
      opportunity_version: opportunityVersion,
      // @ts-expect-error The design intentionally rejects non-complete sets.
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

test("0351 does not automatically equal LAW_MASTER_NON_LAW", () => {
  const assessment = evaluate(completeDirectory("研究生专业：0351法律"), candidate());
  assert.equal(assessment.result, "NEEDS_REVIEW");
  assert.equal(assessment.major_equivalence_evidence_ids?.length, 0);
});

test("UNKNOWN candidate data never projects to MATCH", () => {
  const profile = { ...candidate(), gender: "UNKNOWN" as const };
  assert.notEqual(project(evaluate(complete("限男性"), profile)), "MATCH");
});

test("UNKNOWN candidate data never projects to NOT_MATCH", () => {
  const profile = { ...candidate(), gender: undefined };
  assert.notEqual(project(evaluate(complete("限男性"), profile)), "NOT_MATCH");
});

test("CandidateProfile remains separate from Requirement Set", () => {
  const profile = candidate();
  const set = complete("限男性");
  assert.equal("facts" in profile, false);
  assert.equal("education" in set, false);
});

test("P2-LEGAL-08A performs zero network requests", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});

function project(assessment: EligibilityAssessment) {
  if (assessment.result === "ELIGIBLE") return "MATCH" as const;
  if (assessment.result === "INELIGIBLE") return "NOT_MATCH" as const;
  return "INSUFFICIENT" as const;
}

function evaluate(set: CompleteRequirementSet, profile: CandidateProfile) {
  return new DeterministicEligibilityEngine().evaluate({
    opportunity_version: opportunityVersion,
    complete_requirement_set: set,
    candidate_profile: profile,
    assessed_at: assessedAt
  });
}

function complete(original: string, normalized = original) {
  const parsed = parse(original, normalized);
  assert.ok(parsed.complete_requirement_set);
  return parsed.complete_requirement_set;
}

function completeDirectory(original: string) {
  const parsed = parse(original, original.replaceAll("：", ":"), {
    directory_namespace: "external-academic-program-directory",
    directory_version: "2025"
  });
  assert.ok(parsed.complete_requirement_set);
  return parsed.complete_requirement_set;
}

function parse(
  original: string,
  normalized = original,
  directory?: RequirementEvidenceFragment["academic_program_directory"]
) {
  const fragment: RequirementEvidenceFragment = {
    requirement_evidence_fragment_id: branded<RequirementEvidenceFragmentId>(
      `p2-legal-08a-fragment:${original}`
    ),
    extracted_record_id: branded<ExtractedRecordId>("p2-legal-08a-synthetic-record"),
    snapshot_id: branded<SnapshotId>("p2-legal-08a-synthetic-snapshot"),
    locator: { kind: "HTML", selector: "article.synthetic-control" },
    ...(directory ? { academic_program_directory: directory } : {}),
    extractor_name: "p2-legal-08a-synthetic-control",
    extractor_version: "1.0.0",
    parser_version: "p2-legal-08a-synthetic-control/1.0.0",
    observed_value_state: "TEXT",
    original_text: { text: original, encoding: UTF8_TEXT_ENCODING },
    normalized_text: {
      text: normalized,
      unicode_form: "NFKC",
      normalizer_version: "p2-legal-08a-normalizer/1.0.0",
      operations: ["UNICODE_NORMALIZATION", "WIDTH_FOLDING"]
    }
  };
  return parser.parse({
    opportunity_version: opportunityVersion,
    evidence_fragments: [fragment],
    expected_sources: [{
      extracted_record_id: fragment.extracted_record_id,
      snapshot_id: fragment.snapshot_id
    }]
  });
}

function candidate(options: { readonly workYears?: number } = {}): CandidateProfile {
  return {
    candidate_profile_id: branded<CandidateProfileId>("candidate:synthetic-p2-legal-08a"),
    gender: "MALE",
    education: [
      {
        level: "BACHELOR",
        institution: traceable("NOT_PROVIDED"),
        program_name: traceable("NOT_PROVIDED"),
        normalized_program_codes: [],
        degree_type: "ACADEMIC",
        academic_background: "NON_LAW",
        graduation_year: 2024
      },
      {
        level: "MASTER",
        institution: traceable("NOT_PROVIDED"),
        program_name: traceable("法律硕士（非法学）"),
        normalized_program_codes: ["JURIS_MASTER", "JURIS_MASTER_NON_LAW"],
        program_directory_references: [{
          directory_namespace: "external-academic-program-directory",
          directory_version: "2025",
          program_code: "0351"
        }],
        academic_degree_codes: ["MASTER_DEGREE"],
        degree_type: "PROFESSIONAL",
        program_type: "LAW_MASTER_NON_LAW",
        academic_background: "NON_LAW",
        graduation_year: 2027
      }
    ],
    target_graduation_year: 2027,
    candidate_cohorts: ["FRESH_GRADUATE"],
    date_of_birth: branded<IsoDate>("1992-12-31"),
    professional_qualifications: [{
      qualification_code: "LEGAL_PROFESSIONAL_QUALIFICATION",
      qualification_type: "LEGAL_PROFESSIONAL_QUALIFICATION",
      qualification_class: "A",
      status: "OBTAINED",
      name: traceable("A类法律职业资格证书")
    }],
    work_experience: [{ years: options.workYears ?? 5, scope: "法律实践" }],
    languages: []
  };
}

function credential(level: "BACHELOR" | "MASTER") {
  const result = candidate().education.find((item) => item.level === level);
  if (!result) throw new Error(`Missing synthetic ${level} credential`);
  return result;
}

function traceable(text: string) {
  return { original: { text, encoding: UTF8_TEXT_ENCODING } };
}

function branded<Value extends string>(value: string) {
  return value as Value;
}

const opportunityVersion: OpportunityVersion = {
  opportunity_version_id: branded<OpportunityVersionId>("p2-legal-08a-opportunity-version"),
  canonical_opportunity_id: branded("p2-legal-08a-canonical-opportunity"),
  revision: 1,
  semantic_hash: branded<SemanticHash>("p2-legal-08a-semantic-hash"),
  content: {
    organization: { name: traceable("合成测试单位") },
    title: { original: { text: "合成法律岗位", encoding: UTF8_TEXT_ENCODING } },
    locations: []
  },
  source_occurrence_version_ids: [branded("p2-legal-08a-source-version")],
  effective_from: assessedAt
};
