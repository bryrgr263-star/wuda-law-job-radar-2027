# Automatic Publication Handoff and GitHub Pages Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing Production Scheduler publication handoff to the existing sealed public-delivery engine, deploy the same trusted static JobBoard to GitHub Pages, contain the Legacy Pages writer, and retire Vercel after online acceptance.

**Architecture:** One reusable GitHub Pages workflow accepts an exact authoritative SHA from either the existing Scheduler or a publication-only manual retry. A small Pages adapter validates the live trusted release against Git ancestry, delegates all snapshot/build/current-selection work to the existing `presentation:publish` implementation, and exposes only the complete immutable release directory to Pages deployment. GitHub Pages becomes the sole public data entrance; Vercel is retired only after Pages acceptance.

**Tech Stack:** TypeScript, Node.js 24.19.0, pnpm 11.25.0, Next.js static export, Git, GitHub Actions, GitHub Pages, Zod, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-29-automatic-publication-pages-design.md`

## Global Constraints

- Reuse the existing Scheduler, `presentation:publish`, current selector, JobBoard, static-delivery builder, snapshot schema, and publication implementation.
- Keep the daily trigger at `17 2 * * *` (`02:17 UTC`) and the authoritative minimum interval at 86,400 seconds.
- Do not change source targets, authorization, network policy, Recall, Relevance, Requirement, PredicateResolution, Eligibility, PresentationDecision, or PresentationReadModel semantics.
- Publication begins only after CAS `COMMITTED` and fresh post-push Process B `PASS`.
- Publication-only retry must not invoke Scheduler, transport, acquisition, or Trusted Chain business commands.
- Public output remains strict allowlist only; never expose RawBlob, journal, Candidate Evidence, CandidateProfile, authorization, credentials, or private provenance.
- Missing/invalid live manifest after initial cutover, stale/unrelated SHA, integrity mismatch, or Pages failure must fail closed and preserve last-known-good.
- Legacy `sync-jobs.yml` must lose all crawl/export/Pages-write behavior before trusted cutover.
- GitHub Pages is the only supported production public data entrance after acceptance; Vercel retirement happens afterward and is not part of scheduled publication.
- Do not run a real recruitment acquisition or manually invoke the Production Scheduler while implementing or validating this plan.

## Review Focus

- A queued older publication sees a newer live Pages SHA and must fail before artifact upload; Task 1 pins this with an unrelated/reverse-ancestry test.
- Initial Legacy Pages has no trusted manifest, but only an explicit manual initial-cutover invocation may proceed; Tasks 1 and 3 pin both allowed and denied paths.
- A same-SHA retry with a different snapshot/manifest must fail rather than silently claim idempotency; Tasks 1 and 2 pin the exact hash binding.
- A failed Pages build/upload/deploy must not rerun acquisition or modify the committed Scheduler result; Tasks 3 and 4 pin command isolation and job dependency behavior.
- Manual invocation of the historical workflow must not crawl, export, or deploy Legacy data; Task 3 pins permissions and command absence.

---

## File Structure

- Create `lib/public-presentation/pages-publication.ts`: pure live-manifest parsing and Git ancestry precondition owner; no network or business projection.
- Create `scripts/prepare-github-pages-publication.ts`: publication-only CLI adapter that consumes an exact SHA, a locally captured live-manifest response, and delegates generation to `publishFromAuthoritativeCommit`.
- Create `.github/workflows/public-presentation-pages.yml`: sole GitHub Pages publication/deployment adapter for `workflow_call` and manual retry/cutover.
- Modify `.github/workflows/production-scheduler.yml`: export verified report fields and call the reusable Pages workflow after `READY`.
- Modify `.github/workflows/sync-jobs.yml`: retain a manual historical marker but remove crawler/exporter/Pages writer capability.
- Modify `scripts/run-production-scheduler-actions.ts`: emit a sanitized report already suitable for workflow output extraction; no publishing or deployment.
- Create `tests/public-presentation/pages-publication.test.ts`: stale/equal/advance/initial/integrity precondition tests.
- Create `tests/public-presentation/pages-cli.test.ts`: adapter argument, delegation, retry, and no-acquisition tests.
- Modify `tests/production-automation/github-actions-automation.test.ts`: scheduler handoff and unchanged safety controls.
- Create `tests/production-automation/pages-workflow.test.ts`: reusable workflow, permissions, Pages path, and Legacy containment contract.
- Modify `tests/architecture/public-presentation-boundary.test.ts`: dependency direction and forbidden import/command scans.
- Modify `docs/public-presentation-delivery-operations.md`: automatic handoff, Pages operation, retry, rollback, and Vercel retirement runbook.

### Task 1: Live Pages Release Precondition

**Files:**
- Create: `lib/public-presentation/pages-publication.ts`
- Create: `tests/public-presentation/pages-publication.test.ts`
- Modify: `lib/public-presentation/publication.ts`

**Interfaces:**
- Consumes: `PublicReleaseManifest`, `shaSchema`, canonical Git history in `repository_path`.
- Produces: `parsePublicReleaseManifest(value: unknown): PublicReleaseManifest` and `verifyPagesPublicationPrecondition(input: PagesPublicationPreconditionInput): PagesPublicationPreconditionResult`.

- [ ] **Step 1: Write failing precondition tests**

Add tests named:

- `manual initial cutover alone accepts an absent live trusted manifest`
- `scheduled publication rejects an absent or invalid live manifest`
- `descendant candidate advances and equal SHA plus equal snapshot is idempotent`
- `equal SHA with different snapshot is rejected`
- `older or unrelated candidate is rejected before publication`

Use temporary Git history with commits A -> B and unrelated C. Assert result status is exactly `INITIAL_CUTOVER`, `ADVANCE`, or `IDEMPOTENT`, and assert failures expose stable safe error codes without live response bodies.

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm exec tsx --test tests/public-presentation/pages-publication.test.ts`

Expected: FAIL because the module and exported manifest parser do not exist.

- [ ] **Step 3: Export strict manifest parsing**

In `lib/public-presentation/publication.ts`, export:

```ts
export function parsePublicReleaseManifest(value: unknown): PublicReleaseManifest;
```

It must use the existing strict `manifestSchema`; do not add a second schema.

- [ ] **Step 4: Implement the pure precondition owner**

In `lib/public-presentation/pages-publication.ts`, define:

```ts
export interface PagesPublicationPreconditionInput {
  readonly repository_path: string;
  readonly candidate_manifest: PublicReleaseManifest;
  readonly live_manifest: unknown | null;
  readonly allow_initial_cutover: boolean;
}

export type PagesPublicationPreconditionResult = Readonly<{
  status: "INITIAL_CUTOVER" | "ADVANCE" | "IDEMPOTENT";
  live_authoritative_sha: string | null;
  candidate_authoritative_sha: string;
}>;

export function verifyPagesPublicationPrecondition(
  input: PagesPublicationPreconditionInput
): PagesPublicationPreconditionResult;
```

Use `git merge-base --is-ancestor` against the full local checkout. Missing live manifest is accepted only with `allow_initial_cutover`; equal SHA requires equal snapshot hash and implementation SHA; reverse or unrelated ancestry throws `PAGES_STALE_OR_UNRELATED_PUBLICATION`.

- [ ] **Step 5: Run the focused tests and confirm GREEN**

Run: `pnpm exec tsx --test tests/public-presentation/pages-publication.test.ts`

Expected: all Task 1 tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add lib/public-presentation/publication.ts lib/public-presentation/pages-publication.ts tests/public-presentation/pages-publication.test.ts
git commit -m "feat: verify GitHub Pages publication ancestry"
```

### Task 2: Publication-Only Pages Preparation CLI

**Files:**
- Create: `scripts/prepare-github-pages-publication.ts`
- Create: `tests/public-presentation/pages-cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `publishFromAuthoritativeCommit(options)`, `readPublicationPointer(deliveryRoot)`, and Task 1 precondition.
- Produces: `prepareGitHubPagesPublication(input: GitHubPagesPublicationInput): Promise<GitHubPagesPublicationResult>` and script `presentation:prepare-pages`.

- [ ] **Step 1: Write failing CLI and orchestration tests**

Cover exact argument parsing, absent-live-manifest initial cutover, absent manifest denial for scheduled mode, stale SHA denial, same-SHA idempotency, release directory output, and two invocations that prove no Scheduler/transport/acquisition command or new authoritative commit occurs.

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm exec tsx --test tests/public-presentation/pages-cli.test.ts`

Expected: FAIL because the adapter command is missing.

- [ ] **Step 3: Implement the Pages preparation adapter**

Define:

```ts
export interface GitHubPagesPublicationInput extends PublicationOptions {
  readonly live_manifest_path: string | null;
  readonly allow_initial_cutover: boolean;
}

export interface GitHubPagesPublicationResult {
  readonly authoritative_sha: string;
  readonly snapshot_hash: string;
  readonly release_id: string;
  readonly release_path: string;
  readonly precondition: "INITIAL_CUTOVER" | "ADVANCE" | "IDEMPOTENT";
}

export async function prepareGitHubPagesPublication(
  input: GitHubPagesPublicationInput
): Promise<GitHubPagesPublicationResult>;
```

Generate the candidate through `publishFromAuthoritativeCommit`, read and validate its selected manifest, then apply Task 1 precondition before returning the release path. Never fetch recruitment or Pages URLs inside this module; the workflow captures the exact public manifest response into a temporary file.

- [ ] **Step 4: Add the package command**

Add `presentation:prepare-pages` that invokes the new script. Preserve `presentation:publish` unchanged.

- [ ] **Step 5: Run CLI and existing publication tests**

Run:

```bash
pnpm exec tsx --test tests/public-presentation/pages-cli.test.ts tests/public-presentation/cli.test.ts tests/public-presentation/publication.test.ts
```

Expected: PASS with zero acquisition calls and unchanged authoritative HEAD.

- [ ] **Step 6: Commit Task 2**

```bash
git add scripts/prepare-github-pages-publication.ts tests/public-presentation/pages-cli.test.ts package.json
git commit -m "feat: prepare sealed GitHub Pages releases"
```

### Task 3: Reusable Pages Workflow and Legacy Writer Containment

**Files:**
- Create: `.github/workflows/public-presentation-pages.yml`
- Modify: `.github/workflows/sync-jobs.yml`
- Create: `tests/production-automation/pages-workflow.test.ts`

**Interfaces:**
- Consumes: exact authoritative SHA and production stream ID; invokes Task 2 command.
- Produces: one serialized GitHub Pages artifact deployment and manual publication-only initial/retry entry.

- [ ] **Step 1: Write failing workflow contract tests**

Assert:

- both `workflow_call` and `workflow_dispatch` exist;
- exact SHA and explicit initial-cutover inputs exist;
- concurrency group is `pages` with `cancel-in-progress: false`;
- permissions are only `contents: read`, `pages: write`, and `id-token: write`;
- checkout uses exact input SHA with full history;
- live manifest request is fixed to the approved GitHub Pages origin, follows no redirect, and stores no headers/tokens;
- the workflow runs `presentation:prepare-pages`, uploads only the returned immutable release path, and uses `actions/deploy-pages`;
- no Scheduler, acquisition, Legacy exporter, Supabase, or Vercel command appears;
- `sync-jobs.yml` has no Pages permissions, crawler/export command, upload action, or deploy action and fails closed when manually invoked.

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm exec tsx --test tests/production-automation/pages-workflow.test.ts`

Expected: FAIL because the workflow does not exist and Legacy writer is still active.

- [ ] **Step 3: Add the reusable Pages workflow**

Use Node 24.19.0 and pnpm 11.25.0, exact checkout, frozen lockfile, fixed Pages base path `/wuda-law-job-radar-2027`, `$RUNNER_TEMP` delivery root, `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`. Write only sanitized SHA/hash/release-path values to `GITHUB_OUTPUT`.

- [ ] **Step 4: Contain the Legacy workflow**

Keep `workflow_dispatch` and a read-only job that exits nonzero with `LEGACY_PAGES_WRITER_RETIRED`. Remove Supabase secrets, crawler/exporter commands, Pages permissions, environment, upload, and deploy steps.

- [ ] **Step 5: Run workflow and architecture scans**

Run:

```bash
pnpm exec tsx --test tests/production-automation/pages-workflow.test.ts tests/architecture/public-presentation-boundary.test.ts
```

Expected: PASS; one Pages writer, zero Legacy writer capability.

- [ ] **Step 6: Commit Task 3**

```bash
git add .github/workflows/public-presentation-pages.yml .github/workflows/sync-jobs.yml tests/production-automation/pages-workflow.test.ts
git commit -m "ci: add trusted GitHub Pages delivery"
```

### Task 4: Scheduler-to-Pages Handoff

**Files:**
- Modify: `.github/workflows/production-scheduler.yml`
- Modify: `scripts/run-production-scheduler-actions.ts`
- Modify: `tests/production-automation/github-actions-automation.test.ts`

**Interfaces:**
- Consumes: existing `production-automation-report.json` fields `ending_sha`, `cas_result`, `post_push_process_b`, `publication_handoff`, and effective batch status.
- Produces: scheduler job outputs `authoritative_sha` and `publication_handoff`; dependent reusable Pages job.

- [ ] **Step 1: Write failing handoff tests**

Assert the same Scheduler command remains, schedule remains `17 2 * * *`, source/target contracts are untouched, job-level acquisition permissions remain contents-write only, report outputs are emitted only after scheduler success, and Pages is called only for `READY` with `allow_initial_cutover: false`.

Add a controlled automation test proving publication failure returns a failed publication job contract without changing the already committed ending SHA or causing a second acquisition.

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm exec tsx --test --test-concurrency=1 tests/production-automation/github-actions-automation.test.ts`

Expected: new handoff assertions FAIL.

- [ ] **Step 3: Expose sanitized workflow outputs**

Keep the existing report schema and safe failure behavior. Add an explicit post-command workflow step that parses only the existing safe JSON report, validates SHA/status literals, and writes `authoritative_sha` and `publication_handoff` to `GITHUB_OUTPUT`. Do not publish inside the scheduler script.

- [ ] **Step 4: Add the dependent reusable publication job**

Call `.github/workflows/public-presentation-pages.yml` only when the Scheduler job succeeded and handoff equals `READY`. Pass the exact ending SHA and production stream variable; initial cutover is always false. Preserve Scheduler concurrency, authorization, cadence, CAS, fencing, and failure propagation.

- [ ] **Step 5: Run focused automation and scheduler tests**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/production-automation/github-actions-automation.test.ts tests/production-persistence/production-source-activation.test.ts tests/production-persistence/scheduler-batch-manifest.test.ts
```

Expected: PASS; no real HTTP request.

- [ ] **Step 6: Commit Task 4**

```bash
git add .github/workflows/production-scheduler.yml scripts/run-production-scheduler-actions.ts tests/production-automation/github-actions-automation.test.ts
git commit -m "ci: hand off committed batches to Pages"
```

### Task 5: Documentation and Offline Acceptance

**Files:**
- Modify: `docs/public-presentation-delivery-operations.md`
- Modify: `tests/architecture/public-presentation-boundary.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: operator runbook and complete offline acceptance evidence.

- [ ] **Step 1: Add final boundary regressions**

Pin that publication modules do not import Scheduler/acquisition/Legacy modules, Scheduler does not implement projection/current selection, only the Pages workflow can deploy Pages, and Vercel Git deployment remains disabled.

- [ ] **Step 2: Update the operations guide**

Document automatic handoff, manual initial cutover, publication-only retry, live-manifest stale guard, Pages LKG/rollback limits, exact public URL/base path, Legacy writer retirement, and Vercel retirement after online acceptance.

- [ ] **Step 3: Run public-delivery and Web acceptance**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/public-presentation/*.test.ts tests/web/public-presentation-board.test.ts tests/production-automation/*.test.ts tests/architecture/public-presentation-boundary.test.ts
```

Expected: all tests PASS; four current positions, Zhenghan revision 2, Haier unchanged, unavailable application links preserved, Legacy calls zero.

- [ ] **Step 4: Run required repository validation**

Run:

```bash
pnpm typecheck
pnpm test:architecture
pnpm exec tsx --test tests/production-persistence/continuous-transport.test.ts tests/production-persistence/zero-cost-production-architecture.test.ts
pnpm build
git diff --check
```

Expected: PASS. If any change reaches frozen runtime/persistence outside this plan, stop rather than broadening tests or scope.

- [ ] **Step 5: Perform independent final review**

Review the complete diff against the approved spec, with special attention to stale-run ordering, Pages permissions, public artifact scope, no acquisition on retry, and Legacy writer containment. Fix validated blockers and rerun affected tests.

- [ ] **Step 6: Commit Task 5**

```bash
git add docs/public-presentation-delivery-operations.md tests/architecture/public-presentation-boundary.test.ts
git commit -m "docs: operationalize automatic Pages publication"
```

### Task 6: Controlled Push, Initial Pages Cutover, and Vercel Retirement

**Files:**
- No repository file changes expected after the implementation commits.

**Interfaces:**
- Consumes: reviewed implementation HEAD and the manual `public-presentation-pages.yml` entry.
- Produces: verified trusted GitHub Pages deployment and retired Vercel public data entrance.

- [ ] **Step 1: Verify fast-forward and inactive production jobs**

Confirm clean worktree, remote `main` ancestry, no running Production Scheduler or Pages publication, unchanged three-target scope, and no workflow trigger on push.

- [ ] **Step 2: Fast-forward push implementation**

Push normally to `main`; do not force, merge, rebase, or trigger Scheduler.

- [ ] **Step 3: Confirm push has no acquisition side effect**

Verify zero push-triggered Production Scheduler runs and no Vercel Git deployment.

- [ ] **Step 4: Manually dispatch initial publication-only cutover**

Invoke `public-presentation-pages.yml` with the exact pushed SHA and `allow_initial_cutover=true`. Do not dispatch `production-scheduler.yml`.

- [ ] **Step 5: Verify online Pages release**

Confirm deployment success, release manifest SHA, snapshot SHA-256, four unique positions, Zhenghan current revision 2, Haier current revision, truthful blocked statuses, separate announcement/application links, subpath assets, search/filter/sort/detail/export, and zero Legacy/API/Supabase requests.

- [ ] **Step 6: Verify retry and last-known-good behavior**

Run a publication-only same-SHA retry or equivalent dry verification allowed by the workflow contract; confirm no acquisition and idempotent current release. Do not create a newer business revision.

- [ ] **Step 7: Retire the Vercel public data entrance**

After Pages acceptance only, use authenticated Vercel project controls to disable/remove the production public domain or project deployment. Do not redirect and do not change GitHub Pages data. Verify the Pages URL remains available.

- [ ] **Step 8: Final report and pause**

Report authoritative SHA, public snapshot hash, Pages URL, workflow run/deployment IDs, stale protection, LKG, Legacy dependency zero, Vercel disabled, no real acquisition, unchanged schedule and target scope, and any remaining blocker. Do not trigger another Scheduler run.
