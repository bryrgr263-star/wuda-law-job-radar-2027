# Phase 1 Eligibility

## Scope

P1-09 evaluates one `CandidateProfile` against the already structured `RequirementFact[]` and `RequirementEvidence[]` for one `OpportunityVersion`. It does not parse requirement text, inspect Raw or Adapter data, rank opportunities, manage user profiles, or change opportunity lifecycle state.

## Contract

The deterministic engine accepts:

- `OpportunityVersion`
- `RequirementFact[]`
- `RequirementEvidence[]`
- `CandidateProfile`
- an explicit assessment timestamp

It returns the frozen domain `EligibilityAssessment`. Every Fact must belong to the supplied OpportunityVersion, and every Evidence item must reference a supplied Fact.

## Evidence rule

Every evaluated Fact must have traceable Evidence before the engine can return a positive or negative conclusion. Missing Facts, missing Evidence, missing candidate data, or conflicting structured requirements produce `NEEDS_REVIEW`. The engine never reads or reparses Evidence text; Evidence is used only as the audit reference for already structured Facts.

## Result policy

- `ELIGIBLE`: all mandatory groups are explicitly satisfied and every Fact has Evidence.
- `LIKELY_ELIGIBLE`: all groups are satisfied, but at least one Fact is inferred or ambiguous.
- `NEEDS_REVIEW`: structured requirements, Evidence, or candidate data are incomplete or conflicting.
- `LIKELY_INELIGIBLE`: an inferred or ambiguous group is not satisfied and no explicit group already disqualifies the candidate.
- `INELIGIBLE`: at least one explicit mandatory group is not satisfied.

Facts in the same `OR` group are alternatives. Facts in the same `AND` group must all hold. Separate groups are mandatory together. The engine compares structured codes and values only; it does not use Chinese substring matching or reinterpret the parser's original semantics.

## Isolation

The `eligibility` layer imports only `domain` within `lib/ingestion/`. It does not import the Requirement parser, normalization, canonicalization, adapters, transport, raw storage, legacy production modules, or source-specific metadata.
