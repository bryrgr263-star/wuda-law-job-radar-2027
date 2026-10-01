# Production Source Expansion Phase 2 — first-batch admission review

Date: 2026-10-01. Scope: SD-016, SD-019, SD-020, SD-031, and SD-039 only.

This is an admission review, not a production admission record or acquisition result. All five remain outside Source Registry, Continuous Authorization, Scheduler enumeration, and public presentation. The Phase 1 pool and its statistics are preserved in `2026-10-01-candidate-pool.json` and `2026-10-01-phase-1-report.md`; those files were committed before this review.

## Method and limits

The five exact official entry URLs were inspected with read-only HTTP GET, `redirect: manual`, `credentials: omit`, and no cookie storage or follow-up requests. The recorded HTTP metadata contains only status, content type, redirect presence, and `Set-Cookie` presence; no header value was retained. Official pages and selected official announcement/attachment URLs were reviewed separately. These observations are **not** production-gate acquisition, do not prove recurring access from a GitHub runner, and do not authorize any downstream link. A response that merely sets a cookie is not itself an admission failure under the existing stateless policy.

No source meets the full exact-target, position identity, source-composition, and existing-adapter requirements today. In particular, a campaign or major list must not be converted into invented Position records, and incomplete attachments or job-detail surfaces must not be treated as complete Requirements.

## SD-016 — 中车长客

- **Ownership:** VERIFIED_OFFICIAL_ORIGIN. The [official recruitment column](https://www.crrcgc.cc/ckgf/128_7635/128_7706/index.html) identifies 中车长春轨道客车股份有限公司 and links to its [2027 campus announcement](https://www.crrcgc.cc/ckgf/2026-08/31/article_2026083119415164821.html). Group context is China CRRC; the hiring company is the subsidiary, not every CRRC unit.
- **Discovery surface:** the exact recruitment-column URL above. **Content surface:** the exact 2027 announcement. The official announcement links to an external Hotjob application system, which was not acquired or authorized.
- **Evidence:** 2027 campus signal is explicit. The announcement lists 法律 among broad management-related majors, but does not identify a distinct legal Position. No job-specific attachment was established from the announcement.
- **Read-only transport:** this local stateless GET received HTTP 403; a separate public page reader could display the page. The environment discrepancy and access policy require review; no bypass was attempted.
- **Production admission:** REVIEW_REQUIRED. No position-level binding or repeatable production transport is established. No exact target or authorization was created. Controlled acquisition: NOT_RUN.

## SD-019 — 中国邮政

- **Ownership:** VERIFIED_OFFICIAL_ORIGIN. The [group's 2027 joint campus announcement](https://www.chinapost.com.cn/cn/report/2609/1176-1.htm) is on its own domain. The announcement itself links to a Zhaopin application system, establishing a referral, **not** authorization to acquire Zhaopin.
- **Discovery surface:** a stable official announcement/list entry still needs an exact locator and policy review; the 2027 announcement is a content surface, not by itself a durable recurring discovery surface.
- **Evidence:** 2027 graduation scope and 法律 in a broad major list are explicit. The announcement says individual unit/job conditions are on the job platform. It does not provide bound individual Position records or their complete requirements.
- **Read-only transport:** exact announcement GET returned HTTP 200, `text/html`, no redirect or response cookie observed.
- **Production admission:** REVIEW_REQUIRED. The recurring official entry and authorized position-detail surface remain unresolved. No Zhaopin request, exact target, or authorization was created. Controlled acquisition: NOT_RUN.

## SD-020 — 中国银行

- **Ownership:** VERIFIED_OFFICIAL_ORIGIN. The bank's [recruitment-announcement column](https://www.bank-of-china.com/aboutboc/bi4/) links to its [2027 global-campus announcement](https://www.bank-of-china.com/aboutboc/bi4/202609/t20260903_25689311.html). The announcement explicitly endorses its separate ChinaHR campus site for application and job-specific details; endorsement is not acquisition authorization.
- **Discovery surface:** the exact bank recruitment column. **Content surfaces:** the 2027 announcement and its linked [seven-page official PDF of recruitment conditions](https://pic.bankofchina.com/bocappd/appform/202609/P020260903517985334320.pdf). Organization-specific job conditions are additionally deferred to the campus site.
- **Evidence:** 2027 is explicit. The announcement describes management-trainee risk/compliance directions; the PDF lists law-related majors for several directions and distinct requirements by institution/role. Those are not interchangeable Position identities or a single RequirementSet.
- **Read-only transport:** column and announcement GET returned HTTP 200 `text/html` without redirect or response cookie. The official PDF is readable, but has not been admitted, bound, or parsed through the production Source Composition chain.
- **Production admission:** EVIDENCE_BLOCKED. The announcement/PDF/job-site composition and per-organization Position binding are not closed. No exact target or authorization was created. Controlled acquisition: NOT_RUN.

## SD-039 — 君合律师事务所

- **Ownership:** VERIFIED_OFFICIAL_ORIGIN. The [firm's careers entry](https://www.junhe.com/careers) and [location-specific legal-intern surface](https://www.junhe.com/careers/locations/4) are on its own domain.
- **Discovery surface:** careers entry; location and vacancy pages are candidate content surfaces. Exact location/position coverage, pagination, and stable vacancy identity have not been established.
- **Evidence:** legal-career content exists. A specific 2027 campaign was not established and is not required merely to retain an official source. No complete job-specific attachment/Requirement binding was established.
- **Read-only transport:** careers entry and location URL returned HTTP 200 `text/html` and `Set-Cookie` presence, with no redirect observed. The location response body timed out in local inspection, so the presence of an extractable, stable vacancy list is unverified. Cookies were not stored or replayed. `robots.txt` permits `/careers` for the wildcard user agent; this does not substitute for the full admission review.
- **Production admission:** REVIEW_REQUIRED. Exact vacancy surface, extraction, and bounded pagination remain unresolved. No exact target or authorization was created. Controlled acquisition: NOT_RUN.

## SD-031 — 深圳市国资委

- **Ownership:** VERIFIED_OFFICIAL_ORIGIN for the [government campus-recruitment column](https://gzw.sz.gov.cn/gzrc/xyzp/index.html). The government portal publishes multi-employer notices; it is not automatically the employing authority for each Position.
- **Discovery surface:** the official campus column. A [2027 campaign notice](https://gzw.sz.gov.cn/gzrc/rczx/content/post_12993827.html) appears in a different official talent-news surface. These must be bound deliberately rather than treating the campus column as complete 2027 coverage.
- **Evidence:** 2027 campaign signal is present; the reviewed surfaces do not establish individual legal Position identities, employer-specific requirements, or a complete attachment/job-platform composition. The portal links to a separate application platform; it was not acquired or authorized.
- **Read-only transport:** campus column and 2027 notice returned HTTP 200 `text/html` with response `Set-Cookie` presence and no redirect. Cookies were discarded.
- **Production admission:** EVIDENCE_BLOCKED. Multi-employer ownership, content binding, and exact position/attachment surfaces are unresolved. No exact target or authorization was created. Controlled acquisition: NOT_RUN.

## Decision and boundary

| Measure | Result |
| --- | ---: |
| Sources reviewed | 5 |
| Production admission approved | 0 |
| Review required | 3 |
| Evidence blocked | 2 |
| Acquisition unsupported conclusively established | 0 |
| New Source Registry entries / Continuous Authorizations / exact targets | 0 / 0 / 0 |
| Controlled production acquisitions / new OpportunityCandidates / new Positions | 0 / 0 / 0 |

No candidate was rejected for lack of a current 2027/legal vacancy or for engineering/construction terminology. `Set-Cookie` presence was not treated as session dependence. No CandidateProfile, Eligibility, old jobs, Legacy crawler, or second acquisition authority was used. No production state or approved 86,400-second cadence was changed.

**Phase 2 status: PARTIAL.** The five independent reviews are complete; admission and controlled first acquisition are not. Before any promotion, each source needs a versioned exact-target/ownership and Source Composition plan, a compatible existing-chain adapter and focused tests, access-policy evidence, and a separate controlled authorization. The first-batch review does not grant those approvals.
