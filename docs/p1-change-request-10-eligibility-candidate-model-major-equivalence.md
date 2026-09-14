# P1 Change Request #10 — Eligibility Candidate Model and Explicit Major Equivalence Gate

## Status

`IMPLEMENTED / FULL REGRESSION VERIFIED`

## Objective

CR#10 closes only the candidate-model and deterministic-evaluation gaps required by CR#9 Requirement Facts. It preserves the blocker-free `COMPLETE` Requirement Set gate and adds no source-specific rule, real candidate, or real assessment.

## Candidate Model

- Candidate gender is distinct from a job's gender Requirement.
- Academic degree type is `ACADEMIC` or `PROFESSIONAL` and remains independent of education level.
- Program type is independent of program name and directory code. `LAW_MASTER_NON_LAW` and `LAW_NON_LAW` are distinct values.
- Professional qualifications preserve type, class, status, and traceable name.
- Work experience preserves years and an exact scope; experience in another scope is not substituted.
- New fields are optional so previously persisted CandidateProfile documents remain readable without reinterpretation.

## Explicit Major Equivalence Gate

Directory namespace, version, and code identity prove only `CODE_IDENTITY`. If a typed candidate program is compared with an untyped or differently typed directory Requirement, the result is unknown unless a versioned `MajorEquivalenceEvidence` explicitly establishes equivalence or non-equivalence.

The evidence contract records source namespace/version, from/to code and program type, status, evidence identity, and evidence version. The engine contains no directory catalog and no hard-coded code-to-program mapping.

## Eligibility Extension

The deterministic engine now evaluates only the approved CR#9 structures: gender, bounded age, scoped experience, graduation/cohort values, structured professional qualification, major match rules, and bachelor/graduate relationship modes.

`RequirementCompleteness != COMPLETE` remains a hard input error and creates no assessment. A complete set with unresolved major equivalence produces `NEEDS_REVIEW`, projected by control tests as `INSUFFICIENT`.

## Compatibility

Existing Requirement code facts, untyped directory references, CandidateProfile documents, and persisted EligibilityAssessment documents remain structurally readable. Newly evaluated assessments use engine version `3.0.0`; historical rows are not rewritten.

## Exclusions

CR#10 does not change CanonicalOpportunity, SourceOccurrence, SourceOccurrenceVersion, collection, Admission, Scheduler, API, Web, production persistence, real Requirement Sets, or real candidate/assessment data.

## Network Boundary

Implementation and controls are offline. `NETWORK REQUESTS = 0`.

## Verification

- CR#9 compatibility: `20/20 PASS`
- CR#10 controls: `25/25 PASS`
- P2-LEGAL-08A controls: `14/14 PASS`
- P1 full regression: `149/149 PASS`
- Tracked P2 regression: `155/155 PASS`
- Architecture/Application/Network Guards: `11/11 PASS`
- TypeScript: `PASS`
- `git diff --check`: `PASS`
