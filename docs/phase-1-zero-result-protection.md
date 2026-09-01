# Phase 1 Zero-Result Protection

## Scope

P1-10 classifies one source collection run and protects source-level missing observations. It consumes collection completeness, Snapshot transport outcomes, explicit empty-result validation, observed SourceOccurrence IDs, and previously known SourceOccurrences.

It does not collect data, parse records, normalize content, merge Canonical opportunities, evaluate Requirements or Eligibility, schedule runs, close jobs, set global status, or write a database.

## Source Run statuses

- `SUCCESS`: complete non-empty observation.
- `CONFIRMED_EMPTY`: successful zero-result observation with complete pagination, valid response structure, explicit empty evidence or official count zero, no access/error/drift signal, and a non-anomalous historical comparison.
- `NOT_MODIFIED`: the source explicitly reports unchanged content.
- `PARTIAL`: collection did not complete or its result contradicts the completeness report.
- `SUSPICIOUS_EMPTY`: zero records without every confirmation condition.
- `FAILED`: no usable run because transport or collection failed.

Only `SUCCESS` and `CONFIRMED_EMPTY` may advance a source occurrence's missing streak. `FAILED`, `PARTIAL`, `SUSPICIOUS_EMPTY`, and `NOT_MODIFIED` preserve the previous streak and produce no missing event.

## Lifecycle boundary

Missing is evaluated for `SourceOccurrence`, not `CanonicalOpportunity`. A safe absent observation can emit only `MISSING_OBSERVED`. P1-10 never emits `CLOSED`, `EXPIRED`, or another global lifecycle conclusion. Repeated missing thresholds, cross-source global status, deadline interpretation, and real job closure remain later-phase responsibilities.

Source Run is an operational P1-10 contract under `lifecycle`; it does not modify the frozen domain or Adapter contracts. The future pipeline may structurally map an Adapter completeness assessment into this input without introducing a reverse dependency from `lifecycle` to `adapters`.
