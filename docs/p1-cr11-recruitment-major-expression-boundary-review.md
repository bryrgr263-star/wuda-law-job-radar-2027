# P1-CR#11 / Recruitment Major Expression Boundary Review

## Status

`REVIEW COMPLETE / CR#11 REVISION REQUIRED / IMPLEMENTATION PAUSED`

## Review Boundary

This review is offline and design-only. It evaluates P1-CR#9, P1-CR#10, the current CR#11 draft, the existing Requirement Domain, deterministic Requirement Parser, and deterministic Eligibility Engine.

No code, test, production data, Requirement, CandidateProfile, EligibilityAssessment, network source, or external professional catalog is created or modified by this review.

## Safety Objective

The system must preserve what the recruiting source actually requires, not merely identify jobs that explicitly name `法律硕士（非法学）`. It should recognize exact programs, categories, open related-major expressions, directory references, education scope, and logical relationships while preferring unresolved outcomes over unsupported inference.

The governing rule is:

> A missing proof of membership is not proof of non-membership, and lexical similarity is not professional equivalence.

## Current Coverage

### Evidence and Requirement Structure

- Exact original and normalized source text are preserved through `RequirementObservation`, `RequirementEvidenceFragment`, and `RequirementEvidence`.
- Requirement Facts preserve education scope independently as `BACHELOR`, `MASTER`, `GRADUATE`, `DOCTOR`, `ANY_EDUCATION`, or `ALL_EDUCATION`.
- Explicit cross-level relationships exist for `AND`, `OR`, `HIGHEST_DEGREE_ONLY`, `GRADUATE_ONLY`, `UNDERGRADUATE_ONLY`, and `EITHER_LEVEL`.
- Program directory references preserve namespace, optional version, code, label, category, and optional program type.
- Major match rules already distinguish exact code, exact name, category, code set, exception list, and external directory reference.
- Completeness blockers prevent unsupported, ambiguous, missing, or unparsed mandatory content from entering Eligibility.

### Existing Legal Program Identities

The current normalized Requirement code set contains `LAW_STUDIES`, `LAW`, `JURIS_MASTER`, `JURIS_MASTER_NON_LAW`, `INTELLECTUAL_PROPERTY`, and `ANY_MAJOR`.

The current parser safely distinguishes:

- `法学` → `LAW_STUDIES`;
- `法律` → `LAW`;
- `法律硕士` / `法硕` → `JURIS_MASTER`;
- `法律硕士（非法学）` / `法硕（非法学）` → `JURIS_MASTER_NON_LAW`;
- `知识产权` → `INTELLECTUAL_PROPERTY`;
- a code plus label when an evidence-backed external directory namespace is supplied.

### Candidate and Eligibility Boundary

- Candidate program name, normalized program codes, directory references, degree type, program type, academic background, and education level remain separate.
- `LAW_MASTER_NON_LAW` and `LAW_NON_LAW` are distinct Candidate program types.
- Directory code identity does not prove typed-program equivalence; CR#10 requires versioned explicit equivalence evidence.
- A blocker-free `COMPLETE` Requirement Set is mandatory before Eligibility can execute.

## Critical Current Risks

### Related-Major Narrowing

The current parser removes terminal `相关专业` and `等相关专业` before semantic parsing. This can turn `法学相关专业` into exact `法学`, losing the open-set meaning and potentially producing an incorrect match or non-match.

This is a CR#11 must-fix safety issue.

### Comma and Connector Assumption

The current parser treats multiple parsed major values as `OR` after splitting commas, enumeration punctuation, slash, or `或`. A comma-delimited source list is not always proven to be OR, and `且`, `并且`, `同时`, exclusions, parentheses, and open-ended `等` are not represented by that rule.

Connector semantics must follow explicit source evidence. Unknown connectors must block completion or remain an unresolved relationship.

### Expression Form and Semantic Family Are Conflated

The current CR#11 draft uses values such as `EXACT`, `LAW`, `LAW_FAMILY`, and `LAW_RELATED` in one classification. These are two different axes:

- **expression form** describes exact, closed set, category, open related set, directory reference, unrestricted, qualification-oriented, authority-reviewed, or unresolved wording;
- **semantic family** describes the subject identity or family asserted by the source, such as law studies, professional law, legal practice, intellectual property, another named discipline, or unresolved.

Keeping these axes separate prevents a category label from being mistaken for an exact program and prevents `LAW` from becoming a universal legal-major membership rule.

### Incomplete Exact Identity Coverage

The current domain does not independently preserve all reviewed identities, including `法律硕士（法学）`, `法律（非法学）`, and `法律（法学）` when no external directory code accompanies the name.

These identities must not be collapsed into `法律硕士`, `法律`, or each other.

### Directory and Label Conflicts

The current structure can preserve namespace/version/code/label, but the parser does not define a blocker when a code and its adjacent name conflict or when source materials reference different directory namespaces or versions.

Code/name conflict, missing directory identity, and cross-version mismatch require explicit conflict or review behavior.

## Required Two-Axis Semantic Model

### Expression Form

CR#11 should replace the single mixed classification with a source-neutral expression-form axis:

- `EXACT_IDENTITY` — one explicit program or discipline identity;
- `CLOSED_SET` — an explicit finite list whose connector is known;
- `CATEGORY` — a source-defined or directory-defined class, first-level discipline, discipline category, or professional category;
- `RELATED_OPEN_SET` — `相关`, `相近`, `等`, or another open membership boundary;
- `DIRECTORY_REFERENCE` — code/name/category interpreted only inside a named directory namespace and version;
- `ANY_MAJOR` — the source explicitly imposes no major restriction;
- `QUALIFICATION_ORIENTED` — a qualification is mandatory but no major restriction is stated;
- `DIRECTIONAL` — professional direction or research direction is required in addition to or instead of the base major;
- `AUTHORITY_REVIEW` — membership is expressly delegated to qualification review or another official decision surface;
- `UNRESOLVED` — expression structure cannot be classified safely.

### Semantic Family

A separate family/identity axis should preserve only what evidence supports:

- `LAW_STUDIES` — exact `法学`, not a synonym for all legal programs;
- `LAW` — exact broad `法律`, with unresolved membership boundaries unless a directory or explicit list defines them;
- `LAW_FAMILY` — explicit `法学类` or `法律类`, without an embedded membership list;
- `LAW_RELATED` — explicit law-related or similar-major wording, always open until evidence closes it;
- `JURIS_MASTER`;
- `JURIS_MASTER_LAW`;
- `JURIS_MASTER_NON_LAW`;
- `LAW_PROGRAM_LAW`;
- `LAW_PROGRAM_NON_LAW`;
- `LEGAL_PRACTICE`;
- `INTELLECTUAL_PROPERTY`;
- `NAMED_DISCIPLINE` — exact preserved name such as `民商法学` or another source term;
- `OTHER`;
- `UNRESOLVED`.

This is not a national catalog. The family value records source semantics; membership remains evidence-dependent.

## Recruitment Major Expression Classification Matrix

Legend: `Direct` means the major predicate can be decided without an additional membership inference. `RR` means `REVIEW_REQUIRED / NOT_ALLOWED` before Eligibility. `INS` means a complete Requirement can enter Eligibility but this candidate-major relationship remains insufficient.

| Raw expression type | Standard semantic type | LAW classification | Direct MATCH | INSufficient when | REVIEW_REQUIRED when | NOT_MATCH when | Required Evidence | External directory | Version | Scope | Logic |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 法律硕士（非法学） | `EXACT_IDENTITY:JURIS_MASTER_NON_LAW` | exact professional-law identity | Same applicable candidate identity | Candidate identity or applicability is incomplete | Scope or mandatory source coverage is missing | Applicable complete candidate has a different closed exact identity, or explicit exclusion exists | Raw text, locator, scope; directory only if source invokes one | No by default | If directory used | Required | Single |
| 法律硕士（法学） | `EXACT_IDENTITY:JURIS_MASTER_LAW` | exact professional-law identity | Same applicable candidate identity | Candidate only proves another program type | Scope missing | Complete candidate identity is different and source is closed | Raw text, locator, scope | No by default | If used | Required | Single |
| 法律（非法学） | `EXACT_IDENTITY:LAW_PROGRAM_NON_LAW` | exact program identity, distinct from law-master identity | Same identity or approved inclusion relation | Compared with `JURIS_MASTER_NON_LAW` without relation evidence | Scope missing | Explicit exclusion or closed different identity proven | Raw text plus relation evidence if compared across identities | Optional | Required if used | Required | Single |
| 法律（法学） | `EXACT_IDENTITY:LAW_PROGRAM_LAW` | exact program identity | Same identity or approved relation | Candidate identity uses another program type | Scope missing | Closed mismatch or explicit exclusion | Raw text, scope, relation evidence if needed | Optional | Required if used | Required | Single |
| 法律（0351） / 0351法律 | `DIRECTORY_REFERENCE` | code label, not typed-program identity | Exact namespace+version+code with compatible type, or approved equivalence | Code matches but typed-program relation is absent | Directory namespace or applicable scope missing | Versioned explicit non-equivalence or closed non-membership | Raw code/name, directory namespace/version, locator | Yes | Yes | Required | Single |
| 法学 | `EXACT_IDENTITY:LAW_STUDIES` | exact law-studies identity | Same exact applicable identity | Relation to another legal program is not established | Scope missing | Explicit bachelor-law requirement versus confirmed non-law bachelor, or another closed mismatch | Raw text, scope, complete candidate credential | No by default | If used | Required | Single |
| 其他明确专业 | `EXACT_IDENTITY:NAMED_DISCIPLINE` | not classified by substring | Exact normalized identity under approved normalization | Alias, hierarchy, or translation relation is unknown | Text cannot be safely normalized or scope missing | Closed exact mismatch with complete candidate identity | Raw and normalized name, scope | Optional | If used | Required | Single |
| 法学类 | `CATEGORY:LAW_FAMILY` | `LAW_FAMILY` | Versioned membership or explicit source member list | Candidate membership is not established | Category source/catalog or scope missing | Closed catalog proves non-membership | Category text and catalog/list evidence | Usually | Yes when catalog-based | Required | Single category |
| 法律类 | `CATEGORY:LAW_FAMILY` | `LAW_FAMILY`, distinct from 法学类 | Same as above | Same as above | Same as above | Same as above | Exact category and source-defined membership | Usually | Yes | Required | Single category |
| 法学相关专业 | `RELATED_OPEN_SET:LAW_RELATED` | `LAW_RELATED` | Only approved explicit inclusion | No inclusion/exclusion evidence | Scope missing or phrase cannot be isolated | Only explicit exclusion; absence from a list is insufficient | Raw open-set wording and relation evidence | Optional | If used | Required | Open set |
| 法律相关专业 | `RELATED_OPEN_SET:LAW_RELATED` | `LAW_RELATED` | Only approved explicit inclusion | Same | Same | Only explicit exclusion | Same | Optional | If used | Required | Open set |
| 法学及相关专业 | `RELATED_OPEN_SET:LAW_RELATED` | exact anchor plus open tail | Exact anchor may match; other membership needs evidence | Candidate may belong only through open tail | Scope/connector boundary missing | Closed exact exclusion applies only if source closes set | Raw phrase with anchor/tail structure | Optional | If used | Required | Anchor + open set |
| 法学或法律 | `CLOSED_SET` if `或` is explicit | separate `LAW_STUDIES` and `LAW` alternatives | Any proven branch matches | Broad `LAW` branch overlaps but is unresolved | Scope missing | Every branch is affirmatively not satisfied | Raw connector and each branch | Optional | If used | Required | Explicit OR |
| 法学、法律等 | `RELATED_OPEN_SET` | law anchors plus open tail | Proven anchor or inclusion relation | Candidate may belong to unspecified tail | Scope or `等` boundary not preserved | Only when all branches including tail are explicitly excluded, usually unavailable | Raw list, punctuation, open-tail evidence | Optional | If used | Required | OR/open-tail not assumed closed |
| 其他相近/相关专业 | `RELATED_OPEN_SET` | `UNRESOLVED`, not law by default | Only approved inclusion | Default candidate relation is unknown | Semantic anchor or scope missing | Only explicit exclusion | Raw phrase and relation evidence | Optional | If used | Required | Open set |
| 民商法学、刑法学等具体分支 | `EXACT_IDENTITY:NAMED_DISCIPLINE` per item | named law disciplines, not generic identity | Same exact identity or directory membership | Candidate has another legal program with unknown relationship | Scope/connector unknown | Closed exact/list mismatch with complete data | Exact names, connector, scope | Optional/likely | Yes when catalog-based | Required | Source connector controls |
| 知识产权 / 知识产权法 | Separate exact identities | not automatically `LAW_FAMILY` | Same identity or evidenced relation | Relationship between the two or another law program is unknown | Scope missing | Closed exact mismatch | Raw exact term and optional directory evidence | Optional | If used | Required | Single/list |
| 法律实务 | `EXACT_IDENTITY:LEGAL_PRACTICE` or directory identity | not automatically academic law | Same identity or official membership | Candidate academic-program relation is unknown | Education/vocational scope missing | Closed mismatch or explicit exclusion | Raw term, education type, directory evidence | Often | Yes | Required | Single/list |
| A或B | `CLOSED_SET` | branch-specific | One branch proven | A branch is open/unresolved and none match | Branch segmentation/scope missing | Every branch proven not satisfied | Exact connector and branches | As needed | As needed | Required | OR |
| A且B / A并且B | `CLOSED_SET` | branch-specific | Every branch proven | Any required branch is unresolved | Connector/scope missing | Any mandatory branch proven not satisfied | Exact connector and branches | As needed | As needed | Required | AND |
| 逗号/顿号多专业并列 | `CLOSED_SET` only if source convention proves connector | branch-specific | According to proven connector | Connector meaning unknown | Default if connector is not explicit or source-defined | Only after connector and all relevant branches are closed | Raw punctuation plus source schema/header | As needed | As needed | Required | Never infer OR solely from punctuation |
| 专业范围+相关专业 | `RELATED_OPEN_SET` | anchor family plus open tail | Anchor or explicit inclusion | Open-tail membership absent | Scope/anchor parsing missing | Only explicit exclusion | Raw anchor/tail and relation evidence | Optional | If used | Required | Mixed closed/open |
| 专业不限 | `ANY_MAJOR` | none | Directly satisfies major dimension | Never because of candidate major | Source does not clearly make it mandatory/applicable | Never on major dimension | Raw unrestricted wording and scope | No | No | Scope if limited | Single |
| 专业不限但要求法律职业资格 | `ANY_MAJOR` + separate qualification Fact | qualification-oriented, not law-major | Major is satisfied; qualification evaluated separately | Candidate qualification data missing | Clause cannot be decomposed or Requirement Set incomplete | Qualification explicitly not satisfied | Raw clause and separate evidence-linked Facts | No for major | No | Qualification is candidate-scoped | AND between dimensions |
| 法务/合规/风控岗位，专业不限 | `ANY_MAJOR`; job title remains occupation only | none | Major directly satisfied | Other Requirements may remain unknown | Major wording absent or not explicit | Never infer major non-match from occupation | Requirement-bearing text, not title alone | No | No | As stated | Separate dimensions |
| 本科专业要求 | exact/category/open form + `BACHELOR` | expression-specific | Per semantic rule at bachelor scope | Membership unresolved | Bachelor scope evidence missing | Proven bachelor mismatch | Header/cell/text locator and scope | As needed | As needed | BACHELOR | Source connector |
| 研究生专业要求 | form + `GRADUATE` | expression-specific | Per rule across master/doctor credentials without converting scope | Membership unresolved | Scope not explicit | Proven mismatch within GRADUATE semantics | Exact source scope | As needed | As needed | GRADUATE | Source connector |
| 硕士专业要求 | form + `MASTER` | expression-specific | Per rule for master only | Membership unresolved | Scope not explicit | Proven master mismatch | Exact source scope | As needed | As needed | MASTER | Source connector |
| 最高学历专业要求 | form + `HIGHEST_DEGREE_ONLY` | expression-specific | Highest credential satisfies | Highest credential or relation unknown | Highest-degree wording or candidate chronology missing | Highest applicable credential proven mismatch | Exact applicability wording | As needed | As needed | Explicit relationship | HIGHEST only |
| 任一学历满足即可 | form + `EITHER_LEVEL` | expression-specific | Any explicitly permitted level satisfies | One level unresolved and none match | Relationship wording missing | Every permitted level proven mismatch | Exact relationship wording | As needed | As needed | Multiple | Explicit OR |
| 本科和研究生分别要求 | separate scoped Facts + explicit relationship | expression-specific | Per AND/OR stated by source | Relationship unresolved | Relationship not stated | According to proven relationship | Each scoped field and relationship evidence | As needed | As needed | Separate | Explicit only |
| 未明确学历层级 | expression preserved, scope unresolved | expression-specific | No | Not an engine outcome until set complete | Always RR if mandatory | No Eligibility non-match | Raw text and missing-scope blocker | As needed | As needed | UNRESOLVED | Unknown |
| 0301 / 0351 / 细分代码 | `DIRECTORY_REFERENCE` | directory-defined only | Exact compatible directory identity or approved relation | Program type/category relation absent | Namespace/version/scope missing | Explicit non-equivalence or versioned non-membership | Code, label, namespace, version, locator | Yes | Yes | Required | Source connector |
| 一级学科 / 学科门类 / 专业大类 | `CATEGORY` with category level | never inferred from digits alone | Versioned membership | Candidate hierarchy relation absent | Category level/catalog missing | Versioned non-membership | Category level and directory evidence | Yes | Yes | Required | Source connector |
| 专业方向 / 研究方向 | `DIRECTIONAL` qualifier | not a base-major identity | Exact direction or approved relation | Candidate direction evidence absent | Direction cannot be separated from major | Proven closed direction mismatch | Base major plus direction Evidence | Usually | If cataloged | Required | Usually AND with base major |
| 简称 | exact raw alias plus unresolved canonical identity | no family inference | Approved alias evidence | Alias mapping absent | Alias itself ambiguous | Explicit alias non-equivalence | Raw abbreviation and versioned alias source | Optional | Yes for reusable mapping | Required | Source connector |
| 旧称/新称 | versioned rename relation | no automatic equality | Approved effective-dated rename evidence | Applicable date/version unknown | Source date/catalog missing | Explicit non-equivalence | Names, effective dates, directory versions | Usually | Yes | Required | Single |
| 中英文/括号表达 | exact multilingual labels, not automatic identity | no substring family inference | Source or catalog states same identity | Translation/parenthetical role unknown | Conflicting labels or missing provenance | Explicit conflict/non-equivalence | Both raw labels and relation evidence | Optional | If used | Required | Single |
| 代码+名称同时出现 | directory reference with both fields | directory-defined | Both agree and candidate relation is valid | Only one component matches | Code/name conflict, namespace/version missing | Explicit non-equivalence | Raw code and name, same locator, directory metadata | Yes | Yes | Required | Single/list |
| 招聘单位自定义目录/对照表 | external directory/list reference | source-defined only | Candidate appears under approved rule | Entry or interpretation missing | Attachment/list missing | Closed list proves exclusion only if declared exhaustive | Attachment Snapshot and cell/range Evidence | Yes | Yes | Required | Defined by source |
| 所学专业须与岗位相关 | `RELATED_OPEN_SET` tied to job duties | never infer from job title | Only official inclusion/review evidence | Default | No decision rule or review evidence | Only explicit exclusion | Exact clause and official review rule | Optional | If used | Required | Open predicate |
| 具体专业以资格审查为准 | `AUTHORITY_REVIEW` | unresolved | No direct machine match | Always until official review evidence exists | Mandatory criterion has no machine-decidable surface | Only official review outcome, not historical hire inference | Original clause and official case-specific review evidence | No | No | Required | Authority decision |

## Required CR#11 Additions

CR#11 cannot safely proceed with only the current single expression enum. The following are minimum implementation prerequisites:

1. Separate **expression form** from **semantic family/identity**.
2. Preserve exact identities for law-master law/non-law and law-program law/non-law without collapsing them.
3. Preserve exact named disciplines as source text or versioned directory references instead of reducing them to generic law.
4. Represent closed versus open sets and preserve explicit `OR`, `AND`, open-tail `等`, and unknown connector states.
5. Remove the unsafe normalization that strips `相关专业` before classification.
6. Stop treating commas, enumeration punctuation, slash, and `或` as one unconditional OR rule.
7. Define code/name/directory namespace/version conflict blockers.
8. Support evidence-backed candidate-to-Requirement inclusion/exclusion without embedding a nationwide equivalence table.
9. Decompose `ANY_MAJOR` and professional qualification into independent Facts when both occur in one source clause.
10. Keep job titles and duties outside major inference.
11. Keep absent education scope and absent cross-level relationship as Completeness blockers.
12. Preserve exact source wording for abbreviations, renamed programs, multilingual labels, categories, directions, and authority-review clauses even when they remain untyped.

## Deferred but Reserved

The following do not need full automated interpretation in the first CR#11 implementation, but the domain must preserve them without data loss and route them to review:

- nationwide alias, old/new-name, and multilingual equivalence registries;
- automatic crosswalking between Education Ministry, civil-service, public-institution, local, and employer-defined catalogs;
- automatic interpretation of professional direction and research direction;
- ingestion of every employer-specific comparison table;
- automatic decisions for `所学专业须与岗位相关`;
- automatic decisions delegated to qualification review;
- semantic similarity, embeddings, or probabilistic major matching.

These cases may remain `UNRESOLVED`, `RELATED_OPEN_SET`, `AUTHORITY_REVIEW`, or explicit Evidence-backed relations. They must not be silently converted into exact identities.

## Explicit Non-Inference Rules

- Same code does not imply same training-program identity.
- Similar name does not imply equivalence.
- Containing `法` or `法律` does not imply legal-major membership.
- Job title or duties do not imply a major Requirement.
- `法学`, `法学类`, `法律类`, `法律相关专业`, `法律`, `法律（0351）`, `法律（非法学）`, and `法律硕士（非法学）` remain distinct.
- A comma or enumeration mark does not prove OR.
- `等`, `相关`, and `相近` do not define a closed set.
- Parentheses do not automatically define alias, program type, direction, or equivalence.
- A catalog code without namespace and version is not portable evidence.
- A successful or proposed hire does not define the original Requirement.
- Third-party job platforms, unofficial taxonomies, and common recruiting practice do not define official major membership.
- CandidateProfile never rewrites or narrows source Requirement semantics.

## Disposition

### A. Already Covered

Raw/normalized Evidence, distinct education scopes, explicit cross-level relationship modes, versioned directory references, a limited exact legal code set, Candidate program identity separation, explicit code/type equivalence evidence, Completeness blockers, and the `COMPLETE` Eligibility gate are already present.

### B. Missing

The domain lacks a two-axis expression model, complete exact legal identities, open/closed set semantics, reliable connector provenance, named-discipline preservation, mixed major/qualification decomposition, code/name conflict rules, alias/rename/multilingual handling, category level, direction qualifiers, and authority-review representation.

### C. Must Be Added to CR#11

The twelve minimum prerequisites listed above must be added before implementation. In particular, unsafe related-major narrowing and unconditional punctuation-to-OR behavior must be corrected in CR#11, not deferred.

### D. May Be Deferred with Preservation

Automatic alias catalogs, cross-catalog mappings, directions, employer comparison tables, job-related-major adjudication, and authority-review decisions may remain unresolved, provided Raw Evidence and explicit blocker/review states are preserved.

### E. Must Never Be Automatic

Substring legal-family assignment, code-only typed-program equivalence, name-similarity equivalence, job-title inference, candidate-driven Requirement rewriting, punctuation-only logic inference, and proposed-hire/third-party reverse inference are prohibited.

### F. Approval Recommendation

`DO NOT APPROVE CURRENT CR#11 FOR IMPLEMENTATION`.

CR#11 should be revised and re-frozen around the two-axis expression model and the mandatory safety corrections above. A subsequent human approval should authorize the exact type, parser, engine, and test files only after that revised scope is stable.
