# P2-LEGAL-08B Eligibility Business Rules

## Status

`FROZEN / REAL ELIGIBILITY NOT EXECUTED`

## Objective

The Job Radar must discover potentially applicable jobs and keep evidence-backed distinctions between a proven match, a proven non-match, and an unresolved condition. Failure to prove a match is not proof of a non-match.

## Major Eligibility Cases

### MATCH

A synthetic candidate with a non-law bachelor background and `LAW_MASTER_NON_LAW` may match when an applicable complete Requirement explicitly names `法律硕士（非法学）` or `法律（非法学）`, or when approved versioned equivalence evidence explicitly establishes the required mapping.

### NOT_MATCH

A non-match requires affirmative evidence of exclusion. Examples include an explicit bachelor-law requirement for a candidate whose bachelor background is non-law, or an official rule that explicitly excludes `LAW_MASTER_NON_LAW` from a required program type.

### INSUFFICIENT

Broad or unscoped source wording such as `法律` cannot prove either match or non-match for `LAW_MASTER_NON_LAW`. Missing education scope, program type, bachelor background applicability, catalog identity, or approved equivalence evidence keeps the result insufficient.

Directory code identity alone also cannot establish program-type equivalence. `0351` plus candidate program type `LAW_MASTER_NON_LAW`, without approved explicit equivalence evidence, remains insufficient.

## Completeness Gate

Eligibility may execute only for a blocker-free `COMPLETE` Requirement Set. Any `UNPARSED_CLAUSE`, `AMBIGUOUS`, `DOMAIN_GAP_OBSERVED`, `MISSING_EVIDENCE`, or `ATTACHMENT_MISSING` condition preserves review status and blocks assessment creation.

## Product Projection Boundary

Future product presentation may describe `INSUFFICIENT` as requiring manual confirmation or as potentially worth attempting. That presentation is not an Eligibility `MATCH`. No Recommendation Domain, score, priority, competition estimate, or recommendation engine is introduced here.

## Implementation Audit

The explicit directory-code equivalence gate is already implemented by P1-CR#10. The broader `法律` semantic case is now frozen as an acceptance rule but is not yet represented by a dedicated ambiguity marker in the current deterministic engine. Existing direct code comparison can produce a non-match for a broad `LAW` Fact; that behavior must not be used for a real broad-law Canary without a separately approved P1 change.

## Existing Real Requirement Set

Guizhou position `22828700101` remains `REVIEW_REQUIRED`; Eligibility remains `NOT_ALLOWED`. No existing result is changed.
