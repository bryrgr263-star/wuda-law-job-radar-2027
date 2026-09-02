# P2-06 Production Isolated Write

`production/ingestion/migrations/001_ingestion_production.up.sql` is a deployment contract only. This repository has no production database connection string, client, deployment command, or write authorization.

Local tests use an in-memory SQLite production-like schema with `ingestion_*` tables. Raw response bytes remain in the verified P2-04 fixtures/output artifacts; the contract persists immutable metadata and an object-path reference only.

The local schema mirrors the production migration's foreign-key and append-only constraints for Raw, Snapshot, ExtractedRecord, occurrence and opportunity versions, Requirement facts/evidence, and Eligibility assessments. Requirement Evidence must trace to a Snapshot selected by its OpportunityVersion; an EligibilityAssessment must cite its exact CandidateProfile, Requirement facts, and Evidence. A test-only synthetic capture verifies this provenance without attaching any Requirement to the Beijing Canary data.

For the Beijing P2-04D detail capture, no attachment was requested. Its linked position table and unobserved job-level education, degree, major, experience, and certificate conditions remain missing. The write contract records an assessment deferral rather than inventing Requirement facts or an EligibilityAssessment.

`B + APPROVED + HUMAN_REVIEWED_CANARY` remains a consumed one-endpoint, one-run audit reference. It does not create scheduler authority.
