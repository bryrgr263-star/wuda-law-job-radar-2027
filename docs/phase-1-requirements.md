# Phase 1 Requirement V2, Evidence, and Completeness

## Scope

P1 Requirement V2 converts source-neutral `RequirementEvidenceFragment` values into `RequirementObservation`, `RequirementFact`, `RequirementEvidence`, and one completeness-gated `RequirementSet`. It does not read Adapter metadata, execute collection, access Raw bytes, infer source-specific meanings, or run Eligibility.

The implementation is a P1 contract and deterministic reference parser. It does not create the P2-10 production Requirement pipeline or any real Requirement data.

## Evidence fragments

Each Evidence Fragment binds one `ExtractedRecord`, one `Snapshot`, one exact locator, original text or an explicitly empty source position, normalized text when available, and extractor/parser versions.

Supported source-neutral locator kinds are:

- HTML selector/path/field and character offsets;
- spreadsheet Sheet and Cell/Range;
- JSON path;
- document page/section/text locator.

One Requirement Set may cover multiple ExtractedRecords and Snapshots. An Observation may cite multiple Evidence Fragments. Original text is never replaced by normalized text. `EMPTY` means only that the exact source position was empty; it never means unrestricted or not required.

## Observations and facts

Every source clause receives an Observation disposition:

- `CONFIRMED_REQUIREMENT`;
- `NOT_OBSERVED`;
- `UNPARSED_CLAUSE`;
- `AMBIGUOUS`;
- `DOMAIN_GAP_OBSERVED`.

Clause roles are `MANDATORY`, `PREFERRED`, `INFORMATIONAL`, or `UNKNOWN`. Preferred text can be preserved without becoming a mandatory Fact. Unsupported complex conditions remain Evidence-backed Observations rather than guessed Facts.

The additive typed dimensions are `ACADEMIC_DEGREE`, `AGE`, `CANDIDATE_COHORT`, `HOUSEHOLD_REGISTRATION`, and `STUDENT_ORIGIN`. Existing dimensions remain valid. Candidate-cohort applicability can scope a Fact without changing its source meaning.

## Education semantics

`GRADUATE` and `MASTER` are distinct subject scopes:

- source text `研究生` produces `GRADUATE` only;
- source text `硕士` produces `MASTER` only;
- neither scope is rewritten to the other.

External academic-program codes use an evidence-backed directory namespace, optional version, code, and optional label. P1 does not embed a national catalog or source-specific code list. A directory-shaped code without directory evidence blocks completeness.

`法律硕士` maps only to `JURIS_MASTER`. It never maps to `JURIS_MASTER_NON_LAW` unless the source explicitly says `法律硕士（非法学）` or its frozen equivalent alias.

## Completeness gate

Completeness is a set-level result, not a Fact-count check:

- `COMPLETE` has no blockers and exposes a `CompleteRequirementSet`;
- `INCOMPLETE` covers missing content or Evidence;
- `REVIEW_REQUIRED` covers ambiguous, unparsed, or unsupported observed content.

Blocking codes are `NOT_OBSERVED`, `UNPARSED_CLAUSE`, `AMBIGUOUS`, `DOMAIN_GAP_OBSERVED`, `ATTACHMENT_MISSING`, and `EVIDENCE_INCOMPLETE`.

`COMPLETE` requires all declared requirement-bearing source surfaces to be covered, every mandatory supported clause to produce Evidence-backed Facts, and no blocker. The set records exact Fact, Evidence, Observation, ExtractedRecord, and Snapshot IDs plus a deterministic content hash. A caller cannot establish completeness by omitting source clauses or passing only favorable Facts.

## Exclusions

Requirement V2 does not type recruitment procedures, exam ratios, application methods, compensation, source-specific medical codes, or arbitrary “other conditions.” It does not use AI/LLM inference. Such content remains Observation plus Evidence and blocks Eligibility when potentially mandatory.
