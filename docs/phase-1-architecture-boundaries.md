# Phase 1 Architecture Boundaries

## Scope

Phase 1 builds a source-independent, fixture-driven ingestion foundation under `lib/ingestion/`. It does not connect to real recruitment sources and does not replace the production pipeline.

## Forbidden dependencies

No TypeScript module under `lib/ingestion/` may import:

- `lib/types.ts`
- `lib/crawler.ts`
- `lib/source-catalog.ts`
- `lib/sync.ts`
- `lib/scoring.ts`

The new core must not depend on the legacy `Job`, `CrawlSource`, `NonLawRule`, or `match_score` model.

## Layer direction

The Phase 1 layers are created only when their corresponding P1 task begins. Their allowed dependencies are:

| Layer | May depend on |
| --- | --- |
| `domain` | none |
| `registry` | `domain` |
| `transport` | `domain` |
| `raw` | `domain` |
| `adapters` | `domain`, `registry`, `transport`, `raw` |
| `normalization` | `domain` |
| `canonicalization` | `domain` |
| `requirements` | `domain` |
| `eligibility` | `domain` |
| `lifecycle` | `domain` |
| `persistence` | `domain` |
| `pipeline` | all Phase 1 layers |

A layer may import itself. Reverse imports are forbidden. The root `lib/ingestion/index.ts` is a public export boundary and may export completed Phase 1 modules.

## Legacy production isolation

The following production files must not import `lib/ingestion/` during Phase 1:

- `app/page.tsx`
- `app/api/jobs/route.ts`
- `components/job-board.tsx`
- `lib/jobs.ts`
- `lib/crawler.ts`
- `lib/source-catalog.ts`
- `lib/scoring.ts`
- `lib/sync.ts`
- `scripts/export-static-mirror.ts`
- `scripts/sync-jobs.ts`

Projection into the current website belongs to a later phase.

## Test boundary

Formal tests live under `tests/`. Tests must use fixtures and must deny network access by default. Source-specific research remains under `experiments/` and cannot be imported into production code.

## Source Registry boundary

The in-memory Source Registry records `Organization → SourceDefinition → RecruitmentEndpoint → adapter_key`. It validates identity, references, source-neutral endpoint configuration, and adapter-key compatibility. It does not store opportunities, execute adapters, access networks, evaluate eligibility, or contain source-specific collection parameters.

Every SourceDefinition has one publisher Organization. An Organization may publish multiple SourceDefinitions, and each SourceDefinition may expose multiple RecruitmentEndpoints. Endpoint request settings are limited to generic HTTP methods and bounded collection controls. Fixture and file locators do not require an HTTP method.

## Transport and Raw boundary

Phase 1 transport accepts source-neutral requests and returns raw responses without recruitment parsing. `FixtureTransport` is the only implementation and accepts only `fixture://` locators. It performs no network operations.

A RawBlob is a content object identified by SHA-256 over exact response bytes. It has no Organization, SourceDefinition, Endpoint, request, or Snapshot ownership. The in-memory RawBlob repository is append-only, deduplicates identical hashes, and returns defensive byte copies.

A Snapshot is an observation event for one RecruitmentEndpoint. Successful Snapshots reference a RawBlob and carry the same content hash and length. Failed Snapshots have no artificial RawBlob or content hash. Persisted request and response metadata exclude credentials, authentication material, cookies, tokens, passwords, and session identifiers.

## Adapter extraction boundary

An ExtractedRecord is a source-level observation extracted from one Snapshot. It preserves raw source text, source identity candidates, source-record location, and links back to the Snapshot. It is not an OpportunityContent, CanonicalOpportunity, RequirementFact, or EligibilityAssessment.

ExtractedRecord may preserve source-private details only under namespaced `adapter_metadata.<adapter_key>`. Adapter metadata is for debugging and traceability. Normalization, canonicalization, deduplication, requirement parsing, eligibility, and lifecycle logic must not read or depend on it.

The Phase 1 document fixture uses explicitly preprocessed UTF-8 text to exercise the common Adapter contract and document locator. It does not implement or claim production PDF parsing, OCR, or browser extraction capability.

## Requirement V2 boundary

P1 Requirement V2 preserves this inward dependency direction:

```text
source-neutral ExtractedRecord/Snapshot references
  -> RequirementEvidenceFragment
  -> RequirementObservation
  -> Requirement Fact/Evidence Set
  -> RequirementCompleteness Gate
  -> CompleteRequirementSet
  -> Eligibility Engine
```

The Requirement parser consumes only standard Evidence Fragments. It cannot import or inspect Adapter metadata, source-specific types, live-canary code, network clients, collection services, or file-format implementations. HTML and spreadsheet locators are represented by source-neutral Domain contracts; they do not create a dependency on an HTML or spreadsheet Adapter.

Eligibility accepts only a `CompleteRequirementSet`. It cannot accept independent Fact/Evidence subsets, execute the Requirement parser, or infer missing source clauses. A non-complete set creates no P1 assessment and remains `NOT_ASSESSED` at the application projection boundary.

The CR#8 contracts do not execute P2-10, access a real source, create real Requirement or Eligibility data, or modify any frozen P2 boundary.
