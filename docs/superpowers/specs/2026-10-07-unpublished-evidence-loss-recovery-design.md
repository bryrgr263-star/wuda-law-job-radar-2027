# Unpublished Evidence Loss — Bounded Recovery Proposal

Status: DESIGN PROPOSAL ONLY. User permits preparation of a recovery scheme, not production
termination or re-acquisition. No implementation/deployment/production write is authorized by this file.

## Purpose and known incident

Restore operability without pretending deleted evidence exists. The first National Energy execution
acquired data and reported local materialization, but final Git preflight failed. Old cleanup removed
the unpublished checkout. The log retains IDs, not original bytes or a recoverable Git commit.

- Inspected authoritative parent: `1634441ca0d5221150288d1be856e63a2279408c`.
- Source: `source-cn-chnenergy-2027-first-expansion`.
- Execution: `first-source-expansion:chnenergy:5a798bfe-a4d6-0be4-e063-98b4d40a088a:2026-10-07T08:09:24.429Z`.
- Attempt: `continuous-attempt:426324ea-2be3-4150-9363-96b866925a14`.
- RESERVE: `613eb25`; COMPLETE: `1634441`.
- No unresolved RESERVE; one COMPLETE is not bound to a Source Outcome.
- Natural Scheduler `37596132432` stopped at `SOURCE_OUTCOME_PENDING`, before acquisition/publication.
- The first target's reserve time is `2026-10-07T08:13:16.214Z`; minimum interval remains 86,400 seconds.
- Its committed COMPLETE time is `2026-10-07T08:13:49.932Z`. The existing cadence rule uses the
  latest COMPLETE/RECOVER time, not RESERVE time. The currently recorded earliest time is therefore
  `2026-10-08 16:13:49.932 Asia/Shanghai`, subject to fresh gates and separate approval at execution.
- Both National Energy authorizations remain existing grants. No duplicate issuance is needed.

Fresh independent Process B on the fully fetched fixed-head Git history completed successfully:
117 journal records, 24 acquisitions, 4 distinct current Positions/ReadModels, zero unresolved
RESERVE and exactly this one unbound COMPLETE. It sent zero production requests. This validates
the retained authoritative history, not the deleted first acquisition bytes, a remote-clone
connectivity guarantee, or the proposed recovery variant (which is not implemented).

The newly tested retention fix preserves a prepared commit after a failed local run returns;
it cannot reconstruct this deleted checkout. It also does not promise durability after an ephemeral
GitHub runner is destroyed. No IDs from the failure log may become trusted artifacts.

## Options

1. **Restore original bytes/commit**, if a verified surviving repository is found. Preferred when
   feasible: existing Process B, exact-parent CAS, normal push, no acquisition or business replay.
   Current inspection has not found that repository; this is not an available recovery claim.
2. **Explicit failed terminal recovery under the existing Source Outcome owner** (recommended for
   review). Append an honest evidence-loss disposition with strict intent/COMPLETE/operator binding,
   keeping all old history and the pending gate. It publishes no business data. Later re-acquisition
   is a separate normal authorized run, subject to a new human approval and current cadence gates.
3. **Keep pending indefinitely**. Safest without an approved recovery contract, but natural Scheduler
   remains blocked. Revocation alone cannot close a sent, completed, unbound attempt.

Do not delete the intent/COMPLETE, reset production state, fabricate an acquisition bundle,
create an empty Snapshot, use NOT_REQUESTED_DUE_ABORT for a sent request, or ignore the pending gate.

## Proposed ownership and contract

Use the existing `source-execution-outcome.ts` owner and append-only outcome identity. No new
Registry, resolver, Trusted Chain, business assessment, or operational truth database.

An additive, explicitly versioned recovery variant (proposed `production-source-execution-outcome/4.0.0`)
has a mandatory discriminator `RECOVERY_TERMINATION`. Old v1/v2/v3 bytes and validation remain unchanged.
The exact TypeScript shape must be reviewed before implementation; the required semantic fields are:

- stable original execution/source/endpoint identity;
- exact committed request-intent ID/hash and original introducing commit;
- exact committed RESERVE and COMPLETE IDs/hashes, attempt ID and authorization reference;
- the immutable incident baseline, recovery commit's expected parent, actor, explicit human approval
  reference, recovery decision time and reason `UNPUBLISHED_EVIDENCE_LOST`;
- a precise statement that original acquired business evidence and local materialization are not
  recoverable or authoritative; log IDs, if included, are diagnostic claims only;
- overall FAILED/non-success terminal disposition, not SUCCESS/NOT_MODIFIED/CONFIRMED_EMPTY;
- zero new acquisition bundles, Raw/Snapshot/ExtractedRecord/Position/Decision/ReadModel artifacts;
- canonical bytes and SHA-256 integrity/seal, not a claim of a human digital signature.

The existing intent integrity hash is
`fcf251d504b31cbb13de3b6b2aabc4ca1395a634fb7670dd83b4360a74289a24`.
An operator must validate the original Git-introducing commit and current bindings rather than
accepting this document or a log as the authoritative reader.

The variant must distinguish failed authoritative-chain submission from a parser/Eligibility failure.
It cannot say the HTTP request failed or that the original local processors never ran. Any retained
`trusted_chain_status` summary must be defined for this variant as non-committed/non-recoverable,
not as an invented processor exception or candidate outcome.

## Required validation, not a bypass

The existing root owns a bounded recovery command. It cannot accept arbitrary database objects as
trusted artifacts. Before writing the variant, it must verify the fixed SHA and all original committed
references through existing readers/validators, plus:

1. There is exactly one matching intent/target/authorization and a real matching RESERVE → COMPLETE.
   Historical authorization must have been valid for the original request. A later revocation is
   preserved and still prohibits new requests; a failed terminal diagnostic is not a new grant.
2. No unresolved RESERVE exists for that attempt; recovery never finalizes a RESERVE.
3. No committed Source Outcome/run/acquisition bundle already covers the execution or attempt.
4. No valid retained unpublished commit is available. If original bytes can be restored, use option 1.
5. The approval reference authorizes this incident, not future arbitrary recovery or re-acquisition.
6. Writer fencing and expected-parent CAS hold; a changed remote parent requires fresh validation.
7. Identity collision is denied; an exact retry is idempotent and cannot double-bind an attempt.
8. Recovery adds only the explicit failed outcome. It cannot mutate grants, cadence, requests, old
   state/journal, current Presentation heads or public releases.

Process B must verify these references and the recovery variant independently. The Scheduler still
checks pending attempts; it may recognize coverage only from a fully validated recovery outcome
owned by the same Source Outcome boundary. The current pending check must not be replaced with
an ignore list or a generic “operator says resolved” flag.

This is a new terminal contract, not a v2 request plan with fabricated observations. Existing
REQUESTED, bounded-stop and NOT_REQUESTED_DUE_ABORT validation must remain unchanged.

## Production execution gate

After design review, implement and validate only in an isolated offline Git fork first. Then present:
the exact proposed appended paths/bytes, fixed parent, restored terminal outcome, unchanged old
tree hashes, zero acquisition counter and operator approval requirement.

Only after explicit user approval may a production recovery append be pushed. Never force push.
If GitHub fails, retain the recovery commit for publication-only retry; do not retry acquisition.
If remote advances, rehydrate and validate the original bindings again; never overwrite history.

Re-acquisition requires separate approval, ACTIVE authorization, no unresolved/pending execution,
and recomputation of cadence from authoritative records and actual execution time. It creates a
new execution ID and does not overwrite or label the lost execution successful.

This incident has a real COMPLETE already. The proposal must not append a ContinuousRecord RECOVER
or another COMPLETE, move the original completion timestamp, or restart the minimum-interval clock.
The new failure records loss of authoritative submission/evidence; it does not reinterpret the
original successful HTTP request as an HTTP failure. The absence of a surviving checkout is an
explicit operator incident statement, not a cryptographic proof that bytes cannot exist anywhere.
Its authority is limited to this approved failed termination, never to reconstructing missing facts.

Preparation, offline implementation/tests, production termination and later re-acquisition are
distinct actions. This design alone authorizes none of the latter three. If a recovery outcome has
been committed and original bytes are later found, they must not silently replace that outcome or
be pushed onto its old parent. Preserve both the incident record and the original evidence for a
separately reviewed restoration path; do not erase the loss decision or reuse a completed identity.

## Offline acceptance before requesting execution

- Reproduce COMPLETE-without-outcome and prove the existing pending gate still denies execution.
- Restore intent/authorization/RESERVE/COMPLETE from a committed fork, with no request transport.
- Append the reviewed failed recovery variant through the existing owner; no fake business artifact.
- Fresh child Process B verifies IDs, canonical bytes, hashes/seals and all committed references.
- Other unresolved RESERVE, missing/wrong COMPLETE, missing intent, invalid/mismatched historical
  authority, already-covered attempt, stale parent, approval mismatch and collision remain denied.
- A legitimate later revocation remains intact; closing a historical failed execution never
  reactivates it or authorizes a new request.
- Idempotent retry does not acquire, rerun the business chain or advance Presentation revisions.
- Old no-query/query history and B pagination evidence remain byte-compatible.
- Batch/source reporting cannot become SUCCESS merely because recovery unblocks a pending execution.
- Current four public Positions and Last-Known-Good snapshot remain unchanged.
- Focused tests, Architecture/Network Guard, TypeScript and diff check pass before implementation
  commit or any production operation. No manual Scheduler is used to test recovery.

## Bounded file-level implementation outline, pending review

1. `lib/production-persistence/source-execution-outcome.ts`: additive discriminated recovery
   variant, strict reader/identity/collision checks and canonical integrity. Never reinterpret v1–v3.
2. `lib/production-persistence/source-execution-request-intent.ts`: verify the variant's original
   immutable intent/attempt linkage without manufacturing a request plan or observations.
3. `lib/production-persistence/zero-cost-production-composition-root.ts`: root-owned, explicit,
   approval-bound recovery preparation; no transport execution, grants or business processors.
4. Existing Source Outcome/root tests: RED→GREEN coverage of loss, failed terminal recovery,
   wrong evidence/approval, idempotency, fencing, stale parent and fresh independent restoration.
5. If an operator script is required, it only calls that existing root with an exact expected SHA
   and an explicit incident approval. Its default is prepare/validate only; no automatic request.

No Scheduler enumeration/cadence change, Pages change, B/A/C implementation, Legacy change or
Recall/Relevance/Requirement/Eligibility/Presentation modification is in scope. Prefer leaving
the Scheduler's existing pending gate untouched: only validated coverage under the existing
Source Outcome owner can satisfy it. If that cannot be done without weakening the gate, stop
and report the precise contract conflict before implementation.

This outline is not permission to implement or execute it. Present the reviewed design to the
user before proceeding; production append and later re-acquisition remain separately explicit gates.

## Failure and rollback boundary

Before push, failed validation changes nothing remote. After a valid recovery append, the immutable
failure fact is retained, never erased. A future successful acquisition is a separate record, not a
rollback of the loss. A wrong recovery disposition is therefore a high-risk operational mistake:
the required explicit human execution approval remains a hard gate.
