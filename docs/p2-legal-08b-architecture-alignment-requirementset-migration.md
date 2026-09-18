# P2-LEGAL-08B Architecture Alignment / RequirementSet Migration

## Status

`DRAFT / DESIGN ONLY / NOT IMPLEMENTED / NOT APPROVED`

## 1. Objective

This Change Request defines a non-destructive, target-scoped migration contract for the legacy
P2-LEGAL-08B `RequirementSetCompositionResult`.

```text
Legacy P2 Artifact
  -> Target-Scoped Migration Report
  -> explicit references and gaps for Source Surface Composition, CR#11,
     P1 General Eligibility, CR#12, and CR#10
```

It does **not** authorize a legacy artifact to become an upgraded RequirementSet, an executable
CR#12 set, a PredicateResolution, a CandidateStateAssertion, or an EligibilityAssessment.

The frozen Guizhou target `22828700101` remains `REVIEW_REQUIRED / NOT_ALLOWED`.

## 2. Scope

The future implementation may only:

1. read an immutable legacy `RequirementSetCompositionResult` and its explicitly referenced
   provenance;
2. establish a target-scoped migration identity and report hash;
3. retain legacy references, observations, and blockers without reinterpretation;
4. classify migration gaps using the closed status set in Section 5;
5. assign every retained legacy blocker a stable canonical identity and owning domain/CR; and
6. annotate exact source clauses as possible P1 General Eligibility candidates without creating a
   RequirementPredicate or any candidate-side object.

## 3. Non-goals

This CR must not:

- modify the legacy JSON, legacy IDs, legacy hashes, or historical completeness;
- construct, reconstruct, or modify a SourceCompositionResult;
- create CR#11 relations, perform directory lookup, professional equivalence, fuzzy matching,
  expert review, legal reasoning, or common-sense inference;
- create a CR#12 RequirementFact, logic tree, modality, applicability, selector, context binding,
  manifest, execution manifest, or RequirementSet hash;
- execute CR#10, create PredicateResolution, CandidateProfile, CandidateStateAssertion,
  EligibilityAssessment, MATCH, or NOT_MATCH;
- modify `lib/ingestion/**`, CR#10, CR#11, CR#12, Source Surface Composition, P1 General
  Eligibility, Candidate persistence, production data, or network surfaces; or
- add a new gender, health, political, conduct, subjective-capability, or open-legal-prohibition
  domain.

## 4. Migration Contract

### 4.1 Report shape

The adapter output is an immutable `LegacyRequirementSetMigrationReport` with:

```text
migration_report_id
migration_schema_version
migration_report_version
legacy_artifact_reference
target_scope
mapping_entries[]
blocker_ownership[]
canonical_migration_hash
overall_status (derived)
validation_diagnostics (derived)
execution_gate_summary
```

`legacy_artifact_reference` retains the legacy RequirementSet ID, legacy content hash,
OpportunityVersion ID, sorted Snapshot IDs, sorted ExtractedRecord IDs, and observed source-package
or revision references. A missing source-package or revision reference remains explicit and produces
a gap; it must never be synthesized from a title or job code.

`target_scope` contains the exact target OpportunityVersion. Job code, title, and organization may
be retained only as display/audit fields and never as canonical identity inputs by themselves.

### 4.2 Mapping entry shape

```text
mapping_entry
├── stable_entry_key
├── legacy_reference
├── target_scope
├── migration_status[]
├── p1_candidate_annotation[]
├── evidence_refs[]
└── blocker_canonical_ids[]
```

An entry may carry several sorted, unique migration statuses. This permits an immutable legacy
Evidence reference to be reusable while the same entry still requires Source Composition and CR#12
projection.

## 5. Migration Status Closed Set and Derived Overall Status

The only migration statuses are:

| Status | Meaning | Blocks report integrity? |
| --- | --- | --- |
| `REUSABLE_REFERENCE` | Immutable legacy provenance can be retained as a reference. | No |
| `LEGACY_ONLY` | Historical semantics are retained but cannot be a new-architecture input. | No |
| `REQUIRES_SOURCE_COMPOSITION` | The entry cannot enter a Source Composition contract yet. | No; it blocks downstream projection |
| `REQUIRES_CR11_PROJECTION` | The entry cannot enter a formal CR#11 relation yet. | No; it blocks that projection |
| `REQUIRES_CR12_PROJECTION` | The entry cannot enter a formal CR#12 RequirementSet yet. | No; it blocks that projection |
| `BLOCKED` | The entry/report has a failed execution prerequisite or integrity validation. | Yes |

`REQUIRES_*` never means report-hash failure. `BLOCKED` never silently replaces a required future
projection status. No `OTHER`, `UNKNOWN_OTHER`, `MISC`, or other open status is permitted.

`MigrationReport.overall_status` is derived deterministically from canonical mapping entries,
canonical blocker ownership, and report validation. It has no user-editable or caller-overridable
input. A report with any failed report validation is `BLOCKED`; a valid report can retain
`REQUIRES_*` entries without claiming that a downstream contract is complete.

## 6. Source Composition Consumption Boundary

The migration adapter may consume only an explicitly supplied Source Composition reference/result
that has already been independently validated by the frozen Source Composition validator. It may
check that the supplied reference exists, has valid format, and is explicitly trusted and `COMPLETE`.

The adapter must not rebuild, recompute, infer, substitute, or self-validate any Source Composition
contract from legacy Snapshot, Evidence, Observation, old hash, title, job code, or source field.
It must not modify the Source Composition validator. Missing SourceSurface, inventory, authority,
selection, revision, binding, conflict, object-level hash, or composition hash always yields
`REQUIRES_SOURCE_COMPOSITION`; no legacy field can fill the gap.

## 7. CR#11 Boundary and 0351 Safety

The migration adapter only identifies professional-expression material that requires CR#11. It must
not run a major relation, directory lookup, similarity test, expert judgement, or equivalence rule.

```text
法律（0351）
  -> REQUIRES_CR11_PROJECTION + BLOCKED
  -> never LAW_MASTER_NON_LAW
  -> never MATCH, FALSE, or NOT_MATCH
```

Only a later CR#11 formal projection with explicit, versioned professional-directory evidence or
explicit inclusion evidence can establish a target-bound relation. Migration does not create that
evidence.

## 8. P1 General Eligibility Annotation Boundary

`MigrationStatus` is not a `P1CandidateAnnotation`.

`P1_GENERAL_ELIGIBILITY_CANDIDATE` is a report-only annotation for an exact source clause that may
fall within the frozen P1 dimensions: citizenship, service/enrolment, named disqualifying record, or
formal clearance. It is not part of the migration-status closed set and cannot mark migration
success, source completeness, or blocker resolution.

It must not create a RequirementPredicate, CandidateStateAssertion, PredicateResolution,
candidate match, EligibilityAssessment, MATCH, or NOT_MATCH. Candidate facts never supplement a
source-side requirement gap.

## 9. CR#12 and CR#10 Boundaries

Legacy Fact IDs, flat logic signals, clause roles, subject scopes, evidence, old completeness, and
legacy content hash are historical inputs only. The adapter may report
`REQUIRES_CR12_PROJECTION`; it must not create a second RequirementFact system or silently upgrade
legacy data into CR#12 structures.

The adapter may report required CR#10 capabilities. If a later P1 General Eligibility projection
would require `GENERAL_ELIGIBILITY_PREDICATE_V1`, current execution remains
`NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY`. The migration adapter must not dispatch
CR#10, execute a predicate, or create an assessment.

## 10. Blocker Canonical Identity and Ownership

Every retained legacy blocker has an immutable `blocker_canonical_id`. It is derived from the stable
legacy blocker identity, exact target OpportunityVersion, and migration schema version; title,
description, and display text are not identity inputs.

`blocker_canonical_id` is the sole identity key for blocker ownership across migration reports.
Ownership records contain that ID, the retained legacy blocker reference, canonical owner, evidence
references, and a non-resolving disposition. This CR adds no blocker domain.

| Legacy blocker | Canonical owner | P2 action |
| --- | --- | --- |
| tiered age | CR#12 conditional / future typed title-state CR | retain |
| bachelor/graduate applicability | CR#12 applicability plus official clarification | retain |
| professional catalog similarity | CR#11 / separate expert-review CR | retain |
| non-2025 current student | P1 General/cohort semantics | annotate only if exact |
| 0351 non-law applicability | CR#11 plus directory evidence | retain |
| political stance; political line | separate political-condition CR | retain |
| active duty; directed graduate; in-service probation | P1 General plus CR#10 capability | annotate only if exact |
| conduct; willingness; knowledge/ability | separate subjective-condition CR | retain |
| recruitment integrity; dismissal; dishonesty | P1 General plus CR#10 capability | annotate only if exact |
| qualification-proof deadline | separate proof/deadline CR | retain |
| disciplinary/performance; criminal/labor re-education | P1 partial record coverage plus residual CR | retain residual |
| nationality/constitutional support | P1 citizenship partial coverage plus political residual CR | retain residual |
| gender; health/physical condition | separate Requirement Domain CR | retain |
| male-facility duty | official source-role clarification | retain |
| open-ended legal prohibition | separate legal-prohibition CR | retain |

All 24 legacy blockers remain unresolved and are never automatically resolved by migration.

## 11. Hash and Derived-Status Contract

The dependency direction is fixed:

```text
canonical payload
  -> SHA-256
  -> MigrationReport identity and integrity
  -> derive validation diagnostics and overall_status
```

The canonical payload includes only stable, sorted migration identity, mapping entries, blocker
ownership, schema version, and report version. It excludes its own hash, `overall_status`, and
validation diagnostics. Those fields are derived after integrity validation; a manual status change
cannot alter canonical identity.

MigrationReport hash, legacy content hash, Source Composition hash, and CR#12 RequirementSet hash
are distinct and non-substitutable. A missing, malformed, or recomputation-mismatched report hash
produces `BLOCKED`, never `NOT_MATCH`.

The project has no public canonical serializer export usable without changing frozen
`lib/ingestion/**`. A P2-08B-private stable serializer/SHA-256 helper is therefore the minimal
future implementation boundary; tests must establish stable ordering, self-exclusion, and parity
with the project's existing canonical serialization rules.

## 12. Recall-first Safety Contract

```text
migration ambiguity                         -> REQUIRES_* / BLOCKED
missing Source Composition                  -> REQUIRES_SOURCE_COMPOSITION
missing CR#11 evidence                      -> REQUIRES_CR11_PROJECTION / BLOCKED
missing CR#12 applicability                 -> REQUIRES_CR12_PROJECTION / BLOCKED
unsupported CR#10 capability                -> NOT_ALLOWED
report integrity failure                     -> BLOCKED

all of the above                            != NOT_MATCH
migration failure                           -> never NOT_MATCH
```

No migration status, annotation, hash result, or ownership decision can produce candidate polarity
or product exclusion.

## 13. TDD Implementation Plan

1. Write failing controls for legacy identity, exact target binding, and deterministic report hash.
2. Add immutable-input and byte-for-byte legacy JSON preservation controls.
3. Add Source Composition absence, malformed reference, untrusted reference, and non-COMPLETE
   reference controls; each must report `REQUIRES_SOURCE_COMPOSITION` without reconstruction.
4. Add CR#11 `0351` controls proving no equivalence, predicate, candidate conclusion, or
   `NOT_MATCH` is produced.
5. Add CR#12 absence controls proving no Fact, logic, modality, applicability, selector, binding,
   manifest, execution manifest, or CR#12 hash is created.
6. Add P1 annotation controls proving exact source clauses annotate only and do not create a
   predicate, candidate state, resolution, or assessment.
7. Add all-24-blocker preservation, stable canonical-ID, ownership, and cross-report stability
   controls.
8. Add report hash self-exclusion, sorting, tamper, missing, malformed, and mutation controls.
9. Add unsupported-capability controls returning only `NOT_ALLOWED`.
10. Add scope-isolation and no-network static/runtime controls.

## 14. Exact File Whitelist

Future implementation may add only:

1. `docs/p2-legal-08b-architecture-alignment-requirementset-migration.md`
2. `lib/live-canary/p2-legal-08b/legacy-requirementset-migration.ts`
3. `lib/live-canary/p2-legal-08b/migration-canonical-hash.ts`
4. `tests/p2-legal-08b/legacy-requirementset-migration.test.ts`

No existing source file is whitelisted. In particular, `lib/ingestion/**`, Source Composition,
CR#10, CR#11, CR#12, P1 General Eligibility, legacy P2-LEGAL-01 through 07, legacy output JSON,
Candidate persistence, and EligibilityAssessment contracts remain frozen. A request to change a
frozen file requires a new plan review explaining why the adapter cannot work otherwise, why the
change belongs here, why it preserves existing contracts, and why it is minimal.

## 15. Regression Plan

After future implementation, run the new focused suite; P2-LEGAL-05/06/07 legacy regressions;
Source Surface Composition; CR#9 through CR#12; General Eligibility; CR#10 integration; P1;
tracked P2; typecheck; Architecture; Application Boundary; Network Guard; `git diff --check`; and
the whitelist scope audit. The focused suite must use only existing sealed local artifacts and make
zero network requests.

## 16. Remaining Blockers

This CR does not remove any existing blocker: Guizhou `22828700101` lacks a trusted COMPLETE Source
Composition, has 24 unresolved mandatory blockers, has no CR#12 structured RequirementSet, cannot
use the unsupported General Eligibility engine capability, and has no approved production Candidate
Evidence/persistence policy.

## 17. Superseded Plan Verdict

This section is superseded by the Source-Surface Composition Final Closure Revision in Section 18.
The CR remains `DRAFT / DESIGN ONLY / NOT IMPLEMENTED / NOT APPROVED`; it does not authorize an
implementation.

+## 18. Source-Surface Composition Final Closure Revision

### 18.1 Current Architecture Re-audit

This is a documentation-only closure revision. It does not change the frozen Source Surface
Composition implementation, create a P2 adapter, or authorize an implementation.

The re-audit confirms that the frozen Source Surface Composition contract already provides
object-level canonical hashes. It defines, persists, recomputes, and compares self-excluding hashes
for `DiscoveryBoundary`, `SourcePackageInventory`, `ExpectedSurfaceManifestEntry`,
`SourceSurfaceBinding` (including attachment specializations), `AuthorityAssertion`,
`SourceVersionSelection`, `SurfaceRevisionRelation`, `SourcePrecedenceDecision`, and
`SourceConflict`. It separately retains the represented source content's `surface_content_hash`,
the composition manifest hash, and the composition-result hash.

This confirms the required hash contract; it does **not** make the legacy P2 artifact
composition-backed. For `22828700101`, the missing prerequisite is an explicitly supplied,
independently validated, trusted `COMPLETE` `SourceCompositionResult` for the exact target
OpportunityVersion. It is not permission to reconstruct one from a snapshot, evidence fragment,
observation, URL, title, job code, legacy requirement hash, or a field with a similar name.

The P2 target remains `REVIEW_REQUIRED / NOT_ALLOWED`. This revision creates no RequirementSet,
PredicateResolution, EligibilityAssessment, Candidate conclusion, `MATCH`, `FALSE`, or `NOT_MATCH`.

### 18.2 Nested Object-Level Hash Contract Matrix

For every row below, the canonical procedure is fixed by the frozen Source Composition contract:

```text
contract object
  -> shallow top-level copy
  -> remove only that object's own stored hash field
  -> recursively lexicographically sort object keys
  -> preserve array order
  -> deterministically serialize JSON values
  -> UTF-8 encode
  -> SHA-256, lower-case hexadecimal, prefixed `sha256:`
  -> persist stored hash
  -> recompute and require exact equality
```

A missing property is absent from the canonical object; an explicitly present `null` serializes as
`null`. No semantic text, identity, time, scope, or status normalization is performed at hashing
time: the object must already satisfy its typed contract. The hash field being checked is excluded
only from its own canonical input; embedded child hashes remain part of a parent's canonical content
where the parent contains them.

| Contract object | Stored hash | Canonical content beyond the common procedure | Verification and rejection rule |
| --- | --- | --- | --- |
| `SourceSurfaceBinding` | `binding_hash` | Exact target, source provenance, ordered locators, Evidence/Identity Evidence references, certainty, resolver and schema fields. | Recompute `binding_hash`; missing, malformed, or unequal value rejects Composition integrity. |
| `AttachmentPublicationBinding` | `binding_hash` | The binding specialization ID plus attachment-publication target and locator content. | Same binding-hash contract; independently target-bound. |
| `AttachmentToPositionBinding` | `binding_hash` | Specialization ID, exact PositionVersion/OpportunityVersion, and row/cell/page/span locators. | Recompute `binding_hash`; attachment membership never supplies sibling Position scope. |
| `SourcePackageInventory` | `source_package_inventory_hash` | Full inventory after each contained manifest entry has its own verified hash. | Validate entries, then recompute inventory; it cannot substitute for entry validation. |
| `ExpectedSurfaceManifestEntry` | `expected_surface_manifest_entry_hash` | Expectedness, coverage, resolution, authority, binding, selection, exact target, Evidence, resolver and schema. | Recompute every entry; required coverage cannot be dropped to obtain `COMPLETE`. |
| `SourceVersionSelection` | `source_version_selection_hash` | Source identity, temporal candidate/selection state, Evidence, resolver and schema. | Recompute each selection; no latest-observation fallback. |
| `SourcePrecedenceDecision` | `source_precedence_decision_hash` | Selected/rejected surfaces, scope, decision state, Evidence, resolver and schema. | Recompute each decision; heuristic precedence is invalid. |
| `SourceConflict` | `source_conflict_hash` | Competing surfaces/observations, scope, authority, period, Evidence, status, resolver and schema. | Recompute each conflict; unresolved material conflict remains non-`COMPLETE`. |
| `DiscoveryBoundary` | `discovery_boundary_hash` | Target scope, as-of, discovery Evidence, resolver and schema. | Recompute before acceptance; caller narrowing is invalid. |
| `AuthorityAssertion` | `authority_assertion_hash` | Asserted surface, issuer/authorizer, exact scope, period, Evidence, resolver and schema. | Recompute each assertion; official hostname alone is insufficient. |
| `SurfaceRevisionRelation` | `surface_revision_relation_hash` | Correction/supplement/replacement scope, authority, period, Evidence, resolver and schema. | Recompute each relation; no implicit correction/replacement. |
| `SourceCompositionResult` | `composition_manifest_hash`, `composition_hash` | Manifest hash covers discovery boundary and inventory. Composition hash covers complete input, derived status, and manifest hash; neither includes itself. | First validate all nested hashes; rebuild and compare ID, status, manifest hash, and composition hash. |

`surface_content_hash` remains a provenance hash for the represented SourceSurface content. It is not
a replacement for a binding, inventory, manifest-entry, selection, precedence, conflict, or
MigrationReport canonical hash. The reusable serializer is a shared deterministic algorithm, not a
generic identity: every row has its own contract shape and own excluded self-hash field.

### 18.3 Composition Integrity Model

The frozen implementation's generation and verification order is:

```text
validated structural SourceCompositionInput
  -> attach/recompute all nested canonical hashes
  -> derive SourceCompositionStatus
  -> compute composition-manifest hash
  -> compute composition hash and immutable composition ID
  -> persist SourceCompositionResult

trusted verification
  -> recompute and compare every stored nested hash
  -> rebuild the result from non-derived input
  -> compare result ID, status, manifest hash, and composition hash
  -> accept only an exact rebuilt-equivalent result
```

Nested-object validation occurs before result-level rebuild comparison. A correct-looking
composition hash can never compensate for a missing, malformed, tampered, or content-mismatched
nested hash. Conversely, valid nested hashes cannot compensate for a bad manifest or composition
hash. There is no partially verified Composition Result: it is accepted as a complete immutable
object or rejected.

The domain may retain `INCOMPLETE`, `UNRESOLVED`, `REVIEW_REQUIRED`, or `CONFLICT` as observed
Composition statuses. None is an accepted `COMPLETE` result for downstream execution. The required
integrity hierarchy is:

```text
nested object hashes
  -> verified inventory / binding / authority / selection / revision / precedence / conflict graph
  -> composition-manifest hash
  -> composition hash and immutable composition ID
  -> trusted downstream verification
```

### 18.4 Runtime Consumption Gate Specification

The P2 migration adapter and the frozen CR#10 gate use different boundaries and legal states.

| Consumer | Conditions before consumption | Failure disposition | Explicitly prohibited |
| --- | --- | --- | --- |
| P2 migration adapter | Explicitly supplied Source Composition reference/result independently verified by the frozen validator, explicitly trusted, and `COMPLETE`. | `REQUIRES_SOURCE_COMPOSITION` in MigrationReport; report may be integrity-valid while projection is unavailable. | Rebuilding, recomputing, inferring, self-validating, or substituting Composition from legacy fields; RequirementSet creation; Candidate conclusion. |
| Future CR#12 construction | Exact trusted result, exact OpportunityVersion, matching as-of, schema/gate version, manifest hash, and composition hash. | Do not create a composition-backed CR#12 RequirementSet. | Treating `LEGACY_UNCOMPOSED` as `COMPOSITION_BACKED`. |
| Frozen CR#10 dispatch | Resolver returns referenced immutable result, trusted verification succeeds, status is `COMPLETE`, and all reference fields exactly match. | `NOT_ALLOWED` with Source Composition gate reason; no assessment. | `NOT_MATCH`, source selection, Composition logic in CR#10, capability promotion. |

The adapter may check supplied-reference presence, format, explicit trust, and stated `COMPLETE`
status. It must not decide completeness itself, reconstruct the source graph, or use a legacy hash
as a source-composition hash. At runtime, failure to resolve, verify, match, or establish
`COMPLETE` is an execution-gate failure only; it has no Candidate polarity and is never
`NOT_MATCH`.

### 18.5 Legacy Boundary Remains Frozen

A legacy `RequirementSetCompositionResult` is immutable, readable, and `LEGACY_UNCOMPOSED`. It may
produce only the target-scoped `LegacyRequirementSetMigrationReport` in this CR. The report retains
legacy references, annotation candidates, and blocker ownership, but cannot create or upgrade a
SourceCompositionResult, CR#11 relation, CR#12 RequirementFact/StructuredRequirementSet,
RequirementPredicate, CandidateStateAssertion, PredicateResolution, or EligibilityAssessment.

Migration/report integrity failure, missing evidence, unresolved Source Composition, unresolved
professional semantics, and unsupported execution capability remain migration or runtime-gate
conditions. They never create `MATCH`, `FALSE`, `NOT_MATCH`, or product exclusion. In particular,
`0351` does not establish `LAW_MASTER_NON_LAW` because a Composition exists, hashes validate, or a
MigrationReport is valid.

### 18.6 24-Blocker Closure Matrix

`PARTIAL` means an upstream frozen contract can represent an exact narrow portion in a later,
separately approved projection; it does not close the blocker for `22828700101`. `OPEN` means no
approved safe projection exists. No blocker is `CLOSED`.

| Blocker | Root cause | Current state | Required design change | Verification method | Residual risk | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `tiered-age-rule` | Degree/title-dependent age branches lack a source-neutral conditional age model. | `AMBIGUOUS` | Separate conditional-age CR plus CR#12 binding review. | Exact branch/date/scope controls. | Branch assumption narrows recall. | `OPEN` |
| `bachelor-graduate-applicability` | Sources do not prove whether degree lists combine as AND, OR, application credential, or highest qualification. | `AMBIGUOUS` | Official clarification plus CR#12 applicability/logic projection. | Clarification and selector-scope controls. | Assumed relationship produces false exclusion. | `OPEN` |
| `professional-catalog-similarity-exception` | 70% similarity and expert review exceed CR#11 explicit-evidence relations. | `AMBIGUOUS` | Separate expert-review/equivalence CR. | Evidence-bound review controls. | Similarity becomes inferred match. | `OPEN` |
| `non-2025-current-student-exclusion` | Current-student state is typed, but cohort/year boundary and applicability are not closed. | `AMBIGUOUS` | Official cohort clarification and CR#12 projection. | Reference-date/cohort controls. | Missing cohort fact becomes contrary evidence. | `PARTIAL` |
| `law-0351-non-law-applicability` | No explicit evidence binds `法律（0351）` to the non-law legal-master target. | `AMBIGUOUS` | Versioned CR#11 directory or explicit inclusion evidence. | Negative-equivalence controls. | Broad-code inference. | `OPEN` |
| `political-stance-and-beliefs` | No approved typed political-condition domain. | `DOMAIN_GAP_OBSERVED` | Separate political-condition CR. | Closed-domain rejection. | Subjective wording becomes decision. | `OPEN` |
| `active-duty-exclusion` | P1 can name active-duty status, but target lacks trusted composition, CR#12 projection, and engine support. | `DOMAIN_GAP_OBSERVED` | Composition-backed P1/CR#12 projection and engine approval. | Exact-source and unsupported-capability controls. | Annotation mistaken for resolution. | `PARTIAL` |
| `directed-graduate-exclusion` | P1 can name directed training/obligation, but source applicability and execution are unclosed. | `DOMAIN_GAP_OBSERVED` | Composition-backed P1/CR#12 projection and engine approval. | Exact obligation/date/scope controls. | Employer-specific obligation inferred. | `PARTIAL` |
| `conduct-and-integrity` | Subjective conduct/integrity is outside the P1 four dimensions. | `DOMAIN_GAP_OBSERVED` | Separate conduct CR. | Out-of-domain retention. | Conduct text becomes record fact. | `OPEN` |
| `recruitment-integrity-record` | Record kind is P1-typed, but target-safe projection and engine support are absent. | `DOMAIN_GAP_OBSERVED` | Composition-backed P1/CR#12 projection and engine approval. | Authority/period/record controls. | Annotation becomes contrary Candidate fact. | `PARTIAL` |
| `dismissed-public-office-exclusion` | Dismissal is P1-typed, but target-safe projection and engine support are absent. | `DOMAIN_GAP_OBSERVED` | Composition-backed P1/CR#12 projection and engine approval. | Exact issuer/record/time controls. | Historical text becomes Candidate record. | `PARTIAL` |
| `serious-dishonesty-exclusion` | Official dishonesty record is P1-typed, but source and execution prerequisites remain open. | `DOMAIN_GAP_OBSERVED` | Composition-backed P1/CR#12 projection and engine approval. | Authority/status/period controls. | Non-official reputation evidence accepted. | `PARTIAL` |
| `qualification-proof-deadline` | Submission deadline is not a closed predicate or formal clearance decision. | `DOMAIN_GAP_OBSERVED` | Separate proof/deadline CR. | Deadline/evidence/time controls. | Missing proof treated as failure. | `OPEN` |
| `disciplinary-and-performance-exclusion` | Discipline may be P1-typed, but performance history and compound scope are not. | `DOMAIN_GAP_OBSERVED` | Residual performance CR; P1 projection only for exact disciplinary part. | Split-scope controls. | Covered part hides residual. | `PARTIAL` |
| `gender-restriction` | Gender has no approved requirement/candidate domain. | `DOMAIN_GAP_OBSERVED` | Separate gender CR. | Closed-domain retention. | Clause discarded or evaluated. | `OPEN` |
| `criminal-punishment-exclusion` | Criminal sanction may be P1-typed; re-education/legal-history scope and execution are not closed. | `DOMAIN_GAP_OBSERVED` | P1 projection plus residual legal-record review and engine approval. | Exact record/authority/period controls. | Incomplete legal scope treated as complete. | `PARTIAL` |
| `nationality-and-constitutional-support` | Citizenship is P1-typed, but compound constitutional/political condition is not. | `DOMAIN_GAP_OBSERVED` | Split exact citizenship only after Composition/CR#12 projection; retain political residual. | No-silent-split controls. | Citizenship closes compound clause. | `PARTIAL` |
| `health-and-physical-condition` | Fitness is not a formal decision merely because health is mentioned; no closed health domain exists. | `DOMAIN_GAP_OBSERVED` | Separate health/formal-decision CR if exact official decision is evidenced. | Formal-decision versus fitness-text controls. | Health inference/exclusion. | `OPEN` |
| `in-service-probation-exclusion` | P1 can name probation/service obligation, but target binding and engine capability are absent. | `DOMAIN_GAP_OBSERVED` | Composition-backed P1/CR#12 projection and engine approval. | Exact status/date/scope controls. | Employment context assumed as status. | `PARTIAL` |
| `political-line-exclusion` | No approved typed political-condition domain. | `DOMAIN_GAP_OBSERVED` | Separate political-condition CR. | Closed-domain rejection. | Candidate polarity from political language. | `OPEN` |
| `male-facility-research-duty` | Source does not classify note as candidate condition, duty, or context. | `UNPARSED_CLAUSE` | Official role clarification. | Clause-role evidence controls. | Duty/location becomes gender eligibility. | `OPEN` |
| `willingness-and-responsibility` | Subjective attributes have no safe typed representation. | `UNPARSED_CLAUSE` | Separate subjective-condition CR. | Out-of-domain retention. | Text becomes inferred capability. | `OPEN` |
| `knowledge-and-work-ability` | Compound capability text has no safe deterministic decomposition. | `UNPARSED_CLAUSE` | Separate capability CR. | No-NLP/no-fuzzy controls. | Candidate/duties backfill requirement. | `OPEN` |
| `open-ended-legal-prohibition` | Unenumerated external legal references cannot be closed from source text. | `UNPARSED_CLAUSE` | Separate evidence-bound legal-prohibition CR. | Bound-source/unenumerated-reference controls. | Open law produces automatic disqualification. | `OPEN` |

The matrix is blocker ownership and closure only. It is not evidence of a complete RequirementSet,
a projection queue, or a candidate evaluation. The future adapter must retain all 24 canonical
blocker identities and must not alter their states by caller preference.

### 18.7 Verification Matrix (Design Only)

| Area | Required controls | Passing condition |
| --- | --- | --- |
| Canonicalization | Same input/same hash; key-order variation; relevant mutation; self-exclusion; absent versus null. | Frozen validator accepts only valid SHA-256 exact recomputation. |
| Binding | Base and attachment binding valid/missing/malformed/tampered/mutated cases. | Invalid binding rejects Composition; row scope remains isolated. |
| Inventory and manifest | Inventory and each entry valid/missing/malformed/tampered/mutated cases. | Required coverage cannot be omitted to reach `COMPLETE`. |
| Selection, precedence, conflict, authority, revision, discovery | Each contract valid/missing/malformed/tampered/mutated cases. | Any failure rejects integrity; unresolved material semantics remain non-`COMPLETE`. |
| Composition result | All valid; one/many invalid; valid result hash with invalid nested hash; valid nested hashes with invalid result hash; missing/malformed values. | Only an exact rebuilt-equivalent result is accepted. |
| Migration consumption | Missing, malformed, untrusted, non-`COMPLETE`, or independently unverified reference. | `REQUIRES_SOURCE_COMPOSITION`; no local reconstruction or legacy substitution. |
| Migration report | Stable identity, sort, self-exclusion, hash failures, deterministic derived status, all 24 canonical IDs/owners. | Integrity failure is `BLOCKED`; `REQUIRES_*` is not itself hash failure. |
| Downstream safety | Legacy-uncomposed input, reference mismatch, resolver absence, failed verification, unsupported capability, `0351`, migration uncertainty. | Only report/gate states; no assessment, `MATCH`, `FALSE`, or `NOT_MATCH`. |

All future controls use sealed local artifacts only. They make zero network requests, do not mutate
legacy JSON, do not reconstruct Source Composition, and do not create Candidate evidence or real
eligibility execution.

### 18.8 Architecture Drift Review

| Audit question | Re-audit result | Required disposition |
| --- | --- | --- |
| Has P2 implementation exceeded this CR? | No P2-08B adapter is authorized or claimed implemented by this CR. | Preserve the Section 14 whitelist for a later approval. |
| Has the CR been weakened to fit implementation? | No. The earlier missing-hash premise is corrected to the actual frozen contract, not waived. | Require supplied trusted result; do not reconstruct one. |
| Is composition hash used instead of nested integrity? | No. Nested hashes are recomputed before result rebuild comparison. | Reject either-layer failure. |
| Is a generic hash reused as object identity? | No. Serializer algorithm is shared; object contracts and self-hash fields are distinct. | Keep typed fields/validators separate. |
| Is validation presence-only? | No. Format and recomputed equality are required. | Retain missing/malformed/mismatch controls. |
| Is there a self-reference loop? | No. Each object excludes only its own stored hash. | Retain self-exclusion controls. |
| Can legacy data enter new models directly? | No. It remains `READABLE / LEGACY_UNCOMPOSED`. | Retain migration-only/no-promotion boundary. |
| Can migration upgrade to assessment? | No. This CR creates no CR#12 object, resolution, dispatch, or assessment. | Retain report-only/P1-annotation boundary. |
| Can verification failure become `NOT_MATCH`? | No. Migration failure is report state; CR#10 Composition failure is `NOT_ALLOWED`. | Preserve Recall First/no-exclusion rules. |
| Can consumers use Composition before verification? | No. Adapter consumes independently validated supplied results; CR#10 resolves and verifies before dispatch. | Prohibit caller booleans, legacy substitutions, local reconstruction. |

### 18.9 Final Readiness Verdict

`NOT READY FOR IMPLEMENTATION`

Source Surface Composition is already hash-contract closed at the frozen architecture layer; this P2
CR neither reimplements nor relaxes it. P2-LEGAL-08B remains blocked because `22828700101` has no
supplied trusted `COMPLETE` composition, all 24 retained blockers are `OPEN` or `PARTIAL`, no CR#12
StructuredRequirementSet exists, CR#10 lacks the required execution capability, and production
Candidate Evidence/persistence remains unapproved. The CR remains
`DRAFT / DESIGN ONLY / NOT IMPLEMENTED / NOT APPROVED`.
