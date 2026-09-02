import type { SourceHealth, SourceHealthStatus } from "../source-scheduler/types";

export const READ_ONLY_INGESTION_API_BASE_PATH = "/api/ingestion/v1";

export const OBSERVATION_STATES = [
  "OBSERVED",
  "PARTIAL",
  "SUSPICIOUS_EMPTY",
  "UNAVAILABLE"
] as const;

export type ObservationState = (typeof OBSERVATION_STATES)[number];

export interface ReadOnlyPagination {
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
}

export interface OpportunityQuery {
  readonly keyword?: string;
  readonly organization?: string;
  readonly source?: string;
  readonly observation_state?: ObservationState;
  readonly offset?: number;
  readonly limit?: number;
}

export interface OpportunitySourceProjection {
  readonly source_occurrence_id: string;
  readonly source_occurrence_version_id: string;
  readonly extracted_record_id: string;
  readonly snapshot_id: string;
  readonly raw_blob_id: string;
  readonly collection_run_id: string;
  readonly recruitment_endpoint_id: string;
  readonly source_definition_id: string;
  readonly original_url: string;
}

export interface OpportunityProjection {
  readonly opportunity_id: string;
  readonly opportunity_version_id: string;
  readonly title: string;
  readonly organization: { readonly organization_id: string; readonly name: string } | null;
  readonly source: { readonly source_definition_id: string; readonly name: string };
  readonly endpoint: {
    readonly recruitment_endpoint_id: string;
    readonly name: string;
    readonly locator: string;
    readonly purpose: string | null;
  };
  readonly original_url: string;
  readonly observed_at: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly content_hash: string;
  readonly observation_state: ObservationState;
  readonly provenance: readonly OpportunitySourceProjection[];
}

export interface RequirementEvidenceProjection {
  readonly requirement_evidence_id: string;
  readonly snapshot_id: string;
  readonly raw_blob_id: string;
  readonly original_url: string;
  readonly locator: Readonly<Record<string, unknown>>;
  readonly evidence_text: string;
  readonly extractor_name: string;
  readonly extractor_version: string;
  readonly parser_version: string;
}

export interface RequirementProjection {
  readonly requirement_fact_id: string;
  readonly dimension: string;
  readonly operator: string;
  readonly value: unknown;
  readonly subject_scope: string;
  readonly polarity: string;
  readonly certainty: string;
  readonly parser_version: string;
  readonly evidence: readonly RequirementEvidenceProjection[];
}

export interface EligibilityAssessmentProjection {
  readonly eligibility_assessment_id: string;
  readonly candidate_profile_id: string;
  readonly result: string;
  readonly reason_codes: readonly string[];
  readonly requirement_fact_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly assessed_at: string;
}

export type EligibilityProjection =
  | {
      readonly status: "NOT_ASSESSED";
      readonly reason: string;
    }
  | {
      readonly status: "ASSESSED";
      readonly assessments: readonly EligibilityAssessmentProjection[];
    };

export interface OpportunityDetailProjection {
  readonly opportunity: OpportunityProjection;
  readonly requirements: readonly RequirementProjection[];
  readonly eligibility: EligibilityProjection;
}

export interface SourceHealthProjection {
  readonly source_definition_id: string;
  readonly source_admission_id: string;
  readonly recruitment_endpoint_id: string;
  readonly status: SourceHealthStatus;
  readonly consecutive_success: number;
  readonly consecutive_failure: number;
  readonly last_success: string | null;
  readonly last_failure: string | null;
  readonly last_http_status: number | null;
  readonly last_content_hash: string | null;
  readonly structure_change_detected: boolean;
  readonly robots_status: string;
  readonly terms_status: string;
}

export interface SourceProjection {
  readonly source_definition_id: string;
  readonly name: string;
  readonly publisher_organization: { readonly organization_id: string; readonly name: string };
  readonly endpoints: readonly {
    readonly recruitment_endpoint_id: string;
    readonly name: string;
    readonly locator: string;
    readonly health: SourceHealthProjection | null;
  }[];
}

export interface ReadOnlyIngestionProjectionOptions {
  readonly source_health?: readonly SourceHealth[];
}

export class ReadOnlyProjectionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyProjectionIntegrityError";
  }
}

export class ReadOnlyApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyApiRequestError";
  }
}
