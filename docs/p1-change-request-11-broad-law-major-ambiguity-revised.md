# P1 Change Request #11 — Recruitment Major Expression Semantics and Law-Family Boundary (Revised)

## Status

`CR#11 IMPLEMENTED / VERIFIED / OPTION A SEMANTIC LAYER ONLY`

## 1. Revision Boundary

This document froze only the recruitment-major expression boundary before approval. The verified Option A implementation is limited to the Section 28 whitelist; it does not modify Eligibility behavior, production data, any P2 Canary, or network sources.

The final design closure chooses **Option A**: CR#11 defines source-neutral major semantics, target-bound MajorMatchRelation, and CR#12 handoff only. It does not extend the CR#10 Eligibility Engine. A later separately approved `CR#10 Engine Integration` is required before a CR#11 semantic projection can create a real EligibilityAssessment.

The revision replaces the earlier single-axis major-expression design with a source-neutral separation of:

1. `MajorIdentity`;
2. `MajorExpression`;
3. `MajorScope`;
4. `MajorDirectory` and `DirectoryVersion`;
5. `MajorMatchRule`;
6. `MajorApplicability`.

CR#11 remains deliberately narrower than the project-wide Requirement boundary. It does not absorb general nested condition logic, preference modeling for every Requirement dimension, nationality, conduct, health, source-surface composition, Recommendation, or nationwide catalog data.

## 2. Objective

The objective is to preserve what a recruiting source actually says about acceptable majors and to evaluate a candidate only through explicit, evidence-backed relationships.

The system must be able to distinguish:

- an exact academic identity;
- a directory-bound code or label;
- a closed list of alternatives;
- an open related or similar-major range;
- an unrestricted major condition;
- an unresolved expression;
- the education credential to which the condition applies;
- the evidence that establishes any candidate-to-target relationship.

The safety rule is:

> Lack of evidence that a candidate is included is not evidence that the candidate is excluded, and lexical or code similarity is not identity equivalence.

## 3. Non-Negotiable Identity Separation

The following source meanings remain independent unless an explicit, versioned, traceable relation establishes otherwise:

- `法律硕士（非法学）`;
- `法律硕士（法学）`;
- `法律（非法学）`;
- `法律（法学）`;
- `法律（0351）`;
- `法律`;
- `法学`;
- `法学类`;
- `法律类`;
- `法律相关` or `法律相关专业`;
- unanchored `相关专业`;
- `相近专业` or `相近学科`;
- `不限专业`.

In particular:

```text
法律（0351） != 法律硕士（非法学）
法律（非法学） != 法律硕士（非法学）
法律 != 法律硕士（非法学）
法学 != 法律
法学类 != 法律类
法律相关专业 != 法律类
相关专业 != a finite inferred whitelist
```

No string containment, token overlap, similar spelling, shared character, directory-code equality, job title, occupational duty, historical hiring result, CandidateProfile value, or third-party taxonomy may create identity equivalence.

## 4. Two-Axis Semantic Separation

The revised model separates expression structure from semantic identity/family. A value on one axis never establishes a value on the other axis.

### 4.1 Expression Form

`MajorExpression.form` classifies how the source expressed the requirement:

- `EXACT_IDENTITY` — one explicit academic program or discipline identity;
- `CANDIDATE_LIST` — multiple candidate major expressions in a list context;
- `CATEGORY` — a class, first-level discipline, discipline category, professional category, or other source-defined category;
- `DIRECTORY_REFERENCE` — a code, name, or category whose interpretation depends on a named directory;
- `RELATED_OPEN_SET` — an open membership range using wording such as `相关`, `相近`, `等`, or `以及其他`;
- `UNRESTRICTED` — the source explicitly states that the major is unrestricted;
- `QUALIFICATION_ORIENTED` — the same requirement scope explicitly states `ANY_MAJOR` and an independent professional-qualification condition; it is a two-dimension source expression, not a legal-major identity and not a qualification-to-major inference;
- `COMPOSITE` — a possible double-degree, joint-program, simultaneous-major, or other compound credential expression;
- `UNRESOLVED` — the expression form cannot be classified safely.

### 4.2 Semantic Identity and Family

The following required labels belong to distinct semantic roles rather than one flat enum.

#### Exact or Source-Preserved Identities

- `LAW_MASTER_NON_LAW` — exact `法律硕士（非法学）`; existing persisted `JURIS_MASTER_NON_LAW` remains readable and must not be silently reinterpreted;
- `LAW_MASTER_LAW` — exact `法律硕士（法学）`;
- `LAW_NON_LAW` — exact `法律（非法学）`, distinct from `LAW_MASTER_NON_LAW`;
- `LAW_PROGRAM_LAW` — exact `法律（法学）`;
- `LAW_0351` — directory-bound `法律（0351）`; it is incomplete as an identity without directory namespace and applicable directory version;
- `LAW_GENERAL` — exact broad source wording `法律` without a narrower source meaning;
- `LAW_STUDIES` — exact `法学`;
- `LAW_STUDIES_FAMILY` — source category `法学类`;
- `LEGAL_PROGRAM_FAMILY` — source category `法律类`;
- `INTELLECTUAL_PROPERTY` — exact `知识产权` when the source uses that identity;
- `NAMED_DISCIPLINE` — exact preserved identity such as `民商法学`, `刑法学`, or another named discipline;
- `OTHER_EXPLICIT` — another exact source-preserved major identity;
- `UNRESOLVED` — identity cannot be established safely.

#### Semantic Family Markers

- `LAW` — a top-level semantic subject marker only; it is not itself a directly matchable candidate identity;
- `LAW_FAMILY` — the source explicitly states a legal category, but membership still requires source or directory evidence;
- `LAW_RELATED` — the source explicitly uses open law-related or similar-major wording;
- `OTHER`;
- `UNRESOLVED`.

#### Non-Identity Scope Markers

- `ANY_MAJOR` records an unrestricted major condition. It is not a candidate academic identity.
- `RELATED_MAJOR` records an unanchored open expression such as `相关专业`. It does not imply `LAW_RELATED` without a source anchor.
- `SIMILAR_MAJOR` records wording such as `相近专业` or `相近学科`. It does not identify a legal family by itself.

The names `LAW`, `LAW_FAMILY`, `LAW_RELATED`, `ANY_MAJOR`, `OTHER_EXPLICIT`, and `UNRESOLVED` therefore remain available without conflating family, expression form, and exact program identity.

## 5. Minimum Source-Neutral Contracts

The following shapes are normative design sketches. They do not authorize implementation or require these exact TypeScript property names if an approved implementation can preserve the same semantics more minimally.

### 5.1 MajorIdentity

`MajorIdentity` records only an evidence-backed target identity:

- identity kind;
- exact normalized label when available;
- original source label through Evidence;
- optional directory reference;
- optional category level;
- Evidence Fragment IDs.

An identity does not contain CandidateProfile data and does not assert that another identity is equivalent.

### 5.2 MajorExpression

`MajorExpression` records:

- one expression ID;
- expression form;
- exact raw and normalized source text through Evidence;
- zero or more source-preserved identities;
- explicit connector when known;
- whether an open tail exists;
- `MajorScope`;
- a reference to CR#12 `CandidateCredentialApplicability` when the source constrains an education credential;
- Evidence Fragment IDs;
- parser version.

For a candidate list, each list item remains a separate identity or unresolved item. The list never collapses into one synthetic identity.

### 5.3 MajorScope

`MajorScope` describes membership closure, not education level:

- `CLOSED` — the source provides one exact identity or a finite set whose boundary is known;
- `OPEN` — the source uses `相关`, `相近`, `等`, `以及其他`, or equivalent wording that leaves membership open;
- `UNRESTRICTED` — the source explicitly imposes no major restriction;
- `UNRESOLVED` — the source boundary cannot be established.

`MajorScope` must not be confused with existing `RequirementSubjectScope`. Education level remains part of `MajorApplicability`.

### 5.4 MajorDirectory and DirectoryVersion

A directory-bound expression preserves:

- directory namespace;
- directory title when provided;
- directory issuing authority when provided;
- directory version or effective period;
- program code;
- adjacent source label;
- category level when stated;
- Evidence Fragment IDs.

Rules:

- Namespace and version are evidence-bearing values, never guessed defaults.
- If the source explicitly invokes a versioned directory but the version cannot be established, the Requirement remains `REVIEW_REQUIRED`.
- A code and adjacent label conflict produces a blocker; neither silently overrides the other.
- Different namespaces or versions do not prove non-membership.
- Directory mismatch defaults to `UNKNOWN / INSUFFICIENT`, not `NOT_MATCH`.
- Same code proves only code identity inside the same namespace and version. It does not prove training-program type identity.
- CR#11 does not introduce a nationwide directory or cross-directory equivalence table.

### 5.5 MajorMatchRelation

`MajorMatchRelation` is the CR#11 target-bound, versioned, Evidence-backed relation contract. It is **not** the legacy CR#9 `MajorMatchRule`, and legacy `EXACT_NAME`, `EXACT_CODE`, or `CATEGORY` values never satisfy it by themselves.

Each relation records:

- a relation ID and relation/resolver version;
- source `MajorExpression` ID and target `MajorIdentity`, category, list item, or directory reference;
- a candidate-major identity target, never a CandidateProfile ID or a reverse inference from CandidateProfile;
- the CR#12 `CandidateCredentialApplicability` ID that selects the applicable credential;
- relation kind, certainty, and resolution state;
- any directory namespace, directory version, code, label, and category level used by the relation;
- non-empty Evidence Fragment IDs, Evidence version, and source locator;
- parser version and unresolved behavior.

Allowed conclusive relation kinds are `EXACT_IDENTITY`, `DIRECTORY_MEMBERSHIP`, `EXPLICIT_INCLUDED`, `EXPLICIT_EXCLUDED`, and `UNRESTRICTED`. Every other relation is `NOT_ESTABLISHED`. `EXPLICIT_EXCLUDED` describes candidate-to-target membership evidence; a source-language exclusion is represented separately and projects to the one CR#12 `NOT` carrier defined in Section 21.

The relation is designed for a future CR#10 Engine Integration but is not consumable by the current CR#10 Engine under Option A. Until that separate integration is approved, it cannot create an EligibilityAssessment.

### 5.6 Applicability Projection

CR#11 does not create an independent `MajorApplicability` domain contract. Every major predicate reuses exactly one CR#12 `CandidateCredentialApplicability`, and never recreates `CandidateStateApplicability` or `RequirementContextBinding`.

Normative mappings are:

- explicit `本科` or `本科专业` maps to `UNDERGRADUATE` or `SPECIFIC_DEGREE:BACHELOR` according to the source wording;
- explicit `硕士` maps to `SPECIFIC_DEGREE:MASTER`;
- explicit `研究生` maps to `GRADUATE` and never silently to `MASTER`;
- explicit `最高学历` maps to `HIGHEST_DEGREE`;
- explicit `任一学历` or `本科或研究生` maps to evidence-backed `EITHER_LEVEL` with its exact degree set;
- explicit unrestricted `专业不限` without a credential selector maps to `CANDIDATE_WIDE` only for the major-unrestricted predicate; it does not select or evaluate a Candidate credential;
- any restricted-major expression without an explicit credential scope maps to `UNRESOLVED` and blocks completeness.

`GRADUATE` and `MASTER` remain distinct. Column adjacency, CandidateProfile data, or a list of bachelor and graduate majors cannot choose, narrow, or repair applicability.

## 6. Default Punctuation and Connector Rules

The earlier blanket statement that commas, enumeration commas, semicolons, or slashes cannot default to OR is withdrawn. The revised rule is contextual.

### 6.1 Default OR in a Major Candidate-List Context

Within an evidence-backed professional-candidate-list context, the following separators normally express alternatives:

- comma `,` or `，`;
- enumeration comma `、`;
- semicolon `;` or `；`;
- slash `/`;
- explicit `或`;
- explicit `任选其一`, `之一`, or `均可`.

Examples:

```text
法学、法律、知识产权
=> 法学 OR 法律 OR 知识产权

法学/法律/知识产权
=> 法学 OR 法律 OR 知识产权
```

This default is permitted only when all of the following are true:

1. the source field, header, or clause establishes that the text is a list of acceptable majors;
2. each separated item can be preserved as one major expression or one unresolved list item;
3. there is no explicit simultaneous, double-degree, joint-program, exclusion, or other compound-credential wording;
4. the separator is not inside one atomic major name, parentheses, directory label, or quoted source expression;
5. no stronger explicit connector contradicts OR.

### 6.2 Structures That Override Default OR

The parser must prefer a compound or unresolved structure when the source contains:

- `同时具备`, `同时具有`, `兼具`, `且`, `并且`, or another explicit AND condition;
- `双学位`, `联合专业`, `联合培养`, or another compound credential;
- a complete compound discipline name, such as `宪法学与行政法学`;
- punctuation inside parentheses or one complete program name;
- a source-specific header or schema that assigns a different meaning to punctuation;
- an exclusion or exception attached to one branch;
- a structure that cannot be segmented without guessing.

When an OR list cannot be distinguished reliably from a compound identity or AND requirement, the result is `UNRESOLVED / AMBIGUOUS`; no candidate list is manufactured.

### 6.3 Semicolon Boundary

A semicolon may be an OR separator inside a clearly identified major list field. Outside that context it remains a clause boundary. It must not connect a major, qualification, age, or experience condition as though they were interchangeable alternatives.

## 7. Open-Range Rules

The following markers preserve an open membership boundary:

- `相关专业`;
- `相近专业`;
- `相近学科`;
- `等`;
- `以及其他`;
- `其他相关专业`;
- `其他相近专业`.

Normative behavior:

- `法学相关专业` is `RELATED_OPEN_SET` anchored to the source term `法学`.
- It must not be rewritten as `法学 OR 法律`.
- No finite whitelist may be inferred from an open expression.
- `法学、法律等` preserves the two named anchors and an open tail; it is not a closed two-item list.
- Unanchored `相关专业` remains open and semantically unresolved; it is not assigned to `LAW_RELATED` merely because the job title is legal.
- `相近专业` and `相近学科` require explicit inclusion or exclusion evidence for a candidate relation.
- Removing `相关专业`, `等相关专业`, `等`, or similar suffixes before semantic classification is prohibited.

An accurately represented open expression can be Requirement-complete when its source role, scope, applicability, Evidence, and open boundary are all established. Candidate membership can still be `NOT_ESTABLISHED`, producing `INSUFFICIENT` after the Requirement Set passes the Completeness Gate.

## 8. Match, Non-Match, and Insufficient Rules

### 8.1 MATCH

The major predicate may be satisfied only when one of the following is proven:

- exact applicable candidate identity equals the exact closed target identity;
- a versioned directory proves membership in the target closed category or set;
- approved versioned evidence explicitly includes or equates the candidate identity with the target;
- the source explicitly imposes `ANY_MAJOR`.

### 8.2 NOT_MATCH

The major predicate may be not satisfied only when:

- the target is closed and applicable;
- CandidateProfile has complete data for the applicable credential scope;
- every required branch or every branch of an OR set is affirmatively not satisfied; and
- either exact identity mismatch, versioned closed-directory non-membership, or explicit exclusion proves the result.

Absence from an open, incomplete, unversioned, differently versioned, or inferred list never proves `NOT_MATCH`.

### 8.3 INSUFFICIENT

`INSUFFICIENT` is valid only after the Requirement Set is independently `COMPLETE`. It applies when the Requirement expression itself is accurately represented, but the Candidate-to-target relation is not established.

Examples include:

- `LAW_GENERAL` versus `LAW_MASTER_NON_LAW`;
- `LAW_NON_LAW` versus `LAW_MASTER_NON_LAW` without explicit relation evidence;
- `LAW_0351` versus typed `LAW_MASTER_NON_LAW` without a versioned relation;
- `LAW_FAMILY` or `LAW_RELATED` without membership evidence;
- directory namespace or version mismatch without explicit non-equivalence evidence.

### 8.4 REVIEW_REQUIRED / NOT_ALLOWED

Eligibility does not run when any mandatory major clause has:

- unresolved expression form;
- missing education scope;
- unresolved cross-level applicability;
- missing required directory namespace or version;
- conflicting code and label;
- unresolved list-versus-composite segmentation;
- missing requirement-bearing source coverage;
- missing Evidence;
- another Completeness blocker.

No `EligibilityAssessment` is created in this state.

## 9. Frozen Law-Family Boundary

The following comparisons are frozen:

| Requirement expression | Candidate `LAW_MASTER_NON_LAW` | Default result after COMPLETE | Reason |
|---|---|---|---|
| exact `法律硕士（非法学）` | exact same applicable identity | `MATCH` | Exact identity |
| exact `法律硕士（法学）` | different typed identity | `NOT_MATCH` when candidate data and scope are complete | Closed identity mismatch |
| exact `法律（非法学）` | distinct identity | `INSUFFICIENT` | No automatic relation to law-master identity |
| `法律（0351）` | same code but typed law-master identity | `INSUFFICIENT` | Code identity does not prove program-type identity |
| broad `法律` | typed law-master identity | `INSUFFICIENT` | Neither inclusion nor exclusion is established |
| exact bachelor `法学` | confirmed non-law bachelor | `NOT_MATCH` | Closed, scoped bachelor mismatch |
| `法学类` or `法律类` | typed law-master identity | `INSUFFICIENT` unless membership is versioned and explicit | Category membership unknown |
| `法律相关专业` | typed law-master identity | `INSUFFICIENT` unless explicitly included or excluded | Open membership boundary |
| `不限专业` | any candidate major | major dimension `MATCH` | Explicitly unrestricted |

If scope, applicability, source coverage, or Evidence is missing, the table does not apply; the set remains `REVIEW_REQUIRED / NOT_ALLOWED`.

## 10. Historical A–F Control Cases

This historical matrix is superseded by the normative A–N plus `QUALIFICATION_ORIENTED` matrix in Section 24. It remains only as design provenance.

All candidate results below assume the synthetic candidate has a non-law bachelor credential and a professional master's credential whose exact program type is `LAW_MASTER_NON_LAW`. They also assume all unrelated Requirement dimensions are satisfied unless stated otherwise.

### A. Exact `法律硕士（非法学）`

- Source: `硕士专业：法律硕士（非法学）`.
- Parsed structure: `EXACT_IDENTITY:LAW_MASTER_NON_LAW`.
- `MajorScope`: `CLOSED`.
- Applicability: `MASTER`.
- Match Rule: exact applicable identity.
- Requirement status: `COMPLETE` if all source surfaces and other clauses are blocker-free.
- Candidate result: `MATCH`.

### B. Exact `法律（非法学）`

- Source: `研究生专业：法律（非法学）`.
- Parsed structure: `EXACT_IDENTITY:LAW_NON_LAW`.
- `MajorScope`: `CLOSED`.
- Applicability: `GRADUATE`.
- Match Rule: exact identity or explicit versioned inclusion/equivalence.
- Requirement status: `COMPLETE` if scope, Evidence, and all other conditions are complete.
- Candidate result without relation evidence: `INSUFFICIENT`.
- Candidate result with approved explicit relation evidence: `MATCH`.

### C. Directory-Bound `法律（0351）`

- Source: `研究生专业：法律（0351）`, with an identified official directory namespace and version.
- Parsed structure: `DIRECTORY_REFERENCE:LAW_0351`.
- `MajorScope`: `CLOSED` only to the extent established by that directory.
- Applicability: `GRADUATE`.
- Match Rule: versioned directory relation bound to the target expression.
- Requirement status: `COMPLETE` only when namespace, version, code, label, scope, and Evidence are established.
- Candidate result from code `0351` alone: `INSUFFICIENT`.
- Candidate result with explicit versioned typed-program inclusion: `MATCH`.
- Missing directory identity or version: `REVIEW_REQUIRED / NOT_ALLOWED`.

### D. Major Candidate List

- Source: `研究生专业：法学、法律、知识产权专业`.
- Parsed structure: closed `CANDIDATE_LIST` containing `LAW_STUDIES OR LAW_GENERAL OR INTELLECTUAL_PROPERTY`.
- `MajorScope`: `CLOSED`.
- Applicability: `GRADUATE`.
- Match Rule: evaluate each target branch; OR is justified by the professional-list context and separator rule.
- Requirement status: `COMPLETE` if list segmentation, scope, Evidence, and other conditions are complete.
- Candidate result for `LAW_MASTER_NON_LAW`: `INSUFFICIENT`, because the broad `LAW_GENERAL` branch is unresolved and cannot be treated as either a match or exclusion.
- A candidate with an exact applicable `INTELLECTUAL_PROPERTY` identity may `MATCH` that branch.

### E. Open `法律相关专业`

- Source: `硕士专业：法律相关专业`.
- Parsed structure: `RELATED_OPEN_SET:LAW_RELATED`.
- `MajorScope`: `OPEN`.
- Applicability: `MASTER`.
- Match Rule: only explicit inclusion or exclusion evidence can decide membership.
- Requirement status: `COMPLETE` when open scope, education scope, Evidence, and all other conditions are accurately represented.
- Candidate result without relation evidence: `INSUFFICIENT`.
- Missing education scope: `REVIEW_REQUIRED / NOT_ALLOWED`.

### F. Double Degree or Simultaneous Majors

- Source: `本科阶段须同时具备法学和会计学双学位`.
- Parsed structure: `COMPOSITE` with an explicit AND signal; it must not be split into an OR candidate list.
- `MajorScope`: `CLOSED` only if the complete compound requirement is represented.
- Applicability: `BACHELOR`.
- Match Rule: requires compound credential semantics that are outside this minimal CR#11.
- Requirement status under CR#11 alone: `REVIEW_REQUIRED` with preserved Evidence.
- Candidate result: `NOT_ALLOWED`; no `MATCH`, `NOT_MATCH`, or `INSUFFICIENT` assessment is created.
- Future resolution belongs to the separate Requirement Logic / Modality / Conditional Applicability change, not to an expansion of CR#11.

## 11. Completeness Invariants

CR#11 does not weaken CR#8:

1. A successfully parsed subset of major Facts cannot establish completeness.
2. Every mandatory major expression must have an Observation disposition.
3. Every created major Fact or semantic expression must retain Evidence.
4. Every required source surface must be covered.
5. Open wording may be complete only when its openness, scope, role, and Evidence are explicit.
6. An unresolved expression, scope, applicability, directory, connector, or composite condition remains blocking.
7. Candidate uncertainty is not used to alter Requirement completeness.
8. `INSUFFICIENT` occurs only after a blocker-free Requirement Set reaches `COMPLETE`.
9. Non-complete sets remain `REVIEW_REQUIRED / NOT_ALLOWED` and create no assessment.

## 12. Explicitly Forbidden Heuristics

- substring checks such as `contains("法")` or `contains("法律")` for family membership;
- prefix, suffix, regular-expression, token-overlap, embedding, or fuzzy-name equivalence;
- same-code typed-program equivalence without directory and relation evidence;
- same-name equivalence across different directory namespaces or versions;
- treating `法学`, `法律`, `法学类`, `法律类`, and `法律相关专业` as synonyms;
- deleting `相关专业`, `相近专业`, `等`, or another open marker before classification;
- treating every punctuation mark outside a proven major-list context as OR;
- treating a job title, duty, organization type, or legal qualification as a major requirement;
- using CandidateProfile to select the most favorable interpretation of source wording;
- using proposed-hire records, historical successful applicants, common practice, or third-party platforms to define Requirement semantics;
- converting missing or differently versioned directory evidence into `NOT_MATCH`;
- constructing an `EligibilityAssessment` from a non-complete Requirement Set.

## 13. Historical Draft Implementation Scope

This historical scope and its conditional file list are superseded by the exact Option A whitelist in Section 28. They remain only as design provenance.

If this revised CR receives separate human approval, implementation must remain limited to the following behavior:

1. add the source-neutral major expression, identity, closure-scope, directory, match-target, and applicability semantics required above;
2. preserve all existing persisted P1/CR#9/CR#10 values without silent reinterpretation;
3. parse only the exact supported identities, contextual candidate lists, open markers, unrestricted wording, and directory references defined here;
4. bind every major matching rule to one target expression and applicable credential scope;
5. return unknown for broad, open, differently versioned, or unestablished relations;
6. preserve compound/double-degree expressions as blocking rather than expanding CR#11 into a general logic engine;
7. retain the existing Complete Requirement Set gate.

The proposed exact implementation file list is:

- `lib/ingestion/domain/requirements.ts`;
- `lib/ingestion/domain/eligibility.ts` only if the approved relation contract cannot reuse CR#10 without change;
- `lib/ingestion/requirements/types.ts` only for source-neutral parser input/output typing required by the new expression contract;
- `lib/ingestion/requirements/deterministic-requirement-parser.ts`;
- `lib/ingestion/eligibility/types.ts` only for the approved target-bound relation input;
- `lib/ingestion/eligibility/deterministic-eligibility-engine.ts`;
- `tests/requirements/p1-cr11-recruitment-major-expression.test.ts`;
- `tests/eligibility/p1-cr11-recruitment-major-expression.test.ts`;
- this document.

No P2, Canary, production, API, Web, Scheduler, Admission, Collection, persistence, database, fixture, or real-data file is included.

If implementation requires any other file or a general condition-tree change, it must pause and request a separate Change Request.

## 14. Required Future Tests

No tests are created by this draft. A separately approved implementation must verify at least:

1. all frozen identities remain distinct;
2. `法律硕士（非法学）` exact positive control;
3. `法律（非法学）` does not automatically equal the law-master identity;
4. `法律（0351）` does not automatically equal the law-master identity;
5. broad `法律` produces unknown rather than automatic match or non-match;
6. `法学类` and `法律类` remain distinct categories;
7. `法律相关专业` remains open;
8. open suffixes are never removed before semantic classification;
9. comma, enumeration comma, semicolon, and slash default to OR only in a proven major-list context;
10. double-degree, simultaneous-major, compound-name, and explicit AND wording override list OR;
11. unresolved segmentation blocks completeness;
12. Match Rules are bound to a concrete target expression;
13. Candidate possession of any name, code, or category cannot satisfy a rule by itself;
14. directory namespace/version mismatch produces unknown, not non-match;
15. code/name conflicts block completeness;
16. missing education scope blocks completeness;
17. an accurately represented open expression may be complete while candidate membership remains insufficient;
18. non-complete Requirement Sets remain `NOT_ALLOWED` and create no assessment;
19. CR#9/CR#10 controls remain unchanged;
20. network requests remain zero.

## 15. Explicit Exclusions

CR#11 does not implement or authorize:

- a general nested Requirement condition tree;
- general `OPTIONAL` or cross-dimension preference semantics;
- double-degree or compound-credential Eligibility evaluation;
- conditional age, work-experience, cohort, or qualification branches;
- nationality, political-condition, conduct, discipline, legal-record, employment-status, military-status, or health dimensions;
- general announcement/attachment source precedence or conflict resolution;
- an employer comparison workflow or qualification-review decision workflow;
- a national professional catalog, alias catalog, or cross-directory mapping;
- probabilistic, fuzzy, AI, or embedding-based matching;
- Recommendation, ranking, scoring, or application advice;
- any P2 or real Canary modification;
- any real CandidateProfile, Requirement Set, or EligibilityAssessment;
- any network access or third-party platform integration.

## 16. Compatibility

- Existing persisted Requirement codes, Candidate program types, Facts, Evidence, and assessments remain readable under their original parser and engine versions.
- Existing `JURIS_MASTER_NON_LAW` values are not silently renamed or rewritten. Any future canonical-label mapping must be explicit, versioned, and backward-readable.
- Re-parsing old Evidence produces a new parser version and a new Requirement Set identity; historical sets are not mutated.
- CR#9's gender, age, cohort, experience, qualification, scope relationship, and directory structures remain intact.
- CR#10's explicit major-equivalence gate remains authoritative and is narrowed only by binding relation evidence to a concrete target expression.

## 17. Final Boundary Answers

### 17.1 Is the revised professional-semantic design ready to enter implementation?

Within CR#11's narrow professional-expression scope, **yes: the semantic boundary was sufficiently specified to request a separate implementation approval**. That approval was granted for the verified Option A whitelist only; it does not approve any excluded Engine, source-surface, real-data, or network work.

### 17.2 Which structural Requirement Domain gaps remain?

The following remain outside CR#11:

- nested Requirement logic and a real condition tree;
- general `MANDATORY / PREFERRED / OPTIONAL / INFORMATIONAL` modality;
- conditional applicability and exception branches;
- general candidate eligibility prerequisites and disqualifiers;
- source-neutral announcement/attachment/reference composition and source conflict semantics;
- authority-review and later official-decision representation;
- complex work-experience, cohort, location, qualification-validity, and health semantics.

### 17.3 Which gaps must be addressed after CR#11?

CR#12 Requirement Logic / Modality / Conditional Applicability is already `IMPLEMENTED / VERIFIED`; it is a consumed dependency, not a future CR#11 deliverable. Before nationwide Requirement expansion, the project must separately address:

1. the CR#10 Engine Integration required to consume CR#11 MajorMatchRelation safely;
2. source-surface coverage and multi-source composition;
3. the minimum repeated general eligibility prerequisites needed to prevent official announcements from remaining permanently `REVIEW_REQUIRED`.

### 17.4 Which gaps may be deferred?

Nationwide professional catalogs, automatic alias and rename catalogs, cross-directory mappings, fuzzy similarity, detailed research-direction taxonomies, employer-specific equivalence tables, Recommendation, and automated authority-review outcomes may be deferred. Their source text and Evidence must remain preserved, and unresolved use must remain blocked or insufficient.

### 17.5 Does a false-COMPLETE parser risk still exist?

**Yes in the current implementation.** Until this revised CR is implemented and tested, the existing parser can narrow open `相关专业` wording and can treat punctuation-separated values too mechanically. Even after CR#11, false-COMPLETE risk remains outside the major domain if requirement-bearing source surfaces are omitted or if general compound clauses are incorrectly classified. The Completeness Gate cannot correct a parser that has already asserted incorrect semantics.

### 17.6 What is the next minimum Change Request after CR#11?

After a separately approved CR#11 semantic-only implementation, the next minimum Change Request is:

`CR#10 Engine Integration for CR#11 MajorMatchRelation`

It may add only the capability to evaluate the frozen target-bound MajorMatchRelation contract and project its proven `MATCH`, `NOT_MATCH`, or `INSUFFICIENT` outcomes. It must not absorb source-surface composition, nationwide catalogs, Recommendation, source collection, or generalized product behavior.

## 18. Approval State

`CR#11 IMPLEMENTED / VERIFIED / OPTION A SEMANTIC LAYER ONLY`

This historical design closure originally required human review and explicit approval. The verified approval applies only to this revised CR#11 Option A whitelist.

## 19. Normative Design Closure

Sections 19–28 are normative and supersede any earlier draft text that conflicts with them, including the historical A–F controls, the conditional implementation file list, and the former statement that CR#12 was a future dependency.

CR#11 now freezes the following expression-semantics classification without flattening its two axes:

- `EXACT` is represented by `EXACT_IDENTITY` plus one source-preserved `MajorIdentity`;
- `LAW` is the exact broad expression `LAW_GENERAL`, not an alias for any law-master or law-program identity;
- `LAW_FAMILY` is a source category such as `法学类` or `法律类`, with those categories still independently preserved;
- `LAW_RELATED` is an open related-major expression such as `法律相关专业`;
- `ANY_MAJOR` is the unrestricted-major scope marker;
- `QUALIFICATION_ORIENTED` is the two-dimension expression form defined in Section 19.1;
- `OTHER_EXPLICIT` is an exact non-law or otherwise source-preserved identity; and
- `UNRESOLVED` is the only result when the source form cannot be classified safely.

These labels never establish a candidate identity, directory membership, cross-level applicability, or Boolean structure merely by lexical similarity.

### 19.1 `QUALIFICATION_ORIENTED`

`QUALIFICATION_ORIENTED` applies only when the same evidenced Requirement scope explicitly establishes both:

1. `Major = ANY_MAJOR`; and
2. an independent professional-qualification Requirement.

For example, `专业不限 + 法律职业资格证书` produces two independent predicates:

```text
Major predicate: UNRESTRICTED / ANY_MAJOR
Qualification predicate: PROFESSIONAL_QUALIFICATION / the exact stated credential
```

It produces no `法学`, `法律`, `LAW_0351`, `LAW_NON_LAW`, or `LAW_MASTER_NON_LAW` MajorIdentity. A legal qualification, job title, duty, organization type, or historical hire can never reverse-infer a major restriction. The unrestricted-major predicate may be satisfied directly, but the qualification predicate remains independently mandatory when the source says so.

## 20. Final Cross-CR Ownership Matrix

| Change Request | Sole ownership in this boundary | Explicitly does not own |
| --- | --- | --- |
| CR#9 | legacy atomic Requirement Facts, basic MajorMatchRule primitives, legacy subject scope, directory reference fields, and non-destructive history | target-bound law-family semantics, structured logic, or CandidateProfile |
| CR#10 | CandidateProfile and the existing flat-Fact deterministic Eligibility Engine | CR#11 semantic parsing, CR#12 structured-set execution, or a default interpretation of legacy MajorMatchRule |
| CR#11 | MajorExpression, MajorIdentity, MajorScope, MajorMatchRelation, law-family boundary, source-versus-candidate resolution, professional-major/qualification separation, and protected major spans | a second logic tree, modality, context resolution, source winner selection, or current Engine integration |
| CR#12 | AND / OR / NOT tree construction, modality, CandidateCredentialApplicability, CandidateStateApplicability, RequirementContextBinding, structured Requirement Set source references, manifest/hash, and execution capability fence | major identity equivalence, law-family membership, or semantic interpretation of a raw major term |

CR#10 must not consume a legacy `MajorMatchRule` as a substitute for a CR#11 MajorMatchRelation. CR#11 must not redefine CR#12 logic, and CR#12 must not reinterpret CR#11 law-major semantics.

## 21. CR#11 / CR#12 Handoff Contract

### 21.1 One Major Predicate, One CR#12 Leaf

CR#11 emits an immutable `Cr11MajorPredicateProjection` for each source-preserved MajorExpression. It contains the MajorExpression semantic payload and references, but it does not create an independent Boolean tree.

CR#12 receives the ordered projections and creates the only Requirement Logic Tree nodes. Each resulting CR#12 predicate leaf retains:

- MajorExpression ID, source semantic type, MajorIdentity/category/directory payload, and MajorScope;
- all source Evidence Fragment IDs and source locator;
- exactly one CR#12 `CandidateCredentialApplicability` ID;
- the applicable CR#12 `RequirementContextBinding` IDs;
- parser, resolver, relation, and projection versions; and
- the canonical semantic payload needed for audit and hashing.

`法学、法律、知识产权` therefore projects as:

```text
OR(Major(法学), Major(法律), Major(知识产权))
```

only after CR#11 proves a professional candidate-list context, protects each atomic item, and emits an `OR` connector observation. `法学、经济学双学位`, a joint program, a complete compound identity, or explicit simultaneous wording is never projected as that OR tree. It is projected as a CR#12 AND/composite structure only when all structure is explicit; otherwise it remains `UNRESOLVED / REVIEW_REQUIRED`.

### 21.2 Contextual Punctuation OR

Within a proven major candidate-list context, `,`, `，`, `、`, and `/` default to `OR`. This is **contextual punctuation OR**, not a rule that every punctuation mark is an operator.

CR#11 protects complete major names, parentheses, dates, identifiers, directory labels, double degrees, joint programs, joint training, hyphenated complete terms, and explicit simultaneous conditions before CR#12 sees connector observations. CR#12 then applies its frozen operator precedence and graph validation. If either layer cannot distinguish a list connector from atomic content or a compound requirement, source semantics are unresolved and the Requirement Set cannot be `COMPLETE`.

### 21.3 Applicability and Context Binding

CR#11 uses the Section 5.6 projection to the existing CR#12 `CandidateCredentialApplicability`; it creates no second applicability registry. It never creates or selects `CandidateStateApplicability`.

Major semantics also never decide where a clause applies. CR#12 `RequirementContextBinding` alone binds a MajorExpression projection to an Announcement, Position, RecruitmentBatch, OpportunityVersion, LocationAssignment, or another already frozen target. A shared URL never broadcasts a major Requirement to sibling Positions. Missing or unresolved binding is a source blocker, not an Opportunity deletion or Candidate failure.

### 21.4 Source-Resolved Versus Candidate-Unresolved

`source-resolved != candidate-matched` is a permanent two-state boundary:

| State | Meaning | Completeness / future evaluation consequence |
| --- | --- | --- |
| `SOURCE_RESOLVED` | The raw text, semantic type, protected span, MajorScope, applicability, context binding, and Evidence are known. | The major clause may participate in a COMPLETE Requirement Set. |
| `SOURCE_UNRESOLVED` | Any required source semantic, connector, scope, directory, binding, or Evidence is unresolved. | `REVIEW_REQUIRED / NOT_ALLOWED`; CR#12 source-unresolved OR rule applies. |
| `CANDIDATE_NOT_YET_EVALUATED` | No future Engine evaluation has occurred. | Not a source blocker and never a match result. |
| `CANDIDATE_RELATION_NOT_ESTABLISHED` | The source semantic is complete, but no allowed candidate-to-target relation is proven. | A future capable Engine returns `INSUFFICIENT`; it never returns `NOT_MATCH` from absence alone. |

For `专业：法律`, CR#11 may record `SOURCE_RESOLVED`, `LAW_GENERAL`, and a closed source label when the credential scope, binding, and Evidence are explicit. The candidate relation to `LAW_MASTER_NON_LAW` remains `CANDIDATE_RELATION_NOT_ESTABLISHED`. It is neither `MATCH` nor `NOT_MATCH`.

### 21.5 Manifest and Content-Hash Handoff

The CR#11 semantic payload is carried by the CR#12 leaf Fact/projection in the existing structured Fact registry. The CR#12 content hash already covers that registry; the projection must canonically include and expose:

- MajorExpression ID and raw/normalized semantic payload;
- semantic type, MajorIdentity/category/open-scope state, and MajorScope;
- MajorMatchRelation IDs and relation states;
- target identity, directory namespace, directory version, code, and label when used;
- CandidateCredentialApplicability and RequirementContextBinding IDs;
- Evidence Fragment IDs, source locator, parser version, resolver version, and projection version; and
- the CR#12 OR/AND/NOT node reference when one exists.

Any mutation to one of those fields creates a new MajorExpression projection, a new structured Requirement version, and a new CR#12 content hash. No CR#11 implementation may add a second manifest, omit a semantic payload from the hashed leaf, or mutate a historical set.

## 22. Exclusion, Evidence, and Open-Range Safety

### 22.1 One Negation Carrier

CR#11 records a source-language exclusion as a positive `SourceExclusionObservation` with its exact target MajorExpression and Evidence. It does not invert a predicate, set a negative polarity, or create a second NOT carrier.

CR#12 alone projects that observation to `NOT(MajorPredicate)`. A distinct MajorMatchRelation with `EXPLICIT_EXCLUDED` means that Evidence proves a candidate identity is outside an already positive target boundary; it evaluates that leaf as false in a future Engine. It is not also wrapped in CR#12 `NOT`. This is the only permitted projection rule and prevents double negation.

### 22.2 Evidence Gate

Without traceable Evidence, no MajorMatchRelation can produce `MATCH` or `NOT_MATCH`. Missing directory evidence, unknown directory version, unconfirmed namespace, source relationship absence, and an unsupported legacy rule cannot manufacture a deterministic non-match.

### 22.3 Broad and Open Terms

`法律`, `法学`, `法学类`, `法律类`, and `法律相关` never narrow automatically to `LAW_NON_LAW`, `LAW_0351`, `LAW_MASTER_NON_LAW`, or a finite directory set.

- `法律` is a source-resolved broad exact label whose candidate relation can remain not established.
- `法学` is a source-resolved exact discipline identity, not an alias for another legal identity.
- `法学类` and `法律类` are source-resolved categories, but their membership boundary is `UNRESOLVED` unless an evidenced source list or versioned directory closes it.
- `法律相关` is source-resolved with an intentionally `OPEN` boundary; its candidate membership needs explicit inclusion or exclusion Evidence.

When a category boundary is unresolved, the Requirement Set is `REVIEW_REQUIRED / NOT_ALLOWED`. When a broad or open expression is accurately represented with a complete scope and binding but the candidate relationship is not established, a future capable Engine returns `INSUFFICIENT`.

### 22.4 Legacy Mapping

Historical CR#9/CR#10 Facts remain immutable and readable. A legacy `EXACT_NAME`, `EXACT_CODE`, `CATEGORY`, `CODE_SET`, or directory reference may create a `LegacyMajorRuleObservation`, but it cannot create a conclusive CR#11 MajorMatchRelation without an explicit target, applicable CR#12 credential reference, versioned Evidence, and a resolver version.

If that projection cannot meet the new contract, it remains `NOT_ESTABLISHED`; a future execution path returns `INSUFFICIENT`, and the current path is `NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY`. It never becomes `NOT_MATCH` merely because a legacy field exists.

## 23. MajorMatchRelation and Candidate Credential Completeness

### 23.1 MajorMatchRelation Contract

`MajorMatchRelation` is source-neutral and never contains a real CandidateProfile. It records a reusable semantic relation between a source target and a candidate-side identity descriptor that a future Engine may bind to one Candidate credential.

Required fields are:

- `major_match_relation_id`, `source_major_expression_id`, target semantic type, target MajorIdentity/category/directory reference, and target scope;
- candidate-side major identity descriptor and the referenced CR#12 `candidate_credential_applicability_id`;
- relation kind: `EXACT_IDENTITY`, `DIRECTORY_MEMBERSHIP`, `EXPLICIT_INCLUDED`, `EXPLICIT_EXCLUDED`, `UNRESTRICTED`, or `NOT_ESTABLISHED`;
- directory namespace, directory version, code, label, and category level whenever the relation uses a directory;
- non-empty source Evidence Fragment IDs, locator, Evidence version, parser version, resolver version, certainty, and resolution state; and
- an explicit future-engine capability label: `CR10_MAJOR_MATCH_RELATION_V1`.

It forbids string similarity, unversioned directory inference, title/duty/organization inference, CandidateProfile-to-source reverse inference, and third-party taxonomy interpretation.

### 23.2 Candidate Credential Completeness

Candidate credential completeness is a future Engine input classification; CR#11 does not modify CandidateProfile to implement it.

| State | Required facts | Outcome boundary |
| --- | --- | --- |
| `COMPLETE` | credential level; applicable major identity; major code when the relation requires it; matching directory namespace/version when the relation requires it; and candidate-side provenance sufficient for the future Engine to evaluate the relation | May participate in a deterministic `MATCH` or `NOT_MATCH`, but only with a closed target or explicit inclusion/exclusion Evidence. |
| `PARTIAL` | some education/major information exists, but a relation-critical identity, code, namespace, version, or provenance is missing | Never `NOT_MATCH`; a COMPLETE Requirement Set yields future `INSUFFICIENT`. |
| `UNKNOWN` | no usable candidate credential exists for the applicable scope | Never `NOT_MATCH`; a COMPLETE Requirement Set yields future `INSUFFICIENT`. |

Candidate completeness cannot repair source completeness. A missing source directory version remains a `REVIEW_REQUIRED / NOT_ALLOWED` Requirement problem; an otherwise complete source with a missing candidate directory version is a candidate `PARTIAL` problem and remains `INSUFFICIENT` in a future capable Engine.

### 23.3 CR#10 Engine Boundary — Option A

CR#11 does not modify `CandidateProfile`, `lib/ingestion/domain/eligibility.ts`, `lib/ingestion/eligibility/types.ts`, or `lib/ingestion/eligibility/deterministic-eligibility-engine.ts`.

The current CR#10 Engine cannot consume `CR10_MAJOR_MATCH_RELATION_V1`, CR#11 semantic payloads, or a CR#12 structured Requirement Set. Every CR#11 semantic projection therefore remains `NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY` for actual execution, even if its source semantics are complete.

The future `CR#10 Engine Integration for CR#11 MajorMatchRelation` must separately approve the input shape, deterministic evaluator, CandidateProfile/provenance treatment, result projection, legacy compatibility, and tests. It must not bypass the CR#12 capability fence or create an EligibilityAssessment before every required capability is supported.

## 24. Normative A–N and `QUALIFICATION_ORIENTED` Controls

All controls use the synthetic candidate `BACHELOR:NON_LAW` plus `MASTER:PROFESSIONAL:LAW_MASTER_NON_LAW`. Unless a row says otherwise, all non-major Requirements are satisfied. `Current execution` is always `NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY` under Option A; `future result` applies only after a separately approved capable Engine and a blocker-free Requirement Set.

| Control | Source semantic and CR#12 projection | Applicability, completeness, and Evidence | Future result for the synthetic candidate |
| --- | --- | --- | --- |
| A — `法律硕士（非法学）` | `EXACT:LAW_MASTER_NON_LAW` leaf | `MASTER`; closed and COMPLETE only with source/binding/Evidence | `MATCH` is allowed by exact identity; `NOT_MATCH` and `INSUFFICIENT` are not used for this complete exact relation. |
| B — `法律（非法学）` | `EXACT:LAW_NON_LAW` leaf | Explicit `MASTER` or `GRADUATE`; closed with Evidence | `INSUFFICIENT` without a target-bound relation; `MATCH` only with versioned explicit inclusion; `NOT_MATCH` only with explicit exclusion or proven closed non-membership. |
| C — `法律（0351）` | `DIRECTORY_REFERENCE:LAW_0351` leaf | Applicable credential plus official namespace, version, code, label, and Evidence are required for COMPLETE | Code `0351` alone is `INSUFFICIENT`; `MATCH` only through versioned directory membership/inclusion; `NOT_MATCH` only through versioned closed non-membership or explicit exclusion. |
| D — `法律` | `LAW:LAW_GENERAL` leaf, source-resolved rather than candidate-resolved | Explicit credential scope, binding, and Evidence make the source clause COMPLETE | `INSUFFICIENT`; neither `MATCH` nor `NOT_MATCH` is allowed without a permitted relation. Missing scope instead yields `REVIEW_REQUIRED / NOT_ALLOWED`. |
| E — `法学` | `EXACT:LAW_STUDIES` leaf | Explicit source credential scope and Evidence required | At `MASTER` scope, `INSUFFICIENT` for the synthetic law-master candidate without relation Evidence. At explicit `BACHELOR` scope, confirmed `NON_LAW` bachelor permits `NOT_MATCH`. Missing scope yields review. |
| F — `法学类` | `LAW_FAMILY:LAW_STUDIES_FAMILY` category leaf | Source category is resolved; its membership boundary is COMPLETE only with an evidenced list or versioned directory | Missing category boundary is `REVIEW_REQUIRED / NOT_ALLOWED`; a closed boundary with no candidate relation is `INSUFFICIENT`; `MATCH`/`NOT_MATCH` require membership/non-membership Evidence. |
| G — `法律类` | `LAW_FAMILY:LEGAL_PROGRAM_FAMILY` category leaf | Same boundary, scope, binding, and Evidence requirements as F, while remaining distinct from F | Same results as F; category-name similarity never supplies membership. |
| H — `法律相关` | `LAW_RELATED` open leaf | `OPEN` scope can be COMPLETE when its openness, credential scope, binding, and Evidence are explicit | `INSUFFICIENT` without inclusion/exclusion Evidence; `MATCH` only on explicit inclusion; `NOT_MATCH` only on explicit exclusion. |
| I — `法学、法律、知识产权` | Three protected leaves projected by CR#12 as ordered `OR` | Proven major-list context, explicit scope/binding, and Evidence for every leaf and connector are required | `INSUFFICIENT`: no branch is proven true and the `法律` relation is not established. A true exact/included branch may `MATCH`; `NOT_MATCH` requires every closed branch false and no open/unknown branch. |
| J — `专业不限` | `UNRESTRICTED / ANY_MAJOR` leaf | `CANDIDATE_WIDE` only when source does not select a credential; source/binding/Evidence required | Major predicate `MATCH`; no candidate major can produce major `NOT_MATCH`. Other Requirements remain independent. |
| K — explicit exclusion | `SourceExclusionObservation` projects once to CR#12 `NOT(MajorPredicate)` | Exact excluded target, scope, binding, and Evidence required; candidate credential must be `COMPLETE` | `NOT_MATCH` for the explicitly excluded synthetic identity. No CR#11 pre-inversion and no second NOT are allowed. |
| L — directory explicitly includes | Closed target with `DIRECTORY_MEMBERSHIP` or `EXPLICIT_INCLUDED` relation | Official namespace, version, target/candidate identity, relation Evidence, scope, and binding required | `MATCH` is allowed; `NOT_MATCH` is not allowed from a separate missing relation. |
| M — directory version unknown | `DIRECTORY_REFERENCE` with unknown required version | Requirement-side directory identity/version is unresolved | `REVIEW_REQUIRED / NOT_ALLOWED`; `MATCH`, `NOT_MATCH`, and `INSUFFICIENT` are all disallowed because source completeness fails. |
| N — namespace/version unconfirmed | Requirement-side directory is complete, but candidate-side namespace/version is absent or incompatible | Candidate credential is `PARTIAL`; Requirement source, scope, binding, and Evidence remain COMPLETE | `INSUFFICIENT`; same code does not establish `MATCH` or `NOT_MATCH`. If the Requirement-side namespace/version is also unknown, use M instead. |

### Q — `QUALIFICATION_ORIENTED`: `ANY_MAJOR + 法律职业资格`

The source creates one `UNRESTRICTED / ANY_MAJOR` Major leaf and one independent `PROFESSIONAL_QUALIFICATION` leaf. CR#12 supplies their mandatory AND structure when the source says both are mandatory. Major is allowed to `MATCH` directly; qualification has its own Evidence, applicability, and future outcome. A non-law bachelor never fails the unrestricted major leaf, and a legal qualification never creates a hidden legal-major leaf.

## 25. Required Future Tests and Compatibility Gates

An approved Option A implementation must add offline synthetic controls for all A–N and Q above, plus:

1. comma, enumeration comma, and slash OR only in proven major-list context;
2. protected double-degree, joint-program, compound-name, date, identifier, and directory-label punctuation;
3. CR#11 projection to an ordered CR#12 OR leaf sequence without a second logic tree;
4. source-resolved/candidate-unresolved distinction, including a `法律` leaf that becomes future `INSUFFICIENT` rather than a source blocker;
5. source-unresolved OR blocking when connector, scope, binding, Evidence, or a required directory version is unresolved;
6. exactly one CR#12 NOT projection for a source exclusion and rejection of double-negation carriers;
7. all semantic payload fields changing the projected CR#12 content hash;
8. legacy `EXACT_NAME`/`EXACT_CODE`/`CATEGORY` inputs never producing conclusive CR#11 outcomes without a target-bound relation;
9. `PARTIAL` and `UNKNOWN` Candidate credentials never producing `NOT_MATCH`; and
10. current CR#10 Engine execution remaining blocked with no EligibilityAssessment, no network request, and no real data.

CR#9 and CR#10 legacy tests remain unchanged. CR#12 controls, the Recruitment Context boundary, Architecture Guard, Application Boundary Guard, Network Guard, TypeScript, and `git diff --check` remain mandatory regression gates for a future implementation approval.

## 26. Final Evidence, Manifest, and Legacy Gate

No source MajorExpression, MajorMatchRelation, source exclusion, directory membership, category boundary, or Candidate relation may become conclusive without the Evidence defined in Sections 21–23. Requirement completeness is source-side only; Candidate `PARTIAL` and `UNKNOWN` cannot turn it into source failure, and source failure cannot become Candidate `NOT_MATCH`.

CR#11 does not create a Requirement Set, CandidateProfile, EligibilityAssessment, Recommendation, or product-exclusion decision. It preserves an auditable semantic projection for CR#12 and the future CR#10 Engine Integration only.

## 27. Final Design Gate

The following are now frozen at the document level:

1. `QUALIFICATION_ORIENTED` and professional-major/qualification separation;
2. source-resolved versus candidate-unresolved states;
3. target-bound, versioned, Evidence-backed MajorMatchRelation;
4. Candidate credential `COMPLETE` / `PARTIAL` / `UNKNOWN` states;
5. CR#11 to CR#12 leaf, logic, applicability, context-binding, Evidence, manifest/hash, and NOT handoff;
6. A–N plus Q controls;
7. explicit Option A CR#10 Engine boundary; and
8. non-destructive legacy behavior.

These design conditions are sufficient to request implementation approval for the narrow Option A whitelist below. They do not authorize source-surface composition, real Eligibility execution, CR#10 Engine integration, nationwide directories, Recommendation, or real-data work.

## 28. Future Implementation Whitelist

If and only if separate human implementation approval is granted for CR#11 Option A, the allowed file boundary is exactly:

| File | Allowed purpose |
| --- | --- |
| `docs/p1-change-request-11-broad-law-major-ambiguity-revised.md` | implementation status and verification record only |
| `docs/phase-1-requirements.md` | additive public contract summary only |
| `lib/ingestion/domain/primitives.ts` | additive CR#11 semantic IDs only |
| `lib/ingestion/domain/requirements.ts` | MajorExpression, MajorMatchRelation, semantic payload, and immutable source-neutral Fact-value contracts only |
| `lib/ingestion/requirements/types.ts` | CR#11 parser/projection input and output typing only |
| `lib/ingestion/requirements/deterministic-requirement-parser.ts` | CR#11 semantic classification, protected-span handling, connector observations, and CR#12 leaf projection only; no CR#12 logic rewrite |
| `tests/domain/domain-types.test.ts` | additive CR#11 contract controls only |
| `tests/requirements/requirement-parser.test.ts` | additive legacy compatibility controls only |
| `tests/requirements/p1-cr11-recruitment-major-expression.test.ts` | new synthetic A–N, Q, handoff, hash, Evidence, and capability-fence controls |

The following are explicitly forbidden in CR#11 Option A: `lib/ingestion/domain/eligibility.ts`, `lib/ingestion/eligibility/types.ts`, `lib/ingestion/eligibility/deterministic-eligibility-engine.ts`, every existing CR#12 logic-tree algorithm, manifest/hash algorithm, capability-fence implementation, and CR#12 test file, CandidateProfile, P2, Canary, API, Web, Scheduler, persistence, production schema, real data, network clients, third-party integration, and Recommendation. The shared files listed above may receive only their stated additive CR#11 semantic changes; they may not alter CR#12 behavior. Any need to touch a forbidden file stops implementation and requires a separate Change Request.

## Implementation Record

Option A implementation is verified. It is limited to the Section 28 whitelist: source-neutral major semantic contracts, deterministic protected-span classification, target-bound relation contracts, and CR#12 leaf-token handoff. The CR#10 Engine remains unchanged and every CR#11 projection remains `NOT_ALLOWED / BLOCKED_UNSUPPORTED_ENGINE_CAPABILITY` for execution until a separate CR#10 Engine Integration is approved and verified.

Verification passed for the synthetic A–N and Q controls, protected punctuation, source-unresolved OR blocking, one-NOT source exclusion projection, hash-visible semantic payload, legacy flat-Fact compatibility, CR#9/CR#10/CR#12 and Recruitment Context regressions, the P1 suite, the tracked P2 suites, TypeScript, Architecture Guard, Application Boundary Guard, Network Guard, and `git diff --check`. No network request, production data change, CandidateProfile change, EligibilityAssessment creation, or CR#10 Engine change occurred.
