# P1 Change Request #9 — Minimal Requirement Domain Extension

## Status

`IMPLEMENTED / REGRESSION VERIFIED`

## Objective

CR#9 adds only the source-neutral structures required to preserve explicit legal-recruitment qualification conditions without guessing. It does not make any real Requirement Set complete and does not authorize Eligibility execution.

## Approved Additions

- `GENDER` with `MALE`, `FEMALE`, `ANY`, and `UNKNOWN` codes.
- Inclusive or exclusive lower and upper age bounds with an evidence-backed reference date.
- Candidate-cohort applicability for age branches, using the existing Fact applicability contract.
- Structured work-experience duration, scope, optional reference date, and unresolved-scope state.
- Exact graduation year, graduation-year range, current cohort, and preserved cohort-condition text.
- Structured professional-qualification type, class, and required/preferred strength.
- Explicit bachelor/graduate major relationship modes: `AND`, `OR`, `HIGHEST_DEGREE_ONLY`, `GRADUATE_ONLY`, `UNDERGRADUATE_ONLY`, and `EITHER_LEVEL`.
- Explicit `MajorMatchRule` kinds: `EXACT_CODE`, `EXACT_NAME`, `CATEGORY`, `CODE_SET`, `EXCEPTION_LIST`, and `EXTERNAL_DIRECTORY_REFERENCE`.
- Separate program code, name, category, directory namespace/version, and education scope fields. Education scope remains the Fact's `subject_scope`.

## Negative Inference Guard

The parser preserves exact source wording and directory references. It never maps broad directory code `0351` or source label `法律` to `JURIS_MASTER_NON_LAW`.

Only explicit source text such as `法律（非法学）` or `法律硕士（非法学）`, or a future separately evidenced versioned-directory equivalence, may support that normalized code. CR#9 does not embed a national academic-program directory.

## Completeness and Eligibility

- Unsupported, ambiguous, unparsed, or missing mandatory content remains a Completeness blocker.
- An unexplained exception-list match rule remains `REVIEW_REQUIRED`.
- Conditions deliberately excluded from CR#9 continue as `DOMAIN_GAP_OBSERVED`.
- A non-complete Requirement Set produces no `CompleteRequirementSet` and cannot enter the existing Eligibility input gate.
- CR#9 creates no CandidateProfile, EligibilityAssessment, real Requirement, or production data.

## Deliberate Exclusions

CR#9 does not type nationality, political conditions, conduct, health, military status, discipline, dishonesty, or other generalized uniform restrictions. It does not modify CanonicalOpportunity, SourceOccurrence, SourceOccurrenceVersion, Admission, Collection, Scheduler, API, Web, production persistence, or any P2 implementation.

## Compatibility and Migration

All additions are union members, enum values, or optional structured fields. Existing persisted Facts and Evidence remain readable under their original parser versions and retain their original meaning.

No existing row is rewritten or silently reinterpreted. A caller that elects to reparse historical source Evidence receives a new parser version, deterministic identities, and a newly evaluated Completeness record; the old persisted graph remains unchanged.

## Network Boundary

CR#9 implementation and tests are offline. `NETWORK REQUESTS = 0`.
