# P1 Change Request #11 — Broad Law Major Ambiguity and Explicit Non-Law Program Wording

## Status

`BOUNDARY REVIEW OPEN / IMPLEMENTATION PAUSED / NOT IMPLEMENTED`

## Boundary Review Hold

Implementation approval is paused pending the recruitment-major expression boundary review recorded in `docs/p1-cr11-recruitment-major-expression-boundary-review.md`.

The review found that the current single-axis expression classification is not yet sufficient for safe implementation. CR#11 must separate expression form from semantic family, preserve open versus closed sets and explicit connectors, prevent related-major text from being narrowed to an exact major, and define conflict behavior for code/name/catalog evidence before the implementation scope can be re-frozen.

## Objective

Preserve the strict three-state Eligibility boundary for legal-major wording without weakening Requirement Completeness:

- an explicitly supported match may produce `MATCH`;
- an affirmative exclusion may produce `NOT_MATCH`;
- broad `法律` wording that overlaps a candidate's `法律硕士（非法学）` background but does not establish equivalence or exclusion must produce `INSUFFICIENT` after the Requirement Set has independently reached `COMPLETE`.

This CR creates no Recommendation Domain and changes no real Requirement Set or EligibilityAssessment.

## Proven Structural Gaps

### Broad `法律`

The parser already preserves scoped `法律` as normalized program code `LAW`. The deterministic engine currently compares normalized program-code sets directly. A candidate whose program is preserved as `JURIS_MASTER_NON_LAW` can therefore be treated as `NOT_SATISFIED` merely because the two normalized codes are not identical.

That is unsafe. The absence of an exact code match does not prove that broad `法律` excludes `法律硕士（非法学）`.

### Explicit `法律（非法学）`

The Requirement code set currently preserves `法律硕士（非法学）` but has no source-neutral code for the distinct source phrase `法律（非法学）`. Without a directory code, the parser cannot safely create a strongly typed Fact for that exact wording.

The Candidate model already keeps `LAW_MASTER_NON_LAW` and `LAW_NON_LAW` distinct. CR#11 must preserve that distinction while allowing an explicit inclusion relationship to be evaluated without rewriting one program type as the other.

## Required Semantics

1. A scoped Requirement explicitly naming `法律硕士（非法学）` and a candidate with `LAW_MASTER_NON_LAW` may satisfy that major Fact.
2. A scoped Requirement explicitly naming `法律（非法学）` must be preserved as its own normalized Requirement code.
3. The explicit `法律（非法学）` Requirement remains distinct from a candidate's `LAW_MASTER_NON_LAW` identity. It may match only when an approved, traceable inclusion or equivalence relation establishes that relationship.
4. A scoped broad `法律` Requirement compared with `LAW_MASTER_NON_LAW`, without explicit equivalence or exclusion evidence, must evaluate to `UNKNOWN`, producing `NEEDS_REVIEW` and the control projection `INSUFFICIENT`.
5. A broad `法律` Requirement must not produce `MATCH` merely because the candidate carries directory code `0351`.
6. A broad `法律` Requirement must not produce `NOT_MATCH` merely because the candidate uses the more specific `JURIS_MASTER_NON_LAW` code.
7. An explicit bachelor-level `法学` Requirement remains a proven `NOT_MATCH` for a candidate whose bachelor background and bachelor program are non-law.
8. Explicit non-equivalence or exclusion evidence remains capable of producing `NOT_MATCH`.

## Completeness Boundary

CR#11 does not permit an unscoped source clause such as `专业：法律` to become a complete Requirement.

- If the education scope is absent, the Requirement Set remains `REVIEW_REQUIRED` and Eligibility remains `NOT_ALLOWED`; no EligibilityAssessment is created.
- `INSUFFICIENT` is an engine outcome only when the Requirement Set is otherwise `COMPLETE`, including an evidence-backed applicable education scope, while the relationship between scoped broad `LAW` and the candidate's specific program remains unresolved.

This distinction prevents the control case from bypassing P1-CR#8's completeness gate.

## 专业表达语义化与法律专业族边界

### Design Principle

Recruitment-major interpretation must not be a string-equality check, but it also must not become substring classification. In particular, the presence of `法` or `法律` inside a title, job name, qualification name, or program label does not establish membership in a legal-major family.

The minimum semantic layer classifies what the source actually expressed and leaves membership unresolved whenever official evidence does not establish it. It does not maintain a national major catalog and does not infer a candidate identity from the Requirement wording.

### Minimum Source-Neutral Model

The design reuses existing P1 evidence, scope, relationship, and directory structures. It adds only a semantic descriptor for a major expression and an evidence-backed relation used at evaluation time.

1. **RAW** — remains in `RequirementObservation` and `EvidenceFragment` as the exact source text and normalized text. The semantic descriptor references that evidence; it does not replace or silently rewrite it.
2. **Expression type** — a closed source-neutral classification:
   - `EXACT`: a safely identified exact program or discipline name, such as `法律硕士（非法学）`, `民商法学`, or `知识产权`;
   - `LAW`: the broad standalone expression `法律` without a more specific source meaning;
   - `LAW_FAMILY`: an explicitly stated family/category such as `法学类` or `法律类`;
   - `LAW_RELATED`: an open expression such as `法学相关专业`, `法律相关专业`, `法学及相关专业`, or `法学或其他相关专业`;
   - `ANY_MAJOR`: the source explicitly states that the major is unrestricted;
   - `QUALIFICATION_ORIENTED`: the source imposes a legal qualification but does not impose a legal-major requirement;
   - `OTHER_EXPLICIT`: another exact, safely preserved major expression that is not classified as a legal family merely by its spelling;
   - `UNRESOLVED`: the expression cannot be safely classified.
3. **Standard major semantics** — remains separate from CandidateProfile and contains only evidence-backed normalized program codes, exact normalized labels, or versioned external-directory references. Expression type is not itself a candidate program identity.
4. **Education/applicability scope** — continues to use the existing distinct `BACHELOR`, `GRADUATE`, `MASTER`, `DOCTOR`, `ANY_EDUCATION`, and unresolved scope behavior. `GRADUATE` and `MASTER` remain non-interchangeable.
5. **Cross-level relationship** — continues to use evidence-backed undergraduate/graduate relationship modes. No `AND`, `OR`, highest-degree, or either-level relationship is inferred from column adjacency or education level alone.
6. **Candidate relation evidence** — an evaluation relation identifies the Requirement semantic target, the candidate credential/program identity, relation status, source namespace/version, and Evidence IDs. Its only conclusive statuses are `EXPLICIT_INCLUDED` and `EXPLICIT_EXCLUDED`; absence of either is `NOT_ESTABLISHED`.
7. **Outcome boundary** — evaluation produces only proven satisfaction, proven non-satisfaction, or unknown, projected as `MATCH`, `NOT_MATCH`, or `INSUFFICIENT`. Fuzzy wording never upgrades unknown to a match.

### Expression Interpretation Rules

- `法学` is an exact discipline expression when the source uses it exactly; it is not identical to `法律`, `法律硕士（非法学）`, or a family category.
- `法学类` and `法律类` are category expressions. Category membership requires an applicable official/versioned catalog or explicit source list.
- `法律` is a broad expression. It neither includes nor excludes `LAW_MASTER_NON_LAW` without relation evidence.
- `法学相关专业` and `法律相关专业` are open related-major expressions. The word `相关` makes the membership boundary evidence-dependent.
- `民商法学`, `刑法学`, `经济法学`, `宪法学与行政法学`, and other named disciplines are preserved as exact labels or directory references; they are not collapsed into one generic law code.
- `知识产权` and `法律实务` remain distinct exact or directory-backed expressions. They are not automatically assigned to `LAW_FAMILY` by keyword or occupational intuition.
- `专业不限但要求法律职业资格证书` creates an unrestricted major Requirement and a separate professional-qualification Requirement. Candidate bachelor background cannot fail the unrestricted major dimension.
- A `法务`, `合规`, or `风控` job title does not create a legal-major Requirement. Only explicit requirement-bearing source text can do so.

### Direct MATCH

A major condition may directly satisfy only when one of the following is proven:

- the Requirement and applicable candidate credential have the same exact normalized program identity;
- a source-provided, versioned directory proves that the candidate program is a member of the required closed family;
- approved relation evidence explicitly marks the Requirement semantic target and candidate program as included/equivalent;
- the source explicitly states `ANY_MAJOR` for the applicable major dimension.

`法律硕士（非法学）` Requirement plus a candidate whose applicable credential is exactly `LAW_MASTER_NON_LAW` is the primary direct-match control.

### Direct NOT_MATCH

A major condition may produce a non-match only when non-satisfaction is affirmatively proven:

- an exact, scoped Requirement differs from complete candidate data and the source semantics are closed rather than related/open;
- a bachelor-level `法学` Requirement is compared with a confirmed non-law bachelor credential;
- a versioned closed-family catalog proves non-membership;
- approved relation evidence explicitly excludes the candidate program or background.

The absence of a candidate program from an unversioned, incomplete, open, or merely inferred list does not prove a non-match.

### Mandatory INSUFFICIENT

The following relationships remain unknown unless additional approved evidence resolves them:

- `法律` versus `LAW_MASTER_NON_LAW`;
- `法学`, `法学类`, `法律类`, or `法律相关专业` versus `LAW_MASTER_NON_LAW` when no applicable membership/inclusion evidence exists;
- `法律（非法学）` versus `法律硕士（非法学）` when their relation is not explicitly established;
- any `LAW_RELATED` expression versus a candidate program without explicit inclusion or exclusion evidence;
- a named discipline such as `知识产权` versus another program when hierarchy or category membership is not evidenced;
- `0351` versus a typed candidate program when CR#10's explicit equivalence gate has not been satisfied.

If the source also omits education scope or cross-level applicability, the Requirement Set remains `REVIEW_REQUIRED`; Eligibility does not run and no `INSUFFICIENT` assessment is created.

### Control Cases A–F

- **A — explicit positive:** scoped `法律硕士（非法学）` plus the exact candidate program produces `MATCH` when the full Requirement Set is complete and all other conditions pass.
- **B — explicit negative:** `BACHELOR` + `法学` or an explicit non-law-bachelor exclusion produces `NOT_MATCH` for the synthetic non-law bachelor candidate.
- **C — ambiguous law family:** `法学/法律相关专业` with missing scope or applicability remains `REVIEW_REQUIRED / NOT_ALLOWED`; with scope independently established but membership unresolved, it produces `INSUFFICIENT`.
- **D — qualification-oriented:** `ANY_MAJOR` plus a legal-professional-qualification Requirement evaluates major and qualification independently; non-law bachelor background does not fail the major dimension.
- **E — scoped related family:** `硕士研究生及以上，法学相关专业` has an explicit education level but no automatic program-family membership. `LAW_MASTER_NON_LAW` requires traceable inclusion evidence; otherwise the result is `INSUFFICIENT`.
- **F — occupation is not a major:** `法务/合规岗位，专业不限` creates no inferred law-major restriction and cannot produce a bachelor-major non-match.

### Forbidden Heuristics

- No `contains("法")`, prefix, suffix, regular-expression, token-overlap, embedding-similarity, or job-title heuristic may create legal-family membership.
- No `0351` identity may create a typed-program match without approved versioned evidence.
- No CandidateProfile value may rewrite, narrow, or broaden the Requirement expression.
- No successful hire, proposed-hire notice, common practice, or third-party taxonomy may replace the original recruitment Requirement evidence.

## Minimal Implementation Scope

1. Add the closed source-neutral major-expression classification and one explicit Requirement program code for `法律（非法学）`.
2. Reuse `EvidenceFragment`, normalized text, existing education scope, existing cross-level relationship, and versioned directory references rather than duplicating source metadata.
3. Add a minimal versioned candidate-to-Requirement semantic relation that can prove inclusion or exclusion without conflating identities.
4. Parse only exact supported expression forms; preserve open, category, qualification-oriented, and unresolved wording without substring inference.
5. Change deterministic major evaluation so broad, category, or related expressions return `UNKNOWN` when membership is not established.
6. Preserve explicit positive and negative controls without adding a catalog, source-specific rule, or recommendation behavior.

## Exact Implementation File List

- `lib/ingestion/domain/requirements.ts` — add the single source-neutral explicit `LAW_NON_LAW` Requirement code.
- `lib/ingestion/domain/eligibility.ts` — add the minimal versioned semantic inclusion/exclusion evidence relation; do not change CandidateProfile identity fields.
- `lib/ingestion/eligibility/types.ts` — accept the approved semantic relation evidence as explicit evaluation input.
- `lib/ingestion/requirements/deterministic-requirement-parser.ts` — classify exact, broad, family, related, unrestricted, and qualification-oriented expressions without substring inference.
- `lib/ingestion/eligibility/deterministic-eligibility-engine.ts` — implement exact, evidence-backed family, explicit exclusion, and unresolved-expression outcomes without collapsing program identities.
- `tests/eligibility/p1-cr11-broad-law-major-ambiguity.test.ts` — verify positive, negative, insufficient, completeness, and negative-inference controls.
- `docs/p1-change-request-11-broad-law-major-ambiguity.md` — approved scope and audit record.

No other file is authorized by this draft.

## Explicit Exclusions

- No Recommendation Engine, recommendation status, score, ranking, or delivery advice.
- No new CandidateProfile personal fields.
- No new Requirement dimension.
- No embedded national professional catalog.
- No hard-coded `0351` equivalence.
- No source, employer, region, URL, adapter, or file-format dependency.
- No change to completeness blocker codes or the `COMPLETE` input gate.
- No nationality, conduct, physical-fitness, disciplinary-status, prior-dismissal, service-status, or kinship Requirement expansion.
- No P2 parser, source adapter, Admission, Collection, Scheduler, API, Web, database, or production-data change.

## Compatibility

Existing documents remain structurally readable. The intended behavioral change is narrow and deliberate: an otherwise complete, scoped broad-`LAW` case that previously could become `INELIGIBLE` must become `NEEDS_REVIEW` unless affirmative exclusion evidence exists.

Explicit exact-code matches and unrelated-major non-matches remain unchanged. Historical assessments are not rewritten.

## Test Plan

1. `法律硕士（非法学）` Requirement plus `LAW_MASTER_NON_LAW` candidate is satisfied.
2. Exact `法律（非法学）` wording is preserved independently from `法律硕士（非法学）`.
3. Explicit `法律（非法学）` Requirement does not include `LAW_MASTER_NON_LAW` without approved relation evidence.
4. Scoped broad `法律` plus `LAW_MASTER_NON_LAW` is `NEEDS_REVIEW` / `INSUFFICIENT`.
5. Broad `法律` plus unrelated, fully known non-law program remains a proven non-match.
6. Bachelor `法学` plus a non-law bachelor remains a proven non-match even if the candidate has a law master degree.
7. `0351` alone does not prove equivalence.
8. Explicit non-equivalence evidence can prove non-match.
9. Unscoped `专业：法律` remains `REVIEW_REQUIRED` and cannot enter the engine.
10. Non-`COMPLETE` input creates no EligibilityAssessment.
11. No source-specific imports or metadata are introduced.
12. Network requests remain zero.
13. `法学`, `法学类`, `法律类`, and `法律相关专业` remain distinct expressions.
14. `法学相关专业` never matches through token or substring similarity.
15. Named disciplines and `知识产权`/`法律实务` remain exact or directory-backed rather than automatically grouped.
16. `ANY_MAJOR` plus a legal qualification evaluates the qualification independently.
17. `法务`, `合规`, or `风控` job titles never create an implicit major Requirement.

## Approval

Further human approval is required before implementation. This draft records the minimum structural change discovered during P2-LEGAL-08B and does not authorize code changes.
