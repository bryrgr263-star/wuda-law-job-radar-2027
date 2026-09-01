# Ingestion Core Boundary

`lib/ingestion/` is the only Phase 1 implementation boundary for the source-independent recruitment ingestion foundation.

Code in this directory must not import the legacy crawler, source catalog, synchronization pipeline, scoring module, or legacy `Job` and `CrawlSource` types. It must not write to the production `jobs`, `sources`, or `sync_runs` tables.

The permitted dependency direction is documented in `docs/phase-1-architecture-boundaries.md` and enforced by `tests/architecture/ingestion-boundary.test.ts`.
