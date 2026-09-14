import type {
  CanonicalOpportunityId,
  ExtractedRecordId,
  IdentityHash,
  IdentityEvidenceId,
  IsoDate,
  IsoDateTime,
  LifecycleEventId,
  NonEmptyReadonlyArray,
  OpportunityVersionId,
  OrganizationId,
  PositionId,
  PositionVersionId,
  RawContentSha256,
  RecruitmentBatchId,
  RecruitmentEndpointId,
  RecruitmentPlanId,
  RecruitmentRevisionRelationId,
  SemanticHash,
  SnapshotId,
  SourceDefinitionId,
  SourceOccurrenceId,
  SourceOccurrenceVersionId
} from "./primitives";
import type { OriginalText, TraceableText } from "./text";
import type {
  HeadcountObservation,
  IdentityEvidence,
  LocationAssignment,
  OpportunityRecruitmentContext,
  OrganizationRoleAssignment,
  Position,
  PositionVersion,
  RecruitmentIdentityState,
  RecruitmentPopulationReference
} from "./recruitment-context";

export interface OpportunityLocation {
  readonly country?: string;
  readonly province?: string;
  readonly city?: string;
  readonly district?: string;
  readonly raw_text: OriginalText;
  readonly is_nationwide: boolean;
  readonly normalization_confidence: number;
}

export interface OrganizationReference {
  readonly organization_id?: OrganizationId;
  readonly name: TraceableText;
}

export interface ApplicationWindow {
  readonly starts_on?: IsoDate;
  readonly closes_on?: IsoDate;
  readonly raw_text?: OriginalText;
}

export interface OpportunityContent {
  readonly organization: OrganizationReference;
  readonly title: TraceableText;
  readonly description?: TraceableText;
  readonly requirement_text?: TraceableText;
  readonly locations: readonly OpportunityLocation[];
  readonly recruitment_year?: number;
  readonly recruitment_batch?: TraceableText;
  readonly published_on?: IsoDate;
  readonly application_window?: ApplicationWindow;
  readonly announcement_locator?: string;
  readonly application_locator?: string;
  readonly recruitment_context?: OpportunityRecruitmentContext;
  readonly organization_role_assignments?: readonly OrganizationRoleAssignment[];
  readonly location_assignments?: readonly LocationAssignment[];
  readonly headcount_observations?: readonly HeadcountObservation[];
  readonly recruitment_population_references?: readonly RecruitmentPopulationReference[];
  readonly recruitment_revision_relation_ids?: readonly RecruitmentRevisionRelationId[];
}

export type SourceOccurrenceIdentityBasis =
  | {
      readonly kind: "SOURCE_RECORD_ID";
      readonly source_record_id: string;
      readonly recruitment_cycle: string;
    }
  | {
      readonly kind: "DETAIL_URL";
      readonly normalized_detail_url: string;
    }
  | {
      readonly kind: "RECRUITMENT_CONTEXT";
      readonly position_identity_key: string;
      readonly recruitment_plan_identity_key: string | null;
      readonly recruitment_batch_identity_key: string | null;
      readonly opportunity_identity_key: string | null;
      readonly source_local_record_key: string;
    }
  | {
      readonly kind: "COMPOSITE_FIELDS";
      readonly normalized_organization: string;
      readonly normalized_title: string;
      readonly normalized_locations: readonly string[];
      readonly recruitment_batch: string | null;
    };

export interface SourceOccurrence {
  readonly source_occurrence_id: SourceOccurrenceId;
  readonly source_definition_id: SourceDefinitionId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly source_record_key?: string;
  readonly identity_basis: SourceOccurrenceIdentityBasis;
  readonly identity_hash: IdentityHash;
  readonly first_observed_at: IsoDateTime;
}

export interface SourceOccurrenceVersion {
  readonly source_occurrence_version_id: SourceOccurrenceVersionId;
  readonly source_occurrence_id: SourceOccurrenceId;
  readonly extracted_record_id: ExtractedRecordId;
  readonly revision: number;
  readonly semantic_hash: SemanticHash;
  readonly content: OpportunityContent;
  readonly identity_evidence?: readonly IdentityEvidence[];
  readonly first_observed_at: IsoDateTime;
}

export const SOURCE_OCCURRENCE_VERSION_V2_CONTRACT_VERSION =
  "SOURCE_OCCURRENCE_VERSION_V2" as const;

export interface SourceOccurrenceVersionMaterialization {
  readonly contract_version:
    typeof SOURCE_OCCURRENCE_VERSION_V2_CONTRACT_VERSION;
  readonly source_definition_id: SourceDefinitionId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly snapshot_id: SnapshotId;
  readonly snapshot_content_hash: RawContentSha256;
  readonly extracted_record_semantic_hash: SemanticHash;
  readonly observed_at: IsoDateTime;
  readonly extractor_name: string;
  readonly extractor_version: string;
  readonly extractor_schema_version: string;
}

export interface MaterializedSourceOccurrenceVersion
  extends SourceOccurrenceVersion {
  readonly identity_evidence: readonly IdentityEvidence[];
  readonly materialization: SourceOccurrenceVersionMaterialization;
}

export type CanonicalOpportunityIdentityBasis =
  | {
      readonly kind: "RECRUITMENT_CONTEXT";
      readonly position_id: PositionId;
      readonly recruitment_plan_id?: RecruitmentPlanId;
      readonly recruitment_batch_id?: RecruitmentBatchId;
      readonly official_opportunity_identity_key?: string;
    }
  | {
      readonly kind: "LEGACY_COMPARISON";
      readonly legacy_identity_hash: IdentityHash;
    };

export interface CanonicalOpportunity {
  readonly canonical_opportunity_id: CanonicalOpportunityId;
  readonly identity_hash: IdentityHash;
  readonly identity_state?: RecruitmentIdentityState;
  readonly identity_basis?: CanonicalOpportunityIdentityBasis;
  readonly identity_evidence_ids?: readonly IdentityEvidenceId[];
  readonly created_at: IsoDateTime;
}

export type Opportunity = CanonicalOpportunity;

export interface OpportunityVersion {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly canonical_opportunity_id: CanonicalOpportunityId;
  readonly revision: number;
  readonly semantic_hash: SemanticHash;
  readonly content: OpportunityContent;
  readonly source_occurrence_version_ids: NonEmptyReadonlyArray<SourceOccurrenceVersionId>;
  readonly position_version_id?: PositionVersionId;
  readonly identity_evidence_ids?: readonly IdentityEvidenceId[];
  readonly effective_from: IsoDateTime;
}

export interface PositionBoundOpportunityVersion extends OpportunityVersion {
  readonly position_version_id: PositionVersionId;
  readonly integrity_hash: SemanticHash;
}

export type PositionBoundOpportunityVersionBinding = OpportunityVersion & {
  readonly position_version_id: PositionVersionId;
};

export class OpportunityContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityContractValidationError";
  }
}

export function validatePositionBoundOpportunityVersion(
  opportunityVersion: OpportunityVersion,
  position: Position,
  positionVersion: PositionVersion
): PositionBoundOpportunityVersionBinding {
  if (!opportunityVersion.position_version_id) {
    throw new OpportunityContractValidationError(
      "Position-bound OpportunityVersion requires position_version_id"
    );
  }
  if (opportunityVersion.position_version_id !== positionVersion.position_version_id) {
    throw new OpportunityContractValidationError(
      "OpportunityVersion must reference the supplied PositionVersion"
    );
  }
  if (positionVersion.position_id !== position.position_id) {
    throw new OpportunityContractValidationError(
      "PositionVersion must belong to the supplied Position"
    );
  }
  const positionVersionSources = new Set(
    positionVersion.source_occurrence_version_ids
  );
  if (opportunityVersion.source_occurrence_version_ids.length === 0
      || opportunityVersion.source_occurrence_version_ids.some((sourceVersionId) => {
        return !positionVersionSources.has(sourceVersionId);
      })) {
    throw new OpportunityContractValidationError(
      "Every OpportunityVersion SourceOccurrenceVersion must belong to its PositionVersion"
    );
  }
  return opportunityVersion as PositionBoundOpportunityVersionBinding;
}

export const LIFECYCLE_EVENT_KINDS = [
  "DISCOVERED",
  "ACTIVE_CONFIRMED",
  "MISSING_OBSERVED",
  "EXPIRED",
  "CLOSED",
  "REOPENED"
] as const;

export type LifecycleEventKind = (typeof LIFECYCLE_EVENT_KINDS)[number];

export type LifecycleTarget =
  | {
      readonly kind: "SOURCE_OCCURRENCE";
      readonly source_occurrence_id: SourceOccurrenceId;
    }
  | {
      readonly kind: "CANONICAL_OPPORTUNITY";
      readonly canonical_opportunity_id: CanonicalOpportunityId;
    };

export interface LifecycleEvent {
  readonly lifecycle_event_id: LifecycleEventId;
  readonly target: LifecycleTarget;
  readonly event_kind: LifecycleEventKind;
  readonly observed_at: IsoDateTime;
  readonly snapshot_ids: readonly SnapshotId[];
  readonly reason_code: string;
}
