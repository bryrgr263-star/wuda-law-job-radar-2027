# Fixed-commit Raw replay latency

## Bounded decision

The user delegated continuous closure and explicitly requested the next step. Repair the
publication replay bottleneck without increasing time limits, changing authoritative bytes,
altering business rules or sending another acquisition request.

The same 117-command production worker passed in 1437.624 seconds before this change. The
publication wrapper allows 900 seconds. Independent static inspection identified 65 complete
Raw-state traversals, including at least 9,360 Git reads in the acquisition loops alone.
The earlier wrapper suppressed its underlying exception; that historical exception remains
unknown, even though the isolated successful run demonstrates the latency problem.

## Contract and implementation

Reuse the existing Git Raw owner. Retain one private validated state for one exact immutable
Git commit. The full existing validator must succeed before a state can be retained. Every
public entry still resolves HEAD; a changed commit requires complete validation. Failed
validation is never retained. Store and return independent structured clones so callers cannot
mutate retained evidence. No multi-commit/unbounded cache or new authoritative registry exists.

Git immutable objects at a fixed commit remain the trust input. This process-local optimization
does not support adversarial replacement of the Git object database during replay; that is
outside the immutable-checkout contract. Fresh processes always perform their initial full
validation. Raw object reads and hash checks outside the state traversal remain unchanged.

## Verification plan

1. Reproduce repeated Git reads with a real Git fixture before changing the owner.
2. Verify one traversal for the same commit, clone isolation, validation after HEAD advancement,
   and repeated rejection of a newly committed corrupt state.
3. Run the existing Raw persistence suite, TypeScript and diff check.
4. Replay the actual fixed production SHA in an independent network-guarded worker; compare its
   complete canonical output with the previously recorded successful worker, not just IDs.
5. Run native root/subpath static delivery with the existing 900-second limit, plus affected
   publication, Architecture and Network Guard checks. Collect independent review.

The first real regression failed as expected: repeated immutable reads were 20 instead of 10.
The existing Raw suite passed 13/13. TypeScript caught a test-only attempt to mutate a readonly
array; the mutation probe now uses Object.defineProperty without a type assertion. TypeScript
then passed. An initial worker invocation correctly rejected a SHA/checkout mismatch after the
development HEAD had advanced; no invariant was bypassed. The corrected independent checkout
pins actual `ebaa63918050a829e75efd77c780b65609c14206` and completed exit 0 in 249.796 seconds.
Its full parsed output equals the previously recorded successful 1437.624-second output,
including complete current models, IDs, integrity hashes and authoritative metadata. This is
approximately a 5.8-fold reduction on the measured local environment, not a cross-host benchmark.

Independent static review found no blocker. Native combined root/subpath build, publication and
same-SHA retry passed in 382.052 seconds without increasing the 900-second restoration limit.
The wider affected suite completed 75 tests: 74 PASS and one test-fixture mismatch. The previously
changed shared published baseline has 51 commands, while the original Run 1 revision worker
requires 26. Only that test's replay baseline was restored to its original exact `6efa49f` commit;
no assertion, timeout or historical evidence was weakened. The isolated affected test then
passed in 659.288 seconds. This was a test regression from the earlier fixture pin, not an
unchanged historical baseline failure, and is recorded separately from the cache repair.

Architecture, Network Guard, Raw persistence and public delivery checks passed in that executed
scope. TypeScript and diff check passed after the final test change. No whole-project regression
claim is made. No Scheduler, authorization, cadence, publication deployment or production history
is modified by this task.
