# Phase 2B — first-batch admission blocker closure

Date: 2026-10-01. Scope: SD-016, SD-019, SD-020, SD-039, SD-031 only.

## Evidence and authority boundary

Phase 2 review commit `e6cd53ed6504b9ac1025c81349bc3fee603298a8` was normally fast-forward pushed and the remote SHA was confirmed. Scheduler startup fix `80bfbc8becc5c8e7dbdf7f4becf9b71863a64225` remains its ancestor. No rebase or force push was needed.

This document records read-only research, not a SourceAdmission, a production acquisition, a RawBlob, or a trusted artifact. Officially referred platform landing pages were inspected only to close ownership/content blockers; referral does not grant Continuous Authorization. Native HTTP observations used GET, manual redirects, credentials omitted, bounded timeout, and no cookie storage/replay. Script references were inspected as text, not executed. No platform API, login, browser automation, CAPTCHA bypass, or automated pagination was performed. Response cookie presence was recorded only as a boolean. Contact addresses, cookie/header values and raw response dumps are not included.

Public-reader results and native HTTP observations are distinguished below. A public reader can resolve/canonicalize a URL; that is not proof that production's redirect-denying transport may do so. Timeouts, 403, and JS shells do not prove universal unsupported acquisition.

## SD-016 — 中车长客

PREVIOUS STATUS: REVIEW_REQUIRED.

DISCOVERY SURFACE: <https://www.crrcgc.cc/ckgf/128_7635/128_7706/index.html>.

CONTENT SURFACE: <https://www.crrcgc.cc/ckgf/2026-08/31/article_2026083119415164821.html>, official 2027 campus announcement dated 2026-08-31.

BLOCKERS CLOSED:
- The announcement identifies the subsidiary employer, recruitment year, location groups, degree levels and major groups. It explicitly includes law in management-related majors.
- Official application referral to <https://crrc-ckgf.hotjob.cn/> is established. Acquisition and application are separate; inability to automate application is not a reason to discard the announcement.
- The earlier 403 occurred on the official recruitment-column native GET, not on an attempted application submission. The public reader can read the announcement. The referred Hotjob landing page returned native HTTP 200 and an iframe/script bootstrap, not a populated vacancy list.

POSITION SURFACE: not established. Major groups are not named individual job records; no invented legal Position was created.

ATTACHMENTS: no job-specific attachment established in reviewed announcement; this is not a claim that none exists anywhere.

SOURCE COMPOSITION: employer announcement plus any subsequently verified position/detail surface; application link is not a substitute for position evidence.

BINDING STATUS: employer-to-announcement and announcement-to-application referral verified at research level; concrete position identity unresolved.

BLOCKERS REMAINING: repeatable approved transport/access review, exact position surface and extraction/binding. The landing page obtains iframe content dynamically; no derived endpoint was requested or authorized.

PRODUCTION ADMISSION: REVIEW_REQUIRED. AUTHORIZATION CREATED: NO. CONTROLLED FIRST ACQUISITION: NOT_RUN.

CODE CHANGE REQUIRED: eventually a tested existing-chain source adapter; insufficient evidence for a tiny binding-only implementation today. DESIGN GAP: bounded dynamic platform endpoint/content admission, if this platform is needed. NEXT ACTION: approve a narrow content-surface investigation or supply an official position table. Do not change production redirect/cookie policy.

## SD-019 — 中国邮政

PREVIOUS STATUS: REVIEW_REQUIRED.

CONTENT SURFACE: <https://www.chinapost.com.cn/cn/report/2609/1176-1.htm>, 2027 joint campus announcement dated 2026-09-07.

BLOCKERS CLOSED:
- Official group announcement directly refers to <https://chinapost2027.zhaopin.com/>. This is an officially referred recruitment platform, not an arbitrary third-party job aggregator.
- The 2027 batch and broad law-major signal are explicit. Individual employers and job conditions are deferred to the platform; Postal Savings Bank and insurance recruitment have separately stated official-channel qualifications.
- After a public-reader timeout, native stateless landing GET returned HTTP 200, 1,699 UTF-8 bytes, no response-cookie/redirect observed, and an application shell with a same-site JavaScript bundle reference. Timeout is not an unsupported conclusion.

DISCOVERY SURFACE: durable official announcement-list locator not closed; the campaign announcement is a known content anchor.

POSITION SURFACE: platform unit list/job list/details/pagination not established from the landing HTML. Scripts were not executed and hidden APIs were not requested.

ATTACHMENTS: no bound individual position table established.

SOURCE COMPOSITION: group announcement + officially referred batch platform + exact unit/job/requirement records, with separate treatment of separately recruited entities.

BINDING STATUS: official referral and batch verified at research level; unit/job/details unresolved.

BLOCKERS REMAINING: recurring discovery target, bounded exact public job endpoints, unit employer identity, pagination completeness, detail conditions and access review.

PRODUCTION ADMISSION: REVIEW_REQUIRED. AUTHORIZATION CREATED: NO. CONTROLLED FIRST ACQUISITION: NOT_RUN.

CODE CHANGE REQUIRED: not merely a small HTML parser fix. DESIGN GAP: admitted bounded dynamic job-list/detail acquisition and completeness evidence. NEXT ACTION: freeze a narrow platform endpoint investigation contract before implementation; do not authorize the whole domain.

## SD-020 — 中国银行

PREVIOUS STATUS: EVIDENCE_BLOCKED.

DISCOVERY SURFACE: <https://www.bank-of-china.com/aboutboc/bi4/>.

CONTENT SURFACES:
- Announcement: <https://www.bank-of-china.com/aboutboc/bi4/202609/t20260903_25689311.html>.
- Official attachment: <https://pic.bankofchina.com/bocappd/appform/202609/P020260903517985334320.pdf>.
- Officially endorsed campus landing: <https://campus.chinahr.com/pages/2027-boc/>.

BLOCKERS CLOSED: announcement dated 2026-09-03 explicitly endorses the campus site and links the seven-page 2027 conditions PDF. The PDF was read, not rejected for its format. It is an official common/role-group conditions source, not the complete institution-specific job source.

### PDF scope and binding analysis

| PDF locator (one-based page) | Applicable scope | Binding constraint |
| --- | --- | --- |
| 1, basic conditions | Common applicant conditions | Inherit only within this 2027 announcement package |
| 1–2, head-office department roles | Named trainee directions, including risk/compliance | Select direction explicitly; do not apply technology majors to other directions |
| 2, head-office language plan | Separate language role group | Do not mix with risk/compliance |
| 3–4, direct institutions and audit | Different institution/role groups | Match exact institution and role; audit is not automatically a law position |
| 5–7, domestic branch roles | Trainee, technology and branch service groups | Branch/job-specific supplements remain required |
| 7, additional explanations | Graduation window, first employment and other common constraints | Not equivalent to a blanket single graduation-year fact |

Law is among accepted majors for several groups, including risk/compliance. That does not itself issue Relevance or Eligibility. English alternatives differ by group. The PDF explicitly allows additional institution-specific conditions, so announcement plus PDF cannot honestly establish COMPLETE composition for every job.

The native campus landing returned HTTP 200, 55,362 UTF-8 bytes, no cookie/redirect observed at the trailing-slash target. Removing scripts/styles leaves a JavaScript-required shell. Its asset path includes a historical naming segment; that path is not recruitment-year evidence. The public reader canonicalized the non-trailing-slash URL; production must not silently follow it.

POSITION SURFACE: role groups are described officially, but actual employer/institution job identifiers and supplementary conditions remain unbound.

SOURCE COMPOSITION: dated announcement publication binding → PDF publication/page/section binding → exact institution/job detail binding; explicit common and group scopes, plus conflict/precedence review for supplements. This is a proposal, not issued trusted composition.

BINDING STATUS: announcement/PDF publication relationship closed at research level; per-job detail completeness not closed.

BLOCKERS REMAINING: exact job surfaces, institution supplements, admitted PDF extraction/locator integrity, and production adapter/access review.

PRODUCTION ADMISSION: EVIDENCE_BLOCKED. AUTHORIZATION CREATED: NO. CONTROLLED FIRST ACQUISITION: NOT_RUN.

CODE CHANGE REQUIRED: not just an attachment-index binding. DESIGN GAP: production PDF extraction with provenance-preserving page/section locators and bounded dynamic detail acquisition. NEXT ACTION: review this minimal capability contract using existing attachment bindings; do not create another Requirement engine.

## SD-039 — 君合

PREVIOUS STATUS: REVIEW_REQUIRED.

DISCOVERY SURFACE: <https://www.junhe.com/careers>.

CONTENT / POSITION SURFACE: <https://www.junhe.com/careers/locations/4>.

BLOCKERS CLOSED:
- A later native stateless GET with `Accept-Language: zh-CN,zh;q=0.9` returned HTTP 200 and a complete 50,180-byte Chinese HTML body. Response-cookie presence was observed; values discarded. The previous timeout did not demonstrate unsupported access. The language header is an observation, not proven causation or a production contract change.
- Guangzhou page contains two distinct visible vacancies: education/medical lawyer assistant and intellectual-property dispute mid-level lawyer. Titles, location, candidate conditions and application anchors are in HTML; a separate job-detail URL is not necessary to read those visible records.
- Objective degree/qualification conditions coexist with language/experience or subjective requirements. Preferred conditions must not be promoted to mandatory. No RequirementFact was issued.
- Pagination anchors explicitly link `https://www.junhe.com/careers/locations/4?page=2`, `?page=3`, `?page=4`; they were not fetched. Visible category links distinguish legal/nonlegal professional and intern roles.

ATTACHMENTS: no required attachment established for these two visible vacancies.

SOURCE COMPOSITION: individual vacancy block, exact location/category evidence, and bounded pagination coverage where claimed. One fetched page must not claim complete multi-page coverage.

BINDING STATUS: research-level employer/location/title blocks exist; stable vacancy locator/revision and pagination coverage are not production-sealed.

BLOCKERS REMAINING: production query policy is DENY_ALL; finite `page` targets cannot be added by a small parser without changing that contract. Current vacancies have no established 2027/year/date identity; retain as undated, never label 2027. Access-policy review and tested stable extraction remain required.

PRODUCTION ADMISSION: REVIEW_REQUIRED. AUTHORIZATION CREATED: NO. CONTROLLED FIRST ACQUISITION: NOT_RUN.

CODE CHANGE REQUIRED: a page-one-only adapter could be source-specific but must explicitly declare partial coverage and establish identity; full advertised coverage needs contract review. DESIGN GAP: bounded query-bearing pagination under exact-target authorization. NEXT ACTION: choose limited page-one admission or separately approve finite query policy; no silent pagination skipping.

## SD-031 — 深圳市国资委

PREVIOUS STATUS: EVIDENCE_BLOCKED.

DISCOVERY SURFACES: campus list <https://gzw.sz.gov.cn/gzrc/xyzp/index.html> and talent-news surface containing the 2027 notice <https://gzw.sz.gov.cn/gzrc/rczx/content/post_12993827.html>.

BLOCKERS CLOSED:
- The alternate campus entry <https://gzw.sz.gov.cn/xyzp/index.html> returned native HTTP 200 but only 101 bytes containing a script navigation to <https://gzw.sz.gov.cn/xyzp/content/post_9397139.html>. It is not a job list and no script was executed.
- The separately reviewed exact destination publicly links the campus platform <https://jyjpc.iucai.com.cn/#/>. Its campus list and talent-news list differ: the latter carries the 2027 signal; the campus section includes earlier batches. A whole-page 2027 keyword must not relabel older notices.
- Platform origin native GET returned HTTP 200, 790 bytes, no cookie/redirect observed, a JS shell and script references, no individual employer/job records.
- Government publisher/organizer and actual recruiting enterprises must remain separate. Referral is evidence of platform linkage, not evidence that SASAC employs each job.

POSITION SURFACE: individual enterprise/job exact targets unresolved. ATTACHMENTS: no complete employer-bound job table established; image-based campaign information was not OCR'd.

SOURCE COMPOSITION: organizer campaign announcement + officially referred platform + exact enterprise identity + individual job/attachment conditions. Do not create one aggregated SASAC Position.

BINDING STATUS: publisher/platform referral established at research level; organizer-to-enterprise-to-job mapping unresolved.

BLOCKERS REMAINING: dynamic exact endpoints, enterprise identifiers, batch mapping, job/attachment completeness and approved access scope. URL fragment is a client route, not a production HTTP target identity.

PRODUCTION ADMISSION: EVIDENCE_BLOCKED. AUTHORIZATION CREATED: NO. CONTROLLED FIRST ACQUISITION: NOT_RUN.

CODE CHANGE REQUIRED: more than a small binding patch. DESIGN GAP: bounded dynamic multi-employer surface acquisition/selection and composition. NEXT ACTION: contract review for exact enterprise/job surfaces, reusing existing organization/position and composition authority.

## Actual implementation boundary inspection

- `lib/production-automation/production-adapter-registry.ts` registers only Zhenghan and Haier adapters. Both production source descriptors support HTML; no general production PDF adapter is registered.
- `lib/ingestion/domain/source-surface-composition.ts` already supports attachment-publication and attachment-to-position bindings with exact row/cell/page/span locators. This is reusable authority, not a PDF decoder.
- Generic fixture adapter advertises PDF support only for tests. Existing live-canary attachment/XLSX modules are not production parser capability.
- `lib/production-persistence/source-execution-request-plan.ts` requires GET, redirect DENY, query DENY and rejects query/fragment URLs. `continuous-request-gate.ts` independently rejects them. Junhe pagination therefore needs an explicit contract decision, not a hidden adapter workaround.
- `lib/application/source-admission/types.ts` already models third-party platforms, DOCUMENT/DYNAMIC structures, attachment endpoint purpose and access evidence. No new Registry/model is required to represent official referral.
- None of these gaps permits CandidateProfile filtering, fabrication of Position identity or COMPLETE Requirements, or negative eligibility inference. No production processor was invoked by this research.

## Result and next boundary

PHASE 2B BLOCKER CLOSURE = PARTIAL.

| Measure | Result |
| --- | ---: |
| Sources attempted | 5 |
| Newly approved | 0 |
| Still REVIEW_REQUIRED | 3 |
| Still EVIDENCE_BLOCKED | 2 |
| Conclusively ACQUISITION_UNSUPPORTED | 0 |
| New authorizations / controlled first acquisitions | 0 / 0 |
| New OpportunityCandidates / Positions / Presentation records | 0 / 0 / 0 |

For all five: LEGAL RELEVANCE / REQUIREMENT-RSV / ELIGIBILITY / PRESENTATION = NOT_RUN, not a negative conclusion. Research-visible vacancies are not counted as trusted materialized Opportunities/Positions.

The generic gaps are bounded dynamic content acquisition, bounded query pagination, and production provenance-preserving PDF extraction. Multi-employer/composition concepts already exist; missing concrete evidence and tested adapters must not be confused with a need for another authority.

PHASE 2 REVIEW COMMIT REMOTE = YES. SCHEDULER FIX PRESERVED = YES. SCHEDULE CHANGED = NO. MANUAL PRODUCTION SCHEDULER RUN = NO. SECOND BATCH STARTED = NO. SECOND CRAWLER INTRODUCED = NO. FORCE PUSH = NO.

Only this documentation is added. No production state, Continuous Authorization, Pages, Legacy, schedule, cadence or business rule is changed. Stop here for review of the smallest next capability contract; do not enter Phase 3.
