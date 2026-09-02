# Tests

Formal ingestion unit, contract, fixture, integration, deduplication, versioning, empty-result, eligibility, persistence, migration, and architecture tests live here.

Experimental scripts do not count as tests.

Every test suite must install the shared network guard before exercising application code. Network access in tests is a failure, not a fallback.

Run `pnpm test:phase1` for the complete offline Phase 1 suite or `pnpm ci:phase1` to include the production TypeScript regression check.
