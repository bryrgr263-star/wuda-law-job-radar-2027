# Phase 1 Verification

## P1-12 responsibility

P1-12 proves that the frozen P1-02 through P1-11 contracts compose into a repeatable, offline ingestion foundation. It adds tests and isolated CI only. It does not add a production pipeline, a real source Adapter, production persistence, deployment, or website integration.

## Verified path

The integration suite composes the existing public APIs directly:

```text
Source Registry
→ FixtureTransport
→ RawCaptureService
→ FixtureAdapter
→ InMemorySourceOccurrenceTracker
→ ConservativeCanonicalizer
→ DeterministicRequirementParser
→ DeterministicEligibilityEngine
→ SourceRunMissingGuard
→ SqliteShadowPersistence
```

No new production orchestration abstraction is introduced. Raw bytes are captured before Adapter extraction, and Requirement Evidence retains its Snapshot reference.

## Fixture coverage

- Official HTML Fixture
- Paginated third-party JSON Fixture
- Preprocessed government document Fixture
- Repeated identical collection
- Semantic content change
- Failed collection
- Suspicious empty collection
- UTF-8 Chinese original text and evidence traceability

All Fixture shapes enter the same `SourceOccurrence` and `SourceOccurrenceVersion` model.

## Commands

- `pnpm test:p1-12` runs the P1-12 integration and CI contract tests.
- `pnpm test:phase1` runs every P1-02 through P1-12 test file explicitly.
- `pnpm ci:phase1` runs the production TypeScript check and the complete Phase 1 suite.

Tests install the shared Network Guard. Any attempted `fetch`, HTTP, HTTPS, TCP, or TLS access fails the test.

## CI isolation

`.github/workflows/ingestion-foundation-ci.yml` runs only for pull requests or manual dispatch. It has read-only repository permission, receives no production secrets, performs no scheduled collection, writes no database, and deploys nothing.

The existing production sync and keepalive workflows remain unchanged.

## Explicit exclusions

- Shadow Persistence is not production persistence.
- No production Supabase Schema or migration is used.
- No real recruitment source is contacted.
- No website, user, application, recommendation, notification, or deployment behavior is added.
- No P1-02 through P1-11 contract or Architecture Boundary is changed.
