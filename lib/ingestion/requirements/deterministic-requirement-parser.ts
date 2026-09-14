import { createHash } from "node:crypto";

import {
  CR12_ENGINE_CAPABILITIES,
  CR12_LOGIC_MODEL_VERSION,
  SOURCE_COMPOSITION_GATE_VERSION
} from "../domain";
import type {
  CandidateCredentialApplicability,
  CandidateCredentialApplicabilityId,
  CandidateCohortCode,
  CandidateStateApplicability,
  CandidateStateApplicabilityId,
  Cr11CandidateCredentialCompleteness,
  Cr11CandidateMajorIdentityDescriptor,
  Cr11ExecutionGate,
  Cr11MajorPredicateProjection,
  CompleteRequirementCompleteness,
  CompleteRequirementSet,
  ConditionalRequirementBranchSet,
  Cr12CompletenessDiagnosticCode,
  Cr12EngineCapability,
  Cr12ExecutionGateDecision,
  Cr12RequirementCompletenessBlocker,
  Cr12RequirementCondition,
  Cr12RequirementLogicNode,
  Cr12RequirementLogicTree,
  Cr12RequirementSetManifest,
  Cr12SourceCompositionState,
  Cr12StructuredRequirementSet,
  EvidenceLocator,
  IsoDate,
  LogicGroupId,
  MajorConnectorObservation,
  MajorConnectorObservationId,
  MajorDirectoryReference,
  MajorExpression,
  MajorExpressionId,
  MajorIdentity,
  MajorIdentityId,
  MajorMatchRelation,
  MajorMatchRelationId,
  MajorSemanticProjectionId,
  NonCompleteRequirementCompleteness,
  NonCompleteRequirementSet,
  NonEmptyReadonlyArray,
  NormalizedText,
  OpportunityVersionId,
  OriginalText,
  RequirementApplicability,
  RequirementClauseRole,
  RequirementConditionId,
  RequirementCompletenessBlocker,
  RequirementCompletenessBlockerCode,
  RequirementContextBinding,
  RequirementContextBindingId,
  RequirementEvidence,
  RequirementEvidenceFragment,
  RequirementEvidenceFragmentId,
  RequirementEvidenceId,
  RequirementFact,
  RequirementFactId,
  RequirementLogicNodeId,
  RequirementLogicTreeId,
  RequirementObservation,
  RequirementObservationId,
  RequirementObservationStatus,
  RequirementPredicate,
  RequirementSelectorPredicate,
  RequirementSetId,
  RequirementSubjectScope,
  RequirementValue,
  SelectorLogicNode,
  SelectorLogicNodeId,
  SelectorLogicTree,
  SourceExclusionObservation,
  SourceExclusionObservationId,
  SourceCompositionReference,
  SourceCompositionResult,
  SourceSurfaceId
} from "../domain";
import type {
  Cr11MajorMatchRelationInput,
  Cr11MajorPredicateProjectionInput,
  Cr11MajorPredicateProjectionResult,
  Cr11MajorSemanticClassificationInput,
  Cr11MajorSemanticClassificationResult,
  Cr11SourceExclusionProjectionInput,
  Cr12ConnectorClassification,
  Cr12ConnectorContext,
  Cr12LogicExpressionInput,
  Cr12LogicExpressionResult,
  Cr12LogicToken,
  Cr12StructuredRequirementParsingResult,
  Cr12StructuredRequirementSetInput,
  GeneralEligibilityClauseClassification,
  GeneralEligibilityClauseClassificationInput,
  GeneralEligibilityPredicateProjectionInput,
  Cr9LegacyProjectionInput,
  Cr9LegacyProjectionResult,
  RequirementParseWarning,
  RequirementParsingBlockerInput,
  RequirementParsingInput,
  RequirementParsingResult
} from "./types";
import { assertSourceCompositionResultIntegrity } from "./source-surface-composer";

export const DETERMINISTIC_REQUIREMENT_PARSER_VERSION =
  "deterministic-requirement-parser/3.0.0";

export const REQUIREMENT_COMPLETENESS_GATE_VERSION =
  "requirement-completeness-gate/1.0.0";

export const CR12_STRUCTURED_REQUIREMENT_PARSER_VERSION =
  "deterministic-structured-requirement-parser/1.0.0";

export const CR12_REQUIREMENT_COMPLETENESS_GATE_VERSION =
  "requirement-completeness-gate/cr12-1.0.0";

export const CR12_REQUIREMENT_SERIALIZATION_VERSION =
  "cr12-requirement-content/1.0.0";

export const CR11_MAJOR_SEMANTIC_PARSER_VERSION =
  "cr11-major-semantic-parser/1.0.0";

export const CR11_MAJOR_SEMANTIC_PROJECTION_VERSION =
  "cr11-major-semantic-projection/1.0.0";

export const CR11_MAJOR_MATCH_RELATION_ENGINE_CAPABILITY =
  "CR10_MAJOR_MATCH_RELATION_V1" as const;

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
  非应届毕业生: "NON_FRESH_GRADUATE",
  非应届生: "NON_FRESH_GRADUATE",
  在读学生: "CURRENT_STUDENT",
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

  if (classifyGeneralEligibilityClause({ original_text: clause.original }).status
      === "DOMAIN_GAP_OBSERVED") {
    return domainGap(clause);
  }

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

  const degree = body.match(
    /^(?:学位(?:要求)?|最低学位)[:：]?(学士|硕士|博士)(?:学位)?(及以上|以上)?$/u
  );
  if (degree) {
    const scope = degree[1] === "学士"
      ? "BACHELOR"
      : degree[1] === "硕士"
        ? "MASTER"
        : "DOCTOR";
    return confirmed([apply({
      dimension: "ACADEMIC_DEGREE",
      operator: degree[2] ? "AT_LEAST" : "EQUALS",
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

  const gender = body.match(/^(?:性别(?:要求)?[:：]?)?(?:仅限|限)?(男性|女性|男|女)$/u);
  if (gender) {
    return confirmed([apply({
      dimension: "GENDER",
      operator: "EQUALS",
      value: {
        kind: "CODE",
        code: gender[1] === "男性" || gender[1] === "男" ? "MALE" : "FEMALE"
      },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    })], "GENDER");
  }
  if (/^(?:性别(?:要求)?[:：]?)?(?:不限|任何)$/u.test(body)) {
    return confirmed([apply({
      dimension: "GENDER",
      operator: "UNRESTRICTED",
      value: { kind: "CODE", code: "ANY" },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    })], "GENDER");
  }

  const ageRange = body.match(
    /^(?:年龄(?:要求)?[:：]?)?(\d{1,2})周岁(以上|及以上|大于)(?:至|到|[-—~～]|[,，、])?(\d{1,2})周岁(以下|及以下|以内|不超过|小于|不满)(?:[(（](?:截至|计算至)(\d{4})年(\d{1,2})月(\d{1,2})日[)）])?$/u
  );
  if (ageRange) {
    if (!ageRange[5]) {
      return unresolved(
        "AMBIGUOUS",
        "MANDATORY",
        "AGE",
        "AGE_REFERENCE_DATE_MISSING",
        "Age range requirements need an explicit reference date",
        clause.original
      );
    }
    return confirmed([apply({
      dimension: "AGE",
      operator: "EXISTS",
      value: {
        kind: "AGE_RANGE",
        lower_bound: {
          years: Number(ageRange[1]),
          inclusive: ageRange[2] !== "大于"
        },
        upper_bound: {
          years: Number(ageRange[3]),
          inclusive: ageRange[4] !== "小于" && ageRange[4] !== "不满"
        },
        reference_date: isoDate(ageRange[5], ageRange[6], ageRange[7])
      },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    })], "AGE");
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

  const graduationCohort = body.match(
    /^(?:招聘对象|人员范围|应聘人员)?[:：]?(?:仅限|限)?(\d{4})届(应届毕业生|毕业生)?$/u
  );
  if (graduationCohort) {
    return confirmed([
      apply({
        dimension: "GRADUATION_YEAR",
        operator: "EQUALS",
        value: {
          kind: "GRADUATION_WINDOW",
          exact_graduation_year: Number(graduationCohort[1]),
          current_cohort: graduationCohort[2] === "应届毕业生"
            ? "FRESH_GRADUATE"
            : undefined
        },
        subject_scope: "CANDIDATE",
        logic_operator: "AND",
        polarity: "POSITIVE",
        certainty: "EXPLICIT"
      }),
      ...(graduationCohort[2] === "应届毕业生"
        ? [apply({
            dimension: "CANDIDATE_COHORT",
            operator: "EQUALS",
            value: { kind: "CODE", code: "FRESH_GRADUATE" },
            subject_scope: "CANDIDATE",
            logic_operator: "AND",
            polarity: "POSITIVE",
            certainty: "EXPLICIT"
          } satisfies FactDraft)]
        : [])
    ], "GRADUATION_YEAR");
  }

  const cohort = cohortFact(body);
  if (cohort) return confirmed([apply(cohort)], "CANDIDATE_COHORT");

  const experience = body.match(
    /^(?:工作经历(?:要求)?[:：]?)?(?:具有|具备)?(\d+)年以上(.+?)(?:工作)?经验(?:[(（](?:截至|计算至)(\d{4})年(\d{1,2})月(\d{1,2})日[)）])?$/u
  );
  if (experience) {
    const scopeText = experience[2].replace(/(?:相关)?工作$/u, "").trim();
    const scopeDefinition = /^(?:相关|不限|通用)$/u.test(scopeText)
      ? "UNRESOLVED"
      : "EXPLICIT";
    const draft = apply({
      dimension: "WORK_EXPERIENCE",
      operator: "AT_LEAST",
      value: {
        kind: "WORK_EXPERIENCE",
        minimum_years: Number(experience[1]),
        experience_scope: { ...clause.normalized, text: scopeText },
        ...(experience[3]
          ? { reference_date: isoDate(experience[3], experience[4], experience[5]) }
          : {}),
        scope_definition: scopeDefinition
      },
      subject_scope: "CANDIDATE",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    } satisfies FactDraft);
    if (scopeDefinition === "UNRESOLVED") {
      return {
        drafts: [draft],
        status: "AMBIGUOUS",
        clause_role: "MANDATORY",
        dimension_hint: "WORK_EXPERIENCE",
        warnings: [{
          code: "WORK_EXPERIENCE_SCOPE_UNRESOLVED",
          message: "Work-experience duration is structured but its experience scope is not defined",
          clause: clause.original
        }]
      };
    }
    return confirmed([draft], "WORK_EXPERIENCE");
  }

  const household = regionFact(body, "户籍", "HOUSEHOLD_REGISTRATION");
  if (household) return confirmed([apply(household)], "HOUSEHOLD_REGISTRATION");

  const studentOrigin = regionFact(body, "生源地", "STUDENT_ORIGIN")
    ?? regionFact(body, "生源", "STUDENT_ORIGIN");
  if (studentOrigin) return confirmed([apply(studentOrigin)], "STUDENT_ORIGIN");

  const majorRelationship = majorScopeRelationship(body);
  if (majorRelationship) {
    return confirmed([apply({
      dimension: "MAJOR_SCOPE_RELATIONSHIP",
      operator: "EQUALS",
      value: {
        kind: "MAJOR_SCOPE_RELATIONSHIP",
        relationship: {
          mode: majorRelationship,
          undergraduate_scope: "BACHELOR",
          graduate_scope: "GRADUATE"
        }
      },
      subject_scope: "ALL_EDUCATION",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    })], "MAJOR_SCOPE_RELATIONSHIP");
  }

  const majorMatch = majorMatchRule(body, fragment, clause);
  if (majorMatch) return majorMatch;

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
    /^(本科|硕士|研究生|博士)(?:阶段)?(?:所学)?(?:专业(?:要求)?)?[:：](.+)$/u
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
    if (/(?:必须|须|要求|应当|应取得|须取得|取得|通过|持有|具有).*法律职业资格|法律职业资格.*(?:必须|须|要求)/u.test(body)) {
      const qualificationClass = body.match(/([ABC])类法律职业资格/u)?.[1];
      return confirmed([apply({
        dimension: "PROFESSIONAL_QUALIFICATION",
        operator: "EXISTS",
        value: qualificationClass
          ? {
              kind: "PROFESSIONAL_QUALIFICATION",
              qualification_type: "LEGAL_PROFESSIONAL_QUALIFICATION",
              qualification_class: qualificationClass,
              strength: "REQUIRED"
            }
          : { kind: "CODE", code: "LEGAL_PROFESSIONAL_QUALIFICATION" },
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

  if (/(?:中华人民共和国国籍|政治立场|政治态度|理想信念|思想品德|遵纪守法|诚实守信|品行端正|人格健全|身体健康|身体条件|现役军人|刑事处罚|劳动教养|开除公职|失信被执行人|党纪|政纪处分)/u.test(body)) {
    return domainGap(clause);
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
      message: "Clause is outside the CR#9 deterministic grammar",
      clause: clause.original
    }]
  };
}

function domainGap(clause: Clause): ClauseParsing {
  return {
    drafts: [],
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY",
    warnings: [{
      code: "UNPARSED_CLAUSE",
      message: "Clause is deliberately excluded from the CR#9 typed Requirement Domain",
      clause: clause.original
    }]
  };
}

function majorScopeRelationship(value: string):
  | "AND"
  | "OR"
  | "HIGHEST_DEGREE_ONLY"
  | "GRADUATE_ONLY"
  | "UNDERGRADUATE_ONLY"
  | "EITHER_LEVEL"
  | null {
  if (/^(?:本科专业要求与研究生专业要求同时满足|本科和研究生专业均须满足)$/u.test(value)) {
    return "AND";
  }
  if (/^(?:本科专业要求或研究生专业要求满足其一|本科或研究生专业要求二选一)$/u.test(value)) {
    return "OR";
  }
  if (/^(?:仅比较|以)最高学历(?:对应|所学)专业(?:为准)?$/u.test(value)) {
    return "HIGHEST_DEGREE_ONLY";
  }
  if (/^(?:仅要求|只要求)研究生专业$/u.test(value)) return "GRADUATE_ONLY";
  if (/^(?:仅要求|只要求)本科专业$/u.test(value)) return "UNDERGRADUATE_ONLY";
  if (/^(?:本科或研究生任一层级专业满足即可|本科、研究生任一专业层级满足即可)$/u.test(value)) {
    return "EITHER_LEVEL";
  }
  return null;
}

function majorMatchRule(
  value: string,
  fragment: RequirementEvidenceFragment,
  clause: Clause
): ClauseParsing | null {
  const simpleRules = new Map([
    ["专业代码精确匹配", "EXACT_CODE"],
    ["专业名称精确匹配", "EXACT_NAME"],
    ["专业类别匹配", "CATEGORY"]
  ] as const);
  const simpleRule = simpleRules.get(value as never);
  if (simpleRule) {
    return confirmed([{
      dimension: "MAJOR_MATCH_RULE",
      operator: "EQUALS",
      value: {
        kind: "MAJOR_MATCH_RULE",
        rule: { kind: simpleRule, unresolved_behavior: "REVIEW_REQUIRED" }
      },
      subject_scope: "ANY_EDUCATION",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    }], "MAJOR_MATCH_RULE");
  }
  const codeSet = value.match(/^专业代码集合[:：](.+)$/u);
  if (codeSet) {
    const codes = codeSet[1].split(/[,，、]/u).map((code) => code.trim()).filter(Boolean);
    if (codes.length === 0) return unparsed(clause);
    return confirmed([{
      dimension: "MAJOR_MATCH_RULE",
      operator: "EQUALS",
      value: {
        kind: "MAJOR_MATCH_RULE",
        rule: {
          kind: "CODE_SET",
          codes: asNonEmpty(codes),
          unresolved_behavior: "REVIEW_REQUIRED"
        }
      },
      subject_scope: "ANY_EDUCATION",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    }], "MAJOR_MATCH_RULE");
  }
  if (/^专业按外部目录匹配$/u.test(value)) {
    if (!fragment.academic_program_directory) {
      return unresolved(
        "DOMAIN_GAP_OBSERVED",
        "MANDATORY",
        "MAJOR_MATCH_RULE",
        "ACADEMIC_PROGRAM_DIRECTORY_MISSING",
        "External-directory matching needs an evidence-backed directory namespace",
        clause.original
      );
    }
    return confirmed([{
      dimension: "MAJOR_MATCH_RULE",
      operator: "EQUALS",
      value: {
        kind: "MAJOR_MATCH_RULE",
        rule: {
          kind: "EXTERNAL_DIRECTORY_REFERENCE",
          ...fragment.academic_program_directory,
          unresolved_behavior: "REVIEW_REQUIRED"
        }
      },
      subject_scope: "ANY_EDUCATION",
      logic_operator: "AND",
      polarity: "POSITIVE",
      certainty: "EXPLICIT"
    }], "MAJOR_MATCH_RULE");
  }
  if (/^专业匹配按例外清单审查$/u.test(value)) {
    return {
      drafts: [{
        dimension: "MAJOR_MATCH_RULE",
        operator: "EQUALS",
        value: {
          kind: "MAJOR_MATCH_RULE",
          rule: {
            kind: "EXCEPTION_LIST",
            exception_reference: clause.normalized,
            unresolved_behavior: "REVIEW_REQUIRED"
          }
        },
        subject_scope: "ANY_EDUCATION",
        logic_operator: "AND",
        polarity: "POSITIVE",
        certainty: "EXPLICIT"
      }],
      status: "AMBIGUOUS",
      clause_role: "MANDATORY",
      dimension_hint: "MAJOR_MATCH_RULE",
      warnings: [{
        code: "MAJOR_MATCH_EXCEPTION_REQUIRES_REVIEW",
        message: "An exception-list match rule requires explicit review evidence",
        clause: clause.original
      }]
    };
  }
  return null;
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
    if (token === "法学类" || token === "法律类") {
      if (!academicProgramDirectoryFor(fragment, subjectScope)) {
        return {
          drafts: [],
          unresolved: unresolved(
            "DOMAIN_GAP_OBSERVED",
            "MANDATORY",
            "MAJOR",
            "ACADEMIC_PROGRAM_DIRECTORY_MISSING",
            "Academic major category has no evidence-backed directory namespace",
            fragment.original_text ?? { text: value, encoding: "UTF-8" }
          )
        };
      }
      values.push({
        kind: "CODE",
        code: token === "法学类" ? "LAW_STUDIES_FAMILY" : "LEGAL_PROGRAM_FAMILY",
        label: { ...fragment.normalized_text!, text: token }
      });
      continue;
    }
    const code = majorCodes[token];
    if (code) {
      values.push({ kind: "CODE", code });
      continue;
    }
    const programReference = parseProgramReference(token, fragment, subjectScope);
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
  fragment: RequirementEvidenceFragment,
  subjectScope: RequirementSubjectScope
): RequirementValue | null {
  const directory = academicProgramDirectoryFor(fragment, subjectScope);
  if (!directory) return null;
  const normalizedText = fragment.normalized_text;
  if (!normalizedText) return null;
  const codeFirst = token.match(
    /^([A-Za-z0-9][A-Za-z0-9.-]*)(?:[(（](.+)[)）]|(.+))?$/u
  );
  const labelFirst = token.match(/^(.+?)[(（]([A-Za-z0-9][A-Za-z0-9.-]*)[)）]$/u);
  if (!codeFirst && !labelFirst) return null;
  const programCode = codeFirst?.[1] ?? labelFirst![2];
  const label = (codeFirst?.[2] ?? codeFirst?.[3] ?? labelFirst?.[1])?.trim();
  return {
    kind: "PROGRAM_REFERENCE",
    reference: {
      ...directory,
      program_code: programCode,
      ...(label
        ? { program_label: { ...normalizedText, text: label } }
        : {})
    }
  };
}

function academicProgramDirectoryFor(
  fragment: RequirementEvidenceFragment,
  subjectScope: RequirementSubjectScope
) {
  if (subjectScope === "BACHELOR") {
    return fragment.academic_program_directories?.BACHELOR
      ?? fragment.academic_program_directory;
  }
  if (subjectScope === "MASTER") {
    return fragment.academic_program_directories?.MASTER
      ?? fragment.academic_program_directories?.GRADUATE
      ?? fragment.academic_program_directory;
  }
  if (subjectScope === "GRADUATE") {
    return fragment.academic_program_directories?.GRADUATE
      ?? fragment.academic_program_directories?.MASTER
      ?? fragment.academic_program_directory;
  }
  if (subjectScope === "DOCTOR") {
    return fragment.academic_program_directories?.DOCTOR
      ?? fragment.academic_program_directories?.GRADUATE
      ?? fragment.academic_program_directory;
  }
  return fragment.academic_program_directory;
}

function cohortFact(value: string): FactDraft | null {
  const match = value.match(/^(?:人员范围|招聘对象|应聘人员)[:：]?(?:仅限|限)?(.+)$/u)
    ?? value.match(/^(?:仅限|限)(应届毕业生|应届生|非应届毕业生|非应届生|在读学生|留学回国人员|留学回国毕业生|社会人员)$/u);
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
    /^(应届毕业生|应届生|非应届毕业生|非应届生|在读学生|留学回国人员|留学回国毕业生|社会人员)(?:须|要求|应当)[:：]?(.+)$/u
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

export function validateGeneralEligibilityRequirementPredicate(
  predicate: RequirementPredicate
): RequirementPredicate {
  if (predicate.source_resolution_state !== "RESOLVED"
      || predicate.temporal_relation === "UNRESOLVED"
      || predicate.source_reference_ids.length === 0
      || predicate.evidence_fragment_ids.length === 0
      || !predicate.requirement_predicate_id
      || !predicate.parser_version
      || !predicate.resolver_version
      || !predicate.schema_version) {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      "General eligibility predicates require closed, resolved source evidence"
    );
  }
  const expected = generalEligibilityPredicateContract(predicate);
  if (predicate.dimension !== expected.dimension
      || predicate.target.kind !== expected.target_kind) {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      "General eligibility predicate kind does not match its closed dimension and target"
    );
  }
  if (!generalEligibilityTargetIsComplete(predicate.target)) {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      "General eligibility predicate target is incomplete"
    );
  }
  return predicate;
}

export function projectGeneralEligibilityPredicateToCr12Fact(
  input: GeneralEligibilityPredicateProjectionInput
): RequirementFact {
  const predicate = validateGeneralEligibilityRequirementPredicate(input.predicate);
  const contract = generalEligibilityPredicateContract(predicate);
  if (!input.candidate_state_applicability_id
      || input.context_binding_ids.length === 0
      || input.polarity !== contract.polarity) {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      "General eligibility predicate projection has incompatible CR#12 bindings"
    );
  }
  return {
    requirement_fact_id: input.requirement_fact_id,
    opportunity_version_id: input.opportunity_version_id,
    dimension: predicate.dimension,
    operator: contract.operator,
    value: { kind: "GENERAL_ELIGIBILITY_PREDICATE", predicate },
    subject_scope: input.subject_scope,
    logic_group: input.logic_group,
    polarity: input.polarity,
    certainty: input.certainty,
    parser_version: input.parser_version
  };
}

export function classifyGeneralEligibilityClause(
  input: GeneralEligibilityClauseClassificationInput
): GeneralEligibilityClauseClassification {
  const text = input.original_text.text.replace(/\s+/gu, "");
  const generic = new Set([
    "品行良好",
    "身体健康",
    "符合有关法律法规规定",
    "其他不得报考情形",
    "具备良好职业素养"
  ]);
  return {
    status: generic.has(text) ? "DOMAIN_GAP_OBSERVED" : "UNPARSED_CLAUSE",
    predicate: null
  };
}

function generalEligibilityPredicateContract(predicate: RequirementPredicate): {
  readonly dimension: RequirementPredicate["dimension"];
  readonly target_kind: RequirementPredicate["target"]["kind"];
  readonly operator: RequirementFact["operator"];
  readonly polarity: RequirementFact["polarity"];
} {
  switch (predicate.predicate_kind) {
    case "CITIZENSHIP_EQUALS":
      return {
        dimension: "CITIZENSHIP_STATUS",
        target_kind: "CITIZENSHIP",
        operator: "EQUALS",
        polarity: "POSITIVE"
      };
    case "CITIZENSHIP_EXCLUDED":
      return {
        dimension: "CITIZENSHIP_STATUS",
        target_kind: "CITIZENSHIP",
        operator: "NONE_OF",
        polarity: "NEGATIVE"
      };
    case "STATUS_MUST_BE_ABSENT":
      return {
        dimension: "SERVICE_OR_ENROLMENT_STATUS",
        target_kind: "SERVICE_OR_ENROLMENT_STATUS",
        operator: "NONE_OF",
        polarity: "NEGATIVE"
      };
    case "STATUS_MUST_BE_PRESENT":
      return {
        dimension: "SERVICE_OR_ENROLMENT_STATUS",
        target_kind: "SERVICE_OR_ENROLMENT_STATUS",
        operator: "EXISTS",
        polarity: "POSITIVE"
      };
    case "DISQUALIFYING_RECORD_ABSENT":
      return {
        dimension: "DISQUALIFICATION_RECORD",
        target_kind: "DISQUALIFICATION_RECORD",
        operator: "NONE_OF",
        polarity: "NEGATIVE"
      };
    case "FORMAL_CLEARANCE_REQUIRED":
      return {
        dimension: "FORMAL_CLEARANCE_DECISION",
        target_kind: "FORMAL_CLEARANCE_DECISION",
        operator: "EQUALS",
        polarity: "POSITIVE"
      };
  }
}

function generalEligibilityTargetIsComplete(
  target: RequirementPredicate["target"]
) {
  switch (target.kind) {
    case "CITIZENSHIP":
      return Boolean(target.citizenship_code);
    case "SERVICE_OR_ENROLMENT_STATUS":
      return Boolean(target.status && target.reference_date);
    case "DISQUALIFICATION_RECORD":
      return Boolean(target.record_kind && target.authority
        && target.jurisdiction && target.reference_date);
    case "FORMAL_CLEARANCE_DECISION":
      return Boolean(target.issuer && target.decision_kind
        && target.decision_status && target.effective_from);
  }
}

export function classifyCr11MajorExpression(
  input: Cr11MajorSemanticClassificationInput
): Cr11MajorSemanticClassificationResult {
  const sourceText = cr11StripMajorPrefix(input.raw_expression.text);
  if (!sourceText) {
    return cr11UnresolvedClassification(input, "MAJOR_EXPRESSION_UNRESOLVED");
  }

  const split = cr11SplitOutsideProtectedSpans(sourceText);
  if (split.connectors.length === 0) {
    if (cr11ContainsProtectedComposite(sourceText)) {
      return cr11UnresolvedClassification(input, "PROTECTED_ATOMIC_SPAN");
    }
    const expression = cr11ClassifyAtomicExpression(input, sourceText);
    return expression.source_resolution_state === "SOURCE_RESOLVED"
      ? {
          status: "RESOLVED",
          expressions: [expression],
          connector_observations: []
        }
      : {
          status: "UNRESOLVED",
          expressions: [expression],
          connector_observations: [],
          diagnostic: expression.major_identity?.semantic_code === "LAW_0351"
            ? "DIRECTORY_VERSION_UNRESOLVED"
            : "MAJOR_EXPRESSION_UNRESOLVED"
        };
  }

  if (input.list_context !== "MAJOR_CANDIDATE_LIST") {
    return cr11UnresolvedClassification(input, "MAJOR_LIST_CONTEXT_UNPROVEN");
  }
  if (cr11ContainsProtectedComposite(sourceText)) {
    return cr11UnresolvedClassification(input, "PROTECTED_ATOMIC_SPAN");
  }

  const expressions = split.items.map((item) => {
    return cr11ClassifyAtomicExpression(input, item);
  });
  if (expressions.some((expression) => {
    return expression.source_resolution_state === "SOURCE_UNRESOLVED";
  })) {
    return {
      status: "UNRESOLVED",
      expressions: asNonEmpty(expressions),
      connector_observations: [],
      diagnostic: expressions.some((expression) => {
        return expression.major_identity?.semantic_code === "LAW_0351";
      })
        ? "DIRECTORY_VERSION_UNRESOLVED"
        : "MAJOR_EXPRESSION_UNRESOLVED"
    };
  }

  const connectorObservations = split.connectors.map((connector, index) => {
    const left = expressions[index];
    const right = expressions[index + 1];
    if (!left || !right) throw new Error("CR#11 connector has no adjacent MajorExpression");
    return {
      major_connector_observation_id: cr11Id(
        "major-connector-observation",
        { left: left.major_expression_id, right: right.major_expression_id, connector }
      ) as MajorConnectorObservationId,
      left_major_expression_id: left.major_expression_id,
      right_major_expression_id: right.major_expression_id,
      raw_connector: { text: connector, encoding: input.raw_expression.encoding },
      connector_kind: "OR",
      context: "MAJOR_CANDIDATE_LIST",
      source_resolution_state: "SOURCE_RESOLVED",
      evidence_fragment_ids: input.evidence_fragment_ids,
      source_locator: input.source_locator,
      parser_version: input.parser_version
    } satisfies MajorConnectorObservation;
  });

  return {
    status: "RESOLVED",
    expressions: asNonEmpty(expressions),
    connector_observations: connectorObservations
  };
}

export function createCr11MajorMatchRelation(
  input: Cr11MajorMatchRelationInput
): MajorMatchRelation {
  const source = input.source_major_expression;
  if (source.source_resolution_state !== "SOURCE_RESOLVED") {
    throw new Error("CR#11 MajorMatchRelation requires a source-resolved MajorExpression");
  }
  if (input.relation_kind === "DIRECTORY_MEMBERSHIP") {
    if (!cr11HasVersionedDirectory(input.directory_reference)) {
      throw new Error("CR#11 directory membership requires namespace, version, and code Evidence");
    }
  }
  if (input.relation_kind === "UNRESTRICTED" && source.major_scope !== "UNRESTRICTED") {
    throw new Error("CR#11 unrestricted relation requires an unrestricted target MajorScope");
  }
  if (input.relation_kind === "EXACT_IDENTITY") {
    const targetCode = source.major_identity?.semantic_code;
    if (!targetCode || targetCode !== input.candidate_major_identity.semantic_code) {
      throw new Error("CR#11 exact relation requires the same explicit MajorIdentity");
    }
  }

  const relationState = input.relation_kind === "NOT_ESTABLISHED"
    ? "NOT_ESTABLISHED"
    : "ESTABLISHED";
  return {
    major_match_relation_id: cr11Id("major-match-relation", {
      source_major_expression_id: source.major_expression_id,
      candidate_major_identity: input.candidate_major_identity,
      relation_kind: input.relation_kind,
      directory_reference: input.directory_reference,
      evidence_fragment_ids: input.evidence_fragment_ids,
      evidence_version: input.evidence_version,
      resolver_version: input.resolver_version
    }) as MajorMatchRelationId,
    source_major_expression_id: source.major_expression_id,
    target_semantic_type: source.semantic_type,
    ...(source.major_identity ? { target_major_identity: source.major_identity } : {}),
    target_major_scope: source.major_scope,
    candidate_major_identity: input.candidate_major_identity,
    candidate_credential_applicability_id:
      input.candidate_credential_applicability_id,
    relation_kind: input.relation_kind,
    relation_state: relationState,
    ...(input.directory_reference ? { directory_reference: input.directory_reference } : {}),
    evidence_fragment_ids: input.evidence_fragment_ids,
    source_locator: input.source_locator,
    evidence_version: input.evidence_version,
    parser_version: input.parser_version,
    resolver_version: input.resolver_version,
    certainty: input.certainty,
    required_engine_capability: CR11_MAJOR_MATCH_RELATION_ENGINE_CAPABILITY
  };
}

export function classifyCr11CandidateCredentialCompleteness(input: {
  readonly candidate_major_identity?: Cr11CandidateMajorIdentityDescriptor;
  readonly relation_kind: MajorMatchRelation["relation_kind"];
}): Cr11CandidateCredentialCompleteness {
  const candidate = input.candidate_major_identity;
  if (!candidate || candidate.provenance_state === "UNKNOWN") return "UNKNOWN";
  if (!candidate.credential_level || candidate.semantic_code === "UNRESOLVED") {
    return "PARTIAL";
  }
  if (input.relation_kind === "DIRECTORY_MEMBERSHIP" && (
    !candidate.major_code
    || !candidate.directory_namespace
    || !candidate.directory_version
  )) {
    return "PARTIAL";
  }
  return candidate.provenance_state === "COMPLETE" ? "COMPLETE" : "PARTIAL";
}

export function createCr11SourceExclusionObservation(
  input: Omit<SourceExclusionObservation, "source_exclusion_observation_id">
): SourceExclusionObservation {
  if (input.source_resolution_state !== "SOURCE_RESOLVED") {
    throw new Error("CR#11 source exclusion requires source-resolved semantics");
  }
  return {
    ...input,
    source_exclusion_observation_id: (
      cr11Id("source-exclusion-observation", input) as SourceExclusionObservationId
    )
  };
}

export function projectCr11MajorPredicatesToCr12Leaves(
  input: Cr11MajorPredicateProjectionInput
): Cr11MajorPredicateProjectionResult {
  if (input.expressions.some((expression) => {
    return expression.source_resolution_state !== "SOURCE_RESOLVED";
  })) {
    return {
      status: "UNRESOLVED",
      diagnostic: "SOURCE_SEMANTICS_UNRESOLVED",
      execution_gate: cr11ExecutionGate()
    };
  }

  const expressionIds = new Set(input.expressions.map((expression) => {
    return expression.major_expression_id;
  }));
  const relations = input.major_match_relations ?? [];
  if (relations.some((relation) => {
    return !expressionIds.has(relation.source_major_expression_id);
  })) {
    return {
      status: "UNRESOLVED",
      diagnostic: "RELATION_TARGET_MISMATCH",
      execution_gate: cr11ExecutionGate()
    };
  }

  const projections = input.expressions.map((expression, index) => {
    const relatedRelations = relations.filter((relation) => {
      return relation.source_major_expression_id === expression.major_expression_id;
    });
    const sourceOrder = input.source_order + index * 2;
    const requirementFactId = cr11Id("requirement-fact", {
      opportunity_version_id: input.opportunity_version_id,
      major_expression_id: expression.major_expression_id,
      source_order: sourceOrder,
      parser_version: input.parser_version,
      projection_version: input.projection_version
    }) as RequirementFactId;
    return {
      major_semantic_projection_id: cr11Id("major-semantic-projection", {
        requirement_fact_id: requirementFactId,
        expression,
        major_match_relations: relatedRelations,
        candidate_credential_applicability_id:
          input.candidate_credential_applicability_id,
        context_binding_ids: input.context_binding_ids,
        source_order: sourceOrder,
        parser_version: input.parser_version,
        resolver_version: input.resolver_version,
        projection_version: input.projection_version
      }) as MajorSemanticProjectionId,
      requirement_fact_id: requirementFactId,
      major_expression: expression,
      major_match_relations: relatedRelations,
      candidate_credential_applicability_id:
        input.candidate_credential_applicability_id,
      context_binding_ids: input.context_binding_ids,
      evidence_fragment_ids: expression.evidence_fragment_ids,
      source_locator: expression.source_locator,
      source_order: sourceOrder,
      source_resolution_state: expression.source_resolution_state,
      parser_version: input.parser_version,
      resolver_version: input.resolver_version,
      projection_version: input.projection_version,
      required_engine_capability: CR11_MAJOR_MATCH_RELATION_ENGINE_CAPABILITY
    } satisfies Cr11MajorPredicateProjection;
  });

  const tokens = cr11ProjectOrderedTokens(
    asNonEmpty(projections),
    input.connector_observations,
    input.context_binding_ids
  );
  if (!tokens) {
    return {
      status: "UNRESOLVED",
      diagnostic: "CONNECTOR_SEQUENCE_UNRESOLVED",
      execution_gate: cr11ExecutionGate()
    };
  }

  const facts = projections.map((projection) => {
    return {
      requirement_fact_id: projection.requirement_fact_id,
      opportunity_version_id: input.opportunity_version_id,
      dimension: "MAJOR",
      operator: projection.major_expression.major_scope === "UNRESTRICTED"
        ? "UNRESTRICTED"
        : "EQUALS",
      value: { kind: "CR11_MAJOR_SEMANTIC", projection },
      subject_scope: input.subject_scope,
      logic_group: {
        logic_group_id: cr11Id("cr11-semantic-logic-group", {
          opportunity_version_id: input.opportunity_version_id,
          major_expression_id: projection.major_expression.major_expression_id
        }) as LogicGroupId,
        operator: "AND"
      },
      polarity: "POSITIVE",
      certainty: "EXPLICIT",
      parser_version: input.parser_version
    } satisfies RequirementFact;
  });

  return {
    status: "RESOLVED",
    projections: asNonEmpty(projections),
    facts: asNonEmpty(facts),
    tokens,
    execution_gate: cr11ExecutionGate()
  };
}

export function projectCr11SourceExclusionToCr12Tokens(
  input: Cr11SourceExclusionProjectionInput
): NonEmptyReadonlyArray<Cr12LogicToken> {
  const observation = input.source_exclusion_observation;
  if (observation.source_resolution_state !== "SOURCE_RESOLVED") {
    throw new Error("CR#11 source exclusion cannot project an unresolved source");
  }
  return [{
    kind: "NOT",
    context_binding_ids: observation.context_binding_ids,
    evidence_fragment_ids: observation.evidence_fragment_ids,
    source_order: input.source_order
  }, {
    kind: "PREDICATE",
    requirement_fact_id: input.requirement_fact_id,
    context_binding_ids: observation.context_binding_ids,
    evidence_fragment_ids: observation.evidence_fragment_ids,
    source_order: input.source_order + 1
  }];
}

function cr11ClassifyAtomicExpression(
  input: Cr11MajorSemanticClassificationInput,
  rawValue: string
): MajorExpression {
  const value = cr11CanonicalMajorValue(rawValue);
  const directory = input.directory_reference;
  if (/^(?:专业)?不限$/u.test(value)) {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: input.professional_qualification
        ? "QUALIFICATION_ORIENTED"
        : "ANY_MAJOR",
      major_scope: "UNRESTRICTED",
      identity: cr11MajorIdentity(input, rawValue, "ANY_MAJOR", "UNRESTRICTED"),
      source_resolution_state: "SOURCE_RESOLVED"
    });
  }
  if (/^(?:法律硕士|法硕)\(非法学\)$/u.test(value)) {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "EXACT_IDENTITY",
      major_scope: "CLOSED",
      identity: cr11MajorIdentity(input, rawValue, "LAW_MASTER_NON_LAW", "EXACT"),
      source_resolution_state: "SOURCE_RESOLVED"
    });
  }
  if (/^(?:法律硕士|法硕)\(法学\)$/u.test(value)) {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "EXACT_IDENTITY",
      major_scope: "CLOSED",
      identity: cr11MajorIdentity(input, rawValue, "LAW_MASTER_LAW", "EXACT"),
      source_resolution_state: "SOURCE_RESOLVED"
    });
  }
  if (/^法律\(非法学\)$/u.test(value)) {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "EXACT_IDENTITY",
      major_scope: "CLOSED",
      identity: cr11MajorIdentity(input, rawValue, "LAW_NON_LAW", "EXACT"),
      source_resolution_state: "SOURCE_RESOLVED"
    });
  }
  if (/^法律\(法学\)$/u.test(value)) {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "EXACT_IDENTITY",
      major_scope: "CLOSED",
      identity: cr11MajorIdentity(input, rawValue, "LAW_LAW", "EXACT"),
      source_resolution_state: "SOURCE_RESOLVED"
    });
  }
  if (/^(?:法律\(0351\)|0351法律)$/u.test(value)) {
    const sourceResolved = cr11HasVersionedDirectory(directory)
      && directory?.program_code === "0351";
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "EXACT_IDENTITY",
      major_scope: sourceResolved ? "CLOSED" : "UNRESOLVED",
      identity: cr11MajorIdentity(
        input,
        rawValue,
        "LAW_0351",
        "DIRECTORY_REFERENCE",
        directory
      ),
      source_resolution_state: sourceResolved ? "SOURCE_RESOLVED" : "SOURCE_UNRESOLVED"
    });
  }
  if (value === "法律") {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "LAW",
      major_scope: "CLOSED",
      identity: cr11MajorIdentity(input, rawValue, "LAW_GENERAL", "EXACT"),
      source_resolution_state: "SOURCE_RESOLVED"
    });
  }
  if (value === "法学") {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "EXACT_IDENTITY",
      major_scope: "CLOSED",
      identity: cr11MajorIdentity(input, rawValue, "LAW_STUDIES", "EXACT"),
      source_resolution_state: "SOURCE_RESOLVED"
    });
  }
  if (value === "法学类" || value === "法律类") {
    const sourceResolved = Boolean(
      directory?.directory_namespace && directory.directory_version
    );
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "LAW_FAMILY",
      major_scope: sourceResolved ? "CLOSED" : "UNRESOLVED",
      identity: cr11MajorIdentity(
        input,
        rawValue,
        value === "法学类" ? "LAW_STUDIES_FAMILY" : "LEGAL_PROGRAM_FAMILY",
        "CATEGORY",
        directory
      ),
      source_resolution_state: sourceResolved ? "SOURCE_RESOLVED" : "SOURCE_UNRESOLVED"
    });
  }
  if (/^法律相关(?:专业)?$/u.test(value)) {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "LAW_RELATED",
      major_scope: "OPEN",
      identity: cr11MajorIdentity(input, rawValue, "LAW_RELATED", "OPEN_REFERENCE"),
      source_resolution_state: "SOURCE_RESOLVED"
    });
  }
  if (/(?:相关专业|相近专业|相关学科|以及其他|其他相关|^等$)/u.test(value)) {
    return cr11MajorExpression(input, rawValue, {
      semantic_type: "UNRESOLVED",
      major_scope: "UNRESOLVED",
      identity: cr11MajorIdentity(input, rawValue, "UNRESOLVED", "UNRESOLVED"),
      source_resolution_state: "SOURCE_UNRESOLVED"
    });
  }
  return cr11MajorExpression(input, rawValue, {
    semantic_type: "OTHER_EXPLICIT",
    major_scope: "CLOSED",
    identity: cr11MajorIdentity(
      input,
      rawValue,
      value === "知识产权" ? "INTELLECTUAL_PROPERTY" : "OTHER_EXPLICIT",
      "EXACT"
    ),
    source_resolution_state: "SOURCE_RESOLVED"
  });
}

function cr11MajorExpression(
  input: Cr11MajorSemanticClassificationInput,
  rawValue: string,
  semantic: {
    readonly semantic_type: MajorExpression["semantic_type"];
    readonly major_scope: MajorExpression["major_scope"];
    readonly identity: MajorIdentity;
    readonly source_resolution_state: MajorExpression["source_resolution_state"];
  }
): MajorExpression {
  const rawExpression = { text: rawValue, encoding: input.raw_expression.encoding };
  return {
    major_expression_id: cr11Id("major-expression", {
      raw_expression: rawExpression,
      semantic,
      evidence_fragment_ids: input.evidence_fragment_ids,
      source_locator: input.source_locator,
      parser_version: input.parser_version,
      resolver_version: input.resolver_version
    }) as MajorExpressionId,
    raw_expression: rawExpression,
    ...(input.normalized_expression
      ? {
          normalized_expression: {
            ...input.normalized_expression,
            text: cr11CanonicalMajorValue(rawValue)
          }
        }
      : {}),
    semantic_type: semantic.semantic_type,
    major_scope: semantic.major_scope,
    major_identity: semantic.identity,
    source_resolution_state: semantic.source_resolution_state,
    evidence_fragment_ids: input.evidence_fragment_ids,
    source_locator: input.source_locator,
    parser_version: input.parser_version,
    resolver_version: input.resolver_version
  };
}

function cr11MajorIdentity(
  input: Cr11MajorSemanticClassificationInput,
  rawValue: string,
  semanticCode: MajorIdentity["semantic_code"],
  identityKind: MajorIdentity["identity_kind"],
  directoryReference?: MajorDirectoryReference
): MajorIdentity {
  const sourceLabel = { text: rawValue, encoding: input.raw_expression.encoding };
  return {
    major_identity_id: cr11Id("major-identity", {
      source_label: sourceLabel,
      semantic_code: semanticCode,
      identity_kind: identityKind,
      directory_reference: directoryReference
    }) as MajorIdentityId,
    semantic_code: semanticCode,
    source_label: sourceLabel,
    ...(input.normalized_expression
      ? {
          normalized_label: {
            ...input.normalized_expression,
            text: cr11CanonicalMajorValue(rawValue)
          }
        }
      : {}),
    identity_kind: identityKind,
    ...(directoryReference ? { directory_reference: directoryReference } : {})
  };
}

function cr11UnresolvedClassification(
  input: Cr11MajorSemanticClassificationInput,
  diagnostic: Extract<
    Cr11MajorSemanticClassificationResult,
    { readonly status: "UNRESOLVED" }
  >["diagnostic"]
): Extract<Cr11MajorSemanticClassificationResult, { readonly status: "UNRESOLVED" }> {
  const expression = cr11MajorExpression(input, input.raw_expression.text, {
    semantic_type: "UNRESOLVED",
    major_scope: "UNRESOLVED",
    identity: cr11MajorIdentity(input, input.raw_expression.text, "UNRESOLVED", "UNRESOLVED"),
    source_resolution_state: "SOURCE_UNRESOLVED"
  });
  return {
    status: "UNRESOLVED",
    expressions: [expression],
    connector_observations: [],
    diagnostic
  };
}

function cr11ProjectOrderedTokens(
  projections: NonEmptyReadonlyArray<Cr11MajorPredicateProjection>,
  connectorObservations: readonly MajorConnectorObservation[],
  contextBindingIds: NonEmptyReadonlyArray<RequirementContextBindingId>
): NonEmptyReadonlyArray<Cr12LogicToken> | null {
  if (projections.length === 1) {
    const projection = projections[0];
    return [{
      kind: "PREDICATE",
      requirement_fact_id: projection.requirement_fact_id,
      context_binding_ids: contextBindingIds,
      evidence_fragment_ids: projection.evidence_fragment_ids,
      source_order: projection.source_order
    }];
  }
  if (connectorObservations.length !== projections.length - 1) return null;

  const tokens: Cr12LogicToken[] = [];
  for (const [index, projection] of projections.entries()) {
    if (index > 0) {
      const connector = connectorObservations[index - 1];
      const left = projections[index - 1];
      if (!connector || !left
        || connector.source_resolution_state !== "SOURCE_RESOLVED"
        || connector.connector_kind !== "OR"
        || connector.left_major_expression_id !== left.major_expression.major_expression_id
        || connector.right_major_expression_id !== projection.major_expression.major_expression_id) {
        return null;
      }
      tokens.push({
        kind: "OR",
        context_binding_ids: contextBindingIds,
        evidence_fragment_ids: connector.evidence_fragment_ids,
        source_order: left.source_order + 1
      });
    }
    tokens.push({
      kind: "PREDICATE",
      requirement_fact_id: projection.requirement_fact_id,
      context_binding_ids: contextBindingIds,
      evidence_fragment_ids: projection.evidence_fragment_ids,
      source_order: projection.source_order
    });
  }
  return asNonEmpty(tokens);
}

function cr11SplitOutsideProtectedSpans(value: string): {
  readonly items: readonly string[];
  readonly connectors: readonly string[];
} {
  const items: string[] = [];
  const connectors: string[] = [];
  let current = "";
  let parenthesisDepth = 0;
  for (const character of value) {
    if (character === "(" || character === "（") parenthesisDepth += 1;
    if ((character === ")" || character === "）") && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
    }
    if (parenthesisDepth === 0 && /[,，、/]/u.test(character)) {
      items.push(current.trim());
      connectors.push(character);
      current = "";
      continue;
    }
    current += character;
  }
  items.push(current.trim());
  return {
    items: items.filter(Boolean),
    connectors
  };
}

function cr11CanonicalMajorValue(value: string) {
  return value
    .trim()
    .replaceAll("（", "(")
    .replaceAll("）", ")")
    .replace(/^(?:专业(?:要求)?|(?:本科|硕士|研究生|博士)(?:阶段)?(?:所学)?专业(?:要求)?)[：:]?/u, "")
    .trim()
    .replace(/专业$/u, "");
}

function cr11StripMajorPrefix(value: string) {
  return value
    .trim()
    .replace(/^(?:专业(?:要求)?|(?:本科|硕士|研究生|博士)(?:阶段)?(?:所学)?专业(?:要求)?)[：:]/u, "")
    .trim();
}

function cr11ContainsProtectedComposite(value: string) {
  return /(?:双学位|联合专业|联合培养|共同培养|同时具备|兼具)/u.test(value)
    || /\d{4}[/-]\d{1,4}(?:[/-]\d{1,4})?/u.test(value)
    || /(?:岗位|职位)?(?:编号|代码)?[A-Za-z0-9-]+\/[A-Za-z0-9-]+/u.test(value);
}

function cr11HasVersionedDirectory(
  directory: MajorDirectoryReference | undefined
): directory is MajorDirectoryReference & {
  readonly directory_version: string;
  readonly program_code: string;
} {
  return Boolean(
    directory?.directory_namespace
    && directory.directory_version
    && directory.program_code
  );
}

function cr11ExecutionGate(): Cr11ExecutionGate {
  return {
    status: "NOT_ALLOWED",
    reason: "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY",
    required_engine_capability: CR11_MAJOR_MATCH_RELATION_ENGINE_CAPABILITY
  };
}

function cr11Id(prefix: string, value: unknown) {
  return `${prefix}:${sha256(stableSerialize(value))}`;
}

export type Cr12StructuredRequirementValidationCode =
  | "DUPLICATE_ID"
  | "INVALID_LOGIC_STRUCTURE"
  | "DANGLING_REFERENCE"
  | "CYCLE_DETECTED"
  | "DUPLICATE_LEAF"
  | "INVALID_UNARY_GROUP"
  | "CROSS_CONDITION_REFERENCE"
  | "CROSS_OPPORTUNITY_REFERENCE"
  | "EVIDENCE_INCOMPLETE"
  | "MANDATORY_ROOT_MISMATCH"
  | "DOUBLE_NEGATION"
  | "LEGACY_GROUP_UNRESOLVED"
  | "SOURCE_COMPOSITION_UNVERIFIED"
  | "SOURCE_COMPOSITION_REFERENCE_MISMATCH"
  | "CONTENT_HASH_MISMATCH";

export class Cr12StructuredRequirementValidationError extends Error {
  constructor(
    readonly code: Cr12StructuredRequirementValidationCode,
    message: string
  ) {
    super(message);
    this.name = "Cr12StructuredRequirementValidationError";
  }
}

export function classifyCr12Connector(input: {
  readonly token: string;
  readonly context: Cr12ConnectorContext;
  readonly inside_protected_span?: boolean;
}): Cr12ConnectorClassification {
  if (input.inside_protected_span || input.context === "PROTECTED_ATOMIC_SPAN") {
    return { status: "NON_BOOLEAN", kind: "PROTECTED_CONTENT" };
  }

  const token = input.token.trim();
  if (["AND", "且", "并且", "同时", "同时具备", "同时具有", "兼具"].includes(token)) {
    return { status: "RESOLVED", kind: "AND" };
  }
  if (["OR", "或", "任一", "任一项", "任选其一", "之一", "均可"].includes(token)) {
    return { status: "RESOLVED", kind: "OR" };
  }
  if (token === "以及") {
    return {
      status: "RESOLVED",
      kind: input.context === "MAJOR_CANDIDATE_LIST" ? "OR" : "AND"
    };
  }
  if ([":", "："].includes(token)) {
    return { status: "NON_BOOLEAN", kind: "LABEL_DELIMITER" };
  }
  if ([",", "，", "、", "/"].includes(token)) {
    return input.context === "MAJOR_CANDIDATE_LIST"
      ? { status: "RESOLVED", kind: "OR" }
      : {
          status: "UNRESOLVED",
          diagnostic_code: "LOGIC_CONNECTOR_UNRESOLVED"
        };
  }
  if ([";", "；"].includes(token)) {
    return input.context === "MAJOR_CANDIDATE_LIST"
      ? { status: "RESOLVED", kind: "OR" }
      : { status: "CLAUSE_BOUNDARY" };
  }
  return {
    status: "UNRESOLVED",
    diagnostic_code: "LOGIC_CONNECTOR_UNRESOLVED"
  };
}

export function buildCr12RequirementLogicTree(
  input: Cr12LogicExpressionInput
): Cr12LogicExpressionResult {
  const sourceOrders = input.tokens.map((token) => token.source_order);
  if (sourceOrders.some((value, index) => index > 0 && value <= sourceOrders[index - 1])) {
    return unresolvedLogic("INVALID_LOGIC_STRUCTURE", "Logic tokens must preserve unique source order");
  }

  const predicateIds = input.tokens
    .filter((token): token is Extract<Cr12LogicToken, { kind: "PREDICATE" }> => {
      return token.kind === "PREDICATE";
    })
    .map((token) => token.requirement_fact_id);
  if (new Set(predicateIds).size !== predicateIds.length) {
    return unresolvedLogic("INVALID_LOGIC_STRUCTURE", "A canonical tree cannot repeat a RequirementFact leaf");
  }

  const postfix: Cr12LogicToken[] = [];
  const operatorStack: Cr12LogicToken[] = [];
  for (const token of input.tokens) {
    if (token.kind === "PREDICATE") {
      postfix.push(token);
      continue;
    }
    if (token.kind === "LPAREN") {
      operatorStack.push(token);
      continue;
    }
    if (token.kind === "RPAREN") {
      let matched = false;
      while (operatorStack.length > 0) {
        const operator = operatorStack.pop();
        if (!operator) break;
        if (operator.kind === "LPAREN") {
          matched = true;
          break;
        }
        postfix.push(operator);
      }
      if (!matched) {
        return unresolvedLogic("INVALID_LOGIC_STRUCTURE", "Closing parenthesis has no matching opening parenthesis");
      }
      continue;
    }

    while (operatorStack.length > 0) {
      const previous = operatorStack[operatorStack.length - 1];
      if (!previous || previous.kind === "LPAREN") break;
      if (!isCr12Operator(previous)) {
        return unresolvedLogic("INVALID_LOGIC_STRUCTURE", "Invalid token on the operator stack");
      }
      const shouldPop = token.kind === "NOT"
        ? cr12OperatorPrecedence(previous.kind) > cr12OperatorPrecedence(token.kind)
        : cr12OperatorPrecedence(previous.kind) >= cr12OperatorPrecedence(token.kind);
      if (!shouldPop) break;
      postfix.push(operatorStack.pop() as Cr12LogicToken);
    }
    operatorStack.push(token);
  }

  while (operatorStack.length > 0) {
    const operator = operatorStack.pop();
    if (!operator) break;
    if (operator.kind === "LPAREN" || operator.kind === "RPAREN") {
      return unresolvedLogic("INVALID_LOGIC_STRUCTURE", "Opening parenthesis has no matching closing parenthesis");
    }
    postfix.push(operator);
  }

  const nodes: Cr12RequirementLogicNode[] = [];
  const nodeStack: RequirementLogicNodeId[] = [];
  let nodeIndex = 0;
  for (const token of postfix) {
    if (token.kind === "PREDICATE") {
      const nodeId = cr12LogicNodeId(input, token, nodeIndex++);
      nodes.push({
        requirement_logic_node_id: nodeId,
        requirement_condition_id: input.requirement_condition_id,
        kind: "PREDICATE",
        requirement_fact_id: token.requirement_fact_id,
        context_binding_ids: token.context_binding_ids,
        evidence_fragment_ids: token.evidence_fragment_ids,
        source_order: token.source_order
      });
      nodeStack.push(nodeId);
      continue;
    }
    if (!isCr12Operator(token)) {
      return unresolvedLogic("INVALID_LOGIC_STRUCTURE", "Parenthesis remained in postfix expression");
    }
    if (token.kind === "NOT") {
      const childNodeId = nodeStack.pop();
      if (!childNodeId) {
        return unresolvedLogic("NEGATION_SCOPE_UNRESOLVED", "NOT has no complete child expression");
      }
      const childNode = nodes.find((node) => {
        return node.requirement_logic_node_id === childNodeId;
      });
      if (childNode?.kind === "NOT") {
        return unresolvedLogic(
          "INVALID_LOGIC_STRUCTURE",
          "Canonical CR#12 logic rejects double negation"
        );
      }
      const nodeId = cr12LogicNodeId(input, token, nodeIndex++);
      nodes.push({
        requirement_logic_node_id: nodeId,
        requirement_condition_id: input.requirement_condition_id,
        kind: "NOT",
        child_node_id: childNodeId,
        context_binding_ids: token.context_binding_ids,
        evidence_fragment_ids: token.evidence_fragment_ids,
        source_order: token.source_order
      });
      nodeStack.push(nodeId);
      continue;
    }
    const rightNodeId = nodeStack.pop();
    const leftNodeId = nodeStack.pop();
    if (!leftNodeId || !rightNodeId) {
      return unresolvedLogic("INVALID_LOGIC_STRUCTURE", `${token.kind} requires two complete child expressions`);
    }
    const nodeId = cr12LogicNodeId(input, token, nodeIndex++);
    nodes.push({
      requirement_logic_node_id: nodeId,
      requirement_condition_id: input.requirement_condition_id,
      kind: "GROUP",
      operator: token.kind,
      child_node_ids: [leftNodeId, rightNodeId],
      context_binding_ids: token.context_binding_ids,
      evidence_fragment_ids: token.evidence_fragment_ids,
      source_order: token.source_order
    });
    nodeStack.push(nodeId);
  }

  if (nodeStack.length !== 1 || nodes.length === 0) {
    return unresolvedLogic("INVALID_LOGIC_STRUCTURE", "Logic expression does not resolve to exactly one root");
  }

  return {
    status: "RESOLVED",
    tree: {
      requirement_logic_tree_id: input.requirement_logic_tree_id,
      requirement_condition_id: input.requirement_condition_id,
      root_node_id: nodeStack[0],
      nodes: asNonEmpty(nodes),
      parser_version: input.parser_version,
      serialization_version: input.serialization_version
    }
  };
}

function unresolvedLogic(
  diagnosticCode: Extract<
    Cr12LogicExpressionResult,
    { status: "UNRESOLVED" }
  >["diagnostic_code"],
  message: string
): Cr12LogicExpressionResult {
  return { status: "UNRESOLVED", diagnostic_code: diagnosticCode, message };
}

function isCr12Operator(
  token: Cr12LogicToken
): token is Extract<Cr12LogicToken, { kind: "AND" | "OR" | "NOT" }> {
  return token.kind === "AND" || token.kind === "OR" || token.kind === "NOT";
}

function cr12OperatorPrecedence(kind: "AND" | "OR" | "NOT") {
  if (kind === "NOT") return 3;
  if (kind === "AND") return 2;
  return 1;
}

function cr12LogicNodeId(
  input: Cr12LogicExpressionInput,
  token: Cr12LogicToken,
  nodeIndex: number
) {
  return `requirement-logic-node:${sha256(stableSerialize({
    requirement_condition_id: input.requirement_condition_id,
    requirement_logic_tree_id: input.requirement_logic_tree_id,
    token,
    node_index: nodeIndex
  }))}` as RequirementLogicNodeId;
}

export function projectCr9LegacyApplicability(input: {
  readonly fact: RequirementFact;
  readonly candidate_credential_applicability_id:
    CandidateCredentialApplicabilityId;
  readonly candidate_state_applicability_id: CandidateStateApplicabilityId;
  readonly evidence_fragment_ids:
    NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly parser_version: string;
}): {
  readonly credential: CandidateCredentialApplicability;
  readonly state: CandidateStateApplicability;
} {
  const shared = {
    evidence_fragment_ids: input.evidence_fragment_ids,
    certainty: "EXPLICIT" as const,
    parser_version: input.parser_version
  };
  const credential = legacyCredentialApplicability(
    input.fact.subject_scope,
    input.candidate_credential_applicability_id,
    shared
  );
  const state: CandidateStateApplicability = input.fact.applicability
    ? {
        candidate_state_applicability_id:
          input.candidate_state_applicability_id,
        mode: input.fact.applicability.operator === "ANY_OF"
          ? "COHORT_ANY_OF"
          : "COHORT_ALL_OF",
        candidate_cohorts: input.fact.applicability.candidate_cohorts,
        ...shared
      }
    : {
        candidate_state_applicability_id:
          input.candidate_state_applicability_id,
        mode: "ALL_CANDIDATES",
        ...shared
      };
  return { credential, state };
}

function legacyCredentialApplicability(
  subjectScope: RequirementSubjectScope,
  applicabilityId: CandidateCredentialApplicabilityId,
  shared: Pick<
    CandidateCredentialApplicability,
    "evidence_fragment_ids" | "certainty" | "parser_version"
  >
): CandidateCredentialApplicability {
  const base = {
    candidate_credential_applicability_id: applicabilityId,
    ...shared
  };
  if (subjectScope === "CANDIDATE") {
    return { ...base, mode: "CANDIDATE_WIDE" };
  }
  if (subjectScope === "BACHELOR") {
    return { ...base, mode: "SPECIFIC_DEGREE", degree: "BACHELOR" };
  }
  if (subjectScope === "MASTER") {
    return { ...base, mode: "SPECIFIC_DEGREE", degree: "MASTER" };
  }
  if (subjectScope === "DOCTOR") {
    return { ...base, mode: "SPECIFIC_DEGREE", degree: "DOCTOR" };
  }
  if (subjectScope === "GRADUATE") {
    return { ...base, mode: "GRADUATE" };
  }
  if (subjectScope === "ANY_EDUCATION") {
    return {
      ...base,
      mode: "ANY_DEGREE",
      applicable_degrees: ["BACHELOR", "MASTER", "DOCTOR"]
    };
  }
  return {
    ...base,
    mode: "ALL_DEGREES",
    applicable_degrees: ["BACHELOR", "MASTER", "DOCTOR"]
  };
}

export function projectCr9LegacyFactsToCr12(
  input: Cr9LegacyProjectionInput
): Cr9LegacyProjectionResult {
  const group = input.facts[0].logic_group;
  if (input.facts.some((fact) => {
    return fact.opportunity_version_id !== input.opportunity_version_id;
  })) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_OPPORTUNITY_REFERENCE",
      "Legacy Facts must belong to the projected OpportunityVersion"
    );
  }
  if (input.facts.some((fact) => {
    return fact.logic_group.logic_group_id !== group.logic_group_id
      || fact.logic_group.operator !== group.operator
      || fact.logic_group.parent_logic_group_id !== undefined;
  })) {
    throw new Cr12StructuredRequirementValidationError(
      "LEGACY_GROUP_UNRESOLVED",
      "Legacy projection requires one complete flat LogicGroup without unresolved parents"
    );
  }

  const projected = input.facts.map((fact) => projectLegacyFact(fact, input));
  const legacyFactIds = new Set(input.facts.map((fact) => fact.requirement_fact_id));
  const evidenceByLegacyFact = new Map<RequirementFactId, RequirementEvidence[]>();
  for (const evidence of input.requirement_evidence) {
    if (!legacyFactIds.has(evidence.requirement_fact_id)) {
      throw new Cr12StructuredRequirementValidationError(
        "DANGLING_REFERENCE",
        `Legacy RequirementEvidence ${evidence.requirement_evidence_id} references a Fact outside the projection`
      );
    }
    const evidenceItems = evidenceByLegacyFact.get(evidence.requirement_fact_id) ?? [];
    evidenceItems.push(evidence);
    evidenceByLegacyFact.set(evidence.requirement_fact_id, evidenceItems);
  }
  for (const fact of input.facts) {
    if ((evidenceByLegacyFact.get(fact.requirement_fact_id)?.length ?? 0) === 0) {
      throw new Cr12StructuredRequirementValidationError(
        "EVIDENCE_INCOMPLETE",
        `Legacy Fact ${fact.requirement_fact_id} has no RequirementEvidence`
      );
    }
  }
  const projectedRequirementEvidence = projected.flatMap((item, itemIndex) => {
    const legacyFact = input.facts[itemIndex];
    const legacyEvidence = evidenceByLegacyFact.get(legacyFact.requirement_fact_id) ?? [];
    return item.facts.flatMap((projectedFact) => {
      if (projectedFact.requirement_fact_id === legacyFact.requirement_fact_id) {
        return legacyEvidence;
      }
      return legacyEvidence.map((evidence): RequirementEvidence => ({
        ...evidence,
        requirement_evidence_id:
          `requirement-evidence:cr12-projection:${sha256(stableSerialize({
            legacy_requirement_evidence_id: evidence.requirement_evidence_id,
            projected_requirement_fact_id: projectedFact.requirement_fact_id,
            parser_version: input.parser_version
          }))}` as RequirementEvidenceId,
        requirement_fact_id: projectedFact.requirement_fact_id,
        parser_version: input.parser_version
      }));
    });
  });
  const tokens: Cr12LogicToken[] = [];
  let sourceOrder = input.source_order;
  for (const [index, item] of projected.entries()) {
    if (index > 0) {
      tokens.push({
        kind: group.operator,
        context_binding_ids: input.context_binding_ids,
        evidence_fragment_ids: input.evidence_fragment_ids,
        source_order: sourceOrder++
      });
    }
    if (item.negated) {
      tokens.push({
        kind: "NOT",
        context_binding_ids: input.context_binding_ids,
        evidence_fragment_ids: input.evidence_fragment_ids,
        source_order: sourceOrder++
      });
    }
    if (item.facts.length > 1) {
      tokens.push({
        kind: "LPAREN",
        context_binding_ids: input.context_binding_ids,
        evidence_fragment_ids: input.evidence_fragment_ids,
        source_order: sourceOrder++
      });
    }
    for (const [factIndex, fact] of item.facts.entries()) {
      if (factIndex > 0) {
        tokens.push({
          kind: "OR",
          context_binding_ids: input.context_binding_ids,
          evidence_fragment_ids: input.evidence_fragment_ids,
          source_order: sourceOrder++
        });
      }
      tokens.push({
        kind: "PREDICATE",
        requirement_fact_id: fact.requirement_fact_id,
        context_binding_ids: input.context_binding_ids,
        evidence_fragment_ids: input.evidence_fragment_ids,
        source_order: sourceOrder++
      });
    }
    if (item.facts.length > 1) {
      tokens.push({
        kind: "RPAREN",
        context_binding_ids: input.context_binding_ids,
        evidence_fragment_ids: input.evidence_fragment_ids,
        source_order: sourceOrder++
      });
    }
  }

  const built = buildCr12RequirementLogicTree({
    requirement_condition_id: input.requirement_condition_id,
    requirement_logic_tree_id: input.requirement_logic_tree_id,
    tokens: asNonEmpty(tokens),
    parser_version: input.parser_version,
    serialization_version: input.serialization_version
  });
  if (built.status === "UNRESOLVED") {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      built.message
    );
  }

  return {
    projected_facts: projected.flatMap((item) => item.facts),
    projected_requirement_evidence: projectedRequirementEvidence,
    tree: built.tree,
    condition: {
      requirement_condition_id: input.requirement_condition_id,
      opportunity_version_id: input.opportunity_version_id,
      modality: "MANDATORY",
      resolution_state: "RESOLVED",
      representation_kind: "LOGIC_TREE",
      requirement_logic_tree_id: input.requirement_logic_tree_id,
      candidate_credential_applicability_id:
        input.candidate_credential_applicability_id,
      candidate_state_applicability_id:
        input.candidate_state_applicability_id,
      context_binding_ids: input.context_binding_ids,
      source_reference_ids: input.source_reference_ids,
      evidence_fragment_ids: input.evidence_fragment_ids,
      source_locator: input.source_locator,
      source_order: input.source_order,
      parser_version: input.parser_version,
      resolver_version: input.resolver_version,
      projected_from_legacy_fact_ids: input.facts.map((fact) => {
        return fact.requirement_fact_id;
      }),
      projected_from_legacy_evidence_ids: input.requirement_evidence.map((evidence) => {
        return evidence.requirement_evidence_id;
      })
    }
  };
}

function projectLegacyFact(
  fact: RequirementFact,
  input: Cr9LegacyProjectionInput
): { readonly facts: NonEmptyReadonlyArray<RequirementFact>; readonly negated: boolean } {
  const negativeOperator = fact.operator === "NOT_EQUALS" || fact.operator === "NONE_OF";
  const negativeCarriers = Number(fact.polarity === "NEGATIVE")
    + Number(negativeOperator);
  if (negativeCarriers > 1) {
    throw new Cr12StructuredRequirementValidationError(
      "DOUBLE_NEGATION",
      `Legacy Fact ${fact.requirement_fact_id} contains more than one negative carrier`
    );
  }
  if (negativeCarriers === 0) return { facts: [fact], negated: false };
  if (fact.operator === "UNRESTRICTED") {
    throw new Cr12StructuredRequirementValidationError(
      "DOUBLE_NEGATION",
      "UNRESTRICTED cannot be negated into a synthetic restriction"
    );
  }

  const values = fact.operator === "NONE_OF" && fact.value.kind === "CODE_SET"
    ? fact.value.codes.map((code, index) => ({
        kind: "CODE" as const,
        code,
        ...(fact.value.kind === "CODE_SET" && fact.value.labels?.[index]
          ? { label: fact.value.labels[index] }
          : {})
      }))
    : [fact.value];
  if (values.length === 0) {
    throw new Cr12StructuredRequirementValidationError(
      "LEGACY_GROUP_UNRESOLVED",
      `Legacy Fact ${fact.requirement_fact_id} has an empty NONE_OF value set`
    );
  }
  const projectedOperator = fact.operator === "NOT_EQUALS"
      || fact.operator === "NONE_OF"
    ? "EQUALS"
    : fact.operator;
  const projectedFacts = values.map((value, valueIndex): RequirementFact => {
    const projectedFactId = `requirement-fact:cr12-projection:${sha256(stableSerialize({
      legacy_requirement_fact_id: fact.requirement_fact_id,
      value,
      value_index: valueIndex,
      operator: projectedOperator,
      polarity: "POSITIVE",
      parser_version: input.parser_version
    }))}` as RequirementFactId;
    const projectedLogicGroupId = `logic-group:cr12-projection:${sha256(stableSerialize({
      legacy_logic_group_id: fact.logic_group.logic_group_id,
      requirement_condition_id: input.requirement_condition_id,
      value_index: valueIndex
    }))}` as LogicGroupId;
    return {
      ...fact,
      requirement_fact_id: projectedFactId,
      operator: projectedOperator,
      value,
      logic_group: {
        logic_group_id: projectedLogicGroupId,
        operator: fact.logic_group.operator
      },
      polarity: "POSITIVE",
      parser_version: input.parser_version
    };
  });
  return {
    negated: true,
    facts: asNonEmpty(projectedFacts)
  };
}

export function buildCr12StructuredRequirementSet(
  input: Cr12StructuredRequirementSetInput
): Cr12StructuredRequirementParsingResult {
  const sourceComposition = sourceCompositionContractFromInput(input);
  const blockers = validateCr12StructuredInput(input);
  const status = cr12CompletenessStatus(blockers);
  const requiredCapabilities = requiredCr12Capabilities(
    input,
    sourceComposition.state
  );
  const manifest = cr12Manifest(
    input,
    blockers,
    requiredCapabilities,
    sourceComposition
  );
  const executionGate = evaluateCr12ExecutionCapability({
    completeness_status: status,
    required_capabilities: requiredCapabilities,
    supported_capabilities: input.supported_engine_capabilities ?? []
  });
  const content = cr12HashableContent({
    opportunity_version_id: input.opportunity_version_id,
    source_composition_state: sourceComposition.state,
    source_composition_reference: sourceComposition.reference,
    mandatory_root: input.mandatory_root,
    condition_registry: input.conditions,
    requirement_logic_tree_registry: input.requirement_logic_trees,
    fact_registry: input.facts,
    candidate_credential_applicability_registry:
      input.candidate_credential_applicabilities,
    candidate_state_applicability_registry:
      input.candidate_state_applicabilities,
    context_binding_registry: input.context_bindings,
    source_reference_registry: input.source_references,
    selector_predicate_registry: input.selector_predicates,
    selector_logic_tree_registry: input.selector_logic_trees,
    conditional_branch_set_registry: input.conditional_branch_sets,
    evidence_fragment_registry: input.evidence_fragments,
    requirement_evidence_registry: input.requirement_evidence,
    observation_registry: input.observations,
    completeness_status: status,
    completeness_blockers: blockers,
    gate_version: CR12_REQUIREMENT_COMPLETENESS_GATE_VERSION,
    manifest,
    parser_version: input.parser_version,
    resolver_version: input.resolver_version
  });
  const requirementSetContentHash = sha256(stableSerialize(content));
  const requirementSetId = `requirement-set:${requirementSetContentHash}` as RequirementSetId;
  const structuredRequirementSet: Cr12StructuredRequirementSet = {
    logic_model_version: CR12_LOGIC_MODEL_VERSION,
    requirement_set_id: requirementSetId,
    opportunity_version_id: input.opportunity_version_id,
    source_composition_state: sourceComposition.state,
    source_composition_reference: sourceComposition.reference,
    mandatory_root: clone(input.mandatory_root),
    condition_registry: clone(input.conditions),
    requirement_logic_tree_registry: clone(input.requirement_logic_trees),
    fact_registry: clone(input.facts),
    candidate_credential_applicability_registry: clone(
      input.candidate_credential_applicabilities
    ),
    candidate_state_applicability_registry: clone(
      input.candidate_state_applicabilities
    ),
    context_binding_registry: clone(input.context_bindings),
    source_reference_registry: clone(input.source_references),
    selector_predicate_registry: clone(input.selector_predicates),
    selector_logic_tree_registry: clone(input.selector_logic_trees),
    conditional_branch_set_registry: clone(input.conditional_branch_sets),
    evidence_fragment_registry: clone(input.evidence_fragments),
    requirement_evidence_registry: clone(input.requirement_evidence),
    observation_registry: clone(input.observations),
    completeness: {
      status,
      blockers: clone(blockers),
      manifest,
      requirement_set_content_hash: requirementSetContentHash,
      gate_version: CR12_REQUIREMENT_COMPLETENESS_GATE_VERSION
    },
    execution_manifest: {
      logic_model_version: CR12_LOGIC_MODEL_VERSION,
      required_engine_capabilities: requiredCapabilities,
      execution_gate: executionGate
    },
    parser_version: input.parser_version,
    resolver_version: input.resolver_version
  };
  assertCr12StructuredRequirementSetIntegrity(structuredRequirementSet);
  return {
    structured_requirement_set: structuredRequirementSet,
    complete_requirement_set: null
  };
}

interface SourceCompositionContract {
  readonly state: Cr12SourceCompositionState;
  readonly reference: SourceCompositionReference | null;
}

function sourceCompositionContractFromInput(
  input: Cr12StructuredRequirementSetInput
): SourceCompositionContract {
  if (!input.source_composition_result) {
    return { state: "LEGACY_UNCOMPOSED", reference: null };
  }
  let result: SourceCompositionResult;
  try {
    result = assertSourceCompositionResultIntegrity(input.source_composition_result);
  } catch (error) {
    throw new Cr12StructuredRequirementValidationError(
      "SOURCE_COMPOSITION_UNVERIFIED",
      error instanceof Error
        ? `Source Composition Result is not integrity-verified: ${error.message}`
        : "Source Composition Result is not integrity-verified"
    );
  }
  if (result.status !== "COMPLETE") {
    throw new Cr12StructuredRequirementValidationError(
      "SOURCE_COMPOSITION_UNVERIFIED",
      "CR#12 composition-backed construction requires a COMPLETE Source Composition Result"
    );
  }
  if (result.opportunity_version_id !== input.opportunity_version_id) {
    throw new Cr12StructuredRequirementValidationError(
      "SOURCE_COMPOSITION_REFERENCE_MISMATCH",
      "Source Composition Result belongs to another OpportunityVersion"
    );
  }
  validateCompositionSourceReferences(input, result);
  return {
    state: "COMPOSITION_BACKED",
    reference: {
      source_composition_id: result.source_composition_id,
      opportunity_version_id: result.opportunity_version_id,
      composition_hash: result.composition_hash,
      composition_manifest_hash: result.composition_manifest_hash,
      composition_status: "COMPLETE",
      composition_as_of: result.composition_as_of,
      composition_schema_version: result.schema_version,
      composition_gate_version: SOURCE_COMPOSITION_GATE_VERSION
    }
  };
}

function validateCompositionSourceReferences(
  input: Cr12StructuredRequirementSetInput,
  result: SourceCompositionResult
) {
  const materialSurfaceIds = new Set<SourceSurfaceId>(
    result.inventory.expected_surface_entries
      .filter((entry) => {
        return entry.expectedness === "REQUIRED"
          && entry.coverage_status === "COVERED"
          && entry.resolution_status === "RESOLVED"
          && entry.source_surface_id !== null;
      })
      .map((entry) => entry.source_surface_id as SourceSurfaceId)
  );
  const surfaces = new Map(result.source_surfaces.map((surface) => {
    return [surface.source_surface_id, surface] as const;
  }));
  for (const source of input.source_references) {
    if (!source.source_surface_id
        || !materialSurfaceIds.has(source.source_surface_id)) {
      throw new Cr12StructuredRequirementValidationError(
        "SOURCE_COMPOSITION_REFERENCE_MISMATCH",
        `Requirement Source Reference ${source.requirement_source_reference_id} does not trace to a selected material SourceSurface`
      );
    }
    const surface = surfaces.get(source.source_surface_id);
    if (!surface || surface.snapshot_id !== source.snapshot_id
        || surface.extracted_record_id !== source.extracted_record_id) {
      throw new Cr12StructuredRequirementValidationError(
        "SOURCE_COMPOSITION_REFERENCE_MISMATCH",
        `Requirement Source Reference ${source.requirement_source_reference_id} does not match SourceSurface provenance`
      );
    }
  }
}

function sourceCompositionContractFromStructured(
  requirementSet: Cr12StructuredRequirementSet
): SourceCompositionContract {
  const reference = requirementSet.source_composition_reference;
  if (requirementSet.source_composition_state === "LEGACY_UNCOMPOSED") {
    if (reference) {
      throw new Cr12StructuredRequirementValidationError(
        "SOURCE_COMPOSITION_REFERENCE_MISMATCH",
        "LEGACY_UNCOMPOSED Requirement Set cannot carry a Composition reference"
      );
    }
    return { state: "LEGACY_UNCOMPOSED", reference: null };
  }
  if (!reference
      || reference.opportunity_version_id !== requirementSet.opportunity_version_id
      || reference.composition_status !== "COMPLETE"
      || !reference.composition_as_of
      || !reference.composition_hash
      || !reference.composition_manifest_hash
      || reference.composition_gate_version !== SOURCE_COMPOSITION_GATE_VERSION) {
    throw new Cr12StructuredRequirementValidationError(
      "SOURCE_COMPOSITION_REFERENCE_MISMATCH",
      "COMPOSITION_BACKED Requirement Set requires one exact COMPLETE Composition reference"
    );
  }
  return { state: "COMPOSITION_BACKED", reference };
}

function requiredCr12Capabilities(
  input: Pick<
    Cr12StructuredRequirementSetInput,
    | "requirement_logic_trees"
    | "facts"
    | "selector_logic_trees"
    | "selector_predicates"
    | "conditional_branch_sets"
  >,
  sourceCompositionState: Cr12SourceCompositionState
): NonEmptyReadonlyArray<Cr12EngineCapability> {
  const usesNot = input.requirement_logic_trees.some((tree) => {
    return tree.nodes.some((node) => node.kind === "NOT");
  }) || input.selector_logic_trees.some((tree) => {
    return tree.nodes.some((node) => node.kind === "NOT");
  });
  const usesConditionalSelector = input.conditional_branch_sets.length > 0
    || input.selector_predicates.length > 0
    || input.selector_logic_trees.length > 0;
  const usesCr11MajorMatchRelation = input.facts.some((fact) => {
    return fact.value.kind === "CR11_MAJOR_SEMANTIC";
  });
  const usesGeneralEligibilityPredicate = input.facts.some((fact) => {
    return fact.value.kind === "GENERAL_ELIGIBILITY_PREDICATE";
  });
  const capabilities = CR12_ENGINE_CAPABILITIES.filter((capability) => {
    if (capability === "NOT_V1") return usesNot;
    if (capability === "CONDITIONAL_SELECTOR_V1") {
      return usesConditionalSelector;
    }
    if (capability === "CR10_MAJOR_MATCH_RELATION_V1") {
      return usesCr11MajorMatchRelation;
    }
    if (capability === "GENERAL_ELIGIBILITY_PREDICATE_V1") {
      return usesGeneralEligibilityPredicate;
    }
    if (capability === "SOURCE_COMPOSITION_GATE_V1") {
      return sourceCompositionState === "COMPOSITION_BACKED";
    }
    return true;
  });
  return asNonEmpty(uniqueSorted(capabilities));
}

export function evaluateCr12ExecutionCapability(input: {
  readonly completeness_status: "COMPLETE" | "INCOMPLETE" | "REVIEW_REQUIRED";
  readonly required_capabilities: NonEmptyReadonlyArray<Cr12EngineCapability>;
  readonly supported_capabilities: readonly Cr12EngineCapability[];
}): Cr12ExecutionGateDecision {
  const supported = uniqueSorted(input.supported_capabilities);
  const required = uniqueSorted(input.required_capabilities);
  const missing = required.filter((capability) => !supported.includes(capability));
  if (input.completeness_status !== "COMPLETE") {
    return {
      status: "NOT_ALLOWED",
      reason: "REQUIREMENT_SET_NOT_COMPLETE",
      required_capabilities: required,
      supported_capabilities: supported,
      missing_capabilities: missing
    };
  }
  if (missing.length > 0) {
    return {
      status: "NOT_ALLOWED",
      reason: "BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY",
      required_capabilities: required,
      supported_capabilities: supported,
      missing_capabilities: missing
    };
  }
  return {
    status: "ALLOWED",
    reason: "ENGINE_CAPABILITIES_SATISFIED",
    required_capabilities: required,
    supported_capabilities: supported
  };
}

export function assertCr12StructuredRequirementSetIntegrity(
  requirementSet: Cr12StructuredRequirementSet
) {
  const sourceComposition = sourceCompositionContractFromStructured(requirementSet);
  const manifest = cr12Manifest({
    opportunity_version_id: requirementSet.opportunity_version_id,
    mandatory_root: requirementSet.mandatory_root,
    conditions: requirementSet.condition_registry,
    requirement_logic_trees: requirementSet.requirement_logic_tree_registry,
    facts: requirementSet.fact_registry,
    candidate_credential_applicabilities:
      requirementSet.candidate_credential_applicability_registry,
    candidate_state_applicabilities:
      requirementSet.candidate_state_applicability_registry,
    context_bindings: requirementSet.context_binding_registry,
    source_references: requirementSet.source_reference_registry,
    selector_predicates: requirementSet.selector_predicate_registry,
    selector_logic_trees: requirementSet.selector_logic_tree_registry,
    conditional_branch_sets: requirementSet.conditional_branch_set_registry,
    evidence_fragments: requirementSet.evidence_fragment_registry,
    requirement_evidence: requirementSet.requirement_evidence_registry,
    observations: requirementSet.observation_registry,
    parser_version: requirementSet.parser_version,
    resolver_version: requirementSet.resolver_version,
    serialization_version:
      requirementSet.completeness.manifest.serialization_version
  }, requirementSet.completeness.blockers, asNonEmpty(
    requirementSet.execution_manifest.required_engine_capabilities
  ), sourceComposition);
  if (stableSerialize(manifest)
      !== stableSerialize(requirementSet.completeness.manifest)) {
    throw new Cr12StructuredRequirementValidationError(
      "CONTENT_HASH_MISMATCH",
      "CR#12 Requirement Set manifest does not match its registries"
    );
  }
  const expectedHash = sha256(stableSerialize(cr12HashableContent({
    opportunity_version_id: requirementSet.opportunity_version_id,
    source_composition_state: sourceComposition.state,
    source_composition_reference: sourceComposition.reference,
    mandatory_root: requirementSet.mandatory_root,
    condition_registry: requirementSet.condition_registry,
    requirement_logic_tree_registry:
      requirementSet.requirement_logic_tree_registry,
    fact_registry: requirementSet.fact_registry,
    candidate_credential_applicability_registry:
      requirementSet.candidate_credential_applicability_registry,
    candidate_state_applicability_registry:
      requirementSet.candidate_state_applicability_registry,
    context_binding_registry: requirementSet.context_binding_registry,
    source_reference_registry: requirementSet.source_reference_registry,
    selector_predicate_registry: requirementSet.selector_predicate_registry,
    selector_logic_tree_registry: requirementSet.selector_logic_tree_registry,
    conditional_branch_set_registry:
      requirementSet.conditional_branch_set_registry,
    evidence_fragment_registry: requirementSet.evidence_fragment_registry,
    requirement_evidence_registry:
      requirementSet.requirement_evidence_registry,
    observation_registry: requirementSet.observation_registry,
    completeness_status: requirementSet.completeness.status,
    completeness_blockers: requirementSet.completeness.blockers,
    gate_version: requirementSet.completeness.gate_version,
    manifest,
    parser_version: requirementSet.parser_version,
    resolver_version: requirementSet.resolver_version
  })));
  if (expectedHash !== requirementSet.completeness.requirement_set_content_hash
      || requirementSet.requirement_set_id !== `requirement-set:${expectedHash}`) {
    throw new Cr12StructuredRequirementValidationError(
      "CONTENT_HASH_MISMATCH",
      "CR#12 Requirement Set content changed after hashing"
    );
  }
  const executionGate = requirementSet.execution_manifest.execution_gate;
  const semanticRequiredCapabilities = requiredCr12Capabilities({
    requirement_logic_trees: requirementSet.requirement_logic_tree_registry,
    facts: requirementSet.fact_registry,
    selector_logic_trees: requirementSet.selector_logic_tree_registry,
    selector_predicates: requirementSet.selector_predicate_registry,
    conditional_branch_sets: requirementSet.conditional_branch_set_registry
  }, sourceComposition.state);
  const expectedExecutionGate = evaluateCr12ExecutionCapability({
    completeness_status: requirementSet.completeness.status,
    required_capabilities: semanticRequiredCapabilities,
    supported_capabilities: executionGate.supported_capabilities
  });
  if (requirementSet.execution_manifest.logic_model_version
        !== CR12_LOGIC_MODEL_VERSION
      || !sameStringSet(
        requirementSet.execution_manifest.required_engine_capabilities,
        semanticRequiredCapabilities
      )
      || stableSerialize(expectedExecutionGate) !== stableSerialize(executionGate)) {
    throw new Cr12StructuredRequirementValidationError(
      "CONTENT_HASH_MISMATCH",
      "CR#12 execution capability manifest is internally inconsistent"
    );
  }
}

function cr12HashableContent(input: {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly source_composition_state: Cr12SourceCompositionState;
  readonly source_composition_reference: SourceCompositionReference | null;
  readonly mandatory_root: Cr12StructuredRequirementSet["mandatory_root"];
  readonly condition_registry: Cr12StructuredRequirementSet["condition_registry"];
  readonly requirement_logic_tree_registry:
    Cr12StructuredRequirementSet["requirement_logic_tree_registry"];
  readonly fact_registry: Cr12StructuredRequirementSet["fact_registry"];
  readonly candidate_credential_applicability_registry:
    Cr12StructuredRequirementSet["candidate_credential_applicability_registry"];
  readonly candidate_state_applicability_registry:
    Cr12StructuredRequirementSet["candidate_state_applicability_registry"];
  readonly context_binding_registry:
    Cr12StructuredRequirementSet["context_binding_registry"];
  readonly source_reference_registry:
    Cr12StructuredRequirementSet["source_reference_registry"];
  readonly selector_predicate_registry:
    Cr12StructuredRequirementSet["selector_predicate_registry"];
  readonly selector_logic_tree_registry:
    Cr12StructuredRequirementSet["selector_logic_tree_registry"];
  readonly conditional_branch_set_registry:
    Cr12StructuredRequirementSet["conditional_branch_set_registry"];
  readonly evidence_fragment_registry:
    Cr12StructuredRequirementSet["evidence_fragment_registry"];
  readonly requirement_evidence_registry:
    Cr12StructuredRequirementSet["requirement_evidence_registry"];
  readonly observation_registry:
    Cr12StructuredRequirementSet["observation_registry"];
  readonly completeness_status: Cr12StructuredRequirementSet["completeness"]["status"];
  readonly completeness_blockers:
    Cr12StructuredRequirementSet["completeness"]["blockers"];
  readonly gate_version: string;
  readonly manifest: Cr12RequirementSetManifest;
  readonly parser_version: string;
  readonly resolver_version: string;
}) {
  return {
    logic_model_version: CR12_LOGIC_MODEL_VERSION,
    ...input
  };
}

function cr12Manifest(input: Pick<
  Cr12StructuredRequirementSetInput,
  | "opportunity_version_id"
  | "mandatory_root"
  | "conditions"
  | "requirement_logic_trees"
  | "facts"
  | "candidate_credential_applicabilities"
  | "candidate_state_applicabilities"
  | "context_bindings"
  | "source_references"
  | "selector_predicates"
  | "selector_logic_trees"
  | "conditional_branch_sets"
  | "evidence_fragments"
  | "requirement_evidence"
  | "observations"
  | "parser_version"
  | "resolver_version"
  | "serialization_version"
>, blockers: readonly Cr12RequirementCompletenessBlocker[], requiredCapabilities:
NonEmptyReadonlyArray<Cr12EngineCapability>, sourceComposition: SourceCompositionContract): Cr12RequirementSetManifest {
  return {
    logic_model_version: CR12_LOGIC_MODEL_VERSION,
    opportunity_version_id: input.opportunity_version_id,
    source_composition_state: sourceComposition.state,
    source_composition_reference: sourceComposition.reference,
    requirement_mandatory_root_id:
      input.mandatory_root.requirement_mandatory_root_id,
    requirement_condition_ids: uniqueSorted(input.conditions.map((item) => {
      return item.requirement_condition_id;
    })),
    requirement_logic_tree_ids: uniqueSorted(input.requirement_logic_trees.map((item) => {
      return item.requirement_logic_tree_id;
    })),
    requirement_logic_node_ids: uniqueSorted(input.requirement_logic_trees.flatMap((tree) => {
      return tree.nodes.map((node) => node.requirement_logic_node_id);
    })),
    requirement_fact_ids: uniqueSorted(input.facts.map((item) => {
      return item.requirement_fact_id;
    })),
    candidate_credential_applicability_ids: uniqueSorted(
      input.candidate_credential_applicabilities.map((item) => {
        return item.candidate_credential_applicability_id;
      })
    ),
    candidate_state_applicability_ids: uniqueSorted(
      input.candidate_state_applicabilities.map((item) => {
        return item.candidate_state_applicability_id;
      })
    ),
    requirement_context_binding_ids: uniqueSorted(input.context_bindings.map((item) => {
      return item.requirement_context_binding_id;
    })),
    requirement_source_reference_ids: uniqueSorted(input.source_references.map((item) => {
      return item.requirement_source_reference_id;
    })),
    requirement_selector_predicate_ids: uniqueSorted(input.selector_predicates.map((item) => {
      return item.requirement_selector_predicate_id;
    })),
    selector_logic_tree_ids: uniqueSorted(input.selector_logic_trees.map((item) => {
      return item.selector_logic_tree_id;
    })),
    selector_logic_node_ids: uniqueSorted(input.selector_logic_trees.flatMap((tree) => {
      return tree.nodes.map((node) => node.selector_logic_node_id);
    })),
    conditional_branch_set_ids: uniqueSorted(input.conditional_branch_sets.map((item) => {
      return item.conditional_branch_set_id;
    })),
    evidence_fragment_ids: uniqueSorted(input.evidence_fragments.map((item) => {
      return item.requirement_evidence_fragment_id;
    })),
    requirement_evidence_ids: uniqueSorted(input.requirement_evidence.map((item) => {
      return item.requirement_evidence_id;
    })),
    observation_ids: uniqueSorted(input.observations.map((item) => {
      return item.requirement_observation_id;
    })),
    completeness_blocker_fingerprints: uniqueSorted(blockers.map((blocker) => {
      return sha256(stableSerialize(blocker));
    })),
    snapshot_ids: uniqueSorted([
      ...input.evidence_fragments.map((item) => item.snapshot_id),
      ...input.source_references.map((item) => item.snapshot_id)
    ]),
    extracted_record_ids: uniqueSorted([
      ...input.evidence_fragments.map((item) => item.extracted_record_id),
      ...input.source_references.map((item) => item.extracted_record_id)
    ]),
    parser_versions: uniqueSorted([
      input.parser_version,
      ...input.conditions.map((item) => item.parser_version),
      ...input.requirement_logic_trees.map((item) => item.parser_version),
      ...input.facts.map((item) => item.parser_version),
      ...input.candidate_credential_applicabilities.map((item) => item.parser_version),
      ...input.candidate_state_applicabilities.map((item) => item.parser_version),
      ...input.source_references.map((item) => item.parser_version),
      ...input.selector_predicates.map((item) => item.parser_version),
      ...input.selector_logic_trees.map((item) => item.parser_version),
      ...input.conditional_branch_sets.map((item) => item.parser_version),
      ...input.evidence_fragments.map((item) => item.parser_version),
      ...input.requirement_evidence.map((item) => item.parser_version),
      ...input.observations.map((item) => item.parser_version)
    ]),
    extractor_versions: uniqueSorted([
      ...input.source_references.map((item) => item.extractor_version),
      ...input.evidence_fragments.map((item) => item.extractor_version),
      ...input.requirement_evidence.map((item) => item.extractor_version)
    ]),
    resolver_versions: uniqueSorted([
      input.resolver_version,
      ...input.conditions.map((item) => item.resolver_version),
      ...input.context_bindings.map((item) => item.resolver_version),
      ...input.source_references.map((item) => item.resolver_version),
      ...input.source_references.map((item) => item.relationship.resolver_version),
      ...input.conditional_branch_sets.map((item) => item.resolver_version)
    ]),
    required_engine_capabilities: uniqueSorted(requiredCapabilities),
    gate_version: CR12_REQUIREMENT_COMPLETENESS_GATE_VERSION,
    serialization_version: input.serialization_version
  };
}

function cr12CompletenessStatus(
  blockers: readonly Cr12RequirementCompletenessBlocker[]
): "COMPLETE" | "INCOMPLETE" | "REVIEW_REQUIRED" {
  if (blockers.length === 0) return "COMPLETE";
  return blockers.some((blocker) => {
    return blocker.code === "NOT_OBSERVED"
      || blocker.code === "ATTACHMENT_MISSING"
      || blocker.code === "EVIDENCE_INCOMPLETE";
  })
    ? "INCOMPLETE"
    : "REVIEW_REQUIRED";
}

function validateCr12StructuredInput(
  input: Cr12StructuredRequirementSetInput
): readonly Cr12RequirementCompletenessBlocker[] {
  const blockers = [...(input.external_blockers ?? [])];
  const fragments = uniqueRegistry(
    input.evidence_fragments,
    (item) => item.requirement_evidence_fragment_id,
    "RequirementEvidenceFragment"
  );
  const observations = uniqueRegistry(
    input.observations,
    (item) => item.requirement_observation_id,
    "RequirementObservation"
  );
  const facts = uniqueRegistry(
    input.facts,
    (item) => item.requirement_fact_id,
    "RequirementFact"
  );
  const requirementEvidence = uniqueRegistry(
    input.requirement_evidence,
    (item) => item.requirement_evidence_id,
    "RequirementEvidence"
  );
  const credentialApplicabilities = uniqueRegistry(
    input.candidate_credential_applicabilities,
    (item) => item.candidate_credential_applicability_id,
    "CandidateCredentialApplicability"
  );
  const stateApplicabilities = uniqueRegistry(
    input.candidate_state_applicabilities,
    (item) => item.candidate_state_applicability_id,
    "CandidateStateApplicability"
  );
  const bindings = uniqueRegistry(
    input.context_bindings,
    (item) => item.requirement_context_binding_id,
    "RequirementContextBinding"
  );
  const sources = uniqueRegistry(
    input.source_references,
    (item) => item.requirement_source_reference_id,
    "Cr12RequirementSourceReference"
  );
  const conditions = uniqueRegistry(
    input.conditions,
    (item) => item.requirement_condition_id,
    "Cr12RequirementCondition"
  );
  const requirementTrees = uniqueRegistry(
    input.requirement_logic_trees,
    (item) => item.requirement_logic_tree_id,
    "Cr12RequirementLogicTree"
  );
  const selectorPredicates = uniqueRegistry(
    input.selector_predicates,
    (item) => item.requirement_selector_predicate_id,
    "RequirementSelectorPredicate"
  );
  const selectorTrees = uniqueRegistry(
    input.selector_logic_trees,
    (item) => item.selector_logic_tree_id,
    "SelectorLogicTree"
  );
  const branchSets = uniqueRegistry(
    input.conditional_branch_sets,
    (item) => item.conditional_branch_set_id,
    "ConditionalRequirementBranchSet"
  );

  if (sources.size === 0) {
    addCr12Blocker(
      blockers,
      "EVIDENCE_INCOMPLETE",
      "EVIDENCE_INCOMPLETE",
      [],
      [],
      "CR#12 Requirement Set has no authoritative source reference"
    );
  }
  if (fragments.size === 0) {
    addCr12Blocker(
      blockers,
      "EVIDENCE_INCOMPLETE",
      "EVIDENCE_INCOMPLETE",
      [],
      [],
      "CR#12 Requirement Set has no Evidence Fragment"
    );
  }
  for (const blocker of input.external_blockers ?? []) {
    requireReferences(
      blocker.observation_ids,
      observations,
      "External completeness blocker Observation"
    );
    if (blocker.evidence_fragment_ids.length > 0) {
      addMissingEvidenceBlocker(
        blockers,
        blocker.evidence_fragment_ids,
        fragments,
        "External completeness blocker"
      );
    }
  }
  for (const fragment of fragments.values()) {
    const hasSourceReference = [...sources.values()].some((source) => {
      return source.snapshot_id === fragment.snapshot_id
        && source.extracted_record_id === fragment.extracted_record_id;
    });
    if (!hasSourceReference) {
      addCr12Blocker(
        blockers,
        "EVIDENCE_INCOMPLETE",
        "EVIDENCE_INCOMPLETE",
        [fragment.requirement_evidence_fragment_id],
        [],
        `Evidence Fragment ${fragment.requirement_evidence_fragment_id} is absent from the source manifest`
      );
    }
  }

  const evidenceByFact = new Map<RequirementFactId, RequirementEvidence[]>();
  for (const evidence of requirementEvidence.values()) {
    if (!facts.has(evidence.requirement_fact_id)) {
      throw new Cr12StructuredRequirementValidationError(
        "DANGLING_REFERENCE",
        `RequirementEvidence ${evidence.requirement_evidence_id} references an unavailable Fact`
      );
    }
    const current = evidenceByFact.get(evidence.requirement_fact_id) ?? [];
    current.push(evidence);
    evidenceByFact.set(evidence.requirement_fact_id, current);
    if (![...fragments.values()].some((fragment) => {
      return fragment.snapshot_id === evidence.snapshot_id;
    })) {
      addCr12Blocker(
        blockers,
        "EVIDENCE_INCOMPLETE",
        "EVIDENCE_INCOMPLETE",
        [],
        [],
        `RequirementEvidence ${evidence.requirement_evidence_id} has no traceable Evidence Fragment Snapshot`
      );
    }
  }

  for (const fact of facts.values()) {
    if (fact.opportunity_version_id !== input.opportunity_version_id) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_OPPORTUNITY_REFERENCE",
        `RequirementFact ${fact.requirement_fact_id} belongs to another OpportunityVersion`
      );
    }
    if (fact.value.kind === "GENERAL_ELIGIBILITY_PREDICATE") {
      const predicate = validateGeneralEligibilityRequirementPredicate(
        fact.value.predicate
      );
      requireReferences(
        predicate.source_reference_ids,
        sources,
        `General eligibility predicate ${predicate.requirement_predicate_id}`
      );
      addMissingEvidenceBlocker(
        blockers,
        predicate.evidence_fragment_ids,
        fragments,
        `General eligibility predicate ${predicate.requirement_predicate_id}`
      );
      if ((evidenceByFact.get(fact.requirement_fact_id) ?? []).length === 0) {
        addCr12Blocker(
          blockers,
          "EVIDENCE_INCOMPLETE",
          "EVIDENCE_INCOMPLETE",
          predicate.evidence_fragment_ids,
          [],
          `General eligibility predicate ${predicate.requirement_predicate_id} has no RequirementEvidence`
        );
      }
    }
  }

  for (const applicability of credentialApplicabilities.values()) {
    addMissingEvidenceBlocker(
      blockers,
      applicability.evidence_fragment_ids,
      fragments,
      `CandidateCredentialApplicability ${applicability.candidate_credential_applicability_id}`
    );
    if (applicability.mode === "UNRESOLVED"
        || applicability.certainty === "UNRESOLVED") {
      addCr12Blocker(
        blockers,
        "AMBIGUOUS",
        "CREDENTIAL_APPLICABILITY_UNRESOLVED",
        applicability.evidence_fragment_ids,
        [],
        "Candidate credential applicability is unresolved"
      );
    }
    if (applicability.mode === "ANY_DEGREE"
        || applicability.mode === "ALL_DEGREES"
        || applicability.mode === "EITHER_LEVEL") {
      if (applicability.applicable_degrees.length === 0
          || new Set(applicability.applicable_degrees).size
            !== applicability.applicable_degrees.length
          || (applicability.mode === "EITHER_LEVEL"
            && applicability.applicable_degrees.length < 2)) {
        throw new Cr12StructuredRequirementValidationError(
          "INVALID_LOGIC_STRUCTURE",
          `Candidate credential applicability ${applicability.candidate_credential_applicability_id} has an invalid degree set`
        );
      }
    }
  }

  for (const applicability of stateApplicabilities.values()) {
    addMissingEvidenceBlocker(
      blockers,
      applicability.evidence_fragment_ids,
      fragments,
      `CandidateStateApplicability ${applicability.candidate_state_applicability_id}`
    );
    if (applicability.mode === "UNRESOLVED"
        || applicability.certainty === "UNRESOLVED") {
      addCr12Blocker(
        blockers,
        "AMBIGUOUS",
        "CANDIDATE_STATE_APPLICABILITY_UNRESOLVED",
        applicability.evidence_fragment_ids,
        [],
        "Candidate state applicability is unresolved"
      );
    }
    if ((applicability.mode === "COHORT_ANY_OF"
          || applicability.mode === "COHORT_ALL_OF")
        && (applicability.candidate_cohorts.length === 0
          || new Set(applicability.candidate_cohorts).size
            !== applicability.candidate_cohorts.length)) {
      throw new Cr12StructuredRequirementValidationError(
        "INVALID_LOGIC_STRUCTURE",
        `Candidate state applicability ${applicability.candidate_state_applicability_id} has an invalid cohort set`
      );
    }
    if (applicability.mode === "STATE_SELECTOR"
        && !selectorTrees.has(applicability.selector_logic_tree_id)) {
      throw new Cr12StructuredRequirementValidationError(
        "DANGLING_REFERENCE",
        "Candidate state applicability references an unavailable selector tree"
      );
    }
  }

  for (const binding of bindings.values()) {
    if (binding.opportunity_version_id !== input.opportunity_version_id) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_OPPORTUNITY_REFERENCE",
        `RequirementContextBinding ${binding.requirement_context_binding_id} belongs to another OpportunityVersion`
      );
    }
    addMissingEvidenceBlocker(
      blockers,
      binding.evidence_fragment_ids,
      fragments,
      `RequirementContextBinding ${binding.requirement_context_binding_id}`
    );
    if (binding.effective_targets.length === 0) {
      throw new Cr12StructuredRequirementValidationError(
        "DANGLING_REFERENCE",
        "RequirementContextBinding requires at least one effective target"
      );
    }
    if (binding.scope === "EXACT_TARGET" && binding.effective_targets.length !== 1) {
      throw new Cr12StructuredRequirementValidationError(
        "INVALID_LOGIC_STRUCTURE",
        "EXACT_TARGET binding must contain exactly one effective target"
      );
    }
    assertContextTargetWithinOpportunity(
      binding.source_context_target,
      input.opportunity_version_id,
      `RequirementContextBinding ${binding.requirement_context_binding_id} source target`
    );
    const unresolvedTarget = binding.source_context_target.kind === "UNRESOLVED"
      || binding.effective_targets.some((target) => target.kind === "UNRESOLVED");
    if (binding.state === "UNRESOLVED"
        || binding.certainty === "UNRESOLVED"
        || binding.scope === "UNRESOLVED"
        || unresolvedTarget) {
      addCr12Blocker(
        blockers,
        "AMBIGUOUS",
        "CONTEXT_BINDING_UNRESOLVED",
        binding.evidence_fragment_ids,
        [],
        `RequirementContextBinding ${binding.requirement_context_binding_id} is unresolved`
      );
    }
    for (const target of binding.effective_targets) {
      assertContextTargetWithinOpportunity(
        target,
        input.opportunity_version_id,
        `RequirementContextBinding ${binding.requirement_context_binding_id} effective target`
      );
    }
  }

  for (const source of sources.values()) {
    if (source.applicable_binding_ids.length === 0) {
      throw new Cr12StructuredRequirementValidationError(
        "DANGLING_REFERENCE",
        "RequirementSourceReference requires at least one applicable binding"
      );
    }
    requireReferences(
      source.applicable_binding_ids,
      bindings,
      `RequirementSourceReference ${source.requirement_source_reference_id}`
    );
    assertContextTargetWithinOpportunity(
      source.source_context_target,
      input.opportunity_version_id,
      `RequirementSourceReference ${source.requirement_source_reference_id} source target`
    );
    addMissingEvidenceBlocker(
      blockers,
      source.binding_evidence_fragment_ids,
      fragments,
      `RequirementSourceReference ${source.requirement_source_reference_id}`
    );
    addMissingEvidenceBlocker(
      blockers,
      source.relationship.evidence_fragment_ids,
      fragments,
      `Requirement source relationship ${source.requirement_source_reference_id}`
    );
    const matchingFragment = source.binding_evidence_fragment_ids.some((fragmentId) => {
      const fragment = fragments.get(fragmentId);
      return fragment?.snapshot_id === source.snapshot_id
        && fragment.extracted_record_id === source.extracted_record_id;
    });
    if (!matchingFragment) {
      addCr12Blocker(
        blockers,
        "EVIDENCE_INCOMPLETE",
        "EVIDENCE_INCOMPLETE",
        source.binding_evidence_fragment_ids,
        [],
        "Source binding Evidence does not trace to its Snapshot and ExtractedRecord"
      );
    }
    if (source.source_role === "UNRESOLVED") {
      addCr12Blocker(
        blockers,
        "AMBIGUOUS",
        "SOURCE_ROLE_UNRESOLVED",
        source.binding_evidence_fragment_ids,
        [],
        "Requirement source role is unresolved"
      );
    }
    if (source.binding_state === "UNRESOLVED"
        || source.binding_certainty === "UNRESOLVED"
        || source.source_context_target.kind === "UNRESOLVED") {
      addCr12Blocker(
        blockers,
        "AMBIGUOUS",
        "CONTEXT_BINDING_UNRESOLVED",
        source.binding_evidence_fragment_ids,
        [],
        "Requirement source target binding is unresolved"
      );
    }
    if (source.relationship.kind === "UNRESOLVED") {
      addCr12Blocker(
        blockers,
        "AMBIGUOUS",
        "SOURCE_RELATION_UNRESOLVED",
        source.relationship.evidence_fragment_ids,
        [],
        "Requirement source relationship is unresolved"
      );
    }
    if (source.relationship.kind === "CONFLICTS_WITH") {
      addCr12Blocker(
        blockers,
        "AMBIGUOUS",
        "SOURCE_CONFLICT",
        source.relationship.evidence_fragment_ids,
        [],
        "Conflicting source semantics require review"
      );
    }
  }
  for (const source of sources.values()) {
    requireReferences(
      source.relationship.target_source_reference_ids,
      sources,
      `Requirement source relationship ${source.requirement_source_reference_id}`
    );
    if (!['ORIGINAL', 'UNRESOLVED'].includes(source.relationship.kind)
        && source.relationship.target_source_reference_ids.length === 0) {
      throw new Cr12StructuredRequirementValidationError(
        "DANGLING_REFERENCE",
        "A non-original Requirement source relationship needs a target"
      );
    }
    if (source.relationship.kind === "ORIGINAL"
        && source.relationship.target_source_reference_ids.length > 0) {
      throw new Cr12StructuredRequirementValidationError(
        "INVALID_LOGIC_STRUCTURE",
        "An ORIGINAL Requirement source relationship cannot target another source"
      );
    }
    if (source.relationship.target_source_reference_ids.includes(
      source.requirement_source_reference_id
    )) {
      throw new Cr12StructuredRequirementValidationError(
        "CYCLE_DETECTED",
        "A Requirement source relationship cannot target itself"
      );
    }
  }

  for (const observation of observations.values()) {
    if (observation.opportunity_version_id !== input.opportunity_version_id) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_OPPORTUNITY_REFERENCE",
        "RequirementObservation belongs to another OpportunityVersion"
      );
    }
    requireReferences(
      observation.requirement_fact_ids,
      facts,
      `RequirementObservation ${observation.requirement_observation_id}`
    );
    addMissingEvidenceBlocker(
      blockers,
      observation.evidence_fragment_ids,
      fragments,
      `RequirementObservation ${observation.requirement_observation_id}`
    );
    if (observation.status !== "CONFIRMED_REQUIREMENT") {
      addCr12Blocker(
        blockers,
        observation.status === "NOT_OBSERVED" ? "NOT_OBSERVED"
          : observation.status === "UNPARSED_CLAUSE" ? "UNPARSED_CLAUSE"
            : observation.status === "DOMAIN_GAP_OBSERVED" ? "DOMAIN_GAP_OBSERVED"
              : "AMBIGUOUS",
        observation.status === "NOT_OBSERVED" ? "NOT_OBSERVED"
          : observation.status === "UNPARSED_CLAUSE" ? "UNPARSED_CLAUSE"
            : observation.status === "DOMAIN_GAP_OBSERVED"
              ? "DOMAIN_GAP_OBSERVED"
              : "LOGIC_CONNECTOR_UNRESOLVED",
        observation.evidence_fragment_ids,
        [observation.requirement_observation_id],
        `Requirement Observation remains ${observation.status}`
      );
    }
  }

  for (const condition of conditions.values()) {
    validateConditionReferences(
      condition,
      input,
      credentialApplicabilities,
      stateApplicabilities,
      bindings,
      sources,
      fragments,
      observations,
      requirementTrees,
      branchSets,
      blockers
    );
  }

  const factOwners = new Map<RequirementFactId, RequirementConditionId>();
  for (const tree of requirementTrees.values()) {
    validateRequirementLogicTree(
      tree,
      input.opportunity_version_id,
      input.serialization_version,
      conditions,
      bindings,
      fragments,
      facts,
      evidenceByFact,
      factOwners,
      blockers
    );
  }

  const selectorPredicateOwners = new Map<string, string>();
  for (const predicate of selectorPredicates.values()) {
    validateSelectorPredicate(
      predicate,
      input.opportunity_version_id,
      branchSets,
      credentialApplicabilities,
      bindings,
      fragments,
      blockers
    );
  }
  for (const tree of selectorTrees.values()) {
    validateSelectorLogicTree(
      tree,
      branchSets,
      selectorPredicates,
      bindings,
      fragments,
      input.serialization_version,
      selectorPredicateOwners,
      blockers
    );
  }
  for (const branchSet of branchSets.values()) {
    validateConditionalBranchSet(
      branchSet,
      conditions,
      requirementTrees,
      selectorTrees,
      credentialApplicabilities,
      stateApplicabilities,
      bindings,
      fragments,
      blockers
    );
  }

  validateRegistryOwnership(
    conditions,
    requirementTrees,
    selectorTrees,
    selectorPredicates,
    branchSets,
    selectorPredicateOwners
  );

  validateMandatoryRoot(input.mandatory_root, conditions, fragments);
  for (const fact of facts.values()) {
    if (!factOwners.has(fact.requirement_fact_id)) {
      addCr12Blocker(
        blockers,
        "AMBIGUOUS",
        "INVALID_LOGIC_STRUCTURE",
        [],
        [],
        `RequirementFact ${fact.requirement_fact_id} is unreachable from a condition tree`
      );
    }
  }
  return deduplicateCr12Blockers(blockers);
}

function validateConditionReferences(
  condition: Cr12RequirementCondition,
  input: Cr12StructuredRequirementSetInput,
  credentialApplicabilities: ReadonlyMap<string, CandidateCredentialApplicability>,
  stateApplicabilities: ReadonlyMap<string, CandidateStateApplicability>,
  bindings: ReadonlyMap<string, RequirementContextBinding>,
  sources: ReadonlyMap<string, Cr12StructuredRequirementSetInput["source_references"][number]>,
  fragments: ReadonlyMap<string, RequirementEvidenceFragment>,
  observations: ReadonlyMap<string, RequirementObservation>,
  requirementTrees: ReadonlyMap<string, Cr12RequirementLogicTree>,
  branchSets: ReadonlyMap<string, ConditionalRequirementBranchSet>,
  blockers: Cr12RequirementCompletenessBlocker[]
) {
  if (condition.opportunity_version_id !== input.opportunity_version_id) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_OPPORTUNITY_REFERENCE",
      `RequirementCondition ${condition.requirement_condition_id} belongs to another OpportunityVersion`
    );
  }
  if (condition.context_binding_ids.length === 0
      || condition.source_reference_ids.length === 0) {
    throw new Cr12StructuredRequirementValidationError(
      "DANGLING_REFERENCE",
      "RequirementCondition requires context and source references"
    );
  }
  requireReference(
    condition.candidate_credential_applicability_id,
    credentialApplicabilities,
    `RequirementCondition ${condition.requirement_condition_id}`
  );
  requireReference(
    condition.candidate_state_applicability_id,
    stateApplicabilities,
    `RequirementCondition ${condition.requirement_condition_id}`
  );
  requireReferences(condition.context_binding_ids, bindings, "RequirementCondition binding");
  requireReferences(condition.source_reference_ids, sources, "RequirementCondition source");
  addMissingEvidenceBlocker(
    blockers,
    condition.evidence_fragment_ids,
    fragments,
    `RequirementCondition ${condition.requirement_condition_id}`
  );
  if (condition.resolution_state === "UNRESOLVED") {
    requireReferences(
      condition.blocking_observation_ids,
      observations,
      `Unresolved RequirementCondition ${condition.requirement_condition_id}`
    );
    addCr12Blocker(
      blockers,
      "AMBIGUOUS",
      "LOGIC_CONNECTOR_UNRESOLVED",
      condition.evidence_fragment_ids,
      condition.blocking_observation_ids,
      "A Requirement condition has unresolved source semantics"
    );
    return;
  }
  if (condition.representation_kind === "LOGIC_TREE") {
    const tree = requireReference(
      condition.requirement_logic_tree_id,
      requirementTrees,
      `RequirementCondition ${condition.requirement_condition_id}`
    );
    if (tree.requirement_condition_id !== condition.requirement_condition_id) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_CONDITION_REFERENCE",
        "RequirementCondition references a tree owned by another condition"
      );
    }
    return;
  }
  const branchSet = requireReference(
    condition.conditional_branch_set_id,
    branchSets,
    `RequirementCondition ${condition.requirement_condition_id}`
  );
  if (branchSet.requirement_condition_id !== condition.requirement_condition_id) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_CONDITION_REFERENCE",
      "RequirementCondition references a branch set owned by another condition"
    );
  }
}

function validateRequirementLogicTree(
  tree: Cr12RequirementLogicTree,
  opportunityVersionId: OpportunityVersionId,
  serializationVersion: string,
  conditions: ReadonlyMap<string, Cr12RequirementCondition>,
  bindings: ReadonlyMap<string, RequirementContextBinding>,
  fragments: ReadonlyMap<string, RequirementEvidenceFragment>,
  facts: ReadonlyMap<string, RequirementFact>,
  evidenceByFact: ReadonlyMap<RequirementFactId, readonly RequirementEvidence[]>,
  factOwners: Map<RequirementFactId, RequirementConditionId>,
  blockers: Cr12RequirementCompletenessBlocker[]
) {
  const condition = requireReference(
    tree.requirement_condition_id,
    conditions,
    `RequirementLogicTree ${tree.requirement_logic_tree_id}`
  );
  const nodes = uniqueRegistry(
    tree.nodes,
    (node) => node.requirement_logic_node_id,
    `RequirementLogicTree ${tree.requirement_logic_tree_id} node`
  );
  if (tree.serialization_version !== serializationVersion) {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      "Requirement tree serialization version differs from its Requirement Set"
    );
  }
  validateUniqueSourceOrder(nodes.values(), "RequirementLogicTree");
  requireReference(tree.root_node_id, nodes, `RequirementLogicTree ${tree.requirement_logic_tree_id}`);
  const parentCounts = new Map<RequirementLogicNodeId, number>();
  const leafIds = new Set<RequirementFactId>();

  for (const node of nodes.values()) {
    if (node.requirement_condition_id !== tree.requirement_condition_id) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_CONDITION_REFERENCE",
        "Requirement tree contains a node owned by another condition"
      );
    }
    requireReferences(node.context_binding_ids, bindings, "Requirement logic node binding");
    if (node.context_binding_ids.some((bindingId) => {
      return !condition.context_binding_ids.includes(bindingId);
    })) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_CONDITION_REFERENCE",
        "Requirement logic node widens beyond its condition binding"
      );
    }
    addMissingEvidenceBlocker(
      blockers,
      node.evidence_fragment_ids,
      fragments,
      `RequirementLogicNode ${node.requirement_logic_node_id}`
    );

    if (node.kind === "PREDICATE") {
      const fact = requireReference(
        node.requirement_fact_id,
        facts,
        `RequirementLogicNode ${node.requirement_logic_node_id}`
      );
      if (fact.opportunity_version_id !== opportunityVersionId) {
        throw new Cr12StructuredRequirementValidationError(
          "CROSS_OPPORTUNITY_REFERENCE",
          "Requirement logic leaf references a Fact from another OpportunityVersion"
        );
      }
      if (fact.polarity !== "POSITIVE"
          || fact.operator === "NOT_EQUALS"
          || fact.operator === "NONE_OF") {
        throw new Cr12StructuredRequirementValidationError(
          "DOUBLE_NEGATION",
          "CR#12 canonical leaves require positive Facts and positive operators"
        );
      }
      if (leafIds.has(fact.requirement_fact_id)) {
        throw new Cr12StructuredRequirementValidationError(
          "DUPLICATE_LEAF",
          "A Requirement tree repeats a Fact leaf"
        );
      }
      leafIds.add(fact.requirement_fact_id);
      const existingOwner = factOwners.get(fact.requirement_fact_id);
      if (existingOwner && existingOwner !== tree.requirement_condition_id) {
        throw new Cr12StructuredRequirementValidationError(
          "CROSS_CONDITION_REFERENCE",
          "A RequirementFact is reachable from more than one condition"
        );
      }
      factOwners.set(fact.requirement_fact_id, tree.requirement_condition_id);
      if ((evidenceByFact.get(fact.requirement_fact_id)?.length ?? 0) === 0) {
        addCr12Blocker(
          blockers,
          "EVIDENCE_INCOMPLETE",
          "EVIDENCE_INCOMPLETE",
          node.evidence_fragment_ids,
          [],
          `RequirementFact ${fact.requirement_fact_id} has no RequirementEvidence`
        );
      }
      continue;
    }

    const childIds = node.kind === "GROUP"
      ? node.child_node_ids
      : [node.child_node_id];
    if (node.kind === "NOT") {
      const child = requireReference(
        node.child_node_id,
        nodes,
        `RequirementLogicNode ${node.requirement_logic_node_id}`
      );
      if (child.kind === "NOT") {
        throw new Cr12StructuredRequirementValidationError(
          "DOUBLE_NEGATION",
          "Canonical CR#12 trees reject nested NOT carriers"
        );
      }
    }
    if (node.kind === "GROUP" && childIds.length < 2) {
      throw new Cr12StructuredRequirementValidationError(
        "INVALID_UNARY_GROUP",
        "Resolved AND/OR groups require at least two children"
      );
    }
    for (const childId of childIds) {
      requireReference(childId, nodes, `RequirementLogicNode ${node.requirement_logic_node_id}`);
      parentCounts.set(childId, (parentCounts.get(childId) ?? 0) + 1);
    }
  }

  validateGraph(
    tree.root_node_id,
    nodes,
    (node) => node.kind === "GROUP"
      ? node.child_node_ids
      : node.kind === "NOT" ? [node.child_node_id] : [],
    parentCounts,
    "RequirementLogicTree"
  );
  for (const node of nodes.values()) {
    if (node.kind === "NOT" && subtreeContainsUnrestrictedFact(
      node.child_node_id,
      nodes,
      facts
    )) {
      throw new Cr12StructuredRequirementValidationError(
        "DOUBLE_NEGATION",
        "UNRESTRICTED cannot be wrapped in canonical NOT"
      );
    }
  }
}

function validateSelectorPredicate(
  predicate: RequirementSelectorPredicate,
  opportunityVersionId: OpportunityVersionId,
  branchSets: ReadonlyMap<string, ConditionalRequirementBranchSet>,
  credentialApplicabilities: ReadonlyMap<string, CandidateCredentialApplicability>,
  bindings: ReadonlyMap<string, RequirementContextBinding>,
  fragments: ReadonlyMap<string, RequirementEvidenceFragment>,
  blockers: Cr12RequirementCompletenessBlocker[]
) {
  if (predicate.opportunity_version_id !== opportunityVersionId) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_OPPORTUNITY_REFERENCE",
      "Selector predicate belongs to another OpportunityVersion"
    );
  }
  const branchSet = requireReference(
    predicate.conditional_branch_set_id,
    branchSets,
    `RequirementSelectorPredicate ${predicate.requirement_selector_predicate_id}`
  );
  requireReference(
    predicate.candidate_credential_applicability_id,
    credentialApplicabilities,
    `RequirementSelectorPredicate ${predicate.requirement_selector_predicate_id}`
  );
  const selectorOperator = predicate.operator as string;
  if (selectorOperator === "NOT_EQUALS" || selectorOperator === "NONE_OF") {
    throw new Cr12StructuredRequirementValidationError(
      "DOUBLE_NEGATION",
      "CR#12 selector predicates require positive atomic operators"
    );
  }
  if (predicate.direct_candidate_cohorts
      && predicate.dimension !== "CANDIDATE_COHORT") {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      "Direct Candidate cohorts may appear only on a cohort selector"
    );
  }
  requireReferences(predicate.context_binding_ids, bindings, "Selector predicate binding");
  if (predicate.context_binding_ids.some((bindingId) => {
    return !branchSet.context_binding_ids.includes(bindingId);
  })) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_CONDITION_REFERENCE",
      "Selector predicate widens beyond its branch-set binding"
    );
  }
  addMissingEvidenceBlocker(
    blockers,
    predicate.evidence_fragment_ids,
    fragments,
    `RequirementSelectorPredicate ${predicate.requirement_selector_predicate_id}`
  );
  if (predicate.resolution_state === "UNRESOLVED") {
    addCr12Blocker(
      blockers,
      "AMBIGUOUS",
      "CONDITIONAL_SELECTOR_UNRESOLVED",
      predicate.evidence_fragment_ids,
      [],
      "Conditional selector predicate is unresolved"
    );
  }
}

function validateSelectorLogicTree(
  tree: SelectorLogicTree,
  branchSets: ReadonlyMap<string, ConditionalRequirementBranchSet>,
  predicates: ReadonlyMap<string, RequirementSelectorPredicate>,
  bindings: ReadonlyMap<string, RequirementContextBinding>,
  fragments: ReadonlyMap<string, RequirementEvidenceFragment>,
  serializationVersion: string,
  predicateOwners: Map<string, string>,
  blockers: Cr12RequirementCompletenessBlocker[]
) {
  const branchSet = requireReference(
    tree.conditional_branch_set_id,
    branchSets,
    `SelectorLogicTree ${tree.selector_logic_tree_id}`
  );
  const nodes = uniqueRegistry(
    tree.nodes,
    (node) => node.selector_logic_node_id,
    `SelectorLogicTree ${tree.selector_logic_tree_id} node`
  );
  if (tree.serialization_version !== serializationVersion) {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      "Selector tree serialization version differs from its Requirement Set"
    );
  }
  validateUniqueSourceOrder(nodes.values(), "SelectorLogicTree");
  requireReference(tree.root_node_id, nodes, `SelectorLogicTree ${tree.selector_logic_tree_id}`);
  const parentCounts = new Map<SelectorLogicNodeId, number>();
  const predicateIds = new Set<string>();

  for (const node of nodes.values()) {
    if (node.selector_logic_tree_id !== tree.selector_logic_tree_id) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_CONDITION_REFERENCE",
        "Selector tree contains a node owned by another tree"
      );
    }
    requireReferences(node.context_binding_ids, bindings, "Selector logic node binding");
    if (node.context_binding_ids.some((bindingId) => {
      return !branchSet.context_binding_ids.includes(bindingId);
    })) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_CONDITION_REFERENCE",
        "Selector logic node widens beyond its branch-set binding"
      );
    }
    addMissingEvidenceBlocker(
      blockers,
      node.evidence_fragment_ids,
      fragments,
      `SelectorLogicNode ${node.selector_logic_node_id}`
    );
    if (node.kind === "SELECTOR_PREDICATE") {
      const predicate = requireReference(
        node.requirement_selector_predicate_id,
        predicates,
        `SelectorLogicNode ${node.selector_logic_node_id}`
      );
      if (predicate.conditional_branch_set_id !== tree.conditional_branch_set_id) {
        throw new Cr12StructuredRequirementValidationError(
          "CROSS_CONDITION_REFERENCE",
          "Selector tree references a predicate from another branch set"
        );
      }
      if (predicateIds.has(predicate.requirement_selector_predicate_id)) {
        throw new Cr12StructuredRequirementValidationError(
          "DUPLICATE_LEAF",
          "A selector tree repeats a selector predicate"
        );
      }
      predicateIds.add(predicate.requirement_selector_predicate_id);
      const existingOwner = predicateOwners.get(
        predicate.requirement_selector_predicate_id
      );
      if (existingOwner && existingOwner !== tree.selector_logic_tree_id) {
        throw new Cr12StructuredRequirementValidationError(
          "CROSS_CONDITION_REFERENCE",
          "A selector predicate is reachable from more than one selector tree"
        );
      }
      predicateOwners.set(
        predicate.requirement_selector_predicate_id,
        tree.selector_logic_tree_id
      );
      continue;
    }
    const childIds = node.kind === "GROUP"
      ? node.child_node_ids
      : [node.child_node_id];
    if (node.kind === "NOT") {
      const child = requireReference(
        node.child_node_id,
        nodes,
        `SelectorLogicNode ${node.selector_logic_node_id}`
      );
      if (child.kind === "NOT") {
        throw new Cr12StructuredRequirementValidationError(
          "DOUBLE_NEGATION",
          "Canonical selector trees reject nested NOT carriers"
        );
      }
    }
    if (node.kind === "GROUP" && childIds.length < 2) {
      throw new Cr12StructuredRequirementValidationError(
        "INVALID_UNARY_GROUP",
        "Resolved selector AND/OR groups require at least two children"
      );
    }
    for (const childId of childIds) {
      requireReference(childId, nodes, `SelectorLogicNode ${node.selector_logic_node_id}`);
      parentCounts.set(childId, (parentCounts.get(childId) ?? 0) + 1);
    }
  }

  validateGraph(
    tree.root_node_id,
    nodes,
    (node) => node.kind === "GROUP"
      ? node.child_node_ids
      : node.kind === "NOT" ? [node.child_node_id] : [],
    parentCounts,
    "SelectorLogicTree"
  );
}

function validateConditionalBranchSet(
  branchSet: ConditionalRequirementBranchSet,
  conditions: ReadonlyMap<string, Cr12RequirementCondition>,
  requirementTrees: ReadonlyMap<string, Cr12RequirementLogicTree>,
  selectorTrees: ReadonlyMap<string, SelectorLogicTree>,
  credentialApplicabilities: ReadonlyMap<string, CandidateCredentialApplicability>,
  stateApplicabilities: ReadonlyMap<string, CandidateStateApplicability>,
  bindings: ReadonlyMap<string, RequirementContextBinding>,
  fragments: ReadonlyMap<string, RequirementEvidenceFragment>,
  blockers: Cr12RequirementCompletenessBlocker[]
) {
  const condition = requireReference(
    branchSet.requirement_condition_id,
    conditions,
    `ConditionalRequirementBranchSet ${branchSet.conditional_branch_set_id}`
  );
  if (condition.representation_kind !== "CONDITIONAL_BRANCH_SET"
      || condition.resolution_state !== "RESOLVED"
      || condition.conditional_branch_set_id !== branchSet.conditional_branch_set_id) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_CONDITION_REFERENCE",
      "Conditional branch set is not the owning condition's exact representation"
    );
  }
  const whenTree = requireReference(
    branchSet.when_selector_logic_tree_id,
    selectorTrees,
    "Conditional branch WHEN"
  );
  if (whenTree.conditional_branch_set_id !== branchSet.conditional_branch_set_id) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_CONDITION_REFERENCE",
      "Conditional WHEN tree belongs to another branch set"
    );
  }
  for (const treeId of [
    branchSet.then_requirement_logic_tree_id,
    branchSet.else_requirement_logic_tree_id
  ].filter((value): value is RequirementLogicTreeId => value !== undefined)) {
    const tree = requireReference(treeId, requirementTrees, "Conditional branch result");
    if (tree.requirement_condition_id !== branchSet.requirement_condition_id) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_CONDITION_REFERENCE",
        "Conditional result tree belongs to another condition"
      );
    }
  }
  requireReference(
    branchSet.candidate_credential_applicability_id,
    credentialApplicabilities,
    "Conditional branch credential applicability"
  );
  requireReference(
    branchSet.candidate_state_applicability_id,
    stateApplicabilities,
    "Conditional branch state applicability"
  );
  if (branchSet.candidate_credential_applicability_id
        !== condition.candidate_credential_applicability_id
      || branchSet.candidate_state_applicability_id
        !== condition.candidate_state_applicability_id) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_CONDITION_REFERENCE",
      "Conditional branch applicability differs from its owning condition"
    );
  }
  requireReferences(branchSet.context_binding_ids, bindings, "Conditional branch binding");
  if (branchSet.context_binding_ids.some((bindingId) => {
    return !condition.context_binding_ids.includes(bindingId);
  })) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_CONDITION_REFERENCE",
      "Conditional branch widens beyond its condition binding"
    );
  }
  addMissingEvidenceBlocker(
    blockers,
    branchSet.evidence_fragment_ids,
    fragments,
    `ConditionalRequirementBranchSet ${branchSet.conditional_branch_set_id}`
  );
  if (branchSet.branch_semantics_state === "UNRESOLVED") {
    addCr12Blocker(
      blockers,
      "AMBIGUOUS",
      "CONDITIONAL_BRANCH_UNRESOLVED",
      branchSet.evidence_fragment_ids,
      [],
      "Conditional branch semantics are unresolved"
    );
  }
}

function validateMandatoryRoot(
  root: Cr12StructuredRequirementSetInput["mandatory_root"],
  conditions: ReadonlyMap<string, Cr12RequirementCondition>,
  fragments: ReadonlyMap<string, RequirementEvidenceFragment>
) {
  const resolvedMandatoryIds = [...conditions.values()]
    .filter((condition) => {
      return condition.modality === "MANDATORY"
        && condition.resolution_state === "RESOLVED";
    })
    .map((condition) => condition.requirement_condition_id);
  const rootIds = root.kind === "EMPTY_CONFIRMED"
    ? []
    : root.kind === "SINGLE"
      ? [root.requirement_condition_id]
      : [...root.requirement_condition_ids];
  if (new Set(rootIds).size !== rootIds.length) {
    throw new Cr12StructuredRequirementValidationError(
      "MANDATORY_ROOT_MISMATCH",
      "Mandatory root repeats a RequirementCondition"
    );
  }
  if (root.kind === "AND" && rootIds.length < 2) {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_UNARY_GROUP",
      "Mandatory AND root requires at least two conditions"
    );
  }
  if (root.kind === "EMPTY_CONFIRMED") {
    if (root.evidence_fragment_ids.length === 0
        || root.evidence_fragment_ids.some((fragmentId) => !fragments.has(fragmentId))) {
      throw new Cr12StructuredRequirementValidationError(
        "EVIDENCE_INCOMPLETE",
        "EMPTY_CONFIRMED requires complete Evidence"
      );
    }
  }
  for (const conditionId of rootIds) {
    const condition = requireReference(conditionId, conditions, "Mandatory root");
    if (condition.modality !== "MANDATORY" || condition.resolution_state !== "RESOLVED") {
      throw new Cr12StructuredRequirementValidationError(
        "MANDATORY_ROOT_MISMATCH",
        "Mandatory root contains a non-mandatory or unresolved condition"
      );
    }
  }
  if (!sameStringSet(rootIds, resolvedMandatoryIds)) {
    throw new Cr12StructuredRequirementValidationError(
      "MANDATORY_ROOT_MISMATCH",
      "Mandatory root does not contain every resolved mandatory condition exactly once"
    );
  }
}

function uniqueRegistry<Item>(
  items: readonly Item[],
  getId: (item: Item) => string,
  label: string
): ReadonlyMap<string, Item> {
  const registry = new Map<string, Item>();
  for (const item of items) {
    const id = getId(item);
    if (registry.has(id)) {
      throw new Cr12StructuredRequirementValidationError(
        "DUPLICATE_ID",
        `${label} registry contains duplicate ID ${id}`
      );
    }
    registry.set(id, item);
  }
  return registry;
}

function validateRegistryOwnership(
  conditions: ReadonlyMap<string, Cr12RequirementCondition>,
  requirementTrees: ReadonlyMap<string, Cr12RequirementLogicTree>,
  selectorTrees: ReadonlyMap<string, SelectorLogicTree>,
  selectorPredicates: ReadonlyMap<string, RequirementSelectorPredicate>,
  branchSets: ReadonlyMap<string, ConditionalRequirementBranchSet>,
  selectorPredicateOwners: ReadonlyMap<string, string>
) {
  const requirementTreeReferences = new Map<string, number>();
  const branchSetReferences = new Map<string, number>();
  for (const condition of conditions.values()) {
    if (condition.resolution_state !== "RESOLVED") continue;
    if (condition.representation_kind === "LOGIC_TREE") {
      incrementReference(
        requirementTreeReferences,
        condition.requirement_logic_tree_id
      );
    } else {
      incrementReference(branchSetReferences, condition.conditional_branch_set_id);
    }
  }

  const selectorTreeReferences = new Map<string, number>();
  for (const branchSet of branchSets.values()) {
    incrementReference(
      selectorTreeReferences,
      branchSet.when_selector_logic_tree_id
    );
    incrementReference(
      requirementTreeReferences,
      branchSet.then_requirement_logic_tree_id
    );
    if (branchSet.else_requirement_logic_tree_id) {
      incrementReference(
        requirementTreeReferences,
        branchSet.else_requirement_logic_tree_id
      );
    }
  }

  assertExactlyOneRegistryOwner(
    requirementTrees.keys(),
    requirementTreeReferences,
    "RequirementLogicTree"
  );
  assertExactlyOneRegistryOwner(
    selectorTrees.keys(),
    selectorTreeReferences,
    "SelectorLogicTree"
  );
  assertExactlyOneRegistryOwner(
    branchSets.keys(),
    branchSetReferences,
    "ConditionalRequirementBranchSet"
  );
  assertExactlyOneRegistryOwner(
    selectorPredicates.keys(),
    selectorPredicateOwners,
    "RequirementSelectorPredicate"
  );
}

function incrementReference(references: Map<string, number>, id: string) {
  references.set(id, (references.get(id) ?? 0) + 1);
}

function assertExactlyOneRegistryOwner(
  ids: Iterable<string>,
  owners: ReadonlyMap<string, number | string>,
  label: string
) {
  for (const id of ids) {
    const owner = owners.get(id);
    if (owner === undefined || (typeof owner === "number" && owner !== 1)) {
      throw new Cr12StructuredRequirementValidationError(
        "CROSS_CONDITION_REFERENCE",
        `${label} ${id} must have exactly one owning reference`
      );
    }
  }
}

function validateUniqueSourceOrder(
  nodes: Iterable<{ readonly source_order: number }>,
  graphLabel: string
) {
  const sourceOrders = [...nodes].map((node) => node.source_order);
  if (sourceOrders.some((sourceOrder) => {
    return !Number.isSafeInteger(sourceOrder) || sourceOrder < 0;
  }) || new Set(sourceOrders).size !== sourceOrders.length) {
    throw new Cr12StructuredRequirementValidationError(
      "INVALID_LOGIC_STRUCTURE",
      `${graphLabel} nodes require unique non-negative source order`
    );
  }
}

function subtreeContainsUnrestrictedFact(
  nodeId: RequirementLogicNodeId,
  nodes: ReadonlyMap<string, Cr12RequirementLogicNode>,
  facts: ReadonlyMap<string, RequirementFact>
): boolean {
  const node = requireReference(nodeId, nodes, "Requirement NOT subtree");
  if (node.kind === "PREDICATE") {
    return requireReference(
      node.requirement_fact_id,
      facts,
      "Requirement NOT subtree"
    ).operator === "UNRESTRICTED";
  }
  if (node.kind === "NOT") {
    return subtreeContainsUnrestrictedFact(node.child_node_id, nodes, facts);
  }
  return node.child_node_ids.some((childId) => {
    return subtreeContainsUnrestrictedFact(childId, nodes, facts);
  });
}

function requireReference<Item>(
  id: string,
  registry: ReadonlyMap<string, Item>,
  owner: string
): Item {
  const item = registry.get(id);
  if (!item) {
    throw new Cr12StructuredRequirementValidationError(
      "DANGLING_REFERENCE",
      `${owner} references unavailable ID ${id}`
    );
  }
  return item;
}

function requireReferences(
  ids: readonly string[],
  registry: ReadonlyMap<string, unknown>,
  owner: string
) {
  if (new Set(ids).size !== ids.length) {
    throw new Cr12StructuredRequirementValidationError(
      "DUPLICATE_ID",
      `${owner} repeats a referenced ID`
    );
  }
  for (const id of ids) {
    requireReference(id, registry, owner);
  }
}

function addMissingEvidenceBlocker(
  blockers: Cr12RequirementCompletenessBlocker[],
  evidenceFragmentIds: readonly RequirementEvidenceFragmentId[],
  fragments: ReadonlyMap<string, RequirementEvidenceFragment>,
  owner: string
) {
  const missingIds = evidenceFragmentIds.filter((fragmentId) => {
    return !fragments.has(fragmentId);
  });
  if (evidenceFragmentIds.length > 0 && missingIds.length === 0) return;
  addCr12Blocker(
    blockers,
    "EVIDENCE_INCOMPLETE",
    "EVIDENCE_INCOMPLETE",
    evidenceFragmentIds,
    [],
    evidenceFragmentIds.length === 0
      ? `${owner} has no Evidence Fragment`
      : `${owner} references unavailable Evidence Fragment IDs: ${missingIds.join(", ")}`
  );
}

function addCr12Blocker(
  blockers: Cr12RequirementCompletenessBlocker[],
  code: RequirementCompletenessBlockerCode,
  diagnosticCode: Cr12CompletenessDiagnosticCode,
  evidenceFragmentIds: readonly RequirementEvidenceFragmentId[],
  observationIds: readonly RequirementObservationId[],
  description: string
) {
  blockers.push({
    code,
    diagnostic_code: diagnosticCode,
    evidence_fragment_ids: uniqueSorted(evidenceFragmentIds),
    observation_ids: uniqueSorted(observationIds),
    description
  });
}

function deduplicateCr12Blockers(
  blockers: readonly Cr12RequirementCompletenessBlocker[]
): readonly Cr12RequirementCompletenessBlocker[] {
  const byContent = new Map<string, Cr12RequirementCompletenessBlocker>();
  for (const blocker of blockers) {
    const normalized = {
      ...blocker,
      observation_ids: uniqueSorted(blocker.observation_ids),
      evidence_fragment_ids: uniqueSorted(blocker.evidence_fragment_ids)
    };
    byContent.set(stableSerialize(normalized), normalized);
  }
  return [...byContent.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, blocker]) => blocker);
}

function validateGraph<NodeId extends string, Node>(
  rootNodeId: NodeId,
  nodes: ReadonlyMap<string, Node>,
  getChildIds: (node: Node) => readonly NodeId[],
  parentCounts: ReadonlyMap<NodeId, number>,
  graphLabel: string
) {
  const visiting = new Set<NodeId>();
  const visited = new Set<NodeId>();

  const visit = (nodeId: NodeId) => {
    if (visiting.has(nodeId)) {
      throw new Cr12StructuredRequirementValidationError(
        "CYCLE_DETECTED",
        `${graphLabel} contains a cycle at ${nodeId}`
      );
    }
    if (visited.has(nodeId)) return;
    const node = requireReference(nodeId, nodes, graphLabel);
    visiting.add(nodeId);
    const childIds = getChildIds(node);
    if (new Set(childIds).size !== childIds.length) {
      throw new Cr12StructuredRequirementValidationError(
        "INVALID_LOGIC_STRUCTURE",
        `${graphLabel} node ${nodeId} repeats a child reference`
      );
    }
    for (const childId of childIds) visit(childId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  visit(rootNodeId);
  if ((parentCounts.get(rootNodeId) ?? 0) !== 0) {
    throw new Cr12StructuredRequirementValidationError(
      "CYCLE_DETECTED",
      `${graphLabel} root must not have a parent`
    );
  }
  for (const nodeId of nodes.keys()) {
    if (!visited.has(nodeId as NodeId)) {
      throw new Cr12StructuredRequirementValidationError(
        "INVALID_LOGIC_STRUCTURE",
        `${graphLabel} contains disconnected node ${nodeId}`
      );
    }
    if (nodeId !== rootNodeId && (parentCounts.get(nodeId as NodeId) ?? 0) !== 1) {
      throw new Cr12StructuredRequirementValidationError(
        "INVALID_LOGIC_STRUCTURE",
        `${graphLabel} non-root node ${nodeId} must have exactly one parent`
      );
    }
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((value) => right.includes(value));
}

function assertContextTargetWithinOpportunity(
  target: RequirementContextBinding["source_context_target"],
  opportunityVersionId: OpportunityVersionId,
  owner: string
) {
  if (target.kind === "OPPORTUNITY_VERSION"
      && target.opportunity_version_id !== opportunityVersionId) {
    throw new Cr12StructuredRequirementValidationError(
      "CROSS_OPPORTUNITY_REFERENCE",
      `${owner} references another OpportunityVersion`
    );
  }
  if (target.kind === "REVISION_RELATION") {
    assertContextTargetWithinOpportunity(
      target.affected_target,
      opportunityVersionId,
      `${owner} revision target`
    );
  }
}
