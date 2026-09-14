import { createHash } from "node:crypto";

import type {
  AnnouncementId,
  AnnouncementVersionId,
  CanonicalOpportunityId,
  ExtractedRecordId,
  HeadcountObservationId,
  IdentityHash,
  IdentityAliasId,
  IdentityEvidenceId,
  IdentityReconciliationId,
  IsoDate,
  IsoDateTime,
  LocationAssignmentId,
  NonEmptyReadonlyArray,
  OrganizationId,
  OrganizationRoleAssignmentId,
  PositionId,
  PositionVersionId,
  RecruitmentBatchId,
  RecruitmentPlanId,
  RecruitmentPopulationReferenceId,
  RecruitmentRevisionRelationId,
  SemanticHash,
  SnapshotId,
  SourceDefinitionId,
  SourceOccurrenceId,
  SourceOccurrenceVersionId
} from "./primitives";
import type { NormalizedText, OriginalText, TraceableText } from "./text";

export const RECRUITMENT_ENTITY_KINDS = [
  "ANNOUNCEMENT",
  "RECRUITMENT_PLAN",
  "RECRUITMENT_BATCH",
  "POSITION",
  "OPPORTUNITY",
  "ORGANIZATION",
  "LOCATION"
] as const;

export const RECRUITMENT_IDENTITY_STATES = [
  "CONFIRMED",
  "PROVISIONAL",
  "UNRESOLVED"
] as const;

export const IDENTITY_EVIDENCE_CERTAINTIES = [
  "EXPLICIT",
  "CORROBORATED",
  "PROVISIONAL",
  "UNRESOLVED"
] as const;

export const IDENTITY_EVIDENCE_DECISIONS = [
  "SUPPORTS_IDENTITY",
  "SUPPORTS_SEPARATION",
  "OBSERVES_UNRESOLVED",
  "MERGE_CANDIDATE",
  "SPLIT_CANDIDATE",
  "ALIAS",
  "RECONCILIATION"
] as const;

export type RecruitmentEntityKind = (typeof RECRUITMENT_ENTITY_KINDS)[number];
export type RecruitmentIdentityState =
  (typeof RECRUITMENT_IDENTITY_STATES)[number];
export type IdentityEvidenceCertainty =
  (typeof IDENTITY_EVIDENCE_CERTAINTIES)[number];
export type IdentityEvidenceDecision =
  (typeof IDENTITY_EVIDENCE_DECISIONS)[number];

export type RecruitmentContextEvidenceLocator =
  | {
      readonly kind: "HTML";
      readonly selector?: string;
      readonly path?: string;
      readonly field_path?: string;
    }
  | {
      readonly kind: "SPREADSHEET";
      readonly sheet: string;
      readonly cell_or_range: string;
      readonly field_path?: string;
    }
  | {
      readonly kind: "JSON";
      readonly json_path: string;
      readonly field_path?: string;
    }
  | {
      readonly kind: "DOCUMENT";
      readonly page_number?: number;
      readonly section?: string;
      readonly text_locator?: string;
      readonly field_path?: string;
    }
  | {
      readonly kind: "SOURCE_RECORD";
      readonly locator: string;
    };

export interface IdentityEvidence {
  readonly identity_evidence_id: IdentityEvidenceId;
  readonly entity_kind: RecruitmentEntityKind;
  readonly source_definition_id: SourceDefinitionId;
  readonly snapshot_id: SnapshotId;
  readonly extracted_record_id: ExtractedRecordId;
  readonly source_occurrence_version_id?: SourceOccurrenceVersionId;
  readonly locator: RecruitmentContextEvidenceLocator;
  readonly observed_value?: OriginalText;
  readonly normalized_value?: NormalizedText;
  readonly certainty: IdentityEvidenceCertainty;
  readonly decision: IdentityEvidenceDecision;
  readonly resolver_version: string;
}

export type ExtractedRecruitmentIdentityClaim =
  | {
      readonly identity_state: "CONFIRMED";
      readonly official_identifier: OriginalText;
      readonly identifier_namespace: string;
      readonly evidence_locator: RecruitmentContextEvidenceLocator;
    }
  | {
      readonly identity_state: "PROVISIONAL";
      readonly source_local_identifier: OriginalText;
      readonly evidence_locator: RecruitmentContextEvidenceLocator;
    }
  | {
      readonly identity_state: "UNRESOLVED";
      readonly raw_text?: OriginalText;
      readonly evidence_locator?: RecruitmentContextEvidenceLocator;
    };

export type RecruitmentIdentityClaim =
  | {
      readonly identity_state: "CONFIRMED";
      readonly identity_key: string;
      readonly official_identifier: TraceableText;
      readonly identifier_namespace: string;
      readonly identity_evidence_ids: NonEmptyReadonlyArray<IdentityEvidenceId>;
    }
  | {
      readonly identity_state: "PROVISIONAL";
      readonly identity_key: string;
      readonly source_local_identifier: TraceableText;
      readonly identity_evidence_ids: NonEmptyReadonlyArray<IdentityEvidenceId>;
    }
  | {
      readonly identity_state: "UNRESOLVED";
      readonly identity_key: null;
      readonly raw_text?: TraceableText;
      readonly identity_evidence_ids: readonly IdentityEvidenceId[];
    };

export const RECRUITMENT_BATCH_APPLICABILITY = [
  "APPLICABLE",
  "NOT_APPLICABLE",
  "UNRESOLVED"
] as const;

export type RecruitmentBatchApplicability =
  (typeof RECRUITMENT_BATCH_APPLICABILITY)[number];

export interface ExtractedRecruitmentContext {
  readonly announcement?: ExtractedRecruitmentIdentityClaim;
  readonly recruitment_plan?: ExtractedRecruitmentIdentityClaim;
  readonly recruitment_batch?: {
    readonly applicability: RecruitmentBatchApplicability;
    readonly identity?: ExtractedRecruitmentIdentityClaim;
  };
  readonly position: ExtractedRecruitmentIdentityClaim;
  readonly opportunity?: ExtractedRecruitmentIdentityClaim;
}

export interface OpportunityRecruitmentContext {
  readonly announcement: RecruitmentIdentityClaim;
  readonly recruitment_plan: RecruitmentIdentityClaim;
  readonly recruitment_batch: {
    readonly applicability: RecruitmentBatchApplicability;
    readonly identity: RecruitmentIdentityClaim;
  };
  readonly position: RecruitmentIdentityClaim;
  readonly opportunity: RecruitmentIdentityClaim;
}

export interface Announcement {
  readonly announcement_id: AnnouncementId;
  readonly identity_state: RecruitmentIdentityState;
  readonly publisher_organization_id: OrganizationId;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
  readonly created_at: IsoDateTime;
}

export interface AnnouncementVersion {
  readonly announcement_version_id: AnnouncementVersionId;
  readonly announcement_id: AnnouncementId;
  readonly revision: number;
  readonly title?: TraceableText;
  readonly official_identifier?: TraceableText;
  readonly locators: NonEmptyReadonlyArray<string>;
  readonly published_on?: IsoDate;
  readonly source_occurrence_version_ids:
    NonEmptyReadonlyArray<SourceOccurrenceVersionId>;
  readonly snapshot_ids: NonEmptyReadonlyArray<SnapshotId>;
  readonly relation_ids: readonly RecruitmentRevisionRelationId[];
  readonly effective_from: IsoDateTime;
}

export interface RecruitmentPlan {
  readonly recruitment_plan_id: RecruitmentPlanId;
  readonly identity_state: RecruitmentIdentityState;
  readonly recruiting_entity_id?: OrganizationId;
  readonly recruitment_year?: number;
  readonly project_name?: TraceableText;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
  readonly announcement_ids: readonly AnnouncementId[];
  readonly created_at: IsoDateTime;
}

export const RECRUITMENT_BATCH_KINDS = [
  "ORDINARY",
  "FIRST_BATCH",
  "SECOND_BATCH",
  "SUPPLEMENTARY",
  "SPECIAL",
  "OTHER",
  "UNRESOLVED"
] as const;

export type RecruitmentBatchKind = (typeof RECRUITMENT_BATCH_KINDS)[number];

export interface RecruitmentBatch {
  readonly recruitment_batch_id: RecruitmentBatchId;
  readonly recruitment_plan_id?: RecruitmentPlanId;
  readonly plan_identity_state: RecruitmentIdentityState;
  readonly identity_state: RecruitmentIdentityState;
  readonly official_batch_code?: TraceableText;
  readonly batch_label?: TraceableText;
  readonly batch_kind: RecruitmentBatchKind;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
  readonly announcement_ids: readonly AnnouncementId[];
  readonly created_at: IsoDateTime;
}

export const POSITION_IDENTITY_CONTRACT_VERSION = "POSITION_IDENTITY_V1" as const;

export const POSITION_IDENTITY_BASIS_KINDS = [
  "OFFICIAL_POSITION_CODE",
  "SOURCE_LOCAL_RECORD",
  "EXPLICIT_RECONCILIATION"
] as const;

export type PositionIdentityBasis =
  | {
      readonly kind: "OFFICIAL_POSITION_CODE";
      readonly source_definition_id: SourceDefinitionId;
      readonly position_code_namespace: string;
      readonly official_position_code: string;
    }
  | {
      readonly kind: "SOURCE_LOCAL_RECORD";
      readonly source_definition_id: SourceDefinitionId;
      readonly source_occurrence_id: SourceOccurrenceId;
      readonly source_local_record_key: string;
    }
  | {
      readonly kind: "EXPLICIT_RECONCILIATION";
      readonly identity_reconciliation_id: IdentityReconciliationId;
      readonly reconciled_position_ids: NonEmptyReadonlyArray<PositionId>;
      readonly identity_evidence_ids: NonEmptyReadonlyArray<IdentityEvidenceId>;
    };

export interface Position {
  readonly position_id: PositionId;
  readonly identity_state: RecruitmentIdentityState;
  readonly identity_basis: PositionIdentityBasis;
  readonly identity_hash: IdentityHash;
  readonly identity_resolver_version: typeof POSITION_IDENTITY_CONTRACT_VERSION;
  readonly recruitment_plan_id?: RecruitmentPlanId;
  readonly plan_identity_state: RecruitmentIdentityState;
  readonly official_position_code?: TraceableText;
  readonly position_code_namespace?: string;
  readonly source_local_record_identifier?: TraceableText;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
  readonly created_at: IsoDateTime;
}

export interface PositionVersionSemanticPayload {
  readonly position_id: PositionId;
  readonly title: TraceableText;
  readonly recruitment_batch_id?: RecruitmentBatchId;
  readonly organization_role_assignments:
    readonly OrganizationRoleAssignment[];
  readonly location_assignments: readonly LocationAssignment[];
  readonly headcount_observation_ids: readonly HeadcountObservationId[];
  readonly recruitment_population_reference_ids:
    readonly RecruitmentPopulationReferenceId[];
  readonly requirement_surface_reference_keys: readonly string[];
}

export const POSITION_VERSION_SCHEMA_VERSION = "POSITION_VERSION_V2" as const;
export const POSITION_VERSION_MATERIALIZATION_VERSION =
  "position-version-materialization/2.0.0" as const;

export interface PositionVersion extends PositionVersionSemanticPayload {
  readonly position_version_id: PositionVersionId;
  readonly revision: number;
  readonly semantic_hash: SemanticHash;
  readonly position_identity_hash: IdentityHash;
  readonly position_canonical_hash: SemanticHash;
  readonly source_occurrence_version_ids:
    NonEmptyReadonlyArray<SourceOccurrenceVersionId>;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
  readonly effective_from: IsoDateTime;
  readonly schema_version: typeof POSITION_VERSION_SCHEMA_VERSION;
  readonly materialization_version:
    typeof POSITION_VERSION_MATERIALIZATION_VERSION;
  readonly integrity_hash: SemanticHash;
}

export const ORGANIZATION_ROLES = [
  "PUBLISHER",
  "RECRUITING_ENTITY",
  "EMPLOYER_ENTITY"
] as const;

export const ORGANIZATION_RELATIONSHIP_KINDS = [
  "SUBSIDIARY",
  "BRANCH",
  "GROUP_MEMBER",
  "UNRESOLVED"
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
export type OrganizationRelationshipKind =
  (typeof ORGANIZATION_RELATIONSHIP_KINDS)[number];

export interface OrganizationRoleAssignment {
  readonly organization_role_assignment_id: OrganizationRoleAssignmentId;
  readonly role: OrganizationRole;
  readonly organization_id?: OrganizationId;
  readonly identity_state: RecruitmentIdentityState;
  readonly raw_name?: TraceableText;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
}

export interface OrganizationHierarchyReference {
  readonly parent_organization_id: OrganizationId;
  readonly relationship_kind: OrganizationRelationshipKind;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
}

export const LOCATION_ROLES = [
  "EMPLOYER_LOCATION",
  "WORK_LOCATION",
  "APPLICATION_LOCATION",
  "ASSIGNMENT_LOCATION",
  "UNKNOWN"
] as const;

export const LOCATION_ASSIGNMENT_MODES = [
  "SINGLE",
  "MULTI_LOCATION",
  "ANY_OF",
  "ALL_LISTED",
  "TO_BE_ASSIGNED",
  "UNRESTRICTED",
  "UNKNOWN"
] as const;

export type LocationRole = (typeof LOCATION_ROLES)[number];
export type LocationAssignmentMode =
  (typeof LOCATION_ASSIGNMENT_MODES)[number];

export interface RecruitmentLocationValue {
  readonly country?: string;
  readonly province?: string;
  readonly city?: string;
  readonly district?: string;
  readonly raw_text: OriginalText;
  readonly is_nationwide: boolean;
  readonly normalization_confidence: number;
}

export interface LocationAssignment {
  readonly location_assignment_id: LocationAssignmentId;
  readonly role: LocationRole;
  readonly assignment_mode: LocationAssignmentMode;
  readonly locations: readonly RecruitmentLocationValue[];
  readonly identity_discriminator: boolean;
  readonly identity_state: RecruitmentIdentityState;
  readonly identity_evidence_ids: readonly IdentityEvidenceId[];
}

export const HEADCOUNT_OBSERVATION_STATES = [
  "EXACT",
  "SEVERAL",
  "UNKNOWN",
  "NOT_OBSERVED",
  "WITHHELD",
  "SHARED_QUOTA",
  "NOT_APPLICABLE"
] as const;

export type HeadcountObservationState =
  (typeof HEADCOUNT_OBSERVATION_STATES)[number];

interface HeadcountObservationBase {
  readonly headcount_observation_id: HeadcountObservationId;
  readonly evidence_ids: NonEmptyReadonlyArray<IdentityEvidenceId>;
  readonly observer_version: string;
}

export type HeadcountObservation = HeadcountObservationBase & (
  | {
      readonly state: "EXACT";
      readonly raw_text: OriginalText;
      readonly normalized_count: number;
    }
  | {
      readonly state: "SEVERAL" | "UNKNOWN" | "WITHHELD";
      readonly raw_text: OriginalText;
      readonly normalized_count?: never;
    }
  | {
      readonly state: "SHARED_QUOTA";
      readonly raw_text: OriginalText;
      readonly shared_quota_reference: string;
      readonly normalized_count?: never;
    }
  | {
      readonly state: "NOT_OBSERVED" | "NOT_APPLICABLE";
      readonly raw_text: null;
      readonly normalized_count?: never;
    }
);

export const RECRUITMENT_POPULATION_STATES = [
  "CONFIRMED",
  "OPEN",
  "UNRESOLVED",
  "NOT_OBSERVED"
] as const;

export const RECRUITMENT_POPULATION_KINDS = [
  "FRESH_GRADUATE",
  "SOCIAL_RECRUITMENT",
  "SPECIFIED_GRADUATION_YEAR",
  "OVERSEAS_RETURNEE",
  "SPECIAL_RECRUITMENT",
  "UNRESTRICTED",
  "OTHER"
] as const;

export type RecruitmentPopulationState =
  (typeof RECRUITMENT_POPULATION_STATES)[number];
export type RecruitmentPopulationKind =
  (typeof RECRUITMENT_POPULATION_KINDS)[number];

export interface RecruitmentPopulationReference {
  readonly recruitment_population_reference_id:
    RecruitmentPopulationReferenceId;
  readonly state: RecruitmentPopulationState;
  readonly raw_text: OriginalText | null;
  readonly population_kind?: RecruitmentPopulationKind;
  readonly reference_date?: IsoDate;
  readonly recruitment_cycle?: TraceableText;
  readonly related_requirement_observation_ids: readonly string[];
  readonly evidence_ids: readonly IdentityEvidenceId[];
  readonly observer_version: string;
}

export const RECRUITMENT_REVISION_RELATION_KINDS = [
  "ORIGINAL",
  "CORRECTION",
  "SUPPLEMENT",
  "REPLACEMENT",
  "SUPERSEDING",
  "CANCELLED",
  "REINSTATED"
] as const;

export type RecruitmentRevisionRelationKind =
  (typeof RECRUITMENT_REVISION_RELATION_KINDS)[number];

export type RecruitmentRevisionTarget =
  | { readonly kind: "ANNOUNCEMENT"; readonly announcement_id: AnnouncementId }
  | { readonly kind: "RECRUITMENT_PLAN"; readonly recruitment_plan_id: RecruitmentPlanId }
  | { readonly kind: "RECRUITMENT_BATCH"; readonly recruitment_batch_id: RecruitmentBatchId }
  | { readonly kind: "POSITION"; readonly position_id: PositionId }
  | { readonly kind: "OPPORTUNITY"; readonly opportunity_id: CanonicalOpportunityId }
  | { readonly kind: "UNRESOLVED"; readonly raw_target?: OriginalText };

export interface RecruitmentRevisionRelation {
  readonly recruitment_revision_relation_id: RecruitmentRevisionRelationId;
  readonly relation_kind: RecruitmentRevisionRelationKind;
  readonly source_announcement_version_id: AnnouncementVersionId;
  readonly target: RecruitmentRevisionTarget;
  readonly affected_scope?: OriginalText;
  readonly effective_on?: IsoDate;
  readonly certainty: IdentityEvidenceCertainty;
  readonly evidence_ids: NonEmptyReadonlyArray<IdentityEvidenceId>;
  readonly resolver_version: string;
}

export type RecruitmentIdentityEntityReference =
  | { readonly kind: "ANNOUNCEMENT"; readonly id: AnnouncementId }
  | { readonly kind: "RECRUITMENT_PLAN"; readonly id: RecruitmentPlanId }
  | { readonly kind: "RECRUITMENT_BATCH"; readonly id: RecruitmentBatchId }
  | { readonly kind: "POSITION"; readonly id: PositionId }
  | { readonly kind: "OPPORTUNITY"; readonly id: CanonicalOpportunityId };

export interface IdentityAlias {
  readonly identity_alias_id: IdentityAliasId;
  readonly target: RecruitmentIdentityEntityReference;
  readonly alias_namespace: string;
  readonly alias_value: TraceableText;
  readonly evidence_ids: NonEmptyReadonlyArray<IdentityEvidenceId>;
  readonly created_at: IsoDateTime;
}

export const IDENTITY_RECONCILIATION_KINDS = [
  "ALIAS",
  "MERGE",
  "SPLIT",
  "CORRECTION",
  "REPLACEMENT",
  "SUPERSEDING"
] as const;

export const IDENTITY_RECONCILIATION_STATES = [
  "CONFIRMED",
  "REVIEW_REQUIRED"
] as const;

export type IdentityReconciliationKind =
  (typeof IDENTITY_RECONCILIATION_KINDS)[number];
export type IdentityReconciliationState =
  (typeof IDENTITY_RECONCILIATION_STATES)[number];

export interface IdentityReconciliation {
  readonly identity_reconciliation_id: IdentityReconciliationId;
  readonly reconciliation_kind: IdentityReconciliationKind;
  readonly state: IdentityReconciliationState;
  readonly from: NonEmptyReadonlyArray<RecruitmentIdentityEntityReference>;
  readonly to: NonEmptyReadonlyArray<RecruitmentIdentityEntityReference>;
  readonly evidence_ids: NonEmptyReadonlyArray<IdentityEvidenceId>;
  readonly resolver_version: string;
  readonly created_at: IsoDateTime;
}

export class RecruitmentContextValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecruitmentContextValidationError";
  }
}

export class PositionContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionContractValidationError";
  }
}

export function validatePositionIdentityBasis(
  basis: PositionIdentityBasis
): PositionIdentityBasis {
  if (!basis || typeof basis !== "object") {
    throw new PositionContractValidationError("Position identity basis must be an object");
  }
  const runtime = basis as PositionIdentityBasis & Record<string, unknown>;
  if (!POSITION_IDENTITY_BASIS_KINDS.includes(
    runtime.kind as (typeof POSITION_IDENTITY_BASIS_KINDS)[number]
  )) {
    throw new PositionContractValidationError("Position identity basis kind is not supported");
  }

  if (runtime.kind === "OFFICIAL_POSITION_CODE") {
    requireExactKeys(runtime, [
      "kind",
      "source_definition_id",
      "position_code_namespace",
      "official_position_code"
    ]);
    requireNonEmptyString(runtime.source_definition_id, "source_definition_id");
    requireNonEmptyString(runtime.position_code_namespace, "position_code_namespace");
    requireNonEmptyString(runtime.official_position_code, "official_position_code");
    return basis;
  }

  if (runtime.kind === "SOURCE_LOCAL_RECORD") {
    requireExactKeys(runtime, [
      "kind",
      "source_definition_id",
      "source_occurrence_id",
      "source_local_record_key"
    ]);
    requireNonEmptyString(runtime.source_definition_id, "source_definition_id");
    requireNonEmptyString(runtime.source_occurrence_id, "source_occurrence_id");
    requireNonEmptyString(runtime.source_local_record_key, "source_local_record_key");
    return basis;
  }

  requireExactKeys(runtime, [
    "kind",
    "identity_reconciliation_id",
    "reconciled_position_ids",
    "identity_evidence_ids"
  ]);
  requireNonEmptyString(
    runtime.identity_reconciliation_id,
    "identity_reconciliation_id"
  );
  requireNonEmptyStringArray(
    runtime.reconciled_position_ids,
    "reconciled_position_ids"
  );
  requireNonEmptyStringArray(runtime.identity_evidence_ids, "identity_evidence_ids");
  return basis;
}

export function canonicalizePositionIdentityBasis(
  basis: PositionIdentityBasis
): string {
  validatePositionIdentityBasis(basis);
  if (basis.kind === "OFFICIAL_POSITION_CODE") {
    return stableSerialize({
      kind: basis.kind,
      official_position_code: basis.official_position_code.trim(),
      position_code_namespace: basis.position_code_namespace.trim(),
      source_definition_id: basis.source_definition_id
    });
  }
  if (basis.kind === "SOURCE_LOCAL_RECORD") {
    return stableSerialize({
      kind: basis.kind,
      source_definition_id: basis.source_definition_id,
      source_local_record_key: basis.source_local_record_key.trim(),
      source_occurrence_id: basis.source_occurrence_id
    });
  }
  return stableSerialize({
    identity_evidence_ids: uniqueSorted(basis.identity_evidence_ids),
    identity_reconciliation_id: basis.identity_reconciliation_id,
    kind: basis.kind,
    reconciled_position_ids: uniqueSorted(basis.reconciled_position_ids)
  });
}

export function positionIdentityHashFor(
  basis: PositionIdentityBasis
): IdentityHash {
  return sha256(canonicalizePositionIdentityBasis(basis)) as IdentityHash;
}

export function positionIdForIdentityBasis(
  basis: PositionIdentityBasis
): PositionId {
  return `position:${positionIdentityHashFor(basis)}` as PositionId;
}

export function validatePosition(position: Position): Position {
  validatePositionIdentityBasis(position.identity_basis);
  const expectedHash = positionIdentityHashFor(position.identity_basis);
  const expectedId = positionIdForIdentityBasis(position.identity_basis);
  if (position.identity_hash !== expectedHash || position.position_id !== expectedId) {
    throw new PositionContractValidationError(
      "Position identity hash and ID must match the canonical identity basis"
    );
  }
  if (position.identity_resolver_version !== POSITION_IDENTITY_CONTRACT_VERSION) {
    throw new PositionContractValidationError(
      "Position identity resolver version is not supported"
    );
  }
  if (position.identity_evidence_ids.length === 0) {
    throw new PositionContractValidationError("Position requires identity Evidence");
  }

  if (position.identity_basis.kind === "SOURCE_LOCAL_RECORD") {
    if (position.identity_state !== "PROVISIONAL") {
      throw new PositionContractValidationError(
        "SOURCE_LOCAL_RECORD Position identity must remain PROVISIONAL"
      );
    }
    if (!position.source_local_record_identifier?.original.text.trim()) {
      throw new PositionContractValidationError(
        "SOURCE_LOCAL_RECORD Position requires an exact source-local identifier"
      );
    }
    return position;
  }

  if (position.identity_state !== "CONFIRMED") {
    throw new PositionContractValidationError(
      "Official or reconciled Position identity must be CONFIRMED"
    );
  }
  if (position.identity_basis.kind === "OFFICIAL_POSITION_CODE") {
    const observedCode = semanticText(position.official_position_code);
    if (observedCode !== position.identity_basis.official_position_code.trim()
        || position.position_code_namespace
          !== position.identity_basis.position_code_namespace.trim()) {
      throw new PositionContractValidationError(
        "Position official code observation must match its identity basis"
      );
    }
  }
  return position;
}

export function positionVersionSemanticHashFor(
  payload: PositionVersionSemanticPayload
): SemanticHash {
  return sha256(stableSerialize({
    headcount_observation_ids: uniqueSorted(payload.headcount_observation_ids),
    location_assignments: payload.location_assignments
      .map(canonicalLocationAssignment)
      .sort(compareCanonical),
    organization_role_assignments: payload.organization_role_assignments
      .map(canonicalOrganizationRoleAssignment)
      .sort(compareCanonical),
    position_id: payload.position_id,
    recruitment_batch_id: payload.recruitment_batch_id ?? null,
    recruitment_population_reference_ids: uniqueSorted(
      payload.recruitment_population_reference_ids
    ),
    requirement_surface_reference_keys: uniqueSorted(
      payload.requirement_surface_reference_keys
    ),
    title: semanticText(payload.title)
  })) as SemanticHash;
}

export function positionCanonicalHashFor(position: Position): SemanticHash {
  validatePosition(position);
  return sha256(stableSerialize({
    created_at: position.created_at,
    identity_basis: JSON.parse(canonicalizePositionIdentityBasis(
      position.identity_basis
    )),
    identity_evidence_ids: uniqueSorted(position.identity_evidence_ids),
    identity_hash: position.identity_hash,
    identity_resolver_version: position.identity_resolver_version,
    identity_state: position.identity_state,
    official_position_code: semanticText(position.official_position_code),
    plan_identity_state: position.plan_identity_state,
    position_code_namespace: position.position_code_namespace ?? null,
    position_id: position.position_id,
    recruitment_plan_id: position.recruitment_plan_id ?? null,
    source_local_record_identifier:
      semanticText(position.source_local_record_identifier)
  })) as SemanticHash;
}

export function positionVersionIntegrityHashFor(
  version: Omit<PositionVersion, "integrity_hash">
    | PositionVersion
): SemanticHash {
  return sha256(stableSerialize({
    effective_from: version.effective_from,
    identity_evidence_ids: uniqueSorted(version.identity_evidence_ids),
    materialization_version: version.materialization_version,
    position_canonical_hash: version.position_canonical_hash,
    position_id: version.position_id,
    position_identity_hash: version.position_identity_hash,
    position_version_id: version.position_version_id,
    revision: version.revision,
    schema_version: version.schema_version,
    semantic_hash: version.semantic_hash,
    semantic_payload: {
      headcount_observation_ids:
        uniqueSorted(version.headcount_observation_ids),
      location_assignments: version.location_assignments
        .map(canonicalLocationAssignment)
        .sort(compareCanonical),
      organization_role_assignments: version.organization_role_assignments
        .map(canonicalOrganizationRoleAssignment)
        .sort(compareCanonical),
      position_id: version.position_id,
      recruitment_batch_id: version.recruitment_batch_id ?? null,
      recruitment_population_reference_ids: uniqueSorted(
        version.recruitment_population_reference_ids
      ),
      requirement_surface_reference_keys: uniqueSorted(
        version.requirement_surface_reference_keys
      ),
      title: semanticText(version.title)
    },
    source_occurrence_version_ids: uniqueSorted(
      version.source_occurrence_version_ids
    )
  })) as SemanticHash;
}

export function positionVersionIdFor(
  positionIdentityHash: IdentityHash,
  revision: number
): PositionVersionId {
  requirePositiveRevision(revision);
  return `position-version:${positionIdentityHash}:${revision}` as PositionVersionId;
}

export function validatePositionVersion(
  version: PositionVersion,
  position: Position
): PositionVersion {
  validatePosition(position);
  requirePositiveRevision(version.revision);
  if (version.position_id !== position.position_id) {
    throw new PositionContractValidationError(
      "PositionVersion must reference the supplied Position"
    );
  }
  if (version.position_version_id
      !== positionVersionIdFor(position.identity_hash, version.revision)) {
    throw new PositionContractValidationError(
      "PositionVersion ID must match Position identity hash and revision"
    );
  }
  if (version.semantic_hash !== positionVersionSemanticHashFor(version)) {
    throw new PositionContractValidationError(
      "PositionVersion semantic hash does not match its canonical payload"
    );
  }
  if (version.position_identity_hash !== position.identity_hash
      || version.position_canonical_hash !== positionCanonicalHashFor(position)) {
    throw new PositionContractValidationError(
      "PositionVersion Position identity or canonical reference is invalid"
    );
  }
  if (version.source_occurrence_version_ids.length === 0) {
    throw new PositionContractValidationError(
      "PositionVersion requires a SourceOccurrenceVersion binding"
    );
  }
  if (version.identity_evidence_ids.length === 0) {
    throw new PositionContractValidationError("PositionVersion requires identity Evidence");
  }
  requireNonEmptyString(version.effective_from, "effective_from");
  if (version.schema_version !== POSITION_VERSION_SCHEMA_VERSION
      || version.materialization_version
        !== POSITION_VERSION_MATERIALIZATION_VERSION
      || !/^[a-f0-9]{64}$/u.test(version.integrity_hash)
      || version.integrity_hash !== positionVersionIntegrityHashFor(version)) {
    throw new PositionContractValidationError(
      "PositionVersion immutable integrity envelope is invalid"
    );
  }
  return version;
}

export function validateHeadcountObservation(
  observation: HeadcountObservation
): HeadcountObservation {
  const runtime = observation as HeadcountObservation & {
    readonly normalized_count?: unknown;
    readonly shared_quota_reference?: unknown;
  };
  if (observation.evidence_ids.length === 0) {
    throw new RecruitmentContextValidationError(
      "HeadcountObservation requires traceable Evidence"
    );
  }
  if (observation.state === "EXACT") {
    if (!Number.isInteger(observation.normalized_count)
        || observation.normalized_count < 0) {
      throw new RecruitmentContextValidationError(
        "EXACT headcount requires a non-negative integer"
      );
    }
    return observation;
  }
  if (runtime.normalized_count !== undefined) {
    throw new RecruitmentContextValidationError(
      "Only EXACT headcount may carry normalized_count"
    );
  }
  if (observation.state === "SHARED_QUOTA"
      && (typeof runtime.shared_quota_reference !== "string"
        || runtime.shared_quota_reference.trim().length === 0)) {
    throw new RecruitmentContextValidationError(
      "SHARED_QUOTA requires a non-empty shared quota reference"
    );
  }
  return observation;
}

export function validateIdentityAlias(alias: IdentityAlias): IdentityAlias {
  if (!alias.alias_namespace.trim() || !alias.alias_value.original.text.trim()) {
    throw new RecruitmentContextValidationError(
      "IdentityAlias requires a namespace and observed alias value"
    );
  }
  if (alias.evidence_ids.length === 0) {
    throw new RecruitmentContextValidationError(
      "IdentityAlias requires traceable Evidence"
    );
  }
  return alias;
}

export function validateIdentityReconciliation(
  reconciliation: IdentityReconciliation
): IdentityReconciliation {
  if (reconciliation.from.length === 0 || reconciliation.to.length === 0) {
    throw new RecruitmentContextValidationError(
      "IdentityReconciliation requires non-empty from and to references"
    );
  }
  if (reconciliation.evidence_ids.length === 0) {
    throw new RecruitmentContextValidationError(
      "IdentityReconciliation requires traceable Evidence"
    );
  }
  if (!reconciliation.resolver_version.trim()) {
    throw new RecruitmentContextValidationError(
      "IdentityReconciliation requires a resolver version"
    );
  }
  return reconciliation;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
) {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new PositionContractValidationError(
      `Position identity basis contains forbidden fields: ${unexpected.sort().join(", ")}`
    );
  }
}

function requireNonEmptyString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PositionContractValidationError(`${field} must be a non-empty string`);
  }
}

function requireNonEmptyStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length === 0
      || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new PositionContractValidationError(
      `${field} must be a non-empty array of non-empty strings`
    );
  }
}

function requirePositiveRevision(revision: number) {
  if (!Number.isInteger(revision) || revision <= 0) {
    throw new PositionContractValidationError(
      "PositionVersion revision must be a positive integer"
    );
  }
}

function canonicalOrganizationRoleAssignment(
  assignment: OrganizationRoleAssignment
) {
  return {
    identity_state: assignment.identity_state,
    organization_id: assignment.organization_id ?? null,
    raw_name: semanticText(assignment.raw_name),
    role: assignment.role
  };
}

function canonicalLocationAssignment(assignment: LocationAssignment) {
  return {
    assignment_mode: assignment.assignment_mode,
    identity_discriminator: assignment.identity_discriminator,
    identity_state: assignment.identity_state,
    locations: assignment.locations.map((location) => ({
      city: location.city ?? null,
      country: location.country ?? null,
      district: location.district ?? null,
      is_nationwide: location.is_nationwide,
      normalization_confidence: location.normalization_confidence,
      province: location.province ?? null,
      raw_text: location.raw_text.text
    })).sort(compareCanonical),
    role: assignment.role
  };
}

function semanticText(value: TraceableText | undefined) {
  return value?.normalized?.text.trim() ?? value?.original.text.trim() ?? null;
}

function compareCanonical(left: unknown, right: unknown) {
  return stableSerialize(left).localeCompare(stableSerialize(right));
}

function uniqueSorted(values: readonly string[]) {
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
