# P1 Change Request #12 — Requirement Logic / Modality / Conditional Applicability (Revised)

## Status

`CR#12 = IMPLEMENTED / VERIFIED`

Design blocker disposition: `CLOSED IN REVISED DRAFT`.

Implementation disposition: `COMPLETED AND VERIFIED WITHIN THE STRICT FILE AND DOMAIN BOUNDARY IN SECTION 21`.

## 1. Revision Boundary

This CR closes the design blockers identified by the CR#12 Implementation Readiness Review and implements only the approved structured-Requirement boundary. It does not:

- change the legacy flat Requirement contract semantics;
- modify CR#9, CR#10, or CR#11 behavior;
- modify the Eligibility Engine;
- modify P2 or any Canary;
- create production data, production Requirement Sets, CandidateProfiles, or EligibilityAssessments;
- modify persistence, API, Web, Scheduler, Collector, or Recommendation behavior;
- access any network source;
- authorize any follow-on implementation.

The implemented contract freezes:

1. explicit nested Requirement logic;
2. Requirement modality;
3. three separate applicability and binding layers;
4. condition-level recruitment-context binding;
5. complete Requirement source references;
6. deterministic source-to-tree parsing precedence;
7. a typed conditional selector contract;
8. CR#9 legacy compatibility and canonical negation;
9. Requirement Set completeness and content hashing;
10. an execution capability fence protecting the CR#10 Engine;
11. Controls A–AH;
12. Recall First / No False Exclusion invariants.

## 2. Problem Statement

The current Requirement model can preserve atomic Facts, assign a Fact to a flat `AND` or `OR` group, record positive or negative polarity, and attach limited candidate-cohort applicability. It cannot safely preserve common source expressions such as:

- `A AND (B OR C)`;
- `NOT (A OR B)`;
- one mandatory condition plus a separate preferred condition;
- candidate-credential-specific conditions;
- candidate-cohort-specific conditions;
- Position-, Batch-, or Location-specific conditions;
- `IF A THEN B ELSE C`;
- correction or replacement text that applies only to one OpportunityVersion;
- source clauses whose connector, modality, applicability, or binding cannot be determined safely.

The safety risk is:

```text
complex source clause
-> lost, flattened, misbound, or partially parsed condition
-> apparently COMPLETE Requirement Set
-> false MATCH or false NOT_MATCH
-> false product exclusion
```

CR#12 must prevent that path. It is not permitted to make the parser more permissive merely to increase the number of COMPLETE Requirement Sets.

## 3. Ownership and Cross-CR Boundary

### 3.1 CR#8

CR#8 owns source-neutral Evidence, Requirement Observations and Facts, Requirement Set completeness, blocker-first Eligibility gating, and `COMPLETE / INCOMPLETE / REVIEW_REQUIRED`.

CR#12 adds structured logic to that pipeline. It does not weaken CR#8 blockers or permit Eligibility from a non-complete set.

### 3.2 CR#9

CR#9 owns the existing typed Requirement dimensions, atomic subject scopes, major-scope relationships, match-rule primitives, legacy polarity, legacy negative operators, legacy LogicGroup, and legacy cohort applicability.

CR#12 provides an additive, versioned projection. It does not rewrite CR#9 history. Section 15 freezes the only permitted legacy-to-CR#12 mapping.

### 3.3 CR#10

CR#10 owns CandidateProfile and the currently implemented legacy flat-Fact Eligibility Engine.

CR#12 does not modify that Engine. A CR#12 structured Requirement Set is not executable by the CR#10 Engine. Section 16 defines the mandatory capability fence.

### 3.4 CR#11

CR#11 owns MajorIdentity, MajorExpression, MajorScope, MajorDirectory and DirectoryVersion, major-specific applicability, explicit major-equivalence Evidence, identification of a proven major candidate-list context, and protection of atomic major identities.

CR#12 owns only the Boolean structure into which an already identified major predicate is placed. CR#12 must not decide whether one major identity includes, excludes, or equals another.

If an implemented CR#11 semantic output is unavailable, a raw major expression that depends on CR#11 classification remains blocking. CR#12 may test its logic layer with synthetic, explicitly pre-classified MajorExpression inputs, but it must not silently implement CR#11 parsing.

### 3.5 Recruitment Context & Position Identity

Recruitment Context & Position Identity owns the identities and lifecycle of Announcement, AnnouncementVersion, RecruitmentPlan, RecruitmentBatch, Position, PositionVersion, Opportunity, OpportunityVersion, OrganizationRoleAssignment, LocationAssignment, HeadcountObservation, RecruitmentPopulationReference, revision relations, Identity Evidence, alias, reconciliation, provisional, and unresolved states.

CR#12 references those identities. It does not recreate or infer them. The CR#12 binding layer may consume and validate an already resolved identity or relation supplied by the Recruitment Context boundary; it is not an identity resolver and cannot manufacture a target from title, URL, location, or CandidateProfile.

## 4. Permanent Safety Invariants

1. `Unable to prove MATCH != proof of NOT_MATCH`.
2. Candidate unknown never becomes false.
3. Source-semantic unknown never enters Eligibility.
4. Missing Evidence never becomes unrestricted.
5. Missing source coverage never becomes COMPLETE.
6. An unresolved connector, modality, applicability, selector, target binding, or negation scope blocks COMPLETE.
7. A TRUE branch cannot hide source-semantic uncertainty in another OR branch.
8. Requirement unresolved does not invalidate or delete an Opportunity.
9. Identity unresolved does not invalidate or delete an Opportunity.
10. `NOT_ALLOWED` is an execution gate, not a product-pool exclusion.
11. Source conflict does not become Candidate failure.
12. Incomplete Requirement Sets remain preserved and traceable.
13. Only complete, evidence-backed, affirmatively false mandatory logic may produce `NOT_MATCH`.
14. No Requirement is inferred from job title, duties, organization type, historical hiring outcome, CandidateProfile, or third-party interpretation.
15. No LLM, embedding, fuzzy match, probability, or favorable-outcome heuristic may establish source logic.

## 5. Condition and Logic Model

### 5.1 RequirementCondition

The minimum executable semantic unit is a `RequirementCondition`, not a bare Fact. A condition records:

- `requirement_condition_id`;
- the authoritative `opportunity_version_id` of its Requirement Set;
- exactly one `RequirementModality`;
- exactly one predicate representation: one `RequirementLogicTree` or one `ConditionalRequirementBranchSet`;
- exactly one `CandidateCredentialApplicability`;
- exactly one `CandidateStateApplicability`;
- one or more `RequirementContextBinding` references;
- one or more `RequirementSourceReference` references;
- Evidence Fragment IDs for the condition, modality, connectors, applicability, and binding;
- original source span and source order;
- parser and resolver versions;
- resolution state: `RESOLVED` or `UNRESOLVED`.

An unresolved condition is preserved, hashed, and represented by a blocking Observation. It cannot enter the executable mandatory root.

### 5.2 Explicit Mandatory Root

The top-level mandatory combination is persisted explicitly and is never an undocumented implicit behavior.

`RequirementMandatoryRoot` has exactly one state:

- `EMPTY_CONFIRMED` — zero mandatory conditions were confirmed only after complete source-surface coverage and explicit modality classification;
- `SINGLE` — references exactly one mandatory condition;
- `AND` — contains an ordered list of at least two mandatory condition IDs.

Rules:

- Mandatory conditions are never combined by top-level OR unless the source itself produced one mandatory condition whose internal tree is OR.
- Preferred, optional, and informational conditions never appear in the mandatory root.
- `EMPTY_CONFIRMED` requires Evidence and complete source coverage; an empty parser result is not sufficient.
- `EMPTY_CONFIRMED` does not authorize the legacy CR#10 Engine.
- Any mandatory condition omitted from the root blocks COMPLETE.
- Any non-mandatory condition included in the root blocks COMPLETE.

### 5.3 RequirementLogicTree

A Requirement logic tree contains one tree ID, one owning condition ID, exactly one root node ID, a finite node registry, ordered child references, node-level Evidence and source-span references, parser version, and canonical serialization version.

The node union is:

1. `PREDICATE` references exactly one atomic RequirementFact and has no children.
2. `GROUP` uses `AND` or `OR` and has at least two ordered children in a resolved persisted tree.
3. `NOT` has exactly one child and negates that complete child expression.

Every node records one or more context-binding IDs. Normally they equal the condition binding. A narrower node binding is allowed only when explicitly supported by Evidence and when its effective target remains inside the condition's allowed target set.

### 5.4 Graph Invariants

- The root has no parent.
- Every non-root node has exactly one parent.
- Cycles are forbidden.
- Dangling child or leaf references are forbidden.
- Disconnected nodes are forbidden.
- Empty trees are forbidden.
- Empty AND or OR groups are forbidden.
- A resolved AND or OR group with one child is forbidden.
- NOT has exactly one child.
- A PREDICATE references exactly one Fact.
- A Fact cannot appear through multiple leaves in the same canonical tree.
- Every mandatory Fact is reachable from exactly one mandatory condition.
- A node, Fact, tree, selector, or branch owned by another condition cannot be referenced.
- Every connector, grouping decision, and negation scope has node-level Evidence.
- Tree order preserves source order and participates in hashing.

Malformed caller-provided or persisted graphs are input-integrity errors. Source text that cannot be converted into a valid graph becomes an evidence-backed `AMBIGUOUS` Observation. A structure outside this bounded Domain becomes `DOMAIN_GAP_OBSERVED`.

### 5.5 No Silent Simplification

The parser and validator must not remove an unresolved branch, collapse an invalid unary group, apply De Morgan transformations, simplify tautologies or contradictions, deduplicate source branches merely because normalized text matches, reorder children for a favorable result, or flatten nested groups if original grouping or Evidence would be lost.

### 5.6 Atomic Operator Boundary

Requirement operators compare one typed Candidate attribute with one evidence-backed atomic value or closed value set. They do not replace the logic tree.

- `ONE_OF` may express membership in one closed value set for one dimension; it does not combine independent Requirement predicates.
- `ALL_OF` may express an explicitly closed, same-dimension atomic set only when its Candidate semantics are already defined; otherwise separate predicates use an AND tree.
- Alternatives across separately evidenced identities or predicates use an OR tree.
- `NOT_EQUALS` and `NONE_OF` are legacy input forms only and project through Section 10.
- A CR#12 canonical Fact cannot carry `polarity=NEGATIVE`.
- `UNRESTRICTED` cannot be wrapped in NOT to manufacture a restriction.

If the boundary between one atomic set predicate and multiple logical branches cannot be established, the source remains `AMBIGUOUS`.

## 6. Three-Layer Applicability Model

The name `RequirementApplicability` must not be reused for multiple meanings. New CR#12 conditions use three separately named concepts.

### 6.1 CandidateCredentialApplicability

`CandidateCredentialApplicability` selects the Candidate fact or education credential against which a condition predicate is evaluated.

Its modes are:

- `CANDIDATE_WIDE` — concerns the Candidate as a whole and selects no education credential;
- `UNDERGRADUATE`;
- `GRADUATE`, while preserving the distinction between GRADUATE and MASTER;
- `HIGHEST_DEGREE`;
- `ANY_DEGREE`;
- `ALL_DEGREES`;
- `SPECIFIC_DEGREE` with exactly `BACHELOR`, `MASTER`, or `DOCTOR`;
- `EITHER_LEVEL`;
- `UNRESOLVED`.

It records applicability ID, mode, any specific degree target, the explicit applicable degree set required by `ANY_DEGREE`, `ALL_DEGREES`, or `EITHER_LEVEL`, any cross-level relationship, Evidence Fragment IDs, certainty, and parser version. `UNDERGRADUATE` means the source uses an undergraduate-level scope; `SPECIFIC_DEGREE:BACHELOR` means the source identifies the bachelor's credential specifically.

`CANDIDATE_WIDE` does not mean all cohorts and does not mean all recruitment-context targets.

### 6.2 CandidateStateApplicability

`CandidateStateApplicability` determines whether a condition applies to a Candidate cohort or another approved Candidate state.

Its modes are:

- `ALL_CANDIDATES`;
- `COHORT_ANY_OF`;
- `COHORT_ALL_OF`;
- `STATE_SELECTOR` referencing an approved typed selector tree;
- `UNRESOLVED`.

It records applicability ID, mode, cohort/state codes or selector-tree ID, Evidence Fragment IDs, certainty, and parser version. `STATE_SELECTOR` is permitted only on a RequirementCondition; it cannot be nested inside a selector predicate's own applicability.

If source state applicability is resolved but Candidate data is missing, future evaluation is UNKNOWN and projects to `INSUFFICIENT`. If source state applicability is unresolved, the Requirement Set is `REVIEW_REQUIRED / NOT_ALLOWED`.

### 6.3 RequirementContextBinding

`RequirementContextBinding` records where source content originated and which recruitment-context target the condition legally applies to. It is not Candidate applicability and is defined in Section 7.

### 6.4 No Cross-Layer Inference

- CandidateProfile cannot select or repair credential applicability.
- Candidate cohort cannot determine education scope.
- Opportunity location cannot determine Candidate residence.
- An Announcement target cannot automatically become an all-Position effective target.
- An OpportunityVersion binding cannot automatically make a condition applicable to every Position or Location represented by that Opportunity.
- A favorable result cannot choose any applicability mode.

## 7. Requirement Context Binding

### 7.1 RequirementContextTarget

The target union may reference only existing Recruitment Context identities:

- `ANNOUNCEMENT` and Announcement ID;
- `ANNOUNCEMENT_VERSION` and AnnouncementVersion ID;
- `RECRUITMENT_PLAN` and RecruitmentPlan ID;
- `RECRUITMENT_BATCH` and RecruitmentBatch ID;
- `POSITION` and Position ID;
- `POSITION_VERSION` and PositionVersion ID;
- `OPPORTUNITY` and Opportunity ID;
- `OPPORTUNITY_VERSION` and OpportunityVersion ID;
- `LOCATION_ASSIGNMENT` and LocationAssignment ID;
- `REVISION_RELATION` and RecruitmentRevisionRelation ID plus its resolved affected target;
- `UNRESOLVED` with preserved raw target text and Evidence.

CR#12 references these IDs and does not define new identity semantics.

### 7.2 Binding Contract

Each `RequirementContextBinding` records:

- binding ID;
- source-context target where the source clause is located;
- effective target or explicit effective target set where the condition applies;
- authoritative Requirement Set OpportunityVersion ID;
- binding scope: `EXACT_TARGET`, `EXPLICIT_TARGET_SET`, `CONDITIONAL_CONTEXT`, or `UNRESOLVED`;
- binding state: `RESOLVED` or `UNRESOLVED`;
- binding certainty: `EXPLICIT`, `CORROBORATED`, or `UNRESOLVED`;
- source locator;
- Evidence Fragment IDs and Identity Evidence IDs;
- optional revision-relation ID;
- resolver version.

The source-context target and effective target are deliberately separate. A clause located in an Announcement is not automatically effective for every Position under that Announcement.

### 7.3 OpportunityVersion Authority

`RequirementSet.opportunity_version_id` remains the top-level authoritative binding.

Every resolved mandatory condition included in that set must have an effective binding compatible with exactly that OpportunityVersion. Compatibility requires:

- an exact OpportunityVersion target; or
- an evidence-backed PositionVersion, Batch, or LocationAssignment target already related to that OpportunityVersion by the implemented Recruitment Context model; or
- an explicitly scoped Announcement/Plan condition whose Evidence proves applicability to that OpportunityVersion.

A condition bound only to another OpportunityVersion is rejected as cross-opportunity contamination.

### 7.4 Announcement Uniform Conditions

An Announcement-level condition may be projected into multiple OpportunityVersion Requirement Sets only when Evidence establishes its applicable scope.

A shared Announcement URL, Snapshot, title, publisher, attachment, or physical text proximity is not sufficient. If applicability to a Position cannot be established, the condition remains preserved with unresolved binding and blocks completeness. It is not broadcast to all Positions, and the Opportunity is not deleted.

### 7.5 Position-Row Isolation

A job-table row Requirement is bound only to the PositionVersion and OpportunityVersion represented by that row unless explicit Evidence states otherwise.

Same URL, title, organization, Batch, or location does not authorize cross-row sharing.

### 7.6 Batch and Location Conditions

A Batch-specific condition carries a `RECRUITMENT_BATCH` target and affected OpportunityVersion. A Location-specific condition carries a `LOCATION_ASSIGNMENT` target and must not be generalized to every location in the PositionVersion.

If future Eligibility requires a selected application location or Batch context and that context is unavailable, Candidate evaluation is UNKNOWN only after source binding is complete. If source binding itself is unresolved, completeness is blocked.

### 7.7 Correction, Supplement, and Replacement

A correction, supplement, or replacement carries its source AnnouncementVersion or occurrence, existing RecruitmentRevisionRelation ID, resolved affected target, resulting OpportunityVersion target, Evidence for affected scope, and relation/resolver versions.

- A correction contributes to the correct OpportunityVersion and does not mutate historical Requirement Sets.
- A replacement does not delete replaced Evidence.
- An unresolved affected scope blocks completeness.
- A correction for one Position cannot modify sibling Positions.
- A relation inferred only from URL or title remains unresolved.

### 7.8 Node-Level Binding

Every Requirement and selector node records binding IDs. A node normally uses the owning condition binding. A branch or leaf may narrow to a Batch or Location only with explicit Evidence. A node cannot widen beyond its condition target set. Cross-condition or cross-Opportunity bindings are invalid. Binding changes participate in content hashing.

## 8. RequirementSourceReference

### 8.1 Required Fields

`RequirementSourceReference` records:

- source-reference ID;
- Snapshot ID;
- ExtractedRecord ID;
- source role;
- source-context target;
- applicable RequirementContextBinding IDs;
- binding Evidence Fragment IDs and optional Identity Evidence IDs;
- exact source locator;
- source relationship;
- relationship target source-reference IDs when applicable;
- binding state and certainty;
- extractor, parser, resolver, and relationship versions.

Snapshot ID plus ExtractedRecord ID alone never establishes Requirement authority or target applicability.

### 8.2 Source Roles

The minimum source roles are:

- `ANNOUNCEMENT_UNIFORM`;
- `POSITION_TABLE_ROW`;
- `REQUIREMENT_ATTACHMENT`;
- `SUPPLEMENT`;
- `CORRECTION`;
- `REPLACEMENT`;
- `DIRECTORY_REFERENCE`;
- `OTHER_OFFICIAL_REQUIREMENT_SURFACE`;
- `UNRESOLVED`.

Source role describes the Requirement-bearing function, not authority level or media type.

### 8.3 Source Relationships

The minimum relationships are `ORIGINAL`, `SUPPLEMENTS`, `CORRECTS`, `REPLACES`, `SUPERSEDES`, `REFERENCES`, `CONFLICTS_WITH`, and `UNRESOLVED`.

A relationship requires Evidence and a target. `UNRESOLVED` blocks completeness when the relationship may change mandatory semantics.

### 8.4 Authoritative Source Manifest

Requirement parsing input includes an authoritative manifest of known Requirement-bearing source references for the target OpportunityVersion.

Completeness requires every required manifest item to be covered, every covered source to have a resolved role or blocker, every binding to be resolved, every correction/replacement affecting the target to be accounted for, and no caller-selected omission of an unfavorable source surface.

Missing required surfaces produce `INCOMPLETE`. Present but semantically or relationally unresolved surfaces produce `REVIEW_REQUIRED`.

## 9. Modality Model

`RequirementModality` has exactly four values: `MANDATORY`, `PREFERRED`, `OPTIONAL`, and `INFORMATIONAL`. Conditionality and prohibition are not modality values.

### 9.1 MANDATORY

- Participates in the mandatory root.
- May produce `NOT_MATCH` only after semantic COMPLETE, capability support, and an affirmatively false exact evaluation.
- Candidate unknown produces `INSUFFICIENT` after those gates.
- Source unknown produces `REVIEW_REQUIRED / NOT_ALLOWED` before evaluation.

Words such as `必须`, `须`, `应当`, `限`, and `不得` are signals, not context-free classifications.

### 9.2 PREFERRED

- Never contributes to MATCH or NOT_MATCH.
- Its absence never makes a Candidate ineligible.
- It does not upgrade a Candidate to MATCH.
- It is preserved for future product layers, but CR#12 creates no Recommendation behavior.

Examples include `优先`, `优先考虑`, `同等条件下优先`, `有相关经验者优先`, and `具有……者优先` only when complete context confirms preference.

### 9.3 OPTIONAL

Optional content never contributes to failure and does not become an alternative mandatory branch unless the source explicitly establishes substitution.

### 9.4 INFORMATIONAL

Informational content is excluded from Eligibility. Duties mentioning legal, compliance, research, or operational work do not create a professional Requirement.

### 9.5 Mixed or Unresolved Modality

Mixed mandatory and non-mandatory content may be decomposed only when every resulting condition has complete span and Evidence coverage. Otherwise it remains `AMBIGUOUS`.

The parser must not choose the least restrictive modality to obtain COMPLETE and must not choose MANDATORY merely because a clause names a qualification.

## 10. Canonical Negation and CR#9 Legacy Compatibility

### 10.1 Canonical CR#12 Negation

CR#12 has exactly one canonical logical negation carrier: the `NOT` node. Canonical CR#12 predicate Facts use positive predicate operators.

```text
MANDATORY CONDITION
└── NOT
    └── PREDICATE(A)
```

Lexical identities such as `非法学` and `法律（非法学）` are protected; `非` inside an evidence-backed identity is not a NOT operator.

### 10.2 Legacy Mapping

Historical CR#9 objects remain immutable and readable. A versioned projector may create one CR#12 condition while preserving all original Fact and Evidence references.

| Legacy representation | Canonical CR#12 projection |
| --- | --- |
| positive polarity + positive operator | direct PREDICATE |
| negative polarity + positive operator | NOT(PREDICATE) |
| `NOT_EQUALS` with positive polarity | NOT(EQUALS predicate) |
| `NONE_OF` with positive polarity | NOT(OR of equality predicates) |
| LogicGroup AND with at least two complete members | one AND group |
| LogicGroup OR with at least two complete members | one OR group |
| one-member legacy group | direct PREDICATE; group retained only as provenance |
| legacy cohort `ANY_OF` | CandidateStateApplicability `COHORT_ANY_OF` |
| legacy cohort `ALL_OF` | CandidateStateApplicability `COHORT_ALL_OF` |
| subject scope `CANDIDATE` | CandidateCredentialApplicability `CANDIDATE_WIDE` |
| `BACHELOR` | `SPECIFIC_DEGREE:BACHELOR` |
| `MASTER` | `SPECIFIC_DEGREE:MASTER` |
| `GRADUATE` | `GRADUATE` |
| `DOCTOR` | `SPECIFIC_DEGREE:DOCTOR` |
| `ANY_EDUCATION` | `ANY_DEGREE` |
| `ALL_EDUCATION` | `ALL_DEGREES` |

### 10.3 Rejected Legacy Combinations

More than one negative carrier is not simplified automatically. Negative polarity plus NOT, `NOT_EQUALS` wrapped in NOT, `NONE_OF` wrapped in NOT, negative polarity plus a negative operator, incomplete legacy parent membership, and simultaneous legacy/new execution remain `AMBIGUOUS`, fail projection, or produce an integrity error as appropriate.

No legacy Fact and its CR#12 projection may be evaluated as two independent conditions. Projection records `projected_from_legacy_fact_ids` and `projected_from_legacy_evidence_ids`, and the execution manifest selects exactly one logic-model version.

## 11. Conditional Selector Contract

### 11.1 Domain Classification

A selector is an independent typed candidate-state predicate. It is not a RequirementFact and cannot directly produce MATCH or NOT_MATCH. It only selects whether a THEN or ELSE Requirement tree applies.

### 11.2 RequirementSelectorPredicate

A selector predicate records selector-predicate ID, owning branch-set ID, authoritative OpportunityVersion ID, approved selector dimension, operator and typed value, CandidateCredentialApplicability, direct cohort/state operands when the selector dimension requires them, RequirementContextBinding IDs, Evidence and locator, parser version, and resolution state. It does not carry `CandidateStateApplicability:STATE_SELECTOR`, because that would recursively select another selector tree.

Approved selector dimensions are limited to dimensions already present in the approved Requirement/Candidate Domain, such as education level, cohort, age, and explicitly scoped work experience. Anything outside the approved Domain is `DOMAIN_GAP_OBSERVED`.

### 11.3 SelectorLogicTree

Selectors use a separate tree and node IDs. Nodes are `SELECTOR_PREDICATE`, `GROUP:AND|OR`, or `NOT`. The selector graph follows the same root, order, parent, cycle, dangling-reference, unary-group, Evidence, and binding invariants as a Requirement tree.

Selector nodes cannot reference RequirementFact IDs, Requirement tree nodes, another condition's predicates, or another branch set.

### 11.4 ConditionalRequirementBranchSet

A branch set records its ID and owning condition, one WHEN selector tree, one THEN Requirement tree, optional one ELSE Requirement tree, condition modality, all applicability/binding layers, Evidence, source order, and parser/resolver versions.

- WHEN false means THEN does not apply; it is not Candidate failure.
- WHEN true evaluates THEN.
- WHEN false evaluates ELSE when present.
- WHEN false with no ELSE means no additional condition only when source semantics prove that default.
- WHEN unknown produces `INSUFFICIENT` only after semantic completeness and capability support.
- An unresolved selector blocks completeness.
- Overlapping branches require explicit precedence or compatible combination.
- Unresolved overlap, precedence, exception scope, or default blocks completeness.
- Nested branch sets are outside CR#12 and become `DOMAIN_GAP_OBSERVED`; they are not flattened.

## 12. Deterministic Parsing and Precedence

### 12.1 Parsing Pipeline

1. Preserve raw text, offsets, source schema, field role, locator, and source order.
2. Identify spreadsheet cell, header, list-item, paragraph, and other structural boundaries.
3. Protect atomic spans.
4. Identify an outer `如果/若/当……则……否则……` skeleton.
5. Identify explicit matched parentheses.
6. Classify connectors only outside protected spans.
7. Build the tree using the precedence below.
8. Attach node-level Evidence to every connector and grouping decision.
9. Verify complete span coverage and graph reachability.
10. Emit a blocker if any required step is unresolved.

The parser must not split first and reconstruct lost structure later.

### 12.2 Binding Strength

```text
explicit parentheses
> scoped NOT
> explicit AND
> explicit OR
> top-level clause combination
```

This applies only when connector tokens and scopes are explicit. Reasonably ambiguous natural-language scope remains `AMBIGUOUS`; the precedence table cannot manufacture certainty.

### 12.3 Parentheses and NOT

Matched parentheses establish grouping after atomic protection. Parentheses inside a complete identity remain part of that identity. Unmatched or ambiguous parentheses block completeness.

`不得`, `不接受`, `排除`, and evidence-backed negation bind only to a proven predicate or group. `除……外` requires complete exception-scope parsing. `非法学`, `非全日制`, and similar atomic identities are not split into logical NOT.

### 12.4 AND and OR Words

Outside protected spans, `且`, `并且`, `同时`, `同时具备`, `同时具有`, and `兼具` normally express AND between independently applicable conditions.

`以及` expresses AND between distinct mandatory conditions, but inside a proven acceptable-value list it normally continues the OR list. Context controls the result.

Outside protected spans, `或`, `任一`, `任一项`, `任选其一`, `之一`, and contextually clear `均可` normally express OR. OR never permits deletion of a branch.

### 12.5 Contextual Punctuation Rules

Within an evidence-backed major candidate-list context already classified under CR#11:

- comma `,` or `，` defaults to OR;
- enumeration comma `、` defaults to OR;
- slash `/` defaults to OR;
- semicolon `;` or `；` may default to OR inside the same proven list field;
- `以及` may continue the OR list;
- every item remains one protected MajorExpression or unresolved list item.

```text
法学、法律、知识产权
=> OR(法学, 法律, 知识产权)

法学/法律/知识产权
=> OR(法学, 法律, 知识产权)
```

The parser must not become so conservative that proven lists are narrowed to AND or discarded.

Outside a proven candidate-list context, comma, enumeration comma, and slash are not automatically Boolean operators. Semicolon is normally a clause boundary. Colon is normally a label/value or branch delimiter. A source schema or explicit grammar may establish another meaning; otherwise uncertain segmentation remains unresolved.

### 12.6 Protected Non-OR Contexts

Punctuation does not create OR inside dates or date ranges, cohorts, position/document/catalog numbers, addresses, administrative regions, units, degree names, complete compound majors, parentheses, quoted expressions, double degrees, joint programs, joint training, organization names, directory labels, or another non-candidate-list field.

```text
2025/06/30                  => one date, not OR
岗位编号 A/B-01             => identifier or unresolved identifier, not OR
宪法学与行政法学             => one protected major identity
法学、经济学双学位           => compound credential candidate, not OR
北京市朝阳区/海淀区工作地点   => location syntax, not professional OR
```

### 12.7 Ambiguous Segmentation

If punctuation could be a list connector, atomic identity content, clause boundary, address/identifier separator, or compound requirement and source schema plus protection rules do not resolve it, the clause is `AMBIGUOUS / REVIEW_REQUIRED`.

No LLM, embedding, fuzzy match, statistical model, or probability threshold may resolve it within CR#12.

## 13. Source Unknown and Candidate Unknown

Source semantic unresolved includes an unresolved connector, branch content or threshold, modality, applicability, binding, relationship, exception/negation scope, or Evidence. Any such issue blocks COMPLETE and produces `REVIEW_REQUIRED` or `INCOMPLETE`; Eligibility remains `NOT_ALLOWED` and no assessment is created.

Candidate evaluation occurs only after source semantics, binding, Evidence, completeness, and capabilities are satisfied.

- AND: FALSE if any child is FALSE; UNKNOWN if none is FALSE and at least one is UNKNOWN; otherwise TRUE.
- OR: TRUE if any child is TRUE; UNKNOWN if none is TRUE and at least one is UNKNOWN; otherwise FALSE.
- NOT: TRUE becomes FALSE, FALSE becomes TRUE, UNKNOWN remains UNKNOWN.
- Candidate UNKNOWN never becomes FALSE.

### 13.1 Source-Unresolved OR Rule

`Candidate evaluation UNKNOWN != source semantic unresolved`.

If every OR branch is source-complete and one Candidate branch evaluates TRUE, OR is TRUE even if another Candidate branch evaluates UNKNOWN.

If any mandatory OR branch has unresolved source semantics, another TRUE-looking branch cannot hide it; the set cannot be COMPLETE; Eligibility is `NOT_ALLOWED`; no MATCH, NOT_MATCH, or INSUFFICIENT assessment is created; and the unresolved branch and Evidence remain preserved.

## 14. Completeness Manifest and Content Hash

### 14.1 Manifest Coverage

The completeness manifest covers exact IDs and content for:

- Requirement conditions;
- mandatory root state and ordered condition IDs;
- Requirement trees, nodes, and leaf-to-Fact references;
- Requirement Facts;
- modality;
- all three applicability/binding layers;
- selector predicates, trees, nodes, and branch sets;
- Opportunity, Position, Batch, Location, and revision targets;
- RequirementSourceReferences, roles, and relationships;
- Evidence Fragments, Requirement Evidence, Observations, and blockers;
- covered Snapshot and ExtractedRecord IDs;
- parser, resolver, projector, relationship, gate, and serialization versions.

It contains exact registries and ordered arrays where order is semantic; counts alone are insufficient.

### 14.2 COMPLETE

Semantic COMPLETE requires complete source coverage; resolved source roles, relationships, and bindings; full span coverage; every mandatory condition exactly once in the root; valid reachable graphs; Evidence-backed connectors, modality, applicability, selector, branch, and binding; resolved corrections/conflicts; same-OpportunityVersion ownership; explicit preservation of non-mandatory clauses; and zero blockers.

Semantic COMPLETE does not override the Engine capability fence.

### 14.3 REVIEW_REQUIRED and INCOMPLETE

Present but unresolved logic, modality, negation, applicability, binding, source role/relationship, selector, branch, conflict, or Domain representation produces REVIEW_REQUIRED.

Missing source surfaces, attachments, cross-references, Snapshots, ExtractedRecords, Evidence, graph members, binding Evidence, or source-span coverage produce INCOMPLETE.

### 14.4 Structural Outcomes

| Condition | Outcome |
| --- | --- |
| zero mandatory conditions with complete coverage and classification | `EMPTY_CONFIRMED`; may be semantically COMPLETE |
| zero mandatory caused by missing/unparsed text | INCOMPLETE or REVIEW_REQUIRED |
| empty tree | invalid; never COMPLETE |
| unary AND/OR | invalid resolved structure; source ambiguity blocks COMPLETE |
| duplicate leaf | invalid; never COMPLETE |
| dangling/cycle/disconnected/cross-condition reference | integrity failure or blocker; never evaluated |
| missing Evidence | INCOMPLETE |
| source conflict | preserved; REVIEW_REQUIRED |
| `A AND NOT A` from conflicting source statements | REVIEW_REQUIRED, not universal Candidate NOT_MATCH |
| binding conflict | preserved; REVIEW_REQUIRED |

### 14.5 Conflict Rule

CR#12 does not choose a source winner by heuristic. Unresolved conflicting mandatory conditions are both preserved with Evidence and a source-conflict diagnostic mapped to a blocking `AMBIGUOUS` Observation until a separately approved source-composition contract defines a more specific blocker. No Candidate is marked NOT_MATCH from that conflict.

### 14.6 Hash and Versioning

The content hash uses a versioned deterministic canonical serializer. Registry keys are deterministic; child arrays, branches, source order, and mandatory-root order remain ordered. Every item in Section 14.1 contributes full semantic content, references, and versions.

Any change to nodes, order, modality, applicability, selectors, bindings, source roles/relationships, Evidence, parser, or resolver changes the hash and creates a new Requirement Set ID/version. Historical sets are not overwritten. Mutation after hashing is rejected before dispatch.

## 15. Compatibility and Non-Destructive History

The execution manifest distinguishes `LEGACY_FLAT_FACT_V1` and `CR12_STRUCTURED_LOGIC_V1`; one manifest selects exactly one model.

- Existing Fact, RequirementSet, completeness, and EligibilityAssessment IDs remain unchanged.
- Legacy polarity, operators, LogicGroups, applicability, and Evidence remain readable.
- A CR#12 projection creates additive IDs and provenance links.
- Unsafe projection remains legacy-only and reviewable.
- A projected legacy Fact may be provenance but cannot be independently evaluated alongside its projection.

## 16. CR#10 Eligibility Engine Capability Fence

### 16.1 Required Capabilities

A CR#12 set declares every capability it uses, including `LOGIC_TREE_V1`, `NOT_V1`, `MODALITY_V1`, `CREDENTIAL_APPLICABILITY_V1`, `CANDIDATE_STATE_APPLICABILITY_V1`, optional `CONDITIONAL_SELECTOR_V1`, `CONTEXT_BINDING_V1`, `SOURCE_REFERENCE_MANIFEST_V1`, and `CONTENT_HASH_MANIFEST_V1`.

### 16.2 Current Engine State

The CR#10 Engine supports only the legacy flat-Fact contract. Therefore:

```text
CR12 Requirement Set + CR10 legacy Engine
=> NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY
```

### 16.3 Non-Bypassable Boundary

Until a separate Engine CR is implemented:

- CR#12 output uses a distinct discriminated and branded `CR12StructuredRequirementSet` contract;
- it does not extend the legacy `CompleteRequirementSet`, omits its executable flat `facts` payload shape, uses a separate structured Fact registry, and is therefore not assignable to or serialized as the legacy contract;
- it does not populate the legacy `complete_requirement_set` dispatch slot;
- its structured Fact registry is not exposed as a legacy executable flat list;
- it may be stored or inspected but cannot be dispatched to CR#10;
- capability mismatch returns an execution-gate decision, not an EligibilityAssessment;
- no adapter may flatten or omit unsupported structures.

This fence belongs to CR#12 domain/parser output, not an Engine behavior change. If it cannot be implemented without changing CR#10 Engine behavior, CR#12 implementation must stop and request a separate Change Request.

### 16.4 Future Engine Change

A future approved CR must add Engine support and runtime validation for every capability while preserving three-valued evaluation, exact binding, hash validation, and non-mandatory exclusion.

## 17. Recall First / No False Exclusion

- Requirement unresolved is not Opportunity invalid.
- Identity unresolved is not Opportunity irrelevant.
- Missing source is not NOT_MATCH.
- Candidate UNKNOWN is not NOT_MATCH.
- Source conflict is not Candidate failure.
- `NOT_ALLOWED` is not product exclusion.
- `INSUFFICIENT` is not NOT_MATCH.
- Incomplete Requirement Sets remain stored and visible for review.
- Binding and capability blockers prevent evaluation, not Opportunity retention.
- Product exclusion may be considered only from a complete, traceable, capability-supported, affirmatively proven NOT_MATCH under a future approved product policy.

CR#12 creates no Recommendation, ranking, hiding, deletion, or application behavior.

## 18. Required Design Controls A–AH

All controls are synthetic and offline. Listing them does not authorize implementation.

| Control | Scenario | Required outcome |
| --- | --- | --- |
| A | `A AND B` | ordered AND; FALSE from either proven false; UNKNOWN preserved |
| B | `A OR B` | ordered OR; TRUE from either true; NOT_MATCH only when both false |
| C | `A AND (B OR C)` | exact nested tree and grouping Evidence |
| D | `NOT A` | one NOT over one positive predicate |
| E | `A AND NOT B` | AND with scoped NOT(B) |
| F | multi-level parentheses | exact hierarchy; unmatched scope blocks |
| G | child order | source order retained and hash-sensitive |
| H | cycle | rejected before completeness/evaluation |
| I | dangling node | rejected or blocking; never COMPLETE |
| J | duplicate leaf | rejected; duplicate Evidence does not duplicate paths |
| K | invalid unary group | blocking; no silent collapse |
| L | cross-condition reference | integrity rejection |
| M | candidate-wide applicability | explicit `CANDIDATE_WIDE`; no credential inference |
| N | credential applicability | all credential modes remain distinct |
| O | cohort applicability | no credential/context leakage; legacy mapping preserved |
| P | Batch applicability | exact Batch and OpportunityVersion; sibling unaffected |
| Q | Location applicability | exact LocationAssignment; other locations unaffected |
| R | Announcement uniform condition | projects only to evidenced OpportunityVersions |
| S | Position-row isolation | one row cannot affect sibling Position |
| T | same URL, multiple Positions | URL does not share Requirement binding |
| U | Correction targeted update | new affected OpportunityVersion; history preserved |
| V | WHEN/THEN/ELSE | separate selector and Requirement trees |
| W | unknown selector | Candidate unknown gives INSUFFICIENT only after all gates |
| X | overlapping branches | explicit precedence required or REVIEW_REQUIRED |
| Y | missing ELSE | no default only when source proves it; otherwise unresolved |
| Z | source-unresolved OR | blocks COMPLETE despite another TRUE-looking branch |
| AA | Candidate UNKNOWN | never false or NOT_MATCH |
| AB | punctuation professional-list context | `，`/`、`/`/eligible `;` produce OR after CR#11 proof |
| AC | punctuation non-professional context | protected contexts do not become OR; uncertainty blocks |
| AD | legacy negative mapping | exactly one carrier maps to canonical NOT with provenance |
| AE | double-negation rejection | multiple carriers are not simplified automatically |
| AF | RequirementSet hash mutation | any semantic/structural/Evidence change invalidates hash |
| AG | Requirement binding mutation | target or binding Evidence change creates new version/hash |
| AH | old Engine capability fence | CR#10 receives no CR#12 set and creates no assessment |

Required regression design also preserves CR#8 completeness, CR#9 history, CR#10 legacy controls, CR#11 identity separation including `法律（0351） != 法律硕士（非法学）`, Recruitment Context version semantics, all architecture/application/network guards, and `NETWORK REQUESTS = 0`.

## 19. Explicitly Forbidden Behavior

CR#12 must not use LLMs, embeddings, fuzzy matching, or probability to infer logic; infer Requirements from title, duties, organization, location, headcount, CandidateProfile, or historical outcomes; treat third-party rewrites as official Facts; redefine CR#11 identity/equivalence; broadcast Announcement conditions by URL; turn unresolved content into unrestricted content; convert UNKNOWN into MATCH/NOT_MATCH; execute incomplete or capability-unsupported sets; delete/hide Opportunities due to uncertainty; or add Recommendation behavior.

## 20. Explicit Non-Goals and Deferred Gaps

CR#12 does not implement CR#11 semantics or nationwide directories, collection/networking, third-party platforms, Recommendation, arbitrary expression languages, nested conditional branch sets, new general eligibility dimensions, generalized authority review, a heuristic source winner, CR#10 structured-logic Engine support, P2/Canary changes, persistence, API, Web, Scheduler, or production writes.

These remain non-blocking because CR#12 preserves them as blockers or capability gaps rather than guessing.

## 21. Approved Implementation Boundary

Implementation was separately approved and completed within this exact file boundary:

- `lib/ingestion/domain/primitives.ts`;
- `lib/ingestion/domain/requirements.ts`;
- `lib/ingestion/requirements/types.ts`;
- `lib/ingestion/requirements/deterministic-requirement-parser.ts`;
- `tests/domain/domain-types.test.ts`;
- `tests/requirements/requirement-parser.test.ts`;
- `tests/requirements/p1-cr12-requirement-logic-modality-applicability.test.ts`;
- `docs/phase-1-requirements.md`;
- this CR document for implementation status only.

Wildcard export files required no change. Any future need to modify Eligibility Engine, Eligibility result semantics, Recruitment Context identities, persistence, application services, P2, or real data requires a separate CR.

## 22. Original Blocking-Issue Closure Matrix

| Original blocking issue | Revised disposition | Section |
| --- | --- | --- |
| 1. Applicability collision/incompleteness | CLOSED — three layers and `CANDIDATE_WIDE` | 6–7 |
| 2. Requirement Context Binding | CLOSED — origin/effective targets, Evidence, certainty, unresolved state | 7 |
| 3. RequirementSourceReference | CLOSED — role, target, binding, relation, locator, Evidence, manifest | 8 |
| 4. CR#9 legacy compatibility | CLOSED — canonical NOT, mapping, provenance, no double evaluation | 10, 15 |
| 5. Selector ownership | CLOSED — independent typed predicate and graph | 11 |
| 6. Deterministic precedence/punctuation | CLOSED — protected spans, contextual OR, unresolved fallback | 12 |
| 7. Source-unresolved OR | CLOSED — separated from Candidate UNKNOWN and blocks COMPLETE | 13 |
| 8. Completeness/hash | CLOSED — full manifest, root, graph cases, conflict, versioned hash | 14 |
| 9. CR#10 capability fence | CLOSED — distinct non-executable contract and gate | 16 |

## 23. Remaining Non-Blocking Issues

1. CR#11 implementation and real MajorExpression parsing.
2. A future source-surface composition resolver for more specific official conflict resolution.
3. A future CR#10 Engine integration for CR#12 capabilities.
4. Nested conditional branch sets.
5. Nationwide directories and cross-directory equivalence.
6. Additional general eligibility dimensions.
7. Recommendation and product-presentation policies.

Until their owning CRs are approved, affected real Requirement Sets remain REVIEW_REQUIRED, INCOMPLETE, or execution-blocked.

## 24. Approval State

`CR#12 = IMPLEMENTED / VERIFIED`

All nine readiness blockers are closed. The approved implementation remains within Section 21, and Controls A–AH are implemented and verified.

`IMPLEMENTED / VERIFIED`

No CR#10 Eligibility Engine expansion or other follow-on implementation is authorized by this status.

## 25. Implementation Verification Record

Verification completed on 2026-09-06 with no network access and no production-data writes.

- CR#12 Controls A–AH: `36/36 PASS`;
- focused Domain, Parser, and CR#12 regression: `65/65 PASS`;
- CR#9 and CR#10 regression: `45/45 PASS`;
- Recruitment Context, CR#10, and P2-LEGAL-08A compatibility regression: `61/61 PASS`;
- P1 full regression: `151/151 PASS`;
- tracked P2 offline/safe regression: `155/155 PASS`;
- Architecture, Application Boundary, and Network Guards: `11/11 PASS`;
- TypeScript: `PASS`;
- `git diff --check`: `PASS`;
- actual network requests: `0`.

CR#11 remains design-only and has no executable implementation suite. Its frozen identity-separation boundary, including `法律（0351） != 法律硕士（非法学）`, remains protected by the CR#9, CR#10, and CR#12 compatibility controls. The CR#10 capability fence remains active: CR#12 structured sets cannot produce an EligibilityAssessment until a separately approved Engine change adds every required capability.
