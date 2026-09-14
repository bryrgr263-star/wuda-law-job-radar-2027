# Legacy Product Asset Inventory

## Scope and decision

This inventory records the migration boundary between the existing product shell
and the new trusted ingestion truth. It does not authorize any change to legacy
production tables, synchronizers, crawler logic, API routes, or deployments.

The target read path is:

```text
PresentationDecision -> read-only presentation API -> reused existing Web UI
```

`PresentationDecision` does not exist yet. Until it is implemented and backed by
the trusted chain, the legacy public site remains legacy production and is not a
consumer of new truth.

## Classification rules

- **REUSE**: presentation-only code with no legacy business decision dependency.
- **MODIFY**: useful behavior whose data contract or embedded decision must be
  replaced before it can read the new API.
- **DETACH / MODIFY**: a useful asset entangled with `Job`, `jobs`, scoring,
  publication, or legacy realtime.
- **FREEZE / RETIRE**: legacy business logic that cannot participate in new
  truth. Retaining the file for legacy production is not permission to extend it.

## Inventory

| Asset | Current role | Legacy business logic | Classification | Required isolation/migration | Future source |
| --- | --- | --- | --- | --- | --- |
| `app/layout.tsx` | Next application shell and metadata | No recruitment decision | REUSE | Keep shell; revise product copy only when Presentation is live | Existing UI plus presentation API client |
| `app/page.tsx` | Legacy home composition | Calls legacy `getJobs()` | MODIFY | Replace only its data loader after cutover; retain page composition | Read-only Presentation API |
| `app/globals.css` | Design tokens, responsive layout, cards, filters, modal styling | Some selectors describe score/profile/rule content | REUSE / MODIFY | Reuse tokens/layout/card/detail styles; remove score and candidate-profile selectors | Existing CSS, presentation DTO |
| `components/job-board.tsx` | Job list, local search/filtering, card, modal, official-link UI | Legacy `Job`; Supabase realtime; `match_score`; `non_law_rule`; profile-specific content | DETACH / MODIFY | Preserve generic list/card/modal/search/open-status/link interactions. Remove realtime, score UI, non-law display, profile claims and business filtering | PresentationDecision read model |
| `lib/types.ts` | Legacy `Job`, `CrawlSource`, `NonLawRule` model | Defines `match_score`, `non_law_rule`, publication-shaped data | FREEZE / RETIRE | Do not extend or map trusted artifacts into this type | New presentation DTO |
| `lib/jobs.ts` | Reads `public.jobs` | Filters `is_published`, orders `match_score` | FREEZE / RETIRE | Do not call from the migrated page | Presentation API client |
| `app/api/jobs/route.ts` | Legacy public jobs API | Delegates to `getJobs()` | FREEZE / RETIRE | Keep only during legacy transition; new route must be separate and read-only | Presentation API route |
| `lib/supabase/public.ts` | Browser Supabase client | Used by legacy realtime path | DETACH / MODIFY | Do not use for decisions/status changes | Read-only API |
| `scripts/export-static-mirror.ts` | Generates GitHub Pages legacy mirror | Reads `jobs.is_published`; ranks/filters by score; renders non-law rule | FREEZE / RETIRE | Not a migration vehicle | Future immutable presentation export, if required |
| `public-site/` | Generated legacy static output when present | Materializes legacy mirror result | RETIRE as new-truth source | Do not edit as a migration shortcut | Future generated presentation output |
| `lib/demo-data.ts` | Legacy `Job` demonstrations | Carries score/non-law fields and external examples | FREEZE / RETIRE | Do not use as trusted fixture or presentation seed | Explicit synthetic fixtures |
| `app/preview/*` | P2-08 diagnostic preview UI | Diagnostic, not PresentationDecision | REUSE / MODIFY | Reuse provenance/detail patterns only; do not promote to formal listing | Presentation API after contract review |
| `lib/p2-08-preview/*` | Preview rendering/query adapter | P2-08 diagnostic semantics | REUSE / MODIFY | Preserve diagnostic boundary | Presentation adapter may reuse mechanics, not policy |
| `app/api/ingestion/v1/[...segments]/route.ts` | Read-only ingestion preview endpoint | No formal presentation gate | REUSE / MODIFY | Keep distinct; formal public listing requires a PresentationDecision-only projection | Presentation read model |
| `lib/read-only-api/*` | Read-only query/projection/runtime composition | No formal presentation gate | REUSE / MODIFY | Reuse transport/provenance/query infrastructure after presentation projection exists | PresentationDecision projection |
| `app/api/cron/sync/route.ts` | Legacy sync trigger | Invokes old sync | FREEZE / RETIRE | No new-truth import/delegation | None; disable/isolate during cutover |
| `.github/workflows/sync-jobs.yml` | Legacy scheduled sync and Pages deploy | Runs old sync and old static mirror | FREEZE / RETIRE | Do not repurpose for new ingestion; isolate/disable before cutover | Separate approved deployment workflow |
| `supabase/schedule.sql` | Optional legacy pg_cron trigger | Invokes old sync route | FREEZE / RETIRE | Verify and disable/isolate before cutover | No current replacement |
| `lib/crawler.ts`, `lib/scoring.ts`, `lib/sync.ts`, `lib/source-catalog.ts` | Legacy discovery, filtering, scoring, publication, synchronizing | Entirely legacy business logic | FREEZE / RETIRE | No imports from new truth and no migration of their rules | Trusted ingestion modules only |

## UI interaction disposition

| Existing interaction | Disposition | New semantics |
| --- | --- | --- |
| Keyword search | REUSE / MODIFY | Query only PresentationDecision-authorized records; never assess relevance or eligibility in the browser |
| Unit/location/category filters | REUSE / MODIFY | Filter display fields supplied by the presentation DTO |
| Open/closed filter | REUSE / MODIFY | Filter explicit presentation-safe application state; it must not change a decision |
| Display ordering | REUSE / MODIFY | Sort only authorized records using supplied ordering fields; remove `match_score` ordering |
| Score threshold/stars | RETIRE | `match_score` is not part of new truth |
| `non_law_rule` tag/detail | RETIRE | Render any new status only from trusted presentation fields |
| Candidate profile card/recommendation copy | RETIRE / redesign later | Presentation cannot use CandidateProfile as a visibility rule |
| Job card/modal/detail layout | REUSE / MODIFY | Bind to a presentation DTO with provenance and official links |
| Official announcement/application links | REUSE | Render only links supplied by the trusted presentation read model |
| Supabase realtime refresh | DETACH | No direct browser subscription to legacy `jobs` |

## Migration boundary

1. Commit and version the trusted chain without changing legacy production.
2. Introduce one immutable `PresentationPolicy -> PresentationDecision` boundary.
3. Add a PresentationDecision-only read projection/API; it must not expose an
   unrestricted canonical-opportunity list as the formal public listing.
4. Define a presentation DTO with display fields, official links, provenance,
   decision state, and safe display ordering fields.
5. Replace `app/page.tsx`'s legacy loader and detach the legacy business parts
   of `JobBoard`; retain its product shell and generic interactions.
6. After parallel read verification, retire legacy public API/mirror as formal
   truth and isolate old automatic writers.

No step permits writing trusted artifacts to `jobs`, `sources`, or `sync_runs`,
or treating `jobs.is_published` as a PresentationDecision.

## Explicit non-goals

- No second website or parallel formal public product.
- No migration of `match_score`, `non_law_rule`, legacy candidate logic, or old
  crawler filters into UI, API, or PresentationPolicy.
- No conversion of P2-08 diagnostic preview into the formal Web listing.
- No direct browser access to raw trusted tables as a substitute for a
  PresentationDecision API.
