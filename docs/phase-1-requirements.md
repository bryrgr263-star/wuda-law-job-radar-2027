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

## CR#12 structured Requirement boundary

CR#12 adds an additive `CR12_STRUCTURED_LOGIC_V1` contract without rewriting the legacy flat Requirement Set or legacy five-state Eligibility semantics. It preserves ordered `AND` / `OR` / scoped `NOT` trees, four explicit modalities, Candidate credential applicability, Candidate state applicability, recruitment-context binding, source roles and relationships, and evidence-backed `WHEN` / `THEN` / `ELSE` selectors.

Malformed, cyclic, dangling, disconnected, cross-condition, cross-Opportunity, duplicate-leaf, unary-group, double-negation, unresolved-source, unresolved-binding, and missing-Evidence structures cannot become `COMPLETE`. Source-semantic uncertainty remains `REVIEW_REQUIRED` or `INCOMPLETE`; it never becomes Candidate `NOT_MATCH`.

Within a CR#11-proven major candidate-list context, comma, enumeration comma, slash, and an eligible semicolon are deterministic `OR` connectors. Protected atomic spans and non-professional contexts are not split mechanically. Ambiguous segmentation is preserved as a blocker.

Every structured registry, ordered child list, modality, applicability, selector, context target, source relation, Evidence reference, blocker, and parser/resolver/gate version contributes to the deterministic Requirement Set manifest and content hash. Mutation is rejected before dispatch.

The legacy CR#10 `evaluate()` path accepts only a legacy `CompleteRequirementSet` and cannot consume CR#12 input. The additive structured dispatch accepts `CR12_STRUCTURED_LOGIC_V1` only after manifest/hash, context, completeness, capability, and credential-binding gates pass. A structured set with any missing declared capability returns `NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY`; it is never flattened into legacy Facts or evaluated by the legacy engine.

## CR#11 major-expression semantic layer

CR#11 Option A adds source-neutral `MajorExpression`, `MajorIdentity`, `MajorScope`, `MajorMatchRelation`, protected connector observations, source exclusions, and hash-visible CR#12 leaf projections. It keeps `法律硕士（非法学）`, `法律（非法学）`, `法律（0351）`, `法律`, `法学`, `法学类`, `法律类`, and `法律相关` as separate identities or expression categories. Name similarity, keyword containment, matching codes without a versioned directory, job title, duty, organization, and CandidateProfile data never establish equivalence.

Only exact identity, versioned directory membership, explicit inclusion/exclusion Evidence, or `ANY_MAJOR` can establish a future major relationship. Open and broad expressions preserve their source scope; unresolved source semantics block completeness rather than becoming Candidate failure. `专业不限 + 法律职业资格` remains two independent predicates: unrestricted major and professional qualification. CR#11 emits only CR#12 predicate leaves and ordered connector observations, not a second logic tree.

CR#11 does not modify the legacy CR#10 engine or CandidateProfile. The separately approved CR#10 structured dispatcher supports `CR10_MAJOR_MATCH_RELATION_V1` only through an explicit candidate-bound MajorMatchRelation. Missing, ambiguous, mismatched, or unversioned relation evidence remains `INSUFFICIENT`, never a legacy fallback or automatic `NOT_MATCH`.

## Source-surface composition

Source-surface composition creates a deterministic, offline, OpportunityVersion-bound source package before CR#12 construction. It retains discovery boundaries, complete inventories, source surfaces, target bindings, authority assertions, selections, revisions, precedence decisions, conflicts, and all unresolved evidence. Only a `COMPLETE` composition with exact target binding can enter CR#12; all other states retain the Opportunity and block Eligibility as `NOT_ALLOWED`.

Every required nested composition contract has a self-excluding canonical hash that is persisted, recomputed, and verified before the Composition Result hash and CR#12 reference are trusted. Legacy Requirement Sets remain readable as `LEGACY_UNCOMPOSED`; they are never silently promoted. CR#10 only verifies the trusted Composition Result through its minimal gate and never performs composition business logic or converts a composition failure into `NOT_MATCH`.

## General eligibility prerequisites and explicit disqualifications

The initial source-neutral general-eligibility contract is closed to
`CITIZENSHIP_STATUS`, `SERVICE_OR_ENROLMENT_STATUS`, `DISQUALIFICATION_RECORD`, and
`FORMAL_CLEARANCE_DECISION`. Its only predicate kinds are exact citizenship equality/exclusion,
named service/enrolment presence/absence, one named adverse-record absence, and a named formal
clearance decision. Generic conduct, health, legal, and other open wording remains an
`UNPARSED_CLAUSE` or `DOMAIN_GAP_OBSERVED` blocker; it never creates a typed predicate.

Source Evidence flows only into `RequirementPredicate`, `RequirementSet`, and the RequirementSet
hash. Offline synthetic Candidate Evidence flows only into an immutable, self-hashed
`CandidateStateAssertion`; it never enters a RequirementSet hash, creates a RequirementPredicate,
or extends `CandidateProfile` persistence or serialization.

`GENERAL_ELIGIBILITY_PREDICATE_V1` is a required CR#12 capability whenever such a typed leaf is
present. The current CR#10 engine deliberately does not support it: caller-declared capabilities
are intersected with the engine's actual support set, and dispatch remains
`NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY`. No PredicateResolution, Assessment,
`MATCH`, or `NOT_MATCH` is produced by this contract.
