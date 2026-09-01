import "../helpers/network-guard";

import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicRequirementParser,
  UTF8_TEXT_ENCODING,
  type ExtractedRecord,
  type ExtractedRecordId,
  type IsoDateTime,
  type OpportunityVersion,
  type OpportunityVersionId,
  type SemanticHash,
  type SnapshotId,
  type SourceOccurrenceId,
  type SourceOccurrenceVersion,
  type SourceOccurrenceVersionId,
  type SourceRecordLocator
} from "../../lib/ingestion";

function branded<Value extends string>(value: string) {
  return value as Value;
}

const opportunityVersionId = branded<OpportunityVersionId>("opportunity-version-requirements");
const sourceOccurrenceId = branded<SourceOccurrenceId>("source-occurrence-requirements");
const sourceVersionId = branded<SourceOccurrenceVersionId>("source-version-requirements");
const extractedRecordId = branded<ExtractedRecordId>("extracted-record-requirements");
const snapshotId = branded<SnapshotId>("snapshot-requirements");
const semanticHash = branded<SemanticHash>("semantic-requirements");
const observedAt = branded<IsoDateTime>("2026-09-01T08:00:00+08:00");

function inputFor(
  originalText: string,
  normalizedText: string | null,
  locator: SourceRecordLocator = {
    kind: "HTML",
    selector: "article.job",
    path: "body > article.job"
  }
) {
  const requirementText = {
    original: { text: originalText, encoding: UTF8_TEXT_ENCODING },
    normalized: normalizedText === null
      ? undefined
      : {
          text: normalizedText,
          unicode_form: "NFKC" as const,
          normalizer_version: "source-normalizer/1.0.0",
          operations: [
            "UNICODE_NORMALIZATION" as const,
            "WIDTH_FOLDING" as const,
            "PUNCTUATION_FOLDING" as const,
            "WHITESPACE_FOLDING" as const
          ]
        }
  };
  const opportunityVersion: OpportunityVersion = {
    opportunity_version_id: opportunityVersionId,
    canonical_opportunity_id: branded("canonical-requirements"),
    revision: 1,
    semantic_hash: semanticHash,
    content: {
      organization: {
        name: {
          original: { text: "示例单位", encoding: UTF8_TEXT_ENCODING },
          normalized: {
            text: "示例单位",
            unicode_form: "NFKC",
            normalizer_version: "source-normalizer/1.0.0",
            operations: []
          }
        }
      },
      title: {
        original: { text: "法律事务岗", encoding: UTF8_TEXT_ENCODING },
        normalized: {
          text: "法律事务岗",
          unicode_form: "NFKC",
          normalizer_version: "source-normalizer/1.0.0",
          operations: []
        }
      },
      requirement_text: requirementText,
      locations: []
    },
    source_occurrence_version_ids: [sourceVersionId],
    effective_from: observedAt
  };
  const sourceVersion: SourceOccurrenceVersion = {
    source_occurrence_version_id: sourceVersionId,
    source_occurrence_id: sourceOccurrenceId,
    extracted_record_id: extractedRecordId,
    revision: 1,
    semantic_hash: semanticHash,
    content: opportunityVersion.content,
    first_observed_at: observedAt
  };
  const extractedRecord: ExtractedRecord = {
    extracted_record_id: extractedRecordId,
    snapshot_id: snapshotId,
    source_definition_id: branded("source-requirements"),
    identity_candidates: [],
    raw_title: { text: "法律事务岗", encoding: UTF8_TEXT_ENCODING },
    raw_organization_name: { text: "示例单位", encoding: UTF8_TEXT_ENCODING },
    raw_location_text: [],
    raw_requirement_text: { text: originalText, encoding: UTF8_TEXT_ENCODING },
    source_record_locator: locator,
    adapter_metadata: {
      fixture: { ignored_private_value: "不得读取" }
    },
    extraction: {
      extractor_name: "fixture-extractor",
      extractor_version: "1.0.0",
      extracted_at: observedAt
    }
  };
  return {
    opportunity_version: opportunityVersion,
    source_occurrence_versions: [sourceVersion],
    extracted_records: [extractedRecord]
  };
}

test("parses minimum education, explicit master major, and required legal qualification", () => {
  const parsed = new DeterministicRequirementParser().parse(inputFor(
    "学历要求：硕士及以上；硕士专业：法律硕士（非法学）；须通过法律职业资格考试。",
    "学历要求:硕士及以上;硕士专业:法律硕士(非法学);须通过法律职业资格考试。"
  ));

  assert.equal(parsed.facts.length, 3);
  assert.equal(parsed.evidence.length, 3);
  assert.deepEqual(parsed.facts.map((fact) => fact.dimension), [
    "EDUCATION_LEVEL",
    "MAJOR",
    "PROFESSIONAL_QUALIFICATION"
  ]);
  assert.equal(parsed.facts[0].operator, "AT_LEAST");
  assert.deepEqual(parsed.facts[0].value, { kind: "CODE", code: "MASTER" });
  assert.equal(parsed.facts[1].subject_scope, "MASTER");
  assert.deepEqual(parsed.facts[1].value, {
    kind: "CODE",
    code: "JURIS_MASTER_NON_LAW"
  });
  assert.equal(parsed.facts[2].operator, "EXISTS");
  assert.ok(parsed.evidence.every((item) => item.snapshot_id === snapshotId));
  assert.deepEqual(
    parsed.evidence.map((item) => item.requirement_fact_id),
    parsed.facts.map((fact) => fact.requirement_fact_id)
  );
});

test("distinguishes bachelor-only law from bachelor-and-master law restrictions", () => {
  const parsed = new DeterministicRequirementParser().parse(inputFor(
    "本科专业：法学；本硕均要求法学",
    "本科专业:法学;本硕均要求法学"
  ));

  assert.deepEqual(parsed.facts.map((fact) => fact.subject_scope), [
    "BACHELOR",
    "BACHELOR",
    "MASTER"
  ]);
  assert.ok(parsed.facts.every((fact) => {
    return fact.value.kind === "CODE" && fact.value.code === "LAW_STUDIES";
  }));
  assert.equal(parsed.facts[1].logic_group.logic_group_id,
    parsed.facts[2].logic_group.logic_group_id);
  assert.equal(parsed.facts[1].logic_group.operator, "AND");
});

test("legal, law studies, and intellectual property alternatives form one OR group", () => {
  const parsed = new DeterministicRequirementParser().parse(inputFor(
    "法律、法学、知识产权等相关专业",
    "法律、法学、知识产权等相关专业"
  ));

  assert.deepEqual(parsed.facts.map((fact) => {
    return fact.value.kind === "CODE" ? fact.value.code : null;
  }), ["LAW", "LAW_STUDIES", "INTELLECTUAL_PROPERTY"]);
  assert.ok(parsed.facts.every((fact) => fact.logic_group.operator === "OR"));
  assert.ok(parsed.facts.every((fact) => fact.subject_scope === "ANY_EDUCATION"));
  assert.ok(parsed.facts.every((fact) => fact.certainty === "AMBIGUOUS"));
  assert.equal(new Set(parsed.facts.map((fact) => fact.logic_group.logic_group_id)).size, 1);
  assert.deepEqual(parsed.warnings.map((warning) => warning.code), [
    "AMBIGUOUS_EDUCATION_SCOPE"
  ]);
});

test("professional qualification preference is not converted into a mandatory Fact", () => {
  const parsed = new DeterministicRequirementParser().parse(inputFor(
    "通过法律职业资格考试者优先",
    "通过法律职业资格考试者优先"
  ));

  assert.equal(parsed.facts.length, 0);
  assert.equal(parsed.evidence.length, 0);
  assert.deepEqual(parsed.warnings.map((warning) => warning.code), [
    "PREFERRED_QUALIFICATION_NOT_MANDATORY"
  ]);
});

test("major unrestricted remains scoped and evidence-backed", () => {
  const parsed = new DeterministicRequirementParser().parse(inputFor(
    "本科专业：不限",
    "本科专业:不限"
  ));

  assert.equal(parsed.facts.length, 1);
  assert.equal(parsed.facts[0].subject_scope, "BACHELOR");
  assert.equal(parsed.facts[0].operator, "UNRESTRICTED");
  assert.deepEqual(parsed.facts[0].value, { kind: "UNRESTRICTED" });
  assert.equal(parsed.evidence[0].evidence_text.text, "本科专业：不限");
});

test("layered bachelor-unrestricted and master-major requirements remain separate", () => {
  const parsed = new DeterministicRequirementParser().parse(inputFor(
    "本科专业不限，硕士法律、法学相关专业",
    "本科专业不限,硕士法律、法学相关专业"
  ));

  assert.deepEqual(parsed.facts.map((fact) => fact.subject_scope), [
    "BACHELOR",
    "MASTER",
    "MASTER"
  ]);
  assert.equal(parsed.facts[0].operator, "UNRESTRICTED");
  assert.deepEqual(parsed.facts.slice(1).map((fact) => {
    return fact.value.kind === "CODE" ? fact.value.code : null;
  }), ["LAW", "LAW_STUDIES"]);
  assert.ok(parsed.facts.slice(1).every((fact) => fact.logic_group.operator === "OR"));
});

test("common 法硕（非法学） alias maps to the same program code", () => {
  const parsed = new DeterministicRequirementParser().parse(inputFor(
    "硕士专业：法硕（非法学）",
    "硕士专业:法硕(非法学)"
  ));

  assert.equal(parsed.facts.length, 1);
  assert.deepEqual(parsed.facts[0].value, {
    kind: "CODE",
    code: "JURIS_MASTER_NON_LAW"
  });
  assert.equal(parsed.evidence[0].evidence_text.text, "硕士专业：法硕（非法学）");
});

test("original Chinese evidence survives full-width normalization", () => {
  const parsed = new DeterministicRequirementParser().parse(inputFor(
    "硕士专业：法律硕士（非法学）专业",
    "硕士专业:法律硕士(非法学)专业"
  ));

  assert.equal(parsed.evidence[0].evidence_text.text,
    "硕士专业：法律硕士（非法学）专业");
  assert.equal(parsed.evidence[0].normalized_text?.text,
    "硕士专业:法律硕士(非法学)专业");
  assert.notEqual(parsed.evidence[0].evidence_text.text,
    parsed.evidence[0].normalized_text?.text);
});

test("HTML, JSON, and DOCUMENT records preserve source-specific evidence positions", () => {
  const locators: readonly SourceRecordLocator[] = [
    { kind: "HTML", selector: "article.job", path: "body > article.job" },
    { kind: "JSON", json_path: "$.jobs[0]" },
    { kind: "DOCUMENT", page_number: 3, section: "招聘条件", text_locator: "paragraph-2" }
  ];
  const parsed = locators.map((locator) => {
    return new DeterministicRequirementParser().parse(inputFor(
      "本科专业：法学",
      "本科专业:法学",
      locator
    )).evidence[0].locator;
  });

  assert.equal(parsed[0].section, "article.job");
  assert.equal(parsed[0].field_path, "body > article.job.raw_requirement_text");
  assert.equal(parsed[1].field_path, "$.jobs[0].raw_requirement_text");
  assert.equal(parsed[2].page_number, 3);
  assert.equal(parsed[2].section, "招聘条件");
  assert.equal(parsed[2].field_path, "paragraph-2");
});

test("merged Canonical content traces Evidence to the selected semantic source version", () => {
  const selected = inputFor("本科专业：法学", "本科专业:法学");
  const otherVersionId = branded<SourceOccurrenceVersionId>("a-third-party-version");
  const otherRecordId = branded<ExtractedRecordId>("a-third-party-record");
  const otherSnapshotId = branded<SnapshotId>("a-third-party-snapshot");
  const otherVersion: SourceOccurrenceVersion = {
    ...selected.source_occurrence_versions[0],
    source_occurrence_version_id: otherVersionId,
    extracted_record_id: otherRecordId,
    semantic_hash: branded<SemanticHash>("semantic-third-party-summary")
  };
  const otherRecord: ExtractedRecord = {
    ...selected.extracted_records[0],
    extracted_record_id: otherRecordId,
    snapshot_id: otherSnapshotId
  };
  const parsed = new DeterministicRequirementParser().parse({
    opportunity_version: {
      ...selected.opportunity_version,
      source_occurrence_version_ids: [otherVersionId, sourceVersionId]
    },
    source_occurrence_versions: [otherVersion, ...selected.source_occurrence_versions],
    extracted_records: [otherRecord, ...selected.extracted_records]
  });

  assert.equal(parsed.facts.length, 1);
  assert.equal(parsed.evidence[0].snapshot_id, snapshotId);
  assert.notEqual(parsed.evidence[0].snapshot_id, otherSnapshotId);
});

test("missing normalization or traceability produces warnings instead of Facts", () => {
  const missingNormalization = new DeterministicRequirementParser().parse(inputFor(
    "本科专业：法学",
    null
  ));
  assert.deepEqual(missingNormalization.warnings.map((warning) => warning.code), [
    "NORMALIZED_TEXT_MISSING"
  ]);
  assert.equal(missingNormalization.facts.length, 0);

  const missingTraceabilityInput = inputFor("本科专业：法学", "本科专业:法学");
  const missingTraceability = new DeterministicRequirementParser().parse({
    ...missingTraceabilityInput,
    extracted_records: []
  });
  assert.deepEqual(missingTraceability.warnings.map((warning) => warning.code), [
    "TRACEABILITY_SOURCE_MISSING"
  ]);
  assert.equal(missingTraceability.facts.length, 0);
});

test("Fact and Evidence identities are deterministic", () => {
  const parser = new DeterministicRequirementParser();
  const input = inputFor("本科专业：法学", "本科专业:法学");
  const first = parser.parse(input);
  const second = parser.parse(input);
  assert.equal(first.facts[0].requirement_fact_id, second.facts[0].requirement_fact_id);
  assert.equal(first.evidence[0].requirement_evidence_id,
    second.evidence[0].requirement_evidence_id);
});

test("P1-08 Requirement parsing remains offline", async () => {
  await assert.rejects(fetch("https://example.invalid"), /Network access is disabled in tests/);
});
