# Public Presentation Delivery — Offline implementation / deployment handoff

## Ownership and runtime

Trusted business truth remains the existing sealed Decision/ReadModel and existing Position current selector. Public delivery is an allowlisted display projection, not another API or decision engine.

The browser fetches only `<base_path>/presentation/snapshots/<payload-sha256>.json`. The generated page pins the expected authoritative commit and snapshot hash, reuses the existing JobBoard, and shows the SHA/time/hash in the trace section. It needs HTTPS/WebCrypto, not `.git`, a Git executable, Supabase, PostgreSQL or credentials.

Missing/invalid data is an explicit error, never a Legacy/demo/old API fallback. Blocked records remain visible. Announcement and application links are separate; unavailable application is not replaced by announcement.

## Explicit publication-only entry

After this implementation is committed, from the installed/pinned Node/pnpm toolchain:

```powershell
pnpm presentation:publish --repository "<local-full-authoritative-repository>" --authoritative-sha "<40-character-committed-SHA>" --stream "initial-production-source-activation" --base-path "/wuda-law-job-radar-2027" --output "<private-delivery-root-outside-repository>"
```

Use an empty `--base-path` for a root/custom-domain site. This command does NOT acquire, dispatch Actions, push, deploy or enable schedule. It restores independently and stages a local public release only. Its code/client files are read from the same explicitly pinned commit, not the dirty checkout. The installed dependency lock must match that commit. Older commits lacking the public client fail explicitly, rather than filling files from the working tree.

The authoritative SHA includes the committed trusted state. UI-only implementation commits can still contain the same business history; the public artifact honestly binds that full SHA, not an invented earlier code revision. Historical baseline fixture builds with candidate client code are TEST_ONLY, not production releases.

## Output and privacy

```text
delivery-root/
  current.json                         # private staging pointer; complete old/new JSON
  releases/<manifest-hash>/            # this complete directory alone is the deploy artifact
    index.html, 404.html, index.txt...  # Next static Presentation-only resources
    _next/static/...                   # reused UI; no server code/source maps
    .nojekyll
    presentation/release.json
    presentation/snapshots/<hash>.json
  receipts/<uuid>.json                 # private publication operations; do NOT upload
  release-provenance/<manifest>.json   # private manifest-bound build scope; do NOT upload
```

Never upload delivery-root wholesale. Never upload repository, journal, Raw, candidate data, build workspace, env, `.git`, node_modules or private receipts. The release validator rejects files outside its static resource allowlist and rehashes every manifest file. Production publication requires a strict manifest-bound PRODUCTION build receipt; missing/TEST_ONLY provenance fails closed even when both SHAs match. The private receipt is retained separately per archived release and revalidated on pointer reads and rollback. This is local integrity/provenance validation, not a cryptographic signature or permission to promote arbitrary test artifacts.

Snapshot wire format is a strict envelope containing canonical payload string and SHA-256. Projection schema/version, authoritative SHA, commit timestamp, model/decision/revision IDs and display fields are inside the hash. SHA-256 is integrity, not a signature. TLS/deployment ownership is still required.

Generated time uses the fixed commit committer epoch; attempts/receipts use wall-clock separately. No publication-time timestamp, locale or local path enters canonical public bytes. Requirement summary is intentionally limited to dimension/subject scope/polarity/certainty; it is not the full job qualification specification. Newly added trusted fields never automatically become public.

## Last-known-good and independent retry

The producer prepares and validates a full immutable release before atomically replacing current.json. A single writer lock and pointer CAS protect races. Precommit failure preserves the exact previous pointer. Same SHA, sealed snapshot hash, implementation SHA and base path reuse the verified current release even when a rebuild changes asset manifest bytes; stale/non-ancestor SHA cannot overwrite a newer release. No DELETE of the old pointer is used to emulate atomicity.

On Windows only, transient EPERM/EACCES sharing violations retry the identical atomic rename at most eight times, with 20ms between attempts while the writer lock/CAS remains held. No fallback copy/delete occurs. Exhaustion fails explicitly and preserves the old pointer; publication can be retried independently. Native reader-race and injected transient/permanent refusal cases validate this behavior. Linux uses the same rename contract without the Windows sharing-violation retry; actual Linux deployment remains separately unverified in this Windows-only environment.

Repeat the identical publication command to retry, not the scheduler. It replays and validates the same committed SHA, does not issue a source request, and does not append business commands. A previous verified public snapshot and hashed UI assets are retained in a replacement bundle for old HTML during cache transition; they are not mixed into the new current array.

An unexpected process termination can leave `.publication.lock` or unreferenced staging/release directories. Do not automatically take over that writer or delete last-known-good. Confirm no active writer, inspect complete current.json and verified release, then separately authorize lock recovery. This implementation does not claim power-loss durability beyond the underlying filesystem.

If failure occurs AFTER pointer commit while writing the private receipt, inspect/validate current.json before retry. The public release may already be complete; do not assume the old pointer remains or roll back authoritative history. Incomplete operations reporting does not permit serving unverified bytes.

Rollback is a separate explicit operator action using `rollbackPublicRelease` with verified release ID, actor and expected current pointer hash. It switches delivery only, visibly displays the old SHA/time, and never reintroduces Legacy truth. Production rollback needs separate authorization. A local rollback receipt must be retained by the caller; never upload it as public data.

## Scheduler handoff — prepared, not activated

1. Existing scheduler completes its CAS push.
2. Existing fresh post-push Process B verifies the batch ending SHA.
3. Pass that exact ending SHA to the publication CLI; never a floating HEAD/branch.
4. CLI independently pins/replays, uses existing current selector and prepares the public release.
5. Only a separately authorized deployment adapter uploads the complete release directory.

Publication failure does not change the committed batch/acquisition results. `SchedulerBatchManifest.public_website_published` is not changed by this implementation. Existing publication callbacks do not grant ownership of public truth or permit callers to inject display objects. FAILED/PARTIAL acquisition can coexist with a valid current snapshot; publication never falsifies those acquisition outcomes.

No workflow changes are included. Both acquisition workflows remain manual-only. A future deployment step/manual publication workflow must use contents:read for generation and pages:write/id-token:write only for Pages deployment, serialized in one deployment concurrency group with cancel-in-progress=false. Do not use the Legacy mirror exporter.

## Later deployment / Final Cutover smoke checklist (NOT executed here)

- Choose/approve the actual Pages or existing site entrance, base_path and public URL; confirm environment permissions and no cost.
- Upload only the complete verified release. Observe actual deployment success; a local staging receipt is NOT a deployment result.
- Validate public release manifest, SHA and snapshot hash over deployed resources.
- Confirm the expected Position count from that authoritative current snapshot, uniqueness, truthful status/reasons, correct separate links and unavailable fields.
- Exercise search, status/employer filter, sort, details and CSV export; verify no jobs/Supabase/Realtime/old API request.
- Confirm root/project asset routes, HTTPS/WebCrypto, homepage cache refresh and old cached page behavior during replacement; GitHub Pages/CDN headers are not controlled by local rename or HTML meta tags.
- Simulate failed deployment and independently retry the same artifact, preserving the previous working site; confirm no acquisition occurs.
- Verify explicit previous-release deployment rollback without Legacy fallback or source requests.
- Only after these deployment checks may the deployment/cutover blocker be marked resolved. Run2, schedule activation and Legacy cleanup remain separate instructions.

## Implementation file inventory

Modified:

- `components/job-board.tsx`: public reason-redaction text only; existing UI retained.
- `lib/presentation-web/model.ts`: shared display-only input mapper; no public candidate association.
- `package.json`: publication-only command.
- `tests/web/presentation-board.test.ts`: private candidate-detail API assertion adapted to the display contract.

Added:

- `components/public-presentation-board.tsx`: thin load/error/version wrapper for the same JobBoard.
- `lib/presentation-web/public-loader.ts`: browser-only sealed snapshot reader.
- `lib/public-presentation/schema.ts`: strict public field allowlist and schema.
- `lib/public-presentation/snapshot.ts`: explicit projection/canonical bytes/SHA-256.
- `lib/public-presentation/restore.ts`: SHA-pinned fresh child Process B boundary.
- `lib/public-presentation/process-b-worker.ts`: existing replay/current-selector integration.
- `lib/public-presentation/publication.ts`: immutable release validation, private provenance, LKG/lock/CAS/ancestry/rollback.
- `lib/public-presentation/static-delivery.ts`: isolated temporary Next static adapter, same pinned client/CSS.
- `scripts/publish-public-presentation.ts`: publication-only orchestration/CLI.
- `tests/public-presentation/helpers.ts`: existing committed Run1 test input, no second recruitment fixture.
- `tests/public-presentation/snapshot.test.ts`: deterministic privacy/schema/wire regressions.
- `tests/public-presentation/restoration.test.ts`: pinned replay/TZ/HEAD drift/new current revision.
- `tests/public-presentation/publication.test.ts`: atomicity/faults/provenance/race/stale retry/rollback/asset boundaries.
- `tests/public-presentation/static-delivery.test.ts`: root/project builds, retained assets, CLI publish and retry.
- `tests/public-presentation/cli.test.ts`: explicit CLI arguments and bounded scope.
- `tests/web/public-presentation-board.test.ts`: sealed loader and truthful four-position display.
- `tests/architecture/public-presentation-boundary.test.ts`: dependency direction and public boundary.
- `docs/superpowers/specs/2026-09-27-public-presentation-delivery-design.md`: approved frozen design.
- `docs/superpowers/plans/2026-09-27-public-presentation-delivery.md`: approved implementation/verification plan.
- `docs/public-presentation-delivery-operations.md`: this operations, file and verification record.

No core Trusted Chain, authoritative persistence, committed Run1 history, main page/config/API, Legacy business logic or acquisition workflow changed.

## Offline acceptance record — 2026-09-27

| Verification | Result |
|---|---|
| Latest publication/schema/static/CLI/Web/new boundary aggregate | 22/22 PASS, exit 0 |
| Pinned Process B + timezone + invalid SHA/stream + legitimate revision2 | Three restoration cases PASS; original 26 journal entries retained, temporary fork appended 28 commands |
| Source HEAD moves after pin | 1/1 PASS; replay/time/current remain pinned to A |
| Existing Process B/restoration/Architecture/Network Guard aggregate | 57/57 PASS, exit 0 |
| Final Network Guard recheck | 2/2 PASS, exit 0 |
| TypeScript | PASS, exit 0 |
| Main Next build, telemetry disabled and offline guard enabled | PASS, exit 0; default mode unchanged |
| Isolated static builds | Root and project base path PASS; CLI publication/retry PASS; no deployment |
| Native concurrent pointer readers | PASS; 30 publish/rollback cycles, complete old/new payload only |
| Git diff check | PASS |
| Independent final review | No remaining validated implementation blockers; review was read-only |

Four current committed Run1 Positions render once each. All retain EVIDENCE_BLOCKED/RELEVANCE_ASSESSMENT_MISSING. Three Zhenghan application links remain NOT_YET_AVAILABLE. The legitimate revision2 test uses the existing business-chain worker and current selector only in an owned temporary fork; it never changes or replaces authoritative production Run1 history. Full CLI execution keeps its temporary repository HEAD unchanged and a repeat returns IDEMPOTENT without acquisition.

Initial acceptance found a test-only no-checkout clone index issue, process-local Windows long-path verifier configuration, and a real transient Windows pointer rename sharing violation. The test index now starts from its committed tree; verifier long-path configuration is process-local; pointer replacement uses the bounded fail-closed contract above. Independent review also led to decoded-token-path rejection, equivalent-data same-SHA retry, and mandatory preserved private production build provenance. These were not reclassified as historical baseline failures; their targeted regressions now pass.

NEW REGRESSION = 0 within the executed scoped acceptance. The unrelated complete business regression was not rerun because frozen core/runtime/persistence did not change. Known source-occurrence-materializer parity baseline failure remains untouched and NOT_RUN in this scope; no claim that all 1084 business tests passed is made.

Actual OS execution was Windows. Existing committed Linux authoritative bytes and cross-environment Process B regressions were reused; no Linux runner, WSL, Remote Actions or actual Pages/CDN deployment was executed. Local pointer atomicity does not establish deployed CDN behavior.

ZERO-COST PUBLIC PRESENTATION DELIVERY = VERIFIED (offline/local).

FINAL WEB CUTOVER BLOCKER = REMAINS (actual deployment/handoff activation and deployment smoke acceptance). Website runtime Git/DB dependency and local publication capability gaps are closed; this does not claim an automatically updating online website. No Run2, network acquisition, push, schedule activation, Final Cutover or Legacy cleanup was executed.
