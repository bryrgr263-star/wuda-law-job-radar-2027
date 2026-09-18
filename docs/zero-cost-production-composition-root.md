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

The single commit contains source revisions, Raw objects and manifests,
Snapshots, ExtractedRecords, the trusted journal and artifact ledger,
PresentationReadModel projections, and the immutable production run manifest.
The final commit is rejected if it contains a deletion or a path outside the
four approved production namespaces.

## Lifecycle

A successful run records:

`CREATED → RUNNING → VALIDATING → COMMITTING → COMMITTED`

Failures return `FAILED`, `EVIDENCE_BLOCKED`, or `PARTIAL`. A failed run does
not publish the disposable checkout. A Presentation publish failure after the
push leaves trusted state committed and can be retried directly from the
persisted PresentationReadModel projection without executing business commands.

## Writer and recovery boundary

Only one writer for a remote/branch pair is admitted in one process. The final
push also checks the remote expected parent and uses a normal non-force push;
stale writers cannot merge, rebase, or overwrite the branch. Process B always
starts from a fresh clone, verifies Source and Raw persistence, replays the
existing trusted owners, and compares restored PresentationReadModel hashes to
the committed run manifest.

## Deferred work

This boundary does not provide scheduling, GitHub Actions deployment, Web
cutover, new source adapters, real 2027 source acquisition, or sensitive
DOCUMENT_VERIFIED Candidate Evidence storage.
