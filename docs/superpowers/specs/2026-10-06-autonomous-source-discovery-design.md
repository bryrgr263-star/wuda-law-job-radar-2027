# Autonomous Source Discovery → Safe Admission

状态：DESIGN FOR REVIEW。仅设计，无实施、联网、授权、调度或部署。审计基线：`39704873cf8c2ea759fb8f943e7d44c7bb1c4836`。国家能源已知 1/2 授权及海尔待自然验证修复保持不变。

## 1. 当前资产与缺口

| 资产 / 实际 owner | 现状 | 本设计复用方式 |
| --- | --- | --- |
| `docs/source-discovery/2026-10-01-candidate-pool.json` | 历史研究 JSON；46条，必须 `field_defaults` 浅合并每条记录 | 导入为历史 Seed/Observation，不生成生产记录 |
| 同目录 Phase 1 report | 统计和方法说明；44官方、19公开HTML、11准入候选、6待审查；46均 NOT_SUBMITTED | 保存原文引用、Git blob、内容hash；研究断言与运行时验证分开 |
| Phase 2 first-batch / Phase 2B report | 五来源审查；Phase 2B结论3 REVIEW_REQUIRED、2 EVIDENCE_BLOCKED、0生产授权 | 导入后续证据修订，不能覆盖 Phase 1原始观察 |
| Phase 2C design/plan、`docs/phase-2c-capability-b-verification.md` | B已实现；A/C本任务不启动 | 引用能力边界；不修改 B或依据旧计划误认A/C已完成 |
| Capability prevalence check | 本 checkout 未找到独立版本化统计文件；不能从旧会话恢复数字 | 保留“未取得可审计统计附件”；不重新做46站网络统计，不阻塞设计 |
| `lib/ingestion/registry/source-registry.ts` | 唯一 Organization / Source / Endpoint owner | Candidate只能引用已存在ID，不能提前注册实体 |
| `lib/application/source-admission/types.ts`、`source-admission-register.ts` | 唯一正式准入；APPROVED / REJECTED / REVIEW；tier与access evidence校验 | 输出未批准 review proposal，沿用既有 register/revision validator |
| `continuous-acquisition.ts`、`query-authorization.ts` | 独立 exact-target grant、revocation、cadence、reservation；B支持finite query | Discovery不能调用 grant、RESERVE或生产请求gate |
| `scheduler-source-enumeration.ts` | 枚举已提交grant并校验source bindings，不从研究pool枚举 | 不接入 Candidate，不修改 Scheduler |
| `git-source-registry-persistence.ts`、`contracts.ts` | 生产Source版本、canonical hash、append-only历史与恢复 | 准入后仍使用；候选不可塞入其 PRODUCTION artifact union |
| Raw / Snapshot / ExtractedRecord及root restoration | 正式生产采集与可信重放 | Discovery观察不是这些生产事实，不注入 trusted registry |
| `source-discovery-support.ts` | 已有SOV的重复发现证明，不是互联网来源发现 | 名称相似不代表可用作 Candidate authority；原契约完全不动 |

全库 `lib/scripts/tests` 未检出已实施的 SourceDiscoveryCandidate / DiscoveryObservation / SeedRegistry / DiscoveryRun owner。现有 Phase 2C A 的 EndpointDiscoveryEvidence 是 deferred 设计，负责已授权页面内动态端点线索，不是本任务的全国单位发现，也不实施它。

历史pool文件SHA256：`a281d34433b17a6b074fc263cf1cc5f40d651d9e053514d187a52750854ed092`。统计来自离线解析，未重新访问46站。URL和文字摘要可复用；没有原始bytes、locator、独立ownership链的结论只能保留为 IMPORTED_RESEARCH_ASSERTION，不能宣称 DOCUMENT_VERIFIED 或 fresh transport evidence。

## 2. 方案比较与选择

1. 搜索引擎全网搜索：覆盖可能较大，但免费稳定API和使用权限未建立；不选，不自动抓搜索引擎HTML，也不把本次助手web能力当生产接口。
2. 有限官方目录 + 已知Seed + 一层获批页面：选择。可从已批准央企/国资/院所/政府目录发现用户未提供过的单位名称；范围、证据和预算可追踪。
3. 只刷新46个Seed：适合作为启动集，但不能发现新单位，因此只是选择方案的一个输入，不作为自主发现已完成的依据。

实现顺序先离线迁移和有限发现runner；官方目录exact targets与访问策略须另行批准，未来才可联网。不在本轮提出或访问新host。

## 3. 唯一依赖方向与owner

`approved DiscoveryScope + historical Seeds → Discovery Run → Observation → Candidate revision → Verification → AdmissionReviewProposal → existing SourceAdmission/SourceRegistry → separately approved ContinuousAuthorization → existing production acquisition → existing Trusted Chain → existing public presentation`

Discovery拥有“候选证据目录”，不是第二套 Source Registry。它不得创建 production source identity、Position、RecallDisposition、Relevance assessment、Requirement、Candidate Evidence、Eligibility或展示状态。这里的 Candidate Evidence 指**来源候选观察**，禁止沿用候选人证据 issuance/branding。

新增 DiscoveryRoot只处理未授信记录与发现网络预算。Admission bridge只输出审查包；真正APPROVED、注册Source及授权仍由现有owner与独立审批完成。自动提出审查包不等于自动批准。未来自动准入不在本实施范围。

## 4. 最小数据契约（全部新字段均只属于 DISCOVERY scope）

所有记录含 `schema_version, record_id, revision, supersedes_id, actor, observed_at, provenance_kind, upstream_ids/hashes, content_hash, integrity_hash`。SHA256是完整性校验，不是签名；Git提交是版本链，不自动提供官方性证明。

| Record | 最少字段与身份 |
| --- | --- |
| DiscoveryScopeRevision | scope_id、revision、ACTIVE/REVOKED、effective/expiry、批准actor/ref、有限allowed surfaces与预算、policy hash；不含production grant |
| DiscoverySeed | seed_id、来源研究ID、单位name claim、官方域名/入口claims、已有Organization/Source ID可选引用、历史观察refs、last verification、next due；不注册新Organization |
| DiscoveryRun | run_id、固定input Git SHA、scope revision/hash、开始/结束、预算账本、request intents/results、未访问frontier、cursor、COMPLETE/PARTIAL/ABORTED/FAILED；run失败不覆盖Candidate |
| DiscoveryObservation | observation_id、seed/run/parent ref、观察exact URL、发现URL的安全形式、locator、文本摘要/quote、response安全事实、retrieval状态、bytes hash（如实际取得）、时间、observed/derived/imported区分 |
| SourceDiscoveryCandidate | candidate_id、publisher/employer/recruitment owner/platform分开的claims、organization refs或未解决claim、surface kind、endpoint proposals、证据refs、三轴结果、current disposition、due time |
| SourceVerification | 绑定candidate revision和scope；每项检查结果、rule版本、实际引用的观察hash、reviewer/actor；与SourceAdmission access decision不同 |
| AdmissionReviewProposal | proposal_id、candidate revision/hash、精确identity/target/method/purpose、composition边界、access evidence、adapter可用性、missing evidence、现有准入字段映射；无 APPROVED review、无grant |

三轴禁止综合评分：
- officiality：VERIFIED / LIKELY / UNRESOLVED / CONFLICTING / INSUFFICIENT。VERIFIED必须有定位清晰且具有相应发布权限的独立official endorsement，不凭域名形状或平台自称。
- recruitment/year：显式批次claims（原文、年、届别解释、日期、announcement定位）和 NOT_OBSERVED / OBSERVED / AMBIGUOUS / CONFLICTING。`27届`缺上下文为AMBIGUOUS；发布时间不是招聘年。
- legal discovery signal：OBSERVED / NOT_OBSERVED / AMBIGUOUS / CONFLICTING，保留文字及位置。只用于来源研究队列分组，不生成position-level RELEVANT/NOT_RELEVANT；风控/合同泛称不能直接等同法律就业。

三轴可同时不同；没有2027或法律信号不禁止官方入口进入审查，不删除、不生成负面业务结论。准入审查就绪不意味着已发现具体2027岗位。

## 5. Identity、去重与变化

组织身份沿用现有Organization引用；未知单位仅保存claim ID，名称相似不合并法人。Source candidate按“发布主体claim + 招聘owner claim + hosting surface +用途”形成候选身份，不使用URL=Source。集团、子企业、政府发布面、外部托管平台可分别保留。

Seed导入ID为规范化 `{migration_version, research_id, research_blob_hash}` 的hash；Candidate初始ID由稳定origin observation ID派生。一旦创建不因名称/URL变化改ID。新观察exactURL/主体claims一致且无冲突则追加revision；域名相同但主体不同不合并。不确定同一来源时保留两个并写可能等价link，后续有证据才追加MERGE_RELATION；历史ID与观察均保留。

Endpoint identity沿用精确URL规则：保留path大小写、显式query与业务参数，不随意排序/去除参数；B有限query canonicalizer可作为纯校验被调用，不修改其规则。拒绝userinfo、fragment、非HTTPS、非标准port、IP/private/reserved地址、敏感query。拒绝不能安全持久化的URL只保留redacted文本/hash及原因，不访问。安全网络地址在DNS解析和连接时重复检查；平台DNS rebinding或无法核验则阻断。

Observation ID绑定run、parent、ordinal和exactURL/hash；重复相同record ID + bytes幂等，不同bytes collision。跨run同URL是新观察而非覆盖。入口变化追加关系并使旧verification过期，不能自动搬迁生产授权。

## 6. 网络权限与有限预算

DiscoveryScope是独立的、明确获批/可撤销的**发现权限**，不是ContinuousAuthorization替代品。默认DENY，无获批scope时只允许离线处理。预算不能赋予访问权。

只请求scope列出的exact directory/seed入口；允许一层子页面仅在该scope预先限定origin、有限path语法、用途及数量时成立。即使same-origin也不自动可访问。未在scope的URL只进入待核验frontier。外链origin永不自动授予请求权；需要另行scope修订。每个request发送前检查scope版本、revocation、预算、URL、DNS和cooldown，发送后有独立事实；中途撤销则停止并保存未请求项，不假造observation。

GET、credentials omit、无Cookie jar/replay、无token、无login、无browser/eval、无challenge bypass。响应Cookie只保留布尔并丢弃值。redirect depth=0，不跟随；Location/Link不得原值入Git，安全可表示目标才记录为未访问proposal。不继承production cookie/authorization对象。Production transport入口需要正式grant，不能直接拿来发现未授权URL；未来发现adapter实现只解析批准的目录/HTML链接和证据摘要，不采职位、不运行业务判断。

初始拟定硬预算（须人工批准后才生效）：每run最多10个Seed/单位、每单位2入口、最多32次请求（含重试）、32个成功页面、40个candidate URL、最多8个已批准origin、深度1、600秒、单响应2MiB、总response 16MiB、每失败最多1次retry。达到任一限制即PARTIAL，frontier保留。预算先在append-only ledger预占，发生crash的未知request耗费预算，不退还来追加请求。

相同Seed正常cooldown72小时；临时网络失败至少24小时，按连续失败逐次增加到7天，禁止紧密重试。轮转队列按due time和稳定ID排序；至少30%处理额留给到期的缺信号/未知项，避免正信号来源垄断。无需未来可能能力A/C才能保留Candidate；JS/PDF标记证据阻塞。

## 7. Disposition / Failure Matrix

Disposition：PENDING_VERIFICATION、REVIEW_REQUIRED、EVIDENCE_BLOCKED、ADMISSION_REVIEW_READY、OUT_OF_SCOPE。DISCOVERED是观察事件而非第二套业务状态。网络run状态与candidate disposition分开。

| 事件 | 记录 / 当前处理 | 禁止推导 |
| --- | --- | --- |
| reset/timeout/DNS/5xx | TEMPORARY_FAILURE、cooldown；保留上一验证及新失败事实 | 不支持、不相关、删除 |
| 403/login/CAPTCHA | ACCESS_BLOCKED，EVIDENCE_BLOCKED；不重试绕过 | 资格不符 |
| 404/source disappeared | UNAVAILABLE_OBSERVED、待复查；原证据不消失 | 永久不存在 |
| JS shell/PDF/Word/Excel/未知附件 | UNSUPPORTED_WITH_CURRENT_CAPABILITY，保留locator与composition缺口 | EMPTY、负面条件 |
| redirect | REDIRECT_NOT_FOLLOWED，target待独立审查 | owner继承、自动request |
| third-party host | platform/owner/employer分开；需要official referral且现有准入policy仍可拒绝 | 平台=单位、转介=授权 |
| official conflict / employer binding缺失 | REVIEW_REQUIRED；没有单一可信主体则不能ready | 凭域名自动官方 |
| year/legal未观察 | PENDING_VERIFICATION、轮转cooldown | 永久排除 |
| duplicate | 新observation关联现有Candidate；不重复建生产Source | 丢失发现历史 |
| changed entry | revision + previous relation、旧verification过期 | grant自动迁移 |
| 完整scope/身份/access/known adapter证据 | ADMISSION_REVIEW_READY；只生成proposal | APPROVED、grant、Position |
| 明确超出产品范围 | OUT_OF_SCOPE + policy版本 + positive evidence + reviewer；仍保留记录 | 模糊名称排除 |
| budget/revocation/crash | run PARTIAL/ABORTED，未访问项保留 | 假造请求或空结果 |

建筑施工排除仅能引用已经批准且适用的policy及直接业务证据；本审计未确认可直接消费的source级自动exclusion owner，因此初版自动排除关闭，交人工审查，不调用Legacy关键词规则。

## 8. 安全准入 handoff

READY要求官方来源/发布权限明确、主体/endpoint/purpose具体、scope有限、无未解决冲突、reading不依赖login/captcha、已知adapter及composition缺口明确。职位级附件尚未完整不自动拒绝有价值的官方入口，但不能伪称完整岗位资料。

桥接已有字段：officiality evidence→SourceAdmissionEvidence OTHER/ENDPOINT_INSPECTION（不伪造ROBOTS/TERMS ALLOWED）；endpoint→RecruitmentEndpoint draft；owner claim→待解析Organization reference；verification→review rationale draft。只有现有owner的审查和批准才注册/持久化生产Source。

`HUMAN_APPROVED_CONTINUOUS_SCOPE`要求明确APPROVED review与exact scopes；Discovery不能补造该review。现有普通THIRD_PARTY_PLATFORM路径强制D/REJECTED，human continuous分支另有校验；本方案不利用分支绕过该限制。第三方线索仍可保留，但未经单独policy审批不得自动接入。未来自动admission/第三方policy扩展需要独立提案，非本计划。

## 9. 46来源迁移与持久化恢复

不改原pool/report。固定Git SHA、原Git blob/hash、migration版本；浅合并defaults，但同时保存显式字段/继承字段来源。按SD-ID稳定排序，导入46 Seed和至少46历史Observation。`VERIFIED_OFFICIAL_ORIGIN`作为历史研究claim保留，不转为新的runtime VERIFIED；NOT_OBSERVED不是negative。Phase2/2B追加历史review refs，不覆写，不自动把stage映射生产准入。已生产注册的来源可显式link到现有artifact，但不创建grant或重新研究。

使用隔离 `discovery-state/` append-only canonical JSON事件、evidence refs与manifest；非production artifact union，非第二套Source registry。敏感值只用于拒绝/脱敏，不能先保存到Git后再删除。默认只存安全短quote/locator与hash，不默认提交完整外部HTML/个人联系人材料。内容hash没有bytes不能称为可重放Raw；缺quote/bytes时保留reconstruction limit。

canonical serialization使用既有canonicalHash/Serialize，新增排序固定ASCII，时间来自导入源日期或固化run事件，不用恢复wall clock。sameID/samebytes幂等、differentbytes拒绝；head绑定parent，compare-and-swap普通ff提交。候选state写者权限与生产授权/部署权限分离；初期run离线验证，未来只准写discovery namespace。失败不删除last-known evidence。

Fresh Discovery Process B从固定commit读取schema、序列、hash、revision与upstream refs，再重建**未授信目录**；禁止调用生产bootstrap来branding候选。恢复不联网，也不需要生产raw/journal。现有 production Process B保持不变；迁移前后生产namespace字节必须相同。

## 10. 零成本与产品回答

1. 不输入单位名称也能发现：未来批准的官方目录可发现新单位，Seed中的获批链接可发现新招聘入口。只做46固定URL刷新不算此目标达成。
2. 零成本只支持有限公开目录/HTML面；没有免费无限搜索保证，没有全国完整性/实时性承诺。GitHub额度和可用性可能限制运行；本轮不依赖在线价格或额度假设。
3. 高度自动化：结构稳定、访问允许的官方目录、静态招聘栏目及明确公告引用；有限query沿用B的纯contract校验。
4. 人工审查：ownership冲突、第三方托管/政府转载owner、多单位、动态/附件、access policy与新增origin审批。
5. 保留缺2027/法律信号、动态及解析失败项；轮转和明确复核记录防漏，不声称零漏召回。
6. publisher、employer、recruitment owner、hosting platform独立claims，平台主体不得替代雇主。
7. scope先批准、请求前gate、深度/预算/cooldown、external frontier不自动请求，杜绝无限扩张。
8. 只输出review proposal，禁止写生产注册/授权/业务结果；Architecture测试验证实际import与mutation路径。
9. 46来源作为历史Seed导入，不需重新联网，已验证assertion保留研究provenance但不升级。
10. 第47/48/100来源通过同一Candidate事件与revision机制进入，无第二个临时pool系统。

## 11. Readiness 与真正阻断

ARCHITECTURE / IMPLEMENTATION PLAN READY FOR HUMAN REVIEW。无须修改Trusted Chain业务模型，现有Admission/Authorization owner可复用。未启动implementation。

离线实现无结构性blocker。Live discovery尚有明确execution gates：获批目录/Seed exact surfaces、发现专用scope及预算、访问政策核验、写入权限隔离和人工design approval。不存在可用免费生产搜索provider的证明；不以此虚构自动全网搜索能力。Capability prevalence独立附件未取得属于审计材料限制，不阻止最小离线实现。

禁止在本轮建立Discovery Scheduler；未来它与production scheduler独立权限、队列、cadence，不共享“发现即采集”。不改国家能源断点、海尔修复、B、A/C、Pages、Legacy或任何production history。
