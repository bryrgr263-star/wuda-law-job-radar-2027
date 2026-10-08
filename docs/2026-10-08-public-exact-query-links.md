# Public exact query links: bounded delivery closure

This display-only refinement does not grant network access or change a Source, Admission,
Continuous Authorization, request plan, transport, Scheduler or business processor.

## Reproduced blocker

The shared public snapshot schema rejected every query-bearing link as PUBLIC_LINK_UNSAFE.
Both already-approved National Energy public job-detail URLs identify a public job using an
`id` query; the same exact URLs are used as announcement evidence. This would reject an otherwise
valid new public snapshot, not merely show an unavailable application link.

Snapshot creation and the existing JobBoard loader/render tests each reproduced this specific
failure before the implementation change. No live job request was made by either test.

## Narrow exception

The existing shared schema accepts only these two exact query-bearing link strings:

- `https://zhaopin.chnenergy.com.cn/annc/showgw?id=5a798bfe-a4d6-0be4-e063-98b4d40a088a`
- `https://zhaopin.chnenergy.com.cn/annc/showgw?id=5a798bfe-ac8c-0be4-e063-98b4d40a088a`

They are public recruitment job identifiers, not login credentials. String membership is exact:
extra parameters, another job UUID, another host/path, encoded parameter names, fragments,
credentials and HTTP are rejected. Every other query URL remains denied. Existing sensitive
text/path checks remain in force. Future query links are not automatically published.

This is a publication privacy allowlist, not another Source Registry or current selector. It
neither verifies an employer nor creates a Position. Only the existing validated current
ReadModel supplies the field. The exception never substitutes an announcement for an unavailable
application link, fills a field from Legacy, or fetches the destination.

## Browser and compatibility boundary

The existing browser loader consumes only the same-origin sealed snapshot. Its own resource URL
remains query-free; credentials remain omitted and redirects denied. Rendering an external
announcement anchor does not issue a recruiting request. The controlled browser test checks one
snapshot request, exact announcement preservation and null application link.

No envelope/payload version, field selection, canonical serializer, time source, hash, current
selector or historical artifact is changed. Existing no-query public snapshot validation and
deterministic generation remain covered by the unchanged four-current-position fixture tests.
The privacy-field allowlist and last-known-good/stale-SHA publication gates remain unchanged.

The historical test fixture now uses its explicit baseline rather than the growing development
HEAD: a local-only isolated checkout of the actual previously published commit
`fd2b64685cbce8faa03267a0a8fbce593bba70cc`. A new RED test first caught the previous HEAD-dependent
fixture. The corrected fixture passes the independently observed public payload SHA-256
`2d124ce10da19328d7f781933bdd0f21b6cb09b86fc777dbcefa62abebc0185b`. This is test-only pinning,
not a replacement for production current selection or a hard-coded public job count.

## Validation checkpoint

Focused snapshot, same-JobBoard, publication/LKG/rollback, Pages-policy and Architecture regression:
37/37 PASS. Separate Network Guard: 2/2 PASS. After adding the pinned historical-byte assertion,
snapshot/JobBoard regression: 13/13 PASS. TypeScript and diff check PASS. Independent runtime
review found no Critical/Important issue; its historical-byte coverage Minor was addressed with
the pinned test. Native root/subpath static build and fixture follow-up review are still being
collected; no complete deployment readiness claim is made from focused tests alone.

The first native build attempt failed at PUBLIC_DEPENDENCY_LOCK_MISMATCH before compilation:
the clean working lock had 4097 CRLF line endings while the committed blob had LF; content was
otherwise identical. The previously unmodified lock was restored to the exact committed blob
SHA-256 `82eb81e41c6a7e21663b1915a40156459eef8ecfc6fc5368aa3d7bfa969c4147` and its index stat
refreshed with zero content/staged diff. No lockfile update or dependency-integrity bypass was
made. The corrected-environment test completed with exit 1 after 1000 seconds: its root/subpath
build assertions completed, but publication failed at PUBLIC_PROCESS_B_VALIDATION_FAILED.
The restoration child has a 900-second execution limit and the wrapper suppresses the underlying
error. The isolated network-guarded worker completed exit 0 in 1437.624 seconds on the same
authoritative `ebaa639` state, restoring four unique current Positions with matching SHA binding.
This proves the worker can restore this state but does not retroactively reveal the suppressed
exception in the earlier test. Independent static investigation identified 65 full Raw-state
traversals and at least 9,360 Git subprocess reads during the 117-command replay. Publication
latency on this Windows environment remains a separate runtime limitation; no timeout or
integrity check has been weakened and the combined static-delivery test remains reported FAIL.
Independent follow-up review found no blocker in the pinned fixture delta. This does not make
the combined native publication validation PASS. Root/subpath builds, isolated restoration and
the public-link focused checks are separate evidence, not an all-green combined-suite claim.

No real acquisition, deployment, new authorization, personal evidence issuance or publication
occurred as part of this refinement. The earlier user-approved evidence-loss termination is a
separate production commit and does not reset cadence or reconstruct lost evidence.
