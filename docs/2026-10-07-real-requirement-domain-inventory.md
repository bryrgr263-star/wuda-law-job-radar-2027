# Real Requirement Coverage Inventory — 2026-10-07

## Scope and evidence boundary

Management/diagnostic inventory, not a Requirement artifact or production authorization.
Fixed inspected commit: `1634441ca0d5221150288d1be856e63a2279408c`.
Only already-committed source evidence was read. No acquisition, constructor-based trust issuance,
new Schema, Predicate, Candidate Evidence, or Eligibility implementation occurred.

The stored journal contains 117 commands and no Requirement Projection, Requirement Set,
Predicate Resolution, or Eligibility command. The three stored Zhenghan Source Compositions
are `UNRESOLVED`: authority assertions and version selections are empty, and inventory
completeness is `OPEN_UNRESOLVED`. Production preparation deliberately supplies these unresolved
states; an official URL alone does not prove complete, selected recruitment-condition coverage.

`executeProductionTrustedChainBinding()` correctly requires a `COMPLETE` composition before
Requirement Projection/RSV. A complete RSV plus independently trusted Candidate Evidence is
then required for Predicate Resolution. These gates must not be weakened for coverage metrics.
No parser result below is presented as a newly issued production Fact or COMPLETE RSV.

## Existing evidence references

Paths below are repository-relative artifact envelopes; source text is inside their
`canonical_bytes`. These are evidence pointers, not public publication fields.

| Record | Existing evidence | HTML section locator |
| --- | --- | --- |
| Haier 法务 | `trusted-state/artifacts/objects/000751842b8aaff325eed1cb8c38254187f1fed97b5d1b20cfcfb60e26c3f9c3.json` | `haier-rid-61:legal-position` |
| Zhenghan 争议解决律师 | `trusted-state/artifacts/objects/1762fbc0814fdda36129fc9ceb17516ba3e5d34419116bc9fcdaa93851a5c2ab.json` | `post-2790:dispute-resolution-lawyer` |
| Zhenghan 2027 长期实习生 | `trusted-state/artifacts/objects/a9b89bc4d3266f9bbc9f57c9c58935faca032c3663818253fbba2c2e9270ccb9.json` | `post-2790:campus-long-term-intern-2027` |
| Zhenghan 2028+ 短期实习生 | `trusted-state/artifacts/objects/cbf911b23e1273d3c7ec6693c77bd4deb1619af409e60c4d0bb17241f07e7d79.json` | `post-2790:short-term-intern-2028-plus` |

National Energy's first failed submission logged artifact IDs but the old cleanup removed its
unpublished checkout. Those IDs are not recoverable canonical bytes and are excluded from this
inventory. No National Energy Requirement/Eligibility result is inferred from them.

## Observed clauses and minimal disposition

“Supported” below means an existing domain/grammar or an existing isolated coverage control,
not proof that the current production composition has authorized execution.

| Domain / boundary | Real source text | Existing coverage / gap | Safe next action |
| --- | --- | --- | --- |
| Education level | Haier: “本科及以上学历”; Zhenghan interns: “在校本科生或研究生” | Existing `EDUCATION_LEVEL`; numbered internship composite control preserves the education OR. Haier combines year, education and language in one clause, which still needs clause-local decomposition evidence. | Reuse existing schema; preserve AND/OR and every residual clause. Do not claim full composite coverage from substring recognition. |
| Academic degree | These four records do not separately specify an academic-degree award | `ACADEMIC_DEGREE` exists, but degree and education level are not interchangeable. | Not observed does not mean unrestricted; never infer 学位 from 学历. |
| Major and level | Lawyer: “法学专业本硕学历”; interns: “法学专业”; Haier: “法律等相关专业” | Existing `MAJOR` and credential scopes. Existing control preserves BACHELOR AND MASTER law-major requirements. “等相关专业” does not establish a closed major set. | Preserve ambiguity; never expand the set using the candidate's major. |
| Graduation year / cohort | Haier: “2027届应届毕业生”; long internship: “2027年应届在校本科生或研究生”; short internship: “2028届及之后” | Existing year/cohort domains; existing internship control preserves exact year vs lower bound and current-student identity. | Reuse those domains after trusted composition; no candidate-derived recruitment year. |
| 0301 / 0351 | Not present as catalog codes in these four stored requirement texts | Existing catalog/scope machinery is not evidence of a source-specific directory version. | No new catalog assertion. `0351` must never imply `LAW_MASTER_NON_LAW`. |
| Legal professional qualification | Haier: “有法律职业资格”; interns: “通过国家法律职业资格考试…优先” | Existing qualification domain. The internship preference control produces no mandatory Fact. The Haier mixed qualification/competence clause cannot be called fully covered merely because a qualification phrase is present. | Preserve modality, exceptions, original span and unparsed remainder. Asserted candidate data is not document verification. |
| Lawyer practice certificate / years | Lawyer: “拥有3-5年律师工作经验，并持有律师执业证” | Existing bounded work-experience and `LAWYER_PRACTICE_CERTIFICATE` control; certificate remains distinct from legal professional qualification. | Reuse existing compound control; do not flatten duration/scope or substitute certificates. |
| Institutional prestige / academic performance | “国内外知名院校”; “成绩优秀” | No objective list, grade threshold, assessment authority or executable criterion is established by these phrases. Existing prestige control retains a residual domain-gap observation. | Preserve for review; do not invent a university tier or candidate cutoff. |
| Language / CET | Haier: “英语六级及以上”; “对英语熟悉，看懂英语文件” | `LANGUAGE` is already a schema dimension, but the inspected deterministic parser has no CET-specific rule. Broad language familiarity is not a safely typed certificate threshold. | Distinguish an objective certificate clause from subjective skill text. Do not add an unapproved domain or infer equivalence; retain review until an evidence-backed contract is justified. |
| Office / communication / execution / values | Haier: “熟悉常用OFFICE办公软件”; “善于沟通”; Zhenghan: “认同…文化和价值观念” | Subjective capability or culture text does not itself establish an objective Candidate Predicate. | Preserve the original text and section provenance. Do not manufacture Requirement Facts, and do not blanket-reclassify real recruitment conditions as INFORMATIONAL to get COMPLETE. |
| Specialized litigation / arbitration | Lawyer text includes “具有商事诉讼/仲裁案件出庭并担任主要代理人的经验” | Section binding must determine whether this is an explicit prerequisite or job content. No Specialized Legal Experience domain is approved. | Duties support relevance/display only. If the official recruitment-condition section explicitly requires prior experience, retain review rather than create a new Predicate. |
| Internship schedule / duration | Interns: “每周实习至少4天…3个月或以上”; “每周实习至少3天…3个月或以上” | No Internship Availability domain is approved. Work arrangements are not automatically entry qualifications. | Preserve detail/display evidence. Confirm section/role before classifying; do not require candidate proof of availability or create eligibility logic. |
| Health / conduct / integrity | Haier: “身体健康，品行端正，无任何不良行为记录或诚信记录” | Broad health/conduct text is not an objective medical standard or a specified trusted disqualification record. Existing general-eligibility record types do not establish that equivalence. | Preserve ambiguity/review. Absence of candidate documents does not prove a negative record or INELIGIBLE. |
| Gender / other mandatory conditions | No explicit gender condition appears in these four texts | No source-backed demand for a new rule. | No theoretical expansion; retain unknown conditions if later evidenced. |

## Immediate blockers versus coverage work

1. The production Composition boundary is the first gate for current Zhenghan evidence: no
   verified authority/version-selection closure has been issued. Parser improvements cannot
   bypass it or retrospectively transform stored history into COMPLETE.
2. The existing production journal has no trusted Candidate Evidence issuance. A candidate
   profile, the user's university/year/major, or a test fixture is not a substitute.
3. Subjective wording and ambiguous major membership require review, not invented facts.
4. Internship Availability and Specialized Legal Experience remain unimplemented by explicit
   product scope. Duties and arrangements must not drive a new implementation blocker.

Existing controls live in `tests/pipeline/approved-requirement-projection-coverage.test.ts` and
`tests/requirements/p1-cr12-requirement-logic-modality-applicability.test.ts`. This inventory
does not rewrite those tests, production history, the current ReadModels or the closed CR#12.

## Candidate Evidence privacy prerequisite

Read-only GitHub repository metadata checked on 2026-10-07 reports this repository's visibility as
`public`. The existing journal stores command payloads and artifact envelopes store canonical
artifact bytes; SHA-256/seals provide integrity, not confidentiality. The publication allowlist
protects Pages output but cannot hide personal evidence committed to a public Git repository.

No production Candidate Evidence artifact/issuance command is present in the inspected state;
this is a prerequisite for future issuance, not a claim that this task disclosed candidate data.
Do not issue the user's actual private evidence/profile into this public authoritative repository.
A reviewed private evidence persistence/access boundary is required before production personal
issuance, while reusing the same issuer/Registry/Trusted Chain. No private repository, credential,
encryption scheme or new persistence implementation was created in this inventory.

The API result is evidence of repository visibility, not a new source Admission or authorization.
Test-only fake candidate data is not production evidence, and a public-safe snapshot is not proof
that the upstream repository can safely store the user's personal material.

## Continuation boundary

Requirement coverage inventory is complete for these four retained source records, but production
Requirement/Eligibility closure is NOT VERIFIED. Continue only with real section/authority/selection
evidence and the existing trusted processors. Do not add a domain simply because a phrase exists.
Any eventually complete RSV still requires independent evidence-native candidate issuance; missing
or insufficient evidence must remain NEEDS_REVIEW/EVIDENCE_BLOCKED, never automatic INELIGIBLE.
