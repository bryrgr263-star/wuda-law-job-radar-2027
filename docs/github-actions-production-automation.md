# GitHub Actions Production Automation

The production workflow is an execution boundary around the existing Production Scheduler Batch. It does not implement acquisition, authorization, Trusted Chain, presentation, or publication policy.

## Repository ownership

- Code repository and Git append-only authoritative state currently share the selected authoritative branch.
- GitHub Actions artifacts are diagnostics only and are never authoritative state.
- Public presentation publication is a separate handoff from committed `PresentationReadModel` state.

## Activation

The workflow is manual-only. It fails closed unless the repository variable `PRODUCTION_SCHEDULER_ACTIVATION` is exactly `ENABLED`. The versioned production adapter registry must also contain an approved production adapter. The current registry is intentionally empty; Canary and test adapters are not production dependencies.

`PRODUCTION_STREAM_ID` is a required repository variable. It must identify the committed Trusted Chain journal; there is no fallback stream. The activation variable and stream ID are configuration, not source authorization.

Every source request remains subject to committed Source Admission, Continuous Authorization, cadence, revocation, pending-attempt, and expected-parent CAS checks. `workflow_dispatch` is not authorization.

## Credentials

Only the ephemeral repository-scoped `GITHUB_TOKEN` is used. The workflow grants `contents: write` and no other write permission. The token is provided to Git through an ephemeral askpass script and is not placed in a remote URL or report.

## Process B and publication

The entrypoint restores committed state before scheduler invocation and restores the pushed remote again afterward. Publication is represented as a retryable handoff. A failed publication does not rerun acquisition or business decisions.

## Current readiness

The Actions execution boundary can be locally verified with controlled Git remotes. Real activation remains blocked until approved adapters and authoritative source/admission/continuous-authorization state are versioned on the authoritative branch. Remote GitHub Actions verification requires two successful manual runs after those prerequisites are approved.
