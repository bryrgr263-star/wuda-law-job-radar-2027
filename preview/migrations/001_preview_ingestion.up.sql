-- P2-02 local/Preview-only PostgreSQL migration. Never apply to production.
BEGIN;
CREATE SCHEMA IF NOT EXISTS preview_ingestion;

CREATE TABLE IF NOT EXISTS preview_ingestion.schema_migrations (migration_id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO preview_ingestion.schema_migrations (migration_id) VALUES ('001_preview_ingestion') ON CONFLICT (migration_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS preview_ingestion.organizations (organization_id TEXT PRIMARY KEY, payload_json JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS preview_ingestion.source_definitions (source_definition_id TEXT PRIMARY KEY, publisher_organization_id TEXT NOT NULL REFERENCES preview_ingestion.organizations (organization_id), payload_json JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS preview_ingestion.recruitment_endpoints (recruitment_endpoint_id TEXT PRIMARY KEY, source_definition_id TEXT NOT NULL REFERENCES preview_ingestion.source_definitions (source_definition_id), payload_json JSONB NOT NULL, UNIQUE (recruitment_endpoint_id, source_definition_id));

-- The raw response body is private storage, never a database column.
CREATE TABLE IF NOT EXISTS preview_ingestion.raw_blobs (raw_blob_id TEXT PRIMARY KEY, sha256 CHAR(64) NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'), mime_type TEXT NOT NULL, byte_length BIGINT NOT NULL CHECK (byte_length >= 0), object_path TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS preview_ingestion.snapshots (snapshot_id TEXT PRIMARY KEY, recruitment_endpoint_id TEXT NOT NULL REFERENCES preview_ingestion.recruitment_endpoints (recruitment_endpoint_id), raw_blob_id TEXT REFERENCES preview_ingestion.raw_blobs (raw_blob_id), transport_status TEXT NOT NULL CHECK (transport_status IN ('SUCCESS', 'FAILED')), content_sha256 CHAR(64), content_length BIGINT, request_metadata JSONB NOT NULL, response_metadata JSONB NOT NULL, observed_at TIMESTAMPTZ NOT NULL, CHECK ((transport_status = 'SUCCESS' AND raw_blob_id IS NOT NULL AND content_sha256 IS NOT NULL AND content_length IS NOT NULL) OR transport_status = 'FAILED'));
CREATE TABLE IF NOT EXISTS preview_ingestion.extracted_records (extracted_record_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES preview_ingestion.snapshots (snapshot_id), payload_json JSONB NOT NULL);

CREATE TABLE IF NOT EXISTS preview_ingestion.source_occurrences (source_occurrence_id TEXT PRIMARY KEY, source_definition_id TEXT NOT NULL REFERENCES preview_ingestion.source_definitions (source_definition_id), recruitment_endpoint_id TEXT NOT NULL, identity_hash TEXT NOT NULL UNIQUE, payload_json JSONB NOT NULL, FOREIGN KEY (recruitment_endpoint_id, source_definition_id) REFERENCES preview_ingestion.recruitment_endpoints (recruitment_endpoint_id, source_definition_id));
CREATE TABLE IF NOT EXISTS preview_ingestion.source_occurrence_versions (source_occurrence_version_id TEXT PRIMARY KEY, source_occurrence_id TEXT NOT NULL REFERENCES preview_ingestion.source_occurrences (source_occurrence_id), extracted_record_id TEXT NOT NULL REFERENCES preview_ingestion.extracted_records (extracted_record_id), revision INTEGER NOT NULL CHECK (revision > 0), semantic_hash TEXT NOT NULL, payload_json JSONB NOT NULL, UNIQUE (source_occurrence_id, revision), UNIQUE (source_occurrence_id, semantic_hash));
CREATE TABLE IF NOT EXISTS preview_ingestion.canonical_opportunities (canonical_opportunity_id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL UNIQUE, payload_json JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS preview_ingestion.opportunity_versions (opportunity_version_id TEXT PRIMARY KEY, canonical_opportunity_id TEXT NOT NULL REFERENCES preview_ingestion.canonical_opportunities (canonical_opportunity_id), revision INTEGER NOT NULL CHECK (revision > 0), semantic_hash TEXT NOT NULL, payload_json JSONB NOT NULL, UNIQUE (canonical_opportunity_id, revision), UNIQUE (canonical_opportunity_id, semantic_hash));
CREATE TABLE IF NOT EXISTS preview_ingestion.opportunity_version_sources (opportunity_version_id TEXT NOT NULL REFERENCES preview_ingestion.opportunity_versions (opportunity_version_id), source_occurrence_version_id TEXT NOT NULL REFERENCES preview_ingestion.source_occurrence_versions (source_occurrence_version_id), source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 0), PRIMARY KEY (opportunity_version_id, source_occurrence_version_id), UNIQUE (opportunity_version_id, source_ordinal));

CREATE TABLE IF NOT EXISTS preview_ingestion.requirement_facts (requirement_fact_id TEXT PRIMARY KEY, opportunity_version_id TEXT NOT NULL REFERENCES preview_ingestion.opportunity_versions (opportunity_version_id), logic_group_id TEXT NOT NULL, payload_json JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS preview_ingestion.requirement_evidence (requirement_evidence_id TEXT PRIMARY KEY, requirement_fact_id TEXT NOT NULL REFERENCES preview_ingestion.requirement_facts (requirement_fact_id), snapshot_id TEXT NOT NULL REFERENCES preview_ingestion.snapshots (snapshot_id), payload_json JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS preview_ingestion.candidate_profiles (candidate_profile_id TEXT PRIMARY KEY, payload_json JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS preview_ingestion.eligibility_assessments (eligibility_assessment_id TEXT PRIMARY KEY, candidate_profile_id TEXT NOT NULL REFERENCES preview_ingestion.candidate_profiles (candidate_profile_id), opportunity_version_id TEXT NOT NULL REFERENCES preview_ingestion.opportunity_versions (opportunity_version_id), result TEXT NOT NULL CHECK (result IN ('ELIGIBLE', 'LIKELY_ELIGIBLE', 'NEEDS_REVIEW', 'LIKELY_INELIGIBLE', 'INELIGIBLE')), payload_json JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS preview_ingestion.eligibility_assessment_facts (eligibility_assessment_id TEXT NOT NULL REFERENCES preview_ingestion.eligibility_assessments (eligibility_assessment_id), requirement_fact_id TEXT NOT NULL REFERENCES preview_ingestion.requirement_facts (requirement_fact_id), fact_ordinal INTEGER NOT NULL CHECK (fact_ordinal >= 0), PRIMARY KEY (eligibility_assessment_id, requirement_fact_id), UNIQUE (eligibility_assessment_id, fact_ordinal));
CREATE TABLE IF NOT EXISTS preview_ingestion.eligibility_assessment_evidence (eligibility_assessment_id TEXT NOT NULL REFERENCES preview_ingestion.eligibility_assessments (eligibility_assessment_id), requirement_evidence_id TEXT NOT NULL REFERENCES preview_ingestion.requirement_evidence (requirement_evidence_id), evidence_ordinal INTEGER NOT NULL CHECK (evidence_ordinal >= 0), PRIMARY KEY (eligibility_assessment_id, requirement_evidence_id), UNIQUE (eligibility_assessment_id, evidence_ordinal));

CREATE OR REPLACE FUNCTION preview_ingestion.reject_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END; $$;
CREATE OR REPLACE FUNCTION preview_ingestion.enable_append_only(target_table REGCLASS) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN EXECUTE format('DROP TRIGGER IF EXISTS preview_append_only ON %s', target_table); EXECUTE format('CREATE TRIGGER preview_append_only BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION preview_ingestion.reject_mutation()', target_table); END; $$;
SELECT preview_ingestion.enable_append_only(table_name::REGCLASS) FROM (VALUES
  ('preview_ingestion.organizations'), ('preview_ingestion.source_definitions'), ('preview_ingestion.recruitment_endpoints'), ('preview_ingestion.raw_blobs'), ('preview_ingestion.snapshots'), ('preview_ingestion.extracted_records'), ('preview_ingestion.source_occurrences'), ('preview_ingestion.source_occurrence_versions'), ('preview_ingestion.canonical_opportunities'), ('preview_ingestion.opportunity_versions'), ('preview_ingestion.requirement_facts'), ('preview_ingestion.requirement_evidence'), ('preview_ingestion.candidate_profiles'), ('preview_ingestion.eligibility_assessments')
) AS append_only_tables(table_name);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'preview_ingestion_service') THEN CREATE ROLE preview_ingestion_service NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'preview_ingestion_read_api') THEN CREATE ROLE preview_ingestion_read_api NOLOGIN; END IF;
END; $$;

DO $$ DECLARE target_table REGCLASS; BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'preview_ingestion.organizations'::REGCLASS, 'preview_ingestion.source_definitions'::REGCLASS, 'preview_ingestion.recruitment_endpoints'::REGCLASS, 'preview_ingestion.raw_blobs'::REGCLASS, 'preview_ingestion.snapshots'::REGCLASS, 'preview_ingestion.extracted_records'::REGCLASS, 'preview_ingestion.source_occurrences'::REGCLASS, 'preview_ingestion.source_occurrence_versions'::REGCLASS, 'preview_ingestion.canonical_opportunities'::REGCLASS, 'preview_ingestion.opportunity_versions'::REGCLASS, 'preview_ingestion.opportunity_version_sources'::REGCLASS, 'preview_ingestion.requirement_facts'::REGCLASS, 'preview_ingestion.requirement_evidence'::REGCLASS, 'preview_ingestion.candidate_profiles'::REGCLASS, 'preview_ingestion.eligibility_assessments'::REGCLASS, 'preview_ingestion.eligibility_assessment_facts'::REGCLASS, 'preview_ingestion.eligibility_assessment_evidence'::REGCLASS
  ] LOOP EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table); EXECUTE format('CREATE POLICY preview_service_full_access ON %s TO preview_ingestion_service USING (true) WITH CHECK (true)', target_table); END LOOP;
END; $$;

CREATE VIEW preview_ingestion.public_opportunity_projection WITH (security_barrier = true) AS SELECT opportunity_version_id, canonical_opportunity_id, payload_json FROM preview_ingestion.opportunity_versions;
REVOKE ALL ON SCHEMA preview_ingestion FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA preview_ingestion FROM PUBLIC;
REVOKE ALL ON preview_ingestion.public_opportunity_projection FROM PUBLIC;
GRANT USAGE ON SCHEMA preview_ingestion TO preview_ingestion_service, preview_ingestion_read_api;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA preview_ingestion TO preview_ingestion_service;
GRANT SELECT ON preview_ingestion.public_opportunity_projection TO preview_ingestion_read_api;
COMMIT;
