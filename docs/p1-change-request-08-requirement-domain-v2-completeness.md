# P1 Change Request #8 — Requirement Domain V2 and Completeness-Safe Eligibility

Status: `IMPLEMENTED — FULL REGRESSION VERIFIED — PAUSED`

Date: `2026-09-03`

## 1. Purpose

This Change Request defines the minimum source-neutral P1 contract changes required before P2-10 may implement Requirement V2 and its Completeness Gate.

It does not implement the changes. It freezes the proposed contract boundary for separate human approval.

The safety objective is:

> Eligibility must never treat a partial set of parsed Requirement Facts as the complete set of mandatory recruitment conditions.

## 2. Evidence-Based Need

The existing P1 Requirement model supports education level, major, professional qualification, graduation year, work experience, language, and political affiliation. Its current parser selects Requirement Evidence from one matching ExtractedRecord and does not carry a first-class completeness result into Eligibility.

The verified Beijing official announcement and its SHA-256-sealed XLSX job table demonstrate all of the following gaps:

1. Mandatory requirements can be distributed across more than one ExtractedRecord and Snapshot, including announcement HTML and a spreadsheet job row.
2. Spreadsheet evidence needs an exact Sheet and Cell or Range locator without exposing source-specific Adapter metadata to P1.
3. The observed source contains an academic degree requirement distinct from education level.
4. The observed source contains concrete age rules in the announcement and a cross-reference to them in the spreadsheet.
5. The observed source branches requirements by candidate cohort, including fresh graduates, overseas returning graduates, and social candidates.
6. The observed source contains household-registration and student-origin conditions that are not equivalent to each other.
7. The observed source uses `研究生` as an education scope. That scope is not equivalent to `硕士`.
8. The observed source uses external academic-program catalog codes. P1 must reference such catalogs without embedding a national catalog or source-specific codes.
9. Mandatory, preferred, informational, ambiguous, unparsed, and unsupported clauses can coexist in one source cell or announcement section.
10. The current Eligibility input can contain only the successfully parsed Facts. The Engine cannot detect mandatory source clauses that were omitted before invocation.

These are observed contract gaps, not speculative product features.

## 3. Approved Scope of the Proposed Change

Implementation of this Change Request, if separately approved, is limited to:

1. `RequirementObservation`
2. `RequirementEvidenceFragment`
3. `RequirementCompleteness`
4. Requirement dimension `ACADEMIC_DEGREE`
5. Requirement dimension `AGE`
6. Requirement dimension `CANDIDATE_COHORT`
7. Requirement dimension `HOUSEHOLD_REGISTRATION`
8. Requirement dimension `STUDENT_ORIGIN`
9. Requirement subject scope `GRADUATE`
10. Source-neutral, version-aware academic-program directory references
11. Candidate-cohort applicability for Requirement Facts
12. An Eligibility input gate that accepts only a complete Requirement Set

No item in this list may be interpreted as approval to implement P2-10 in the same change.

## 4. Requirement Observation Contract

`RequirementObservation` records what was observed before deciding whether a `RequirementFact` can be created.

The proposed minimum shape is:

```ts
type RequirementObservationStatus =
  | "CONFIRMED_REQUIREMENT"
  | "NOT_OBSERVED"
  | "UNPARSED_CLAUSE"
  | "AMBIGUOUS"
  | "DOMAIN_GAP_OBSERVED";

type RequirementClauseRole =
  | "MANDATORY"
  | "PREFERRED"
  | "INFORMATIONAL"
  | "UNKNOWN";

interface RequirementObservation {
  readonly requirement_observation_id: RequirementObservationId;
  readonly opportunity_version_id: OpportunityVersionId;
  readonly status: RequirementObservationStatus;
  readonly clause_role: RequirementClauseRole;
  readonly dimension_hint?: RequirementDimension;
  readonly requirement_fact_ids: readonly RequirementFactId[];
  readonly evidence_fragment_ids: NonEmptyReadonlyArray<RequirementEvidenceFragmentId>;
  readonly parser_version: string;
}
```

Rules:

- `CONFIRMED_REQUIREMENT` may reference one or more created Facts, but every referenced Fact must have Requirement Evidence.
- `NOT_OBSERVED` creates no Fact and never means `UNRESTRICTED`, `NOT_REQUIRED`, or `NONE`.
- `UNPARSED_CLAUSE`, `AMBIGUOUS`, and `DOMAIN_GAP_OBSERVED` create no definitive Fact unless a separately represented, bounded portion of the same evidence is explicit.
- A preferred or informational clause must not be promoted to a mandatory Fact.
- Complex “other conditions” remain Observations with Evidence until their mandatory meaning and applicability are deterministic.

## 5. Evidence Fragment Contract

One `RequirementEvidenceFragment` identifies one exact source fragment. An Observation may reference fragments from multiple ExtractedRecords and multiple Snapshots.

The proposed minimum shape is:

```ts
type RequirementEvidenceFragmentLocator =
  | {
      readonly kind: "HTML";
      readonly selector?: string;
      readonly path?: string;
      readonly field_path?: string;
      readonly start_offset?: number;
      readonly end_offset?: number;
    }
  | {
      readonly kind: "SPREADSHEET";
      readonly sheet: string;
      readonly cell_or_range: string;
      readonly field_path?: string;
    };

interface RequirementEvidenceFragment {
  readonly requirement_evidence_fragment_id: RequirementEvidenceFragmentId;
  readonly extracted_record_id: ExtractedRecordId;
  readonly snapshot_id: SnapshotId;
  readonly locator: RequirementEvidenceFragmentLocator;
  readonly observed_value_state: "TEXT" | "EMPTY";
  readonly original_text: OriginalText | null;
  readonly normalized_text?: NormalizedText;
  readonly extractor_name: string;
  readonly extractor_version: string;
  readonly parser_version: string;
}
```

Rules:

- P1 imports no Beijing Adapter type and reads no Beijing-specific metadata contract.
- Every fragment binds exactly one ExtractedRecord and Snapshot. Multiple fragments provide multi-record and multi-Snapshot provenance.
- HTML and spreadsheet locators remain distinct and lossless.
- `TEXT` requires original text. `EMPTY` requires `original_text: null` and an exact locator; it proves only that the referenced source position was empty.
- Normalized text never replaces original text and is absent for an `EMPTY` fragment.
- Spreadsheet Formula and cached-value preservation remains an extraction concern; P1 consumes only non-executed source text and locator evidence.
- A `RequirementEvidence` created for a Fact must be derivable from its referenced fragment without changing the original text or locator.

## 6. Requirement Completeness Contract

The proposed set-level status is:

```ts
type RequirementCompletenessStatus =
  | "COMPLETE"
  | "INCOMPLETE"
  | "REVIEW_REQUIRED";

type RequirementCompletenessBlockerCode =
  | "NOT_OBSERVED"
  | "UNPARSED_CLAUSE"
  | "AMBIGUOUS"
  | "DOMAIN_GAP_OBSERVED"
  | "ATTACHMENT_MISSING"
  | "EVIDENCE_INCOMPLETE";

interface RequirementCompletenessBlocker {
  readonly code: RequirementCompletenessBlockerCode;
  readonly observation_ids: readonly RequirementObservationId[];
  readonly evidence_fragment_ids: readonly RequirementEvidenceFragmentId[];
  readonly description: string;
}

interface RequirementCompleteness {
  readonly requirement_set_id: RequirementSetId;
  readonly requirement_set_content_hash: string;
  readonly status: RequirementCompletenessStatus;
  readonly covered_extracted_record_ids: readonly ExtractedRecordId[];
  readonly covered_snapshot_ids: readonly SnapshotId[];
  readonly observation_ids: readonly RequirementObservationId[];
  readonly fact_ids: readonly RequirementFactId[];
  readonly evidence_ids: readonly RequirementEvidenceId[];
  readonly blockers: readonly RequirementCompletenessBlocker[];
  readonly gate_version: string;
}
```

`COMPLETE` is valid only when all of these invariants hold:

1. Every known requirement-bearing source surface is covered.
2. Every potentially mandatory clause has a deterministic role and disposition.
3. Every mandatory supported clause is represented by a Fact.
4. Every Fact has traceable Evidence derived from one or more Evidence Fragments.
5. No mandatory clause is `NOT_OBSERVED`, `UNPARSED_CLAUSE`, `AMBIGUOUS`, or `DOMAIN_GAP_OBSERVED`.
6. No requirement-bearing attachment is missing.
7. No Evidence binding is incomplete.
8. The Fact and Evidence IDs supplied to Eligibility exactly match the IDs covered by the complete set.

`NOT_OBSERVED` is blocking by default when it concerns an expected qualification field or unresolved mandatory source surface. It may be non-blocking only when the source-neutral coverage contract proves the field is not applicable; absence alone is never that proof.

`REVIEW_REQUIRED` is used when source content exists but is ambiguous, unparsed, or outside the current typed Domain. `INCOMPLETE` is used when content or Evidence is missing.

## 7. New Requirement Dimensions

The following dimensions are additive:

- `ACADEMIC_DEGREE`: an awarded or required academic degree, distinct from education level.
- `AGE`: an age or date-of-birth-derived threshold with an explicit reference date or reference-date rule.
- `CANDIDATE_COHORT`: a source-neutral cohort such as fresh graduate, overseas returning graduate, or social candidate.
- `HOUSEHOLD_REGISTRATION`: registered-residence requirements; it must not encode student origin.
- `STUDENT_ORIGIN`: student-origin requirements; it must not encode household registration.

Each dimension requires a corresponding CandidateProfile representation before it can be evaluated. Missing candidate data remains unknown and cannot satisfy the requirement.

No new dimension is approved for recruitment method, exam method, interview ratio, application procedure, contact information, payment, or recommendation.

## 8. GRADUATE and MASTER Isolation

`GRADUATE` is added to `RequirementSubjectScope` with the following frozen semantics:

- Source text explicitly stating `研究生` may produce `GRADUATE`.
- Source text explicitly stating `硕士` may produce `MASTER`.
- `GRADUATE` is never normalized to `MASTER`.
- `MASTER` is never normalized to `GRADUATE`.
- Eligibility may evaluate a `GRADUATE` scope against supported graduate-level credentials, but the original source scope remains `GRADUATE` in the Fact and Evidence.
- If the source scope cannot be established, the Observation remains `AMBIGUOUS`; the parser must not choose either scope.

## 9. Academic-Program Directory References

P1 will not embed a complete academic-program catalog and will not add source-specific medical codes to an enum.

The proposed source-neutral reference is:

```ts
interface AcademicProgramDirectoryReference {
  readonly directory_namespace: string;
  readonly directory_version?: string;
  readonly program_code: string;
  readonly program_label?: NormalizedText;
}
```

Rules:

- The reference identifies a code in an external or versioned directory; it does not copy the directory into P1.
- Directory namespace and version are evidence-bearing data, not inferred defaults.
- A label without a reliable code may remain normalized text with `AMBIGUOUS` or `DOMAIN_GAP_OBSERVED` status.
- Existing frozen legal program codes remain readable. A directory reference does not silently map to `LAW`, `LAW_STUDIES`, `JURIS_MASTER`, or `JURIS_MASTER_NON_LAW`.
- `JURIS_MASTER` never becomes `JURIS_MASTER_NON_LAW` without explicit source evidence.

## 10. Candidate-Cohort Applicability

Requirement Facts may carry source-neutral applicability:

```ts
interface RequirementApplicability {
  readonly candidate_cohorts: readonly CandidateCohortCode[];
  readonly operator: "ANY_OF" | "ALL_OF";
}
```

Rules:

- Omitted applicability means all candidates for that OpportunityVersion.
- Applicability controls whether a Fact is evaluated; it does not weaken or remove the Fact.
- Unknown candidate cohort makes the applicable branch unknown and cannot produce an eligible result.
- Cohort branches must be backed by Evidence Fragments from the source clause that defines the branch.
- This change does not approve arbitrary nested rules, source-specific cohort names, or general-purpose scripting.

## 11. Eligibility Input Gate

The existing public pattern of passing independent `RequirementFact[]` and `RequirementEvidence[]` is insufficient because a caller can omit unresolved Facts or source clauses.

The proposed Eligibility input must contain one `CompleteRequirementSet` produced by the Completeness Gate. Facts and Evidence are read from that set and cannot be supplied as independent subsets.

Frozen behavior:

1. `RequirementCompleteness.status !== COMPLETE` causes an input-gate rejection before evaluation.
2. Gate rejection creates no `EligibilityAssessment`.
3. The application projection remains `NOT_ASSESSED` with a persisted deferral reason.
4. The Engine validates that Fact IDs and Evidence IDs exactly match the complete set.
5. Missing Facts, extra Facts, missing Evidence, extra Evidence, or mismatched content hashes are rejected.
6. Callers cannot obtain an assessment by passing only the Facts they expect a candidate to satisfy.
7. `NOT_ASSESSED` remains the absence of an EligibilityAssessment; it is not added as a P1 Eligibility result.
8. `NEEDS_REVIEW` remains an actual assessment result only after a complete Requirement Set is accepted and candidate data or supported structured evaluation remains unresolved.

The gate must enforce these invariants at runtime, not only through TypeScript structural typing.

## 12. Deliberately Untyped Conditions

This Change Request does not create a generic Fact dimension for arbitrary text.

The following remain Observation plus Evidence and block completeness when potentially mandatory:

- compound “other conditions” that have not been safely split;
- clauses whose mandatory or preferred status is unclear;
- conditional exceptions that cannot be represented by candidate-cohort applicability;
- conduct, health, record, avoidance, or policy clauses without an approved typed model;
- source cross-references whose referenced condition has not been bound;
- any field whose empty value has unknown semantics.

This is intentional. Preserving an unresolved clause and returning `NOT_ASSESSED` is safer than encoding a guessed Fact.

## 13. Explicit Exclusions

The proposed change does not include:

- Beijing-specific fields, organization names, source IDs, Endpoint IDs, URLs, or Adapter metadata;
- hard-coded medical program codes or a national academic-program catalog;
- recruitment method, exam method, interview ratio, application procedure, contact information, or registration-form parsing;
- arbitrary expression languages, scripts, AI classification, LLM inference, recommendation, ranking, or candidate matching;
- Attachment Admission, transport, Scheduler, Collection Runtime, Production Write, API, Preview UI, or Web changes;
- P2-04E Adapter or fixture changes;
- DOCX access or parsing;
- any real RequirementFact, RequirementEvidence, CandidateProfile, or EligibilityAssessment;
- any network, database, storage, migration, or production-data operation;
- implementation of P2-10.

## 14. Planned Implementation File List

No file in this section is modified by this document-only stage. If CR#8 receives separate implementation approval, the exact initial implementation scope is:

1. `lib/ingestion/domain/primitives.ts`
   - Add branded IDs for Requirement Set, Observation, and Evidence Fragment.
2. `lib/ingestion/domain/requirements.ts`
   - Add the source-neutral Observation, Evidence Fragment, Completeness, new dimensions, `GRADUATE`, program-directory reference, and applicability contracts.
3. `lib/ingestion/domain/eligibility.ts`
   - Add only the CandidateProfile fields required to evaluate the approved new dimensions while preserving existing assessment results.
4. `lib/ingestion/requirements/types.ts`
   - Define Requirement V2 source-fragment input and complete/incomplete output boundaries.
5. `lib/ingestion/requirements/deterministic-requirement-parser.ts`
   - Accept source-neutral fragments, preserve multi-Snapshot Evidence, and emit Observations without guessing unsupported clauses.
6. `lib/ingestion/eligibility/types.ts`
   - Replace independently supplied Fact/Evidence arrays at the public boundary with a complete Requirement Set input.
7. `lib/ingestion/eligibility/deterministic-eligibility-engine.ts`
   - Enforce the runtime completeness gate before constructing an assessment and implement only the approved typed dimensions.
8. `tests/domain/domain-types.test.ts`
   - Validate new discriminated unions, invariants, and backward-readable P1 entities.
9. `tests/requirements/requirement-parser.test.ts`
   - Validate multi-record/Snapshot evidence, completeness blockers, scope isolation, and source-neutral directory references.
10. `tests/eligibility/eligibility-engine.test.ts`
    - Validate gate rejection, no assessment creation, exact Fact/Evidence-set matching, cohort applicability, and new dimensions.
11. `tests/integration/phase-1-pipeline.test.ts`
    - Validate the P1 pipeline cannot evaluate an incomplete Requirement Set.
12. `tests/architecture/ingestion-boundary.test.ts`
    - Validate P1 remains source-neutral and imports no Adapter, network, application, or P2 module.
13. `docs/phase-1-requirements.md`
    - Document the approved Requirement V2 and Completeness contracts.
14. `docs/phase-1-eligibility.md`
    - Document complete-set-only evaluation and `NOT_ASSESSED` versus `NEEDS_REVIEW`.
15. `docs/phase-1-architecture-boundaries.md`
    - Freeze the source-neutral dependency and provenance boundaries.

Any implementation requiring another file or a wider semantic dimension must stop and request an amended Change Request.

## 15. Files and Areas That Must Not Change

Implementation approval for this CR would not authorize changes to:

- `lib/application/source-admission/**`
- `lib/collection-runtime/**`
- `lib/source-scheduler/**`
- `lib/live-canary/p2-04e/**`
- `lib/production-ingestion/**`
- `lib/read-only-api/**`
- `lib/p2-08-preview/**`
- `tests/p2-01/**` through `tests/p2-08/**`
- `fixtures/p2-04d/**`
- `fixtures/p2-04e/**`
- `outputs/**`
- `supabase/**`
- legacy `app/api/jobs`, crawler, cron, or sync paths

No existing frozen P2 contract may be weakened to accommodate CR#8.

## 16. Backward Compatibility

- Existing Requirement dimensions, operators, scopes, values, legal program codes, Facts, Evidence, CandidateProfiles, and persisted EligibilityAssessments remain readable.
- New dimensions, `GRADUATE`, program-directory references, Observations, and Completeness records are additive.
- Omitted candidate-cohort applicability means all candidates, preserving existing Fact semantics.
- Existing legal program codes remain valid and are not replaced by directory references.
- Existing persisted assessments are not recomputed or migrated by this CR.
- The Eligibility invocation API intentionally becomes compile-time incompatible with callers that pass independent Fact/Evidence arrays. This bounded break is required to remove the partial-Fact bypass.
- P2 read-only projections continue to report no assessment as `NOT_ASSESSED`; the P1 assessment result enum does not gain `NOT_ASSESSED`.

## 17. Required Test Plan

Implementation approval must require tests for:

1. One Requirement Set referencing multiple ExtractedRecords and Snapshots.
2. Exact HTML selector/path/offset Evidence.
3. Exact spreadsheet Sheet and Cell/Range Evidence.
4. Original and normalized text preserved separately.
5. Extractor and parser versions preserved.
6. Every Completeness blocker code and transition.
7. Empty or missing fields never becoming unrestricted requirements.
8. Missing requirement-bearing attachment blocking completeness.
9. Missing Evidence blocking completeness.
10. `研究生` producing only `GRADUATE`.
11. `硕士` producing only `MASTER`.
12. Ambiguous scope producing no scoped definitive Fact.
13. External directory namespace, version, code, and label preservation.
14. No source-specific program code added to P1 enums.
15. Candidate-cohort applicability and unknown cohort behavior.
16. Incomplete or review-required sets rejected before Eligibility evaluation.
17. Gate rejection producing no EligibilityAssessment.
18. A caller omitting Facts or Evidence being rejected.
19. Existing P1 Requirement and Eligibility semantics remaining valid after callers migrate to complete sets.
20. Full P1 and P2 regression, TypeScript, Architecture Boundary, Application Boundary, and Network Guard.

Tests must run with network disabled and must create no production data.

## 18. Architecture and Application Boundary Impact

Architecture impact is limited to P1 Domain, Requirement parsing, and Eligibility input validation:

```text
Source-neutral ExtractedRecord/Snapshot references
  -> RequirementEvidenceFragment
  -> RequirementObservation
  -> Requirement Fact/Evidence Set
  -> RequirementCompleteness Gate
  -> CompleteRequirementSet
  -> Eligibility Engine
```

The dependency direction remains inward toward P1 Domain. P1 must not import source-specific Adapters, P2 application modules, network clients, persistence implementations, or UI code.

Application behavior changes only at the Eligibility boundary: incomplete Requirement Sets remain unassessed. Admission, Collection, Scheduler, Attachment capture, Production Write, API, and Preview responsibilities do not move into P1.

## 19. Approval Gate (Satisfied)

This document originally froze the proposal without approving implementation. Explicit human approval was subsequently received for the exact listed implementation scope.

That approval did not authorize P2-10. P2-10 implementation still requires a separate explicit instruction after this completed CR#8 implementation and regression record.

## 20. Implementation Verification Record

CR#8 received explicit human implementation approval and completed its constrained post-implementation regression on `2026-09-03`.

- TypeScript: `PASS`
- Architecture Boundary, Application Boundary, and Network Guard: `20/20 PASS`
- P1 full regression: `149/149 PASS`
- P2 safe regression: `151/151 PASS`
- P2-04E XLSX Parser suite: `10 tests NOT RUN in this verification`, as required by the no-XLSX-access constraint
- External network requests: `0`
- XLSX/DOCX access: `NO`
- Existing CR#8 implementation files: unchanged by the verification-only run
- New Git commit: `NO`
- P2-10 or any later phase: `NOT STARTED`

`P1 CR#8 FULL REGRESSION VERIFIED — PAUSED`
