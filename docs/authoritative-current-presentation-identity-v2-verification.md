# Authoritative Current-Presentation Identity V2 — Verification

## Status

- Implementation: completed within the approved V2 boundary.
- AUTHORITATIVE CURRENT-PRESENTATION IDENTITY V2 = VERIFIED.
- DUPLICATE PRESENTATION BLOCKER = RESOLVED.
- TRUSTED SOV DISCOVERY-SUPPORT COMPATIBILITY = VERIFIED.
- Final full offline regression: 977 tests, 976 PASS, 1 PRE-EXISTING BASELINE FAILURE, 0 new failures. The full command exits 1; this is not an all-green suite claim.
- Production deployment, Scheduler and Web cutover: outside this stage.

## 1. Subject and ownership

The existing PresentationDecision owner uses `(scope, trusted Position.id)` for the public series. Its existing canonical registry also seals migration audits; there is no PresentationSubjectIdentity registry or second decision engine. Candidate IDs are discovery/provenance references, not public subjects. The compatibility Candidate lookup follows its associated Position's current head; its historical issuance list remains unchanged.

## 2. Semantic projection and idempotency

`PresentationSemanticProjectionV2` is embedded in the immutable Decision, not separately registered. It copies the existing sealed policy result, Relevance, Eligibility, Requirement graph, composition trust and display fields through explicit descriptors. Local references are resolved against the trusted upstream graph. Candidate-evidence IDs/hashes and predicate semantic hashes remain conservative comparison guards. Unsupported fields, unresolved/cyclic descriptors and unprovable comparisons stop with `SEMANTIC_PROJECTION_REVIEW_REQUIRED`; they do not create a business exclusion or replace current.

Only the current Position head is compared. Identical canonical projection reuses the complete original Decision and ReadModel, including issuance time and upstream references. New discovery/support/execution provenance is journaled separately. Changed verified semantics appends revision N+1 with the exact predecessor. A state reversal does not reactivate an old revision.

## 3. Current integrity

The existing repository derives current from verified immutable history. It validates scope, stable IDs, seals, continuous revisions, predecessors, migration origin, every matching ReadModel and display/provenance alignment. Missing models, gaps, branches, collisions, stale writers and scope contamination reject activation. Current NOT_DISPLAY never falls back to historical DISPLAY. Derived SQLite rows are checked against the existing authoritative Decision/Model resolvers; recalculating a row's hash cannot make it trusted.

## 4. Positionless outcomes

UNBOUND_RETAINED_OUTCOME has no Position, public revision or supersedes. It retains original status/reasons and immutable evidence, but is not a public Position job. Collection retention metadata lists all outcomes; the Candidate detail route can read an explicitly non-public audit reference. Audit references have deterministic ordering, not an independent public head. After trusted binding, Candidate detail follows the Position current model; previous outcomes remain unchanged and visible in retention metadata.

## 5. V1 migration and issuance envelopes

Historical V1 bytes, IDs, seals, models and journal records replay unchanged. New live PRODUCTION V1 Presentation writes are rejected. Before a bound V1 subject activates V2, the root derives its complete historical inventory, verified original issuance envelope hashes and first issuance sequences from the journal at its verified anchor.

Equivalent history produces one migration-origin V2 revision 1 and matching model. Conflicting or unprovable history produces a sealed MIGRATION BLOCKED audit with no arbitrarily selected public head. All original Candidate associations remain auditable. Reuse references the original issuance envelope and journals the new actor/time/support; it never reseals an unchanged artifact under the new execution's provenance.

## 6. SOV support and duplicate diagnostic

The existing VERIFIED_DISCOVERY_SUPPORT validator is reused without changes to SOV identity, original bindings or support semantics. Process A retains the original SOV/PV/Position while Candidate B consumes validated new Snapshot/ExtractedRecord support.

The original duplicate diagnostic was retained and strengthened. Before the repair, valid discoveries of the same trusted Position produced distinct Candidate-scoped public records. With V2, two retained Candidates produce one subject, one current Decision, one current ReadModel and one public API record. API/UI performs no deduplication.

## 7. Commit, failure and Process B

The existing zero-cost root validates the complete current snapshot before its atomic authoritative Git commit. Public publishing reads current, not historical Model arrays. Audit-only runs can commit explicit retained outcomes without inventing a Position/model. Equivalent migration directly emitted by the root is tracked with its already-sealed model.

FAILED, PARTIAL and invalid-support rediscovery tests preserve the original remote HEAD and exact current Model bytes. The independent Process B support test rebuilds Candidate/support associations and original artifact/envelope bytes from the committed state. A separate fresh child Process B test restores unchanged V1 history, migration-origin V2 revisions 1→2→3, exact IDs/seals/supersedes/current, models and positionless retention. Neither child shares Process A's Maps/WeakSets.

## 8. API boundary

The existing `/api/presentation/v1/opportunities` and Candidate detail contract consume the validated current snapshot. The collection contains Position-scoped current records and separate retention/migration pagination metadata. Existing DISPLAY, DISPLAY_WITH_REVIEW and EVIDENCE_BLOCKED visibility rules remain unchanged; there is no business re-evaluation or title-based deduplication.

The existing runtime can accept the approved current read repository. No fixed Git repository activation, route deployment, Web wiring, backend migration or Scheduler prerequisite is implemented or claimed by these tests. Shadow SQLite remains a derived/test store, never Production truth.

## 9. Verification evidence

- TypeScript: PASS after the final implementation/test edits.
- PresentationDecision V1/V2: 22/22 PASS.
- Architecture: 13/13 PASS.
- SOV support: 17/17 PASS, plus independent committed-Git Process B PASS.
- Network Guard: 2/2 PASS.
- Combined Presentation/support/architecture/persistence-boundary/network guards: 61/61 PASS.
- P1 regression: 170/170 PASS, including the added boundary guard.
- Trusted Chain/Recall/Relevance/Requirement/PredicateResolution/Eligibility test selection: 403/403 PASS.
- Production persistence contract/security/architecture selection: 40/40 PASS; Git/raw/zero-cost integration also runs in the full suite.
- Fresh Git Process B with revisions 1→2→3: 1/1 PASS.
- Committed rediscovery/support/failure preservation/fresh child: 1/1 PASS.
- Final full offline regression: 93 test files; 977 tests, 976 PASS, 1 PRE-EXISTING BASELINE FAILURE, 0 cancelled/skipped, 0 new failures; 489827.5596 ms, command exit 1.
- Known historical failure: `tests/normalization/source-occurrence-materializer-parity.test.ts:434` (assertion at 439), PRE-EXISTING BASELINE FAILURE; unchanged.
- An intermediate fresh-Shadow-schema expectation failure was a new stage issue, corrected and rerun; it is not classified as baseline.
- Legacy/Preview/Canary dependency guards: PASS. No second authoritative implementation introduced.
- Old production protected-path diff: 0.
- `git diff --check`: PASS; separate untracked whitespace scan: 0 findings before this report.

Logs are local verification outputs under `C:/Users/HUAWEI/AppData/Local/Temp/`: `presentation-v2-full-offline-final.log`, `presentation-v2-p1-final.log`, `presentation-v2-boundaries-final.log`, `presentation-v2-trusted-chain-final.log`, `presentation-v2-persistence-final.log`, `presentation-v2-process-b-final.log`, and `presentation-v2-failed-rediscovery-final.log`.

## 10. Stage file inventory

Paths below are relative to the correct worktree `C:/Users/HUAWEI/Documents/Codex/2026-08-10/2027-job-radar-ingestion-foundation`.

### Newly created in this stage

- `lib/ingestion/pipeline/presentation-semantic-projection.ts`
- `shadow/migrations/004_presentation_identity_v2.sql`
- `docs/authoritative-current-presentation-identity-v2-verification.md`

### Existing files edited in this stage

- `lib/ingestion/domain/presentation.ts`
- `lib/ingestion/pipeline/presentation-decision.ts`
- `lib/ingestion/pipeline/presentation-read-model.ts`
- `lib/ingestion/pipeline/presentation-persistence.ts`
- `lib/ingestion/pipeline/trusted-chain-composition-root.ts`
- `lib/ingestion/pipeline/trusted-chain-restoration.ts`
- `lib/ingestion/persistence/repositories.ts`
- `lib/ingestion/persistence/sqlite-shadow-persistence.ts`
- `lib/production-persistence/git-append-only-execution-store.ts`
- `lib/production-persistence/git-raw-object-persistence.ts`
- `lib/production-persistence/zero-cost-production-composition-root.ts`
- `lib/presentation-read-api/api.ts`
- `lib/presentation-read-api/runtime.ts`
- `tests/pipeline/presentation-decision.test.ts`
- `tests/pipeline/trusted-chain-restoration.test.ts`
- `tests/production-persistence/zero-cost-production-composition-root.test.ts`
- `tests/real-2027-haier/haier-2027-canary.test.ts` (offline test wrapper only; no Canary orchestration change)
- `tests/persistence/shadow-test-database.ts`
- `tests/persistence/shadow-migration.test.ts`
- `tests/architecture/ingestion-boundary.test.ts`

The worktree's earlier 23 tracked modifications and 108 untracked files are not all new stage edits. Existing P1/P2 artifacts were preserved; no reset, clean, stash, checkout overwrite or worktree commit was performed.

## 11. Frozen boundaries

No changes to SOV ID/hash, original SOV binding validation, discovery-support semantics, Position identity, Recall/Relevance/Requirement/PredicateResolution/Eligibility business rules, Candidate Evidence issuance, Source Admission, continuous authorization, Scheduler/Actions, Web/JobBoard or legacy production truth. Existing root wiring, Presentation versions/current reads and derived test persistence are the permitted integration boundary. No network acquisition was performed in this stage.

## Final decision

V2 implementation and the required new regressions are VERIFIED. The pre-approved historical baseline failure remains explicit and unchanged; repository-wide all-green or Production readiness is not claimed. Do not advance Scheduler or its prerequisites.

## Acceptance checklist

| # | Required report item | Result |
| --- | --- | --- |
| 1 | Modified files | Stage inventory above: 3 new files and 20 existing files edited; prior dirty files are not all stage changes. |
| 2 | Position subject | Existing owner, `(scope, Position.id)`; no Candidate/title identity fallback. |
| 3 | Semantic projection | Versioned closed descriptors, trusted graph dereferencing, conservative evidence/predicate hashes. |
| 4 | Semantic idempotency | Identical current semantics reuses original complete artifacts. |
| 5 | Revision/supersedes | 1→2→3 reversal, exact predecessor; no historical reactivation. |
| 6 | Authoritative current | Validated contiguous chain and one matching model at every revision. |
| 7 | Positionless handling | Null public subject/revision, retained evidence/counts/detail references; later binding preserves audits. |
| 8 | Envelope reuse | Original issuance bytes/seal/envelope reused; new execution provenance journaled. |
| 9 | V1 migration | Unchanged historical replay; equivalent migration or explicit BLOCKED audit; live Production V1 writes rejected. |
| 10 | SOV support | Existing verified support consumed; original identity/binding/support algorithms unchanged. |
| 11 | Duplicate diagnostic | Preserved diagnostic, before 2 public records / after 1; both discoveries remain retained. |
| 12 | API cardinality | Same trusted Position + equivalent valid discoveries → 1 public API record. |
| 13 | Process A/B | Independent committed-Git restoration of exact artifacts, revision 1→2→3, current and unbound retention. |
| 14 | Support regression | 17/17 plus committed fresh child Process B and corruption protection PASS. |
| 15 | V2 regression | 10/10 diagnostic/V2 cases; Presentation V1/V2 total 22/22 PASS, plus root migration tests. |
| 16 | P1 / Trusted Chain | 170/170 and the 403/403 trusted/business-layer selection PASS; full suite also covers restoration/integration. |
| 17 | Architecture/Legacy/Network | Architecture 13/13, persistence dependency guards and Network Guard 2/2 PASS; Legacy dependency = 0. |
| 18 | TypeScript | PASS; no unrelated Canary file edited. |
| 19 | Full offline regression | 976 PASS / 1 explicitly allowed historical baseline failure; command exit 1. |
| 20 | New regression count | 0 at the final code state. |
| 21 | Prohibited scope | No frozen business-semantic, network, Scheduler, Web, Legacy or old production changes. |
| 22 | Final status | V2 VERIFIED; duplicate blocker RESOLVED; SOV support remains VERIFIED. STOP. |

## Worktree

- Correct path: `C:/Users/HUAWEI/Documents/Codex/2026-08-10/2027-job-radar-ingestion-foundation`.
- Branch: `codex/ingestion-foundation`.
- HEAD unchanged: `7de0554d1fb23db8453376099f165fd4d0af33ee`.
- 23 tracked modifications, 111 untracked files (the original 108 plus this stage's 3 additions).
- No code-worktree commit, reset, clean, stash or overwrite. Authoritative Git commits in the offline restart/integration tests are isolated temporary test repositories, not a live deployment.
- `git diff --check` PASS; untracked whitespace scan 0; protected old-production path diff 0.
