# Phase 0 Baseline

## Git baseline

- Production baseline: `272385e883f4d88c68221e51d70bc63d08ad8e90`.
- Development branch: `codex/ingestion-foundation`.
- The production application, database schema, synchronization pipeline, and deployment configuration remain unchanged.

## Legacy archive

The pre-Phase 0 working files are preserved outside the repository at:

`C:\Users\HUAWEI\Documents\Codex\2026-08-10\2027-job-radar-legacy-archive\phase-0-2026-09-01`

The archive contains the original directory layout, SHA-256 inventory, dirty source snapshots, and `zhaopin-prototype.patch`.

## File classification

| Original content | Classification | Disposition |
| --- | --- | --- |
| Modified `lib/crawler.ts` | EXPERIMENT / MIGRATE | Preserved as a dirty snapshot and patch; generic concepts may be migrated only through new ingestion contracts. |
| Modified `lib/source-catalog.ts` | EXPERIMENT | Preserved as legacy source configuration; it is not the future Source Registry. |
| `work/debug-zhaopin*.ts` | EXPERIMENT | Exact copies are retained under `experiments/zhaopin-campus/legacy-scripts/`. |
| `work/inspect-zhaopin-cut.ts` | EXPERIMENT | Exact copy retained with the other platform experiments. |
| `work/zhaopin-cities.json` | MIGRATE candidate | Archived intact; a small deterministic subset may become a fixture in Phase 1. |
| `work/sou-zhaopin.html` | MIGRATE candidate | Archived intact; review licensing and minimize before creating a fixture. |
| `work/xiaoyuan-*.html` | ARCHIVE / MIGRATE candidate | Archived intact; useful for login-wall and dynamic-page behavior tests. |
| `work/xiaoyuan-*.js` | ARCHIVE | Third-party frontend bundles are retained outside Git and are not production source. |
| `work/jina-*.txt` | ARCHIVE / fixture candidate | Archived intact for parser research. |
| `work/baidu-*.html` | UNKNOWN | Archived without deletion because their future evidentiary value is uncertain. |
| `work/build_job_database.mjs` | ARCHIVE | Historical spreadsheet generator, outside the current website ingestion mainline. |
| `work/*plan.md` | ARCHIVE | Historical spreadsheet implementation plan. |
| Old source ZIP in `outputs/` | ARCHIVE | Confirmed as an older source snapshot and moved outside the repository. |

No legacy file was classified as safe to delete during Phase 0.

## Old crawler boundaries

### Generic collection concepts

- Text cleanup and structured HTML extraction.
- Relative-to-absolute URL resolution.
- HTTP HTML and JSON transport helpers.
- Date parsing, candidate extraction, and in-memory candidate deduplication.

These are migration candidates, not reusable contracts. They currently do not preserve raw responses, request metadata, or transport evidence.

### Platform experiment

- Zhaopin area tree and search response types.
- Campus search POST requests.
- Region recursion, page-cap handling, and Zhaopin candidate mapping.
- Aggregator-specific reader fallback behavior.

These remain one recruitment-platform experiment and must not define the new architecture.

### Legal-job filtering

- 2027 recruitment-year matching.
- Law/legal-major keyword matching.
- Generic-title and direct-job-link checks.

The rules are candidates for the future Requirement Parser, Evidence model, and Eligibility Engine. They must not remain embedded in transport code.

### Organization classification

- Unit-name inference.
- Unit-type inference.
- Industry and system defaults supplied by the old source catalog.

These belong in future organization normalization and classification modules.

### Old Job model coupling

- Deterministic legacy `job_id` generation.
- Direct conversion from candidates to the legacy `Job` type.
- Match scoring and publication-oriented fields during collection.
- `crawlSource()` returning final website jobs rather than raw or source records.

This coupling must not be extended. Phase 1 will build the new pipeline beside it.

## Source catalog boundary

`lib/source-catalog.ts` remains a production-era configuration list. No new source may be added there during foundation development. Future sources must be represented through Recruitment Endpoint and Source Registry records.
