# Autonomous Source Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans after human approval. No implementation is authorized by this document.

**Goal:** 复用46历史来源建立可恢复、受预算和scope约束的候选发现层，只向现有准入owner交付审查包。

**Architecture:** 唯一DiscoveryRoot维护未授信候选目录；production SourceRegistry/Admission/Authorization完全不变。目录/Seed解析只产生观察、候选与proposal，不能调用production processors。先离线交付，再等待单独network scope批准。

**Tech Stack:** TypeScript、现有canonical hash/serialize、Git canonical JSON、现有测试工具。无DB、付费API、browser、A/C或新Scheduler。

## 文件级边界（预计，当前不创建这些实现文件）

- 新增 `lib/source-discovery/contracts.ts`：scope、event、三轴证据、candidate、review proposal契约。
- 新增 `lib/source-discovery/candidate-catalog.ts`：单一未授信catalog、revision/links/disposition、不可变验证。
- 新增 `lib/source-discovery/research-import.ts`：固定blob、defaults字段来源、deterministic46导入。
- 新增 `lib/source-discovery/discovery-budget.ts`：budget预占、request/response facts、cooldown/crash/revocation。
- 新增 `lib/source-discovery/discovery-root.ts`：唯一候选组合入口，默认offline，限定adapter capability。
- 新增 `lib/source-discovery/adapters/official-directory.ts`：已批准surface中的有限单位/链接观察，不提取业务岗位。
- 新增 `lib/source-discovery/admission-proposal.ts`：已有SourceAdmission字段的未批准proposal，不注册不issue。
- 新增 `lib/source-discovery/git-discovery-store.ts`：隔离namespace、CAS、collision/replay。
- 新增 `scripts/import-source-discovery-research.ts` 和 `scripts/run-source-discovery.ts`：显式fixedSHA/scope、dry/offline默认；无production creds与调度。
- 新增 `tests/source-discovery/` 下 contracts、import、budget、identity、failure、proposal、restoration、runner测试。
- 新增 `tests/architecture/source-discovery-boundary.test.ts`：actual import graph及禁写边界。
- 仅必要时修改 `package.json` 加offline命令；不修改已有生产命令。
- 后续批准迁移才生成 `discovery-state/`；本轮不迁移。

不修改现有Registry、Admission、ContinuousAuthorization、B、Trusted Chain、Source adapters、Scheduler、workflows、Pages、Legacy、production-state schema。若实施发现必须修改上述任何冻结模块，停下报告，不在此计划里扩大范围。

## Task 1 — Contracts、历史导入和身份

- [ ] 写失败测试：46项defaults正确合并、field origin保留、官方研究claim不升级、UNKNOWN不negative、ID稳定、重复幂等、冲突拒绝。
- [ ] 运行RED，再实现最小contracts/catalog/import；hash绑定原pool Git blob，不依赖wall-clock。
- [ ] 加集团/子公司、政府publisher/employer、third-partyhost/referral、不同query、入口变更与疑似重复关系测试。
- [ ] GREEN并审查仅新增Discovery路径；独立候选层commit（未来实施时）。

## Task 2 — Scope/budget与离线有限发现

- [ ] 写RED：无scope默认DENY、伪造/撤销scope拒绝、externalURL只排队、same-origin不继承、超budget保留frontier、cooldown/公平轮转。
- [ ] fixture mock transport验证request前预占、network failure、crash未知耗费、32总请求含retry、深度1、2MiB/16MiB限额和600秒终止。
- [ ] 加SSRF/DNS变化、userinfo/token/query泄漏、redirect不跟随、Cookie值不保存/重放、login/challenge停止测试。
- [ ] 实现runner和有限目录adapter；只使用测试fixture，无真实request或新增生产授权。
- [ ] 接口不接受production transport/grant/resolver；适配器只输出Observation；GREEN。

## Task 3 — Verification 与安全准入proposal

- [ ] RED覆盖三轴独立、不按综合分数、无year/legal保留、争议officiality不ready、岗位缺附件不被伪称完整。
- [ ] 从已有 SourceAdmission types引用契约；proposal不得包含自动APPROVED review、生产Organization ID新建或grant。
- [ ] fixtures通过现有validateSourceAdmission的review路径（可以合法构造REVIEW时）；不改变tier/third-party policy，也不调用register或issue。
- [ ] 明确Out-of-scope需要positive evidence与policy ref；初版自动construction exclusion保持关闭。
- [ ] GREEN并验证CandidateProfile、scoring、old API、Legacy imports = 0。

## Task 4 — Append-only store 与 fresh Process B

- [ ] RED覆盖canonical bytes、碰撞、序列缺口、错误parent、并发CAS、坏upstream、坏hash、未知schema、历史不同字段来源。
- [ ] 临时Git repo内Process A导入46、追加第47个fixture候选与失败观察，提交；独立Process B离线恢复相同canonical目录、IDs/revisions/hash。
- [ ] 模拟run abort和恢复，未完成request不会新增可用budget；保留历史观察，不伪造网络结果。
- [ ] 生产namespace、原pool/report blob对比完全一致，所有mutation仅discovery namespace；GREEN。

## Task 5 — 最终离线验收 / 实施停止点

- [ ] 测试基于批准目录fixture发现**不在46历史列表的新单位**，经同一Candidate→proposal流程；不得硬编码单位名模拟自主发现。
- [ ] unknown 2027/legal信号、PDF/JS、未授权外链均保留并有明确复核原因，无静默删除。
- [ ] runner与proposal无法创建生产Source/grant/Position/ReadModel；浏览器/LLM/OCR调用为0。
- [ ] 执行focused discovery tests、Architecture、Network Guard、TypeScript、git diff --check；不机械重跑全部业务回归。
- [ ] 独立审查trust boundary、real import graph、budget/SSRF、privacy、determinism、current recovery。
- [ ] 报告离线可用性与live execution gates；不创建Discovery Scheduler、不授权联网、不接production scheduler、不发布岗位。

## Live discovery 的后续人工 gate（不属于本轮实施授权）

明确directory/Seed exact surfaces与有限child语法、scope审批actor/expiry/revoke、policy和预算、独立writer权限及运行时间；批准后才能单次bounded discovery。随后所有Candidate只进入准入审查。全网搜索provider、动态A、PDF C、自动admission、第三方policy扩展分别不在本计划。

## 验收判断

离线候选发现机制可用 ≠ production acquisition可用 ≠ 新岗位已公开。交付指标为46研究记录无损迁移、至少1个未知单位fixture经同一链路发现、候选不误排、实际预算/权限可验证、fresh恢复稳定、production state零改动。不得用测试数量宣称全国自主发现已上线。
