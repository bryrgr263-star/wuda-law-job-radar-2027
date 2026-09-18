import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicRequirementParser,
  UTF8_TEXT_ENCODING,
  type ExtractedRecordId,
  type IsoDateTime,
  type OpportunityVersion,
  type OpportunityVersionId,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type RequirementParsingInput,
  type SemanticHash,
  type SnapshotId
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

const opportunityVersionId = branded<OpportunityVersionId>(
  "opportunity-version-requirements-v2"
);
const observedAt = branded<IsoDateTime>("2026-09-01T08:00:00+08:00");

const opportunityVersion: OpportunityVersion = {
  opportunity_version_id: opportunityVersionId,
  canonical_opportunity_id: branded("canonical-requirements-v2"),
  revision: 1,
  semantic_hash: branded<SemanticHash>("semantic-requirements-v2"),
  content: {
    organization: {
      name: { original: { text: "示例单位", encoding: UTF8_TEXT_ENCODING } }
    },
    title: {
      original: { text: "法律事务岗", encoding: UTF8_TEXT_ENCODING }
    },
    locations: []
  },
  source_occurrence_version_ids: [branded("source-version-requirements-v2")],
  effective_from: observedAt
};

interface FragmentOptions {
  readonly id?: string;
  readonly record?: string;
  readonly snapshot?: string;
  readonly original?: string;
  readonly normalized?: string | null;
  readonly locator?: RequirementEvidenceFragment["locator"];
  readonly empty?: boolean;
  readonly directory?: RequirementEvidenceFragment["academic_program_directory"];
}

function fragment(options: FragmentOptions = {}): RequirementEvidenceFragment {
  const originalText = options.original ?? "硕士专业：法律硕士（非法学）";
  const base = {
    requirement_evidence_fragment_id: branded<RequirementEvidenceFragmentId>(
      options.id ?? "fragment-default"
    ),
    extracted_record_id: branded<ExtractedRecordId>(
      options.record ?? "record-default"
    ),
    snapshot_id: branded<SnapshotId>(options.snapshot ?? "snapshot-default"),
    locator: options.locator ?? {
      kind: "HTML",
      selector: "article.requirements",
      path: "body > article.requirements",
      field_path: "requirement_text",
      start_offset: 10
    },
    ...(options.directory ? { academic_program_directory: options.directory } : {}),
    extractor_name: "source-neutral-fragment-builder",
    extractor_version: "1.0.0",
    parser_version: "fragment-contract/1.0.0"
  };
  if (options.empty) {
    return {
      ...base,
      observed_value_state: "EMPTY",
      original_text: null
    };
  }
  return {
    ...base,
    observed_value_state: "TEXT",
    original_text: { text: originalText, encoding: UTF8_TEXT_ENCODING },
    ...(options.normalized === null
      ? {}
      : {
          normalized_text: {
            text: options.normalized ?? originalText,
            unicode_form: "NFKC" as const,
            normalizer_version: "source-normalizer/1.0.0",
            operations: [
              "UNICODE_NORMALIZATION" as const,
              "WIDTH_FOLDING" as const,
              "PUNCTUATION_FOLDING" as const
            ]
          }
        })
  };
}

function input(
  fragments: readonly RequirementEvidenceFragment[],
  options: {
    readonly expected?: RequirementParsingInput["expected_sources"];
    readonly blockers?: RequirementParsingInput["blockers"];
  } = {}
): RequirementParsingInput {
  return {
    opportunity_version: opportunityVersion,
    evidence_fragments: fragments,
    expected_sources: options.expected ?? fragments.map((item) => ({
      extracted_record_id: item.extracted_record_id,
      snapshot_id: item.snapshot_id
    })),
    ...(options.blockers ? { blockers: options.blockers } : {})
  };
}

test("multi-source HTML and spreadsheet fragments form one traceable complete set", () => {
  const html = fragment({
    id: "fragment-html",
    record: "record-html",
    snapshot: "snapshot-html",
    original: "学历要求：硕士及以上",
    normalized: "学历要求:硕士及以上"
  });
  const spreadsheet = fragment({
    id: "fragment-sheet",
    record: "record-sheet",
    snapshot: "snapshot-sheet",
    original: "硕士专业：法律硕士（非法学）",
    normalized: "硕士专业:法律硕士(非法学)",
    locator: {
      kind: "SPREADSHEET",
      sheet: "职位及要求表",
      cell_or_range: "H12",
      field_path: "graduate_major"
    }
  });
  const parsed = new DeterministicRequirementParser().parse(input([
    html,
    spreadsheet
  ]));

  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.ok(parsed.complete_requirement_set);
  assert.deepEqual(parsed.completeness.covered_snapshot_ids, [
    html.snapshot_id,
    spreadsheet.snapshot_id
  ]);
  assert.deepEqual(parsed.facts.map((fact) => fact.dimension), [
    "EDUCATION_LEVEL",
    "MAJOR"
  ]);
  assert.equal(parsed.evidence[0].locator.kind, "HTML");
  assert.equal(parsed.evidence[0].locator.start_offset, 10);
  assert.equal(parsed.evidence[1].locator.kind, "SPREADSHEET");
  assert.equal(parsed.evidence[1].locator.sheet, "职位及要求表");
  assert.equal(parsed.evidence[1].locator.cell_or_range, "H12");
});

test("original and normalized evidence remain distinct and deterministic", () => {
  const source = fragment({
    original: "硕士专业：法律硕士（非法学）",
    normalized: "硕士专业:法律硕士(非法学)"
  });
  const parser = new DeterministicRequirementParser();
  const first = parser.parse(input([source]));
  const second = parser.parse(input([source]));

  assert.equal(first.evidence[0].evidence_text.text,
    "硕士专业：法律硕士（非法学）");
  assert.equal(first.evidence[0].normalized_text?.text,
    "硕士专业:法律硕士(非法学)");
  assert.equal(first.requirement_set.requirement_set_id,
    second.requirement_set.requirement_set_id);
  assert.equal(first.completeness.requirement_set_content_hash,
    second.completeness.requirement_set_content_hash);
});

test("法律硕士 and 法律硕士（非法学） remain different program facts", () => {
  const jurisMaster = new DeterministicRequirementParser().parse(input([fragment({
    original: "硕士专业：法律硕士",
    normalized: "硕士专业:法律硕士"
  })]));
  const nonLaw = new DeterministicRequirementParser().parse(input([fragment({
    id: "fragment-non-law",
    original: "硕士专业：法律硕士（非法学）",
    normalized: "硕士专业:法律硕士(非法学)"
  })]));

  assert.deepEqual(jurisMaster.facts[0].value, {
    kind: "CODE",
    code: "JURIS_MASTER"
  });
  assert.deepEqual(nonLaw.facts[0].value, {
    kind: "CODE",
    code: "JURIS_MASTER_NON_LAW"
  });
});

test("研究生 and 硕士 produce isolated GRADUATE and MASTER scopes", () => {
  const graduate = new DeterministicRequirementParser().parse(input([fragment({
    original: "研究生专业：法学",
    normalized: "研究生专业:法学"
  })]));
  const master = new DeterministicRequirementParser().parse(input([fragment({
    id: "fragment-master",
    original: "硕士专业：法学",
    normalized: "硕士专业:法学"
  })]));

  assert.equal(graduate.facts[0].subject_scope, "GRADUATE");
  assert.equal(master.facts[0].subject_scope, "MASTER");
  assert.notEqual(graduate.facts[0].subject_scope, master.facts[0].subject_scope);
});

test("source-neutral academic directory references preserve namespace and version", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "研究生专业：0301（法学）",
    normalized: "研究生专业:0301(法学)",
    directory: {
      directory_namespace: "national-academic-program-catalog",
      directory_version: "2022"
    }
  })]));

  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.deepEqual(parsed.facts[0].value, {
    kind: "PROGRAM_REFERENCE",
    reference: {
      directory_namespace: "national-academic-program-catalog",
      directory_version: "2022",
      program_code: "0301",
      program_label: {
        text: "法学",
        unicode_form: "NFKC",
        normalizer_version: "source-normalizer/1.0.0",
        operations: [
          "UNICODE_NORMALIZATION",
          "WIDTH_FOLDING",
          "PUNCTUATION_FOLDING"
        ]
      }
    }
  });
});

test("directory-shaped program code without directory evidence blocks completeness", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "研究生专业：0301",
    normalized: "研究生专业:0301"
  })]));

  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
  assert.deepEqual(parsed.completeness.blockers.map((item) => item.code), [
    "DOMAIN_GAP_OBSERVED"
  ]);
  assert.ok(parsed.warnings.some((warning) => {
    return warning.code === "ACADEMIC_PROGRAM_DIRECTORY_MISSING";
  }));
});

test("academic degree, age, cohort, household, and student origin are typed only when explicit", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "学位要求：硕士学位；年龄不超过35周岁（截至2026年12月31日）；招聘对象：应届毕业生；户籍要求：北京市；生源地要求：北京市",
    normalized: "学位要求:硕士学位;年龄不超过35周岁(截至2026年12月31日);招聘对象:应届毕业生;户籍要求:北京市;生源地要求:北京市"
  })]));

  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.deepEqual(parsed.facts.map((fact) => fact.dimension), [
    "ACADEMIC_DEGREE",
    "AGE",
    "CANDIDATE_COHORT",
    "HOUSEHOLD_REGISTRATION",
    "STUDENT_ORIGIN"
  ]);
  assert.deepEqual(parsed.facts[1].value, {
    kind: "AGE",
    years: 35,
    reference_date: "2026-12-31"
  });
});

test("candidate cohort applicability is preserved without source-specific branching", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "应届毕业生须硕士专业：法学",
    normalized: "应届毕业生须硕士专业:法学"
  })]));

  assert.deepEqual(parsed.facts[0].applicability, {
    candidate_cohorts: ["FRESH_GRADUATE"],
    operator: "ANY_OF"
  });
});

test("empty evidence remains NOT_OBSERVED and never becomes unrestricted", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    empty: true
  })]));

  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.observations[0].status, "NOT_OBSERVED");
  assert.equal(parsed.completeness.status, "INCOMPLETE");
  assert.equal(parsed.completeness.blockers[0].code, "NOT_OBSERVED");
  assert.equal(parsed.complete_requirement_set, null);
});

test("unparsed, ambiguous, and domain-gap clauses each block completeness", () => {
  const cases = [
    {
      source: fragment({ original: "须符合其他全部条件", normalized: "须符合其他全部条件" }),
      status: "UNPARSED_CLAUSE"
    },
    {
      source: fragment({ original: "年龄不超过35周岁", normalized: "年龄不超过35周岁" }),
      status: "AMBIGUOUS"
    },
    {
      source: fragment({ original: "硕士专业：临床医学", normalized: "硕士专业:临床医学" }),
      status: "DOMAIN_GAP_OBSERVED"
    }
  ] as const;

  for (const item of cases) {
    const parsed = new DeterministicRequirementParser().parse(input([item.source]));
    assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
    assert.ok(parsed.completeness.blockers.some((blocker) => {
      return blocker.code === item.status;
    }));
    assert.equal(parsed.complete_requirement_set, null);
  }
});

test("numbered clauses preserve original evidence and clause-local offsets", () => {
  const source = fragment({
    original: "1.学历要求：本科；（二）法律专业；3）2027届",
    normalized: "1.学历要求:本科;(二)法律专业;3)2027届",
    locator: {
      kind: "HTML",
      selector: "article.requirements",
      field_path: "requirements",
      start_offset: 100
    }
  });
  const parsed = new DeterministicRequirementParser().parse(input([source]));

  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.deepEqual(parsed.facts.map((fact) => fact.dimension), [
    "EDUCATION_LEVEL", "MAJOR", "GRADUATION_YEAR"
  ]);
  assert.equal(parsed.evidence[0]?.evidence_text.text, "1.学历要求：本科");
  assert.equal(parsed.evidence[0]?.locator.start_offset, 100);
  assert.equal(parsed.observations[1]?.original_clause?.text, "（二）法律专业");
  assert.equal(parsed.observations[1]?.clause_locator?.start_offset, 110);
});

test("real 2027 internship clause decomposes existing typed semantics without hiding prestige review", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "1.国内外知名院校法学专业2027年应届在校本科生或研究生",
    normalized: "1.国内外知名院校法学专业2027年应届在校本科生或研究生"
  })]));
  const dimensions = parsed.facts.map((fact) => fact.dimension);

  assert.deepEqual(dimensions, [
    "MAJOR", "GRADUATION_YEAR", "CANDIDATE_COHORT",
    "EDUCATION_LEVEL", "EDUCATION_LEVEL"
  ]);
  assert.deepEqual(parsed.facts.filter((fact) => {
    return fact.dimension === "EDUCATION_LEVEL";
  }).map((fact) => fact.logic_group.operator), ["OR", "OR"]);
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
  assert.ok(parsed.observations.some((observation) => {
    return observation.status === "DOMAIN_GAP_OBSERVED"
      && observation.original_clause?.text.includes("知名院校");
  }));
});

test("supported 2027 internship semantics can complete without a prestige qualifier", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "法学专业2027年应届在校本科生或研究生",
    normalized: "法学专业2027年应届在校本科生或研究生"
  })]));

  assert.equal(parsed.completeness.status, "COMPLETE");
  assert.equal(parsed.facts.length, 5);
});

test("2028 and later is a typed graduation lower bound rather than a temporary string", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "法学专业2028届及之后的在校本科生或研究生",
    normalized: "法学专业2028届及之后的在校本科生或研究生"
  })]));
  const graduation = parsed.facts.find((fact) => fact.dimension === "GRADUATION_YEAR");

  assert.equal(graduation?.operator, "AT_LEAST");
  assert.deepEqual(graduation?.value, { kind: "INTEGER", value: 2028, unit: "year" });
  assert.equal(parsed.completeness.status, "COMPLETE");
});

test("lawyer experience range and practice certificate remain distinct typed facts", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "2.拥有3-5年律师工作经验，并持有律师执业证",
    normalized: "2.拥有3-5年律师工作经验,并持有律师执业证"
  })]));
  const experience = parsed.facts.find((fact) => fact.dimension === "WORK_EXPERIENCE");
  const qualification = parsed.facts.find((fact) => {
    return fact.dimension === "PROFESSIONAL_QUALIFICATION";
  });

  assert.equal(experience?.value.kind, "WORK_EXPERIENCE");
  if (experience?.value.kind === "WORK_EXPERIENCE") {
    assert.equal(experience.value.minimum_years, 3);
    assert.equal(experience.value.maximum_years, 5);
  }
  assert.equal(qualification?.value.kind, "PROFESSIONAL_QUALIFICATION");
  if (qualification?.value.kind === "PROFESSIONAL_QUALIFICATION") {
    assert.equal(qualification.value.qualification_type,
      "LAWYER_PRACTICE_CERTIFICATE");
    assert.notEqual(qualification.value.qualification_type,
      "LEGAL_PROFESSIONAL_QUALIFICATION");
  }
  assert.equal(parsed.completeness.status, "COMPLETE");
});

test("lawyer bachelor and master law education keeps both education scopes", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "1.拥有国内外知名院校的法学专业本硕学历",
    normalized: "1.拥有国内外知名院校的法学专业本硕学历"
  })]));
  const majorFacts = parsed.facts.filter((fact) => fact.dimension === "MAJOR");

  assert.deepEqual(majorFacts.map((fact) => fact.subject_scope), [
    "BACHELOR", "MASTER"
  ]);
  assert.ok(majorFacts.every((fact) => {
    return fact.value.kind === "CODE" && fact.value.code === "LAW_STUDIES";
  }));
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
  assert.ok(parsed.observations.some((observation) => {
    return observation.status === "DOMAIN_GAP_OBSERVED"
      && observation.original_clause?.text.includes("知名院校");
  }));
});

test("legal-thinking and subjective criteria never become MAJOR facts", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "3.在校期间成绩优秀，具有极强的法律思维和运用能力",
    normalized: "3.在校期间成绩优秀,具有极强的法律思维和运用能力"
  })]));

  assert.equal(parsed.facts.some((fact) => fact.dimension === "MAJOR"), false);
  assert.equal(parsed.observations[0]?.status, "DOMAIN_GAP_OBSERVED");
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
});

test("specialized legal experience remains review without a fabricated RequirementFact", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "5.具有商事诉讼/仲裁案件出庭并担任主要代理人的经验，具备独立出庭代理能力",
    normalized: "5.具有商事诉讼/仲裁案件出庭并担任主要代理人的经验,具备独立出庭代理能力"
  })]));

  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.observations[0]?.status, "DOMAIN_GAP_OBSERVED");
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
});

test("internship availability remains review without a fabricated RequirementFact", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "6.每周实习至少4天，且能完整实习3个月或以上",
    normalized: "6.每周实习至少4天,且能完整实习3个月或以上"
  })]));

  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.observations[0]?.status, "DOMAIN_GAP_OBSERVED");
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
});

test("missing expected source and attachment blockers produce INCOMPLETE", () => {
  const source = fragment({ original: "本科专业：法学", normalized: "本科专业:法学" });
  const missingSource = new DeterministicRequirementParser().parse(input([source], {
    expected: [
      { extracted_record_id: source.extracted_record_id, snapshot_id: source.snapshot_id },
      {
        extracted_record_id: branded<ExtractedRecordId>("record-missing"),
        snapshot_id: branded<SnapshotId>("snapshot-missing")
      }
    ]
  }));
  const missingAttachment = new DeterministicRequirementParser().parse(input([source], {
    blockers: [{
      code: "ATTACHMENT_MISSING",
      description: "A referenced requirement-bearing attachment is unavailable"
    }]
  }));

  assert.equal(missingSource.completeness.status, "INCOMPLETE");
  assert.ok(missingSource.completeness.blockers.some((blocker) => {
    return blocker.code === "EVIDENCE_INCOMPLETE";
  }));
  assert.equal(missingAttachment.completeness.status, "INCOMPLETE");
  assert.ok(missingAttachment.completeness.blockers.some((blocker) => {
    return blocker.code === "ATTACHMENT_MISSING";
  }));
});

test("age without an evidence-backed reference date remains ambiguous", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "年龄不超过35周岁",
    normalized: "年龄不超过35周岁"
  })]));

  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.completeness.status, "REVIEW_REQUIRED");
  assert.equal(parsed.completeness.blockers[0].code, "AMBIGUOUS");
  assert.ok(parsed.warnings.some((warning) => {
    return warning.code === "AGE_REFERENCE_DATE_MISSING";
  }));
});

test("preferred qualification is observed but not promoted to a mandatory Fact", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "通过法律职业资格考试者优先",
    normalized: "通过法律职业资格考试者优先"
  })]));

  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.observations[0].clause_role, "PREFERRED");
  assert.equal(parsed.observations[0].status, "CONFIRMED_REQUIREMENT");
  assert.equal(parsed.completeness.status, "COMPLETE");
});

test("parser uses source-neutral fragments and ignores no adapter metadata path", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    locator: {
      kind: "SPREADSHEET",
      sheet: "Requirements",
      cell_or_range: "B7:B7"
    },
    original: "本科专业：不限",
    normalized: "本科专业:不限"
  })]));

  assert.equal(parsed.facts[0].operator, "UNRESTRICTED");
  assert.equal(parsed.evidence[0].locator.sheet, "Requirements");
  assert.equal(parsed.evidence[0].locator.cell_or_range, "B7:B7");
});

test("Requirement V2 parsing remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"),
    /Network access is disabled in tests/);
});

test("legacy flat Requirement output remains separate from CR#12 structured sets", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "本科专业：法学",
    normalized: "本科专业:法学"
  })]));

  assert.equal("logic_model_version" in parsed.requirement_set, false);
  assert.equal("condition_registry" in parsed.requirement_set, false);
  assert.notEqual(parsed.complete_requirement_set, null);
});

test("CR#11 semantic projections do not rewrite historical flat major Facts", () => {
  const parsed = new DeterministicRequirementParser().parse(input([fragment({
    original: "研究生专业：法律",
    normalized: "研究生专业:法律"
  })]));

  assert.deepEqual(parsed.facts[0]?.value, { kind: "CODE", code: "LAW" });
  assert.equal(parsed.facts.some((fact) => {
    return fact.value.kind === "CR11_MAJOR_SEMANTIC";
  }), false);
});
