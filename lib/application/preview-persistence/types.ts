export const PREVIEW_PERSISTENCE_ENVIRONMENTS = ["LOCAL", "PREVIEW"] as const;

export type PreviewPersistenceEnvironment =
  (typeof PREVIEW_PERSISTENCE_ENVIRONMENTS)[number];

export const PREVIEW_PERSISTENCE_TABLES = {
  organizations: "preview_ingestion.organizations",
  source_definitions: "preview_ingestion.source_definitions",
  recruitment_endpoints: "preview_ingestion.recruitment_endpoints",
  raw_blobs: "preview_ingestion.raw_blobs",
  snapshots: "preview_ingestion.snapshots",
  extracted_records: "preview_ingestion.extracted_records",
  source_occurrences: "preview_ingestion.source_occurrences",
  source_occurrence_versions: "preview_ingestion.source_occurrence_versions",
  canonical_opportunities: "preview_ingestion.canonical_opportunities",
  opportunity_versions: "preview_ingestion.opportunity_versions",
  opportunity_version_sources: "preview_ingestion.opportunity_version_sources",
  requirement_facts: "preview_ingestion.requirement_facts",
  requirement_evidence: "preview_ingestion.requirement_evidence",
  candidate_profiles: "preview_ingestion.candidate_profiles",
  eligibility_assessments: "preview_ingestion.eligibility_assessments",
  eligibility_assessment_facts: "preview_ingestion.eligibility_assessment_facts",
  eligibility_assessment_evidence: "preview_ingestion.eligibility_assessment_evidence"
} as const;

export type PreviewPersistenceTable =
  (typeof PREVIEW_PERSISTENCE_TABLES)[keyof typeof PREVIEW_PERSISTENCE_TABLES];

export interface PreviewPersistenceContract {
  readonly environment: PreviewPersistenceEnvironment;
  readonly production_data_allowed: false;
  readonly production_connection_allowed: false;
  readonly source_run_persistence_allowed: false;
  readonly tables: readonly PreviewPersistenceTable[];
}

export const PREVIEW_PERSISTENCE_CONTRACT: PreviewPersistenceContract = {
  environment: "PREVIEW",
  production_data_allowed: false,
  production_connection_allowed: false,
  source_run_persistence_allowed: false,
  tables: Object.values(PREVIEW_PERSISTENCE_TABLES)
};
