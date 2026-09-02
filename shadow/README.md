# Shadow Persistence

This directory contains local/test-only migration assets for P1-11. It is not a Supabase migration path and must never be applied to production.

`migrations/001_shadow_persistence.sql` targets an in-memory SQLite database used only by the P1-11 Migration Test and Persistence Contract Test. Every business table uses the `shadow_` prefix. The migration creates no legacy `sources`, `jobs`, `applications`, or `sync_runs` table.

P1-10 Source Run and lifecycle-layer objects are intentionally absent. RawBlob, Snapshot, ExtractedRecord, and LifecycleEvent are also outside the approved P1-11 repository scope; their identifiers are retained as external trace references where a persisted entity requires them.
