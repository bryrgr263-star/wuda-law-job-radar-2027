PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

INSERT OR IGNORE INTO shadow_schema_migrations (migration_id, applied_at)
VALUES ('003_presentation_read_model', 'fixture-controlled');

CREATE TABLE IF NOT EXISTS shadow_presentation_decisions (
  presentation_decision_id TEXT PRIMARY KEY,
  opportunity_candidate_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('DISPLAY', 'DISPLAY_WITH_REVIEW', 'EVIDENCE_BLOCKED', 'NOT_DISPLAY')),
  integrity_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (opportunity_candidate_id, revision),
  FOREIGN KEY (opportunity_candidate_id)
    REFERENCES shadow_opportunity_candidates (opportunity_candidate_id)
);

CREATE TABLE IF NOT EXISTS shadow_presentation_read_models (
  presentation_read_model_id TEXT PRIMARY KEY,
  presentation_decision_id TEXT NOT NULL UNIQUE,
  opportunity_candidate_id TEXT NOT NULL,
  presentation_status TEXT NOT NULL CHECK (presentation_status IN ('DISPLAY', 'DISPLAY_WITH_REVIEW', 'EVIDENCE_BLOCKED', 'NOT_DISPLAY')),
  updated_at TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (presentation_decision_id)
    REFERENCES shadow_presentation_decisions (presentation_decision_id),
  FOREIGN KEY (opportunity_candidate_id)
    REFERENCES shadow_opportunity_candidates (opportunity_candidate_id)
);

CREATE INDEX IF NOT EXISTS shadow_presentation_read_models_current_idx
  ON shadow_presentation_read_models (presentation_status, updated_at);

CREATE TRIGGER IF NOT EXISTS shadow_presentation_decisions_no_update
BEFORE UPDATE ON shadow_presentation_decisions BEGIN
  SELECT RAISE(ABORT, 'shadow_presentation_decisions is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_presentation_decisions_no_delete
BEFORE DELETE ON shadow_presentation_decisions BEGIN
  SELECT RAISE(ABORT, 'shadow_presentation_decisions is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_presentation_read_models_no_update
BEFORE UPDATE ON shadow_presentation_read_models BEGIN
  SELECT RAISE(ABORT, 'shadow_presentation_read_models is append-only');
END;
CREATE TRIGGER IF NOT EXISTS shadow_presentation_read_models_no_delete
BEFORE DELETE ON shadow_presentation_read_models BEGIN
  SELECT RAISE(ABORT, 'shadow_presentation_read_models is append-only');
END;

COMMIT;
