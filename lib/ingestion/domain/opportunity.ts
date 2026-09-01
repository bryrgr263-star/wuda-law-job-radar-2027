import type {
  CanonicalOpportunityId,
  ExtractedRecordId,
  IdentityHash,
  IsoDate,
  IsoDateTime,
  LifecycleEventId,
  NonEmptyReadonlyArray,
  OpportunityVersionId,
  OrganizationId,
  RecruitmentEndpointId,
  SemanticHash,
  SnapshotId,
  SourceDefinitionId,
  SourceOccurrenceId,
  SourceOccurrenceVersionId
} from "./primitives";
import type { OriginalText, TraceableText } from "./text";

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
  readonly published_on?: IsoDate;
  readonly application_window?: ApplicationWindow;
  readonly application_locator?: string;
}

export interface SourceOccurrence {
  readonly source_occurrence_id: SourceOccurrenceId;
  readonly source_definition_id: SourceDefinitionId;
  readonly recruitment_endpoint_id: RecruitmentEndpointId;
  readonly source_record_key?: string;
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
  readonly first_observed_at: IsoDateTime;
}

export interface CanonicalOpportunity {
  readonly canonical_opportunity_id: CanonicalOpportunityId;
  readonly identity_hash: IdentityHash;
  readonly created_at: IsoDateTime;
}

export interface OpportunityVersion {
  readonly opportunity_version_id: OpportunityVersionId;
  readonly canonical_opportunity_id: CanonicalOpportunityId;
  readonly revision: number;
  readonly semantic_hash: SemanticHash;
  readonly content: OpportunityContent;
  readonly source_occurrence_version_ids: NonEmptyReadonlyArray<SourceOccurrenceVersionId>;
  readonly effective_from: IsoDateTime;
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
