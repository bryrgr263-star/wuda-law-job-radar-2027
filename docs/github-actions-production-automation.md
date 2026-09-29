# GitHub Actions Production Automation

The production workflow is an execution boundary around the existing Production Scheduler Batch. It does not implement acquisition, authorization, Trusted Chain, presentation, or publication policy.

## Repository ownership

- Code repository and Git append-only authoritative state currently share the selected authoritative branch.
- GitHub Actions artifacts are diagnostics only and are never authoritative state.
- Public presentation publication is a separate handoff from committed `PresentationReadModel` state.

## Activation

The workflow supports manual dispatch and one daily scheduled wake-up at `02:17 UTC` (`10:17 Asia/Shanghai`). The cron is not authorization and does not replace the authoritative 86,400-second per-target minimum interval. The workflow fails closed unless the repository variable `PRODUCTION_SCHEDULER_ACTIVATION` is exactly `ENABLED`. The production adapter registry contains only the Zhenghan and Haier official HTML adapters. Their versioned Source, Admission, allowlist, and revocable Continuous Authorization state is committed under `production-source-state/`; Canary and test modules are not production dependencies.

`PRODUCTION_STREAM_ID` is a required repository variable. It must identify the committed Trusted Chain journal; there is no fallback stream. The activation variable and stream ID are configuration, not source authorization.

Every source request remains subject to committed Source Admission, Continuous Authorization, cadence, revocation, pending-attempt, and expected-parent CAS checks. Neither `workflow_dispatch` nor `schedule` is authorization. Existing workflow concurrency serializes wake-ups without cancelling an in-progress production run.

## Credentials

Only the ephemeral repository-scoped `GITHUB_TOKEN` is used. The workflow grants `contents: write` and no other write permission. The token is provided to Git through an ephemeral askpass script and is not placed in a remote URL or report.

## Process B and publication

The entrypoint restores committed state before scheduler invocation and restores the pushed remote again afterward. Publication is represented as a retryable handoff. A failed publication does not rerun acquisition or business decisions.

The scheduled workflow currently invokes the verified scheduler without a publisher callback. A committed batch whose presentation handoff is ready therefore reports `READY`; it does not deploy public data automatically. The already published website remains on its last-known-good release until the independent publication command is explicitly run for the committed ending SHA. This separation prevents a publication failure from changing acquisition or trusted business history.

`vercel.json` disables Git-triggered deployments from `main`. Scheduler CAS commits therefore cannot replace the sealed static Web cutover with the repository's dynamic Legacy/default build. Public delivery remains an explicit, independently retryable promotion of a validated static release.

## Current readiness

The Actions execution boundary and two approved remote manual runs are verified. The daily trigger only wakes the same production workflow; source activation, authorization, cadence and reservation remain authoritative and are re-evaluated on every invocation.
