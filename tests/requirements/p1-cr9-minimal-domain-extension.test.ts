import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DeterministicRequirementParser,
  UTF8_TEXT_ENCODING,
  type ExtractedRecordId,
  type IsoDateTime,
  type OpportunityVersion,
  type OpportunityVersionId,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type RequirementFact,
  type RequirementParsingInput,
  type SemanticHash,
  type SnapshotId
} from "../../lib/ingestion";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parser = new DeterministicRequirementParser();

test("GENDER formally models an explicit male restriction", () => {
  const parsed = parse("限男性");
  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.equal(parsed.facts[0]?.dimension, "GENDER");
  assert.deepEqual(parsed.facts[0]?.value, { kind: "CODE", code: "MALE" });
});

test("AGE models inclusive ranges with candidate-cohort-dependent branches", () => {
  const parsed = parse(
    "应届毕业生要求年龄18周岁以上至35周岁以下（截至2025年2月20日）；社会人员要求年龄18周岁以上至30周岁以下（截至2025年2月20日）",
    "应届毕业生要求年龄18周岁以上至35周岁以下(截至2025年2月20日);社会人员要求年龄18周岁以上至30周岁以下(截至2025年2月20日)"
  );
  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.equal(parsed.facts.length, 2);
  assert.deepEqual(parsed.facts.map((fact) => fact.applicability?.candidate_cohorts), [
    ["FRESH_GRADUATE"],
    ["SOCIAL_CANDIDATE"]
  ]);
  assert.deepEqual(parsed.facts[0]?.value, {
    kind: "AGE_RANGE",
    lower_bound: { years: 18, inclusive: true },
    upper_bound: { years: 35, inclusive: true },
    reference_date: "2025-02-20"
  });
});

test("WORK_EXPERIENCE preserves minimum years and the explicit experience scope", () => {
  const parsed = parse("5年以上法律实践经验");
  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.equal(parsed.facts[0]?.dimension, "WORK_EXPERIENCE");
  assert.equal(parsed.facts[0]?.operator, "AT_LEAST");
  assert.deepEqual(parsed.facts[0]?.value, {
    kind: "WORK_EXPERIENCE",
    minimum_years: 5,
    experience_scope: normalized("法律实践"),
    scope_definition: "EXPLICIT"
  });
});

test("CANDIDATE_COHORT distinguishes non-fresh graduates", () => {
  const parsed = parse("限非应届毕业生");
  const exactYear = parse("招聘对象：2025届应届毕业生", "招聘对象:2025届应届毕业生");
  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.equal(parsed.facts[0]?.dimension, "CANDIDATE_COHORT");
  assert.deepEqual(parsed.facts[0]?.value, { kind: "CODE", code: "NON_FRESH_GRADUATE" });
  assert.deepEqual(exactYear.facts.map((fact) => fact.dimension), [
    "GRADUATION_YEAR",
    "CANDIDATE_COHORT"
  ]);
  assert.deepEqual(exactYear.facts[0]?.value, {
    kind: "GRADUATION_WINDOW",
    exact_graduation_year: 2025,
    current_cohort: "FRESH_GRADUATE"
  });
});

test("PROFESSIONAL_QUALIFICATION retains the A-class certificate requirement", () => {
  const parsed = parse("须取得A类法律职业资格证书");
  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.equal(parsed.facts[0]?.dimension, "PROFESSIONAL_QUALIFICATION");
  assert.deepEqual(parsed.facts[0]?.value, {
    kind: "PROFESSIONAL_QUALIFICATION",
    qualification_type: "LEGAL_PROFESSIONAL_QUALIFICATION",
    qualification_class: "A",
    strength: "REQUIRED"
  });
});

test("UNDERGRADUATE_ONLY is an explicit major-scope relationship", () => {
  assert.equal(relationshipMode("仅要求本科专业"), "UNDERGRADUATE_ONLY");
});

test("GRADUATE_ONLY is an explicit major-scope relationship", () => {
  assert.equal(relationshipMode("仅要求研究生专业"), "GRADUATE_ONLY");
});

test("AND is an explicit bachelor-and-graduate relationship", () => {
  assert.equal(relationshipMode("本科专业要求与研究生专业要求同时满足"), "AND");
});

test("OR is an explicit bachelor-or-graduate relationship", () => {
  assert.equal(relationshipMode("本科专业要求或研究生专业要求满足其一"), "OR");
});

test("HIGHEST_DEGREE_ONLY is never inferred without exact source wording", () => {
  assert.equal(relationshipMode("仅比较最高学历对应专业"), "HIGHEST_DEGREE_ONLY");
  const unresolved = parse("本科：法学类，研究生：法律");
  assert.equal(unresolved.facts.some((fact) => {
    return fact.value.kind === "MAJOR_SCOPE_RELATIONSHIP"
      && fact.value.relationship.mode === "HIGHEST_DEGREE_ONLY";
  }), false);
});

test("EITHER_LEVEL is distinct from an inferred highest-degree rule", () => {
  assert.equal(relationshipMode("本科或研究生任一层级专业满足即可"), "EITHER_LEVEL");
});

test("major_code and major_name remain separate fields with an explicit education scope", () => {
  const parsed = parseWithDirectory("研究生专业：A030111法律（非法学）");
  const fact = parsed.facts[0];
  assert.equal(fact?.subject_scope, "GRADUATE");
  assert.equal(fact?.value.kind, "PROGRAM_REFERENCE");
  if (fact?.value.kind !== "PROGRAM_REFERENCE") throw new Error("Expected directory reference");
  assert.equal(fact.value.reference.program_code, "A030111");
  assert.equal(fact.value.reference.program_label?.text, "法律(非法学)");
  assert.equal(fact.value.reference.directory_namespace, "external-academic-program-directory");
});

test("0351 法律 never becomes 法律（非法学）", () => {
  const parsed = parseWithDirectory("研究生专业：0351法律");
  const fact = parsed.facts[0];
  assert.equal(fact?.value.kind, "PROGRAM_REFERENCE");
  if (fact?.value.kind !== "PROGRAM_REFERENCE") throw new Error("Expected directory reference");
  assert.equal(fact.value.reference.program_code, "0351");
  assert.equal(fact.value.reference.program_label?.text, "法律");
  assert.equal(parsed.facts.some((item) => {
    return item.value.kind === "CODE" && item.value.code === "JURIS_MASTER_NON_LAW";
  }), false);
});

test("the negative-inference guard recognizes only explicit non-law source text", () => {
  const broad = parse("研究生专业：法律");
  const explicit = parse("研究生专业：法律硕士（非法学）", "研究生专业:法律硕士(非法学)");
  assert.deepEqual(broad.facts[0]?.value, { kind: "CODE", code: "LAW" });
  assert.deepEqual(explicit.facts[0]?.value, {
    kind: "CODE",
    code: "JURIS_MASTER_NON_LAW"
  });
});

test("EXTERNAL_DIRECTORY_REFERENCE remains versioned and source-neutral", () => {
  const source = fragment("专业按外部目录匹配", "专业按外部目录匹配", {
    directory_namespace: "external-academic-program-directory",
    directory_version: "2025"
  });
  const parsed = parser.parse(input([source]));
  assert.deepEqual(parsed.facts[0]?.value, {
    kind: "MAJOR_MATCH_RULE",
    rule: {
      kind: "EXTERNAL_DIRECTORY_REFERENCE",
      directory_namespace: "external-academic-program-directory",
      directory_version: "2025",
      unresolved_behavior: "REVIEW_REQUIRED"
    }
  });
});

test("an EXCEPTION_LIST rule remains structured and REVIEW_REQUIRED", () => {
  const parsed = parse("专业匹配按例外清单审查");
  assert.equal(parsed.facts[0]?.value.kind, "MAJOR_MATCH_RULE");
  assert.equal(parsed.observations[0]?.status, "AMBIGUOUS");
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
  assert.ok(parsed.warnings.some((warning) => {
    return warning.code === "MAJOR_MATCH_EXCEPTION_REQUIRES_REVIEW";
  }));
});

test("deliberately unmodeled uniform conditions remain DOMAIN_GAP_OBSERVED", () => {
  const parsed = parse("具有中华人民共和国国籍");
  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.observations[0]?.status, "DOMAIN_GAP_OBSERVED");
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
});

test("REVIEW_REQUIRED produces no complete set and cannot enter Eligibility", () => {
  const parsed = parse("专业匹配按例外清单审查");
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
  assert.equal(parsed.complete_requirement_set, null);
  assert.equal("eligibility_assessment" in parsed, false);
});

test("existing Requirement Facts remain readable without silent reinterpretation", () => {
  const legacyFact: RequirementFact = {
    requirement_fact_id: branded("legacy-requirement-fact"),
    opportunity_version_id: opportunityVersion.opportunity_version_id,
    dimension: "MAJOR",
    operator: "EQUALS",
    value: { kind: "CODE", code: "JURIS_MASTER" },
    subject_scope: "MASTER",
    logic_group: {
      logic_group_id: branded("legacy-logic-group"),
      operator: "AND"
    },
    polarity: "POSITIVE",
    certainty: "EXPLICIT",
    parser_version: "deterministic-requirement-parser/2.0.0"
  };
  assert.deepEqual(legacyFact.value, { kind: "CODE", code: "JURIS_MASTER" });
  assert.equal("major_match_rule" in legacyFact, false);
});

test("CR#9 parsing performs zero network requests", async () => {
  const source = readFileSync(path.join(
    repositoryRoot,
    "lib/ingestion/requirements/deterministic-requirement-parser.ts"
  ), "utf8");
  assert.doesNotMatch(source, /globalThis\.fetch|node:(?:http|https|net|tls|dns)/u);
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});

function relationshipMode(text: string) {
  const parsed = parse(text);
  assert.equal(parsed.completeness.status, "COMPLETE");
  const value = parsed.facts[0]?.value;
  assert.equal(value?.kind, "MAJOR_SCOPE_RELATIONSHIP");
  if (value?.kind !== "MAJOR_SCOPE_RELATIONSHIP") {
    throw new Error("Expected major-scope relationship");
  }
  return value.relationship.mode;
}

function parse(original: string, normalizedText = original) {
  const source = fragment(original, normalizedText);
  return parser.parse(input([source]));
}

function parseWithDirectory(original: string) {
  const normalizedText = original
    .replaceAll("：", ":")
    .replaceAll("（", "(")
    .replaceAll("）", ")");
  const source = fragment(original, normalizedText, {
    directory_namespace: "external-academic-program-directory",
    directory_version: "2025"
  });
  return parser.parse(input([source]));
}

function fragment(
  original: string,
  normalizedText: string,
  directory?: RequirementEvidenceFragment["academic_program_directory"]
): RequirementEvidenceFragment {
  return {
    requirement_evidence_fragment_id: branded<RequirementEvidenceFragmentId>(
      `cr9-fragment:${original}`
    ),
    extracted_record_id: branded<ExtractedRecordId>("cr9-extracted-record"),
    snapshot_id: branded<SnapshotId>("cr9-snapshot"),
    locator: {
      kind: "HTML",
      selector: "article.requirements",
      field_path: "requirements"
    },
    ...(directory ? { academic_program_directory: directory } : {}),
    extractor_name: "source-neutral-cr9-test-extractor",
    extractor_version: "1.0.0",
    parser_version: "source-neutral-cr9-fragment/1.0.0",
    observed_value_state: "TEXT",
    original_text: { text: original, encoding: UTF8_TEXT_ENCODING },
    normalized_text: normalized(normalizedText)
  };
}

function input(fragments: readonly RequirementEvidenceFragment[]): RequirementParsingInput {
  return {
    opportunity_version: opportunityVersion,
    evidence_fragments: fragments,
    expected_sources: fragments.map((source) => ({
      extracted_record_id: source.extracted_record_id,
      snapshot_id: source.snapshot_id
    }))
  };
}

function normalized(text: string) {
  return {
    text,
    unicode_form: "NFKC" as const,
    normalizer_version: "source-neutral-cr9-normalizer/1.0.0",
    operations: ["UNICODE_NORMALIZATION" as const, "WIDTH_FOLDING" as const]
  };
}

function branded<Value extends string>(value: string) {
  return value as Value;
}

const opportunityVersion: OpportunityVersion = {
  opportunity_version_id: branded<OpportunityVersionId>("cr9-opportunity-version"),
  canonical_opportunity_id: branded("cr9-canonical-opportunity"),
  revision: 1,
  semantic_hash: branded<SemanticHash>("cr9-semantic-hash"),
  content: {
    organization: {
      name: { original: { text: "示例单位", encoding: UTF8_TEXT_ENCODING } }
    },
    title: {
      original: { text: "法律岗位", encoding: UTF8_TEXT_ENCODING }
    },
    locations: []
  },
  source_occurrence_version_ids: [branded("cr9-source-occurrence-version")],
  effective_from: branded<IsoDateTime>("2026-09-04T12:00:00+08:00")
};
