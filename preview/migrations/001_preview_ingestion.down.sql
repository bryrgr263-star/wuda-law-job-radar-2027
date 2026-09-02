-- P2-02 local/Preview-only rollback. Never apply to production.
BEGIN;
DROP SCHEMA IF EXISTS preview_ingestion CASCADE;
COMMIT;
