# P1 Change Request — General Eligibility Prerequisites and Explicit Disqualifications

## Status

`IMPLEMENTED / VERIFIED`

## 1. Problem Statement

Official recruitment announcements repeatedly contain mandatory eligibility clauses outside the
currently executable education, major, qualification, cohort, age, work-experience, gender, and
political-affiliation dimensions. Common examples include nationality, active-duty or current-study
status, specified criminal or disciplinary records, public-recruitment integrity records, and an
officially determined health or conduct clearance.

The existing P2 legal blocker audit retains these clauses as `DOMAIN_GAP_OBSERVED`,
`UNPARSED_CLAUSE`, or `AMBIGUOUS`; it correctly prevents a false `COMPLETE` Requirement Set.
This CR defines the smallest source-neutral contract for the subset that can be represented and
evaluated deterministically. It does not make an unknown candidate eligible or ineligible.

The safety problem is:

```text
source text not represented, or candidate state not evidenced
  -> condition omitted, guessed, or silently defaulted
  -> false COMPLETE or false NOT_MATCH
  -> false exclusion of a potentially applicable Opportunity
```

This CR prevents that path. A condition which is not safely representable remains preserved as a
blocker. It is never converted into an unrestricted condition, an absent condition, or a candidate
failure.

## 2. Objective

Define source-neutral, evidence-backed contracts for repeated, explicit, hard eligibility
prerequisites and explicit disqualifications so that a future capability can:

1. preserve what the authoritative source says;
2. bind it only to the evidenced OpportunityVersion and context;
3. preserve complete candidate-state evidence separately from Requirement source evidence;
4. distinguish a proven conflict from missing or insufficient candidate information; and
5. retain an Opportunity and block execution whenever source semantics or composition are not
   complete.

This CR is a Requirement Domain design. It does not authorize an Eligibility Engine change or a
real EligibilityAssessment.

## 3. Scope

The proposed core scope is limited to the following **closed, explicit predicates** when their
source wording, temporal boundary, authority, applicability, and Evidence are all established:

1. **Citizenship requirement or exclusion** — an exact citizenship identity, or an exact exclusion
   of one named citizenship identity.
2. **Service or enrolment status** — only explicitly named active-duty, current-student,
   directed-training, service-obligation, or in-service/probation status predicates.
3. **Explicit disqualifying records** — only a named criminal sanction, disciplinary sanction,
   public-employment dismissal, recruitment-integrity record, or officially determined serious
   dishonesty record; each remains a distinct record kind.
4. **Formal clearance or decision predicates** — an explicitly required official decision, such as
   a dated fitness clearance, where the source specifies the decision rather than merely a
   subjective quality.
5. **Explicit condition evidence and candidate-state evidence** for the above predicates,
   including `UNKNOWN`, `INSUFFICIENT`, and `REVIEW_REQUIRED` states.

The phrase “core scope” does not permit a parser to classify merely similar wording as one of these
predicates. Every accepted phrase must have a source-preserving, deterministic grammar and a
specific typed predicate.

## 4. Non-Scope

This CR does not design or implement:

- nationwide professional directories, cross-directory mappings, aliases, or similarity rules;
- CR#11 major identity, law-family, or MajorMatchRelation semantics;
- expert professional comparison, course-percentage comparison, subjective expert review, or an
  employer-specific equivalence table;
- subjective capability, willingness, responsibility, communication ability, “优秀”, or other
  evaluative personal-quality criteria;
- an abstract model that decides whether a person has “good conduct” or “normal physical fitness”;
- Recommendation, score, ranking, product exclusion, Application State, Web/API, Supabase,
  Scheduler, Collector, third-party platforms, or real-data collection;
- Source Surface Composition discovery, binding, authority, selection, precedence, conflict
  resolution, hashing, or persistence;
- CR#10 result semantics, CR#11 major semantics, CR#12 logic/modality/applicability semantics, or
  existing real/P2 Canary data; and
- creation of a real RequirementSet, CandidateProfile, or EligibilityAssessment.

## 5. Design Principles

1. **Recall First / No False Exclusion.** Absence of evidence is never evidence of a candidate
   conflict.
2. **Requirement truth and candidate truth are separate.** A source can be complete even when the
   relevant candidate state is unknown; the latter may yield `INSUFFICIENT` only after all source
   gates pass.
3. **No generic-state fiction.** “品行良好” is not silently transformed into a conduct clearance,
   and “身体条件” is not silently transformed into a medical pass.
4. **Closed predicates only.** `NOT_MATCH` requires an explicit, closed Requirement predicate and
   complete, applicable, traceable contrary candidate evidence.
5. **No implicit source coverage.** A parser result with no observed condition does not prove that
   the source imposed none.
6. **No source inference.** Job title, duties, employer type, historical hiring, CandidateProfile,
   third-party rewrites, similarity, LLM, embedding, or fuzzy matching may not create a predicate.
7. **Immutable provenance.** Requirement-source facts and candidate-state assertions are versioned,
   traceable, and non-destructively retained.
8. **Existing owners remain owners.** CR#12 owns logic and applicability; Source Surface
   Composition owns source admission/composition; CR#10 owns dispatch and assessment results.

## 6. Terminology and State Separation

| Term | Meaning | Must not mean |
| --- | --- | --- |
| `RequirementPredicate` | A source-side, typed statement of what the role requires or excludes. | A candidate fact or an Eligibility result. |
| `CandidateStateAssertion` | A versioned assertion about one candidate’s relevant state. | A source Requirement or a recommendation. |
| `PredicateResolution` | Evaluation of one applicable predicate against one candidate assertion set: `TRUE`, `FALSE`, or `UNKNOWN`. | Requirement completeness. |
| `RequirementCompleteness` | Source-semantic and source-coverage state before Eligibility dispatch. | Candidate completeness. |
| `NOT_ALLOWED` | An execution-gate outcome; no Assessment exists. | `NOT_MATCH`, hide, delete, or exclude. |
| `INSUFFICIENT` | A post-gate assessment outcome caused by candidate-side uncertainty. | Evidence that the candidate is not qualified. |
| `NOT_APPLICABLE` | A CR#12 applicability result for a condition that does not apply to this candidate/context. | A stored candidate failure or an omitted condition. |

## 7. Domain Model

### 7.1 Proposed Requirement Dimensions

The future implementation may add only the following distinct Requirement dimensions, subject to
separate implementation approval:

| Dimension | Source-side meaning | Closed evaluation boundary |
| --- | --- | --- |
| `CITIZENSHIP_STATUS` | Requires or excludes one explicitly identified citizenship. | Exact source identity or explicitly versioned reference only; no inferred nationality alias. |
| `SERVICE_OR_ENROLMENT_STATUS` | Requires absence or presence of a named service/study/obligation state. | `ACTIVE_DUTY`, `CURRENT_STUDENT`, `DIRECTED_TRAINING`, `SERVICE_OBLIGATION`, `IN_SERVICE_PROBATION`. |
| `DISQUALIFICATION_RECORD` | Excludes a named adverse record. | `CRIMINAL_SANCTION`, `DISCIPLINARY_SANCTION`, `PUBLIC_EMPLOYMENT_DISMISSAL`, `RECRUITMENT_INTEGRITY_RECORD`, `OFFICIAL_SERIOUS_DISHONESTY_RECORD`. |
| `FORMAL_CLEARANCE_DECISION` | Requires a source-specified official pass/fail decision. | Named decision issuer, decision kind, status, and effective period. |

No `GENERAL_CONDUCT`, `GENERAL_HEALTH`, `OTHER_RECORD`, or catch-all `ELIGIBILITY_STATUS`
dimension is permitted. Such a catch-all would hide the source meaning and permit unsupported
negative inference.

### 7.2 RequirementPredicate

Each proposed atomic predicate must contain:

- `requirement_predicate_id`;
- one proposed Requirement dimension and one closed predicate kind;
- operator and polarity compatible with the existing CR#9/CR#12 canonical-negation contract;
- a canonical target value, preserving source text and any exact named authority, jurisdiction,
  event date, effective period, or reference date needed for the predicate;
- explicit source-side temporal relation: `AS_OF`, `DURING`, `BEFORE`, `AFTER`, `ON_OR_BEFORE`,
  `ON_OR_AFTER`, or `UNRESOLVED`;
- a `RequirementCondition` owner, CR#12 modality, CandidateStateApplicability, and one or more
  RequirementContextBindings;
- RequirementEvidenceFragment IDs, RequirementSourceReference IDs, source span, source order,
  parser/resolver/schema versions, and source-resolution state;
- a canonical representation version; and
- a resolution disposition: `RESOLVED`, `UNRESOLVED`, `UNPARSED`, `AMBIGUOUS`, or `DOMAIN_GAP`.

The predicate is source-side only. It cannot contain CandidateProfile IDs, asserted candidate
values, a candidate score, or a candidate-specific conclusion.

### 7.3 Predicate Kinds

The first implementation must use a closed union, not free text:

```text
CITIZENSHIP_EQUALS
CITIZENSHIP_EXCLUDED
STATUS_MUST_BE_ABSENT
STATUS_MUST_BE_PRESENT
DISQUALIFYING_RECORD_ABSENT
FORMAL_CLEARANCE_REQUIRED
```

`DISQUALIFYING_RECORD_ABSENT` means the source excludes candidates with one exactly named record;
it is not a claim that the candidate has no record. `FORMAL_CLEARANCE_REQUIRED` is available only
where the announcement actually requires a formal decision. It is not a parser shortcut for
general fitness or conduct language.

### 7.4 CandidateStateAssertion

A future CandidateProfile extension must add an immutable, append-only `CandidateStateAssertion`
instead of overwriting historical candidate state. It contains:

- `candidate_state_assertion_id` and `candidate_profile_id`;
- exact state dimension and a state-kind compatible with the target predicate;
- a source-neutral, typed value such as an exact citizenship identity, an enumerated
  service/enrolment status, a named adverse-record kind, or a formal decision;
- `state_observation_status`: `CONFIRMED`, `UNKNOWN`, `INSUFFICIENT`, or `REVIEW_REQUIRED`;
- observed/effective dates and reference-date applicability when relevant;
- evidence references, provenance class, issuer where relevant, and evidence-capture time;
- assertion schema/version and immutable `candidate_state_assertion_hash`;
- a supersession relation, if a later assertion corrects it, without rewriting the original; and
- `SYNTHETIC_TEST` provenance only for offline controls.

`NOT_APPLICABLE` is not stored as a candidate assertion. It is derived exclusively by the existing
CR#12 applicability and selector contracts.

### 7.4.1 Fact-Only Boundary

`CandidateStateAssertion` records only a source-neutral, typed candidate-state fact and its
Evidence, time, provenance, version, and hash. It must not store `requirement_match`,
`predicate_match`, `eligibility_result`, candidate-specific polarity, or any
Requirement-specific conclusion.

Requirement polarity and operator remain source-side Predicate fields. A later
`PredicateResolution`, under the frozen Engine semantics, compares those fields with the typed
candidate fact. For example, `CITIZENSHIP_EQUALS` and `CITIZENSHIP_EXCLUDED` both compare the
same typed citizenship fact; the CandidateStateAssertion never carries a match or non-match label.

### 7.5 Candidate-State Evidence Classes

| Evidence class | May establish `TRUE` | May establish `FALSE` / possible `NOT_MATCH` | Default if insufficient |
| --- | --- | --- | --- |
| `OFFICIAL_DECISION` | Yes, when target, time, and identity match. | Yes, when the disqualifying fact is exact and applicable. | `UNKNOWN` or `INSUFFICIENT` |
| `DOCUMENT_VERIFIED` | Yes, for an exact closed predicate. | Yes, only for explicit, complete contrary evidence. | `INSUFFICIENT` |
| `CANDIDATE_ASSERTED` | Never by itself for a source-required official clearance or absence-of-record predicate. | Never by itself. | `INSUFFICIENT` |
| `SYNTHETIC_TEST` | Only in synthetic controls. | Only in synthetic controls. | N/A |

An implementation must not perform external record lookup. It may evaluate only supplied,
evidence-referenced assertions.

## 8. Evidence Contract

### 8.1 Requirement Evidence

Every RequirementPredicate must trace through existing contracts:

```text
RequirementPredicate
  -> RequirementCondition / RequirementSourceReference
  -> RequirementEvidenceFragment and exact source locator
  -> selected SourceSurface
  -> SourceCompositionResult / OpportunityVersion
```

The source reference must identify role, applicable target, binding Evidence, source relation, and
revision/selection context using CR#12 and Source Surface Composition. A shared announcement URL,
source host, attachment filename, or publisher cannot broaden a predicate to another Position,
Batch, Location, or OpportunityVersion.

### 8.2 Candidate Evidence

Candidate-state evidence is not source-composition evidence. It must state its own provenance,
issuer where applicable, exact locator or document reference, observation time, and immutable
content hash. Candidate evidence cannot be copied into RequirementSet content and cannot alter
the RequirementSet hash.

### 8.3 Evidence Rejection

The source side is unresolved and blocks `COMPLETE` when evidence is missing, locator/binding is
unresolved, the selected surface is non-authoritative, source revision is unresolved, or the
Composition Result is non-`COMPLETE`. Candidate evidence that is missing, malformed, conflicting,
out of period, or below the required evidence class produces candidate-side `UNKNOWN`,
`INSUFFICIENT`, or `REVIEW_REQUIRED`; it never changes the source Requirement into absent.

## 9. Candidate-State Contract

### 9.1 Candidate-Side States

For a source-resolved applicable predicate, the candidate side may resolve only as follows:

| Candidate state | Meaning | Predicate result |
| --- | --- | --- |
| Explicitly satisfies the exact target with adequate evidence | Candidate fact proves the requested state. | `TRUE` |
| Explicitly conflicts with the exact target with adequate evidence | Candidate fact proves the prohibited/present/absent state. | `FALSE` |
| `UNKNOWN` | No relevant assertion exists. | `UNKNOWN` |
| `INSUFFICIENT` | An assertion exists but its proof, scope, time, identity, or authority is inadequate. | `UNKNOWN` |
| `REVIEW_REQUIRED` | Candidate evidence conflicts internally or cannot be interpreted under the closed predicate. | `UNKNOWN` |
| `NOT_APPLICABLE` | CR#12 established that the condition does not apply. | Excluded from mandatory evaluation by CR#12; never `FALSE`. |

Candidate-state uncertainty is never a source Completeness blocker by itself. It is an execution
input only after the Requirement Set has independently passed every source gate.

### 9.2 Candidate-State Conflict Rules

Two candidate assertions with incompatible values, overlapping effective periods, or no explicit
supersession relation remain `REVIEW_REQUIRED`. The evaluator must not prefer the newest assertion,
the more favorable assertion, the longer document, or a self-assertion. A candidate assertion from
one condition dimension cannot be reused for another dimension without an explicit typed mapping.

## 10. Applicability

CR#12 remains the sole owner of `CandidateCredentialApplicability`,
`CandidateStateApplicability`, `RequirementContextBinding`, selectors, and conditional branches.
This CR supplies typed predicate payloads only.

Rules:

1. A requirement-side time or status predicate must state the candidate-state selector and exact
   reference date, or be `UNRESOLVED`.
2. A predicate applies only to the Position/OpportunityVersion, Batch, Plan, and Location already
   established by its CR#12 context binding and Source Composition evidence.
3. An announcement-level predicate may apply to multiple Positions only where its scope Evidence
   explicitly proves that application; a row predicate remains row-local.
4. A condition which is inapplicable according to a resolved CR#12 selector cannot cause
   `NOT_MATCH`; no condition may infer inapplicability from missing candidate data.
5. If a status clause has an unstated reference date, an unbound cohort, or a conditional exception
   not represented by CR#12, it is `REVIEW_REQUIRED` and cannot enter a complete mandatory root.

## 11. Logical and Modal Semantics

This CR consumes CR#12; it does not redefine it.

- `MUST`, `应当`, `不得`, `仅限`, and other source wording become mandatory only through the
  frozen CR#12 modality classifier and preserved Evidence.
- `优先`, `有相关经历者优先`, `可以`, and informational text remain `PREFERRED`, `OPTIONAL`, or
  `INFORMATIONAL` under CR#12. They never independently produce `NOT_MATCH`.
- `AND`, `OR`, `NOT`, parentheses, `除非`, `不适用于`, and `WHEN / THEN / ELSE` use the existing
  CR#12 logic tree, protected-span, conditional-branch, and selector contracts.
- This CR cannot create a new connector rule, flatten a condition tree, or decide whether punctuation
  is `OR`. If a general-condition phrase needs logic that CR#12 cannot represent, the condition is a
  design blocker rather than a parser exception.

## 12. Completeness Contract

### 12.1 Requirement Complete

A RequirementSet may treat an in-scope general predicate as source-complete only when all of the
following are true:

1. its predicate kind and target value are closed and source-resolved;
2. original text, exact Evidence, source role, authority, binding, and revision selection are
   complete;
3. Source Composition is `COMPLETE`, trusted, hash-valid, and references the same
   OpportunityVersion and `as_of` value;
4. CR#12 modality, logic position, CandidateStateApplicability, context binding, selector, and
   conditional scope are resolved and hash-valid;
5. required temporal boundary, issuer, record kind, and any exception are explicit and representable;
6. each `RequirementPredicate` has exactly one definition instance in the canonical structured
   manifest and is referenced by its stable predicate ID from the CR#12 logic tree and mandatory
   root when mandatory. This rule does not restrict any otherwise legal CR#12 reference, reuse,
   connector, tree, selector, or conditional-branch structure; and
7. no applicable source conflict, unparsed clause, ambiguous text, missing surface, or `DOMAIN_GAP`
   remains.

### 12.2 Requirement Not Complete

The set remains `REVIEW_REQUIRED`/`INCOMPLETE` and Eligibility remains `NOT_ALLOWED` when a
mandatory general clause is present but generic, subjective, open-ended, unparsed, unbound,
temporally ambiguous, authority-unknown, source-conflicted, or outside this CR’s closed predicate
set. It is not valid to remove such a clause solely because other clauses parse successfully.

### 12.3 Candidate State Does Not Change Completeness

A candidate with unknown citizenship, service, record, clearance, or evidence does not make the
Requirement Set incomplete. Once source completeness is proven, candidate uncertainty produces the
evaluation result required by Section 13.

## 13. Deterministic Evaluation Semantics

This is a future capability contract; this CR does not authorize CR#10 implementation.

For each applicable mandatory predicate after all source and runtime gates pass:

| Predicate result | Required behavior |
| --- | --- |
| `TRUE` | The predicate is satisfied. It may contribute to `MATCH`. |
| `FALSE` | It may contribute to `NOT_MATCH` only when the predicate is closed, applicable, mandatory, and the contrary candidate evidence is complete and traceable. |
| `UNKNOWN` | It produces `INSUFFICIENT`; it never becomes `FALSE`. |
| Source unresolved or gate failure | `NOT_ALLOWED`; no Assessment is created. |
| `NOT_APPLICABLE` | CR#12 excludes the condition from the candidate’s mandatory evaluation; it cannot be used as a favorable or unfavorable predicate result. |

Aggregate results remain owned by CR#10:

```text
all applicable mandatory predicates TRUE
  -> MATCH

at least one applicable mandatory predicate conclusively FALSE
and no applicable mandatory predicate UNKNOWN
  -> NOT_MATCH

source/runtime gates passed but any applicable mandatory predicate UNKNOWN
  -> INSUFFICIENT

any source/runtime gate fails
  -> NOT_ALLOWED; no EligibilityAssessment
```

A `PREFERRED`, `OPTIONAL`, or `INFORMATIONAL` condition may remain diagnostic, but cannot produce
`NOT_MATCH`.

## 14. Failure Semantics

| Failure or uncertainty | Requirement state | Candidate/Eligibility effect |
| --- | --- | --- |
| Clause absent from a fully covered source package | No predicate only when `EMPTY_CONFIRMED` is independently proven. | No inferred condition. |
| Clause exists but is unparsed or out of scope | `REVIEW_REQUIRED`. | `NOT_ALLOWED`; retain Opportunity. |
| Source Evidence missing or binding unresolved | `REVIEW_REQUIRED`. | `NOT_ALLOWED`; retain Opportunity. |
| Source Composition non-`COMPLETE` | Not composition-backed complete. | `NOT_ALLOWED`; no Assessment. |
| Source conflict / revision ambiguity | `REVIEW_REQUIRED` or `CONFLICT`. | `NOT_ALLOWED`; no Assessment. |
| Candidate fact missing | Source completeness unchanged. | `INSUFFICIENT` after gate. |
| Candidate evidence inadequate | Source completeness unchanged. | `INSUFFICIENT` after gate. |
| Candidate evidence internally conflicts | Source completeness unchanged. | `INSUFFICIENT` after gate, with review diagnostic. |
| Explicit source requirement and verified contrary candidate fact | Source complete. | Possible `NOT_MATCH` only under Section 13. |

No row in this table produces a product exclusion. Only a future product layer, outside this CR,
could consider a complete, traceable `NOT_MATCH`; it may never treat `NOT_ALLOWED`, `UNKNOWN`,
`INSUFFICIENT`, `REVIEW_REQUIRED`, or `CONFLICT` as exclusion.

## 15. Provenance and Hash Contract

### 15.1 Reused Source Contracts

This CR does not add a Source Composition hash or duplicate its nested-object hash contracts.
Requirement predicates reuse the verified SourceCompositionResult, SourceSurface, binding,
authority, manifest, revision/selection, conflict, and composition hash references. A missing or
untrusted reference fails the existing Composition Gate.

### 15.2 New Candidate-State Assertion Hash

`CandidateStateAssertion` requires an object-level canonical hash because a later assessment must
be reproducible against the exact candidate-state evidence it evaluated.

Its canonical input contains all assertion fields except `candidate_state_assertion_hash`, including
ID, candidate profile ID, dimension, typed value, status, effective-time fields, provenance,
evidence references and their immutable identifiers, issuer, schema version, and supersession
relation. Collections are canonically ordered by stable identifier. The hash uses the project’s
existing deterministic canonical-serialization and digest policy; this CR introduces no second
serializer or algorithm.

The implementation must:

1. generate the hash from the self-excluding canonical representation;
2. persist it with the immutable assertion;
3. recompute and compare it before structured evaluation;
4. reject missing, malformed, or unequal hashes; and
5. include the evaluated assertion IDs and hashes in the future assessment’s evaluation-input
   provenance, never in the RequirementSet content hash.

Candidate assertion hash failure is a candidate-input gate failure: it cannot yield `NOT_MATCH`.

### 15.3 RequirementSet Hash Participation

The structured RequirementSet hash must include the new predicate payload, source Evidence IDs,
source references, CR#12 logic/binding/applicability references, parser/resolver/schema versions,
and the exact SourceCompositionReference already required by the frozen Composition contract. It
must not include candidate assertions, candidate evidence, or a candidate result.

## 16. Relationship to Existing Contracts

| Contract | This CR may consume | This CR must not change |
| --- | --- | --- |
| Recruitment Context & Position Identity | Resolved/provisional target identities and revision relations. | Identity resolution, aliases, reconciliation, plan/batch defaults, or Opportunity retention rules. |
| Source Surface Composition | Trusted COMPLETE composition, selected surfaces, authority, bindings, source versions, and hashes. | Discovery, inventory, authority, selection, precedence, conflicts, or composition runtime logic. |
| CR#11 | No major semantics are required for this scope. | Any major identity, directory, family, relation, or law-specific evaluation. |
| CR#12 | RequirementCondition, logic tree, modality, selectors, applicability, context binding, source references, manifest, and completeness rules. | Operators, protected spans, conditional semantics, modality meanings, or binding semantics. |
| CR#10 Engine Integration | Future capability-gated structured dispatch and three-state outcomes. | Existing capability declarations, engine result semantics, or legacy assessment behavior. |

Until a separately approved CR#10 capability change supports these predicates, a structured set
requiring them must return `NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY`. It may not be
flattened into legacy Facts, partially evaluated, or silently ignored.

## 17. Compatibility and Legacy Preservation

1. Existing RequirementSet, Fact, Evidence, CandidateProfile, and EligibilityAssessment IDs remain
   readable and immutable.
2. A legacy set has no implicit general-predicate projection and no implicit CandidateStateAssertion.
3. New structured predicates are additive and versioned. They cannot change the interpretation of a
   prior `GENDER`, `POLITICAL_AFFILIATION`, `AGE`, `CANDIDATE_COHORT`, or other existing Fact.
4. Existing CandidateProfile fields remain readable. No missing legacy field is backfilled with a
   default citizenship, clearance, absence-of-record, service, or enrolment state.
5. A future migration may append new candidate-state assertions and explicit aliases only; it may
   not destructively rewrite historical profiles or assessments.
6. Legacy execution and structured execution cannot evaluate the same source exclusion twice or
   introduce double negation.

## 18. In-Scope Admission Matrix

| Observed source wording category | Initial disposition | Reason |
| --- | --- | --- |
| Exact citizenship requirement, e.g. a named citizenship | Candidate for `CITIZENSHIP_STATUS` | Closed identity if source scope and candidate proof are explicit. |
| “现役军人不得报考” or exact current-study/service exclusion | Candidate for `SERVICE_OR_ENROLMENT_STATUS` | Closed named status, subject to reference date and applicability. |
| Exact named criminal, disciplinary, dismissal, integrity, or dishonesty exclusion | Candidate for `DISQUALIFICATION_RECORD` | Closed record kind only; authority and time must be explicit. |
| “体检合格” with named formal decision and period | Candidate for `FORMAL_CLEARANCE_DECISION` | Evaluates decision, not medical facts. |
| “品行良好”“遵纪守法”“人格健全” without closed official decision | Out of scope; preserve blocker | Subjective/open or lacks an evaluable target. |
| “具备正常履职身体条件” without formal decision/standard | Out of scope; preserve blocker | Cannot infer fitness criterion or candidate state. |
| “法律法规规定的其他不得报考情形” | Out of scope; preserve blocker | Open external legal set and applicability are unresolved. |
| “课程相近率达到 70% 并经专家论证” | Out of scope; preserve blocker | Requires external comparison and expert decision. |
| “有较强责任感/能力” | Out of scope; preserve blocker | Subjective capability condition. |

## 19. Explicit Blocker Conditions

The following always block a `COMPLETE` RequirementSet for an applicable mandatory clause unless a
future separately approved contract resolves them:

1. open-ended conduct, health, legal, or “other related” wording;
2. an unnamed record, unnamed authority, unknown jurisdiction, or missing record time boundary;
3. an exception or relaxation whose `WHEN / THEN / ELSE` structure cannot be represented by CR#12;
4. an unknown reference date for a service, enrolment, age, or record condition;
5. missing source surface, authority, target binding, revision selection, or trusted Composition
   reference;
6. source conflict, source-side evidence conflict, or a source-unresolved `OR` branch;
7. a requirement that depends on external expert judgement, a nationwide catalogue, similarity,
   course comparison, employer discretion, or an unmodeled administrative workflow;
8. a predicate with no canonical typed value or no source Evidence;
9. a candidate assertion hash failure when evaluation is attempted; and
10. an unavailable CR#10 capability for a structured predicate.

Items 1–8 are source completeness blockers. Item 9 is a candidate-input integrity gate failure:
a missing, malformed, or recomputation-mismatched assertion hash yields `NOT_ALLOWED` and never
`NOT_MATCH`. Item 10 is the existing runtime capability gate. Candidate assertion conflicts remain
`REVIEW_REQUIRED`; after source/runtime gates pass, they resolve candidate evaluation to `UNKNOWN`
and aggregate to `INSUFFICIENT`. Candidate evidence that is inadequate or insufficient likewise
aggregates to `INSUFFICIENT`. Neither candidate conflict nor inadequate evidence is an integrity
gate failure, and neither may yield `NOT_MATCH`.

## 20. Recall-First Safety Rules

The following rules are non-bypassable:

```text
explicit, closed Requirement
+ exact, applicable, adequately evidenced contrary candidate state
  -> possible NOT_MATCH

explicit, closed Requirement
+ exact, applicable, adequately evidenced satisfying candidate state
  -> TRUE predicate; aggregate MATCH only if all mandatory predicates are TRUE

missing candidate assertion / insufficient candidate proof / candidate conflict
  -> UNKNOWN predicate -> INSUFFICIENT after source and runtime gates

unparsed source clause / missing source Evidence / unresolved scope or binding / source conflict
  -> REVIEW_REQUIRED or INCOMPLETE -> NOT_ALLOWED; no Assessment
```

The following transformations are forbidden:

```text
no candidate evidence        -> NOT_MATCH
candidate UNKNOWN            -> FALSE
candidate review required    -> FALSE
parser failure               -> unrestricted condition
source conflict              -> candidate failure
non-COMPLETE composition     -> fallback Eligibility evaluation
NOT_ALLOWED                  -> product exclusion
```

## 21. Verification Strategy

The approved implementation adds offline synthetic controls for the following frozen boundary:

1. exact citizenship requirement with verified same, verified different, unknown, insufficient, and
   conflicting candidate evidence;
2. exact active-duty/current-student/service-obligation exclusion with reference-date boundaries;
3. each closed disqualifying-record kind with verified present, verified absent, unknown, and
   inadequate self-assertion states;
4. formal fitness/clearance decision versus generic health wording;
5. generic conduct wording versus a named official conduct decision;
6. `MUST`, `PREFERRED`, `OPTIONAL`, and `INFORMATIONAL` conditions without reimplementing CR#12;
7. `AND`, `OR`, `NOT`, selector, `WHEN / THEN / ELSE`, Position, Batch, and Location isolation
   through CR#12 contracts;
8. source-unresolved branch, missing Evidence, unresolved binding, revision conflict, and
   non-COMPLETE Composition each yielding `NOT_ALLOWED`, never `NOT_MATCH`;
9. candidate unknown after a COMPLETE source yielding `INSUFFICIENT`, never `NOT_MATCH`;
10. self-excluding candidate assertion canonical hash stability, format rejection, missing hash,
    tamper rejection, and canonical-content mutation rejection;
11. RequirementSet manifest/content-hash mutation when a general predicate or its Evidence changes;
12. CR#10 unsupported capability fence, legacy non-promotion, and no double-negation; and
13. no network, real-data, P2/Canary, Collector, Scheduler, Web/API, Supabase, or production write.

Verification includes the focused suite, CR#9–#12, Recruitment Context, Source Surface
Composition, CR#10 structured-engine regressions, `pnpm typecheck`, `pnpm test:phase1`,
`pnpm test:architecture`, Application Boundary, Network Guard, `git diff --check`, and a whitelist
scope audit.

## 22. Acceptance Criteria

This CR design may be approved for implementation planning only when reviewers confirm that:

1. every included predicate kind is closed, source-neutral, and distinguishable from every other;
2. every excluded open/subjective condition remains retained and blocking, rather than silently
   reclassified;
3. source provenance is fully delegated to existing Source Surface Composition and CR#12 contracts;
4. candidate-state assertions are separate from Requirement content and have reproducible,
   self-excluding canonical hashes;
5. only explicit, complete, applicable contradictory candidate evidence can produce a `FALSE`
   mandatory predicate and a possible `NOT_MATCH`;
6. `UNKNOWN`, `INSUFFICIENT`, `REVIEW_REQUIRED`, `CONFLICT`, and `NOT_ALLOWED` cannot become
   product exclusion;
7. CR#10, CR#11, CR#12, Recruitment Context, and Source Surface Composition ownership remains
   unchanged;
8. legacy RequirementSets and assessments remain readable and non-destructively isolated; and
9. the implementation whitelist excludes all P2 real-data and network surfaces.

## 23. Future P2-LEGAL-08B Handoff Contract

This CR is a prerequisite design, not authorization to run P2-LEGAL-08B. A future real Eligibility
Canary may proceed only when all of the following are independently true:

1. the selected official announcement and every requirement-bearing attachment have separate,
   human-approved endpoint admission, authorization, collection run, Evidence, Raw, and Snapshot;
2. the exact OpportunityVersion has a trusted, `COMPLETE` SourceCompositionResult with no required
   missing, unresolved, non-authoritative, unbound, conflicting, or unselected source surface;
3. all mandatory clauses are either represented by a frozen executable predicate or retained as a
   Requirement blocker;
4. CR#12 structured completeness, logic, modality, applicability, context binding, and hashes pass;
5. CR#10 declares every necessary capability and its trusted runtime gates pass;
6. the synthetic CandidateProfile has only the explicit state assertions needed for the control;
   omitted state remains `UNKNOWN`/`INSUFFICIENT`; and
7. any unmet precondition yields `NOT_ALLOWED`, preserves the Opportunity, and creates no real
   EligibilityAssessment.

Guizhou `22828700101` remains `REVIEW_REQUIRED / NOT_ALLOWED`. It is not a migration target and
must not be altered to demonstrate this CR.

## 24. Design-Stage Blockers

The implementation approval freezes the closed core to the four dimensions in Section 7.1. The
following production decisions remain deliberately outside this implementation:

1. the permitted evidence threshold for an affirmative candidate-side clearance, absence-of-record,
   service, or citizenship assertion in a real deployment;
2. the required CandidateProfile versioning/persistence boundary for immutable
   CandidateStateAssertion records, without expanding into production persistence; and
3. the exact later CR#10 capability boundary needed to consume these predicates without changing its
   frozen three-state result semantics.

This implementation creates no CandidateProfile field, persistence mapping, CandidateStateAssertion
production storage, PredicateResolution, real EligibilityAssessment, real source access, or P2
Eligibility execution. CandidateStateAssertion remains `SYNTHETIC_TEST` only.

## 25. Final Verdict

`IMPLEMENTED / VERIFIED`

The offline contract is implemented and remains capability-fenced. It does not enable a real
general-eligibility Assessment or a P2 legal Eligibility assessment.

## 26. Implementation Verification Record

- focused general-eligibility controls: `12/12 PASS`;
- CR#9, CR#10 integration, CR#11, CR#12, Recruitment Context, and Source Surface Composition:
  `PASS`;
- P1 full suite: `153/153 PASS`;
- tracked P2 suite: `246/246 PASS`;
- TypeScript, Architecture, Application Boundary, Network Guard, and `git diff --check`: `PASS`;
- network requests: `0`;
- scope: only the approved general-eligibility Domain, parser, capability gate, focused tests, and
  documentation were changed; existing dirty working-tree files remain outside this CR's changes.
