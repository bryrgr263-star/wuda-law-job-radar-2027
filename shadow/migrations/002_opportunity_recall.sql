PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

INSERT OR IGNORE INTO shadow_schema_migrations (migration_id, applied_at)
VALUES ('002_opportunity_recall', 'fixture-controlled');

CREATE TABLE IF NOT EXISTS shadow_opportunity_candidates (
  opportunity_candidate_id TEXT PRIMARY KEY,
  source_definition_id TEXT NOT NULL,
  recruitment_endpoint_id TEXT NOT NULL,
  discovery_locator TEXT NOT NULL,
  snapshot_id TEXT,
  extracted_record_id TEXT,
  source_occurrence_version_id TEXT,
  first_observed_at TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (source_definition_id)
    REFERENCES shadow_source_definitions (source_definition_id),
  FOREIGN KEY (recruitment_endpoint_id, source_definition_id)
    REFERENCES shadow_recruitment_endpoints (
      recruitment_endpoint_id,
      source_definition_id
    )
);

CREATE TABLE IF NOT EXISTS shadow_recall_dispositions (
  recall_disposition_id TEXT PRIMARY KEY,
  opportunity_candidate_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN (
    'RETAINED',
    'REVIEW_REQUIRED',
    'EVIDENCE_BLOCKED',
    'ACQUISITION_UNSUPPORTED',
    'PARSING_UNSUPPORTED',
    'IDENTITY_UNCERTAIN',
    'EXCLUDED'
  )),
  decided_at TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (opportunity_candidate_id, revision),
  FOREIGN KEY (opportunity_candidate_id)
    REFERENCES shadow_opportunity_candidates (opportunity_candidate_id)
);

CREATE INDEX IF NOT EXISTS shadow_recall_candidates_source_idx
  ON shadow_opportunity_candidates (
    source_definition_id,
    recruitment_endpoint_id,
    first_observed_at
  );
CREATE INDEX IF NOT EXISTS shadow_recall_dispositions_candidate_idx
  ON shadow_recall_dispositions (opportunity_candidate_id, revision);

CREATE TRIGGER IF NOT EXISTS shadow_opportunity_candidates_no_update
BEFORE UPDATE ON shadow_opportunity_candidates BEGIN
  SELECT RAISE(ABORT, 'shadow_opportunity_candidates is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_opportunity_candidates_no_delete
BEFORE DELETE ON shadow_opportunity_candidates BEGIN
  SELECT RAISE(ABORT, 'shadow_opportunity_candidates is append-only');
END;

CREATE TRIGGER IF NOT EXISTS shadow_recall_dispositions_no_update
BEFORE UPDATE ON shadow_recall_dispositions BEGIN
  SELECT RAISE(ABORT, 'shadow_recall_dispositions is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_recall_dispositions_no_delete
BEFORE DELETE ON shadow_recall_dispositions BEGIN
  SELECT RAISE(ABORT, 'shadow_recall_dispositions is append-only');
END;

COMMIT;
