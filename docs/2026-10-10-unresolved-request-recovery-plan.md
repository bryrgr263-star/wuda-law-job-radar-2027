# Incident-limited unresolved request recovery

Status: execution approved by the user on 2026-10-10, conditional on offline
verification and independently verified fencing. No production recovery has
been appended. Existing evidence-loss recovery approval is not reused.

## Fixed incident

- Repository: bryrgr263-star/wuda-law-job-radar-2027.
- Scheduler run: 37909786610; job: 113751898178.
- Attempt: continuous-attempt:bccb61fd-fdb9-4ffa-a901-69cacbe35638.
- Source execution: scheduler-source:b11f252b67a074cdc98beacdba3d0dc9ba4e9a9a78b684522314d9a0bd8c98ab.
- Reserved at: 2026-10-09T09:14:40.511Z.
- Target key: ced21121bf008a721253971b5362c1e7301481731d193a2d95277fec95379d20.
- Actual send and response: UNKNOWN. No COMPLETE or acquisition is committed.

## Existing-owner contract

Ruling: the real platform capture must use an additive witness schema 2 with
separate `platform_capture` fields for `captured_at` and `executor_head_sha`.
Capture time is not approval time, and executor head is not reservation commit.
Existing schema 1 fixture bytes/IDs remain unchanged. Schema 2 requires the
exact known executor head, canonical capture time after job completion, and
the same incident bindings. This closes a missing evidence-field contract;
it does not expand recovery authority or introduce another registry.

Ruling: publish the verified witness, RECOVER and failed source outcome as one
normal remote-main fast-forward ref update after constructing and validating
their append-only local commit sequence. Do not expose a remote intermediate
RECOVER without its source outcome. The existing Scheduler unsettled gate
checks RESERVE/COMPLETE; changing Scheduler semantics is not needed for this
incident. Existing-owner recovery may operate against an isolated local Git
remote during preparation, followed by full fixed-tip replay and one guarded
production push. Every intermediate commit remains in history, but no
concurrent remote observer sees a half-completed recovery tip.

1. Reuse Continuous Acquisition RECOVER/FENCED_UNKNOWN; never manufacture a
   COMPLETE, HTTP response, Snapshot, RawBlob or extracted record.
2. Establish exact intent, authorization, reserve hash, holder and producing
   scheduler batch/run association from committed history. A completed job
   alone does not establish the association.
3. Independently verify that the associated old execution is terminated and
   cannot resume sending. Capture only allowlisted platform facts and explicit
   incident approval, not tokens, signed download URLs or complete API bodies.
4. Add any necessary recovery evidence under existing Git source persistence.
   The repository owner must resolve and validate it at a fixed SHA. A caller
   boolean or ad hoc custom verifier is not production evidence.
5. Wire the same verified proof through default production restoration,
   request admission, Scheduler and publication Process B. RECOVER currently
   requires a verifier on every replay; inserting it without this wiring would
   make the authoritative history unreadable.
6. Under the existing Source Outcome owner, separately cover the abandoned
   execution with truthful failure/unknown-send evidence. The completed-request
   evidence-loss variant requires COMPLETE and must remain unchanged.
7. Preserve original intent, RESERVE and all existing artifacts byte-for-byte.
   Do not remove pending checks. Recovery time conservatively starts the full
   existing minimum interval; it never resets the gate to immediately eligible.
8. Append only after fresh remote, exact parent, clean checkout, verified old
   executor fencing and no conflicting execution. Use normal fast-forward Git
   publication. Failure preserves the local evidence and original history.

## Required RED/GREEN coverage

- No verifier, missing witness or unsupported proof schema fails closed.
- Wrong attempt, holder, target, authorization, intent, run/job or reserve hash
  fails before mutation; running or ambiguous executor cannot be fenced.
- Unknown send remains unknown; no observation or fake REQUESTED result.
- Existing COMPLETE recovery cannot terminate a RESERVE-only incident.
- Default fresh child Process B restores RECOVER and its source outcome without
  injecting process-memory predicates or accessing the network.
- Tampering, re-sealing mismatched references, deleting proof and stale parent
  are refused; historical no-recovery bytes and existing tests remain intact.
- Full interval, original record preservation, no acquisition/publication side
  effects and interrupted publication recovery are explicitly asserted.

## Independent progress already completed

### Runtime wiring checkpoint, 2026-10-10

Default source persistence and source-owner restoration now use the pinned
repository-owned incident verifier when no controlled verifier is supplied.
Their two targeted RED/GREEN checks passed independently. Production-root
recovery and transport-final restoration wiring are assigned to Huygens; do
not edit those files concurrently.

The v5 pure outcome constructor passed three focused checks. Its new immutable
writer regression is currently RED: the existing writer rejects v5 with
`Source execution outcome schema mismatch` (2 passed, 1 failed). This is an
expected unfinished integration test, not a production incident or a passing
closure result. Strict v5 immutable writer shape/seal handling subsequently
passed 3/3 focused tests, including refusal of re-sealed fabricated REQUESTED
send status; TypeScript and diff checks passed. Fixed-Git read binding is still
unfinished and v5 is not yet accepted by production restoration. The separate
fixed-Git binding validator now resolves the committed witness and parent
record prefix, reconstructs the exact expected outcome and rejects missing
Git context. Its missing-context negative passed after RED, with 3/3 focused
checks and TypeScript/diff passing. Positive committed RECOVER/outcome replay
and reader integration are still required; this is not full closure. Next add read
binding, without altering the v4 COMPLETE requirement. No production recovery,
request, commit or push has occurred during this checkpoint.

The positive committed-recovery binding test first failed because its sparse
TEST_ONLY clone did not materialize the intent file used by the existing intent
reader. The fixture now writes the original canonical intent unchanged and
adds the recovery state's immutable history snapshot. Targeted session 35531
finished with 1/1 PASS in 62.142 seconds, including a re-sealed bad-reference
negative. Extending this test through the existing outcome reader produced
the expected v5 schema RED in session 32999. The additive v5 read branch now
uses the same fixed-Git validator, exact introducing-parent binding, no
acquisition-artifact check and duplicate-attempt rejection. TypeScript passed
after correcting two type annotations. Targeted reader session 34598 is
completed 1/1 PASS in 48.748 seconds. A real fresh child-process replay has
now been added to the same fixture, using default source persistence and a
network guard rather than process-memory callbacks. Targeted session 38646
completed 1/1 PASS in 51.160 seconds: a genuinely fresh child restored the
committed recovery and v5 outcome using default persistence under Network
Guard, with no caller verifier. Huygens completed root/transport and exact v5
intent coverage: wiring 3/3, v5 coverage 1/1, existing UNKNOWN_SEND 1/1,
TypeScript/diff PASS. These are fixture-level results, not production recovery.
Huygens now owns only new incident witness preparation module/tests; parent
owns broad focused recovery regression and final integration/review.
The combined serial four-file recovery regression session 35583 finished
20/20 PASS in 369.807 seconds. No production
witness, RECOVER, outcome or recruitment request has been appended.
Separate v4 recovery/Architecture/Network Guard regression session 15193
finished 15/16 PASS, exit 1, including all eight v4 recovery checks passing.
It reported one static continuous-architecture assertion
failure. Immutable HEAD gate inspection confirms its obsolete send-call
substring is absent (`indexOf` is -1) while the reserve-call index is 7728;
the identical static less-than assertion therefore fails before this patch
as well. The runtime send path is unchanged by this incident fix. Classify
this as a pre-existing static-test mismatch, not a new recovery regression;
do not claim the full suite passed or silently alter the unrelated test.
TypeScript and
diff checks passed independently. Both parent sessions have ended; do not
repeat them or claim the 15/16 suite was fully green.
Fresh-child verification now additionally exercises full default production
root restore over the complete committed historical fixture, actual stream
`initial-production-source-activation`, and asserts the recovered outcome and
four unique current positions. Session 53821 is running; its 900-second child
test ceiling does not change any production publication timeout or integrity
check. It failed after 226.119 seconds with SCHEDULER_BATCH_UPSTREAM_MISMATCH.
Diagnosis: the sparse TEST_ONLY clone staged the entire outcomes directory,
thus deleting unmaterialized historical outcomes from its test commit. This
was a fixture error, not a production recovery-rule defect. The fixture now
stages only the new outcome file and asserts zero deleted historical files.
Corrected full-root session 72533 completed 1/1 PASS in 259.444 seconds.
The real fresh child restored the full default production root, recovered
outcome and four unique current positions under Network Guard with no custom
fencing verifier. Original history had zero deleted files. Do not repeat this
completed session. This is an offline historical fixture, not production recovery.
Huygens completed schema 2 preparation and its dedicated tests: 7/7 PASS in
72.326 seconds, TypeScript PASS. The producer performs only two fixed official
GitHub GETs, denies redirects, bounds timeout/body size and emits safe sealed
fields without network responses or credentials. No actual capture or
production write has yet been performed. Ampere has a new read-only independent
scoped review task; collect its result and limitations before final acceptance.
Independent scoped review identified two Important issues: schema 1 could
downgrade the new capture contract, and recovery time was not bounded by
platform capture time. Both are verified against the current code. No real
schema 1 witness exists in production; it is only a TEST_ONLY fixture format.
Ruling: retain schema 1 canonical inspection but deny it for default production
fencing. Add an optional closing timestamp to the existing verifier call so
the default verifier can require RECOVER time at or after independent capture;
two-argument controlled callbacks and all historical record bytes stay intact.
Huygens owns this minimal RED/GREEN repair and affected witness fixtures.
Parent must also ensure outcome binding cannot accept a backdated recovery.
No production recovery will proceed until these review findings are closed.
The bounded repair completed 15/15 targeted checks in 553.204 seconds,
plus the old two-argument callback compatibility check 1/1. Default authority
now requires schema 2 and actual closing time at or after independent capture;
the outcome binding uses the same fixed-parent verifier and recovery time.
Ampere's subsequent read-only scoped re-review found both P1 findings and the
outcome bypass closed, with static-only limitations. Parent updated the two
prepare-test expectations: schema 2 supplies capture time; schema 1 remains
inspectable but cannot authorize recovery. Preparation regression session
42046 completed 7/7 PASS in 71.180 seconds. No actual capture, production
recovery, runtime commit or push has been performed.
Read-only HTTPS fetch on the 15:13 local continuation succeeded: FETCH_HEAD
and local HEAD both remain f40714dc001994ca140df6002138c09aa5be223b. Dirty
recovery work remains intact; no merge, rebase or push was performed.

The actual saved campaign Raw has a separately sealed COMPLETE derivation with
one PACKAGE record at commit f40714dc001994ca140df6002138c09aa5be223b.
Its original acquisition is SUCCESS and extraction FAILED; both are preserved.
Full fixed-history network-guarded Process B passed in 150.958 seconds. This is
not a new Position or public job and does not resolve the pending request.

### Continuation, 2026-10-12

The integration worktree still retains the complete uncommitted recovery patch.
Fresh HTTPS fetch confirms remote main remains f40714dc001994ca140df6002138c09aa5be223b.
No incident test process remains active. The former parent session 90192 is no
longer readable, so its final result is UNKNOWN, not a claimed PASS. A new serial
five-file verification is running as session 45302, with durable private output
at incident-final-verification-20261012.log and a separate exit-status file.
TypeScript and diff checks passed on the retained patch. No real capture,
production recovery or new recruitment request has been performed.
Read-only official preparation subsequently succeeded. The original user
approval message timestamp is 2026-10-10T06:21:54.778Z, retrieved from the
retained user reply rather than inferred from a heartbeat or capture time.
The safe schema 2 witness was captured at 2026-10-12T05:04:39.465Z and saved
privately as incident-real-witness-20261012.json, seal
f747c0b9943a4f001f86e8c2ca42263d1de24839d5ca25d08cc7c49980d8c54b.
Actual send remains UNKNOWN. This preparation made no production writes and
no recruitment requests. Verification session 45302 remains active; no runtime
commit or production recovery has yet been performed.
Session 45302 has now completed with exit 0: all 30 checks across the five
recovery files passed in 764.757 seconds, including default full-root fresh
child restoration, schema downgrade/backdating denial and safe preparation.
The prior baseline-only static architecture failure remains separately
recorded; this focused PASS does not claim the entire project suite passed.
Runtime-only commit abe21cd1c61e0369a3fe7e81db82ea5800f82e27 preserves all
production object and workflow namespaces. Documentation remains separate.
Session 49439 is now preparing the actual approved recovery against an isolated
local bare remote only, then running default network-guarded fresh Process B.
Its durable progress/report is incident-local-chain-20261012.json and log/status
files in the private recovery directory. Do not duplicate it or publish an
intermediate RECOVER. The production remote has not been updated.
Session 49439 completed with exit 0 and full default network-guarded root
restoration. The actual append-only sequence is witness af2bf29b160263df8a5caf87cfff030017f6845d,
RECOVER 7ce5e871195610723ba9ae467e9d08cefb62e3be at
2026-10-12T05:18:08.636Z, and UNKNOWN/FAILED outcome
7eddd52e562d009a6effb8c1cfd86e06ade3cb02. Original history has no deletions;
the recovery sequence changes no trusted objects or workflows. Four existing
positions restore; no new recruitment request or position is claimed.
Fresh HTTPS fetch still returned f407, followed by one normal fast-forward
push of the entire sequence. Independent ls-remote confirmed main 7eddd52.
The integration worktree absorbed this exact sequence by fast-forward,
preserving dirty administrative documents. The approved incident safety
closure is now published; National Energy expansion remains skipped by user.
