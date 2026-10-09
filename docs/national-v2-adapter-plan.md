# Bounded National v2 adapter step

Write set: original production-source file, dedicated adapter tests, this note only. No registry/root/persistence/composition changes, network, grants, commit or push. Parent owns production Process B session32916.

1. Pin current v1 synthetic canonical output bytes for both jobs before refactoring.
2. RED: explicit v2 emitter requires ordinary complete retained references and never claims project, year, dates or campaign completeness from references alone.
3. Extract one detail parser preserving v1 checks/error order/output; introduce explicit v2 adapter without registering it.
4. Run dedicated tests, existing lightweight v1 tests, foundation regression, TypeScript and diff checks.

Ruling: references alone do not prove a campaign heading/year or qualification. This bounded detail emitter leaves those claims absent. Root-verified campaign enrichment and composition remain integration prerequisites; the current complete v2 foundation gate must reject this incomplete output rather than silently relax its claims contract.

Verification completed on 2026-10-09 at HEAD 2f560b6: 84/84 dedicated adapter, foundation and architecture focused tests; 3/3 existing lightweight v1 tests; TypeScript noEmit/incremental=false exit 0; diff check exit 0. Both synthetic job canonical-output SHA256 baselines were recorded before refactoring and match after refactoring. RED was observed for the missing explicit v2 adapter before implementation. Constructor-reference negatives initially passed only because the class was absent; their post-implementation runs exercise actual shape validation. A completeness test initially supplied an incomplete test input and was corrected to include snapshots/extraction_errors, without changing production behavior.

Implementation: one shared detail parser, unchanged v1 project-binding behavior and record emitter, explicit unregistered Chnenergy2027CampaignHtmlAdapter. Reference objects are defensively copied, their exact shape and three-surface separation are checked, but they are never treated as trusted evidence. V2 preserves detail requirements and returns PARTIAL, not COMPLETE, even with two records. It emits no project/year/batch/context/publication/deadline claim solely from references.

Remaining integration (parent-owned): valid captured campaign/member receipts persisted through existing repositories; root reader and verified campaign-derived enrichment before final gate; explicit production adapter selection/registration without silent v1 replacement; cross-surface general-condition composition and completeness; full offline integrated issuance/replay validation. Actual production historical v1 byte compatibility is not established by these synthetic baselines. Parent reports separate a884 Process B exit 0, 240.331s and four-model canonical equality; this step did not rerun or independently collect that process.

Write set remains exactly three files. No network, grants, commit/push, root/registry/persistence/composition changes or heavy production restore.

Parent collection: the narrower adapter/foundation/architecture/Network Guard run passed 79/79, followed by TypeScript and diff checks. Independent final review found no blocking issue in this bounded adapter step and separately passed 10 adapter plus 3 lightweight v1 tests. An accidentally selected larger integration test was not completed by the read-only reviewer; it is not counted as a production restoration pass. The existing production resolver still selects v1, and no supporting captures or new public positions were created by this step.
