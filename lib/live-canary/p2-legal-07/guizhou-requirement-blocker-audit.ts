import { createHash } from "node:crypto";

import type {
  RequirementCompletenessBlockerCode,
  RequirementEvidenceFragment,
  RequirementEvidenceFragmentId,
  RequirementObservationId,
  RequirementSetId,
  SnapshotId
} from "../../ingestion";
import {
  P2_LEGAL_06_NOTICE_SNAPSHOT_ID,
  type RequirementCompositionBlockerAudit,
  type RequirementCompositionSourceKind,
  type RequirementSetCompositionResult
} from "../p2-legal-06/guizhou-legal-requirement-set-composer";
import { P2_LEGAL_05_SNAPSHOT_ID } from "../p2-legal-05/guizhou-legal-xlsx-requirement-adapter";

export const P2_LEGAL_07_AUDIT_VERSION =
  "p2-legal-07-requirement-completeness-blocker-audit/1.0.0";
export const P2_LEGAL_07_REQUIREMENT_SET_ID =
  "requirement-set:efe9fa79e9acc91014757ad9a7314d500b5eadab172d7702b5c8b702277663c1" as RequirementSetId;
export const P2_LEGAL_07_INPUT_SNAPSHOT_IDS = [
  P2_LEGAL_06_NOTICE_SNAPSHOT_ID,
  P2_LEGAL_05_SNAPSHOT_ID
] as const;

export type AuditUnresolvedReason =
  | "SEMANTIC_AMBIGUITY"
  | "UNPARSED_CLAUSE"
  | "DOMAIN_GAP"
  | "MISSING_EVIDENCE";

export type DomainChangeStatus =
  | "REQUIRED"
  | "NOT_REQUIRED"
  | "UNDETERMINED_PENDING_CLARIFICATION";

export interface BlockerEvidenceAudit {
  readonly requirement_evidence_fragment_id: RequirementEvidenceFragmentId;
  readonly snapshot_id: SnapshotId;
  readonly extracted_record_id: string;
  readonly locator: RequirementEvidenceFragment["locator"];
  readonly raw_text: string | null;
  readonly normalized_text: string | null;
  readonly parser_version: string;
}

export interface RequirementBlockerAuditItem {
  readonly blocker_id: string;
  readonly blocker_type: RequirementCompletenessBlockerCode;
  readonly source: readonly RequirementCompositionSourceKind[];
  readonly observation_ids: readonly RequirementObservationId[];
  readonly evidence: readonly BlockerEvidenceAudit[];
  readonly current_evidence_expression: string;
  readonly why_unresolved: string;
  readonly resolvable_with_existing_snapshots: false;
  readonly unresolved_reason: AuditUnresolvedReason;
  readonly additional_official_evidence_required: boolean;
  readonly domain_change_status: DomainChangeStatus;
  readonly resolution_requirement: string;
  readonly retained_after_audit: true;
  readonly blocks_requirement_complete: true;
  readonly blocks_eligibility: true;
}

export interface RequirementBlockerAuditResult {
  readonly audit_id: string;
  readonly requirement_set_id: RequirementSetId;
  readonly input_snapshot_ids: readonly SnapshotId[];
  readonly audit_version: string;
  readonly blocker_total: number;
  readonly blocker_type_counts: Readonly<Record<RequirementCompletenessBlockerCode, number>>;
  readonly unresolved_reason_counts: Readonly<Record<AuditUnresolvedReason, number>>;
  readonly blocker_audits: readonly RequirementBlockerAuditItem[];
  readonly resolution_classification: {
    readonly resolvable_with_existing_snapshots: readonly string[];
    readonly requires_additional_official_evidence: readonly string[];
    readonly domain_gap: readonly string[];
    readonly semantic_ambiguity: readonly string[];
    readonly unparsed_clause: readonly string[];
    readonly missing_evidence: readonly string[];
  };
  readonly negative_inference_guard: {
    readonly observed: "法律（0351）";
    readonly prohibited_equivalences: readonly [
      "法律（0351） != 法律（非法学）",
      "法律（0351） != 法律硕士（非法学）",
      "法律（非法学） != 法律硕士（非法学）"
    ];
    readonly legal_master_non_law_confirmed: "NOT_CONFIRMED";
  };
  readonly gender_restriction: {
    readonly raw_text: "限男性";
    readonly status: "DOMAIN_GAP_OBSERVED";
    readonly retained: true;
    readonly blocks_requirement_complete: true;
    readonly blocks_eligibility: true;
  };
  readonly bachelor_graduate_relationship: {
    readonly status: "AMBIGUOUS";
    readonly highest_education_rule_observed: false;
    readonly retained: true;
  };
  readonly completeness_decision: {
    readonly status: "REVIEW_REQUIRED";
    readonly complete: false;
    readonly original_blocker_count: number;
    readonly resolved_blocker_count: 0;
    readonly remaining_blocker_count: number;
    readonly remaining_blocker_ids: readonly string[];
  };
  readonly eligibility_gate: {
    readonly status: "NOT_ALLOWED";
    readonly eligibility_executed: false;
    readonly reason: string;
  };
  readonly downstream_objects_created: {
    readonly candidate_profile: 0;
    readonly eligibility_assessment: 0;
  };
  readonly network_requests: 0;
}

interface AuditPolicy {
  readonly blocker_id: string;
  readonly expected_blocker_type: RequirementCompletenessBlockerCode;
  readonly current_evidence_expression: string;
  readonly why_unresolved: string;
  readonly unresolved_reason: AuditUnresolvedReason;
  readonly additional_official_evidence_required: boolean;
  readonly domain_change_status: DomainChangeStatus;
  readonly resolution_requirement: string;
}

const policies = policyCatalog([
  policy(
    "tiered-age-rule",
    "announcement.requirements.tiered-age-rule",
    "AMBIGUOUS",
    "The announcement defines a base age range and separate relaxations for master's graduates, doctoral-degree holders, and senior professional-title holders.",
    "The current AGE Fact can express thresholds, but the frozen Domain cannot bind all degree/title-dependent conditional branches without losing applicability semantics.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral conditional-age model is required; the observed dates and thresholds must remain unchanged."
  ),
  policy(
    "bachelor-graduate-applicability",
    "workbook.sheet[\"Sheet1\"].cell[M4].scope_relationship",
    "AMBIGUOUS",
    "The job cell separately lists bachelor majors and graduate majors.",
    "Neither permitted Snapshot states whether both scopes must be satisfied, whether only the qualification used for application controls, or whether the highest qualification controls.",
    "SEMANTIC_AMBIGUITY",
    true,
    "UNDETERMINED_PENDING_CLARIFICATION",
    "Additional official evidence must state the cross-scope applicability rule before the observations can be converted into an unambiguous logical relationship."
  ),
  policy(
    "professional-catalog-similarity-exception",
    "announcement.requirements.professional-catalog-similarity-exception",
    "AMBIGUOUS",
    "The announcement permits certain unlisted or self-defined programs after a 70% course/research-direction comparison and expert review.",
    "The frozen Domain supports directory references but not similarity percentages, evidence-submission workflow, or a future expert-review decision as an eligibility branch.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral expert-review or professional-equivalence decision model is required."
  ),
  policy(
    "non-2025-current-student-exclusion",
    "announcement.requirements.non-2025-current-student-disqualification",
    "AMBIGUOUS",
    "The announcement excludes persons described as current students who are not 2025 graduating students at junior-college level or above.",
    "The exact cohort boundary and its interaction with graduation status cannot be established beyond the wording, and the frozen cohort codes do not represent this state.",
    "SEMANTIC_AMBIGUITY",
    true,
    "REQUIRED",
    "Official clarification of the cohort boundary and a separately approved source-neutral cohort representation are both required."
  ),
  policy(
    "law-0351-non-law-applicability",
    "workbook.sheet[\"Sheet1\"].cell[M4].graduate_segment",
    "AMBIGUOUS",
    "The job table names graduate programs 法学（0301） and 法律（0351） and cites the 2022 graduate program catalog.",
    "Neither Snapshot identifies 法律（非法学） or 法律硕士（非法学）, so the broad 0351 reference cannot prove acceptance of the non-law track.",
    "MISSING_EVIDENCE",
    true,
    "NOT_REQUIRED",
    "Additional official evidence must explicitly bind the accepted 0351 scope to 法律（非法学） or 法律硕士（非法学）; no inference from the directory code is allowed."
  ),
  policy(
    "political-stance-and-beliefs",
    "announcement.requirements.political-stance-and-beliefs",
    "DOMAIN_GAP_OBSERVED",
    "The announcement requires specified political stance, attitude, beliefs, and moral character.",
    "These mandatory characteristics have no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral model would be required to evaluate this condition."
  ),
  policy(
    "active-duty-exclusion",
    "announcement.requirements.active-duty-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes active-duty military personnel.",
    "Active-duty status has no approved typed Requirement dimension or cohort code.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral service-status model is required."
  ),
  policy(
    "directed-graduate-exclusion",
    "announcement.requirements.directed-graduate-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes current-year graduates directed to a specific industry or organization.",
    "The approved cohort model does not express directed-employment obligations.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral cohort or obligation-status extension is required."
  ),
  policy(
    "conduct-and-integrity",
    "announcement.requirements.conduct-and-integrity",
    "DOMAIN_GAP_OBSERVED",
    "The announcement requires law-abiding, honest conduct and specified personal integrity.",
    "Conduct and integrity have no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral conduct model is required."
  ),
  policy(
    "recruitment-integrity-record",
    "announcement.requirements.recruitment-integrity-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes serious recruitment-discipline violations and persons recorded in the public-recruitment integrity archive.",
    "Recruitment-integrity records have no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral disqualification-record model is required."
  ),
  policy(
    "dismissed-public-office-exclusion",
    "announcement.requirements.dismissed-public-office-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes persons dismissed from public office.",
    "Prior dismissal from public office has no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral public-employment record model is required."
  ),
  policy(
    "serious-dishonesty-exclusion",
    "announcement.requirements.serious-dishonesty-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes judgment defaulters and persons officially identified for serious unlawful dishonesty.",
    "Serious-dishonesty status has no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral disqualification-record model is required."
  ),
  policy(
    "qualification-proof-deadline",
    "announcement.requirements.qualification-proof-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes persons who cannot submit required qualification proof by the inspection stage.",
    "The frozen Domain does not model proof deadlines or documentary-submission conditions.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral proof and deadline model is required."
  ),
  policy(
    "disciplinary-and-performance-exclusion",
    "announcement.requirements.disciplinary-and-performance-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes specified disciplinary histories and recent unsatisfactory public-sector performance records.",
    "Discipline and performance history have no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral disciplinary and performance-record model is required."
  ),
  policy(
    "gender-restriction",
    "workbook.sheet[\"Sheet1\"].cell[N4].gender_clause",
    "DOMAIN_GAP_OBSERVED",
    "The job table expressly states 限男性.",
    "Gender is not represented by the frozen Requirement Domain and cannot be evaluated by the Eligibility Engine.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral gender Requirement and Candidate representation is required; the clause must not be discarded or demoted to a note."
  ),
  policy(
    "criminal-punishment-exclusion",
    "announcement.requirements.criminal-punishment-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes persons with specified criminal punishment or re-education-through-labor history.",
    "Criminal and legal sanction history has no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral legal-disqualification model is required."
  ),
  policy(
    "nationality-and-constitutional-support",
    "announcement.requirements.nationality-and-constitutional-support",
    "DOMAIN_GAP_OBSERVED",
    "The announcement requires Chinese nationality, constitutional support, and stated ideological-political qualities.",
    "Nationality and the compound political condition have no approved typed Requirement representation.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "Separately approved source-neutral nationality and political-condition models are required before evaluation."
  ),
  policy(
    "health-and-physical-condition",
    "announcement.requirements.health-and-physical-condition",
    "DOMAIN_GAP_OBSERVED",
    "The announcement requires health and physical condition suitable for the post.",
    "Health and post-specific physical fitness have no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral health or physical-condition model is required."
  ),
  policy(
    "in-service-probation-exclusion",
    "announcement.requirements.in-service-probation-exclusion",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes in-service provincial public-institution staff still in probation or a service period.",
    "The approved cohort model does not represent employment establishment, probation, or service-period obligations.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral employment and service-status model is required."
  ),
  policy(
    "political-line-exclusion",
    "announcement.requirements.political-line-disqualification",
    "DOMAIN_GAP_OBSERVED",
    "The announcement excludes persons unable to maintain the stated political line and alignment on major political issues.",
    "This political disqualification has no approved typed Requirement dimension.",
    "DOMAIN_GAP",
    false,
    "REQUIRED",
    "A separately approved source-neutral political-condition model is required."
  ),
  policy(
    "male-facility-research-duty",
    "workbook.sheet[\"Sheet1\"].cell[O4].job_note",
    "UNPARSED_CLAUSE",
    "The job note states that research work must be conducted in male prisons and male compulsory-rehabilitation facilities.",
    "The note's role as a mandatory candidate condition, an essential duty, or contextual information is not explicitly classified by either Snapshot.",
    "UNPARSED_CLAUSE",
    true,
    "UNDETERMINED_PENDING_CLARIFICATION",
    "Official clarification of the clause role is required before any non-blocking classification or typed representation."
  ),
  policy(
    "willingness-and-responsibility",
    "announcement.requirements.willingness-and-responsibility",
    "UNPARSED_CLAUSE",
    "The announcement requires willingness to undertake the post and a strong sense of commitment and responsibility.",
    "The clause is mandatory but combines subjective attributes without an approved typed representation.",
    "UNPARSED_CLAUSE",
    false,
    "UNDETERMINED_PENDING_CLARIFICATION",
    "The clause must remain source text unless a separate Change Request approves a source-neutral representation."
  ),
  policy(
    "knowledge-and-work-ability",
    "announcement.requirements.knowledge-and-work-ability",
    "UNPARSED_CLAUSE",
    "The announcement requires relevant professional knowledge, scientific literacy, and work ability sufficient for the post.",
    "The compound capability clause has no safe decomposition or approved typed representation.",
    "UNPARSED_CLAUSE",
    false,
    "UNDETERMINED_PENDING_CLARIFICATION",
    "The clause must remain source text unless a separate Change Request approves a source-neutral capability model."
  ),
  policy(
    "open-ended-legal-prohibition",
    "announcement.requirements.open-ended-legal-prohibition",
    "UNPARSED_CLAUSE",
    "The announcement excludes persons prohibited from employment by applicable laws or regulations.",
    "The clause is an open-ended external legal reference; the Snapshot does not enumerate the applicable prohibitions and the frozen Domain cannot represent them.",
    "UNPARSED_CLAUSE",
    true,
    "UNDETERMINED_PENDING_CLARIFICATION",
    "Bound official legal evidence and a separately approved source-neutral legal-disqualification model would be required for complete evaluation."
  )
]);

export function auditRequirementBlockers(
  composition: RequirementSetCompositionResult
): RequirementBlockerAuditResult {
  validateComposition(composition);
  const fragmentCatalog = new Map(composition.requirement_set.evidence_fragments.map((fragment) => [
    fragment.requirement_evidence_fragment_id,
    fragment
  ]));
  const audits = composition.composition_blockers.map((blocker) => {
    const evidence = blocker.evidence_fragment_ids.map((fragmentId) => {
      const fragment = fragmentCatalog.get(fragmentId);
      if (!fragment) throw new Error(`Missing Evidence Fragment ${fragmentId}`);
      return evidenceAudit(fragment);
    });
    const policy = matchPolicy(blocker, evidence);
    if (policy.expected_blocker_type !== blocker.code) {
      throw new Error(
        `Blocker ${policy.blocker_id} changed from ${policy.expected_blocker_type} to ${blocker.code}`
      );
    }
    return {
      blocker_id: policy.blocker_id,
      blocker_type: blocker.code,
      source: [...blocker.source_kinds].filter(
        (source): source is RequirementCompositionSourceKind => source !== "COMPOSITION"
      ),
      observation_ids: [...blocker.observation_ids],
      evidence,
      current_evidence_expression: policy.current_evidence_expression,
      why_unresolved: policy.why_unresolved,
      resolvable_with_existing_snapshots: false,
      unresolved_reason: policy.unresolved_reason,
      additional_official_evidence_required: policy.additional_official_evidence_required,
      domain_change_status: policy.domain_change_status,
      resolution_requirement: policy.resolution_requirement,
      retained_after_audit: true,
      blocks_requirement_complete: true,
      blocks_eligibility: true
    } satisfies RequirementBlockerAuditItem;
  }).sort((left, right) => left.blocker_id.localeCompare(right.blocker_id));
  const auditIds = new Set(audits.map((audit) => audit.blocker_id));
  if (auditIds.size !== policies.size || auditIds.size !== audits.length) {
    throw new Error("Every P2-LEGAL-06 blocker must match exactly one P2-LEGAL-07 audit policy");
  }
  const blockerTypeCounts = countBy(
    audits.map((audit) => audit.blocker_type),
    [
      "NOT_OBSERVED",
      "UNPARSED_CLAUSE",
      "AMBIGUOUS",
      "DOMAIN_GAP_OBSERVED",
      "ATTACHMENT_MISSING",
      "EVIDENCE_INCOMPLETE"
    ] as const
  );
  const unresolvedReasonCounts = countBy(
    audits.map((audit) => audit.unresolved_reason),
    ["SEMANTIC_AMBIGUITY", "UNPARSED_CLAUSE", "DOMAIN_GAP", "MISSING_EVIDENCE"] as const
  );
  const remainingBlockerIds = audits.map((audit) => audit.blocker_id);
  const auditId = `p2-legal-07-audit:${sha256(stableSerialize({
    requirement_set_id: composition.requirement_set.requirement_set_id,
    snapshot_ids: composition.requirement_set.completeness.covered_snapshot_ids,
    blocker_ids: remainingBlockerIds,
    audit_version: P2_LEGAL_07_AUDIT_VERSION
  }))}`;
  return {
    audit_id: auditId,
    requirement_set_id: composition.requirement_set.requirement_set_id,
    input_snapshot_ids: [...composition.requirement_set.completeness.covered_snapshot_ids],
    audit_version: P2_LEGAL_07_AUDIT_VERSION,
    blocker_total: audits.length,
    blocker_type_counts: blockerTypeCounts,
    unresolved_reason_counts: unresolvedReasonCounts,
    blocker_audits: audits,
    resolution_classification: {
      resolvable_with_existing_snapshots: [],
      requires_additional_official_evidence: idsWhere(
        audits,
        (audit) => audit.additional_official_evidence_required
      ),
      domain_gap: idsWhere(audits, (audit) => audit.unresolved_reason === "DOMAIN_GAP"),
      semantic_ambiguity: idsWhere(
        audits,
        (audit) => audit.unresolved_reason === "SEMANTIC_AMBIGUITY"
      ),
      unparsed_clause: idsWhere(
        audits,
        (audit) => audit.unresolved_reason === "UNPARSED_CLAUSE"
      ),
      missing_evidence: idsWhere(
        audits,
        (audit) => audit.unresolved_reason === "MISSING_EVIDENCE"
      )
    },
    negative_inference_guard: {
      observed: "法律（0351）",
      prohibited_equivalences: [
        "法律（0351） != 法律（非法学）",
        "法律（0351） != 法律硕士（非法学）",
        "法律（非法学） != 法律硕士（非法学）"
      ],
      legal_master_non_law_confirmed: "NOT_CONFIRMED"
    },
    gender_restriction: {
      raw_text: "限男性",
      status: "DOMAIN_GAP_OBSERVED",
      retained: true,
      blocks_requirement_complete: true,
      blocks_eligibility: true
    },
    bachelor_graduate_relationship: {
      status: "AMBIGUOUS",
      highest_education_rule_observed: false,
      retained: true
    },
    completeness_decision: {
      status: "REVIEW_REQUIRED",
      complete: false,
      original_blocker_count: composition.composition_blockers.length,
      resolved_blocker_count: 0,
      remaining_blocker_count: audits.length,
      remaining_blocker_ids: remainingBlockerIds
    },
    eligibility_gate: {
      status: "NOT_ALLOWED",
      eligibility_executed: false,
      reason: "RequirementCompleteness is REVIEW_REQUIRED and every audited mandatory blocker remains unresolved"
    },
    downstream_objects_created: {
      candidate_profile: 0,
      eligibility_assessment: 0
    },
    network_requests: 0
  };
}

export function buildRequirementBlockerAuditReport(audit: RequirementBlockerAuditResult) {
  return {
    status: "P2_LEGAL_07_REQUIREMENT_COMPLETENESS_BLOCKER_AUDIT_COMPLETE",
    audit_id: audit.audit_id,
    requirement_set_id: audit.requirement_set_id,
    input_snapshot_ids: audit.input_snapshot_ids,
    audit_version: audit.audit_version,
    network_requests: audit.network_requests,
    summary: {
      blocker_total: audit.blocker_total,
      original_blocker_type_counts: audit.blocker_type_counts,
      audited_unresolved_reason_counts: audit.unresolved_reason_counts,
      resolved_with_existing_snapshots: 0,
      remaining_blockers: audit.completeness_decision.remaining_blocker_count,
      source_conflicts: 0
    },
    audit_answers: {
      existing_snapshots_only: {
        resolvable_blocker_ids: audit.resolution_classification.resolvable_with_existing_snapshots,
        conclusion: "No blocker can be cleared under the frozen Domain using only the two permitted Snapshots."
      },
      permanent_current_evidence_semantics: {
        blocker_ids: audit.resolution_classification.semantic_ambiguity,
        conclusion: "The current wording cannot establish the required applicability semantics without additional official clarification."
      },
      domain_gaps: {
        blocker_ids: audit.resolution_classification.domain_gap,
        conclusion: "The source wording is retained, but the frozen Requirement Domain cannot type these mandatory conditions."
      },
      additional_official_evidence: {
        blocker_ids: audit.resolution_classification.requires_additional_official_evidence,
        conclusion: "Without additional official evidence or clarification, these blockers must remain REVIEW_REQUIRED."
      }
    },
    blocker_audits: audit.blocker_audits,
    negative_inference_guard: audit.negative_inference_guard,
    gender_restriction: audit.gender_restriction,
    bachelor_graduate_relationship: audit.bachelor_graduate_relationship,
    completeness_decision: audit.completeness_decision,
    eligibility_gate: audit.eligibility_gate,
    downstream_objects_created: audit.downstream_objects_created
  };
}

function validateComposition(composition: RequirementSetCompositionResult) {
  if (composition.requirement_set.requirement_set_id !== P2_LEGAL_07_REQUIREMENT_SET_ID) {
    throw new Error("P2-LEGAL-07 received an unauthorized Requirement Set");
  }
  if (composition.requirement_set.completeness.status !== "REVIEW_REQUIRED") {
    throw new Error("P2-LEGAL-07 expects the frozen REVIEW_REQUIRED Requirement Set");
  }
  if (composition.composition_blockers.length !== 24) {
    throw new Error("P2-LEGAL-07 expects exactly 24 P2-LEGAL-06 blockers");
  }
  if (composition.source_conflicts.length !== 0) {
    throw new Error("P2-LEGAL-07 expected no observed official-source conflict");
  }
  const actualSnapshots = [...composition.requirement_set.completeness.covered_snapshot_ids].sort();
  const expectedSnapshots = [...P2_LEGAL_07_INPUT_SNAPSHOT_IDS].sort();
  if (stableSerialize(actualSnapshots) !== stableSerialize(expectedSnapshots)) {
    throw new Error("P2-LEGAL-07 received Evidence outside the two permitted Snapshots");
  }
}

function evidenceAudit(fragment: RequirementEvidenceFragment): BlockerEvidenceAudit {
  return {
    requirement_evidence_fragment_id: fragment.requirement_evidence_fragment_id,
    snapshot_id: fragment.snapshot_id,
    extracted_record_id: fragment.extracted_record_id,
    locator: fragment.locator,
    raw_text: fragment.observed_value_state === "TEXT" ? fragment.original_text.text : null,
    normalized_text: fragment.observed_value_state === "TEXT"
      ? fragment.normalized_text?.text ?? null
      : null,
    parser_version: fragment.parser_version
  };
}

function matchPolicy(
  blocker: RequirementCompositionBlockerAudit,
  evidence: readonly BlockerEvidenceAudit[]
) {
  const matches = evidence.flatMap((item) => {
    const fieldPath = item.locator.field_path;
    return fieldPath && policies.has(fieldPath) ? [policies.get(fieldPath)!] : [];
  });
  const unique = [...new Map(matches.map((item) => [item.blocker_id, item])).values()];
  if (unique.length !== 1) {
    throw new Error(
      `Blocker ${blocker.observation_ids.join(",")} matched ${unique.length} audit policies`
    );
  }
  return unique[0]!;
}

function policy(
  blockerId: string,
  fieldPath: string,
  expectedBlockerType: RequirementCompletenessBlockerCode,
  currentEvidenceExpression: string,
  whyUnresolved: string,
  unresolvedReason: AuditUnresolvedReason,
  additionalOfficialEvidenceRequired: boolean,
  domainChangeStatus: DomainChangeStatus,
  resolutionRequirement: string
) {
  return {
    fieldPath,
    policy: {
      blocker_id: `p2-legal-07-blocker:${blockerId}`,
      expected_blocker_type: expectedBlockerType,
      current_evidence_expression: currentEvidenceExpression,
      why_unresolved: whyUnresolved,
      unresolved_reason: unresolvedReason,
      additional_official_evidence_required: additionalOfficialEvidenceRequired,
      domain_change_status: domainChangeStatus,
      resolution_requirement: resolutionRequirement
    } satisfies AuditPolicy
  };
}

function policyCatalog(
  entries: readonly { readonly fieldPath: string; readonly policy: AuditPolicy }[]
) {
  const catalog = new Map<string, AuditPolicy>();
  for (const entry of entries) {
    if (catalog.has(entry.fieldPath)) throw new Error(`Duplicate audit field path ${entry.fieldPath}`);
    catalog.set(entry.fieldPath, entry.policy);
  }
  return catalog;
}

function idsWhere(
  audits: readonly RequirementBlockerAuditItem[],
  predicate: (audit: RequirementBlockerAuditItem) => boolean
) {
  return audits.filter(predicate).map((audit) => audit.blocker_id);
}

function countBy<const T extends string>(values: readonly T[], keys: readonly T[]) {
  return Object.fromEntries(keys.map((key) => [
    key,
    values.filter((value) => value === key).length
  ])) as Record<T, number>;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(object[key])}`
  )).join(",")}}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
