# Automatic Publication Handoff and GitHub Pages Delivery

## Status

Approved design direction for the production publication boundary after
Production Schedule Activation. This document does not activate publication,
deploy GitHub Pages, disable Vercel, or change Trusted Chain semantics.

## Objective

Make GitHub Pages the only production Web data entrance and connect the existing
sealed Public Presentation Delivery implementation to the existing Production
Scheduler after an authoritative CAS commit and fresh Process B verification.

The public site remains the existing JobBoard and consumes one deterministic,
public-safe snapshot derived from validated current PresentationReadModels.
Vercel is retired as a public data entrance only after the GitHub Pages cutover
passes online acceptance.

## Frozen Boundaries

- No second Scheduler, publication engine, JobBoard, current selector, or
  business truth source.
- No change to Recall, Relevance, Requirement, PredicateResolution,
  Eligibility, PresentationDecision, or PresentationReadModel semantics.
- No Legacy `jobs`, Supabase jobs, `match_score`, `non_law_rule`, or
  `is_published` input.
- No source, URL, domain, authorization, cadence, acquisition, or network-policy
  expansion.
- No publication before authoritative CAS commit and fresh Process B success.
- No acquisition during publication-only retry.
- No public Candidate Evidence, CandidateProfile, RawBlob, command journal,
  authorization state, credentials, or private provenance.
- The daily Scheduler remains `02:17 UTC`; the authoritative 86,400-second
  per-target minimum interval remains unchanged.

## Current State

- The Production Scheduler is the only automated acquisition owner and already
  supports manual dispatch plus one daily wake-up.
- `presentation:publish` already performs SHA-pinned restoration, existing
  Position-scoped current selection, allowlisted projection, deterministic
  snapshot generation, static JobBoard construction, release validation,
  local last-known-good pointer switching, stale-SHA rejection, and
  publication-only retry.
- The current GitHub Pages site is still the Legacy static mirror produced by
  the historical `sync-jobs.yml` workflow.
- The Vercel endpoint serves an independently deployed site and is not part of
  the future publication chain.

## Authoritative Data Flow

```text
Scheduled wake-up or manual scheduler dispatch
  -> existing Authorization / cadence / reservation checks
  -> existing acquisition and Trusted Chain
  -> authoritative CAS commit
  -> existing fresh Process B verification at exact ending SHA
  -> publication handoff containing only exact ending SHA
  -> existing presentation:publish implementation
  -> validated static release for /wuda-law-job-radar-2027
  -> GitHub Pages artifact deployment
  -> online manifest and snapshot verification
```

Publication never accepts caller-provided ReadModels or display fields. It
restores the exact committed SHA and obtains current models through the existing
validated Position-scoped selector.

## Workflow Architecture

### Reusable Pages Publication Workflow

Add one Pages delivery workflow that supports:

1. `workflow_call` from the existing Production Scheduler after successful CAS
   and post-push Process B verification.
2. `workflow_dispatch` for publication-only initial cutover and retry of an
   already committed authoritative SHA.

Both entry paths call the same publication CLI and the same Pages deployment
steps. They do not implement snapshot generation or current selection in YAML.

Required inputs are:

- exact 40-character authoritative SHA;
- production stream ID;
- repository Pages base path;
- explicit initial-cutover flag, accepted only for a manual invocation while
  the live Pages site has no trusted release manifest.

The workflow checks out the exact SHA with full history, installs locked
dependencies, restores Process B, generates a complete release outside the
repository, validates the release, uploads only the selected immutable release
directory, and deploys that artifact to GitHub Pages.

### Scheduler Handoff

The existing Scheduler job exports only its verified ending SHA and
publication-handoff status from its existing report. A dependent publication
job calls the reusable Pages workflow only when:

- scheduler execution completed successfully;
- CAS result is `COMMITTED`;
- post-push Process B is `PASS`;
- publication handoff is `READY`.

`NOT_REQUIRED` remains a no-op. A publication failure fails the publication job
but does not change the committed Scheduler batch, rerun acquisition, or rewrite
business history.

### Publication-Only Retry

A manual retry supplies the same exact authoritative SHA and invokes only the
reusable Pages workflow. It cannot call the Scheduler command or any transport.
The retry is idempotent for an already deployed equivalent release.

## GitHub Pages Current and Stale Protection

GitHub Pages deployment uses a single publication concurrency group with
`cancel-in-progress: false`.

Before uploading a non-initial release, the workflow reads the currently served
trusted `presentation/release.json` from the fixed Pages origin. It validates
the manifest schema and binding, then verifies with the checked-out full Git
history that the live authoritative SHA is an ancestor of, or equal to, the
candidate SHA.

- Equal SHA and snapshot is idempotent.
- Live SHA older than candidate permits deployment.
- Live SHA newer than, unrelated to, or unverifiable against candidate fails
  closed.
- Missing or invalid live manifest fails closed after initial cutover.
- Initial Legacy-to-trusted cutover is allowed only through an explicit manual
  invocation and cannot be used by scheduled runs.

This remote precondition complements the existing local publication pointer
checks. It prevents an old queued retry from replacing a newer deployed
release. GitHub Pages artifact deployment is treated as the platform deployment
boundary; the design does not claim a filesystem pointer transaction across
the CDN.

## Last-Known-Good and Rollback

- Static release generation and validation finish before Pages upload.
- A failure before successful Pages deployment leaves the previous deployment
  serving unchanged.
- Publication failure never falls back to Legacy or changes authoritative
  state.
- Retry uses the same exact authoritative SHA and performs no acquisition.
- Rollback is an explicit publication-only deployment of a previously verified
  trusted release. It is never an automatic Legacy fallback.
- The historical Legacy Pages writer loses Pages write/deploy permissions before
  trusted cutover, so it cannot overwrite the trusted site after manual use.

## Legacy Pages Writer Containment

`sync-jobs.yml` remains in the repository for historical reference and does not
become part of the Trusted Chain. Its Pages permissions and deployment steps are
removed or replaced by an explicit retired/fail-closed diagnostic action. It
must not crawl, export, upload, or deploy when manually invoked.

This is boundary containment, not broad Legacy cleanup.

## Vercel Retirement

GitHub Pages becomes the only supported production public URL:

`https://bryrgr263-star.github.io/wuda-law-job-radar-2027/`

The Vercel project is not included in automatic publication and must not remain
an independently updating or stale public data mirror. After GitHub Pages online
acceptance succeeds, the Vercel production data entrance is explicitly retired
through Vercel project/domain controls. No redirect is required because the
Vercel origin is not reliably reachable in the intended environment.

Retirement happens after Pages verification to avoid an availability gap. The
repository keeps Git-triggered Vercel deployment disabled.

## Public Security and Privacy Boundary

The deployed artifact contains only files accepted by the existing static
release allowlist:

- JobBoard HTML and approved static assets;
- `presentation/release.json`;
- one or more retained public snapshot envelopes required for safe cache
  transition;
- `.nojekyll` and approved static Next output.

The public snapshot remains governed by the existing strict schema and explicit
field allowlist. New trusted fields are private by default. Workflow logs and
artifacts must not contain credentials, private publication receipts, complete
delivery roots, repository metadata, `.git`, journal data, RawBlob data, or
candidate evidence.

## Failure Matrix

| Failure | Required result |
|---|---|
| Scheduler or Trusted Chain failure | No publication call; batch keeps truthful non-success status |
| CAS not committed | No publication call |
| Post-push Process B failure | No publication call |
| Snapshot/build/allowlist/integrity failure | Publication fails; current Pages site remains unchanged |
| Live manifest missing after cutover | Fail closed; no Legacy fallback |
| Candidate SHA older or unrelated | Fail closed as stale publication |
| GitHub Pages upload/deploy failure | Authoritative commit remains; previous Pages deployment remains LKG |
| Publication retry | Same SHA only; no Scheduler or acquisition invocation |
| Source NOT_MODIFIED and no publish-ready change | No fabricated business revision; publication may no-op |
| Legacy workflow manually invoked | No crawl/export/Pages write |
| Vercel remains reachable before retirement | It is not advertised as current; retirement follows Pages acceptance |

## Verification and Acceptance

### Offline and Workflow Tests

- Existing public snapshot, restoration, publication, static delivery, Web, and
  architecture tests remain green.
- Workflow contract verifies exact SHA handoff, CAS/Process B gates, no
  acquisition in retry, Pages-only permissions, serialized deployment, and no
  Legacy exporter.
- Stale, unrelated, missing-manifest, invalid-manifest, equal-SHA, and valid
  descendant cases are covered without live acquisition.
- Root and `/wuda-law-job-radar-2027` builds pass.
- The current four Position records render exactly once; Zhenghan uses current
  revision 2, Haier retains its current revision, and unavailable application
  links remain unavailable.
- TypeScript, Architecture, Network Guard, build, and `git diff --check` pass.

### Controlled Initial Cutover

After code and workflow review:

1. Push implementation without triggering acquisition.
2. Manually invoke publication-only initial cutover for the exact current
   authoritative SHA.
3. Verify Pages deployment and public manifest/snapshot hashes.
4. Run online smoke tests for four positions, uniqueness, status, links,
   search, filter, sort, details, export, and absence of Legacy/API calls.
5. Confirm previous trusted release can be redeployed without acquisition.
6. Retire the Vercel public data entrance.

No manual Scheduler run is needed for publication acceptance.

## Expected File Scope

- Modify `.github/workflows/production-scheduler.yml` for the verified handoff.
- Add `.github/workflows/public-presentation-pages.yml` as the sole Pages
  publication adapter.
- Modify `.github/workflows/sync-jobs.yml` only to contain the Legacy Pages
  writer.
- Modify `scripts/run-production-scheduler-actions.ts` only to expose safe
  verified handoff outputs if YAML cannot derive them safely.
- Add a small publication precondition/Pages-manifest verifier under the
  existing `lib/public-presentation` boundary if required.
- Add focused workflow, publication, static-delivery, Web, Architecture, and
  Network Guard tests.
- Update public-delivery operations documentation.
- Keep `vercel.json` Git deployment disabled; repository code does not perform
  Vercel publication.

## Non-Goals

- No Run 4 or real recruitment acquisition.
- No schedule, cadence, authorization, or network-scope change.
- No new data source or application-link work.
- No user-copy refinement for evidence-blocked positions.
- No business-rule or authoritative-history rewrite.
- No broad Legacy deletion.
- No paid database, object storage, or server runtime.
