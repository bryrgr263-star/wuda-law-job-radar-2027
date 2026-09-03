import { createHash } from "node:crypto";

import type {
  CandidateCohortCode,
  CompleteRequirementCompleteness,
  CompleteRequirementSet,
  EvidenceLocator,
  IsoDate,
  LogicGroupId,
  NonCompleteRequirementCompleteness,
  NonCompleteRequirementSet,
  NonEmptyReadonlyArray,
  NormalizedText,
  OriginalText,
  RequirementApplicability,
  RequirementClauseRole,
  RequirementCompletenessBlocker,
  RequirementCompletenessBlockerCode,
  RequirementEvidence,
  RequirementEvidenceFragment,
  RequirementEvidenceFragmentId,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
  RequirementObservation,
  RequirementObservationId,
  RequirementObservationStatus,
  RequirementSetId,
  RequirementSubjectScope,
  RequirementValue
} from "../domain";
import type {
  RequirementParseWarning,
  RequirementParsingBlockerInput,
  RequirementParsingInput,
  RequirementParsingResult
} from "./types";

export const DETERMINISTIC_REQUIREMENT_PARSER_VERSION =
  "deterministic-requirement-parser/2.0.0";

export const REQUIREMENT_COMPLETENESS_GATE_VERSION =
  "requirement-completeness-gate/1.0.0";

const educationCodes = {
  本科: "BACHELOR",
  硕士: "MASTER",
  研究生: "GRADUATE",
  博士: "DOCTOR"
} as const;

const degreeCodes = {
  学士: "BACHELOR_DEGREE",
  硕士: "MASTER_DEGREE",
  博士: "DOCTOR_DEGREE"
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

const cohortCodes: Readonly<Record<string, CandidateCohortCode>> = {
  应届毕业生: "FRESH_GRADUATE",
  应届生: "FRESH_GRADUATE",
  留学回国人员: "OVERSEAS_RETURNING_GRADUATE",
  留学回国毕业生: "OVERSEAS_RETURNING_GRADUATE",
  社会人员: "SOCIAL_CANDIDATE"
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
  readonly certainty: RequirementFact["certainty"];
  readonly applicability?: RequirementApplicability;
}

interface ClauseParsing {
  readonly drafts: readonly FactDraft[];
  readonly status: RequirementObservationStatus;
  readonly clause_role: RequirementClauseRole;
  readonly dimension_hint?: RequirementFact["dimension"];
  readonly warnings: readonly RequirementParseWarning[];
}

interface ParsedFragment {
  readonly facts: readonly RequirementFact[];
  readonly evidence: readonly RequirementEvidence[];
  readonly observations: readonly RequirementObservation[];
  readonly warnings: readonly RequirementParseWarning[];
}

export class DeterministicRequirementParser {
  parse(input: RequirementParsingInput): RequirementParsingResult {
    const fragments = [...input.evidence_fragments].sort(compareFragment);
    const facts: RequirementFact[] = [];
    const evidence: RequirementEvidence[] = [];
    const observations: RequirementObservation[] = [];
    const warnings: RequirementParseWarning[] = [];

    for (const fragment of fragments) {
      const parsed = parseFragment(input, fragment);
      facts.push(...parsed.facts);
      evidence.push(...parsed.evidence);
      observations.push(...parsed.observations);
      warnings.push(...parsed.warnings);
    }

    const coverage = sourceCoverage(input, fragments);
    warnings.push(...coverage.warnings);
    const blockers = buildBlockers(
      observations,
      input.blockers ?? [],
      coverage.blockers
    );
    const coveredExtractedRecordIds = uniqueSorted(
      fragments.map((fragment) => fragment.extracted_record_id)
    );
    const coveredSnapshotIds = uniqueSorted(
      fragments.map((fragment) => fragment.snapshot_id)
    );
    const observationIds = uniqueSorted(
      observations.map((observation) => observation.requirement_observation_id)
    );
    const factIds = uniqueSorted(facts.map((fact) => fact.requirement_fact_id));
    const evidenceIds = uniqueSorted(
      evidence.map((item) => item.requirement_evidence_id)
    );
    const setContent = {
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      evidence_fragments: fragments,
      observations,
      facts,
      evidence,
      covered_extracted_record_ids: coveredExtractedRecordIds,
      covered_snapshot_ids: coveredSnapshotIds,
      observation_ids: observationIds,
      fact_ids: factIds,
      evidence_ids: evidenceIds,
      gate_version: REQUIREMENT_COMPLETENESS_GATE_VERSION,
      parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
    };
    const requirementSetContentHash = sha256(stableSerialize(setContent));
    const requirementSetId = `requirement-set:${requirementSetContentHash}` as RequirementSetId;
    const completenessBase = {
      requirement_set_id: requirementSetId,
      requirement_set_content_hash: requirementSetContentHash,
      covered_extracted_record_ids: coveredExtractedRecordIds,
      covered_snapshot_ids: coveredSnapshotIds,
      observation_ids: observationIds,
      fact_ids: factIds,
      evidence_ids: evidenceIds,
      gate_version: REQUIREMENT_COMPLETENESS_GATE_VERSION
    };
    const setBase = {
      requirement_set_id: requirementSetId,
      opportunity_version_id: input.opportunity_version.opportunity_version_id,
      evidence_fragments: clone(fragments),
      observations: clone(observations),
      facts: clone(facts),
      evidence: clone(evidence),
      parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
    };

    if (blockers.length === 0) {
      const completeness: CompleteRequirementCompleteness = {
        ...completenessBase,
        status: "COMPLETE",
        blockers: []
      };
      const requirementSet: CompleteRequirementSet = {
        ...setBase,
        completeness
      };
      return result(requirementSet, warnings);
    }

    const completeness: NonCompleteRequirementCompleteness = {
      ...completenessBase,
      status: blockers.some((blocker) => isIncompleteBlocker(blocker.code))
        ? "INCOMPLETE"
        : "REVIEW_REQUIRED",
      blockers: asNonEmpty(blockers)
    };
    const requirementSet: NonCompleteRequirementSet = {
      ...setBase,
      completeness
    };
    return result(requirementSet, warnings);
  }
}

function parseFragment(
  input: RequirementParsingInput,
  fragment: RequirementEvidenceFragment
): ParsedFragment {
  if (fragment.observed_value_state === "EMPTY") {
    const observation = createObservation(
      input,
      fragment,
      0,
      "NOT_OBSERVED",
      "UNKNOWN",
      [],
      undefined
    );
    return {
      facts: [],
      evidence: [],
      observations: [observation],
      warnings: [{
        code: "EMPTY_EVIDENCE_FRAGMENT",
        message: "An empty source position remains NOT_OBSERVED and is never unrestricted"
      }]
    };
  }

  if (!fragment.original_text) {
    const observation = createObservation(
      input,
      fragment,
      0,
      "NOT_OBSERVED",
      "UNKNOWN",
      [],
      undefined
    );
    return {
      facts: [],
      evidence: [],
      observations: [observation],
      warnings: [{
        code: "EMPTY_EVIDENCE_FRAGMENT",
        message: "A TEXT fragment without original text is incomplete evidence"
      }]
    };
  }

  if (!fragment.normalized_text) {
    const observation = createObservation(
      input,
      fragment,
      0,
      "UNPARSED_CLAUSE",
      "UNKNOWN",
      [],
      undefined
    );
    return {
      facts: [],
      evidence: [],
      observations: [observation],
      warnings: [{
        code: "NORMALIZED_TEXT_MISSING",
        message: "Requirement parsing requires normalized text from the normalization layer",
        clause: fragment.original_text
      }]
    };
  }

  const clauses = alignClauses(fragment.original_text, fragment.normalized_text);
  if (!clauses) {
    const observation = createObservation(
      input,
      fragment,
      0,
      "UNPARSED_CLAUSE",
      "UNKNOWN",
      [],
      undefined
    );
    return {
      facts: [],
      evidence: [],
      observations: [observation],
      warnings: [{
        code: "CLAUSE_ALIGNMENT_FAILED",
        message: "Original and normalized requirement clauses cannot be aligned safely",
        clause: fragment.original_text
      }]
    };
  }

  if (clauses.length === 0) {
    const observation = createObservation(
      input,
      fragment,
      0,
      "NOT_OBSERVED",
      "UNKNOWN",
      [],
      undefined
    );
    return {
      facts: [],
      evidence: [],
      observations: [observation],
      warnings: [{
        code: "EMPTY_EVIDENCE_FRAGMENT",
        message: "Whitespace-only source content remains NOT_OBSERVED"
      }]
    };
  }

  const facts: RequirementFact[] = [];
  const evidence: RequirementEvidence[] = [];
  const observations: RequirementObservation[] = [];
  const warnings: RequirementParseWarning[] = [];
  for (const clause of clauses) {
    const parsed = parseClause(clause, fragment);
    const clauseFacts = parsed.drafts.map((draft, draftIndex) => {
      return createFact(input, fragment, clause, draft, draftIndex);
    });
    const clauseEvidence = clauseFacts.map((fact) => {
      return createEvidence(fact, clause, fragment);
    });
    facts.push(...clauseFacts);
    evidence.push(...clauseEvidence);
    observations.push(createObservation(
      input,
      fragment,
      clause.index,
      parsed.status,
      parsed.clause_role,
      clauseFacts.map((fact) => fact.requirement_fact_id),
      parsed.dimension_hint
    ));
    warnings.push(...parsed.warnings);
  }
  return { facts, evidence, observations, warnings };
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

function parseClause(
  clause: Clause,
  fragment: RequirementEvidenceFragment
): ClauseParsing {
  const compact = clause.normalized.text.replace(/\s+/gu, "");
  const applicability = extractApplicability(compact);
  const body = applicability?.body ?? compact;
  const apply = (draft: FactDraft): FactDraft => applicability
    ? { ...draft, applicability: applicability.value }
    : draft;

  const education = body.match(
    /^(?:学历(?:要求)?|最低学历)[:：]?(本科|硕士|研究生|博士)(及以上|以上)?$/u
  );
  if (education) {
    return confirmed([apply({
      dimension: "EDUCATION_LEVEL",
      operator: education[2] ? "AT_LEAST" : "EQUALS",
      value: {
        kind: "CODE",
        code: educationCodes[education[1] as keyof typeof educationCodes]
      },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    })], "EDUCATION_LEVEL");
  }

  const degree = body.match(/^(?:学位(?:要求)?|最低学位)[:：]?(学士|硕士|博士)(?:学位)?$/u);
  if (degree) {
    const scope = degree[1] === "学士"
      ? "BACHELOR"
      : degree[1] === "硕士"
        ? "MASTER"
        : "DOCTOR";
    return confirmed([apply({
      dimension: "ACADEMIC_DEGREE",
      operator: "EQUALS",
      value: {
        kind: "CODE",
        code: degreeCodes[degree[1] as keyof typeof degreeCodes]
      },
      subject_scope: scope,
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    })], "ACADEMIC_DEGREE");
  }

  const age = body.match(
    /^(?:年龄(?:要求)?[:：]?)?(?:不超过|不满|小于等于|≤)?(\d{1,2})周岁(?:以下|以内)?(?:[(（](?:截至|计算至)(\d{4})年(\d{1,2})月(\d{1,2})日[)）])?$/u
  );
  if (age) {
    if (!age[2]) {
      return unresolved(
        "AMBIGUOUS",
        "MANDATORY",
        "AGE",
        "AGE_REFERENCE_DATE_MISSING",
        "Age requirements need an explicit reference date",
        clause.original
      );
    }
    return confirmed([apply({
      dimension: "AGE",
      operator: "AT_MOST",
      value: {
        kind: "AGE",
        years: Number(age[1]),
        reference_date: isoDate(age[2], age[3], age[4])
      },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    })], "AGE");
  }

  const cohort = cohortFact(body);
  if (cohort) return confirmed([apply(cohort)], "CANDIDATE_COHORT");

  const household = regionFact(body, "户籍", "HOUSEHOLD_REGISTRATION");
  if (household) return confirmed([apply(household)], "HOUSEHOLD_REGISTRATION");

  const studentOrigin = regionFact(body, "生源地", "STUDENT_ORIGIN")
    ?? regionFact(body, "生源", "STUDENT_ORIGIN");
  if (studentOrigin) return confirmed([apply(studentOrigin)], "STUDENT_ORIGIN");

  if (/^本硕均(?:要求|为|须为)法学(?:专业)?$/u.test(body)) {
    return confirmed([
      apply(majorDraft({ kind: "CODE", code: "LAW_STUDIES" }, "BACHELOR", "AND")),
      apply(majorDraft({ kind: "CODE", code: "LAW_STUDIES" }, "MASTER", "AND"))
    ], "MAJOR");
  }

  const layeredMajor = body.match(
    /^本科专业[:：]?不限[,，]硕士(?:专业)?(?:要求)?[:：]?(.+)$/u
  );
  if (layeredMajor) {
    const master = parseMajorValues(layeredMajor[1], fragment, "MASTER");
    if (master.drafts.length > 0 && !master.unresolved) {
      return confirmed([
        apply(unrestrictedMajorDraft("BACHELOR")),
        ...master.drafts.map(apply)
      ], "MAJOR");
    }
    return master.unresolved ?? unparsed(clause);
  }

  const scopedMajor = body.match(
    /^(本科|硕士|研究生|博士)(?:阶段)?(?:所学)?专业(?:要求)?[:：]?(.+)$/u
  ) ?? body.match(/^(本科|硕士|研究生|博士)(?:必须|须|应)(?:为|是)(.+?)(?:专业)?$/u);
  if (scopedMajor) {
    const scope = educationScope(scopedMajor[1]);
    if (isUnrestrictedMajor(scopedMajor[2])) {
      return confirmed([apply(unrestrictedMajorDraft(scope))], "MAJOR");
    }
    const parsed = parseMajorValues(scopedMajor[2], fragment, scope);
    if (parsed.unresolved) return parsed.unresolved;
    return confirmed(parsed.drafts.map(apply), "MAJOR");
  }

  if (/^(?:专业(?:要求)?[:：]?)?不限$/u.test(body) || /^专业不限$/u.test(body)) {
    return confirmed([apply(unrestrictedMajorDraft("ANY_EDUCATION"))], "MAJOR");
  }

  if (/法律职业资格/u.test(body)) {
    if (/优先/u.test(body) && !/(?:必须|须|要求|应当|应取得|须取得)/u.test(body)) {
      return {
        drafts: [],
        status: "CONFIRMED_REQUIREMENT",
        clause_role: "PREFERRED",
        dimension_hint: "PROFESSIONAL_QUALIFICATION",
        warnings: [{
          code: "PREFERRED_QUALIFICATION_NOT_MANDATORY",
          message: "Preferred legal qualification is preserved but not treated as mandatory",
          clause: clause.original
        }]
      };
    }
    if (/(?:必须|须|要求|应当|应取得|须取得|取得|通过|持有).*法律职业资格|法律职业资格.*(?:必须|须|要求)/u.test(body)) {
      return confirmed([apply({
        dimension: "PROFESSIONAL_QUALIFICATION",
        operator: "EXISTS",
        value: { kind: "CODE", code: "LEGAL_PROFESSIONAL_QUALIFICATION" },
        subject_scope: "CANDIDATE",
        logic_operator: "AND",
        polarity: "POSITIVE",
        certainty: "EXPLICIT"
      })], "PROFESSIONAL_QUALIFICATION");
    }
  }

  if (/(?:专业|法学|法律|知识产权|法律硕士)/u.test(body)) {
    const parsed = parseMajorValues(body, fragment, "ANY_EDUCATION", "AMBIGUOUS");
    if (parsed.unresolved) return parsed.unresolved;
    return {
      drafts: parsed.drafts.map(apply),
      status: "AMBIGUOUS",
      clause_role: "UNKNOWN",
      dimension_hint: "MAJOR",
      warnings: [{
        code: "AMBIGUOUS_EDUCATION_SCOPE",
        message: "Major requirement has no explicit bachelor, master, graduate, or doctor scope",
        clause: clause.original
      }]
    };
  }

  return unparsed(clause);
}

function confirmed(
  drafts: readonly FactDraft[],
  dimensionHint: RequirementFact["dimension"]
): ClauseParsing {
  return {
    drafts,
    status: "CONFIRMED_REQUIREMENT",
    clause_role: "MANDATORY",
    dimension_hint: dimensionHint,
    warnings: []
  };
}

function unresolved(
  status: Extract<RequirementObservationStatus, "AMBIGUOUS" | "DOMAIN_GAP_OBSERVED">,
  clauseRole: RequirementClauseRole,
  dimensionHint: RequirementFact["dimension"],
  warningCode: RequirementParseWarning["code"],
  message: string,
  clause: OriginalText
): ClauseParsing {
  return {
    drafts: [],
    status,
    clause_role: clauseRole,
    dimension_hint: dimensionHint,
    warnings: [{ code: warningCode, message, clause }]
  };
}

function unparsed(clause: Clause): ClauseParsing {
  return {
    drafts: [],
    status: "UNPARSED_CLAUSE",
    clause_role: "UNKNOWN",
    warnings: [{
      code: "UNPARSED_CLAUSE",
      message: "Clause is outside the CR#8 deterministic grammar",
      clause: clause.original
    }]
  };
}

function parseMajorValues(
  value: string,
  fragment: RequirementEvidenceFragment,
  subjectScope: RequirementSubjectScope,
  certainty: RequirementFact["certainty"] = "EXPLICIT"
): { readonly drafts: readonly FactDraft[]; readonly unresolved?: ClauseParsing } {
  const cleaned = value
    .replace(/^(?:专业(?:要求)?[:：]?)/u, "")
    .replace(/(?:任选其一|之一|均可)$/u, "")
    .replace(/等相关专业$/u, "")
    .replace(/相关专业$/u, "")
    .replace(/专业$/u, "");
  const tokens = cleaned.split(/[,，、/]|或/u)
    .map((token) => token.replace(/^(?:包括|限于|要求)/u, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return { drafts: [], unresolved: unparsedText(fragment, value) };
  }

  const values: RequirementValue[] = [];
  for (const token of tokens) {
    const code = majorCodes[token];
    if (code) {
      values.push({ kind: "CODE", code });
      continue;
    }
    const programReference = parseProgramReference(token, fragment);
    if (programReference) {
      values.push(programReference);
      continue;
    }
    const hasDirectoryShapedCode = /^[A-Za-z0-9][A-Za-z0-9.-]{2,}/u.test(token);
    return {
      drafts: [],
      unresolved: unresolved(
        "DOMAIN_GAP_OBSERVED",
        "MANDATORY",
        "MAJOR",
        hasDirectoryShapedCode
          ? "ACADEMIC_PROGRAM_DIRECTORY_MISSING"
          : "UNPARSED_CLAUSE",
        hasDirectoryShapedCode
          ? "Academic program code has no evidence-backed directory namespace"
          : "Academic program text cannot be mapped without source-specific inference",
        fragment.original_text ?? { text: value, encoding: "UTF-8" }
      )
    };
  }

  const logicOperator = values.length > 1 ? "OR" : "AND";
  return {
    drafts: values.map((item) => majorDraft(
      item,
      subjectScope,
      logicOperator,
      certainty
    ))
  };
}

function unparsedText(
  fragment: RequirementEvidenceFragment,
  value: string
): ClauseParsing {
  return {
    drafts: [],
    status: "UNPARSED_CLAUSE",
    clause_role: "UNKNOWN",
    dimension_hint: "MAJOR",
    warnings: [{
      code: "UNPARSED_CLAUSE",
      message: "Major requirement has no safely parseable values",
      clause: fragment.original_text ?? { text: value, encoding: "UTF-8" }
    }]
  };
}

function parseProgramReference(
  token: string,
  fragment: RequirementEvidenceFragment
): RequirementValue | null {
  if (!fragment.academic_program_directory) return null;
  const normalizedText = fragment.normalized_text;
  if (!normalizedText) return null;
  const match = token.match(/^([A-Za-z0-9][A-Za-z0-9.-]*)(?:[(（](.+)[)）]|(.+))?$/u);
  if (!match) return null;
  const label = (match[2] ?? match[3])?.trim();
  return {
    kind: "PROGRAM_REFERENCE",
    reference: {
      ...fragment.academic_program_directory,
      program_code: match[1],
      ...(label
        ? { program_label: { ...normalizedText, text: label } }
        : {})
    }
  };
}

function cohortFact(value: string): FactDraft | null {
  const match = value.match(/^(?:人员范围|招聘对象|应聘人员)[:：]?(?:仅限|限)?(.+)$/u)
    ?? value.match(/^(?:仅限|限)(应届毕业生|应届生|留学回国人员|留学回国毕业生|社会人员)$/u);
  if (!match) return null;
  const code = cohortCodes[match[1]];
  if (!code) return null;
  return {
    dimension: "CANDIDATE_COHORT",
    operator: "EQUALS",
    value: { kind: "CODE", code },
    subject_scope: "CANDIDATE",
    logic_operator: "AND",
    polarity: "POSITIVE",
    certainty: "EXPLICIT"
  };
}

function regionFact(
  value: string,
  label: string,
  dimension: "HOUSEHOLD_REGISTRATION" | "STUDENT_ORIGIN"
): FactDraft | null {
  const match = value.match(new RegExp(`^(?:${label})(?:要求)?[:：]?(.+)$`, "u"));
  if (!match) return null;
  if (/^(?:不限|无要求)$/u.test(match[1])) {
    return {
      dimension,
      operator: "UNRESTRICTED",
      value: { kind: "UNRESTRICTED" },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    };
  }
  return {
    dimension,
    operator: "EQUALS",
    value: { kind: "CODE", code: match[1] },
    subject_scope: "CANDIDATE",
    logic_operator: "AND",
    polarity: "POSITIVE",
    certainty: "EXPLICIT"
  };
}

function extractApplicability(value: string): {
  readonly body: string;
  readonly value: RequirementApplicability;
} | null {
  const match = value.match(
    /^(应届毕业生|应届生|留学回国人员|留学回国毕业生|社会人员)(?:须|要求|应当)[:：]?(.+)$/u
  );
  if (!match) return null;
  return {
    body: match[2],
    value: {
      candidate_cohorts: [cohortCodes[match[1]]],
      operator: "ANY_OF"
    }
  };
}

function educationScope(value: string): RequirementSubjectScope {
  if (value === "本科") return "BACHELOR";
  if (value === "硕士") return "MASTER";
  if (value === "研究生") return "GRADUATE";
  return "DOCTOR";
}

function isUnrestrictedMajor(value: string) {
  return /^(?:专业)?(?:不限|无要求)$/u.test(value);
}

function majorDraft(
  value: RequirementValue,
  subjectScope: RequirementSubjectScope,
  logicOperator: "AND" | "OR",
  certainty: RequirementFact["certainty"] = "EXPLICIT"
): FactDraft {
  return {
    dimension: "MAJOR",
    operator: "EQUALS",
    value,
    subject_scope: subjectScope,
    logic_operator: logicOperator,
    polarity: "POSITIVE",
    certainty
  };
}

function unrestrictedMajorDraft(
  subjectScope: RequirementSubjectScope
): FactDraft {
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

function createFact(
  input: RequirementParsingInput,
  fragment: RequirementEvidenceFragment,
  clause: Clause,
  draft: FactDraft,
  draftIndex: number
): RequirementFact {
  const logicGroupId = `logic-group:${sha256(stableSerialize({
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    evidence_fragment_id: fragment.requirement_evidence_fragment_id,
    clause_index: clause.index,
    operator: draft.logic_operator
  }))}` as LogicGroupId;
  const requirementFactId = `requirement-fact:${sha256(stableSerialize({
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    evidence_fragment_id: fragment.requirement_evidence_fragment_id,
    clause_index: clause.index,
    draft_index: draftIndex,
    draft
  }))}` as RequirementFactId;
  return {
    requirement_fact_id: requirementFactId,
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
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
    ...(draft.applicability ? { applicability: draft.applicability } : {}),
    parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
  };
}

function createEvidence(
  fact: RequirementFact,
  clause: Clause,
  fragment: RequirementEvidenceFragment
): RequirementEvidence {
  const requirementEvidenceId = `requirement-evidence:${sha256(stableSerialize({
    requirement_fact_id: fact.requirement_fact_id,
    evidence_fragment_id: fragment.requirement_evidence_fragment_id,
    start_offset: clause.start_offset,
    end_offset: clause.end_offset
  }))}` as RequirementEvidenceId;
  return {
    requirement_evidence_id: requirementEvidenceId,
    requirement_fact_id: fact.requirement_fact_id,
    snapshot_id: fragment.snapshot_id,
    locator: evidenceLocator(fragment, clause),
    evidence_text: clause.original,
    normalized_text: clause.normalized,
    extractor_name: fragment.extractor_name,
    extractor_version: fragment.extractor_version,
    parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
  };
}

function evidenceLocator(
  fragment: RequirementEvidenceFragment,
  clause: Clause
): EvidenceLocator {
  const locator = fragment.locator;
  const offsets = {
    start_offset: clause.start_offset,
    end_offset: clause.end_offset
  };
  if (locator.kind === "HTML") {
    const baseOffset = locator.start_offset ?? 0;
    return {
      kind: "HTML",
      section: locator.selector,
      field_path: locator.field_path ?? locator.path,
      start_offset: baseOffset + clause.start_offset,
      end_offset: baseOffset + clause.end_offset
    };
  }
  if (locator.kind === "SPREADSHEET") {
    return {
      kind: "SPREADSHEET",
      sheet: locator.sheet,
      cell_or_range: locator.cell_or_range,
      field_path: locator.field_path,
      ...offsets
    };
  }
  if (locator.kind === "JSON") {
    return {
      kind: "JSON",
      json_path: locator.json_path,
      field_path: locator.field_path,
      ...offsets
    };
  }
  return {
    kind: "DOCUMENT",
    page_number: locator.page_number,
    section: locator.section,
    text_locator: locator.text_locator,
    field_path: locator.field_path,
    ...offsets
  };
}

function createObservation(
  input: RequirementParsingInput,
  fragment: RequirementEvidenceFragment,
  clauseIndex: number,
  status: RequirementObservationStatus,
  clauseRole: RequirementClauseRole,
  factIds: readonly RequirementFactId[],
  dimensionHint: RequirementFact["dimension"] | undefined
): RequirementObservation {
  const requirementObservationId = `requirement-observation:${sha256(stableSerialize({
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    evidence_fragment_id: fragment.requirement_evidence_fragment_id,
    clause_index: clauseIndex,
    status,
    clause_role: clauseRole,
    dimension_hint: dimensionHint,
    fact_ids: factIds
  }))}` as RequirementObservationId;
  return {
    requirement_observation_id: requirementObservationId,
    opportunity_version_id: input.opportunity_version.opportunity_version_id,
    status,
    clause_role: clauseRole,
    ...(dimensionHint ? { dimension_hint: dimensionHint } : {}),
    requirement_fact_ids: [...factIds],
    evidence_fragment_ids: [fragment.requirement_evidence_fragment_id],
    parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
  };
}

function sourceCoverage(
  input: RequirementParsingInput,
  fragments: readonly RequirementEvidenceFragment[]
) {
  if (input.expected_sources.length === 0) {
    return {
      warnings: [{
        code: "SOURCE_COVERAGE_MISSING" as const,
        message: "At least one expected requirement-bearing source is required"
      }],
      blockers: [{
        code: "EVIDENCE_INCOMPLETE" as const,
        observation_ids: [],
        evidence_fragment_ids: [],
        description: "No expected requirement-bearing source was declared"
      }]
    };
  }
  const observed = new Set(fragments.map((fragment) => {
    return sourceReferenceKey(fragment.extracted_record_id, fragment.snapshot_id);
  }));
  const missing = input.expected_sources.filter((source) => {
    return !observed.has(sourceReferenceKey(source.extracted_record_id, source.snapshot_id));
  });
  return {
    warnings: missing.map((source): RequirementParseWarning => ({
      code: "SOURCE_COVERAGE_MISSING",
      message: `Missing evidence for ${source.extracted_record_id} / ${source.snapshot_id}`
    })),
    blockers: missing.map((source): RequirementCompletenessBlocker => ({
      code: "EVIDENCE_INCOMPLETE",
      observation_ids: [],
      evidence_fragment_ids: [],
      description: `Expected source is not covered: ${source.extracted_record_id} / ${source.snapshot_id}`
    }))
  };
}

function sourceReferenceKey(extractedRecordId: string, snapshotId: string) {
  return `${extractedRecordId}\u0000${snapshotId}`;
}

function buildBlockers(
  observations: readonly RequirementObservation[],
  inputs: readonly RequirementParsingBlockerInput[],
  coverageBlockers: readonly RequirementCompletenessBlocker[]
) {
  const blockers: RequirementCompletenessBlocker[] = [...coverageBlockers];
  for (const observation of observations) {
    if (observation.status === "CONFIRMED_REQUIREMENT") continue;
    blockers.push({
      code: observation.status,
      observation_ids: [observation.requirement_observation_id],
      evidence_fragment_ids: [...observation.evidence_fragment_ids],
      description: blockerDescription(observation.status)
    });
  }
  blockers.push(...inputs.map((input): RequirementCompletenessBlocker => ({
    code: input.code,
    observation_ids: [],
    evidence_fragment_ids: [...(input.evidence_fragment_ids ?? [])],
    description: input.description
  })));
  return blockers.sort((left, right) => {
    return stableSerialize(left).localeCompare(stableSerialize(right));
  });
}

function blockerDescription(code: RequirementObservationStatus) {
  if (code === "NOT_OBSERVED") return "Expected requirement content was not observed";
  if (code === "UNPARSED_CLAUSE") return "A source clause was not parsed safely";
  if (code === "AMBIGUOUS") return "A source clause has unresolved semantics";
  return "A source clause is outside the approved typed Requirement Domain";
}

function isIncompleteBlocker(code: RequirementCompletenessBlockerCode) {
  return code === "NOT_OBSERVED"
    || code === "ATTACHMENT_MISSING"
    || code === "EVIDENCE_INCOMPLETE";
}

function isoDate(year: string, month: string, day: string) {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` as IsoDate;
}

function result(
  requirementSet: CompleteRequirementSet | NonCompleteRequirementSet,
  warnings: readonly RequirementParseWarning[]
): RequirementParsingResult {
  return {
    facts: clone(requirementSet.facts),
    evidence: clone(requirementSet.evidence),
    observations: clone(requirementSet.observations),
    evidence_fragments: clone(requirementSet.evidence_fragments),
    completeness: clone(requirementSet.completeness),
    requirement_set: clone(requirementSet),
    complete_requirement_set: isCompleteRequirementSet(requirementSet)
      ? clone(requirementSet)
      : null,
    warnings: clone(warnings),
    parser_version: DETERMINISTIC_REQUIREMENT_PARSER_VERSION
  };
}

function isCompleteRequirementSet(
  requirementSet: CompleteRequirementSet | NonCompleteRequirementSet
): requirementSet is CompleteRequirementSet {
  return requirementSet.completeness.status === "COMPLETE";
}

function compareFragment(
  left: RequirementEvidenceFragment,
  right: RequirementEvidenceFragment
) {
  return left.requirement_evidence_fragment_id.localeCompare(
    right.requirement_evidence_fragment_id
  );
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

function asNonEmpty<Value>(
  values: readonly Value[]
): NonEmptyReadonlyArray<Value> {
  if (values.length === 0) throw new Error("Expected a non-empty array");
  return values as NonEmptyReadonlyArray<Value>;
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
