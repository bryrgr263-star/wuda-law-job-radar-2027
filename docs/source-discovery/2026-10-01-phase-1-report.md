# Production Source Discovery Phase 1 — 2026-10-01

## Boundary and method

This is a **read-only candidate pool**, not Source Admission, Continuous Authorization, or Production Acquisition. The machine-readable pool is [`2026-10-01-candidate-pool.json`](./2026-10-01-candidate-pool.json). Resolve each effective record by shallow-merging `field_defaults` with its `sources` entry. `UNKNOWN`/`NOT_OBSERVED` mean not established, **not** a negative finding. `PRODUCTION_ADMISSION_CANDIDATE` is a recommendation, while every effective record has `production_admission_status = NOT_SUBMITTED`.

Discovery used search results as leads and checked the employer/government recruitment surface or official-domain endorsement before marking it official. A search engine's ability to index a page is **not** proof that the production acquisition gate can fetch it. `READ_ONLY_HTML_OBSERVED` means a public page was readable during this audit, not that exact-target admission, cookie/redirect policy, attachment binding, or repeated acquisition passed. No login, CAPTCHA, browser automation, third-party job-board acquisition, or production scheduler run was used. Already-authorized Zhenghan/Haier targets are excluded from net-new counts.

The pool is deduplicated by recruitment surface, not by parent corporate group. Different CRRC subsidiaries and different CAS institutes have independently maintained recruitment surfaces. Government portals are candidate publication surfaces, not assumed to be the original employing authority. Historical legal jobs demonstrate source potential, not a current legal vacancy. An engineering/construction name is never used as an exclusion rule.

## Counts

| Measure | Count | Interpretation |
| --- | ---: | --- |
| Distinct candidate sources / URLs | 46 | First-round research pool; no fixed quota |
| Official surface verified | 44 | Employer/group/government domain or documented official referral |
| Independent official backlink still missing | 2 | Jiangsu Tobacco third-party portal; China Railway portal ownership |
| Recruitment entry verified for next-step review | 40 | 21 entry-verified + 8 acquisition-testable + 11 admission candidates |
| Public HTML seen in read-only audit | 19 | **Not** production-gate validation |
| Recommended production admission candidates | 11 | None admitted or authorized |
| Review required | 6 | Includes the 2 not-yet-officially-endorsed surfaces |
| Explicitly acquisition unsupported | 0 | No unsupported claim without a production-gate test |
| Proven not official / out of scope | 0 / 0 | Uncertain items retained for review |
| Explicit 2027 campaign signal | 7 | Absence of signal does not remove a source |
| Legal-role/content signal | 11 | Includes older roles and law-firm career pages; not 11 current 2027 legal vacancies |

**By employer type:** central SOE 17; central SOE bank 2; subsidiary SOE 4; local SOE 2; research institute 6; government portal 6; tobacco system 3; law firm 6.

**By industry:** power 4; energy 3; petroleum 2; petrochemical 1; engineering 3; electronics 1; defense aerospace/electronics/shipbuilding 1 each; rail 3; telecom 1; postal 1; finance 2; research 6; public recruitment 6; tobacco 3; law 6; investment holding 1.

**By source type:** official recruitment platform 11; official recruitment column 18; official announcement 7; official government portal 8; official home recruitment section 1; unendorsed third-party recruitment platform 1.

## Candidate source inventory

`Y` = direct 2027 signal, `L` = current/unspecified-year legal-role signal, `H` = historical legal-role signal, `—` = not observed. `O` = employer/group official origin, `G` = government origin, `?` = official backlink unresolved. Monitoring `C` means a stable listing looks plausible but needs admission; `R` means stable entry/transport/authority requires review. The exact evidence, full fields, and reason for each row are in the pool JSON.

| ID | Unit / recruitment entry | Proof | 2027 | Legal | Stage | Monitor |
| --- | --- | --- | --- | --- | --- | --- |
| SD-001 | [中国华能集团](https://zhaopin.chng.com.cn/Home/) | O | Y | L | ENTRY_VERIFIED | R: dynamic |
| SD-002 | [中国大唐集团](https://zhaopin.china-cdt.com/zpgg_xyzp.html) | O | Y | — | ENTRY_VERIFIED | R: public fetch |
| SD-003 | [国家能源集团](https://zhaopin.chnenergy.com.cn/recTypeSerch?kinds=1&schType=2) | O | — | — | ADMISSION_CANDIDATE | C |
| SD-004 | [国家电网](https://zhaopin.sgcc.com.cn/sgcchr/static/unitInfo.html?level=3&obj_id=20308504) | O | — | — | ENTRY_VERIFIED | R: list locator |
| SD-005 | [南方电网](https://zhaopin.csg.cn/) | O | — | — | ENTRY_VERIFIED | R: list extraction |
| SD-006 | [中国石油](https://zhaopin.cnpc.com.cn/) | O: [集团佐证](https://trxf.cnpc.com.cn/content/h/content_44239.shtml) | — | — | ENTRY_VERIFIED | R: public access |
| SD-007 | [中国石化](https://job.sinopec.com/) | O: [集团成员佐证](https://trqi.sinopec.com/trqi/scec/zmyx/A059008002Gone1.shtml) | — | — | ENTRY_VERIFIED | R: dynamic |
| SD-008 | [中国海油](https://www.cnooc.com.cn/zyzx/) | O | — | — | ENTRY_VERIFIED | R: freshness |
| SD-009 | [中国三峡集团](https://www.ctg.com.cn/ctgam/rczp/xyzp/index.html) | O | — | — | ENTRY_VERIFIED | R: freshness |
| SD-010 | [中国能建](https://www.ceec.net.cn/art/2024/1/25/art_11057_2530435.html) | O | — | H: [法务合规例证](https://www.cggc1.ceec.net.cn/art/2025/9/15/art_13534_2521450.html) | ACQUISITION_TESTABLE | R: stable index |
| SD-011 | [中电建铁路建投](https://tl.powerchina.cn/col/col9380/art/2025/art_d00b0fed8cf44adc8a983b4e5ee9c6c1.html) | O | — | H | REVIEW_REQUIRED | R: stable index |
| SD-012 | [中国电子](https://career.cec.com.cn/) | O | — | — | ENTRY_VERIFIED | R: listing |
| SD-013 | [中国电科](https://www.cetc.com.cn/zgdk/1593022/1592495/2108992/index.html) | O | — | — | ACQUISITION_TESTABLE | R: stable index |
| SD-014 | [中国航发](https://www.aecc.cn/aecc/gggs/2026061315114976587/index.html) | O | — | — | ACQUISITION_TESTABLE | R: stable index |
| SD-015 | [中国船舶](https://www.cssc.net.cn/n135/n174/n203/index.html) | O | — | — | ENTRY_VERIFIED | R: current index |
| SD-016 | [中车长客](https://www.crrcgc.cc/ckgf/128_7635/128_7706/index.html) | O: [2027公告](https://www.crrcgc.cc/ckgf/2026-08/31/article_2026083119415164821.html) | Y | — | ADMISSION_CANDIDATE | C |
| SD-017 | [中车洛阳](https://www.crrcgc.cc/ly/26_1362/26_1676/index.html) | O: [2027公告](https://www.crrcgc.cc/ly/2026-09/04/article_2026090417584944575.html) | Y | — | ENTRY_VERIFIED | R: listing |
| SD-018 | [中国电信](https://wejob.chinatelecom.com.cn/wt/TELE/web/index) | O: [集团栏目](https://www.chinatelecom.com.cn/ct/zp/168330.html) | Y | L: [法务岗位](https://wejob.chinatelecom.com.cn/wt/TELE/web/index) | ENTRY_VERIFIED | R: dynamic |
| SD-019 | [中国邮政](https://www.chinapost.com.cn/cn/report/2609/1176-1.htm) | O | Y | — | ADMISSION_CANDIDATE | C: announcement |
| SD-020 | [中国银行](https://www.bank-of-china.com/aboutboc/bi4/) | O: [2027公告](https://www.bank-of-china.com/aboutboc/bi4/202609/t20260903_25689311.html) | Y | — | ADMISSION_CANDIDATE | C |
| SD-021 | [中国建设银行](https://job2.ccb.com/cn/job/anno_list.html?isImpAnno=1) | O | — | — | ENTRY_VERIFIED | R: listing |
| SD-022 | [中国铁路人才招聘网](https://rczp.china-railway.com.cn/) | ? | — | — | REVIEW_REQUIRED | R: independent endorsement |
| SD-023 | [中科院软件所](https://iscas.cas.cn/rcdw/rczp/index_1.html) | O | — | — | ADMISSION_CANDIDATE | C |
| SD-024 | [中科院过程工程所](https://ipe.cas.cn/rcdw/rczp/) | O | — | H: [历史法律工作](https://ipe.cas.cn/rcdw/rczp/202105/t20210519_6029406.html) | ENTRY_VERIFIED | R: freshness |
| SD-025 | [中科院文献情报中心](https://las.cas.cn/edu/rczp/) | O | — | — | ACQUISITION_TESTABLE | C |
| SD-026 | [中科院信息工程所](https://iie.cas.cn/zszpyztd/) | O | — | — | ACQUISITION_TESTABLE | C |
| SD-027 | [中科院青海盐湖所](https://www.isl.cas.cn/) | O | — | — | ENTRY_VERIFIED | R: exact section |
| SD-028 | [中科院计算所](https://www.ict.cas.cn/rczp/) | O | — | — | ENTRY_VERIFIED | C |
| SD-029 | [上海市国资委国企招聘](https://www.gzw.sh.gov.cn/shgzw_xxgk_cqzp/20260323/5983c4a5792d436aa704922ffd70ea33.html) | G | — | — | ACQUISITION_TESTABLE | R: category |
| SD-030 | [北京市国资委国企招聘](https://gzw.beijing.gov.cn/yggq/gqzp/) | G | — | — | ADMISSION_CANDIDATE | C: multi-employer |
| SD-031 | [深圳市国资委校园招聘](https://gzw.sz.gov.cn/gzrc/xyzp/index.html) | G | — | — | ADMISSION_CANDIDATE | C: multi-employer |
| SD-032 | [广东省国资委招聘公告](https://gzw.gd.gov.cn/gkmlpt/content/4/4512/post_4512222.html) | G | — | — | REVIEW_REQUIRED | R: category |
| SD-033 | [人社部事业单位招聘公告](https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/rcrs_4225/sydwrsgl/202603/t20260331_571316.html) | G | — | — | REVIEW_REQUIRED | R: category/attachment |
| SD-034 | [上海市人社局招聘公告](https://rsj.sh.gov.cn/tzpgg_17408/) | G | — | — | ENTRY_VERIFIED | R: multi-employer |
| SD-035 | [湖南烟草—省人事考试网公告](https://rst.hunan.gov.cn/rst/hnrsksw/c103104/sydw2026/202601/t20260119_33897105.html) | G | — | — | ACQUISITION_TESTABLE | R: campaign |
| SD-036 | [江苏烟草招聘平台](https://jsyc.ksbm.com/) | ? | — | — | REVIEW_REQUIRED | R: official backlink |
| SD-037 | [河北烟草—承德政府公告](https://www.chengde.gov.cn/art/2026/3/3/art_9943_1105528.html) | G | — | — | REVIEW_REQUIRED | R: employer origin |
| SD-038 | [中伦](https://www.zhonglun.com/career) | O | — | L | ENTRY_VERIFIED | R: pagination |
| SD-039 | [君合](https://www.junhe.com/careers) | O | — | L: [法律实习岗位](https://www.junhe.com/careers/locations/4) | ADMISSION_CANDIDATE | C |
| SD-040 | [锦天城](https://www.allbrightlaw.com/CN/09/79c7d99aeae4d666.aspx) | O | — | L: 实习生 | ADMISSION_CANDIDATE | C: announcement |
| SD-041 | [盈科](https://www.yingkelawyer.com/zxns/shzp/9634e618b09f2fbe.html) | O | — | L | ACQUISITION_TESTABLE | R: freshness |
| SD-042 | [德恒](https://www.dehenglaw.com/CN/Join/0009.aspx) | O | — | L | ADMISSION_CANDIDATE | C |
| SD-043 | [国浩](https://www.grandall.com.cn/shzp/list.aspx?add=321) | O | — | L | ENTRY_VERIFIED | R: list fetch |
| SD-044 | [北京国有资本运营管理有限公司](https://www.bscomc.com/jobList_26_page1.html) | O | — | — | ADMISSION_CANDIDATE | C |
| SD-045 | [浙江省建设投资集团](https://www.cnzgc.com/Job/List.aspx) | O | — | — | ENTRY_VERIFIED | R: dynamic |
| SD-046 | [四川发展兴欣钒](https://cfxn.sdholding.com/recruit/) | O | — | — | ENTRY_VERIFIED | R: direct fetch timeout |

## Recommended first admission batch — **not authorized now**

Five independent, public, official surfaces with useful coverage diversity: **SD-016 中车长客; SD-019 中国邮政; SD-020 中国银行; SD-039 君合; SD-031 深圳市国资委**. Each still requires its own exact target, ownership/authority, source-composition/attachment plan, read-only transport gate, cadence, network-policy, and Continuous Authorization review. No candidate may be directly copied into the production Source Registry or Scheduler from this document.

High-value **parallel feasibility queue**, not yet counted as admission candidates: **SD-001 华能** and **SD-018 中国电信** have direct 2027 and legal signals, but their dynamic listing access and exact-target semantics need review first. The known 2027 signal makes them urgent to assess, not safe to authorize by default.

## Open limits and next phase

- The public HTML observation for 19 rows does not establish cookie, redirect, browser, login, CAPTCHA, rate-limit, or attachment behavior. Those fields deliberately remain `UNKNOWN` rather than `NO`.
- Broad central platforms cover nationwide employers, but the first round does not exhaust provincial SOEs, all tobacco provinces, military subsidiaries, local law firms, or regional research institutes. Those are discovery coverage gaps, **not** evidence that the sources are absent.
- No third-party job-board lead is treated as Trusted Truth. The Jiangsu Tobacco portal and China Railway portal remain unendorsed candidates until independent official-domain evidence is found.
- None of the 46 rows is a newly authorized production source. The existing 2-source/3-target boundary, scheduler cadence, Trusted Chain, Pages, and Legacy Web are untouched.

**Phase 1 outcome: COMPLETE as a first-round candidate pool; Production Admission is a separate later decision.**
