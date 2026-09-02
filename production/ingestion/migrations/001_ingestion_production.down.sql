-- P2-06 contract rollback. Deployment requires separate human authorization.
BEGIN;
DROP SCHEMA IF EXISTS ingestion_production CASCADE;
COMMIT;
