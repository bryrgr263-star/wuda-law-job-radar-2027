# Production Scheduler Batch

`bootstrapProductionSchedulerBatch()` is the single production batch
orchestration boundary above the existing zero-cost Production Root. It does
not own source admission, Continuous Authorization, acquisition
classification, Trusted Chain business processors, PresentationDecision, or
publication.

## Authoritative flow

The scheduler reads committed Source Registry, Source Admission, endpoint
allowlist, adapter registration, and Continuous Authorization state. Eligible
sources are derived from those committed artifacts; source names and URLs are
not hard-coded in the scheduler. Every eligible source receives a deterministic
source execution ID and is executed once through
`bootstrapZeroCostProductionCompositionRoot().runProduction()`.

Each source execution keeps its existing independent authoritative commit. A
failure, partial result, or suspicious empty result for one source does not
rollback another source and never deletes prior Opportunity, Position,
PresentationDecision, or PresentationReadModel artifacts.

## Batch manifest

After source outcomes are committed, the scheduler appends one isolated,
canonical `SchedulerBatchManifest` commit. The manifest references sealed
source outcomes and their commits; it does not copy or recalculate business
facts. It records `SUCCESS`, `PARTIAL`, or `FAILED`, plus whether committed read
models are ready for a later publication step. `public_website_published`
remains `false` in this phase.

The manifest store is append-only and collision-safe:

- same batch ID and same canonical bytes is idempotent;
- same batch ID and different bytes is rejected;
- the manifest parent must equal the current remote head;
- the commit may contain only the manifest path;
- force push, merge, and rebase are not used.

## Concurrency and recovery

Independent runners rely on the existing request gate and Git expected-parent
CAS. A CAS loser performs fresh restoration and recomputes scheduling from
committed authorization state. Pending requests, unbound completed attempts,
cadence denial, or revocation produce a scheduler defer; they never trigger an
authorization or request bypass and never publish a stale batch manifest.

If a source outcome was committed before its batch manifest, rerunning the same
batch recovers the deterministic source execution and appends the missing
manifest without a second request. Process B verifies all source outcome,
run-manifest, commit, seal, and ancestry references before exposing restored
batch manifests.

## Out of scope

This boundary does not provide an external timer, GitHub Actions, real-source
authorization, website publication, Web changes, or Legacy sync integration.
All current scheduler verification uses controlled offline sources and
test-scoped Continuous Authorization.
