# CR#10 Engine Integration for CR#11 MajorMatchRelation

**Status:** `IMPLEMENTED / VERIFIED`
**Scope:** CR#10 deterministic Eligibility integration for CR#11 major semantics and CR#12 structured Requirement Sets only.
**Prerequisites:** CR#9, CR#10, CR#11, CR#12, and Recruitment Context & Position Identity remain frozen as implemented.
**Out of scope:** Requirement parsing, CR#11 major semantic interpretation, CR#12 tree construction, source-surface composition, P2, Canary, collection, API, Web, persistence, Recommendation, and network access.

## 1. Purpose and Non-Goals

This Change Request defines the only permitted path from a source-complete CR#12 structured Requirement Set containing CR#11 major semantics to a deterministic result:

```text
Requirement MajorTarget
  -> candidate-bound MajorMatchRelation resolution
  -> CandidateCredential
  -> structured deterministic Eligibility result
  -> MATCH | NOT_MATCH | INSUFFICIENT
```

It does not reinterpret source text, create a professional directory, infer major equivalence, or use a CandidateProfile to select a favorable Requirement meaning. The Requirement side remains source-neutral and candidate-independent. Candidate data is only consumed after every source-side execution gate succeeds.

The following invariants are absolute:

1. Recall First / No False Exclusion.
2. Missing evidence, ambiguity, source conflict, unknown directory, version mismatch, incomplete candidate data, and unsupported capability are never `NOT_MATCH`.
3. `NOT_ALLOWED` and `BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY` are execution-gate outcomes, never assessments and never product exclusion.
4. `法律（0351） != 法律硕士（非法学）`; no code, label, token, prefix, suffix, substring, fuzzy, embedding, LLM, historical-hire, title, duty, organization, or third-party inference may bridge them.
5. Historical CR#9/CR#10 Requirement Sets and legacy EligibilityAssessments remain readable, immutable, and semantically unchanged.

## 2. Current Engine Audit

The existing `DeterministicEligibilityEngine` accepts only `Legacy CompleteRequirementSet` and emits the legacy five-state `EligibilityAssessment` result. It must remain available for legacy input only.

### 2.1 Supported legacy predicates

The legacy evaluator supports flat Facts for education level, major/program references, academic degree, age, gender, cohort, household registration, student origin, professional qualification, graduation year, work experience, language, and political affiliation. It combines legacy groups only as group-local `AND` or `OR`, then combines groups with `AND`.

### 2.2 Legacy paths that cannot consume CR#11 semantics

The following legacy `MajorMatchRule` branches have intentionally weak historical meanings and are never a CR#11 fallback:

| Legacy rule | Historical behavior | CR#11 structured eligibility rule |
| --- | --- | --- |
| `EXACT_NAME` | a non-empty candidate program name can satisfy it | never conclusive |
| `EXACT_CODE` | a present candidate program code can satisfy it | never conclusive |
| `CATEGORY` | a present program category can satisfy it | never conclusive |
| `CODE_SET` | compares untyped legacy codes | never a substitute for target-bound relation |
| `PROGRAM_REFERENCE` | namespace/version mismatch can be treated as false | never used where unknown version/namespace must remain non-conclusive |

The legacy engine's Fact polarity is also not the CR#12 logic-tree `NOT` contract. No adapter may flatten a structured tree into these legacy groups or invert a legacy predicate to emulate a structured node.

### 2.3 Retained legacy safety behavior

The implementation retains legacy input validation: complete-set gating, OpportunityVersion matching, Fact/Evidence/Observation integrity, and legacy content-hash validation. New structured dispatch does not weaken or alter those checks.

## 3. CandidateCredential Binding Contract

### 3.1 Stable credential identity

Each candidate education credential receives an additive, stable `candidate_credential_id`. It is a domain identifier, not an array index, program code, degree level, or normalized name. The ID identifies one credential record throughout an evaluation.

The minimum immutable credential assertion is:

```text
CandidateCredential
  candidate_credential_id
  education_level: BACHELOR | MASTER | DOCTOR | GRADUATE
  major_identity_assertion
  raw_major_label
  normalized_major_label?
  directory_namespace?
  directory_version?
  directory_code?
  provenance
  completeness: COMPLETE | PARTIAL | UNKNOWN
```

`major_identity_assertion` is an explicit CR#11 semantic identity assertion. It is not created by runtime string matching. `provenance` identifies the candidate-side basis for the assertion without requiring unrelated personal data.

### 3.2 Multiple credentials

The synthetic control candidate has at least two distinct bindings:

```text
credential:bachelor-non-law
  BACHELOR / NON_LAW

credential:master-law-master-non-law
  MASTER / LAW_MASTER_NON_LAW / PROFESSIONAL
```

They cannot be merged, replaced by "highest education", inferred from ordering in `CandidateProfile.education`, or selected by code/name similarity. A `CandidateCredentialApplicability` selects eligible credential level(s); deterministic binding then selects actual stable credential IDs satisfying that frozen scope.

### 3.3 Credential completeness

| State | Meaning | Structured result consequence after source/engine gates |
| --- | --- | --- |
| `COMPLETE` | identity, selected level, required directory fields, and provenance needed by the target are available | may be conclusive |
| `PARTIAL` | credential exists but a required identity, scope, or directory field is absent | `INSUFFICIENT` |
| `UNKNOWN` | credential existence or asserted identity is unknown | `INSUFFICIENT` |

If a closed, applicable credential requirement is evaluated against a candidate profile explicitly declared complete for that scope and the required credential is affirmatively absent, that may be a proven `NOT_MATCH`. Mere omission is not affirmative absence.

## 4. Candidate-Independent MajorTarget Contract

### 4.1 Requirement-side payload

Requirement data stores only a source-neutral `MajorExpression` and its candidate-independent `MajorTarget`. A MajorTarget contains:

- the target `MajorExpression` and target MajorIdentity when source-resolved;
- target semantic type and `MajorScope`;
- exactly one CR#12 `CandidateCredentialApplicability` reference;
- CR#12 RequirementContextBinding references;
- directory namespace, version, code, and category level only when source Evidence establishes them;
- Evidence fragments, source locator, provenance, parser version, resolver version, and source resolution state;
- target relation-template IDs, relation state, and source exclusion observations where CR#11 has established them.

Requirement-side MajorTarget content is included in the structured Fact/projection, manifest, and Requirement content hash. It never includes a real `CandidateProfile`, `candidate_credential_id`, candidate-side provenance, candidate completeness, or candidate-specific evaluation result.

### 4.2 Existing CR#11 MajorMatchRelation compatibility

CR#11's existing `MajorMatchRelation` is source-neutral: its candidate-side identity descriptor describes a reusable semantic identity class, not a real candidate credential. For this CR, it is treated as a **relation template** attached to the MajorTarget.

The future engine must not mutate that template. It creates a separate evaluation-time `CandidateBoundMajorMatchRelation` that binds one template (or an explicit unresolved relation) to one stable `candidate_credential_id`.

This preserves CR#11's existing source-neutral representation and prevents candidate state from changing Requirement Set identity or its content hash.

## 5. Candidate-Bound MajorMatchRelation Contract

Only after the execution gates in Section 8 pass may the engine construct an evaluation-local, immutable relation:

```text
CandidateBoundMajorMatchRelation
  candidate_credential_id
  source_major_expression_id
  target_major_identity?
  target_semantic_type
  target_major_scope
  candidate_major_identity_assertion
  candidate_credential_applicability_id
  relation_template_id?
  relation_type
  relation_state
  relation_result
  relation_evidence_refs
  directory_namespace?
  directory_version?
  resolver_version
  provenance
  completeness
```

### 5.1 Permitted relation types

| Relation type | May support `MATCH` | May support `NOT_MATCH` |
| --- | --- | --- |
| `EXACT_IDENTITY` | only same target and applicable credential identity | only a closed, complete, explicitly different identity |
| `DIRECTORY_MEMBERSHIP` | only namespace, version, target code, typed identity, and membership Evidence all agree | only versioned, target-bound non-membership Evidence |
| `EXPLICIT_INCLUDED` | only direct inclusion Evidence for this target and identity | no |
| `EXPLICIT_EXCLUDED` | no | only direct exclusion Evidence for this target and identity |
| `UNRESTRICTED` | major dimension only | no |
| `NOT_ESTABLISHED` | no | no |

`relation_result` is `TRUE`, `FALSE`, or `UNKNOWN`. It is not a source Requirement mutation. `UNKNOWN` relation state produces `INSUFFICIENT` after successful gates.

### 5.2 Prohibited binding mechanisms

The engine must reject or preserve as unknown, never infer from:

- array index or array order;
- highest-education selection;
- same or similar code without the target-bound versioned relation;
- name containment, token overlap, regular expressions, fuzzy matching, embeddings, or LLM output;
- title, duty, organization, work location, historical hires, proposed-hire notices, or third-party commentary;
- reverse propagation from CandidateProfile into Requirement interpretation.

## 6. Structured Input Contract

The new input is a distinct discriminated contract, not an extension or adapter of `EligibilityEvaluationInput`:

```text
StructuredEligibilityEvaluationInput
  model: CR12_STRUCTURED_LOGIC_V1
  structured_requirement_set: CR12StructuredRequirementSet
  opportunity_version
  recruitment_context_snapshot
  candidate_profile
  candidate_credential_registry
  supported_engine_capabilities
  assessed_at
```

The `recruitment_context_snapshot` is used only to validate that the structured set's RequirementContextBindings apply to the supplied OpportunityVersion, Position, Batch, Plan, and explicitly referenced Location. It may not create default Plan/Batch values or broaden a binding.

`candidate_credential_registry` is the stable-ID registry from Section 3. It is evaluation input and is not copied into Requirement Set content or hashes.

## 7. Structured Result Contract

Structured execution has a separate result family:

```text
StructuredEligibilityDispatchResult
  | StructuredEligibilityGateResult
  | StructuredEligibilityAssessment

StructuredEligibilityAssessment
  result: MATCH | NOT_MATCH | INSUFFICIENT
  requirement_set_id
  requirement_set_content_hash
  opportunity_version_id
  candidate_profile_id
  candidate_credential_ids
  relation_resolution_ids
  reason_codes
  Evidence references
  engine_version
  parser_versions
  resolver_versions
  assessed_at
```

The legacy five-state `EligibilityAssessment` remains unchanged. A `StructuredEligibilityAssessment` has a new additive identifier namespace and must never be serialized as, assigned to, or overwrite a legacy assessment.

## 8. Gate / No-Assessment Contract

The following order is immutable:

1. Structural Integrity Check
2. Content Hash / Manifest Check
3. OpportunityVersion / Recruitment Context Binding Check
4. Requirement Completeness Check
5. Capability Check
6. CandidateCredential Registry and Completeness Check
7. Candidate-bound MajorMatchRelation Resolution
8. Structured Logic Evaluation
9. `MATCH` / `NOT_MATCH` / `INSUFFICIENT` output

Steps 1–6 are execution gates. Any failure returns:

```text
StructuredEligibilityGateResult
  status: NOT_ALLOWED
  reason: REQUIREMENT_SET_NOT_COMPLETE
        | STRUCTURAL_INTEGRITY_FAILURE
        | CONTENT_HASH_MANIFEST_MISMATCH
        | CONTEXT_BINDING_MISMATCH
        | BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY
        | CANDIDATE_CREDENTIAL_BINDING_INVALID
  assessment: absent
```

No legacy or structured assessment ID is created on a gate result. A candidate credential that is structurally valid but semantically `PARTIAL` or `UNKNOWN` passes step 6 and produces `INSUFFICIENT` in steps 7–9. A malformed, duplicated, dangling, or non-applicable credential binding fails step 6 and creates no assessment.

## 9. Capability / Manifest / Hash Contract

### 9.1 Unified capability model

The structured engine capability union must include every CR#12 capability and:

```text
CR10_MAJOR_MATCH_RELATION_V1
```

A structured Requirement Set declares this capability if and only if a mandatory MajorTarget leaf requires CR#11 relation evaluation. The declaration appears in all of:

1. the structured capability union;
2. the execution manifest's required capability list;
3. the canonical manifest serialization;
4. the Requirement Set content hash input; and
5. the engine-supported capability version declaration.

The manifest also includes the MajorTarget semantic payload, target relation-template IDs/states, target Evidence, directory references, CR#12 credential applicability IDs, context binding IDs, parser versions, and resolver versions. Candidate-bound resolution data never enters Requirement Set hashing.

### 9.2 Capability gate

If the manifest requires `CR10_MAJOR_MATCH_RELATION_V1` but the engine does not list that exact supported capability version, dispatch returns:

```text
NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY
```

No assessment is created. No legacy flat evaluator, partial evaluator, ignored semantic field, or implicit downgrade is permitted.

## 10. Three-Valued Logic Contract

Structured evaluation uses exactly `TRUE`, `FALSE`, and `UNKNOWN`.

| Node | Rule |
| --- | --- |
| `NOT A` | `NOT TRUE = FALSE`; `NOT FALSE = TRUE`; `NOT UNKNOWN = UNKNOWN` |
| `A AND B` | any `FALSE` is `FALSE`; otherwise any `UNKNOWN` is `UNKNOWN`; otherwise `TRUE` |
| `A OR B` | any `TRUE` is `TRUE`; otherwise any `UNKNOWN` is `UNKNOWN`; otherwise `FALSE` |

Source semantic resolution is earlier than this candidate evaluation. An unresolved source connector, expression boundary, directory identity, scope, modality, applicability, selector, context binding, source relation, Evidence, or source conflict prevents Requirement `COMPLETE`.

Therefore, a candidate `TRUE` branch cannot hide a source-unresolved `OR` branch. The execution gate returns `NOT_ALLOWED`, preserves the source blocker, and creates no assessment.

At evaluation time only, candidate-side `UNKNOWN` is a valid value and may produce `INSUFFICIENT`; it must never be coerced to `FALSE`.

## 11. Modality Contract

| Modality | Structured eligibility effect |
| --- | --- |
| `MANDATORY` | participates in the mandatory root; proven false may contribute to `NOT_MATCH` |
| `PREFERRED` | evaluated only as non-binding diagnostic detail; never causes `NOT_MATCH` |
| `OPTIONAL` | non-binding; never causes `NOT_MATCH` |
| `INFORMATIONAL` | preserved/auditable only; never causes `NOT_MATCH` |

An unresolved source modality is a CR#12 completeness blocker and causes `NOT_ALLOWED`, not `INSUFFICIENT`. Once modality is source-resolved, an unknown candidate result on a preferred/optional/informational clause cannot convert an otherwise mandatory `MATCH` to `NOT_MATCH`; it is retained as a diagnostic. No Recommendation, score, ranking, or product action is created by those diagnostics.

## 12. Applicability / Context Binding Contract

Each mandatory condition and major leaf must pass both independent checks:

1. **Candidate applicability:** exactly one CR#12 `CandidateCredentialApplicability` and one `CandidateStateApplicability` are resolved. The engine selects stable credential IDs only within that frozen scope.
2. **Requirement context binding:** the authoritative OpportunityVersion and its explicitly evidenced Position, PositionVersion, RecruitmentBatch, RecruitmentPlan, and Location scope match the condition's binding set.

Location is considered only when the Requirement explicitly binds to a Location. A node may narrow to a Batch or Location with Evidence, but may never widen beyond its owning condition. Unknown, cross-Opportunity, cross-Position, cross-Batch, or otherwise invalid binding is a gate failure, not a candidate failure.

This prevents announcement-level conditions from being copied to every row, row conditions from being expanded to an announcement, and conditions from one Position/Batch/Location from contaminating another.

## 13. Deterministic Outcome Contract

| Result | Mandatory conditions |
| --- | --- |
| `MATCH` | every applicable mandatory condition is `TRUE`; all source, context, capability, and credential gates passed |
| `NOT_MATCH` | at least one applicable mandatory condition is affirmatively `FALSE` under a complete closed target or explicit exclusion, and no unresolved mandatory result remains |
| `INSUFFICIENT` | source/engine gates passed, but an applicable mandatory candidate result is `UNKNOWN`, including unresolved candidate relation or incomplete candidate semantic evidence |
| `NOT_ALLOWED` | any gate fails; no assessment exists |

No outcome other than a complete, traceable, affirmatively proven `NOT_MATCH` may ever be used by a future product layer as a possible eligibility-based exclusion. This CR itself creates no product behavior.

## 14. Twelve Candidate Control Cases

All controls use the two stable credentials in Section 3.2. Unless explicitly stated, Requirement source semantics, Evidence, bindings, non-major mandatory clauses, and engine capabilities are complete and supported.

### 14.1 Universal overlays

These overlays apply to every row below:

| Overlay | Required outcome |
| --- | --- |
| Requirement source unresolved or Requirement Set incomplete | `NOT_ALLOWED`; no assessment |
| Requirement-side directory namespace/version required but unresolved | `NOT_ALLOWED`; no assessment |
| source conflict or source-unresolved OR | `NOT_ALLOWED`; no assessment |
| candidate credential `PARTIAL`/`UNKNOWN` where the target needs that credential evidence | `INSUFFICIENT` |
| candidate-side directory namespace/version missing or mismatched for a directory relation | `INSUFFICIENT` |
| capability unsupported | `NOT_ALLOWED`; no assessment |

For non-directory exact textual requirements, known/unknown directory version is irrelevant unless the source expressly makes the directory part of the target. It cannot create a false result.

### 14.2 Base matrix

| # | Complete source MajorTarget | COMPLETE candidate / known required directory state | Required structured outcome |
| --- | --- | --- | --- |
| 1 | exact `法律硕士（非法学）`, applicable to MASTER | exact `LAW_MASTER_NON_LAW` credential | `MATCH` |
| 2 | exact `法律（非法学）` | distinct law-master identity without explicit inclusion | `INSUFFICIENT`; versioned explicit inclusion may yield `MATCH` |
| 3 | directory-bound `法律（0351）` | code `0351` alone, even on law-master credential | `INSUFFICIENT`; only target-bound versioned typed inclusion may yield `MATCH` |
| 4 | broad `法律` | law-master credential without inclusion/exclusion Evidence | `INSUFFICIENT` |
| 5 | `法学` | law-master credential without explicit relation; no bachelor-only exact requirement is assumed | `INSUFFICIENT` |
| 6 | `法学类` | category membership not evidenced for law-master credential | `INSUFFICIENT` |
| 7 | `法律类` | category membership not evidenced for law-master credential | `INSUFFICIENT` |
| 8 | open `法律相关` | no explicit inclusion/exclusion Evidence | `INSUFFICIENT` |
| 9 | `法学、法律、知识产权` in confirmed major-list context | ordered `法学 OR 法律 OR 知识产权`; no applicable exact/inclusion relation | `INSUFFICIENT` |
| 10 | `专业不限` | no major identity needed | major dimension `MATCH`; other mandatory conditions remain independent |
| 11 | `专业不限` plus A-class legal qualification | major dimension `MATCH`; qualification obtained is known | `MATCH` only if the independent qualification predicate is `TRUE`; unknown qualification is `INSUFFICIENT`; proven absence is `NOT_MATCH` |
| 12 | explicit exclusion of `法律硕士（非法学）` | exact, applicable, complete law-master credential and exclusion Evidence | `NOT_MATCH` |

For row 5, an explicitly closed `BACHELOR:法学` target evaluated against a complete `BACHELOR:NON_LAW` credential may be `NOT_MATCH`; that is a separate scoped control, not a rule that broad `法学` automatically excludes the master's identity.

Rows 2–9 must never be narrowed by words, code, shared discipline, profession, or occupational intuition. `法律（0351）` remains distinct from `法律硕士（非法学）` without the permitted directory/inclusion Evidence.

## 15. False-Negative Safety Matrix

| Condition | Mandatory behavior |
| --- | --- |
| missing Evidence | source blocker -> `NOT_ALLOWED`, never `NOT_MATCH` |
| ambiguous expression or connector | source blocker -> `NOT_ALLOWED`, never `NOT_MATCH` |
| open/broad target relationship unknown | after gate -> `INSUFFICIENT` |
| missing or unknown candidate credential | after gate -> `INSUFFICIENT` |
| unknown/mismatched candidate directory version | after gate -> `INSUFFICIENT` |
| missing source directory version required by target | source blocker -> `NOT_ALLOWED` |
| source conflict | source blocker -> `NOT_ALLOWED` |
| unsupported capability | `NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY` |
| identity/context binding unresolved | `NOT_ALLOWED` |
| candidate true branch plus source-unresolved OR branch | `NOT_ALLOWED`, not `MATCH` |
| legacy rule present without CR#11 relation template | `INSUFFICIENT` after capable complete dispatch, never fallback match/non-match |
| CandidateProfile could suggest a favorable source meaning | source meaning remains unchanged |

## 16. Legacy Compatibility

1. Legacy `CompleteRequirementSet` routes only to the legacy engine and returns only legacy five-state assessments.
2. CR#12 structured sets route only to structured dispatch and return either a gate result or a new structured three-state assessment.
3. Legacy `MajorMatchRule`, `EXACT_NAME`, `EXACT_CODE`, `CATEGORY`, `CODE_SET`, and `PROGRAM_REFERENCE` cannot satisfy or negate a CR#11 MajorTarget by fallback.
4. Historical RequirementSet IDs, Fact IDs, Evidence IDs, EligibilityAssessment IDs, and serialized meanings are neither rewritten nor destructively migrated.
5. A legacy Fact may be referenced as provenance in an additive projection, but legacy and structured execution cannot run simultaneously for one decision and cannot double-negate one source exclusion.

## 17. CR#9 / CR#10 / CR#11 / CR#12 Cross-Contract

| Contract | Frozen responsibility | Explicit non-responsibility here |
| --- | --- | --- |
| CR#9 | legacy Fact and `MajorMatchRule` compatibility | CR#11 semantic relation or structured execution |
| CR#10 | CandidateProfile, legacy engine, and this additive structured dispatch | changing legacy assessment result semantics |
| CR#11 | MajorExpression, MajorTarget semantic identity/scope, relation templates, directory/evidence boundary | runtime string parsing, tree construction, or legacy fallback |
| CR#12 | logic tree, `NOT`, modality, selectors, applicability, context binding, manifest/hash, and gate | redefining professional identities/equivalence |

There is no cross-contract semantic conflict under this document: candidate-bound resolution is evaluation-local; source semantics remain in CR#11/CR#12 hashed Requirement content; CR#12 remains the owner of structured logic and gates; CR#10 owns deterministic dispatch only.

## 18. Future Implementation Whitelist

After separate implementation approval, only the following files may be changed for this CR:

- `docs/p1-change-request-10-engine-integration-cr11-major-match-relation.md`
- `docs/phase-1-requirements.md`
- `lib/ingestion/domain/primitives.ts`
- `lib/ingestion/domain/eligibility.ts`
- `lib/ingestion/domain/requirements.ts`
- `lib/ingestion/domain/index.ts`
- `lib/ingestion/eligibility/types.ts`
- `lib/ingestion/eligibility/deterministic-eligibility-engine.ts`
- `lib/ingestion/requirements/deterministic-requirement-parser.ts`, only to declare existing CR#11 major projections/capability in the CR#12 manifest and hash; no parsing-semantic changes
- `tests/domain/domain-types.test.ts`
- `tests/eligibility/p1-cr10-candidate-model-major-equivalence.test.ts`
- `tests/eligibility/p1-cr10-engine-integration-cr11-major-match-relation.test.ts`
- `tests/requirements/p1-cr11-recruitment-major-expression.test.ts`, only for integration-regression assertions
- `tests/requirements/p1-cr12-requirement-logic-modality-applicability.test.ts`, only for manifest/capability/regression assertions

No synchronized CR#11 or CR#12 document edit is required: their existing sections already reserve this separate Engine integration and require its full capability, hash, and three-valued execution validation.

## 19. Forbidden Scope

The implementation must not modify P2, Canaries, source-surface composition, collectors, Scheduler, API, Web, Supabase, production persistence, real data, third-party sources, nationwide catalogues, Recommendation, application state, or legacy destructive migration.

It must not change CR#11 expression classification, directory semantics, or law-family boundary; CR#12 logic/tree/modality/applicability/context/selector source semantics; or legacy assessment meanings.

## 20. Required Test Plan

Implementation requires synthetic offline controls for:

1. stable bachelor/master credential IDs and rejection of index/highest-degree binding;
2. source MajorTarget hash exclusion of candidate-specific resolution;
3. all twelve controls in Section 14 with COMPLETE, PARTIAL, UNKNOWN, known-directory, unknown-directory, source-resolved, source-unresolved, and Requirement-incomplete overlays;
4. exact inclusion, exact exclusion, directory membership, version mismatch, and non-established relation;
5. `NOT UNKNOWN`, AND, OR, nested tree, and source-unresolved OR safety;
6. mandatory versus preferred/optional/informational behavior;
7. credential/state applicability, Position, Batch, Plan, and explicit Location binding isolation;
8. structural, hash, manifest, OpportunityVersion, context, completeness, and capability gate failures creating no assessment;
9. capability declaration, manifest mutation, and content-hash mutation detection for `CR10_MAJOR_MATCH_RELATION_V1`;
10. legacy flat input isolation, no fallback, no dual execution, no double negation, and historical read compatibility;
11. all CR#9, CR#10, CR#11, CR#12, Recruitment Context, P1, tracked P2, TypeScript, Architecture Boundary, Application Boundary, Network Guard, and `git diff --check` regressions.

## 21. Design Closure

The five former blocking issues are closed by this document:

1. source MajorTarget and candidate-bound resolution have separate immutable lifecycles;
2. each credential has a stable additive identity and explicit completeness;
3. structured dispatch, gate result, and three-state assessment contracts are disjoint from legacy assessment;
4. CR#11 capability is explicitly required in the unified structured manifest/hash/capability model; and
5. gate order, three-valued logic, modality, applicability, context binding, and selector behavior are deterministic and source-safe.

## 22. Final Verdict

`IMPLEMENTED / VERIFIED`

## 23. Implementation Verification Record

The approved additive implementation is complete and remains within Section 18's file boundary.

- `DeterministicEligibilityEngine.evaluateStructured()` is isolated from legacy `evaluate()` and produces only a structured gate result or `MATCH` / `NOT_MATCH` / `INSUFFICIENT` assessment.
- The structured execution gate verifies CR#12 manifest content, Requirement Set content hash, capability declaration, Opportunity/context binding, completeness, and stable candidate credential binding without importing the Requirement Parser across the frozen ingestion-layer boundary.
- `CR10_MAJOR_MATCH_RELATION_V1` is declared only when a CR#11 semantic Major Fact is present. No legacy major rule is used as a fallback.
- Synthetic engine controls cover exact inclusion/exclusion, versioned directory membership/mismatch, all CR#11 base outcomes, `NOT`, `AND`, `OR`, nested trees, selectors, modality, cohort applicability, Position/Batch/Plan/Location isolation, source-unresolved OR, manifest mutation, capability gating, and legacy runtime rejection.
- Verification on 2026-09-06: focused CR#9 / CR#10 / CR#11 / CR#12 / Recruitment Context regression `121/121 PASS`; CR#10 structured engine controls `14/14 PASS`; P1 suite `153/153 PASS`; tracked P2 and legal Canary regression `266/266 PASS`; TypeScript, Architecture Boundary, Application Boundary, Network Guard, and `git diff --check` pass.
- No network request, production write, Supabase use, real Requirement Set, real CandidateProfile, real EligibilityAssessment, P2/Canary mutation, or commit occurred.
