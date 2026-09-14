import type {
  EvidenceLocator,
  ExtractedRecordV2,
  IsoDateTime,
  LegalEmploymentRelevanceAssessment,
  LegalEmploymentRelevanceAssessmentId,
  LegalEmploymentRelevanceDecisionBasis,
  LegalEmploymentRelevanceFinding,
  LegalEmploymentRelevanceFindingId,
  OpportunityVersionId,
  PositionId,
  SourceCompositionEvidenceId,
  SourceCompositionResult,
  SourceCompositionResultId,
  SourceOccurrenceVersionId,
  SourceSurface,
  SourceSurfaceId
} from "../domain";
import {
  LEGAL_EMPLOYMENT_RELEVANCE_MATERIALIZATION_VERSION,
  LEGAL_EMPLOYMENT_RELEVANCE_SCHEMA_VERSION,
  LEGAL_EMPLOYMENT_RELEVANCE_STATES,
  LEGAL_EMPLOYMENT_RELEVANCE_TAXONOMY_VERSION
} from "../domain";
import {
  assertTrustedPositionBoundOpportunityResolver,
  assertTrustedSourceOccurrenceVersionResolver,
  type PositionIdentityResolutionInput,
  type TrustedPositionBoundOpportunityResolver,
  type TrustedSourceOccurrenceVersionResolver
} from "../normalization";
import {
  CanonicalArtifactRegistryError,
  canonicalHash,
  canonicalSerialize,
  createCanonicalArtifactRegistryAuthority
} from "../normalization/canonical-artifact-registry";
import { assertSourceCompositionResultIntegrity } from "../requirements";
import {
  assertTrustedSourceCompositionResolver,
  type TrustedSourceCompositionResolver
} from "./position-bound-source-composition";

export interface LegalEmploymentRelevanceCommand {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly source_composition_id: SourceCompositionResultId;
  readonly created_at: IsoDateTime;
}

export interface LegalEmploymentRelevanceAssessmentResult {
  readonly version_created: boolean;
  readonly assessment: LegalEmploymentRelevanceAssessment;
}

export interface TrustedLegalEmploymentRelevanceResolver {
  resolve(
    assessmentId: LegalEmploymentRelevanceAssessmentId
  ): LegalEmploymentRelevanceAssessment | null;
  list(positionId: PositionId): readonly LegalEmploymentRelevanceAssessment[];
}

const trustedRelevanceResolvers = new WeakSet<object>();

const DIRECT_LEGAL_RULES = [
  ["LEGAL_ROLE_TITLE", /(?:法务岗|法律岗|法律事务岗|法律合规岗|合规法务岗)/u],
  ["LEGAL_REVIEW", /(?:法律审查|合同法律审查|交易法律审查)/u],
  ["LEGAL_DOCUMENT_DRAFTING", /(?:法律文书|合同起草)/u],
  ["DISPUTE_RESOLUTION", /(?:诉讼|仲裁|合同纠纷)/u],
  ["LEGAL_RISK", /法律风险/u],
  ["COMPLIANCE_SYSTEM", /(?:法律合规|监管合规|合规体系|用工合规|销售合规|数据合规|隐私合规|产品法规合规)/u],
  ["LEGAL_ADVICE", /法律咨询/u],
  ["INTELLECTUAL_PROPERTY_LEGAL", /知识产权法律事务/u],
  ["LABOR_LAW", /(?:劳动法|劳动争议)/u],
  ["LEGAL_DUE_DILIGENCE", /法律尽调/u],
  ["LEGAL_APPLICATION", /(?:纪律执法|法律适用)/u],
  ["LEGAL_TECHNOLOGY", /法律科技/u],
  ["TAX_LAW", /税法/u]
] as const;

const LEGAL_MAJOR_RULES = [
  ["LAW_MAJOR", /(?:法学类|法学专业|法律专业)/u],
  ["LAW_DIRECTORY_0301", /(?:法学\s*[（(]?0301[）)]?|0301\s*法学)/u],
  ["LAW_DIRECTORY_0351", /(?:法律\s*[（(]?0351[）)]?|0351\s*法律)/u]
] as const;

const LEGAL_QUALIFICATION_RULES = [
  ["LEGAL_PROFESSIONAL_QUALIFICATION", /法律职业资格/u]
] as const;

const LEGAL_ADJACENT_RULES = [
  ["CONTRACT_MANAGEMENT", /合同管理/u],
  ["RISK_MANAGEMENT", /风险管理/u],
  ["COMPLIANCE_MANAGEMENT", /合规管理/u],
  ["REGULATORY_FUNCTION", /监管/u],
  ["DISCIPLINE_INSPECTION", /纪检监察/u],
  ["AUDIT_FUNCTION", /审计/u],
  ["DUE_DILIGENCE", /尽调/u],
  ["INTERNAL_CONTROL", /内控/u],
  ["EMPLOYEE_RELATIONS", /员工关系/u],
  ["PRIVACY_OR_SECURITY_GOVERNANCE", /(?:隐私治理|安全治理)/u],
  ["STANDARD_OR_CERTIFICATION", /(?:标准|认证)/u],
  ["INSTITUTIONAL_GOVERNANCE", /制度建设/u]
] as const;

const CLEAR_NON_LEGAL_RULES = [
  ["MECHANICAL_ENGINEERING", /(?:机械设计|机械制造|工艺设计|产品研发)/u],
  ["SOFTWARE_ENGINEERING", /(?:软件开发|系统开发|程序开发|软件测试|系统架构|代码开发)/u],
  ["FINANCIAL_ACCOUNTING", /(?:会计核算|财务报表|资金管理|账务处理)/u],
  ["SALES_EXECUTION", /(?:销售执行|客户开发|销售指标|市场拓展)/u],
  ["ADMINISTRATION", /(?:行政事务|会议组织|会务工作|后勤保障|人事行政)/u],
  ["TECHNICAL_QUALITY_COMPLIANCE", /(?:技术质量合规|质量标准执行)/u],
  ["MARKET_OR_CREDIT_RISK", /(?:市场风险|信用风险|生产风险|量化风险)/u],
  ["FINANCIAL_OR_TECHNICAL_AUDIT", /(?:财务审计|IT审计|工程审计)/u],
  ["INVESTMENT_ANALYSIS", /(?:估值模型|行业研究|投后运营)/u],
  ["HUMAN_RESOURCES_OPERATIONS", /(?:招聘管理|培训管理|薪酬管理)/u]
] as const;

export class LegalEmploymentRelevanceError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "TRUSTED_ARTIFACT_UNAVAILABLE"
    | "TRUSTED_ARTIFACT_MISMATCH"
    | "IDENTITY_COLLISION"
    | "NOT_RELEVANT_GATE_REJECTED";

  constructor(code: LegalEmploymentRelevanceError["code"], message: string) {
    super(message);
    this.name = "LegalEmploymentRelevanceError";
    this.code = code;
  }
}

export class InMemoryLegalEmploymentRelevanceTracker
implements TrustedLegalEmploymentRelevanceResolver {
  readonly #pbovResolver: TrustedPositionBoundOpportunityResolver;
  readonly #compositionResolver: TrustedSourceCompositionResolver;
  readonly #sourceResolver: TrustedSourceOccurrenceVersionResolver | null;
  readonly #assessmentIdsByPosition = new Map<
    PositionId,
    LegalEmploymentRelevanceAssessmentId[]
  >();
  readonly #registry = createCanonicalArtifactRegistryAuthority<
    LegalEmploymentRelevanceAssessmentId,
    LegalEmploymentRelevanceAssessment
  >((assessment) => assessment.assessment_id);

  constructor(
    pbovResolver: TrustedPositionBoundOpportunityResolver,
    compositionResolver: TrustedSourceCompositionResolver,
    sourceResolver: TrustedSourceOccurrenceVersionResolver | null = null
  ) {
    this.#pbovResolver = assertTrustedPositionBoundOpportunityResolver(pbovResolver);
    this.#compositionResolver = assertTrustedSourceCompositionResolver(
      compositionResolver
    );
    this.#sourceResolver = sourceResolver
      ? assertTrustedSourceOccurrenceVersionResolver(sourceResolver)
      : null;
    trustedRelevanceResolvers.add(this);
  }

  process(
    command: LegalEmploymentRelevanceCommand
  ): LegalEmploymentRelevanceAssessmentResult {
    requireCommandShape(command);
    const graph = this.#pbovResolver.resolve(command.opportunity_version_id);
    const positionSources = this.#pbovResolver.resolveSources(
      command.opportunity_version_id
    );
    const composition = this.#compositionResolver.resolve(
      command.source_composition_id
    );
    if (!graph || !positionSources || !composition) {
      throw unavailable("Trusted PBOV or SourceComposition is unavailable");
    }
    assertSourceCompositionResultIntegrity(composition);
    if (composition.opportunity_version_id !== command.opportunity_version_id
        || graph.opportunity_version.opportunity_version_id
          !== command.opportunity_version_id
        || graph.position_version.position_version_id
          !== graph.opportunity_version.position_version_id) {
      throw mismatch("Relevance upstream artifacts do not describe one Position");
    }

    const materialization = materializeDecision(
      composition,
      positionSources,
      this.#sourceResolver,
      command.opportunity_version_id
    );
    const history = this.list(graph.position.position_id);
    const semanticInput = {
      position_id: graph.position.position_id,
      position_version_id: graph.position_version.position_version_id,
      opportunity_version_id: graph.opportunity_version.opportunity_version_id,
      source_composition_id: composition.source_composition_id,
      source_composition_hash: composition.composition_hash,
      source_composition_manifest_hash: composition.composition_manifest_hash,
      source_occurrence_version_ids: materialization.sourceVersionIds,
      assessment_state: materialization.state,
      evidence_ids: materialization.evidenceIds,
      findings: materialization.findings,
      coverage_state: materialization.coverageState,
      decision_basis: materialization.basis,
      taxonomy_version: LEGAL_EMPLOYMENT_RELEVANCE_TAXONOMY_VERSION,
      materialization_version:
        LEGAL_EMPLOYMENT_RELEVANCE_MATERIALIZATION_VERSION,
      schema_version: LEGAL_EMPLOYMENT_RELEVANCE_SCHEMA_VERSION
    } as const;
    const existing = history.find((assessment) => {
      return canonicalSerialize(semanticAssessmentInput(assessment))
        === canonicalSerialize(semanticInput);
    });
    if (existing) {
      return { version_created: false, assessment: existing };
    }
    const assessmentVersion = history.length + 1;
    const assessmentWithoutIntegrity = {
      assessment_id: assessmentIdFor(
        graph.position.position_id,
        assessmentVersion
      ),
      ...semanticInput,
      assessment_version: assessmentVersion,
      created_at: requireDate(command.created_at, "Assessment creation time")
    } as const;
    const assessment = assertLegalEmploymentRelevanceAssessmentIntegrity({
      ...assessmentWithoutIntegrity,
      integrity_hash: canonicalHash(assessmentWithoutIntegrity)
    });
    let sealed;
    try {
      sealed = this.#registry.writer.seal(assessment.assessment_id, assessment);
    } catch (error) {
      if (error instanceof CanonicalArtifactRegistryError
          && error.code === "IDENTITY_COLLISION") {
        throw new LegalEmploymentRelevanceError(
          "IDENTITY_COLLISION",
          `Relevance assessment identity collision: ${assessment.assessment_id}`
        );
      }
      throw error;
    }
    if (sealed.status === "SEALED") {
      const ids = this.#assessmentIdsByPosition.get(graph.position.position_id)
        ?? [];
      ids.push(assessment.assessment_id);
      this.#assessmentIdsByPosition.set(graph.position.position_id, ids);
    }
    return {
      version_created: sealed.status === "SEALED",
      assessment: assertLegalEmploymentRelevanceAssessmentIntegrity(
        sealed.artifact
      )
    };
  }

  resolve(assessmentId: LegalEmploymentRelevanceAssessmentId) {
    const assessment = this.#registry.resolver.resolve(assessmentId);
    return assessment
      ? assertLegalEmploymentRelevanceAssessmentIntegrity(assessment)
      : null;
  }

  list(positionId: PositionId) {
    return (this.#assessmentIdsByPosition.get(positionId) ?? []).map((id) => {
      const assessment = this.resolve(id);
      if (!assessment) throw unavailable("Relevance history is internally incomplete");
      return assessment;
    });
  }
}

export function assertTrustedLegalEmploymentRelevanceResolver(
  resolver: TrustedLegalEmploymentRelevanceResolver
) {
  if (!trustedRelevanceResolvers.has(resolver as object)
      || Object.getPrototypeOf(resolver)
        !== InMemoryLegalEmploymentRelevanceTracker.prototype) {
    throw new LegalEmploymentRelevanceError(
      "INVALID_INPUT",
      "Relevance resolver must be composition-root controlled"
    );
  }
  return resolver;
}

export function validateNotRelevantDecisionBasis(
  coverageState: LegalEmploymentRelevanceAssessment["coverage_state"],
  basis: LegalEmploymentRelevanceDecisionBasis
) {
  if (coverageState !== "CLOSED"
      || basis.position_binding !== "TRUSTED"
      || basis.non_law_function !== "CLEAR"
      || basis.direct_legal_evidence !== "ABSENT"
      || basis.legal_major_evidence !== "ABSENT"
      || basis.legal_qualification_evidence !== "ABSENT"
      || basis.material_conflict !== "NONE"
      || basis.evidence_gap_codes.length !== 0) {
    throw new LegalEmploymentRelevanceError(
      "NOT_RELEVANT_GATE_REJECTED",
      "NOT_RELEVANT requires closed coverage and affirmative non-legal proof"
    );
  }
  return structuredClone(basis);
}

export function assertLegalEmploymentRelevanceAssessmentIntegrity(
  assessment: LegalEmploymentRelevanceAssessment
): LegalEmploymentRelevanceAssessment {
  if (!LEGAL_EMPLOYMENT_RELEVANCE_STATES.includes(assessment.assessment_state)) {
    throw invalid("Relevance assessment state is unsupported");
  }
  if (!Number.isInteger(assessment.assessment_version)
      || assessment.assessment_version < 1) {
    throw invalid("Relevance assessment version must be positive");
  }
  requireDate(assessment.created_at, "Assessment creation time");
  if (assessment.schema_version !== LEGAL_EMPLOYMENT_RELEVANCE_SCHEMA_VERSION
      || assessment.taxonomy_version
        !== LEGAL_EMPLOYMENT_RELEVANCE_TAXONOMY_VERSION
      || assessment.materialization_version
        !== LEGAL_EMPLOYMENT_RELEVANCE_MATERIALIZATION_VERSION) {
    throw invalid("Relevance assessment contract version is unsupported");
  }
  if (assessment.assessment_id !== assessmentIdFor(
    assessment.position_id,
    assessment.assessment_version
  )) {
    throw invalid("Relevance assessment ID does not match Position revision");
  }
  const { integrity_hash: integrityHash, ...canonical } = assessment;
  if (integrityHash !== canonicalHash(canonical)) {
    throw invalid("Relevance assessment integrity hash does not match content");
  }
  const findingEvidence = uniqueSorted(assessment.findings.flatMap((finding) => {
    validateFinding(finding);
    return finding.source_composition_evidence_id
      ? [finding.source_composition_evidence_id]
      : [];
  }));
  if (canonicalSerialize(findingEvidence)
      !== canonicalSerialize(assessment.evidence_ids)) {
    throw invalid("Assessment Evidence must equal its finding provenance");
  }
  if (assessment.assessment_state === "NOT_RELEVANT") {
    validateNotRelevantDecisionBasis(
      assessment.coverage_state,
      assessment.decision_basis
    );
  }
  if (assessment.assessment_state === "RELEVANT"
      && (assessment.coverage_state !== "CLOSED"
        || assessment.decision_basis.position_binding !== "TRUSTED"
        || assessment.decision_basis.material_conflict !== "NONE"
        || !hasDirectLegalEvidence(assessment.decision_basis))) {
    throw invalid("RELEVANT requires closed trusted direct legal Evidence");
  }
  if (assessment.assessment_state === "POSSIBLY_RELEVANT"
      && !hasPositiveEvidence(assessment.decision_basis)) {
    throw invalid("POSSIBLY_RELEVANT requires positive Position-bound Evidence");
  }
  if (assessment.assessment_state === "EVIDENCE_BLOCKED"
      && assessment.decision_basis.evidence_gap_codes.length === 0) {
    throw invalid("EVIDENCE_BLOCKED requires explicit Evidence gaps");
  }
  return structuredClone(assessment);
}

function materializeDecision(
  composition: SourceCompositionResult,
  positionSources: readonly PositionIdentityResolutionInput[],
  sourceResolver: TrustedSourceOccurrenceVersionResolver | null,
  opportunityVersionId: OpportunityVersionId
) {
  const sources = sourceRecords(positionSources);
  const findings: LegalEmploymentRelevanceFinding[] = [];
  const gapCodes = new Set<string>();
  const materialEntries = composition.inventory.expected_surface_entries.filter(
    (entry) => entry.expectedness === "REQUIRED"
      || entry.requirement_level === "REQUIREMENT_BEARING"
  );
  const materialSurfaceIds = new Set(materialEntries.flatMap((entry) => {
    return entry.source_surface_id ? [entry.source_surface_id] : [];
  }));
  const conflicts = composition.source_conflicts.filter((conflict) => {
    return conflict.affects_required_coverage
      && ["DETECTED", "REVIEW_REQUIRED"].includes(conflict.status);
  });
  for (const conflict of conflicts) {
    findings.push(gapFinding(
      "MATERIAL_CONFLICT",
      "SOURCE_MATERIAL_CONFLICT",
      conflict.evidence_ids[0] ?? null
    ));
  }

  const bindingUncertain = materialEntries.some((entry) => {
    return entry.coverage_status !== "MISSING"
      && entry.binding_status !== "RESOLVED";
  });
  const authorityUncertain = materialEntries.some((entry) => {
    return entry.coverage_status !== "MISSING"
      && !["OFFICIAL_AUTHORITATIVE", "AUTHORIZED_SCOPED"].includes(
        entry.authority_status
      );
  });
  const versionUncertain = materialEntries.some((entry) => {
    return entry.coverage_status !== "MISSING"
      && entry.version_selection_status !== "RESOLVED";
  });
  const inventoryOpen = composition.inventory.inventory_completeness_status
    !== "CLOSED";
  if (bindingUncertain) gapCodes.add("POSITION_BINDING_UNCERTAIN");
  if (authorityUncertain) gapCodes.add("SOURCE_AUTHORITY_UNCERTAIN");
  if (versionUncertain) gapCodes.add("SOURCE_VERSION_UNCERTAIN");
  if (inventoryOpen) gapCodes.add("MATERIAL_COVERAGE_OPEN");
  if (materialEntries.some((entry) => entry.coverage_status === "MISSING")) {
    gapCodes.add("MATERIAL_ATTACHMENT_MISSING");
  }

  let dutiesObserved = false;
  for (const surface of composition.source_surfaces) {
    if (!materialSurfaceIds.has(surface.source_surface_id)) continue;
    if (surface.surface_status !== "PARSED") {
      gapCodes.add(surfaceGapCode(surface));
      findings.push(gapFinding(
        "EVIDENCE_GAP",
        surfaceGapCode(surface),
        surface.evidence_ids[0] ?? null,
        surface
      ));
      continue;
    }
    if (!hasTrustedPositionBinding(
      composition,
      surface.source_surface_id,
      opportunityVersionId
    )) {
      gapCodes.add("POSITION_BINDING_UNCERTAIN");
      continue;
    }
    let source = sources.get(surface.source_occurrence_version_id) ?? null;
    if (!source && sourceResolver) {
      const artifact = sourceResolver.resolve(surface.source_occurrence_version_id);
      source = artifact?.extracted_record ?? null;
    }
    if (!source || source.snapshot_id !== surface.snapshot_id
        || source.extracted_record_id !== surface.extracted_record_id) {
      gapCodes.add("MATERIAL_SOURCE_UNAVAILABLE");
      findings.push(gapFinding(
        "EVIDENCE_GAP",
        "MATERIAL_SOURCE_UNAVAILABLE",
        surface.evidence_ids[0] ?? null,
        surface
      ));
      continue;
    }
    const texts = sourceTexts(source);
    dutiesObserved ||= texts.some((item) => {
      return item.field === "DESCRIPTION"
        || /(?:岗位职责|主要职责|工作职责|职责描述)\s*[:：]/u.test(item.text);
    });
    for (const item of texts) {
      findings.push(...matchRules(
        DIRECT_LEGAL_RULES,
        "DIRECT_LEGAL_FUNCTION",
        item.text,
        surface
      ));
      findings.push(...matchRules(
        LEGAL_MAJOR_RULES,
        "LEGAL_MAJOR_REQUIREMENT",
        item.text,
        surface
      ));
      findings.push(...matchRules(
        LEGAL_QUALIFICATION_RULES,
        "LEGAL_QUALIFICATION_REQUIREMENT",
        item.text,
        surface
      ));
      findings.push(...matchRules(
        LEGAL_ADJACENT_RULES,
        "LEGAL_ADJACENT_FUNCTION",
        item.text,
        surface
      ));
      findings.push(...matchRules(
        CLEAR_NON_LEGAL_RULES,
        "CLEAR_NON_LEGAL_FUNCTION",
        item.text,
        surface
      ));
    }
  }

  const deduplicated = resolveSemanticOverrides(deduplicateFindings(findings));
  const hasDirect = hasFinding(deduplicated, "DIRECT_LEGAL_FUNCTION");
  const hasMajor = hasFinding(deduplicated, "LEGAL_MAJOR_REQUIREMENT");
  const hasQualification = hasFinding(
    deduplicated,
    "LEGAL_QUALIFICATION_REQUIREMENT"
  );
  const hasAdjacent = hasFinding(deduplicated, "LEGAL_ADJACENT_FUNCTION");
  const hasNonLegal = hasFinding(deduplicated, "CLEAR_NON_LEGAL_FUNCTION");
  if (!dutiesObserved && !hasDirect && !hasMajor && !hasQualification
      && !hasAdjacent) {
    gapCodes.add("POSITION_DUTIES_NOT_OBSERVED");
  }
  if (composition.status !== "COMPLETE") {
    gapCodes.add("SOURCE_COMPOSITION_NOT_COMPLETE");
  }
  for (const code of gapCodes) {
    if (!deduplicated.some((finding) => {
      return finding.finding_kind === "EVIDENCE_GAP"
        && finding.semantic_code === code;
    })) {
      deduplicated.push(gapFinding("EVIDENCE_GAP", code, null));
    }
  }

  const materialConflict = conflicts.length > 0 || composition.status === "CONFLICT";
  const positionBinding = bindingUncertain
    ? "UNKNOWN" as const
    : materialConflict
      ? "CONFLICT" as const
      : "TRUSTED" as const;
  const coverageClosed = composition.status === "COMPLETE"
    && !inventoryOpen
    && !authorityUncertain
    && !versionUncertain
    && !bindingUncertain
    && gapCodes.size === 0
    && !materialConflict;
  const coverageState = materialConflict
    ? "CONFLICT" as const
    : coverageClosed
      ? "CLOSED" as const
      : "EVIDENCE_BLOCKED" as const;
  const evidenceState = (present: boolean) => present
    ? "PRESENT" as const
    : coverageClosed
      ? "ABSENT" as const
      : "UNKNOWN" as const;
  const basis: LegalEmploymentRelevanceDecisionBasis = {
    position_binding: positionBinding,
    direct_legal_evidence: evidenceState(hasDirect),
    legal_major_evidence: evidenceState(hasMajor),
    legal_qualification_evidence: evidenceState(hasQualification),
    legal_adjacent_evidence: evidenceState(hasAdjacent),
    non_law_function: hasNonLegal && dutiesObserved
      ? "CLEAR"
      : coverageClosed
        ? "NOT_CLEAR"
        : "UNKNOWN",
    material_conflict: materialConflict ? "PRESENT" : "NONE",
    evidence_gap_codes: [...gapCodes].sort()
  };
  const state = materialConflict || bindingUncertain || authorityUncertain
    || versionUncertain
    ? "REVIEW_REQUIRED" as const
    : coverageClosed && hasDirectLegalEvidence(basis)
      ? "RELEVANT" as const
      : hasPositiveEvidence(basis)
        ? "POSSIBLY_RELEVANT" as const
        : coverageState !== "CLOSED"
          ? "EVIDENCE_BLOCKED" as const
          : basis.non_law_function === "CLEAR"
            ? validatedNotRelevantState(coverageState, basis)
            : "REVIEW_REQUIRED" as const;
  const sortedFindings = [...deduplicated].sort((left, right) => {
    return left.finding_id.localeCompare(right.finding_id);
  });
  return {
    state,
    findings: sortedFindings,
    coverageState,
    basis,
    evidenceIds: uniqueSorted(sortedFindings.flatMap((finding) => {
      return finding.source_composition_evidence_id
        ? [finding.source_composition_evidence_id]
        : [];
    })),
    sourceVersionIds: uniqueSorted(composition.source_surfaces.map((surface) => {
      return surface.source_occurrence_version_id;
    }))
  };
}

function sourceRecords(sources: readonly PositionIdentityResolutionInput[]) {
  const records = new Map<SourceOccurrenceVersionId, ExtractedRecordV2>();
  for (const source of flattenSources(sources)) {
    records.set(
      source.version.source_occurrence_version_id,
      structuredClone(source.extracted_record)
    );
  }
  return records;
}

function flattenSources(sources: readonly PositionIdentityResolutionInput[]) {
  return sources.flatMap((source) => [
    source,
    ...(source.reconciliation?.related_sources ?? [])
  ]);
}

function sourceTexts(record: ExtractedRecordV2) {
  return [
    record.raw_title ? { field: "TITLE", text: record.raw_title.text } : null,
    record.raw_description
      ? { field: "DESCRIPTION", text: record.raw_description.text }
      : null,
    record.raw_requirement_text
      ? { field: "REQUIREMENT", text: record.raw_requirement_text.text }
      : null
  ].filter((value): value is { field: string; text: string } => value !== null);
}

function matchRules(
  rules: ReadonlyArray<readonly [string, RegExp]>,
  findingKind: LegalEmploymentRelevanceFinding["finding_kind"],
  text: string,
  surface: SourceSurface
) {
  return rules.flatMap(([semanticCode, pattern]) => {
    return pattern.test(text)
      ? [evidencedFinding(findingKind, semanticCode, text, surface)]
      : [];
  });
}

function evidencedFinding(
  findingKind: LegalEmploymentRelevanceFinding["finding_kind"],
  semanticCode: string,
  originalText: string,
  surface: SourceSurface
): LegalEmploymentRelevanceFinding {
  const withoutId = {
    finding_kind: findingKind,
    semantic_code: semanticCode,
    source_surface_id: surface.source_surface_id,
    source_composition_evidence_id: surface.evidence_ids[0] ?? null,
    source_occurrence_version_id: surface.source_occurrence_version_id,
    snapshot_id: surface.snapshot_id,
    extracted_record_id: surface.extracted_record_id,
    locator: structuredClone(surface.locator),
    original_text: originalText
  } as const;
  return {
    finding_id: findingIdFor(withoutId),
    ...withoutId
  };
}

function gapFinding(
  findingKind: "EVIDENCE_GAP" | "MATERIAL_CONFLICT",
  semanticCode: string,
  evidenceId: SourceCompositionEvidenceId | null,
  surface?: SourceSurface
): LegalEmploymentRelevanceFinding {
  const withoutId = {
    finding_kind: findingKind,
    semantic_code: semanticCode,
    source_surface_id: surface?.source_surface_id ?? null,
    source_composition_evidence_id: evidenceId,
    source_occurrence_version_id: surface?.source_occurrence_version_id ?? null,
    snapshot_id: surface?.snapshot_id ?? null,
    extracted_record_id: surface?.extracted_record_id ?? null,
    locator: surface ? structuredClone(surface.locator) : null,
    original_text: null
  } as const;
  return {
    finding_id: findingIdFor(withoutId),
    ...withoutId
  };
}

function findingIdFor(
  finding: Omit<LegalEmploymentRelevanceFinding, "finding_id">
) {
  return `legal-relevance-finding:${canonicalHash(finding)}` as
    LegalEmploymentRelevanceFindingId;
}

function validateFinding(finding: LegalEmploymentRelevanceFinding) {
  const { finding_id: findingId, ...canonical } = finding;
  if (findingId !== findingIdFor(canonical)) {
    throw invalid("Relevance finding ID does not match Evidence provenance");
  }
  const hasSource = finding.source_surface_id !== null
    && finding.source_occurrence_version_id !== null
    && finding.snapshot_id !== null
    && finding.extracted_record_id !== null
    && finding.locator !== null;
  if (finding.original_text !== null && !hasSource) {
    throw invalid("Semantic Relevance finding requires complete source provenance");
  }
}

function hasTrustedPositionBinding(
  composition: SourceCompositionResult,
  surfaceId: SourceSurfaceId,
  opportunityVersionId: OpportunityVersionId
) {
  return composition.source_surface_bindings.some((binding) => {
    if (binding.source_surface_id !== surfaceId
        || binding.binding_status !== "RESOLVED") return false;
    if (binding.target_type === "OPPORTUNITY_VERSION") {
      return binding.target_id === opportunityVersionId
        && (!binding.target_version_id
          || binding.target_version_id === opportunityVersionId);
    }
    if (binding.binding_kind === "ATTACHMENT_ROW") {
      return (binding as { readonly opportunity_version_id?: string })
        .opportunity_version_id === opportunityVersionId;
    }
    return false;
  });
}

function surfaceGapCode(surface: SourceSurface) {
  const kind = surface.locator.kind ?? "UNKNOWN";
  if (surface.surface_status === "ACQUIRED") {
    return `${kind}_PARSING_UNSUPPORTED`;
  }
  if (surface.surface_status === "MISSING") return "MATERIAL_ATTACHMENT_MISSING";
  return "MATERIAL_SURFACE_UNRESOLVED";
}

function hasFinding(
  findings: readonly LegalEmploymentRelevanceFinding[],
  kind: LegalEmploymentRelevanceFinding["finding_kind"]
) {
  return findings.some((finding) => finding.finding_kind === kind);
}

function hasDirectLegalEvidence(basis: LegalEmploymentRelevanceDecisionBasis) {
  return basis.direct_legal_evidence === "PRESENT"
    || basis.legal_major_evidence === "PRESENT"
    || basis.legal_qualification_evidence === "PRESENT";
}

function hasPositiveEvidence(basis: LegalEmploymentRelevanceDecisionBasis) {
  return hasDirectLegalEvidence(basis)
    || basis.legal_adjacent_evidence === "PRESENT";
}

function validatedNotRelevantState(
  coverageState: LegalEmploymentRelevanceAssessment["coverage_state"],
  basis: LegalEmploymentRelevanceDecisionBasis
) {
  validateNotRelevantDecisionBasis(coverageState, basis);
  return "NOT_RELEVANT" as const;
}

function deduplicateFindings(findings: readonly LegalEmploymentRelevanceFinding[]) {
  return [...new Map(findings.map((finding) => {
    return [finding.finding_id, finding] as const;
  })).values()];
}

function resolveSemanticOverrides(
  findings: readonly LegalEmploymentRelevanceFinding[]
) {
  const semanticCodes = new Set(findings.map((finding) => finding.semantic_code));
  const suppressedAdjacentCodes = new Set<string>();
  if (semanticCodes.has("MARKET_OR_CREDIT_RISK")) {
    suppressedAdjacentCodes.add("RISK_MANAGEMENT");
  }
  if (semanticCodes.has("TECHNICAL_QUALITY_COMPLIANCE")) {
    suppressedAdjacentCodes.add("COMPLIANCE_MANAGEMENT");
    suppressedAdjacentCodes.add("STANDARD_OR_CERTIFICATION");
  }
  if (semanticCodes.has("FINANCIAL_OR_TECHNICAL_AUDIT")) {
    suppressedAdjacentCodes.add("AUDIT_FUNCTION");
  }
  return findings.filter((finding) => {
    return finding.finding_kind !== "LEGAL_ADJACENT_FUNCTION"
      || !suppressedAdjacentCodes.has(finding.semantic_code);
  });
}

function semanticAssessmentInput(assessment: LegalEmploymentRelevanceAssessment) {
  const {
    assessment_id: _assessmentId,
    assessment_version: _assessmentVersion,
    created_at: _createdAt,
    integrity_hash: _integrityHash,
    ...semantic
  } = assessment;
  return semantic;
}

function assessmentIdFor(positionId: PositionId, assessmentVersion: number) {
  return `legal-relevance-assessment:${canonicalHash({
    position_id: positionId,
    assessment_version: assessmentVersion
  })}` as LegalEmploymentRelevanceAssessmentId;
}

function requireCommandShape(command: LegalEmploymentRelevanceCommand) {
  const keys = Object.keys(command as unknown as Record<string, unknown>).sort();
  const allowed = [
    "created_at",
    "opportunity_version_id",
    "source_composition_id"
  ];
  if (canonicalSerialize(keys) !== canonicalSerialize(allowed)) {
    throw invalid("Relevance command may contain only trusted artifact references and time");
  }
  requireDate(command.created_at, "Assessment creation time");
}

function requireDate<Value extends string>(value: Value, label: string): Value {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw invalid(`${label} must be an ISO timestamp`);
  }
  return value;
}

function uniqueSorted<Value extends string>(values: readonly Value[]) {
  return [...new Set(values)].sort();
}

function invalid(message: string) {
  return new LegalEmploymentRelevanceError("INVALID_INPUT", message);
}

function unavailable(message: string) {
  return new LegalEmploymentRelevanceError(
    "TRUSTED_ARTIFACT_UNAVAILABLE",
    message
  );
}

function mismatch(message: string) {
  return new LegalEmploymentRelevanceError("TRUSTED_ARTIFACT_MISMATCH", message);
}
