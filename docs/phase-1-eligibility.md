# Phase 1 Completeness-Gated Eligibility

## Scope

P1 Eligibility evaluates one `CandidateProfile` against one immutable `CompleteRequirementSet` for one `OpportunityVersion`. It does not parse source text, inspect Evidence text, access Raw/Snapshot storage, run collection, or create application-level candidate data.

## Input gate

The public engine input contains:

- one `OpportunityVersion`;
- one `CompleteRequirementSet`;
- one `CandidateProfile`;
- an explicit assessment timestamp.

Independent Fact and Evidence arrays are not accepted. Before evaluation, the engine verifies:

1. completeness status is `COMPLETE` and has no blockers;
2. OpportunityVersion identity matches the set and every Fact;
3. Fact, Evidence, and Observation IDs exactly match the completeness record;
4. every Fact has Evidence;
5. every Observation and Evidence Fragment reference stays inside the set;
6. covered ExtractedRecord and Snapshot IDs match the fragments;
7. the deterministic set content hash is unchanged.

Any failure throws before an `EligibilityAssessment` is created. Omitting a Fact or Evidence item from an otherwise complete set cannot produce `ELIGIBLE`.

## NOT_ASSESSED and NEEDS_REVIEW

`NOT_ASSESSED` is the application-visible absence of an `EligibilityAssessment`. It applies whenever Requirement completeness is not `COMPLETE`; it is not a P1 Eligibility result.

`NEEDS_REVIEW` is an actual assessment result only after a complete set passes the input gate and evaluation still lacks candidate data, contains a supported conflict, or cannot resolve a structured predicate.

## Evaluation semantics

The engine evaluates existing dimensions plus academic degree, age with an explicit reference date, candidate cohort, household registration, student origin, source-neutral academic-program directory references, and candidate-cohort applicability.

`GRADUATE` scope can evaluate against master or doctoral credentials while remaining `GRADUATE` in the source Fact. `MASTER` scope requires a master credential and is never widened to `GRADUATE`. Academic directory references match namespace, version, and code exactly.

Facts in an `OR` group are alternatives. Facts in an `AND` group must all hold. Separate groups remain mandatory together. Applicability determines whether a cohort-specific Fact constrains a candidate; missing candidate-cohort data remains unknown.

The frozen assessment results remain `ELIGIBLE`, `LIKELY_ELIGIBLE`, `NEEDS_REVIEW`, `LIKELY_INELIGIBLE`, and `INELIGIBLE`. The engine compares structured values only and never reparses Chinese Evidence text.

## Isolation

The `eligibility` layer imports only `domain` within `lib/ingestion/`. It does not import Requirement parsing, adapters, normalization, canonicalization, transport, persistence, P2 modules, source-specific metadata, or file-format code.
