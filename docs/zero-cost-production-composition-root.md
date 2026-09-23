# Zero-cost production composition root

`bootstrapZeroCostProductionCompositionRoot()` is the sole zero-cost production
writer boundary. It composes the existing Source Registry and Admission owners,
Raw capture contracts, Git Raw object store, trusted-chain composition root,
PresentationDecision, PresentationReadModel, and Git execution store. It does
not define a new business model or resolver.

## Atomic run

Each run starts from a fresh clone of the configured authoritative branch and
records its expected parent. Existing persistence components operate only in
that disposable clone. At validation time their expected-parent anchors are
rebound to the original remote parent, all local persistence commits are
squashed, and one ordinary fast-forward push publishes the complete state.

For a successful business-chain run, the source execution and trusted journal
share one authoritative commit. It contains source revisions, Raw objects and
manifests, Snapshots, ExtractedRecords, the trusted journal and artifact ledger,
PresentationReadModel projections, the immutable production run manifest, and
a sealed source-execution outcome. A non-success acquisition commits only its
verified source outcome and acquired evidence, without a business-chain run
manifest. A downstream trusted-chain failure after verified acquisition can
also commit an acquisition-only outcome. A crash or failed remote CAS is never
reported as committed.
If a continuous-request retry is denied after an earlier completed attempt,
the root retains that attempt's captured response, Snapshot, and any extracted
records, then commits a failed or partial acquisition outcome. It does not
claim evidence for the denied retry itself.
The final commit is rejected if it contains a deletion or a path outside the
four approved production namespaces.

## Lifecycle

A successful run records:

`CREATED → RUNNING → VALIDATING → COMMITTING → COMMITTED`

Source-execution status is `SUCCESS`, `NOT_MODIFIED`, `CONFIRMED_EMPTY`,
`SUSPICIOUS_EMPTY`, `PARTIAL`, or `FAILED`. A failed acquisition preserves prior
opportunities and presentation. `NOT_MODIFIED` requires matching verified
request locators and Raw hashes. `CONFIRMED_EMPTY` currently requires exact
closed official JSON zero-result evidence, prior verified source content, and
the existing P1 SourceRunMissingGuard classification. Weaker empty evidence
stays suspicious. A Presentation publish failure after a successful push can
be retried from the persisted ReadModel without re-executing business commands.

`runProduction` owns the Trusted Chain binding and rejects a caller-supplied
executor. The `run` injection seam is restricted to explicit `CANARY` or
`TEST_ONLY` mode; canary mode cannot use continuous authorization. The production
binding invokes existing processors and only resolver-backed SourceComposition
and Candidate Evidence. If either is unavailable it does not invent facts and
retains an evidence-blocked PresentationDecision.
Production SourceOccurrence role follows the existing trusted invariant:
records with RecruitmentContext are position-bearing; records without it are
packages, not fabricated positions.

## Writer and recovery boundary

Only one writer for a remote/branch pair is admitted in one process. The final
push also checks the remote expected parent and uses a normal non-force push;
stale writers cannot merge, rebase, or overwrite the branch. Process B always
starts from a fresh clone, verifies Source and Raw persistence, replays the
existing trusted owners, and compares restored PresentationReadModel hashes to
the committed run manifest. It verifies source-outcome seals, acquisition
references, P1 guard assessments, empty/unchanged proofs, and business-run
references before exposing restored source outcomes.

## Deferred work

The Production Scheduler Batch may invoke this root, but this boundary does not
provide an external timer, GitHub Actions deployment, Web cutover, new source
adapters, real 2027 source acquisition, or sensitive DOCUMENT_VERIFIED
Candidate Evidence storage.
