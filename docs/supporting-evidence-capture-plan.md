# Existing-owner supporting capture plan

1. RED: real local-bare Git lifecycle, unknown send, parser failure, returned policy failure.
2. Fixed supporting adapter only; CollectionRunner invokes existing SEND once; RawCaptureService captures actual response.
3. Existing Raw boundary commits/publishes one bundle; fresh owner verifies fixed HEAD and exact bundle before terminal append.
4. Existing SourceAdmission appendVersion publishes a derived receipt, exact Raw parent, nonce and pinned SHA, no retry/rearm.
5. Negative loss/tamper/stale cases, focused tests, typecheck, diff-check and author review.

Write set: new supporting-evidence-capture.ts, dedicated test and this plan only.
No source construction, root, Scheduler, live authorization or transport injection API.
Lineage: source claim -> Raw bundle -> terminal source receipt; any exception preserves its loss breakpoint.
No terminal receipt from a thrown gate; no synthetic throw response; parser failure never COMPLETE.

Implementation ledger:
- Initial module-resolution error was corrected with an empty export scaffold; behavioral RED then 4/4 failed for missing capture function.
- CollectionRunner uses only the fixed supporting adapter and existing SEND gate; no caller transport, adapter, clock or response injection.
- Source versions supplied by the caller must exactly equal the fresh committed owner inventory; all authority/context still resolves through existing replay.
- Raw/Snapshot/canonical V2 are persisted by existing Raw owner, with actual request/result metadata.
- Fresh fixed-HEAD listVerifiedAcquisitions plus Raw boundary bytes and exact expected bundle comparison form the terminal barrier.
- Private terminal publication appends through SourceAdmission persistence owner, normal FF, nonce, pinned SHA and exact fresh readback.
- No automatic retry, reset, release, UNKNOWN synthesis or publication of a receipt from a gate throw.
- Actual policy failures can have honest failed-Snapshot receipts; parser failures retain transport SUCCESS but extraction FAILED and zero canonical records.
- Type assertion at former test line 112 now uses runtime isExtractedRecordV2 narrowing; typecheck exit 0.
- First expanded collection 7/8 PASS; only failure was test's incorrect state path, corrected to existing state/current.json.
- Reviewer-requested pre-send stale/dirty/supplied-version and post-Raw HEAD/dirty negatives added.
- Final existing session 88856 completed exit 0: capture 10/10 plus fixed adapter 6/6, total 16/16 PASS, 186.901s.
- Final typecheck exit 0; tracked diff-check and explicit no-index whitespace checks for all three new files pass.
  One test EOF blank line was removed after collection; no behavior changed. No capture files staged or committed.
- Covered Raw and receipt push rejection/lost acknowledgement, independent bundle tampering, send throw without synthetic capture,
  honest failed transport, failed parser without COMPLETE, fresh-process restoration, stale/dirty/version mutation and post-Raw HEAD/dirty barriers.
- Author final review: fixed adapter only, no second registry/caller response/verified flags; actual request-result evidence,
  independently verified committed Raw before receipt, exact three-commit lineage, no added business Sources/Positions.
- Parent owns SEND/publisher revalidation and root/source-version integration; do not duplicate its 14-test collection or heavy production restore.

Limitations: not production authorization or root/runtime integration; ordinary normal FF requires append-only remote/no rewind.
Exceptions expose the persisted breakpoint for diagnosis; an ambiguous terminal push may have published RECEIPT, but never returns success or rearms.

Remaining parent integration: construct/approve and persist exact source versions separately; invoke this helper explicitly for
the reviewed one-use target, then use committed Snapshot/canonical record IDs through existing readVerifiedDiscovery/root resolver.
All campaign/member/detail proofs must still be reread by the final SOURCE_OCCURRENCE owner gate.
This helper is not installed in Scheduler or production root and grants no automatic capture authority.
