import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import {
  UTF8_TEXT_ENCODING,
  type CompleteRequirementCompleteness,
  type CompleteRequirementSet,
  type EvidenceLocator,
  type ExtractedRecordId,
  type LogicGroupId,
  type NonCompleteRequirementCompleteness,
  type NonCompleteRequirementSet,
  type NormalizedText,
  type OpportunityVersionId,
  type OriginalText,
  type RequirementApplicability,
  type RequirementCertainty,
  type RequirementClauseRole,
  type RequirementCompletenessBlocker,
  type RequirementCompletenessBlockerCode,
  type RequirementDimension,
  type RequirementEvidence,
  type RequirementEvidenceFragment,
  type RequirementEvidenceFragmentId,
  type RequirementEvidenceId,
  type RequirementFact,
  type RequirementFactId,
  type RequirementObservation,
  type RequirementObservationId,
  type RequirementObservationStatus,
  type RequirementOperator,
  type RequirementPolarity,
  type RequirementSet,
  type RequirementSetId,
  type RequirementSubjectScope,
  type RequirementValue,
  type SnapshotId
} from "../../ingestion";
import {
  P2_LEGAL_05_PARSER_VERSION,
  type GuizhouLegalXlsxRequirementParseResult
} from "../p2-legal-05/guizhou-legal-xlsx-requirement-adapter";

export const P2_LEGAL_06_COMPOSER_VERSION =
  "p2-legal-06-multi-source-requirement-composer/1.0.0";
export const P2_LEGAL_06_NOTICE_SNAPSHOT_ID =
  "p2-legal-02-snapshot:3585d0e1-93a1-4dbd-a451-946acdaa9ee5" as SnapshotId;
export const P2_LEGAL_06_NOTICE_RAW_SHA256 =
  "e517ef5af83b57eea41f953e12117a677e5486cda3b7c521b9888ae5d86b004a";
export const P2_LEGAL_06_TARGET_JOB_CODE = "22828700101";

export type RequirementCompositionSourceKind = "ANNOUNCEMENT" | "JOB_TABLE";
export type RequirementCompositionBlockerCode =
  | RequirementCompletenessBlockerCode
  | "SOURCE_CONFLICT";

export interface RequirementCompositionIdentity {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly source_definition_id: string;
  readonly job_code: string;
  readonly title: string;
  readonly organization: string;
}

export interface RequirementCompositionFactInput {
  readonly source_fact_id: string;
  readonly alignment_key: string;
  readonly dimension: RequirementDimension;
  readonly operator: RequirementOperator;
  readonly value: RequirementValue;
  readonly subject_scope: RequirementSubjectScope;
  readonly logic_operator: "AND" | "OR";
  readonly polarity: RequirementPolarity;
  readonly certainty: RequirementCertainty;
  readonly applicability?: RequirementApplicability;
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
}

export interface RequirementCompositionObservationInput {
  readonly source_observation_id: string;
  readonly status: RequirementObservationStatus;
  readonly clause_role: RequirementClauseRole;
  readonly dimension_hint?: RequirementDimension;
  readonly subject_scope?: RequirementSubjectScope;
  readonly raw_value: string | null;
  readonly normalized_value: string | null;
  readonly source_fact_ids: readonly string[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
}

export interface RequirementSourceAbsence {
  readonly dimension: RequirementDimension;
  readonly subject_scope: RequirementSubjectScope;
  readonly status: "NOT_OBSERVED";
  readonly source_observation_id: string;
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
  readonly source_stage_blocked_completeness: boolean;
}

export interface RequirementCompositionSource {
  readonly source_kind: RequirementCompositionSourceKind;
  readonly source_label: string;
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
  readonly evidence_fragments: readonly RequirementEvidenceFragment[];
  readonly facts: readonly RequirementCompositionFactInput[];
  readonly observations: readonly RequirementCompositionObservationInput[];
  readonly absences: readonly RequirementSourceAbsence[];
}

export interface RequirementCompositionBlockerAudit {
  readonly code: RequirementCompositionBlockerCode;
  readonly source_kinds: readonly (RequirementCompositionSourceKind | "COMPOSITION")[];
  readonly observation_ids: readonly RequirementObservationId[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
  readonly description: string;
}

export interface RequirementFactCompositionAudit {
  readonly requirement_fact_id: RequirementFactId;
  readonly dimension: RequirementDimension;
  readonly scope: RequirementSubjectScope;
  readonly sources: readonly RequirementCompositionSourceKind[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
}

export interface RequirementObservationCompositionAudit {
  readonly requirement_observation_id: RequirementObservationId;
  readonly source: RequirementCompositionSourceKind | "COMPOSITION";
  readonly status: RequirementObservationStatus;
  readonly clause_role: RequirementClauseRole;
  readonly dimension: RequirementDimension | null;
  readonly scope: RequirementSubjectScope | null;
  readonly raw_value: string | null;
  readonly normalized_value: string | null;
  readonly requirement_fact_ids: readonly RequirementFactId[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
}

export interface RequirementSetCompositionResult {
  readonly identity: RequirementCompositionIdentity;
  readonly requirement_set: RequirementSet;
  readonly composition_blockers: readonly RequirementCompositionBlockerAudit[];
  readonly fact_audit: readonly RequirementFactCompositionAudit[];
  readonly observation_audit: readonly RequirementObservationCompositionAudit[];
  readonly source_absences: readonly (RequirementSourceAbsence & {
    readonly source: RequirementCompositionSourceKind;
  })[];
  readonly source_conflicts: readonly RequirementCompositionBlockerAudit[];
  readonly network_requests: 0;
  readonly composer_version: string;
}

interface FactEntry {
  readonly fact: RequirementFact;
  readonly alignment_key: string;
  readonly source_fact_ids: readonly string[];
  readonly source_kinds: readonly RequirementCompositionSourceKind[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
}

interface ObservationEntry {
  readonly observation: RequirementObservation;
  readonly source: RequirementCompositionSourceKind | "COMPOSITION";
  readonly scope: RequirementSubjectScope | null;
  readonly raw_value: string | null;
  readonly normalized_value: string | null;
}

interface NoticeObservationSpec {
  readonly key: string;
  readonly starts_with: string;
  readonly status: Exclude<RequirementObservationStatus, "NOT_OBSERVED">;
  readonly clause_role: RequirementClauseRole;
  readonly dimension_hint?: RequirementDimension;
  readonly subject_scope?: RequirementSubjectScope;
}

const noticeObservationSpecs: readonly NoticeObservationSpec[] = [
  {
    key: "nationality-and-constitutional-support",
    starts_with: "1.具有中华人民共和国国籍",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "political-stance-and-beliefs",
    starts_with: "2.具有正确的政治立场",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "conduct-and-integrity",
    starts_with: "3.遵纪守法",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "willingness-and-responsibility",
    starts_with: "4.安心应聘岗位工作",
    status: "UNPARSED_CLAUSE",
    clause_role: "MANDATORY"
  },
  {
    key: "knowledge-and-work-ability",
    starts_with: "5.具有胜任应聘岗位需要的相关专业知识",
    status: "UNPARSED_CLAUSE",
    clause_role: "MANDATORY"
  },
  {
    key: "tiered-age-rule",
    starts_with: "6.年龄在18周岁以上",
    status: "AMBIGUOUS",
    clause_role: "MANDATORY",
    dimension_hint: "AGE",
    subject_scope: "CANDIDATE"
  },
  {
    key: "health-and-physical-condition",
    starts_with: "7.身体健康",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "in-service-probation-exclusion",
    starts_with: "尚在试用期或服务期内的省内事业单位在编工作人员",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY",
    dimension_hint: "CANDIDATE_COHORT",
    subject_scope: "CANDIDATE"
  },
  {
    key: "professional-catalog-similarity-exception",
    starts_with: "特别提示：（1）报名应聘人员填报的专业名称必须与毕业证和学位证完全一致",
    status: "AMBIGUOUS",
    clause_role: "MANDATORY",
    dimension_hint: "MAJOR",
    subject_scope: "ANY_EDUCATION"
  },
  {
    key: "political-line-disqualification",
    starts_with: "1.不能坚持党的基本路线",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "directed-graduate-disqualification",
    starts_with: "2.定向到具体行业或单位的当年度毕业生",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY",
    dimension_hint: "CANDIDATE_COHORT",
    subject_scope: "CANDIDATE"
  },
  {
    key: "non-2025-current-student-disqualification",
    starts_with: "3.在读的非2025届应届大中专及以上毕业生",
    status: "AMBIGUOUS",
    clause_role: "MANDATORY",
    dimension_hint: "CANDIDATE_COHORT",
    subject_scope: "CANDIDATE"
  },
  {
    key: "active-duty-disqualification",
    starts_with: "4.现役军人",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "criminal-punishment-disqualification",
    starts_with: "5.曾因犯罪受过刑事处罚或受过劳动教养的人员",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "dismissed-public-office-disqualification",
    starts_with: "6.被开除公职的人员",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "disciplinary-and-performance-disqualification",
    starts_with: "7.曾因贪污、行贿受贿、泄露国家机密等原因",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "qualification-proof-disqualification",
    starts_with: "8.截止考察环节未能提交招聘岗位所需资格条件的相关证明材料",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "recruitment-integrity-disqualification",
    starts_with: "10.在事业单位公开招聘中被认定有舞弊等严重违反聘用纪律行为的人员",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "serious-dishonesty-disqualification",
    starts_with: "11.人民法院认定为失信被执行人的",
    status: "DOMAIN_GAP_OBSERVED",
    clause_role: "MANDATORY"
  },
  {
    key: "open-ended-legal-prohibition",
    starts_with: "12.有法律、法规规定不得聘用的人员",
    status: "UNPARSED_CLAUSE",
    clause_role: "MANDATORY"
  }
];

export function buildGuizhouNoticeRequirementSource(
  rawHtml: Uint8Array,
  snapshotId: SnapshotId
): RequirementCompositionSource {
  if (
    snapshotId !== P2_LEGAL_06_NOTICE_SNAPSHOT_ID
    || sha256Bytes(rawHtml) !== P2_LEGAL_06_NOTICE_RAW_SHA256
  ) {
    throw new Error("Notice Raw/Snapshot is not the sealed P2-LEGAL-02 observation");
  }
  const html = new TextDecoder("utf-8", { fatal: true }).decode(rawHtml);
  const document = cheerio.load(html);
  const paragraphs = document(".Article_zw #Zoom .trs_editor_view > p").toArray();
  if (paragraphs.length === 0) throw new Error("Notice article paragraphs are missing");
  const extractedRecordId = `extracted:${sha256(stableSerialize({
    snapshot_id: snapshotId,
    surface: "ANNOUNCEMENT_REQUIREMENTS",
    title: "贵州省司法厅所属事业单位2025年公开招聘工作人员公告"
  }))}` as ExtractedRecordId;
  const fragments: RequirementEvidenceFragment[] = [];
  const observations: RequirementCompositionObservationInput[] = [];
  for (const spec of noticeObservationSpecs) {
    const matches = paragraphs.flatMap((element, index) => {
      const rawText = document(element).text().replace(/\u00a0/gu, " ").trim();
      return rawText.startsWith(spec.starts_with) ? [{ element, index, rawText }] : [];
    });
    if (matches.length !== 1) {
      throw new Error(`Announcement requirement paragraph ${spec.key} matched ${matches.length} times`);
    }
    const match = matches[0]!;
    const fragment = htmlFragment(extractedRecordId, snapshotId, spec, match.index, match.rawText);
    fragments.push(fragment);
    observations.push({
      source_observation_id: `notice-observation:${spec.key}`,
      status: spec.status,
      clause_role: spec.clause_role,
      ...(spec.dimension_hint ? { dimension_hint: spec.dimension_hint } : {}),
      ...(spec.subject_scope ? { subject_scope: spec.subject_scope } : {}),
      raw_value: match.rawText,
      normalized_value: fragment.normalized_text?.text ?? null,
      source_fact_ids: [],
      evidence_fragment_ids: [fragment.requirement_evidence_fragment_id]
    });
  }
  return {
    source_kind: "ANNOUNCEMENT",
    source_label: "贵州省司法厅所属事业单位2025年公开招聘工作人员公告",
    extracted_record_id: extractedRecordId,
    snapshot_id: snapshotId,
    evidence_fragments: fragments,
    facts: [],
    observations,
    absences: [
      absence("notice-degree", "ACADEMIC_DEGREE", "CANDIDATE"),
      absence("notice-work-experience", "WORK_EXPERIENCE", "CANDIDATE"),
      absence("notice-household", "HOUSEHOLD_REGISTRATION", "CANDIDATE"),
      absence("notice-student-origin", "STUDENT_ORIGIN", "CANDIDATE"),
      absence("notice-legal-qualification", "PROFESSIONAL_QUALIFICATION", "CANDIDATE")
    ]
  };
}

export function buildGuizhouJobTableRequirementSource(
  parsed: GuizhouLegalXlsxRequirementParseResult
): RequirementCompositionSource {
  const facts: RequirementCompositionFactInput[] = parsed.fact_candidates.map((fact) => ({
    source_fact_id: fact.fact_candidate_id,
    alignment_key: `${fact.dimension}:${fact.subject_scope}`,
    dimension: fact.dimension,
    operator: fact.operator,
    value: fact.value,
    subject_scope: fact.subject_scope,
    logic_operator: fact.logic_operator,
    polarity: fact.polarity,
    certainty: fact.certainty,
    evidence_fragment_ids: fact.evidence_fragment_ids
  }));
  const observations = parsed.observation_candidates
    .filter((observation) => observation.status !== "NOT_OBSERVED")
    .map((observation): RequirementCompositionObservationInput => ({
      source_observation_id: observation.observation_candidate_id,
      status: observation.status,
      clause_role: observation.clause_role,
      ...(observation.dimension_hint ? { dimension_hint: observation.dimension_hint } : {}),
      ...(observation.subject_scope ? { subject_scope: observation.subject_scope } : {}),
      raw_value: observation.raw_value,
      normalized_value: observation.normalized_value,
      source_fact_ids: observation.fact_candidate_ids,
      evidence_fragment_ids: observation.evidence_fragment_ids
    }));
  const absences = parsed.observation_candidates
    .filter((observation) => observation.status === "NOT_OBSERVED")
    .map((observation): RequirementSourceAbsence => {
      if (!observation.dimension_hint || !observation.subject_scope) {
        throw new Error("P2-LEGAL-05 NOT_OBSERVED source item has no dimension or scope");
      }
      return {
        dimension: observation.dimension_hint,
        subject_scope: observation.subject_scope,
        status: "NOT_OBSERVED",
        source_observation_id: observation.observation_candidate_id,
        evidence_fragment_ids: observation.evidence_fragment_ids,
        source_stage_blocked_completeness: observation.blocks_completeness
      };
    });
  return {
    source_kind: "JOB_TABLE",
    source_label: "贵州省司法厅所属事业单位2025年公开招聘工作人员岗位及要求一览表",
    extracted_record_id: parsed.record.extracted_record_id,
    snapshot_id: parsed.record.snapshot_id,
    evidence_fragments: parsed.evidence_fragments,
    facts,
    observations,
    absences
  };
}

export function composeRequirementSet(
  identity: RequirementCompositionIdentity,
  sources: readonly RequirementCompositionSource[]
): RequirementSetCompositionResult {
  if (sources.length === 0) throw new Error("Requirement composition needs at least one source");
  const fragmentCatalog = buildFragmentCatalog(sources);
  const factEntries = buildFacts(identity, sources, fragmentCatalog);
  const factBySourceId = new Map<string, RequirementFactId>();
  for (const entry of factEntries) {
    for (const sourceFactId of entry.source_fact_ids) factBySourceId.set(sourceFactId, entry.fact.requirement_fact_id);
  }
  const sourceObservations = buildSourceObservations(identity, sources, factBySourceId);
  const conflictResult = buildConflictObservations(identity, sources, factEntries);
  const observationEntries = [...sourceObservations, ...conflictResult.observations];
  const observations = observationEntries.map((entry) => entry.observation);
  const evidence = buildRequirementEvidence(factEntries, fragmentCatalog);
  const domainBlockers = observationEntries.flatMap((entry): RequirementCompletenessBlocker[] => {
    if (entry.observation.status === "CONFIRMED_REQUIREMENT") return [];
    return [{
      code: entry.observation.status,
      observation_ids: [entry.observation.requirement_observation_id],
      evidence_fragment_ids: entry.observation.evidence_fragment_ids,
      description: blockerDescription(entry.observation.status)
    }];
  }).sort(compareStable);
  const evidenceFragments = [...fragmentCatalog.values()].sort(compareFragment);
  const facts = factEntries.map((entry) => entry.fact).sort(compareFact);
  const requirementSet = buildRequirementSet(
    identity,
    sources,
    evidenceFragments,
    facts,
    evidence,
    observations,
    domainBlockers
  );
  const observationAudit = observationEntries.map((entry): RequirementObservationCompositionAudit => ({
    requirement_observation_id: entry.observation.requirement_observation_id,
    source: entry.source,
    status: entry.observation.status,
    clause_role: entry.observation.clause_role,
    dimension: entry.observation.dimension_hint ?? null,
    scope: entry.scope,
    raw_value: entry.raw_value,
    normalized_value: entry.normalized_value,
    requirement_fact_ids: entry.observation.requirement_fact_ids,
    evidence_fragment_ids: entry.observation.evidence_fragment_ids
  }));
  const sourceBlockers = observationAudit.flatMap((observation): RequirementCompositionBlockerAudit[] => {
    if (observation.status === "CONFIRMED_REQUIREMENT") return [];
    return [{
      code: observation.status,
      source_kinds: [observation.source],
      observation_ids: [observation.requirement_observation_id],
      evidence_fragment_ids: observation.evidence_fragment_ids,
      description: blockerDescription(observation.status)
    }];
  });
  return {
    identity,
    requirement_set: requirementSet,
    composition_blockers: [...sourceBlockers, ...conflictResult.blockers].sort(compareStable),
    fact_audit: factEntries.map((entry) => ({
      requirement_fact_id: entry.fact.requirement_fact_id,
      dimension: entry.fact.dimension,
      scope: entry.fact.subject_scope,
      sources: entry.source_kinds,
      evidence_fragment_ids: entry.evidence_fragment_ids
    })),
    observation_audit: observationAudit,
    source_absences: sources.flatMap((source) => source.absences.map((item) => ({
      ...item,
      source: source.source_kind
    }))),
    source_conflicts: conflictResult.blockers,
    network_requests: 0,
    composer_version: P2_LEGAL_06_COMPOSER_VERSION
  };
}

function buildFragmentCatalog(sources: readonly RequirementCompositionSource[]) {
  const catalog = new Map<RequirementEvidenceFragmentId, RequirementEvidenceFragment>();
  for (const source of sources) {
    for (const fragment of source.evidence_fragments) {
      if (
        fragment.extracted_record_id !== source.extracted_record_id
        || fragment.snapshot_id !== source.snapshot_id
      ) {
        throw new Error(`Evidence Fragment escapes its declared source: ${fragment.requirement_evidence_fragment_id}`);
      }
      const existing = catalog.get(fragment.requirement_evidence_fragment_id);
      if (existing && stableSerialize(existing) !== stableSerialize(fragment)) {
        throw new Error(`Conflicting duplicate Evidence Fragment ${fragment.requirement_evidence_fragment_id}`);
      }
      catalog.set(fragment.requirement_evidence_fragment_id, fragment);
    }
  }
  return catalog;
}

function buildFacts(
  identity: RequirementCompositionIdentity,
  sources: readonly RequirementCompositionSource[],
  fragments: ReadonlyMap<RequirementEvidenceFragmentId, RequirementEvidenceFragment>
): readonly FactEntry[] {
  const grouped = new Map<string, Array<{
    source: RequirementCompositionSource;
    input: RequirementCompositionFactInput;
  }>>();
  for (const source of sources) {
    for (const input of source.facts) {
      for (const fragmentId of input.evidence_fragment_ids) {
        const fragment = fragments.get(fragmentId);
        if (!fragment || fragment.extracted_record_id !== source.extracted_record_id) {
          throw new Error(`Fact evidence does not belong to source: ${input.source_fact_id}`);
        }
      }
      const key = factSemanticKey(input);
      const current = grouped.get(key) ?? [];
      current.push({ source, input });
      grouped.set(key, current);
    }
  }
  return [...grouped.entries()].map(([semanticKey, members]): FactEntry => {
    const template = members[0]!.input;
    const alignmentKeys = uniqueSorted(members.map((member) => member.input.alignment_key));
    if (alignmentKeys.length !== 1) throw new Error("Equivalent Facts use different alignment keys");
    const logicGroupId = `logic-group:${sha256(stableSerialize({
      opportunity_version_id: identity.opportunity_version_id,
      alignment_key: alignmentKeys[0],
      operator: template.logic_operator
    }))}` as LogicGroupId;
    const requirementFactId = `requirement-fact:${sha256(stableSerialize({
      opportunity_version_id: identity.opportunity_version_id,
      semantic_key: semanticKey
    }))}` as RequirementFactId;
    const evidenceFragmentIds = uniqueSorted(members.flatMap(
      (member) => member.input.evidence_fragment_ids
    ));
    return {
      fact: {
        requirement_fact_id: requirementFactId,
        opportunity_version_id: identity.opportunity_version_id,
        dimension: template.dimension,
        operator: template.operator,
        value: template.value,
        subject_scope: template.subject_scope,
        logic_group: { logic_group_id: logicGroupId, operator: template.logic_operator },
        polarity: template.polarity,
        certainty: template.certainty,
        ...(template.applicability ? { applicability: template.applicability } : {}),
        parser_version: P2_LEGAL_06_COMPOSER_VERSION
      },
      alignment_key: alignmentKeys[0]!,
      source_fact_ids: uniqueSorted(members.map((member) => member.input.source_fact_id)),
      source_kinds: uniqueSorted(members.map((member) => member.source.source_kind)),
      evidence_fragment_ids: evidenceFragmentIds
    };
  });
}

function buildSourceObservations(
  identity: RequirementCompositionIdentity,
  sources: readonly RequirementCompositionSource[],
  factBySourceId: ReadonlyMap<string, RequirementFactId>
): readonly ObservationEntry[] {
  return sources.flatMap((source) => source.observations.map((input) => {
    const factIds = input.source_fact_ids.map((factId) => {
      const finalFactId = factBySourceId.get(factId);
      if (!finalFactId) throw new Error(`Observation references missing Fact ${factId}`);
      return finalFactId;
    });
    const requirementObservationId = `requirement-observation:${sha256(stableSerialize({
      opportunity_version_id: identity.opportunity_version_id,
      source_kind: source.source_kind,
      source_observation_id: input.source_observation_id,
      status: input.status,
      fact_ids: factIds,
      evidence_fragment_ids: input.evidence_fragment_ids
    }))}` as RequirementObservationId;
    return {
      observation: {
        requirement_observation_id: requirementObservationId,
        opportunity_version_id: identity.opportunity_version_id,
        status: input.status,
        clause_role: input.clause_role,
        ...(input.dimension_hint ? { dimension_hint: input.dimension_hint } : {}),
        requirement_fact_ids: factIds,
        evidence_fragment_ids: nonEmpty(input.evidence_fragment_ids, "Observation Evidence"),
        parser_version: P2_LEGAL_06_COMPOSER_VERSION
      } satisfies RequirementObservation,
      source: source.source_kind as RequirementCompositionSourceKind | "COMPOSITION",
      scope: input.subject_scope ?? null,
      raw_value: input.raw_value,
      normalized_value: input.normalized_value
    };
  }));
}

function buildConflictObservations(
  identity: RequirementCompositionIdentity,
  sources: readonly RequirementCompositionSource[],
  factEntries: readonly FactEntry[]
) {
  const factEntryBySourceFactId = new Map<string, FactEntry>();
  for (const entry of factEntries) {
    for (const sourceFactId of entry.source_fact_ids) factEntryBySourceFactId.set(sourceFactId, entry);
  }
  const aligned = new Map<string, Map<string, RequirementCompositionFactInput[]>>();
  for (const source of sources) {
    const sourceKey = `${source.extracted_record_id}\u0000${source.snapshot_id}`;
    for (const fact of source.facts) {
      const bySource = aligned.get(fact.alignment_key) ?? new Map<string, RequirementCompositionFactInput[]>();
      const current = bySource.get(sourceKey) ?? [];
      current.push(fact);
      bySource.set(sourceKey, current);
      aligned.set(fact.alignment_key, bySource);
    }
  }
  const observations: ObservationEntry[] = [];
  const blockers: RequirementCompositionBlockerAudit[] = [];
  for (const [alignmentKey, bySource] of aligned) {
    if (bySource.size < 2) continue;
    const signatures = [...bySource.values()].map((facts) => stableSerialize(
      facts.map(factSemanticKey).sort()
    ));
    if (new Set(signatures).size === 1) continue;
    const sourceFacts = [...bySource.values()].flat();
    const entries = uniqueBy(sourceFacts.map((fact) => {
      const entry = factEntryBySourceFactId.get(fact.source_fact_id);
      if (!entry) throw new Error(`Conflict references missing Fact ${fact.source_fact_id}`);
      return entry;
    }), (entry) => entry.fact.requirement_fact_id);
    const factIds = entries.map((entry) => entry.fact.requirement_fact_id);
    const evidenceFragmentIds = uniqueSorted(entries.flatMap((entry) => entry.evidence_fragment_ids));
    const dimension = uniqueSorted(entries.map((entry) => entry.fact.dimension));
    const scopes = uniqueSorted(entries.map((entry) => entry.fact.subject_scope));
    const requirementObservationId = `requirement-observation:${sha256(stableSerialize({
      opportunity_version_id: identity.opportunity_version_id,
      source_conflict: alignmentKey,
      facts: factIds,
      evidence_fragment_ids: evidenceFragmentIds
    }))}` as RequirementObservationId;
    const observation: RequirementObservation = {
      requirement_observation_id: requirementObservationId,
      opportunity_version_id: identity.opportunity_version_id,
      status: "AMBIGUOUS",
      clause_role: "MANDATORY",
      ...(dimension.length === 1 ? { dimension_hint: dimension[0] } : {}),
      requirement_fact_ids: factIds,
      evidence_fragment_ids: nonEmpty(evidenceFragmentIds, "Conflict Evidence"),
      parser_version: P2_LEGAL_06_COMPOSER_VERSION
    };
    observations.push({
      observation,
      source: "COMPOSITION",
      scope: scopes.length === 1 ? scopes[0]! : null,
      raw_value: null,
      normalized_value: null
    });
    blockers.push({
      code: "SOURCE_CONFLICT",
      source_kinds: uniqueSorted(sourceFacts.map((fact) => {
        const source = sources.find((item) => item.facts.includes(fact));
        if (!source) throw new Error("Conflict Fact source is missing");
        return source.source_kind;
      })),
      observation_ids: [requirementObservationId],
      evidence_fragment_ids: evidenceFragmentIds,
      description: `Sources disagree for aligned requirement ${alignmentKey}`
    });
  }
  return { observations, blockers };
}

function buildRequirementEvidence(
  facts: readonly FactEntry[],
  fragments: ReadonlyMap<RequirementEvidenceFragmentId, RequirementEvidenceFragment>
) {
  return facts.flatMap((entry) => entry.evidence_fragment_ids.map((fragmentId): RequirementEvidence => {
    const fragment = fragments.get(fragmentId);
    if (!fragment || fragment.observed_value_state !== "TEXT") {
      throw new Error(`Fact Evidence Fragment is missing source text: ${fragmentId}`);
    }
    return {
      requirement_evidence_id: `requirement-evidence:${sha256(stableSerialize({
        requirement_fact_id: entry.fact.requirement_fact_id,
        evidence_fragment_id: fragmentId
      }))}` as RequirementEvidenceId,
      requirement_fact_id: entry.fact.requirement_fact_id,
      snapshot_id: fragment.snapshot_id,
      locator: evidenceLocator(fragment),
      evidence_text: fragment.original_text,
      ...(fragment.normalized_text ? { normalized_text: fragment.normalized_text } : {}),
      extractor_name: fragment.extractor_name,
      extractor_version: fragment.extractor_version,
      parser_version: P2_LEGAL_06_COMPOSER_VERSION
    };
  })).sort(compareEvidence);
}

function buildRequirementSet(
  identity: RequirementCompositionIdentity,
  sources: readonly RequirementCompositionSource[],
  evidenceFragments: readonly RequirementEvidenceFragment[],
  facts: readonly RequirementFact[],
  evidence: readonly RequirementEvidence[],
  observations: readonly RequirementObservation[],
  blockers: readonly RequirementCompletenessBlocker[]
): RequirementSet {
  const baseContent = {
    opportunity_version_id: identity.opportunity_version_id,
    evidence_fragments: evidenceFragments,
    observations,
    facts,
    evidence,
    covered_extracted_record_ids: uniqueSorted(sources.map((source) => source.extracted_record_id)),
    covered_snapshot_ids: uniqueSorted(sources.map((source) => source.snapshot_id)),
    observation_ids: uniqueSorted(observations.map((observation) => observation.requirement_observation_id)),
    fact_ids: uniqueSorted(facts.map((fact) => fact.requirement_fact_id)),
    evidence_ids: uniqueSorted(evidence.map((item) => item.requirement_evidence_id)),
    gate_version: P2_LEGAL_06_COMPOSER_VERSION,
    parser_version: P2_LEGAL_06_COMPOSER_VERSION
  };
  const contentHash = sha256(stableSerialize(baseContent));
  const requirementSetId = `requirement-set:${contentHash}` as RequirementSetId;
  const setBase = {
    requirement_set_id: requirementSetId,
    opportunity_version_id: identity.opportunity_version_id,
    evidence_fragments: evidenceFragments,
    observations,
    facts,
    evidence,
    parser_version: P2_LEGAL_06_COMPOSER_VERSION
  };
  const completenessBase = {
    requirement_set_id: requirementSetId,
    requirement_set_content_hash: contentHash,
    covered_extracted_record_ids: baseContent.covered_extracted_record_ids,
    covered_snapshot_ids: baseContent.covered_snapshot_ids,
    observation_ids: baseContent.observation_ids,
    fact_ids: baseContent.fact_ids,
    evidence_ids: baseContent.evidence_ids,
    gate_version: P2_LEGAL_06_COMPOSER_VERSION
  };
  if (blockers.length === 0) {
    const completeness: CompleteRequirementCompleteness = {
      ...completenessBase,
      status: "COMPLETE",
      blockers: []
    };
    return { ...setBase, completeness } satisfies CompleteRequirementSet;
  }
  const completeness: NonCompleteRequirementCompleteness = {
    ...completenessBase,
    status: blockers.some((blocker) => isIncompleteBlocker(blocker.code))
      ? "INCOMPLETE"
      : "REVIEW_REQUIRED",
    blockers: nonEmpty(blockers, "Requirement Completeness blocker")
  };
  return { ...setBase, completeness } satisfies NonCompleteRequirementSet;
}

function htmlFragment(
  extractedRecordId: ExtractedRecordId,
  snapshotId: SnapshotId,
  spec: NoticeObservationSpec,
  paragraphIndex: number,
  rawText: string
): RequirementEvidenceFragment {
  const selector = `.Article_zw #Zoom .trs_editor_view > p:nth-of-type(${paragraphIndex + 1})`;
  return {
    requirement_evidence_fragment_id: `requirement-evidence-fragment:${sha256(stableSerialize({
      extracted_record_id: extractedRecordId,
      snapshot_id: snapshotId,
      key: spec.key,
      selector,
      text: rawText
    }))}` as RequirementEvidenceFragmentId,
    extracted_record_id: extractedRecordId,
    snapshot_id: snapshotId,
    locator: {
      kind: "HTML",
      selector,
      field_path: `announcement.requirements.${spec.key}`
    },
    extractor_name: "GuizhouOfficialNoticeRequirementSurfaceExtractor",
    extractor_version: P2_LEGAL_06_COMPOSER_VERSION,
    parser_version: P2_LEGAL_06_COMPOSER_VERSION,
    observed_value_state: "TEXT",
    original_text: original(rawText),
    normalized_text: normalized(rawText)
  };
}

function absence(
  sourceObservationId: string,
  dimension: RequirementDimension,
  subjectScope: RequirementSubjectScope
): RequirementSourceAbsence {
  return {
    dimension,
    subject_scope: subjectScope,
    status: "NOT_OBSERVED",
    source_observation_id: sourceObservationId,
    evidence_fragment_ids: [],
    source_stage_blocked_completeness: false
  };
}

function factSemanticKey(input: RequirementCompositionFactInput) {
  return stableSerialize({
    dimension: input.dimension,
    operator: input.operator,
    value: input.value,
    subject_scope: input.subject_scope,
    logic_operator: input.logic_operator,
    polarity: input.polarity,
    certainty: input.certainty,
    applicability: input.applicability ?? null
  });
}

function evidenceLocator(fragment: RequirementEvidenceFragment): EvidenceLocator {
  const locator = fragment.locator;
  if (locator.kind === "HTML") {
    return {
      kind: "HTML",
      section: locator.selector,
      field_path: locator.field_path ?? locator.path,
      start_offset: locator.start_offset,
      end_offset: locator.end_offset
    };
  }
  if (locator.kind === "SPREADSHEET") {
    return {
      kind: "SPREADSHEET",
      sheet: locator.sheet,
      cell_or_range: locator.cell_or_range,
      field_path: locator.field_path
    };
  }
  if (locator.kind === "JSON") {
    return { kind: "JSON", json_path: locator.json_path, field_path: locator.field_path };
  }
  return {
    kind: "DOCUMENT",
    page_number: locator.page_number,
    section: locator.section,
    text_locator: locator.text_locator,
    field_path: locator.field_path
  };
}

function blockerDescription(status: RequirementObservationStatus) {
  if (status === "NOT_OBSERVED") return "Expected requirement content was not observed";
  if (status === "UNPARSED_CLAUSE") return "A mandatory source clause was not parsed safely";
  if (status === "AMBIGUOUS") return "A mandatory source clause has unresolved semantics";
  if (status === "DOMAIN_GAP_OBSERVED") {
    return "A mandatory source clause is outside the approved typed Requirement Domain";
  }
  return "Confirmed requirement";
}

function isIncompleteBlocker(code: RequirementCompletenessBlockerCode) {
  return code === "NOT_OBSERVED"
    || code === "ATTACHMENT_MISSING"
    || code === "EVIDENCE_INCOMPLETE";
}

function nonEmpty<T>(values: readonly T[], label: string): readonly [T, ...T[]] {
  const first = values[0];
  if (first === undefined) throw new Error(`${label} must not be empty`);
  return [first, ...values.slice(1)];
}

function compareFragment(left: RequirementEvidenceFragment, right: RequirementEvidenceFragment) {
  return left.requirement_evidence_fragment_id.localeCompare(right.requirement_evidence_fragment_id);
}

function compareFact(left: RequirementFact, right: RequirementFact) {
  return left.requirement_fact_id.localeCompare(right.requirement_fact_id);
}

function compareEvidence(left: RequirementEvidence, right: RequirementEvidence) {
  return left.requirement_evidence_id.localeCompare(right.requirement_evidence_id);
}

function compareStable(left: unknown, right: unknown) {
  return stableSerialize(left).localeCompare(stableSerialize(right));
}

function uniqueSorted<T extends string>(values: readonly T[]) {
  return [...new Set(values)].sort();
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

function normalized(text: string): NormalizedText {
  return {
    text: text.normalize("NFKC").replace(/\r\n?/gu, "\n").replace(/[\t ]+/gu, " ").trim(),
    unicode_form: "NFKC",
    normalizer_version: `${P2_LEGAL_06_COMPOSER_VERSION}/text-normalizer`,
    operations: ["UNICODE_NORMALIZATION", "WIDTH_FOLDING", "WHITESPACE_FOLDING"]
  };
}

function original(text: string): OriginalText {
  return { text, encoding: UTF8_TEXT_ENCODING };
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

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createP2Legal06OpportunityVersionId(
  sourceDefinitionId: string,
  jobCode: string,
  snapshotIds: readonly SnapshotId[]
) {
  return `opportunity-version:${sha256(stableSerialize({
    source_definition_id: sourceDefinitionId,
    job_code: jobCode,
    snapshot_ids: uniqueSorted(snapshotIds)
  }))}` as OpportunityVersionId;
}

export const P2_LEGAL_06_JOB_TABLE_PARSER_VERSION = P2_LEGAL_05_PARSER_VERSION;
