PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS shadow_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

INSERT OR IGNORE INTO shadow_schema_migrations (migration_id, applied_at)
VALUES ('001_shadow_persistence', 'fixture-controlled');

CREATE TABLE IF NOT EXISTS shadow_organizations (
  organization_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE IF NOT EXISTS shadow_source_definitions (
  source_definition_id TEXT PRIMARY KEY,
  publisher_organization_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (publisher_organization_id)
    REFERENCES shadow_organizations (organization_id)
);

CREATE TABLE IF NOT EXISTS shadow_recruitment_endpoints (
  recruitment_endpoint_id TEXT PRIMARY KEY,
  source_definition_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (recruitment_endpoint_id, source_definition_id),
  FOREIGN KEY (source_definition_id)
    REFERENCES shadow_source_definitions (source_definition_id)
);

CREATE TABLE IF NOT EXISTS shadow_source_occurrences (
  source_occurrence_id TEXT PRIMARY KEY,
  source_definition_id TEXT NOT NULL,
  recruitment_endpoint_id TEXT NOT NULL,
  identity_hash TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (source_definition_id)
    REFERENCES shadow_source_definitions (source_definition_id),
  FOREIGN KEY (recruitment_endpoint_id, source_definition_id)
    REFERENCES shadow_recruitment_endpoints (
      recruitment_endpoint_id,
      source_definition_id
    )
);

CREATE TABLE IF NOT EXISTS shadow_source_occurrence_versions (
  source_occurrence_version_id TEXT PRIMARY KEY,
  source_occurrence_id TEXT NOT NULL,
  extracted_record_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  semantic_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (source_occurrence_id, revision),
  UNIQUE (source_occurrence_id, semantic_hash),
  FOREIGN KEY (source_occurrence_id)
    REFERENCES shadow_source_occurrences (source_occurrence_id)
);

CREATE TABLE IF NOT EXISTS shadow_canonical_opportunities (
  canonical_opportunity_id TEXT PRIMARY KEY,
  identity_hash TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE IF NOT EXISTS shadow_opportunity_versions (
  opportunity_version_id TEXT PRIMARY KEY,
  canonical_opportunity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  semantic_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (canonical_opportunity_id, revision),
  UNIQUE (canonical_opportunity_id, semantic_hash),
  FOREIGN KEY (canonical_opportunity_id)
    REFERENCES shadow_canonical_opportunities (canonical_opportunity_id)
);

CREATE TABLE IF NOT EXISTS shadow_opportunity_version_sources (
  opportunity_version_id TEXT NOT NULL,
  source_occurrence_version_id TEXT NOT NULL,
  source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 0),
  PRIMARY KEY (opportunity_version_id, source_occurrence_version_id),
  UNIQUE (opportunity_version_id, source_ordinal),
  FOREIGN KEY (opportunity_version_id)
    REFERENCES shadow_opportunity_versions (opportunity_version_id),
  FOREIGN KEY (source_occurrence_version_id)
    REFERENCES shadow_source_occurrence_versions (
      source_occurrence_version_id
    )
);

CREATE TABLE IF NOT EXISTS shadow_requirement_facts (
  requirement_fact_id TEXT PRIMARY KEY,
  opportunity_version_id TEXT NOT NULL,
  logic_group_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (opportunity_version_id)
    REFERENCES shadow_opportunity_versions (opportunity_version_id)
);

CREATE TABLE IF NOT EXISTS shadow_requirement_evidence (
  requirement_evidence_id TEXT PRIMARY KEY,
  requirement_fact_id TEXT NOT NULL,
  external_snapshot_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (requirement_fact_id)
    REFERENCES shadow_requirement_facts (requirement_fact_id)
);

CREATE TABLE IF NOT EXISTS shadow_candidate_profiles (
  candidate_profile_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE IF NOT EXISTS shadow_eligibility_assessments (
  eligibility_assessment_id TEXT PRIMARY KEY,
  candidate_profile_id TEXT NOT NULL,
  opportunity_version_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN (
    'ELIGIBLE',
    'LIKELY_ELIGIBLE',
    'NEEDS_REVIEW',
    'LIKELY_INELIGIBLE',
    'INELIGIBLE'
  )),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (candidate_profile_id)
    REFERENCES shadow_candidate_profiles (candidate_profile_id),
  FOREIGN KEY (opportunity_version_id)
    REFERENCES shadow_opportunity_versions (opportunity_version_id)
);

CREATE TABLE IF NOT EXISTS shadow_eligibility_assessment_facts (
  eligibility_assessment_id TEXT NOT NULL,
  requirement_fact_id TEXT NOT NULL,
  fact_ordinal INTEGER NOT NULL CHECK (fact_ordinal >= 0),
  PRIMARY KEY (eligibility_assessment_id, requirement_fact_id),
  UNIQUE (eligibility_assessment_id, fact_ordinal),
  FOREIGN KEY (eligibility_assessment_id)
    REFERENCES shadow_eligibility_assessments (eligibility_assessment_id),
  FOREIGN KEY (requirement_fact_id)
    REFERENCES shadow_requirement_facts (requirement_fact_id)
);

CREATE TABLE IF NOT EXISTS shadow_eligibility_assessment_evidence (
  eligibility_assessment_id TEXT NOT NULL,
  requirement_evidence_id TEXT NOT NULL,
  evidence_ordinal INTEGER NOT NULL CHECK (evidence_ordinal >= 0),
  PRIMARY KEY (eligibility_assessment_id, requirement_evidence_id),
  UNIQUE (eligibility_assessment_id, evidence_ordinal),
  FOREIGN KEY (eligibility_assessment_id)
    REFERENCES shadow_eligibility_assessments (eligibility_assessment_id),
  FOREIGN KEY (requirement_evidence_id)
    REFERENCES shadow_requirement_evidence (requirement_evidence_id)
);

CREATE INDEX IF NOT EXISTS shadow_source_definitions_organization_idx
  ON shadow_source_definitions (publisher_organization_id);
CREATE INDEX IF NOT EXISTS shadow_endpoints_source_idx
  ON shadow_recruitment_endpoints (source_definition_id);
CREATE INDEX IF NOT EXISTS shadow_occurrences_endpoint_idx
  ON shadow_source_occurrences (
    source_definition_id,
    recruitment_endpoint_id
  );
CREATE INDEX IF NOT EXISTS shadow_occurrence_versions_occurrence_idx
  ON shadow_source_occurrence_versions (source_occurrence_id, revision);
CREATE INDEX IF NOT EXISTS shadow_opportunity_versions_canonical_idx
  ON shadow_opportunity_versions (canonical_opportunity_id, revision);
CREATE INDEX IF NOT EXISTS shadow_requirement_facts_opportunity_idx
  ON shadow_requirement_facts (opportunity_version_id);
CREATE INDEX IF NOT EXISTS shadow_requirement_evidence_fact_idx
  ON shadow_requirement_evidence (requirement_fact_id);
CREATE INDEX IF NOT EXISTS shadow_eligibility_candidate_idx
  ON shadow_eligibility_assessments (candidate_profile_id);
CREATE INDEX IF NOT EXISTS shadow_eligibility_opportunity_idx
  ON shadow_eligibility_assessments (opportunity_version_id);

CREATE TRIGGER IF NOT EXISTS shadow_organizations_no_update
BEFORE UPDATE ON shadow_organizations BEGIN
  SELECT RAISE(ABORT, 'shadow_organizations is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_organizations_no_delete
BEFORE DELETE ON shadow_organizations BEGIN
  SELECT RAISE(ABORT, 'shadow_organizations is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_source_definitions_no_update
BEFORE UPDATE ON shadow_source_definitions BEGIN
  SELECT RAISE(ABORT, 'shadow_source_definitions is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_source_definitions_no_delete
BEFORE DELETE ON shadow_source_definitions BEGIN
  SELECT RAISE(ABORT, 'shadow_source_definitions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_recruitment_endpoints_no_update
BEFORE UPDATE ON shadow_recruitment_endpoints BEGIN
  SELECT RAISE(ABORT, 'shadow_recruitment_endpoints is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_recruitment_endpoints_no_delete
BEFORE DELETE ON shadow_recruitment_endpoints BEGIN
  SELECT RAISE(ABORT, 'shadow_recruitment_endpoints is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_source_occurrences_no_update
BEFORE UPDATE ON shadow_source_occurrences BEGIN
  SELECT RAISE(ABORT, 'shadow_source_occurrences is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_source_occurrences_no_delete
BEFORE DELETE ON shadow_source_occurrences BEGIN
  SELECT RAISE(ABORT, 'shadow_source_occurrences is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_source_occurrence_versions_no_update
BEFORE UPDATE ON shadow_source_occurrence_versions BEGIN
  SELECT RAISE(ABORT, 'shadow_source_occurrence_versions is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_source_occurrence_versions_no_delete
BEFORE DELETE ON shadow_source_occurrence_versions BEGIN
  SELECT RAISE(ABORT, 'shadow_source_occurrence_versions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_canonical_opportunities_no_update
BEFORE UPDATE ON shadow_canonical_opportunities BEGIN
  SELECT RAISE(ABORT, 'shadow_canonical_opportunities is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_canonical_opportunities_no_delete
BEFORE DELETE ON shadow_canonical_opportunities BEGIN
  SELECT RAISE(ABORT, 'shadow_canonical_opportunities is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_opportunity_versions_no_update
BEFORE UPDATE ON shadow_opportunity_versions BEGIN
  SELECT RAISE(ABORT, 'shadow_opportunity_versions is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_opportunity_versions_no_delete
BEFORE DELETE ON shadow_opportunity_versions BEGIN
  SELECT RAISE(ABORT, 'shadow_opportunity_versions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_requirement_facts_no_update
BEFORE UPDATE ON shadow_requirement_facts BEGIN
  SELECT RAISE(ABORT, 'shadow_requirement_facts is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_requirement_facts_no_delete
BEFORE DELETE ON shadow_requirement_facts BEGIN
  SELECT RAISE(ABORT, 'shadow_requirement_facts is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_requirement_evidence_no_update
BEFORE UPDATE ON shadow_requirement_evidence BEGIN
  SELECT RAISE(ABORT, 'shadow_requirement_evidence is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_requirement_evidence_no_delete
BEFORE DELETE ON shadow_requirement_evidence BEGIN
  SELECT RAISE(ABORT, 'shadow_requirement_evidence is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_candidate_profiles_no_update
BEFORE UPDATE ON shadow_candidate_profiles BEGIN
  SELECT RAISE(ABORT, 'shadow_candidate_profiles is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_candidate_profiles_no_delete
BEFORE DELETE ON shadow_candidate_profiles BEGIN
  SELECT RAISE(ABORT, 'shadow_candidate_profiles is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_eligibility_assessments_no_update
BEFORE UPDATE ON shadow_eligibility_assessments BEGIN
  SELECT RAISE(ABORT, 'shadow_eligibility_assessments is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_eligibility_assessments_no_delete
BEFORE DELETE ON shadow_eligibility_assessments BEGIN
  SELECT RAISE(ABORT, 'shadow_eligibility_assessments is append-only');
END;

COMMIT;
