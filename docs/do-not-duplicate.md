# Do Not Duplicate

## Purpose

This is a development boundary for the ingestion foundation. Similar filenames
are not automatically duplicates; duplication occurs when two active paths own
the same business fact or final decision.

## Canonical new-truth chain

```text
RawBlob / Snapshot / SourceOccurrenceVersion
  -> OpportunityCandidate / RecallDisposition
  -> Position / PositionVersion / PBOV
  -> LegalEmploymentRelevanceAssessment
  -> RequirementProjection / RequirementSetVersion
  -> Candidate Evidence / PredicateResolution
  -> Trusted Position-Bound Eligibility
  -> PresentationPolicy / PresentationDecision (not implemented)
  -> read-only Web API
  -> reused Web UI
```

## Existing capabilities: extend, do not re-create

| Capability | Existing owner/boundary | Rule |
| --- | --- | --- |
| RawBlob / Snapshot | `lib/ingestion/raw/*` and isolated ingestion persistence | Do not create a second raw capture or hash model |
| SourceOccurrenceVersion | Normalization/materializer and trusted SOV registry | Do not substitute caller-created source versions |
| Canonical Opportunity | Canonicalization / position-bound opportunity tracking | Do not create a parallel canonical identity scheme |
| Source Composition | `position-bound-source-composition` | Do not bypass composition with attachment/index assumptions |
| Requirement projection / RSV | Approved projector and position-bound requirement-set pipeline | Do not add another parser or promote legacy RequirementSet |
| Candidate Evidence | Trusted candidate-evidence pipeline | Do not equate CandidateProfile with verified evidence |
| PredicateResolution | Position-bound predicate-resolution pipeline | Do not accept caller-supplied resolutions |
| Trusted Eligibility | Position-bound eligibility assessment pipeline | Sole intended production eligibility owner |
| Recall | `OpportunityCandidate` / `RecallDisposition` boundary | Do not re-introduce crawler filtering as Recall |
| Legal Employment Relevance | Relevance assessment pipeline | Do not use CandidateProfile, score, or keyword weights as an alternative |
| Presentation | `PresentationPolicy / PresentationDecision` | Not implemented; create this one boundary only |

## Explicit prohibitions

- Do not build another crawler business-filter pipeline, Recall, Relevance,
  Requirement parser, RequirementSetVersion producer, or production Eligibility engine.
- Do not restore or replace `match_score`, `non_law_rule`, or keyword-weight scoring.
- Do not use CandidateProfile, Wuhan University, `LAW_MASTER_NON_LAW`, candidate
  graduation year, or candidate eligibility in Recall or Relevance.
- Do not write new truth into legacy `jobs`, `sources`, or `sync_runs`.
- Do not make legacy crawler/scoring/sync modules dependencies of new truth.
- Do not make P2-07/P2-08 diagnostic preview the formal public Web truth.
- Do not create a second formal website or formal Web truth.
- Do not have a browser or API layer infer relevance, eligibility, or visibility.

## Legacy status

The following are legacy production assets, not new business truth:
`lib/crawler.ts`, `lib/scoring.ts`, `lib/sync.ts`, `lib/jobs.ts`,
`lib/source-catalog.ts`, `app/api/jobs/route.ts`, `app/api/cron/sync/route.ts`,
`scripts/export-static-mirror.ts`, the public `jobs/sources/sync_runs` model,
and their workflow/schedule triggers.

`DeterministicEligibilityEngine` is **REFERENCE / REGRESSION ONLY** for the new
production chain. Trusted position-bound eligibility is the intended production
owner. No third eligibility implementation is permitted.

## Presentation gate

Until `PresentationDecision` exists, no component may claim to be the new
formal listing truth. In particular:

- legacy `jobs.is_published` remains legacy-only;
- P2-07/P2-08 remains diagnostic/read-only;
- a future Web API must return only PresentationDecision-authorized records;
- the reused UI may search, sort, and filter authorized records, but may not
  calculate business decisions.

## Change review checklist

Before adding an ingestion, decision, API, or UI module, answer:

1. Does an owner already exist in this document?
2. Does the change consume artifacts through the trusted resolver?
3. Does it introduce another writer, canonical identity, or final decision?
4. Does it import legacy crawler/scoring/jobs/sync logic?
5. Does a browser or API infer relevance, eligibility, or visibility?

If an answer indicates a duplicate owner or legacy business dependency, amend
the existing boundary rather than adding a parallel implementation.
