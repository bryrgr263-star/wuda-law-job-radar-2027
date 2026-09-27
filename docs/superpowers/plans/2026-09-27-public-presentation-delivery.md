# Zero-cost Public Presentation Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a validated, deterministic public snapshot of the existing authoritative current PresentationReadModels to the existing JobBoard without runtime Git or a database.

**Architecture:** Pin one authoritative commit, replay through existing Process B and consume existing Position-scoped current selection. Project a strict public schema, build an isolated static bundle that reuses the single UI, then commit only the complete verified release pointer. Publication is independent of acquisition and never changes trusted business truth.

**Tech Stack:** Existing TypeScript/Node 24.19.0/pnpm 11.25.0, Git, Next.js/React, node:test/tsx, browser WebCrypto. No new product dependencies or paid services.

**Spec:** `docs/superpowers/specs/2026-09-27-public-presentation-delivery-design.md`

## Global Constraints

- Human approved Native implementation and one final independent commit; no push, deployment or activation.
- Baseline fixture SHA: `6efa49f2c55e49ea23c0fd4df42ec43f109d3353`; never rewrite its 26-command Run1 history or use uncommitted revision2 as truth.
- All publication phases bind one explicit full SHA A, never drift to HEAD.
- Public schema/projection/envelope versions are exactly the v1 constants in the spec.
- Existing authoritative processors/current selector are the only business/current authority.
- No Run2, real-source requests, Actions execution, deployment, schedule, cutover, new sources, Legacy cleanup or Trusted business changes.
- Two collection workflows remain manual-only; this plan does not add a workflow.
- Public fields are constructed explicitly; no complete-model spread, raw/journal/candidate/private provenance or secrets in artifact.
- Snapshot size limit8MiB, position limit20,000, string limit16,384 UTF-16 units; no silent truncation.
- Known parity baseline failure is untouched; verification evidence must distinguish PASS/NOT_RUN/baseline failure.
- Future implementation ends with one explicitly approved independent commit, no push. No task-level commits unless later authorized.

## Review Focus

1. A reader racing a pointer switch must see one complete old/new release, including Windows replace behavior — Task3 fault/race test.
2. A delayed retry for old SHA must not overwrite newer authoritative publication — Task3 stale ancestry/CAS test.
3. Pages project subpath and a cached old HTML must not accidentally resolve a new snapshot — Task5 subpath/pinned-loader test.
4. A new ReadModel extension or nested summary key must not silently become public — Task1 sentinel/schema tests.
5. A valid empty current collection must not be confused with corrupt/null snapshot — Tasks2/4 explicit empty/error tests.

---

## File map (planned, not created by this round)

| Action | File | Responsibility |
|---|---|---|
| Create | `lib/public-presentation/schema.ts` | Browser-safe strict public types/runtime validation and fixed version/reason enums |
| Create | `lib/public-presentation/snapshot.ts` | Server-only explicit projection, canonical envelope generation/validation |
| Create | `lib/public-presentation/restore.ts` | SHA-pinned private checkout + fresh Process B; no acquisition or resolver injection |
| Create | `lib/public-presentation/process-b-worker.ts` | Reuse Raw/source/journal replay and existing current selector; private result transport |
| Create | `lib/public-presentation/publication.ts` | Release validation, immutable staging, writer lock, pointer CAS, retry/rollback |
| Create | `lib/public-presentation/static-delivery.ts` | Temporary Next static build adapter; asset allowlist, manifest binding and basePath |
| Create | `lib/presentation-web/public-loader.ts` | Same-origin pinned snapshot fetch, byte hash/schema validation, mapper call |
| Create | `components/public-presentation-board.tsx` | Thin load/error/trace wrapper mounting existing JobBoard only |
| Modify | `lib/presentation-web/model.ts` | Factor common display-input mapping; omit candidateId from public contract, no business judgment |
| Modify, if required | `lib/presentation-web/loader.ts` | Retain Git preparation loader; adapt display contract without exposing private candidate association |
| Modify | `tests/web/presentation-board.test.ts` | Adapt candidate-detail assertion to private API query; keep current four-model tests |
| Create | `scripts/publish-public-presentation.ts` | Explicit A/stream/basePath/output CLI, independent retry, no scheduler invocation |
| Modify | `package.json` | Add `presentation:publish` local CLI command only |
| Create | `tests/public-presentation/snapshot.test.ts` | Projection/schema/privacy/deterministic bytes |
| Create | `tests/public-presentation/restoration.test.ts` | Pin/replay/current/new-revision/locale/HEAD-drift evidence |
| Create | `tests/public-presentation/publication.test.ts` | Atomicity/fault/CAS/retry/rollback/ancestry |
| Create | `tests/public-presentation/static-delivery.test.ts` | Reused UI/static bundle/path/privacy/build contract |
| Create | `tests/web/public-presentation-board.test.ts` | Browser loader/wrapper/render/filter/search/details/export/error tests |
| Create | `tests/architecture/public-presentation-boundary.test.ts` | Dependency direction, no legacy/server/private-state in public bundle |
| Create | `docs/public-presentation-delivery-operations.md` | Publication-only CLI, scheduler handoff, future Pages deploy/rollback/smoke |

Unchanged: main `app/page.tsx`, `next.config.mjs`, `app/api/**`, Preview, Legacy UI/business, authoritative persistence implementation, both workflow files. Existing global CSS reused as input, not copied into a second maintained stylesheet.

## Planned interface contracts

Types below name contracts to implement, not code introduced by this round.

- `PublicSnapshotPayload`, `PublicSnapshotEnvelope`, `PublicPosition`, `PublicField<T>`: spec section4, strict keys.
- `PinnedCurrentInput`: `{ authoritative_sha, generated_at, current_snapshot }`; server-private ProcessB output, scopePRODUCTION and snapshot.authoritative_head match enforced before return.
- `createPublicSnapshot(input: PinnedCurrentInput): PublicSnapshotEnvelope` in snapshot.ts; explicit white-list only.
- `validatePublicSnapshot(envelope: unknown, expectedSha: string, expectedPayloadHash: string): PublicSnapshotPayload` in snapshot.ts; full server canonical/hash/schema checks.
- `restorePinnedCurrent({ repository_path, authoritative_sha, stream_id }): Promise<PinnedCurrentInput>` in restore.ts; independently spawned ProcessB, pinned temp checkout, cleanup confined to owned temp paths.
- `PublicReleaseManifest`: schema, authoritative_sha, implementation_sha, snapshot_path/hash, base_path, files(path/size/hash), bundle_manifest_hash; no self-reference.
- `prepareStaticDelivery({ snapshot, implementation_repository, implementation_sha, base_path, staging_path }): Promise<PublicReleaseManifest>` in static-delivery.ts. Production requires implementation_sha=A; TEST_ONLY fixture receipts explicit.
- `publishPublicRelease({ delivery_root, staged_release_path, manifest, expected_pointer_hash }): Promise<PublicationReceipt>`; only verified bytes/manifest from pipeline, not business input.
- `rollbackPublicRelease({ delivery_root, release_id, expected_pointer_hash, actor }): Promise<PublicationReceipt>`; explicit validated old release, never invoked automatically.
- `PublicationReceipt`: release-id/A/public hashes, actionPUBLISH/IDEMPOTENT/ROLLBACK, previous pointer hash, safe operation timestamp; private audit only.
- `loadPublicPresentationBoard({ snapshot_url, expected_sha, expected_payload_hash, fetcher }): Promise<{ jobs, authoritative_sha, generated_at, snapshot_hash }>`; browser-safe, same-origin credentialsomit redirecterror, WebCrypto.
- `PublicPresentationBoard` props `{ snapshotUrl, authoritativeSha, snapshotHash }`; existing JobBoard receives display jobs, no business state recalculation.
- `PresentationDisplayInput`: position/Decision/ReadModel IDs, revision, status, reasonCodes, the existing PresentationField-shaped employer/title/locations/year/batch/links, a summary containing only dimension/subject_scope/polarity/certainty, and updatedAt. No upstream, Candidate Evidence or candidate ID. Both trusted and public adapters construct these named fields explicitly.
- Common mapper `toPresentationDisplayInputJob(input: PresentationDisplayInput): PresentationDisplayJob`; public adapter validates its schema before passing fields. Existing `toPresentationDisplayJob(model)` delegates the display-only field mapping, never brand-casts public data. If the existing trusted preparation mode needs a richer summary, keep it explicitly in that adapter; do not publish parser/value/applicability by accident.

## Task 1 — Public contract, projection and deterministic sealing

Files: schema.ts, snapshot.ts, tests/public-presentation/snapshot.test.ts.

Consumes: existing canonicalSerialize/canonicalHash on server, current sealed Presentation fields. Produces: public contract, create/validate functions used by Tasks2–5.

- [ ] Write failing tests: exact schema versions; `snapshot_same_sha_bytes_identical`; `projection_explicit_allowlist_drops_private_extensions`; `nested_summary_no_factid_parser_or_private_value`; `unsafe_url_rejects_publication`; `unknown_reason_is_redacted_without_hiding_job`; `oversized_payload_rejected_not_truncated`.
- [ ] Assertions: independently permuted object keys yield identical payload/envelope bytes; UTF-8 has no BOM/extra newline; generated_at is fixed; positions use ordinal order; missing application stays NOT_YET_AVAILABLE; Candidate/Raw/token sentinels are absent; duplicates fail; three permitted statuses remain and NOT_DISPLAY is excluded without recalculation.
- [ ] Run `pnpm exec tsx --test tests/public-presentation/snapshot.test.ts`, expect focused FAIL from absent implementation, not network access.
- [ ] Implement named public functions using explicit construction. Server calls the existing canonical serializer; client schema module imports no Node crypto/core runtime. Summary allowlist follows the spec; unknown reasons produce REDACTED without changing status.
- [ ] Rerun focused tests; require PASS and byte-vector cases for escaped Unicode/newline/numbers under TZ/locale variations. These are wire-format unit cases, not a second real recruitment fixture.

## Task 2 — Pinned fresh Process B / existing current selection

Files: restore.ts, process-b-worker.ts, restoration.test.ts.

Consumes: Task1 contracts and existing bootstrapTrustedChainCompositionRoot/createRawValidatedRestorationJournal/Git stores. Produces: PinnedCurrentInput; never a new trusted registry or current selector.

- [ ] Write failing tests: `run1_pinned_current_four_honest_models`; `head_moves_after_pin_result_still_A`; `process_b_corrupt_seal_rejects`; `scope_mixing_rejects`; `valid_empty_distinct_from_null`; `new_authoritative_revision_replaces_existing_position`; `fresh_child_no_parent_registry_dependency`.
- [ ] Use the existing real baseline A, no duplicate real-source fixture. Assert 4 unique Positions, 26 restored original commands, all blocked/missing-relevance, and 3 unavailable application links. Capture authoritative object hashes before/after; no new commands or acquisition in the real baseline replay.
- [ ] Test a newer revision only in an owned temporary Git fork: reuse the existing production-chain processor/test helper to append a legitimate revision after original history; never edit sealed historical bytes or convert synthetic candidate evidence into production. The existing current selector must return exactly one model per Position.
- [ ] Run `pnpm exec tsx --test --test-concurrency=1 tests/public-presentation/restoration.test.ts`, require expected failing newcontracts first.
- [ ] Implement full SHA validation, safe short temporary clone/detached A, commit epoch metadata, child restoration, resolver/model equality and the existing current selector call. Worker journal append refuses; full restore results remain private. Child errors report safe codes only.
- [ ] Rerun tests and `tests/production-persistence/cross-environment-process-b.test.ts` serially. Prove expected A throughout; en-US/zh-CN and different timezones yield identical public bytes. Report actual OS coverage honestly; do not trigger Actions to obtain Linux evidence.

## Task 3 — Immutable release / pointer CAS / publication-only retry

Files: publication.ts, publication.test.ts.

Consumes: validated snapshot/manifest (manifest shape in spec). Produces: publication receipts and completeold/newpointer behavior; no authorityjournal writes.

- [ ] Write failing tests: `publication_failure_keeps_previous_pointer`; `reader_race_sees_complete_old_or_new`; `same_release_same_bytes_idempotent`; `hash_collision_rejects`; `concurrent_writer_CAS_rejects`; `stale_A_cannot_overwrite_new_B`; `rollback_explicit_verified_release_only`; `retry_does_not_acquire_or_append`.
- [ ] Inject failure before write, after flush, after immutable-release rename and before pointer commit. Compare exact old pointer bytes after every precommit failure; never unlink the old pointer. Include Windows replacement and path traversal/symlink cases.
- [ ] Run `pnpm exec tsx --test tests/public-presentation/publication.test.ts`, expect FAIL from missingpublicationcode.
- [ ] Implement immutable content-addressed releases, strict file rehashing, atomic pointer replacement, lock/CAS and ancestry checks. If the filesystem cannot replace atomically, stop with a blocker; never simulate atomicity using delete+rename.
- [ ] Rerun tests; require no authoritative diff, correct receipts, and last-known-good preserved after writer failure. Same-A retry reuses sealed bytes; explicit rollback retains visible old-SHA labeling.

## Task 4 — Public loader and one JobBoard

Files: public-loader.ts, public-presentation-board.tsx, model.ts, optionalloader.ts, existing/newWebtests.

Consumes: Task1 publicschema/envelope. Produces: displayjobarray in existingUI, safe loading/error/SHAbanner. No new website/eligibility/PresentationAPI.

- [ ] Write failing tests: `public_run1_renders_four_existing_cards`; `reason_and_missing_application_preserved`; `invalid_hash_sha_schema_has_explicit_error_no_legacy`; `valid_empty_has_empty_ui_not_validation_error`; `failed_refresh_retains_lkg_with_visible_error`; `search_filter_sort_detail_export_reused`.
- [ ] Verify 4 rendered cards, 3 unavailable application links, truthful blocked status/reason and exact fixture links. Instrument fetch: only pinned same-origin JSON, credentials omitted, redirects rejected, and no old jobs API/Realtime/recruitment source URL calls.
- [ ] Run both Webtestfiles, confirm missingpublicloaderfails before implementation.
- [ ] Implement exact UTF-8 WebCrypto validation, strict public schema, shared mapper input and thin wrapper. Remove unused candidateId from the public display contract; use a privately obtained Opportunity ID in the existing candidate-detail API test instead of publishing it. No forged ReadModel type assertion.
- [ ] Render authoritative SHA/generated time/hash outside existing card UI. The wrapper owns loading/error handling only; existing search/detail/export code remains authoritative UI. Reject unexpected origins, redirects and paths; unsupported WebCrypto is an explicit failure, not a database fallback.
- [ ] Rerun Web tests; require Legacy calls=0 and SSR/shared mapper tests PASS. Exercise interaction helpers offline; no recruitment site access or browser automation.

## Task 5 — Isolated static delivery bundle

Files: static-delivery.ts, static-delivery.test.ts, public-presentation-boundary.test.ts.

Consumes: Task1sealed snapshot, Task4oneUI. Produces: validatedmanifest and completeNextstaticoutput from ownedtempworkspace.

- [ ] Write failing tests: `bundle_reuses_same_UI_and_CSS`; `project_subpath_links_and_snapshot_resolve`; `old_html_pins_old_hash_not_new_current`; `bundle_excludes_server_private_legacy_state`; `binding_mismatch_rejects_whole_bundle`; `manifest_no_hash_self_reference`.
- [ ] Assert the generated entry only loads PublicPresentationBoard; reuse the same component/mapper/CSS bytes; runtime import graph cannot reach Git/Supabase/old jobs/Trusted processors. Scan compiled output with secret sentinels, not source strings alone. Asset paths must be relative; exclude source maps and symlinks.
- [ ] Add cache-transition tests: carry previous verified snapshot/hashed assets into a replacement release, reject different bytes at the same path, preserve the new homepage, and ensure an old HTML never reads the new payload. An expired older asset reports a visible availability error.
- [ ] Run focusedtests, requirefailsfromabsentadapter first.
- [ ] Generate only temporary Next entry/layout/config, copy explicit client source files and necessary erased type-only definitions, and reuse deterministic dependencies. Build with output=export/basePath/trailingSlash in isolation; leave the main page/config/API/Legacy unchanged. Pin A+implementation commit in the manifest; historical fixture builds are TEST_ONLY.
- [ ] Canonical manifest file inventory excludes the manifest itself; compute its hash, then release ID. Validate and rehash snapshot/assets before the Task3 pointer switch. Output/runtime must work without repository/.git.
- [ ] Run isolated static builds offline for root and project subpath; check URL routing/assets/snapshot. If it requires a maintained copy of business UI or changed dynamic app semantics, stop STATIC_DELIVERY_ADAPTER_BLOCKED rather than improvise.

## Task 6 — Publication CLI / scheduler handoff documentation

Files: publish-public-presentation.ts, package.json, operationsdoc; tests may live inpublication/staticdeliverytestfiles.

Consumes: Tasks1–5 interfaces. Produces: `presentation:publish` CLI and independentretry instruction, not liveworkflowactivation.

- [ ] Write failing CLI tests: missing full SHA rejected; wrong stream rejected; no implicit HEAD; offline Run1 publication succeeds; retry has no acquisition; output stays outside authoritative repository; stale commit cannot overwrite a newer published commit.
- [ ] Test package command and CLI contract using temporary repositories/output. Do not accept production writer options.
- [ ] Implement flags `--repository`, `--authoritative-sha`, `--stream`, `--base-path`, `--output`; no automatic acquisition/deploy/workflow dispatch or historical writes. Ordinary publish never automatically rolls back.
- [ ] Document the existing automation ending_sha/fresh Process B handoff and independent retry; callback display objects are never trusted publication input. FAILED/PARTIAL batches can have valid current data, but their outcomes must not be rewritten. No scheduler source/workflow changes in this plan.
- [ ] Document future Pages upload/deploy permissions, concurrency, rollback and smoke checks as unexecuted procedures, separate from local pointer atomicity evidence.
- [ ] Run focused tests with the offline Network Guard; all phases must bind the same A.

## Task 7 — Offline acceptance / review / pause

Files: all planned deliverables; no added scope.

- [ ] Self-review spec coverage: map every requirement to Tasks1–6; inspect file inventory, allowlists, trace privacy and manifest bindings.
- [ ] Run publication/Web tests serially: `pnpm exec tsx --test --test-concurrency=1 tests/public-presentation/*.test.ts tests/web/*.test.ts`.
- [ ] Run existing Process B/restoration, Architecture and Network Guard tests serially: `pnpm exec tsx --test --test-concurrency=1 tests/production-persistence/cross-environment-process-b.test.ts tests/pipeline/trusted-chain-restoration.test.ts tests/architecture/*.test.ts tests/production-persistence/architecture-boundary.test.ts tests/production-persistence/zero-cost-production-architecture.test.ts tests/production-persistence/production-scheduler-architecture.test.ts tests/production-persistence/continuous-architecture.test.ts tests/p2-03/network-guard.test.ts`. No guard-count magic number.
- [ ] Run `pnpm typecheck`, normal `pnpm build`, and isolated static build under the existing offline Network Guard with telemetry disabled. Do not persistently switch preparation/deployment environment values.
- [ ] Run `git diff --check`; inspect the full diff, dependency graph and output privacy. Confirm both manual-only workflow files unchanged, old production truth diff=0, and original authoritative history diff=0.
- [ ] Review whether core persistence/runtime changed. Expected NO; if YES, stop for scope approval before choosing low-concurrency full regression. Do not claim all1084 passed after running only focused tests.
- [ ] Request a fresh independent review of publication boundaries/atomicity/determinism/reused UI; address only approved-scope issues using TDD.
- [ ] Report actual PASS/FAIL/NOT_RUN, NEW REGRESSION within the verified scope, and local-versus-deployment readiness. Do not mark Final Cutover resolved before deployment acceptance.
- [ ] Only after human implementation approval and actual verification create one independent implementation commit containing the actual file list; no push. Do not commit in this documents-only round.
- [ ] Pause; no Run2, website requests, deployment, schedule or cleanup.

## Review handoff

原设计轮只生成设计与计划；后续人工已批准 Native 实施及独立最终审查。任务级 checkbox 保留原验收清单语义；实际执行与验证摘要见 `docs/public-presentation-delivery-operations.md`。本轮不得部署、push 或自动推进后续阶段。
