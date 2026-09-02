# P2-05 Source Scheduler and Incremental Discovery

## Scope

P2-05 is an in-memory, offline planning and comparison layer. It makes no HTTP request, invokes no transport, writes no database or Storage, and does not create a production Source Run. A `ScheduledCollectionDispatch` is an execution hand-off containing the existing P2-03 `collection_run_id`; it is not a second Collection Run model.

The scheduler depends downstream on P1 types, P2-01 Source Admission and P2-03's immutable `CollectionRunRuntimeResult`. It does not modify, replace, or persist P1 `Snapshot`, `SourceOccurrence`, or `SourceOccurrenceVersion`.

## Admission and Scheduling

Only approved A and B admissions can register schedules. A permits controlled collection. B remains `ONE_ENDPOINT_ONE_RUN`: every dispatch requires a fresh, exactly bound `LiveCanaryManualAuthorization`. The scheduler validates that authorization but never consumes it; the existing P2-01 authorization gate remains the sole one-time consumption point when a future composed runtime executes the dispatch. C, D, and any non-approved admission cannot register or dispatch.

Schedules hold cadence only: frequency, minimum interval, next/last run time, failure count, enabled state, and status. They refuse any endpoint whose collection configuration does not explicitly retain `max_pages: 1` and `follow_redirects: false`. A schedule therefore cannot turn a page-one approval into pagination, redirect expansion, endpoint discovery, or permanent authorization.

Each issued dispatch has a unique `collection_run_id`. When the P2-03 runtime returns its existing result, P2-05 derives a non-persisted audit view for source binding, timing, status, request/page counts, Raw byte total, retry count, and error classifications.

## Incremental Discovery

Page comparison uses P1 Snapshot content hashes only as page-level evidence. A changed page hash does not create a recruitment record change.

Record identity uses the RecruitmentEndpoint plus a normalized detail locator when available, then a high-confidence source record ID. It never uses a title alone. Missing both stable signals yields `IDENTITY_UNCERTAIN`; collisions are also uncertain and block missing inference for that comparison.

The content fingerprint includes source facts that can change a recruitment record: title, organization, locations, body, requirement text, application locator, deadline, recruitment year, and recruitment batch. It deliberately excludes publication date, extraction time, Snapshot ID, HTML position, adapter metadata, and page hash. Therefore page chrome or a refreshed publication date cannot alone produce `UPDATED`.

`MISSING_OBSERVED` is emitted only after a successful current Snapshot with complete stable identities. It is an observation that the list did not contain the earlier record. It is never a `CLOSED` or `EXPIRED` decision and does not create a CanonicalOpportunity, Requirement, or Eligibility result.

## Health and Access Changes

Health retains success/failure streaks, last response status/content hash, structural-change signal, and current robots/terms decisions. Explicit robots or terms prohibition immediately moves a schedule to `REVIEW_REQUIRED`. A 403, 404, 429, DNS/TLS-like transport error, or reported structural change also requires review. Other repeated failures become `FAILED` health and pause the schedule for review after two consecutive failures. No retry or transport policy is changed by P2-05.
