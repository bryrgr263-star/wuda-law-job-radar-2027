# Evidence-loss recovery: offline implementation boundary

## Ownership and scope

This additive implementation uses the existing Source Execution Outcome owner. It creates no
new Source Registry, business resolver, ContinuousRecord recovery event or Trusted Chain.
`bootstrapZeroCostProductionCompositionRoot().prepareEvidenceLossRecovery()` is read-only:
it clones, validates immutable references and returns a proposed sealed outcome. It does not
commit, push, send HTTP, issue authorization, execute processors or publish data.

Production execution is not granted by these tests. The user subsequently explicitly approved
failed termination after offline validation. It still requires final review, regression,
fixed-history verification and fresh-parent CAS. No production outcome has been appended.

## Additive schema

`production-source-execution-outcome/4.0.0` has mandatory `outcome_kind = RECOVERY_TERMINATION`.
Its FAILED summary refers to lost authoritative submission, not a claim that the original HTTP
request or a particular parser failed. `recovery.stage = AUTHORITATIVE_SUBMISSION` and
`recovery.reason = UNPUBLISHED_EVIDENCE_LOST` retain that distinction; original COMPLETE SUCCESS
bytes are unchanged. There are no acquisition bundles, RawBlob/Snapshot/ExtractedRecord IDs,
request observations or fabricated business artifacts in this outcome.

The proof binds original execution, single target, exact intent hash/introducing commit, original
RESERVE and COMPLETE IDs/hashes, authorization/version references, incident baseline, expected
parent, actor, incident approval reference and decision time. All content is canonical and sealed.
SHA-256 is integrity, not encryption or a human digital signature. The approval reference is an
operator audit reference; it is not independently authenticated user consent. Deployment must
enforce the explicit operator/user approval gate separately.

## Restoration and denial gates

- Existing authoritative source/authorization readers validate upstream state.
- The reader scopes proof to the expected parent's immutable continuous-record prefix, so later
  records cannot rewrite the original request meaning.
- A real matching RESERVE and COMPLETE SUCCESS must exist with the same attempt and holder.
- Missing intent, unresolved reservation, wrong hash, wrong source/target, non-ancestor baseline,
  stale parent, time before completion, existing acquisition/outcome and double-bound attempt deny.
- The introducing outcome commit must be the expected parent's child; collision remains denied.
- Later revocation is retained and does not prevent documenting a historical failed submission,
  but continues to prohibit requests. No grant is resurrected and no completion time is moved.
- Byte-identical local writes are idempotent. The original sent-request lifecycle is never relabeled
  NOT_REQUESTED_DUE_ABORT or SKIPPED_BY_BOUNDED_STOP.
- A Process B reader validates sealed bytes and upstream references before returning recovery
  coverage. The Scheduler's existing SOURCE_OUTCOME_PENDING gate is unchanged.

The absence of surviving original bytes is an explicit incident attestation, not a cryptographic
proof of universal absence. A recoverable retained commit must use the existing exact-parent
recovery path instead. Never fabricate an approval reference for a real incident.

## Controlled tests

`tests/production-persistence/evidence-loss-recovery.test.ts` uses existing controlled Source
Admission and Git fixtures. It creates a genuine mocked request lifecycle and intentionally does
not persist the response as business evidence. All termination records remain in offline bare
repositories, with TEST_ONLY approval references.

Eight cases passed: read-only preparation, canonical/idempotent failed termination and independent
child Process B, negative parent/approval/surviving-evidence/identity checks, sibling acquisition
denial, restoration after a distinct future source/grant/intent, rejection of an older execution
claiming a later attempt, pending RESERVE denial, and later-revocation preservation with
new-request denial. The child restores no acquisition, journal record or ReadModel invented
by the termination. The three additional association/restoration cases first reproduced the
independent review findings before their minimal fixes.

An independent actual-production Process B, pinned to fully fetched Git objects at
`1634441ca0d5221150288d1be856e63a2279408c`, passed with 117 journal records, 24 acquisitions,
16 Source Outcomes and four current ReadModels for four distinct Positions. It performed no
HTTP request. Read-only incident preparation also passed with the original intent/attempt
references and zero invented acquisition artifacts; preparation did not append a record.

The interrupted earlier expanded run has no final result and is not claimed complete.
Its unchanged `continuous-architecture.test.ts:45` failure was independently reproduced at
committed HEAD: its old request-dispatch literal is absent from the unchanged gate. The final
bounded dependency regression is recorded separately in the Final Closure Ledger; this document
does not substitute for its result or call a known baseline failure a new regression.

Final bounded regression completed on 2026-10-08: 57 total, 56 PASS, one known baseline FAIL,
zero cancelled/skipped, exit 1. The sole failure is the unchanged static assertion above;
NEW REGRESSION = 0 in this executed scope. Recovery 8/8 and the query REQUESTED/bounded-stop/
pre-reservation-abort fresh-process integration passed. Admission, transport-facing root,
persistence, Architecture and Network Guard controls were included. TypeScript and diff check
passed. Independent final static review found no Critical/Important blocker, explicitly checked
the three repaired associations, and did not claim to have rerun tests or production operations.

## Unchanged production breakpoint

Last reliably fetched production SHA: `1634441ca0d5221150288d1be856e63a2279408c`.
The National Energy execution remains pending and both grants remain issued. Original business
bytes are unavailable. No production recovery, re-acquisition, new public job or publication is
claimed. Earliest cadence-only eligibility remains `2026-10-08 16:13:49.932 Asia/Shanghai`, subject
to fresh time/authorization/pending gates; failed termination does not authorize an early request.

No historical record, continuous policy, Scheduler/Pages workflow, candidate judgment, Legacy
business logic or old schema interpretation is modified by this implementation.
