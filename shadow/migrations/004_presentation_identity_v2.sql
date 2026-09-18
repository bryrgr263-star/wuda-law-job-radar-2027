PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

INSERT OR IGNORE INTO shadow_schema_migrations (migration_id, applied_at)
VALUES ('004_presentation_identity_v2', 'fixture-controlled');

CREATE TABLE IF NOT EXISTS shadow_presentation_v2_migration_audits (
  migration_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('PRODUCTION', 'SYNTHETIC_TEST')),
  position_id TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE(scope, position_id)
);
CREATE TRIGGER IF NOT EXISTS shadow_presentation_v2_migration_audits_no_update
  BEFORE UPDATE ON shadow_presentation_v2_migration_audits BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS shadow_presentation_v2_migration_audits_no_delete
  BEFORE DELETE ON shadow_presentation_v2_migration_audits BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE IF NOT EXISTS shadow_presentation_v2_decisions (
  presentation_decision_id TEXT PRIMARY KEY,
  opportunity_candidate_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('PRODUCTION', 'SYNTHETIC_TEST')),
  record_kind TEXT NOT NULL CHECK (record_kind IN ('POSITION_PRESENTATION', 'UNBOUND_RETAINED_OUTCOME')),
  position_id TEXT,
  revision INTEGER,
  supersedes_presentation_decision_id TEXT,
  semantic_hash TEXT,
  projection_version TEXT,
  integrity_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  CHECK ((record_kind = 'POSITION_PRESENTATION' AND position_id IS NOT NULL AND revision IS NOT NULL AND revision > 0
    AND semantic_hash IS NOT NULL AND projection_version IS NOT NULL AND projection_version = 'presentation-semantic-projection/2.0.0')
    OR (record_kind = 'UNBOUND_RETAINED_OUTCOME' AND position_id IS NULL AND revision IS NULL
      AND supersedes_presentation_decision_id IS NULL AND semantic_hash IS NULL AND projection_version IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS shadow_presentation_v2_subject_revision
  ON shadow_presentation_v2_decisions(scope, position_id, revision)
  WHERE record_kind = 'POSITION_PRESENTATION';

CREATE TABLE IF NOT EXISTS shadow_presentation_v2_read_models (
  presentation_read_model_id TEXT PRIMARY KEY,
  presentation_decision_id TEXT NOT NULL UNIQUE REFERENCES shadow_presentation_v2_decisions(presentation_decision_id),
  scope TEXT NOT NULL CHECK (scope IN ('PRODUCTION', 'SYNTHETIC_TEST')),
  position_id TEXT,
  decision_revision INTEGER,
  integrity_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  CHECK ((position_id IS NULL AND decision_revision IS NULL)
    OR (position_id IS NOT NULL AND decision_revision IS NOT NULL AND decision_revision > 0))
);

CREATE TRIGGER IF NOT EXISTS shadow_presentation_v2_decisions_no_update
  BEFORE UPDATE ON shadow_presentation_v2_decisions BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS shadow_presentation_v2_decisions_no_delete
  BEFORE DELETE ON shadow_presentation_v2_decisions BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS shadow_presentation_v2_read_models_no_update
  BEFORE UPDATE ON shadow_presentation_v2_read_models BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS shadow_presentation_v2_read_models_no_delete
  BEFORE DELETE ON shadow_presentation_v2_read_models BEGIN SELECT RAISE(ABORT, 'append-only'); END;

COMMIT;
