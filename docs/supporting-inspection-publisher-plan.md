# Bounded supporting claim publication

Base 72d3b77. New publisher, dedicated tests, this plan only. Committed foundation and parent adapter/enrichment remain untouched.

TDD: local-bare-Git claim publish and exact committed readback; reject spent/duplicate/unresolved claims, dirty/stale context, changed source refs, remote divergence, push failure and ambiguous acknowledgement. Use existing GitSourceRegistry appendVersion validation and assertAuthoritativeHead; no ContinuousRecord semantics, retries, rearming, transport, Raw trust flags, grants or Scheduler wiring.

Return only ordinary committed source-version/head references after exact fresh repository readback. No trusted Raw proof or network-send capability is created. Failures leave state/claim untouched for manual diagnosis; do not reset, release or retry.

Tests use temporary local Git repositories only. No worktree commit/push, live network, authorization or transport call.

Results: RED observed for absent durable publisher, and again for two identical claims published at the same parent/fixed Git timestamp returning two readback proofs. GREEN: 7/7 publisher tests, including rejected push, ambiguous acknowledgement (one push only), post-push authoritative divergence, duplicate/spent target and competing fresh-process publisher. TypeScript noEmit/incremental=false and diff check exit 0. The unresolved-claim assertion was additionally made explicit and rechecked.

Publication snapshots the supplied untrusted version, validates its original SourceAdmission contract using only committed source persistence, requires new CLAIMED revision 1, rejects authorization/run/URL reuse and unresolved CLAIMED/UNKNOWN state, and refuses dirty/unrelated staged data. Existing appendVersion owns schema/context/lifecycle validation. The publisher follows the existing authoritative HEAD check and normal non-force push pattern, pins the exact new commit SHA rather than mutable HEAD, then instantiates a fresh persistence reader and verifies exact HEAD, unchanged history/Continuous records and exact appended claim bytes before returning ordinary source references.

Ruling: a unique publication nonce is only part of the Git commit message, never the artifact or authority. Without it, simultaneous identical claim commits can share a SHA and a second normal push can report up-to-date; the dedicated RED reproduced this. Distinct commit identities make the competing sibling push fail non-fast-forward while preserving claim/historical bytes. No Continuous code was changed.

Failures are propagated without retries, reset, release or terminalization; a local or remotely committed CLAIMED remains for manual diagnosis. UNKNOWN conservatively blocks subsequent publication. Returned data is only committed_head plus the original source claim version, not trusted Raw, an execution seal, verified flag or a transport capability. Integration must still recheck authority immediately before actual send, capture/persist real receipt/Raw and explicitly terminalize through the existing owner. No runtime/Scheduler/Pages/capture wiring or production-ready claim.
