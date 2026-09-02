# Phase 2 Preview Persistence Exercise

## Scope

P2-02 proves that frozen P1 Domain concepts map to a PostgreSQL-oriented, isolated Preview schema without changing P1, Shadow Persistence, or P2-01. It is local/Preview-only: no production business data, connection, bucket, or runtime service is allowed.

`SqliteShadowPersistence` stays the P1-11 test implementation and is not promoted to a PostgreSQL repository. The Preview migration maps Organization, SourceDefinition, RecruitmentEndpoint, RawBlob metadata, Snapshot, ExtractedRecord, SourceOccurrence, SourceOccurrenceVersion, CanonicalOpportunity, OpportunityVersion, RequirementFact, RequirementEvidence, CandidateProfile, and EligibilityAssessment with relationship tables.

## Raw, RLS, and Recovery

Raw bytes are private content-addressed objects, not database columns. Database metadata stores only the SHA-256, MIME, length, creation timestamp, and `raw/sha256/<first-two>/<sha256>` object path. Successful Snapshots link to a RawBlob; failed Snapshots may have none. Metadata rejects credentials, cookies, authorization values, tokens, passwords, secrets, session IDs, and API keys.

The migration enables RLS for all internal tables. `preview_ingestion_service` has internal read/insert access; `preview_ingestion_read_api` has only the public opportunity projection. `PUBLIC` receives no schema/table/view access, including RawBlob, Snapshot, ExtractedRecord, and internal error metadata.

The paired migrations provide clean-migration, rollback, and replay contracts. With no local PostgreSQL executable, server, Docker, or in-memory PostgreSQL dependency, tests statically validate PostgreSQL syntax contracts and use an isolated in-memory SQLite simulation for equivalent transaction, foreign-key, unique, append-only, and replay checks. This is not PostgreSQL execution proof. Recovery derives a deterministic manifest from migration IDs and RawBlob hashes, then restores an empty local/Preview database, replays migrations, verifies constraints and private hashes, and reconciles Snapshot links.

## Exclusions

No Source Run, run observation, run assessment, missing streak, lifecycle, scheduler, transport, Adapter, real network, API, or website object is persisted. Source Run persistence first belongs to P2-06. No production `supabase/` path, Storage, or P1/P2-01 file is changed.
