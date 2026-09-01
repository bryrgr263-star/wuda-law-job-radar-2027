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
