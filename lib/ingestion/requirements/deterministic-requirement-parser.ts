import { createHash } from "node:crypto";

import type {
  EvidenceLocator,
  ExtractedRecord,
  LogicGroupId,
  NormalizedText,
  OpportunityVersion,
  OriginalText,
  RequirementCertainty,
  RequirementEvidence,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
  RequirementSubjectScope,
  RequirementValue,
  SourceOccurrenceVersion,
  SourceRecordLocator
} from "../domain";
import type {
  RequirementParseWarning,
  RequirementParsingInput,
  RequirementParsingResult
} from "./types";

export const DETERMINISTIC_REQUIREMENT_PARSER_VERSION =
  "deterministic-requirement-parser/1.0.0";

const educationCodes = {
  本科: "BACHELOR",
  硕士: "MASTER",
  博士: "DOCTOR"
} as const;

const majorCodes: Readonly<Record<string, string>> = {
  法学: "LAW_STUDIES",
  法律: "LAW",
  法硕: "JURIS_MASTER",
  "法硕(非法学)": "JURIS_MASTER_NON_LAW",
  法律硕士: "JURIS_MASTER",
  "法律硕士(非法学)": "JURIS_MASTER_NON_LAW",
  知识产权: "INTELLECTUAL_PROPERTY"
};

interface Clause {
  readonly original: OriginalText;
  readonly normalized: NormalizedText;
  readonly start_offset: number;
  readonly end_offset: number;
  readonly index: number;
}

interface FactDraft {
  readonly dimension: RequirementFact["dimension"];
  readonly operator: RequirementFact["operator"];
  readonly value: RequirementValue;
  readonly subject_scope: RequirementSubjectScope;
  readonly logic_operator: RequirementFact["logic_group"]["operator"];
  readonly polarity: RequirementFact["polarity"];
  readonly certainty: RequirementCertainty;
}

interface EvidenceSource {
  readonly source_version: SourceOccurrenceVersion;
  readonly extracted_record: ExtractedRecord;
}

export class DeterministicRequirementParser {
  parse(input: RequirementParsingInput): RequirementParsingResult {
    const requirementText = input.opportunity_version.content.requirement_text;
    if (!requirementText) {
      return result([], [], [{
        code: "NO_REQUIREMENT_TEXT",
        message: "OpportunityVersion has no requirement text"
      }]);
    }
    if (!requirementText.normalized) {
      return result([], [], [{
        code: "NORMALIZED_TEXT_MISSING",
        message: "Requirement parsing requires normalized text from the normalization layer",
        clause: requirementText.original
      }]);
    }

    const evidenceSource = resolveEvidenceSource(input);
    if (!evidenceSource) {
      return result([], [], [{
        code: "TRACEABILITY_SOURCE_MISSING",
        message: "No selected SourceOccurrenceVersion and ExtractedRecord can trace this text",
        clause: requirementText.original
      }]);
    }

    const clauses = alignClauses(requirementText.original, requirementText.normalized);
    if (!clauses) {
      return result([], [], [{
        code: "CLAUSE_ALIGNMENT_FAILED",
        message: "Original and normalized requirement clauses cannot be aligned safely",
        clause: requirementText.original
      }]);
    }

    const facts: RequirementFact[] = [];
    const evidence: RequirementEvidence[] = [];
    const warnings: RequirementParseWarning[] = [];
    for (const clause of clauses) {
      const parsed = parseClause(clause);
      warnings.push(...parsed.warnings);
      parsed.drafts.forEach((draft, draftIndex) => {
        const logicGroupId = logicGroupIdFor(
          input.opportunity_version,
          clause,
          draft.logic_operator
        );
        const fact = createFact(
          input.opportunity_version,
          clause,
          draft,
          draftIndex,
          logicGroupId
        );
        facts.push(fact);
        evidence.push(createEvidence(fact, clause, evidenceSource.extracted_record));
      });
    }
    return result(facts, evidence, warnings);
  }
}

function resolveEvidenceSource(input: RequirementParsingInput): EvidenceSource | null {
  const includedVersionIds = new Set(
    input.opportunity_version.source_occurrence_version_ids
  );
  const recordsById = new Map(input.extracted_records.map((record) => {
    return [record.extracted_record_id, record] as const;
  }));
  const expectedOriginal = input.opportunity_version.content.requirement_text?.original.text;
  const candidates = input.source_occurrence_versions
    .filter((version) => includedVersionIds.has(version.source_occurrence_version_id))
    .filter((version) => version.semantic_hash === input.opportunity_version.semantic_hash)
    .map((sourceVersion) => ({
      source_version: sourceVersion,
      extracted_record: recordsById.get(sourceVersion.extracted_record_id)
    }))
    .filter((candidate): candidate is EvidenceSource => {
      return candidate.extracted_record !== undefined
        && candidate.extracted_record.raw_requirement_text?.text === expectedOriginal;
    })
    .sort((left, right) => {
      return left.source_version.source_occurrence_version_id.localeCompare(
        right.source_version.source_occurrence_version_id
      );
    });
  return candidates[0] ?? null;
}

function alignClauses(original: OriginalText, normalized: NormalizedText) {
  const originalClauses = splitClauses(original.text);
  const normalizedClauses = splitClauses(normalized.text);
  if (originalClauses.length !== normalizedClauses.length) return null;
  return originalClauses.map((originalClause, index): Clause => ({
    original: {
      text: originalClause.text,
      encoding: original.encoding
    },
    normalized: {
      ...normalized,
      text: normalizedClauses[index].text
    },
    start_offset: originalClause.start,
    end_offset: originalClause.end,
    index
  }));
}

function splitClauses(text: string) {
  const clauses: Array<{ text: string; start: number; end: number }> = [];
  const separator = /[;；。\n]+/gu;
  let start = 0;
  for (const match of text.matchAll(separator)) {
    const end = match.index;
    addClause(clauses, text, start, end);
    start = end + match[0].length;
  }
  addClause(clauses, text, start, text.length);
  return clauses;
}

function addClause(
  clauses: Array<{ text: string; start: number; end: number }>,
  source: string,
  start: number,
  end: number
) {
  const raw = source.slice(start, end);
  const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
  const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
  const trimmedStart = start + leading;
  const trimmedEnd = end - trailing;
  if (trimmedStart < trimmedEnd) {
    clauses.push({
      text: source.slice(trimmedStart, trimmedEnd),
      start: trimmedStart,
      end: trimmedEnd
    });
  }
}

function parseClause(clause: Clause) {
  const compact = clause.normalized.text.replace(/\s+/gu, "");
  const drafts: FactDraft[] = [];
  const warnings: RequirementParseWarning[] = [];

  const education = compact.match(/^(?:学历(?:要求)?|最低学历):?(本科|硕士|博士)(及以上|以上)?$/u);
  if (education) {
    drafts.push({
      dimension: "EDUCATION_LEVEL",
      operator: education[2] ? "AT_LEAST" : "EQUALS",
      value: { kind: "CODE", code: educationCodes[education[1] as keyof typeof educationCodes] },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    });
    return { drafts, warnings };
  }

  if (/^本硕均(?:要求|为|须为)法学(?:专业)?$/u.test(compact)) {
    for (const subjectScope of ["BACHELOR", "MASTER"] as const) {
      drafts.push(majorDraft("LAW_STUDIES", subjectScope, "AND"));
    }
    return { drafts, warnings };
  }

  const layeredMajor = compact.match(
    /^本科专业[:：]?不限[,，]硕士(?:专业)?(?:要求)?[:：]?(.+)$/u
  );
  if (layeredMajor) {
    drafts.push(unrestrictedMajorDraft("BACHELOR"));
    const codes = parseMajorCodes(layeredMajor[1]);
    if (codes.length > 0) {
      const logicOperator = codes.length > 1 ? "OR" : "AND";
      drafts.push(...codes.map((code) => majorDraft(code, "MASTER", logicOperator)));
      return { drafts, warnings };
    }
  }

  const scopedMajor = compact.match(/^(本科|硕士|博士)(?:阶段)?(?:所学)?专业(?:要求)?[:：]?(.+)$/u)
    ?? compact.match(/^(本科|硕士|博士)(?:必须|须|应)(?:为|是)(.+?)(?:专业)?$/u);
  if (scopedMajor) {
    const scope = educationScope(scopedMajor[1]);
    if (isUnrestrictedMajor(scopedMajor[2])) {
      drafts.push(unrestrictedMajorDraft(scope));
      return { drafts, warnings };
    }
    const codes = parseMajorCodes(scopedMajor[2]);
    if (codes.length > 0) {
      const logicOperator = codes.length > 1 ? "OR" : "AND";
      drafts.push(...codes.map((code) => majorDraft(code, scope, logicOperator)));
      return { drafts, warnings };
    }
  }

  if (/^(?:专业(?:要求)?[:：]?)?不限$/u.test(compact)
      || /^专业不限$/u.test(compact)) {
    drafts.push(unrestrictedMajorDraft("ANY_EDUCATION"));
    return { drafts, warnings };
  }

  if (/法律职业资格/u.test(compact)) {
    if (/优先/u.test(compact) && !/(?:必须|须|要求|应当|应取得|须取得)/u.test(compact)) {
      warnings.push({
        code: "PREFERRED_QUALIFICATION_NOT_MANDATORY",
        message: "Preferred legal qualification is preserved as evidence but not treated as mandatory",
        clause: clause.original
      });
      return { drafts, warnings };
    }
    if (/(?:必须|须|要求|应当|应取得|须取得|取得|通过|持有).*法律职业资格|法律职业资格.*(?:必须|须|要求)/u.test(compact)) {
      drafts.push({
        dimension: "PROFESSIONAL_QUALIFICATION",
        operator: "EXISTS",
        value: { kind: "CODE", code: "LEGAL_PROFESSIONAL_QUALIFICATION" },
        subject_scope: "CANDIDATE",
        logic_operator: "AND",
        polarity: "POSITIVE",
        certainty: "EXPLICIT"
      });
      return { drafts, warnings };
    }
  }

  if (/(?:专业|法学|法律|知识产权|法律硕士)/u.test(compact)) {
    const codes = parseMajorCodes(compact);
    if (codes.length > 0) {
      const logicOperator = codes.length > 1 ? "OR" : "AND";
      drafts.push(...codes.map((code) => {
        return majorDraft(code, "ANY_EDUCATION", logicOperator, "AMBIGUOUS");
      }));
      warnings.push({
        code: "AMBIGUOUS_EDUCATION_SCOPE",
        message: "Major requirement has no explicit bachelor, master, or doctor scope",
        clause: clause.original
      });
      return { drafts, warnings };
    }
  }

  warnings.push({
    code: "UNPARSED_CLAUSE",
    message: "Clause is outside the P1-08 deterministic grammar",
    clause: clause.original
  });
  return { drafts, warnings };
}

function parseMajorCodes(value: string) {
  const cleaned = value
    .replace(/^(?:专业(?:要求)?[:：]?)/u, "")
    .replace(/(?:任选其一|之一|均可)$/u, "")
    .replace(/等相关专业$/u, "")
    .replace(/相关专业$/u, "")
    .replace(/专业$/u, "");
  const tokens = cleaned.split(/[,，、/]|或/u)
    .map((token) => token.replace(/^(?:包括|限于|要求)/u, "").trim())
    .filter(Boolean);
  const codes = tokens.map((token) => majorCodes[token]).filter(Boolean);
  return [...new Set(codes)];
}

function educationScope(value: string): RequirementSubjectScope {
  if (value === "本科") return "BACHELOR";
  if (value === "硕士") return "MASTER";
  return "DOCTOR";
}

function isUnrestrictedMajor(value: string) {
  return /^(?:专业)?不限$/u.test(value);
}

function majorDraft(
  code: string,
  subjectScope: RequirementSubjectScope,
  logicOperator: "AND" | "OR",
  certainty: RequirementCertainty = "EXPLICIT"
): FactDraft {
  return {
    dimension: "MAJOR",
    operator: "EQUALS",
    value: { kind: "CODE", code },
    subject_scope: subjectScope,
    logic_operator: logicOperator,
    polarity: "POSITIVE",
    certainty
  };
}

function unrestrictedMajorDraft(subjectScope: RequirementSubjectScope): FactDraft {
  return {
    dimension: "MAJOR",
    operator: "UNRESTRICTED",
    value: { kind: "UNRESTRICTED" },
    subject_scope: subjectScope,
    logic_operator: "AND",
    polarity: "POSITIVE",
    certainty: "EXPLICIT"
  };
}

function logicGroupIdFor(
  opportunityVersion: OpportunityVersion,
  clause: Clause,
  operator: "AND" | "OR"
) {
  return `logic-group:${sha256(stableSerialize({
    opportunity_version_id: opportunityVersion.opportunity_version_id,
    clause_index: clause.index,
    operator
  }))}` as LogicGroupId;
}

function createFact(
  opportunityVersion: OpportunityVersion,
  clause: Clause,
  draft: FactDraft,
  draftIndex: number,
  logicGroupId: LogicGroupId
): RequirementFact {
  const factId = `requirement-fact:${sha256(stableSerialize({
    opportunity_version_id: opportunityVersion.opportunity_version_id,
    clause_index: clause.index,
    draft_index: draftIndex,
    draft
  }))}` as RequirementFactId;
  return {
    requirement_fact_id: factId,
    opportunity_version_id: opportunityVersion.opportunity_version_id,
    dimension: draft.dimension,
    operator: draft.operator,
    value: draft.value,
    subject_scope: draft.subject_scope,
    logic_group: {
      logic_group_id: logicGroupId,
      operator: draft.logic_operator
    },
    polarity: draft.polarity,
    certainty: draft.certainty,
    parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
  };
}

function createEvidence(
  fact: RequirementFact,
  clause: Clause,
  extractedRecord: ExtractedRecord
): RequirementEvidence {
  const evidenceId = `requirement-evidence:${sha256(stableSerialize({
    requirement_fact_id: fact.requirement_fact_id,
    snapshot_id: extractedRecord.snapshot_id,
    start_offset: clause.start_offset,
    end_offset: clause.end_offset
  }))}` as RequirementEvidenceId;
  return {
    requirement_evidence_id: evidenceId,
    requirement_fact_id: fact.requirement_fact_id,
    snapshot_id: extractedRecord.snapshot_id,
    locator: evidenceLocator(extractedRecord.source_record_locator, clause),
    evidence_text: clause.original,
    normalized_text: clause.normalized,
    extractor_name: extractedRecord.extraction.extractor_name,
    extractor_version: extractedRecord.extraction.extractor_version,
    parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
  };
}

function evidenceLocator(locator: SourceRecordLocator, clause: Clause): EvidenceLocator {
  const offsets = {
    start_offset: clause.start_offset,
    end_offset: clause.end_offset
  };
  if (locator.kind === "HTML") {
    return {
      ...offsets,
      section: locator.selector,
      field_path: locator.path
        ? `${locator.path}.raw_requirement_text`
        : "raw_requirement_text"
    };
  }
  if (locator.kind === "JSON") {
    return {
      ...offsets,
      field_path: `${locator.json_path}.raw_requirement_text`
    };
  }
  if (locator.kind === "DOCUMENT") {
    return {
      ...offsets,
      page_number: locator.page_number,
      section: locator.section,
      field_path: locator.text_locator
    };
  }
  return {
    ...offsets,
    section: locator.locator,
    field_path: "raw_requirement_text"
  };
}

function result(
  facts: readonly RequirementFact[],
  evidence: readonly RequirementEvidence[],
  warnings: readonly RequirementParseWarning[]
): RequirementParsingResult {
  return {
    facts: clone(facts),
    evidence: clone(evidence),
    warnings: clone(warnings),
    parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
  };
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

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
