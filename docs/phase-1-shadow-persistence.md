# Phase 1 Shadow Persistence

## Scope

P1-11 proves that the frozen source-independent domain can be mapped into an isolated local/test persistence schema. It does not create or modify a production database.

The approved repositories cover:

- Organization
- SourceDefinition
- RecruitmentEndpoint
- SourceOccurrence
- SourceOccurrenceVersion
- CanonicalOpportunity
- OpportunityVersion
- RequirementFact
- RequirementEvidence
- CandidateProfile
- EligibilityAssessment

Nested content remains in validated JSON payloads while identity, version, and relationship keys are stored in explicit relational columns. Join tables enforce OpportunityVersion source evidence and Eligibility Fact/Evidence references.

## Isolation

The only migration is `shadow/migrations/001_shadow_persistence.sql`. It runs against an in-memory SQLite database in tests, creates only `shadow_` tables, and is not under `supabase/`. No production connection string, environment variable, network request, old table, or deployment path is used.

All business tables are append-only through repository contracts and database triggers. Foreign keys enforce the approved graph, and failed multi-row appends roll back atomically.

## Explicit exclusions

P1-11 does not persist RawBlob, Snapshot, ExtractedRecord, LifecycleEvent, SourceRun, SourceRunObservation, SourceRunAssessment, EmptyResultValidation, or missing-guard decisions. Existing ExtractedRecord and Snapshot IDs are retained as opaque external trace references in SourceOccurrenceVersion and RequirementEvidence.

The `persistence` layer imports only `domain`. It does not import `lifecycle`, adapters, normalization, canonicalization, Requirement parsing, Eligibility implementation, legacy production code, or Supabase.
