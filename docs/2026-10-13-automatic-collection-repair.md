# Automatic collection and Pages delivery repair

## Scope

The user requests the existing website to collect approved public sources and
publish without separate operator publication. Difficult sources may be excluded.
No recurring Codex follow-up is recreated. Existing daily GitHub scheduling,
86400-second source cadence, personal eligibility OFF, source authority and
append-only history remain unchanged.

## Observed root cause

Run 38355636874 failed before acquisition with FENCING_NOT_VERIFIED at
SCHEDULER_EXECUTION. The committed source repository and ordinary root restore
already carried the fixed-SHA fencing verifier, but Scheduler source enumeration
replayed the same records without passing it. Commit af7f6f9 connects the
repository-owned verifier to selection. A real committed-history regression
failed with that exact error, then passed; omitted and rejecting verifiers still
fail. Scoped combined tests passed 11/11, with TypeScript/diff checks passing.

Run 38356688412 then completed authoritative acquisition, atomic commits and
both Process B checks. Its batch was PARTIAL: Zhenghan acquisition succeeded but
SOURCE_DISCOVERY_SUPPORT_VERIFY failed; Haier was NOT_MODIFIED; the freshly
acquired university source remained cadence-deferred. This is not a new public
job or successful automatic publication: handoff was NOT_REQUIRED.

## Difficult-source exclusions

- National Energy: both exact grants revoked through the existing owner, final
  control tip 019593739803bfee6efa033687f0263228fbae17. No new request; old Raw,
  unknown-send recovery and derived evidence preserved.
- Zhenghan: persistent source-discovery-support verification failure, not
  diagnosed as a login requirement. Both exact grants revoked through the
  existing owner, final control tip 9859562452a90c79eb0c5b72580cd6886ee7c794.
  Existing three public positions remain; no historical record is deleted.
- Haier and the approved university publication remain authorized. Their
  unchanged/cadence outcomes are not fabricated as new jobs.

## Publication handoff

The bounded additive repair publishes the verified current ReadModels after a
committed, fully replayed batch, including NOT_MODIFIED or cadence-only runs.
Newly produced batch-model IDs retain their original meaning. A separate
publication_read_model_ids field identifies current verified models. The
workflow still requires committed CAS, post-push Process B PASS, exact SHA and
nonempty publication references; the same Pages workflow verifies the full
fixed-SHA current state. No handoff is allowed for a failed unverified batch.

## Verification and delivered result

- Controlled Actions/publication suite initially recorded 13/14 PASS in
  675.218 seconds; its sole failure was the old cadence expectation loaded
  before the behavior update. The corrected precise cadence/publication/retry
  test subsequently passed in 230.181 seconds, preserving one request and no
  unauthorized repeat. This is not falsely reported as an all-green original
  suite. Current Pages/handoff tests separately pass 6/6; TypeScript/diff pass.
- Independent bounded static review found two Important gaps (old cadence
  assertion and retry's batch-new readiness gate); both were corrected and
  re-reviewed bounded-clear. Reviewer did not run tests or network checks.
- Runtime commit ee6d7570525e053cd0701379034b6e835cd37613 was normally pushed.
- Hosted Actions run 38359725259 completed SUCCESS for both Scheduler and its
  automatically invoked Pages deployment, with no separate publication
  dispatch. The validation was manually initiated once; it is not claimed to
  be an observed natural cron run.
- Its verified committed batch e9bc35f2ec8ff760de7daff7ad7b6c7ba001f083 was
  DEFERRED because the two remaining source cadences had not elapsed. No
  additional recruitment request or new job is fabricated. Both Process B
  checks PASS; CAS COMMITTED; handoff READY with five current model IDs.
- The actual website's release and every listed file were downloaded using
  the existing integrity verifier; its sealed payload validates exact SHA
  e9bc35f and five distinct positions, including the new university-published
  legal role. Snapshot seal:
  1e134160fa659d56559ba9ab2a25b965b3e436dde87a4d6e9d300fa72d754b09.
- One initial local HTTPS verification reset was followed by one spaced
  successful verification, not a lowered hash or origin check.
- The existing daily 02:17 UTC schedule remains configured and activation
  passed on the hosted run. Next natural cron run after repairs has not yet
  been observed. Automatic updates apply to admitted sources; arbitrary new
  websites are not silently admitted or claimed discovered.
