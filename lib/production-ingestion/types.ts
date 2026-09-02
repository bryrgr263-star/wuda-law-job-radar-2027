import type {
  CandidateProfile,
  EligibilityAssessment,
  ExtractedRecord,
  Organization,
  RawBlob,
  RecruitmentEndpoint,
  RequirementEvidence,
  RequirementFact,
  Snapshot,
  SourceDefinition
} from "../ingestion";

export const PRODUCTION_INGESTION_SCHEMA = "ingestion_production";

export const PRODUCTION_INGESTION_TABLES = {
  schema_migrations: "ingestion_production.schema_migrations",
  organizations: "ingestion_production.organizations",
  source_definitions: "ingestion_production.source_definitions",
  recruitment_endpoints: "ingestion_production.recruitment_endpoints",
  authorization_audits: "ingestion_production.authorization_audits",
  collection_runs: "ingestion_production.collection_runs",
  raw_blobs: "ingestion_production.raw_blobs",
  raw_blob_runs: "ingestion_production.raw_blob_runs",
  snapshots: "ingestion_production.snapshots",
  extracted_records: "ingestion_production.extracted_records",
  source_occurrences: "ingestion_production.source_occurrences",
  source_occurrence_versions: "ingestion_production.source_occurrence_versions",
  canonical_opportunities: "ingestion_production.canonical_opportunities",
  opportunity_versions: "ingestion_production.opportunity_versions",
  opportunity_version_sources: "ingestion_production.opportunity_version_sources",
  requirement_facts: "ingestion_production.requirement_facts",
  requirement_evidence: "ingestion_production.requirement_evidence",
  candidate_profiles: "ingestion_production.candidate_profiles",
  eligibility_assessments: "ingestion_production.eligibility_assessments",
  eligibility_assessment_facts: "ingestion_production.eligibility_assessment_facts",
  eligibility_assessment_evidence: "ingestion_production.eligibility_assessment_evidence",
  assessment_deferrals: "ingestion_production.assessment_deferrals"
} as const;

export interface ProductionIngestionContract {
  readonly schema: typeof PRODUCTION_INGESTION_SCHEMA;
  readonly real_production_connection_configured: false;
  readonly real_production_write_authorized: false;
  readonly local_production_like_testing_allowed: true;
  readonly raw_body_database_storage_allowed: false;
  readonly tables: readonly string[];
}

export const PRODUCTION_INGESTION_CONTRACT: ProductionIngestionContract = {
  schema: PRODUCTION_INGESTION_SCHEMA,
  real_production_connection_configured: false,
  real_production_write_authorized: false,
  local_production_like_testing_allowed: true,
  raw_body_database_storage_allowed: false,
  tables: Object.values(PRODUCTION_INGESTION_TABLES)
};

export type ProductionIngestionWriteStage =
  | "SOURCE"
  | "AUTHORIZATION"
  | "COLLECTION_RUN"
  | "RAW"
  | "SNAPSHOT"
  | "EXTRACTED_RECORD"
  | "OCCURRENCE"
  | "CANONICAL"
  | "REQUIREMENT"
  | "ELIGIBILITY";

export type ProductionIngestionWriteStatus =
  | "CREATED"
  | "UNCHANGED"
  | "UPDATED"
  | "IDENTITY_UNCERTAIN";

export interface AuthorizedCanaryAuditReference {
  readonly authorization_id: string;
  readonly source_admission_id: string;
  readonly admission_level: "A" | "B" | "C" | "D";
  readonly admission_decision: "APPROVED" | "REJECTED" | "REVIEW";
  readonly automation_basis: string;
  readonly endpoint: string;
  readonly recruitment_endpoint_id: string;
  readonly endpoint_purpose: "JOB_LIST" | "JOB_DETAIL" | "RECRUITMENT_NOTICE";
  readonly allowed_http_method: "GET";
  readonly collection_run_id: string;
  readonly reviewer: string;
  readonly issued_at: string;
  readonly evidence_id: string;
  readonly scope: "ONE_ENDPOINT_ONE_RUN";
  readonly manual_confirmation: true;
  readonly authorization_consumed: true;
  readonly replay_denial_code: "AUTHORIZATION_ALREADY_USED";
}

export interface ProductionCollectionRun {
  readonly collection_run_id: string;
  readonly source_definition_id: string;
  readonly recruitment_endpoint_id: string;
  readonly authorization_id: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly status: "SUCCESS" | "FAILED" | "PARTIAL" | "SUSPICIOUS_EMPTY";
  readonly request_metadata: Readonly<Record<string, unknown>>;
  readonly result_metadata: Readonly<Record<string, unknown>>;
  readonly scheduler_dispatch_reference: string | null;
}

export interface ProductionCaptureWriteInput {
  readonly organizations: readonly Organization[];
  readonly source_definition: SourceDefinition;
  readonly endpoint: RecruitmentEndpoint;
  readonly authorization: AuthorizedCanaryAuditReference;
  readonly collection_run: ProductionCollectionRun;
  readonly raw_blob: RawBlob;
  readonly raw_object_path: string;
  readonly original_url: string;
  readonly snapshot: Snapshot;
  readonly extracted_records: readonly ExtractedRecord[];
}

export interface ProductionRequirementWriteInput {
  readonly facts: readonly RequirementFact[];
  readonly evidence: readonly RequirementEvidence[];
}

export interface ProductionEligibilityWriteInput {
  readonly candidate_profile: CandidateProfile;
  readonly assessment: EligibilityAssessment;
}

export interface ProductionIngestionWriteResult {
  readonly status: ProductionIngestionWriteStatus;
  readonly completed_stages: readonly ProductionIngestionWriteStage[];
  readonly source_occurrence_ids: readonly string[];
  readonly source_occurrence_version_ids: readonly string[];
  readonly canonical_opportunity_ids: readonly string[];
  readonly opportunity_version_ids: readonly string[];
  readonly requirement_fact_ids: readonly string[];
  readonly eligibility_assessment_id: string | null;
  readonly eligibility_status:
    | "PERSISTED"
    | "NOT_ASSESSED_INSUFFICIENT_REQUIREMENT_EVIDENCE";
}

export class ProductionIngestionWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionIngestionWriteError";
  }
}
