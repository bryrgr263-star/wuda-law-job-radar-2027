import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  type MajorEquivalenceEvidence,
  type OpportunityVersion,
  type OpportunityVersionId,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type RequirementParsingResult,
  type SemanticHash,
  type SnapshotId
} from "../../lib/ingestion";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parser = new DeterministicRequirementParser();
const assessedAt = branded<IsoDateTime>("2026-09-04T12:00:00+08:00");

test("CandidateProfile models gender", () => {
  assert.equal(candidate().gender, "MALE");
});

test("EducationCredential models degree_type independently", () => {
  assert.equal(masterCredential(candidate()).degree_type, "PROFESSIONAL");
});

test("EducationCredential models program_type independently", () => {
  assert.equal(masterCredential(candidate()).program_type, "LAW_MASTER_NON_LAW");
});

test("ProfessionalQualification preserves qualification class", () => {
  assert.equal(candidate().professional_qualifications[0]?.qualification_class, "A");
});

test("CandidateProfile preserves scoped work experience", () => {
  assert.deepEqual(candidate().work_experience, [{ years: 5, scope: "法律实践" }]);
});

test("GENDER evaluates explicit matching and non-matching values", () => {
  const set = complete("限男性");
  assert.equal(evaluate(set).result, "ELIGIBLE");
  assert.equal(evaluate(set, { ...candidate(), gender: "FEMALE" }).result, "INELIGIBLE");
});

test("AGE_RANGE evaluates inclusive lower and upper bounds", () => {
  const set = complete("年龄18周岁以上至35周岁以下（截至2026年12月31日）",
    "年龄18周岁以上至35周岁以下(截至2026年12月31日)");
  assert.equal(evaluate(set).result, "ELIGIBLE");
  assert.equal(evaluate(set, {
    ...candidate(),
    date_of_birth: branded<IsoDate>("1990-01-01")
  }).result, "INELIGIBLE");
});

test("structured EXPERIENCE evaluates years only within the exact scope", () => {
  const set = complete("5年以上法律实践经验");
  assert.equal(evaluate(set).result, "ELIGIBLE");
  assert.equal(evaluate(set, {
    ...candidate(),
    work_experience: [{ years: 10, scope: "财务管理" }]
  }).result, "NEEDS_REVIEW");
  assert.equal(evaluate(set, {
    ...candidate(),
    work_experience: [{ years: 0, scope: "法律实践" }]
  }).result, "INELIGIBLE");
});

test("structured PROFESSIONAL_QUALIFICATION evaluates type and class", () => {
  const set = complete("须取得A类法律职业资格证书");
  assert.equal(evaluate(set).result, "ELIGIBLE");
  assert.equal(evaluate(set, {
    ...candidate(),
    professional_qualifications: [{
      ...candidate().professional_qualifications[0],
      qualification_class: "B"
    }]
  }).result, "INELIGIBLE");
});

test("same directory code remains valid CODE_IDENTITY for legacy untyped data", () => {
  const set = completeDirectory("研究生专业：0351法律");
  const legacy = withMaster(candidate(), {
    program_type: undefined,
    codes: [],
    directoryCode: "0351"
  });
  assert.equal(evaluate(set, legacy).result, "ELIGIBLE");
});

test("MajorEquivalenceEvidence is versioned and explicit", () => {
  assert.deepEqual(explicitEquivalence(), {
    source_namespace: "external-academic-program-directory",
    source_version: "2025",
    from_code: "0351",
    from_program_type: "UNSPECIFIED",
    to_code: "0351",
    to_program_type: "LAW_MASTER_NON_LAW",
    equivalence_status: "EXPLICIT_EQUIVALENT",
    evidence_id: "major-equivalence:synthetic-0351-law-master-non-law",
    evidence_version: "1"
  });
});

test("0351 with a typed candidate and no equivalence evidence is insufficient", () => {
  const set = completeDirectory("研究生专业：0351法律");
  assert.equal(evaluate(set).result, "NEEDS_REVIEW");
});

test("0351 with explicit versioned equivalence evidence matches", () => {
  const set = completeDirectory("研究生专业：0351法律");
  assert.equal(evaluate(set, candidate(), [explicitEquivalence()]).result, "ELIGIBLE");
});

test("explicit NOT_EQUIVALENT evidence produces a deterministic non-match", () => {
  const set = completeDirectory("研究生专业：0351法律");
  const evidence: MajorEquivalenceEvidence = {
    ...explicitEquivalence(),
    equivalence_status: "NOT_EQUIVALENT"
  };
  assert.equal(evaluate(set, candidate(), [evidence]).result, "INELIGIBLE");
});

test("NOT_ESTABLISHED evidence remains insufficient", () => {
  const set = completeDirectory("研究生专业：0351法律");
  const evidence: MajorEquivalenceEvidence = {
    ...explicitEquivalence(),
    equivalence_status: "NOT_ESTABLISHED"
  };
  assert.equal(evaluate(set, candidate(), [evidence]).result, "NEEDS_REVIEW");
});

test("LAW_MASTER_NON_LAW and LAW_NON_LAW remain distinct program types", () => {
  const set = completeDirectory("研究生专业：0351法律", {
    program_type: "LAW_NON_LAW"
  });
  assert.equal(evaluate(set).result, "NEEDS_REVIEW");
  assert.notEqual(masterCredential(candidate()).program_type, "LAW_NON_LAW");
});

test("negative inference guard contains no hard-coded 0351 equivalence", () => {
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/ingestion/eligibility/deterministic-eligibility-engine.ts"
  ), "utf8");
  assert.doesNotMatch(source, /0351|LAW_MASTER_NON_LAW/u);
});

test("unknown CandidateProfile data never becomes an automatic match", () => {
  const set = complete("限男性");
  assert.equal(evaluate(set, { ...candidate(), gender: undefined }).result, "NEEDS_REVIEW");
});

test("REVIEW_REQUIRED Requirement Set remains NOT_ALLOWED", () => {
  const parsed = parse("须符合其他全部条件");
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
  assert.throws(() => new DeterministicEligibilityEngine().evaluate({
    opportunity_version: opportunityVersion,
    // @ts-expect-error Non-complete Requirement Sets are rejected by the public type contract.
    complete_requirement_set: parsed.requirement_set,
    candidate_profile: candidate(),
    assessed_at: assessedAt
  }), (error) => {
    return error instanceof EligibilityInputError
      && error.code === "REQUIREMENT_SET_INCOMPLETE";
  });
});

test("existing Requirement code facts retain compatibility", () => {
  const set = complete("硕士专业：法律硕士（非法学）",
    "硕士专业:法律硕士(非法学)");
  assert.equal(evaluate(set).result, "ELIGIBLE");
});

test("existing persisted CandidateProfile shape remains readable", () => {
  const persisted: CandidateProfile = {
    candidate_profile_id: branded<CandidateProfileId>("candidate:persisted-v1"),
    education: [{
      level: "MASTER",
      institution: traceable("示例大学"),
      program_name: traceable("法律硕士（非法学）"),
      normalized_program_codes: ["JURIS_MASTER_NON_LAW"],
      academic_background: "NON_LAW"
    }],
    professional_qualifications: [],
    languages: []
  };
  assert.equal(persisted.gender, undefined);
  assert.equal(persisted.work_experience, undefined);
});

test("major relationship OR and AND are evaluated without merging scopes", () => {
  const profile = withMaster(candidate(), {
    codes: ["LAW"],
    directoryCode: undefined
  });
  const orSet = complete("本科专业：法学；研究生专业：法律；本科专业要求或研究生专业要求满足其一",
    "本科专业:法学;研究生专业:法律;本科专业要求或研究生专业要求满足其一");
  const andSet = complete("本科专业：法学；研究生专业：法律；本科专业要求与研究生专业要求同时满足",
    "本科专业:法学;研究生专业:法律;本科专业要求与研究生专业要求同时满足");
  assert.equal(evaluate(orSet, profile).result, "ELIGIBLE");
  assert.equal(evaluate(andSet, profile).result, "INELIGIBLE");
});

test("MajorMatchRule exact-code control requires code-bearing candidate data", () => {
  const set = complete("专业代码精确匹配");
  assert.equal(evaluate(set).result, "ELIGIBLE");
  const withoutCodes = withMaster(candidate(), { codes: [], directoryCode: undefined });
  assert.equal(evaluate(set, withoutCodes).result, "NEEDS_REVIEW");
});

test("candidate-cohort applicability remains deterministic", () => {
  const set = complete("应届毕业生须硕士专业：法学",
    "应届毕业生须硕士专业:法学");
  const social = { ...candidate(), candidate_cohorts: ["SOCIAL_CANDIDATE"] as const };
  assert.equal(evaluate(set, social).result, "ELIGIBLE");
  assert.equal(evaluate(set, { ...candidate(), candidate_cohorts: undefined }).result,
    "NEEDS_REVIEW");
});

test("CR#10 performs zero network requests", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});

function evaluate(
  requirementSet: CompleteRequirementSet,
  profile = candidate(),
  equivalenceEvidence: readonly MajorEquivalenceEvidence[] = []
) {
  return new DeterministicEligibilityEngine().evaluate({
    opportunity_version: opportunityVersion,
    complete_requirement_set: requirementSet,
    candidate_profile: profile,
    major_equivalence_evidence: equivalenceEvidence,
    assessed_at: assessedAt
  });
}

function complete(
  original: string,
  normalizedText = original
): CompleteRequirementSet {
  const parsed = parse(original, normalizedText);
  assert.ok(parsed.complete_requirement_set);
  return parsed.complete_requirement_set;
}

function completeDirectory(
  original: string,
  extra: { readonly program_type?: string } = {}
) {
  const parsed = parse(original, original
    .replaceAll("：", ":")
    .replaceAll("（", "(")
    .replaceAll("）", ")"), {
    directory_namespace: "external-academic-program-directory",
    directory_version: "2025",
    ...extra
  });
  assert.ok(parsed.complete_requirement_set);
  return parsed.complete_requirement_set;
}

function parse(
  original: string,
  normalizedText = original,
  directory?: RequirementEvidenceFragment["academic_program_directory"]
): RequirementParsingResult {
  const fragment: RequirementEvidenceFragment = {
    requirement_evidence_fragment_id: branded<RequirementEvidenceFragmentId>(
      `cr10-fragment:${original}`
    ),
    extracted_record_id: branded<ExtractedRecordId>("cr10-synthetic-record"),
    snapshot_id: branded<SnapshotId>("cr10-synthetic-snapshot"),
    locator: {
      kind: "HTML",
      selector: "article.requirements",
      field_path: "requirements"
    },
    ...(directory ? { academic_program_directory: directory } : {}),
    extractor_name: "source-neutral-cr10-control",
    extractor_version: "1.0.0",
    parser_version: "source-neutral-cr10-fragment/1.0.0",
    observed_value_state: "TEXT",
    original_text: { text: original, encoding: UTF8_TEXT_ENCODING },
    normalized_text: {
      text: normalizedText,
      unicode_form: "NFKC",
      normalizer_version: "source-neutral-cr10-normalizer/1.0.0",
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

function candidate(): CandidateProfile {
  return {
    candidate_profile_id: branded<CandidateProfileId>("candidate:synthetic-cr10"),
    gender: "MALE",
    education: [
      {
        level: "BACHELOR",
        institution: traceable("示例本科院校"),
        program_name: traceable("经济学"),
        normalized_program_codes: [],
        academic_degree_codes: ["BACHELOR_DEGREE"],
        degree_type: "ACADEMIC",
        academic_background: "NON_LAW",
        graduation_year: 2024
      },
      {
        level: "MASTER",
        institution: traceable("示例研究生院校"),
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
    date_of_birth: branded<IsoDate>("1992-12-31"),
    candidate_cohorts: ["FRESH_GRADUATE"],
    professional_qualifications: [{
      qualification_code: "LEGAL_PROFESSIONAL_QUALIFICATION",
      qualification_type: "LEGAL_PROFESSIONAL_QUALIFICATION",
      qualification_class: "A",
      status: "OBTAINED",
      name: traceable("A类法律职业资格证书")
    }],
    work_experience: [{ years: 5, scope: "法律实践" }],
    languages: []
  };
}

function withMaster(
  profile: CandidateProfile,
  input: {
    readonly program_type?: "LAW_MASTER_NON_LAW" | "LAW_NON_LAW" | "OTHER";
    readonly codes: readonly AcademicProgramCode[];
    readonly directoryCode?: string;
  }
): CandidateProfile {
  return {
    ...profile,
    education: profile.education.map((credential) => {
      if (credential.level !== "MASTER") return credential;
      return {
        ...credential,
        normalized_program_codes: input.codes,
        ...(input.program_type === undefined
          ? { program_type: undefined }
          : { program_type: input.program_type }),
        program_directory_references: input.directoryCode === undefined
          ? []
          : [{
              directory_namespace: "external-academic-program-directory",
              directory_version: "2025",
              program_code: input.directoryCode
            }]
      };
    })
  };
}

function masterCredential(profile: CandidateProfile) {
  const credential = profile.education.find((item) => item.level === "MASTER");
  if (!credential) throw new Error("Synthetic control requires a master credential");
  return credential;
}

function explicitEquivalence(): MajorEquivalenceEvidence {
  return {
    source_namespace: "external-academic-program-directory",
    source_version: "2025",
    from_code: "0351",
    from_program_type: "UNSPECIFIED",
    to_code: "0351",
    to_program_type: "LAW_MASTER_NON_LAW",
    equivalence_status: "EXPLICIT_EQUIVALENT",
    evidence_id: "major-equivalence:synthetic-0351-law-master-non-law",
    evidence_version: "1"
  };
}

function traceable(text: string) {
  return { original: { text, encoding: UTF8_TEXT_ENCODING } };
}

function branded<Value extends string>(value: string) {
  return value as Value;
}

const opportunityVersion: OpportunityVersion = {
  opportunity_version_id: branded<OpportunityVersionId>("cr10-opportunity-version"),
  canonical_opportunity_id: branded("cr10-canonical-opportunity"),
  revision: 1,
  semantic_hash: branded<SemanticHash>("cr10-semantic-hash"),
  content: {
    organization: { name: traceable("示例单位") },
    title: { original: { text: "法律岗位", encoding: UTF8_TEXT_ENCODING } },
    locations: []
  },
  source_occurrence_version_ids: [branded("cr10-source-occurrence-version")],
  effective_from: assessedAt
};
