# Versioned Executability Baseline — 134-entry audit

## Boundary and decision

This section records the original audit state, before the subsequently approved
TEST_ONLY portability work. See fresh-clone-historical-evidence-portability.md for
the later selective packaging and verification gate; the original inventory and
findings below are preserved as history, not a current-state readiness claim.

Final audit outcome: CONSOLIDATION COMMIT PAUSED. Source import closure is complete, but nine existing tests depend on ignored/unversioned archived outputs, including a manifest-derived absolute original-checkout raw locator. See the separate verification/blocker report. No complete or fresh-clone VERIFIED baseline is claimed.

This audit covers exactly the original 23 modified and 111 untracked entries at parent `7de0554d1fb23db8453376099f165fd4d0af33ee`, branch `codex/ingestion-foundation`. It does not modify any verified business contract. The authorized operation is consolidation/versionization, not Scheduler completion or deployment.

All 134 entries are preserved and proposed for an explicit consolidation commit. Optional backends, historical Canary tooling and diagnostic evidence are versioned as references, not activated as production. No DELETE classification exists. No logs, cache, credentials, local state repositories or synthetic runtime outputs are included. New audit documents are supplemental, outside the original 134-entry denominator.

## Categories

- A. REQUIRED_PRODUCTION: 22
- B. REQUIRED_RUNTIME_SUPPORT: 21
- C. REQUIRED_TEST: 61
- D. REQUIRED_ARCHITECTURE_GUARD: 3
- E. REQUIRED_DOCUMENTATION: 9
- F. OPTIONAL_REFERENCE: 17
- G. LEGACY_REFERENCE_ONLY: 0
- H. NOT_YET_SAFE_TO_DELETE: 1

G has zero original dirty entries: frozen old crawler/scoring/sync/jobs/API/workflow code already exists in tracked history, is not changed, and is not promoted into the new chain. H preserves an independent historical re-observation CLI with no incoming import; lack of an importer is not deletion authorization.

## Dependency evidence

The TypeScript AST probe follows static import/export, import-type and literal import()/require(), resolves relative and alias dependencies using current tsconfig, and includes barrel re-exports. Seeds:
- Production/route closure: zero-cost root, trusted-chain root, read API runtime and the existing Presentation route.
- Test closure: every TypeScript test/helper under tests.
- Guard closure: architecture, Network Guard and phase-1 CI test seeds.

Results: production/route closure 102 files; test closure 260; guard closure 84. No missing imports in these closures. No production-closure import into old business code, old jobs API, Preview, Canary orchestration or Web business modules.

Whole-repository inventory found separate non-closure exceptions: two CSS imports resolve as existing assets, not TS modules, and four unresolved imports inside excluded historical experiments. They are not production/test/guard closure failures and are not repaired here.

A closure is compile/import reachability, not activation. The existing Presentation API barrel re-exports Shadow runtime; persistence barrels export PostgreSQL/Supabase alternatives. These must remain available for current exports/tests, but the zero-cost root does not select them as authority. The existing route still requires its explicit reader configuration; this consolidation does not wire a Git-backed public deployment or Web.

Literal asset references cover migration and fixture readers; schema and synthetic fixture files are retained even though they are not TS graph nodes. The JSON inventory provides complete incoming import and exact literal-reference lists for every original dirty entry. This is not a complete filesystem read dependency closure: separate discovery found ignored outputs used by nine existing tests. Those inputs are not included in the 134-entry dirty inventory.

## Canary separation

The 33 Canary files are not Scheduler production dependencies. Site-bound source modules contain reusable capability candidates but are not a generic Scheduler contract. Dedicated runner/CLI files remain CANARY_ONLY_ORCHESTRATION; trusted-run/test helper modules remain CANARY_TEST_SUPPORT; blocker/re-observation tools remain DIAGNOSTIC_ONLY. None occur in the production/route dependency closure.

No new REAL_SOURCE_FIXTURE is invented. Existing real acquisition outputs stay outside source control; the listed synthetic HTML fixture is explicitly test-only. Source adapters may later be reviewed for reuse without promoting dedicated Canary orchestration.

## Safety review

- Executable dirty source has no hard-coded local user filesystem path detected.
- The original worktree's ignored node_modules is a local junction to the old checkout's installed packages. This is not a business import edge, but local test success cannot prove dependency reproducibility. Fresh-clone locked installation must create its own dependency tree, without copying or linking that junction.
- Absolute paths in the prior V2 verification document are historical evidence pointers, not runtime dependencies; retained unchanged.
- No private-key blocks, GitHub access-token literals or credential-bearing PostgreSQL URLs detected in the original 134 entries.
- Environment-variable references accept deployment configuration; no environment files or secrets are staged.
- Git content filtering may normalize LF/CRLF; existing business content is not edited to clean the worktree.
- Existing historical failure remains PRE-EXISTING BASELINE FAILURE: source-occurrence-materializer-parity test at line 434, assertion 439. It must be run and reported, not hidden.
- P1 deterministic eligibility remains reference/regression only; Trusted Position-Bound Eligibility is unchanged as authoritative production owner.
- Continuous authorization remains BLOCKED until a separately approved additive contract is implemented.

## Complete original-entry matrix

P/T/G denotes membership in production-import / test-import / guard-import closures. Category is the preservation/versionization role, not a production readiness claim.

| # | Status | File | Category | P/T/G | Canary subtype | Reference evidence | Decision |
|---|---|---|---|---|---|---|---|
| 1 | M | `lib/ingestion/domain/index.ts` | B | yes/yes/yes | - | `lib/ingestion/adapters/contract.ts`, `lib/ingestion/adapters/fixture-adapter.ts`, `lib/ingestion/canonicalization/conservative-canonicalizer.ts` (+45; complete lists in JSON) | PRESERVE / VERSION |
| 2 | M | `lib/ingestion/domain/primitives.ts` | B | yes/yes/yes | - | `lib/ingestion/domain/eligibility.ts`, `lib/ingestion/domain/index.ts`, `lib/ingestion/domain/opportunity.ts` (+8; complete lists in JSON) | PRESERVE / VERSION |
| 3 | M | `lib/ingestion/domain/requirements.ts` | A | yes/yes/yes | - | `lib/ingestion/domain/eligibility.ts`, `lib/ingestion/domain/index.ts`, `lib/ingestion/domain/relevance.ts` (+2; complete lists in JSON) | PRESERVE / VERSION |
| 4 | M | `lib/ingestion/normalization/index.ts` | B | yes/yes/yes | - | `lib/ingestion/index.ts`, `lib/ingestion/pipeline/approved-requirement-projector.ts`, `lib/ingestion/pipeline/legal-employment-relevance.ts` (+12; complete lists in JSON) | PRESERVE / VERSION |
| 5 | M | `lib/ingestion/normalization/trusted-source-occurrence-registry.ts` | A | yes/yes/yes | - | `lib/ingestion/normalization/index.ts`, `lib/ingestion/normalization/source-discovery-support.ts`, `lib/ingestion/pipeline/position-bound-source-composition.ts` (+1; complete lists in JSON) | PRESERVE / VERSION |
| 6 | M | `lib/ingestion/persistence/repositories.ts` | B | yes/yes/yes | - | `lib/ingestion/persistence/index.ts`, `lib/ingestion/persistence/sqlite-shadow-persistence.ts`, `tests/domain/domain-types.test.ts` | PRESERVE / VERSION |
| 7 | M | `lib/ingestion/persistence/sqlite-shadow-persistence.ts` | B | yes/yes/yes | - | `lib/ingestion/persistence/index.ts` | PRESERVE / VERSION |
| 8 | M | `lib/ingestion/pipeline/approved-requirement-projector.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/trusted-requirement-projection.ts` | PRESERVE / VERSION |
| 9 | M | `lib/ingestion/pipeline/index.ts` | B | yes/yes/yes | - | `lib/ingestion/index.ts`, `tests/adapters/adapter-contract-harness.ts`, `tests/p2-04/ntsc-official-html-adapter.test.ts` | PRESERVE / VERSION |
| 10 | M | `lib/ingestion/pipeline/trusted-artifact-chain.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/index.ts`, `lib/ingestion/pipeline/presentation-decision.ts`, `lib/ingestion/pipeline/trusted-chain-composition-root.ts` | PRESERVE / VERSION |
| 11 | M | `lib/ingestion/pipeline/trusted-candidate-evidence.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/index.ts`, `lib/ingestion/pipeline/trusted-artifact-chain.ts`, `lib/ingestion/pipeline/trusted-chain-composition-root.ts` | PRESERVE / VERSION |
| 12 | M | `lib/ingestion/registry/source-registry.ts` | A | yes/yes/yes | - | `lib/ingestion/registry/index.ts` | PRESERVE / VERSION |
| 13 | M | `lib/ingestion/requirements/deterministic-requirement-parser.ts` | A | yes/yes/yes | - | `lib/ingestion/requirements/index.ts`, `tests/requirements/p1-cr9-minimal-domain-extension.test.ts` | PRESERVE / VERSION |
| 14 | M | `package.json` | B | no/no/no | - | `tests/ci/phase-1-ci.test.ts` | PRESERVE / VERSION |
| 15 | M | `pnpm-lock.yaml` | B | no/no/no | - | Frozen dependency install | PRESERVE / VERSION |
| 16 | M | `tests/architecture/ingestion-boundary.test.ts` | D | no/yes/yes | - | Node test discovery / fixture | PRESERVE / VERSION |
| 17 | M | `tests/integration/phase-1-pipeline.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 18 | M | `tests/persistence/shadow-migration.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 19 | M | `tests/persistence/shadow-test-database.ts` | C | no/yes/no | - | `tests/integration/phase-1-pipeline.test.ts`, `tests/p2-legal-08b/target-source-composition.test.ts`, `tests/persistence/opportunity-recall-shadow.test.ts` (+5; complete lists in JSON) | PRESERVE / VERSION |
| 20 | M | `tests/pipeline/approved-requirement-projection-coverage.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 21 | M | `tests/pipeline/position-bound-phase-fixture.ts` | C | no/yes/no | - | `tests/normalization/source-discovery-support.test.ts`, `tests/pipeline/approved-requirement-projection-coverage.test.ts`, `tests/pipeline/legal-employment-relevance.test.ts` (+9; complete lists in JSON) | PRESERVE / VERSION |
| 22 | M | `tests/pipeline/trusted-candidate-evidence.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 23 | M | `tests/requirements/requirement-parser.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 24 | U | `app/api/presentation/v1/[...segments]/route.ts` | A | yes/no/no | - | `tests/architecture/ingestion-boundary.test.ts` | PRESERVE / VERSION |
| 25 | U | `docs/authoritative-current-presentation-identity-v2-design.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 26 | U | `docs/authoritative-current-presentation-identity-v2-verification.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 27 | U | `docs/p2-legal-08b-architecture-alignment-requirementset-migration.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 28 | U | `docs/p2-legal-08b-eligibility-business-rules.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 29 | U | `docs/production-persistence-design.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 30 | U | `docs/production-persistence-phase-1-recovery.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 31 | U | `docs/scheduler-prerequisite-identity-probe.md` | F | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 32 | U | `docs/zero-cost-git-persistence-layout.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 33 | U | `docs/zero-cost-git-raw-boundary.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 34 | U | `docs/zero-cost-production-composition-root.md` | E | no/no/no | - | Design/verification evidence | PRESERVE / VERSION |
| 35 | U | `fixtures/p2-04/ntsc-talent-list.synthetic.html` | C | no/no/no | - | `tests/p2-04/ntsc-official-html-adapter.test.ts` | PRESERVE / VERSION |
| 36 | U | `lib/ingestion/domain/presentation.ts` | A | yes/yes/yes | - | `lib/ingestion/domain/index.ts`, `lib/ingestion/persistence/sqlite-shadow-persistence.ts`, `lib/production-persistence/git-append-only-execution-store.ts` (+1; complete lists in JSON) | PRESERVE / VERSION |
| 37 | U | `lib/ingestion/normalization/source-discovery-support.ts` | A | yes/yes/yes | - | `lib/ingestion/normalization/index.ts`, `lib/ingestion/normalization/trusted-source-occurrence-registry.ts`, `lib/ingestion/pipeline/trusted-chain-composition-root.ts` (+4; complete lists in JSON) | PRESERVE / VERSION |
| 38 | U | `lib/ingestion/pipeline/presentation-decision.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/index.ts`, `lib/ingestion/pipeline/presentation-persistence.ts`, `lib/ingestion/pipeline/presentation-read-model.ts` (+2; complete lists in JSON) | PRESERVE / VERSION |
| 39 | U | `lib/ingestion/pipeline/presentation-persistence.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/index.ts`, `lib/production-persistence/git-append-only-execution-store.ts`, `tests/pipeline/presentation-decision.test.ts` (+2; complete lists in JSON) | PRESERVE / VERSION |
| 40 | U | `lib/ingestion/pipeline/presentation-read-model.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/index.ts`, `lib/ingestion/pipeline/presentation-persistence.ts`, `lib/ingestion/pipeline/trusted-chain-composition-root.ts` | PRESERVE / VERSION |
| 41 | U | `lib/ingestion/pipeline/presentation-semantic-projection.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/presentation-decision.ts`, `lib/ingestion/pipeline/presentation-read-model.ts`, `lib/ingestion/pipeline/trusted-chain-composition-root.ts` (+2; complete lists in JSON) | PRESERVE / VERSION |
| 42 | U | `lib/ingestion/pipeline/trusted-chain-composition-root.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/index.ts`, `tests/architecture/ingestion-boundary.test.ts` | PRESERVE / VERSION |
| 43 | U | `lib/ingestion/pipeline/trusted-chain-restoration.ts` | A | yes/yes/yes | - | `lib/ingestion/pipeline/index.ts`, `lib/ingestion/pipeline/trusted-chain-composition-root.ts`, `tests/architecture/ingestion-boundary.test.ts` | PRESERVE / VERSION |
| 44 | U | `lib/live-canary/p2-04/beijing-first-live-canary.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-04/run-beijing-first-live-canary.ts`, `tests/p2-04/beijing-first-live-canary.test.ts` | PRESERVE / VERSION |
| 45 | U | `lib/live-canary/p2-04/index.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `tests/p2-04/ntsc-official-html-adapter.test.ts`, `tests/adapters/adapter-contract-harness.ts` | PRESERVE / VERSION |
| 46 | U | `lib/live-canary/p2-04/ntsc-official-html-adapter.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-04/index.ts`, `lib/live-canary/p2-04/ntsc-offline-composition.ts`, `tests/p2-04/ntsc-official-html-adapter.test.ts` | PRESERVE / VERSION |
| 47 | U | `lib/live-canary/p2-04/ntsc-offline-composition.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-04/index.ts`, `tests/p2-04/ntsc-official-html-adapter.test.ts` | PRESERVE / VERSION |
| 48 | U | `lib/live-canary/p2-04/run-beijing-first-live-canary.ts` | F | no/no/no | CANARY_ONLY_ORCHESTRATION | `tests/p2-04/beijing-first-live-canary.test.ts` | PRESERVE / VERSION |
| 49 | U | `lib/live-canary/p2-acq-01/approved-official-canary-transport.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-acq-01/beijing-html-xlsx-canary.ts`, `lib/live-canary/p2-acq-01/index.ts` | PRESERVE / VERSION |
| 50 | U | `lib/live-canary/p2-acq-01/beijing-html-xlsx-canary.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-acq-01/index.ts` | PRESERVE / VERSION |
| 51 | U | `lib/live-canary/p2-acq-01/index.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `tests/p2-acq-01/official-html-xlsx-canary.test.ts`, `tests/adapters/adapter-contract-harness.ts`, `tests/p2-04/ntsc-official-html-adapter.test.ts` | PRESERVE / VERSION |
| 52 | U | `lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-legal-02/guizhou-notice-observation-canary.ts`, `lib/live-canary/p2-legal-03/guizhou-attachment-admission-preflight.ts`, `lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter.ts` (+13; complete lists in JSON) | PRESERVE / VERSION |
| 53 | U | `lib/live-canary/p2-legal-02/guizhou-notice-observation-canary.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-legal-02/run-guizhou-notice-observation-canary.ts`, `tests/p2-legal-02/guizhou-notice-observation-canary.test.ts` | PRESERVE / VERSION |
| 54 | U | `lib/live-canary/p2-legal-02/run-guizhou-notice-observation-canary.ts` | F | no/no/no | CANARY_ONLY_ORCHESTRATION | `tests/p2-legal-02/guizhou-notice-observation-canary.test.ts` | PRESERVE / VERSION |
| 55 | U | `lib/live-canary/p2-legal-03/guizhou-attachment-admission-preflight.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary.ts`, `lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter.ts`, `lib/live-canary/p2-legal-08b/target-source-composition.ts` (+3; complete lists in JSON) | PRESERVE / VERSION |
| 56 | U | `lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-legal-04/run-guizhou-attachment-observation-canary.ts`, `lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter.ts`, `lib/live-canary/p2-legal-06/run-guizhou-legal-requirement-set-composition.ts` (+8; complete lists in JSON) | PRESERVE / VERSION |
| 57 | U | `lib/live-canary/p2-legal-04/run-guizhou-attachment-observation-canary.ts` | F | no/no/no | CANARY_ONLY_ORCHESTRATION | `tests/p2-legal-04/guizhou-attachment-observation-canary.test.ts` | PRESERVE / VERSION |
| 58 | U | `lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-legal-05/run-guizhou-legal-xlsx-requirement-extraction.ts`, `lib/live-canary/p2-legal-06/guizhou-legal-requirement-set-composer.ts`, `lib/live-canary/p2-legal-06/run-guizhou-legal-requirement-set-composition.ts` (+9; complete lists in JSON) | PRESERVE / VERSION |
| 59 | U | `lib/live-canary/p2-legal-05/run-guizhou-legal-xlsx-requirement-extraction.ts` | F | no/no/no | CANARY_ONLY_ORCHESTRATION | Standalone reference; no incoming static import | PRESERVE / VERSION |
| 60 | U | `lib/live-canary/p2-legal-06/guizhou-legal-requirement-set-composer.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-legal-06/run-guizhou-legal-requirement-set-composition.ts`, `lib/live-canary/p2-legal-07/guizhou-requirement-blocker-audit.ts`, `lib/live-canary/p2-legal-07/run-guizhou-requirement-blocker-audit.ts` (+2; complete lists in JSON) | PRESERVE / VERSION |
| 61 | U | `lib/live-canary/p2-legal-06/run-guizhou-legal-requirement-set-composition.ts` | F | no/no/no | CANARY_ONLY_ORCHESTRATION | Standalone reference; no incoming static import | PRESERVE / VERSION |
| 62 | U | `lib/live-canary/p2-legal-07/guizhou-requirement-blocker-audit.ts` | F | no/yes/no | DIAGNOSTIC_ONLY | `lib/live-canary/p2-legal-07/run-guizhou-requirement-blocker-audit.ts`, `tests/p2-legal-07/guizhou-requirement-blocker-audit.test.ts` | PRESERVE / VERSION |
| 63 | U | `lib/live-canary/p2-legal-07/run-guizhou-requirement-blocker-audit.ts` | F | no/no/no | DIAGNOSTIC_ONLY | Standalone reference; no incoming static import | PRESERVE / VERSION |
| 64 | U | `lib/live-canary/p2-legal-08b/index.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `tests/normalization/trusted-source-occurrence-registry.test.ts`, `tests/p2-legal-08b/target-source-composition.test.ts`, `tests/adapters/adapter-contract-harness.ts` (+1; complete lists in JSON) | PRESERVE / VERSION |
| 65 | U | `lib/live-canary/p2-legal-08b/target-source-composition.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/p2-legal-08b/index.ts` | PRESERVE / VERSION |
| 66 | U | `lib/live-canary/real-2027-haier/haier-2027-source.ts` | C | no/yes/no | GENERIC_REUSABLE_SOURCE_CAPABILITY (candidate only; site-bound) | `lib/live-canary/real-2027-haier/haier-2027-trusted-run.ts`, `lib/live-canary/real-2027-haier/index.ts`, `lib/live-canary/real-2027-haier/run-haier-2027-canary.ts` | PRESERVE / VERSION |
| 67 | U | `lib/live-canary/real-2027-haier/haier-2027-trusted-run.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/real-2027-haier/index.ts`, `lib/live-canary/real-2027-haier/run-haier-2027-canary.ts` | PRESERVE / VERSION |
| 68 | U | `lib/live-canary/real-2027-haier/index.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `tests/real-2027-haier/haier-2027-canary.test.ts`, `tests/adapters/adapter-contract-harness.ts`, `tests/p2-04/ntsc-official-html-adapter.test.ts` | PRESERVE / VERSION |
| 69 | U | `lib/live-canary/real-2027-haier/run-haier-2027-canary.ts` | F | no/no/no | CANARY_ONLY_ORCHESTRATION | Standalone reference; no incoming static import | PRESERVE / VERSION |
| 70 | U | `lib/live-canary/real-2027-zhenghan/index.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `tests/real-2027-zhenghan/zhenghan-2027-source.test.ts`, `tests/adapters/adapter-contract-harness.ts`, `tests/p2-04/ntsc-official-html-adapter.test.ts` | PRESERVE / VERSION |
| 71 | U | `lib/live-canary/real-2027-zhenghan/run-zhenghan-2027-canary.ts` | F | no/no/no | CANARY_ONLY_ORCHESTRATION | Standalone reference; no incoming static import | PRESERVE / VERSION |
| 72 | U | `lib/live-canary/real-2027-zhenghan/zhenghan-2027-source.ts` | C | no/yes/no | GENERIC_REUSABLE_SOURCE_CAPABILITY (candidate only; site-bound) | `lib/live-canary/real-2027-zhenghan/index.ts`, `lib/live-canary/real-2027-zhenghan/run-zhenghan-2027-canary.ts`, `lib/live-canary/real-2027-zhenghan/zhenghan-2027-trusted-run.ts` | PRESERVE / VERSION |
| 73 | U | `lib/live-canary/real-2027-zhenghan/zhenghan-2027-trusted-run.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/real-2027-haier/haier-2027-trusted-run.ts`, `lib/live-canary/real-2027-zhenghan/index.ts`, `lib/live-canary/real-2027-zhenghan/run-zhenghan-2027-canary.ts` | PRESERVE / VERSION |
| 74 | U | `lib/live-canary/real-legal-canary/run-shenzhen-bankruptcy-notice-reobservation-canary.ts` | H | no/no/no | DIAGNOSTIC_ONLY | Standalone reference; no incoming static import | PRESERVE / VERSION |
| 75 | U | `lib/live-canary/real-legal-canary/run-shenzhen-bankruptcy-observation-canary.ts` | F | no/no/no | CANARY_ONLY_ORCHESTRATION | `tests/real-legal-canary/shenzhen-bankruptcy-observation-canary.test.ts` | PRESERVE / VERSION |
| 76 | U | `lib/live-canary/real-legal-canary/shenzhen-bankruptcy-observation-canary.ts` | C | no/yes/no | CANARY_TEST_SUPPORT | `lib/live-canary/real-legal-canary/run-shenzhen-bankruptcy-notice-reobservation-canary.ts`, `lib/live-canary/real-legal-canary/run-shenzhen-bankruptcy-observation-canary.ts`, `tests/real-legal-canary/shenzhen-bankruptcy-observation-canary.test.ts` | PRESERVE / VERSION |
| 77 | U | `lib/presentation-read-api/api.ts` | A | yes/yes/no | - | `lib/presentation-read-api/index.ts`, `lib/presentation-read-api/runtime.ts`, `lib/presentation-read-api/shadow-runtime.ts` (+1; complete lists in JSON) | PRESERVE / VERSION |
| 78 | U | `lib/presentation-read-api/index.ts` | B | yes/yes/no | - | `app/api/presentation/v1/[...segments]/route.ts`, `tests/p2-legal-08b/target-source-composition.test.ts`, `tests/pipeline/presentation-decision.test.ts` (+5; complete lists in JSON) | PRESERVE / VERSION |
| 79 | U | `lib/presentation-read-api/runtime.ts` | A | yes/yes/no | - | `lib/presentation-read-api/index.ts`, `tests/architecture/ingestion-boundary.test.ts` | PRESERVE / VERSION |
| 80 | U | `lib/presentation-read-api/shadow-runtime.ts` | B | yes/yes/no | - | `lib/presentation-read-api/index.ts` | PRESERVE / VERSION |
| 81 | U | `lib/production-persistence/candidate-evidence-object-boundary.ts` | B | yes/yes/no | - | `lib/production-persistence/index.ts` | PRESERVE / VERSION |
| 82 | U | `lib/production-persistence/contracts.ts` | B | yes/yes/no | - | `lib/live-canary/real-2027-haier/haier-2027-source.ts`, `lib/live-canary/real-2027-zhenghan/zhenghan-2027-source.ts`, `lib/production-persistence/candidate-evidence-object-boundary.ts` (+11; complete lists in JSON) | PRESERVE / VERSION |
| 83 | U | `lib/production-persistence/git-append-only-execution-store.ts` | A | yes/yes/no | - | `lib/production-persistence/index.ts`, `lib/production-persistence/zero-cost-production-composition-root.ts` | PRESERVE / VERSION |
| 84 | U | `lib/production-persistence/git-raw-object-persistence.ts` | A | yes/yes/no | - | `lib/production-persistence/git-raw-sqlite-index.ts`, `lib/production-persistence/index.ts`, `lib/production-persistence/zero-cost-production-composition-root.ts` | PRESERVE / VERSION |
| 85 | U | `lib/production-persistence/git-raw-sqlite-index.ts` | B | yes/yes/no | - | `lib/production-persistence/index.ts` | PRESERVE / VERSION |
| 86 | U | `lib/production-persistence/git-source-registry-persistence.ts` | A | yes/yes/no | - | `lib/production-persistence/index.ts`, `lib/production-persistence/zero-cost-production-composition-root.ts` | PRESERVE / VERSION |
| 87 | U | `lib/production-persistence/index.ts` | B | yes/yes/no | - | `lib/live-canary/real-2027-haier/run-haier-2027-canary.ts`, `lib/live-canary/real-2027-zhenghan/run-zhenghan-2027-canary.ts`, `lib/live-canary/real-2027-zhenghan/zhenghan-2027-trusted-run.ts` (+12; complete lists in JSON) | PRESERVE / VERSION |
| 88 | U | `lib/production-persistence/postgres-js-executor.ts` | B | yes/yes/no | - | `lib/production-persistence/index.ts` | PRESERVE / VERSION |
| 89 | U | `lib/production-persistence/postgres-presentation-read-repository.ts` | B | yes/yes/no | - | `lib/production-persistence/index.ts` | PRESERVE / VERSION |
| 90 | U | `lib/production-persistence/postgres-production-persistence.ts` | B | yes/yes/no | - | `lib/production-persistence/index.ts` | PRESERVE / VERSION |
| 91 | U | `lib/production-persistence/production-journal.ts` | B | yes/yes/no | - | `lib/production-persistence/index.ts`, `lib/production-persistence/postgres-production-persistence.ts` | PRESERVE / VERSION |
| 92 | U | `lib/production-persistence/raw-object-boundary.ts` | B | yes/yes/no | - | `lib/production-persistence/git-raw-object-persistence.ts`, `lib/production-persistence/index.ts`, `lib/production-persistence/zero-cost-production-composition-root.ts` | PRESERVE / VERSION |
| 93 | U | `lib/production-persistence/source-owner-rehydration.ts` | B | yes/yes/no | - | `lib/production-persistence/index.ts`, `lib/production-persistence/zero-cost-production-composition-root.ts` | PRESERVE / VERSION |
| 94 | U | `lib/production-persistence/supabase-private-raw-storage.ts` | B | yes/yes/no | - | `lib/production-persistence/index.ts` | PRESERVE / VERSION |
| 95 | U | `lib/production-persistence/zero-cost-production-composition-root.ts` | A | yes/yes/no | - | `lib/production-persistence/index.ts`, `tests/production-persistence/zero-cost-production-architecture.test.ts` | PRESERVE / VERSION |
| 96 | U | `production/persistence/migrations/001_trusted_chain_foundation.up.sql` | F | no/no/no | - | `tests/production-persistence/migration-security.test.ts` | PRESERVE / VERSION |
| 97 | U | `production/persistence/migrations/002_source_registry_admission.up.sql` | F | no/no/no | - | `tests/production-persistence/migration-security.test.ts` | PRESERVE / VERSION |
| 98 | U | `production/persistence/migrations/003_raw_acquisition_source_facts.up.sql` | F | no/no/no | - | `tests/production-persistence/migration-security.test.ts` | PRESERVE / VERSION |
| 99 | U | `production/persistence/migrations/004_artifact_ledger.up.sql` | F | no/no/no | - | `tests/production-persistence/migration-security.test.ts` | PRESERVE / VERSION |
| 100 | U | `production/persistence/migrations/005_atomic_command_journal.up.sql` | F | no/no/no | - | `tests/production-persistence/migration-005-hardening.test.ts`, `tests/production-persistence/migration-security.test.ts` | PRESERVE / VERSION |
| 101 | U | `production/persistence/migrations/006_candidate_evidence_presentation_reader.up.sql` | F | no/no/no | - | `tests/production-persistence/migration-security.test.ts` | PRESERVE / VERSION |
| 102 | U | `shadow/migrations/003_presentation_read_model.sql` | C | no/no/no | - | `tests/persistence/shadow-test-database.ts` | PRESERVE / VERSION |
| 103 | U | `shadow/migrations/004_presentation_identity_v2.sql` | C | no/no/no | - | `tests/persistence/shadow-test-database.ts` | PRESERVE / VERSION |
| 104 | U | `tests/normalization/source-discovery-support.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 105 | U | `tests/normalization/source-occurrence-materializer-parity.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 106 | U | `tests/p2-04/beijing-first-live-canary.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 107 | U | `tests/p2-04/ntsc-official-html-adapter.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 108 | U | `tests/p2-acq-01/official-html-xlsx-canary.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 109 | U | `tests/p2-legal-01/guizhou-legal-canary-admission-preflight.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 110 | U | `tests/p2-legal-02/guizhou-notice-observation-canary.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 111 | U | `tests/p2-legal-03/guizhou-attachment-admission-preflight.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 112 | U | `tests/p2-legal-04/guizhou-attachment-observation-canary.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 113 | U | `tests/p2-legal-05/guizhou-legal-xlsx-requirement-extraction.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 114 | U | `tests/p2-legal-06/guizhou-legal-requirement-set-composition.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 115 | U | `tests/p2-legal-07/guizhou-requirement-blocker-audit.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 116 | U | `tests/p2-legal-08b/target-source-composition.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 117 | U | `tests/persistence/presentation-fixture.ts` | C | no/yes/no | - | `tests/persistence/presentation-shadow.test.ts`, `tests/presentation-read-api/presentation-api.test.ts`, `tests/production-persistence/phase-3-contracts.test.ts` | PRESERVE / VERSION |
| 118 | U | `tests/persistence/presentation-shadow.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 119 | U | `tests/pipeline/presentation-decision.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 120 | U | `tests/pipeline/trusted-chain-restoration.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 121 | U | `tests/presentation-read-api/presentation-api.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 122 | U | `tests/production-persistence/architecture-boundary.test.ts` | D | no/yes/yes | - | Node test discovery / fixture | PRESERVE / VERSION |
| 123 | U | `tests/production-persistence/git-append-only-execution-store.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 124 | U | `tests/production-persistence/git-raw-object-persistence.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 125 | U | `tests/production-persistence/journal-contract.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 126 | U | `tests/production-persistence/migration-005-hardening.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 127 | U | `tests/production-persistence/migration-security.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 128 | U | `tests/production-persistence/phase-1-contracts.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 129 | U | `tests/production-persistence/phase-3-contracts.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 130 | U | `tests/production-persistence/zero-cost-production-architecture.test.ts` | D | no/yes/yes | - | Node test discovery / fixture | PRESERVE / VERSION |
| 131 | U | `tests/production-persistence/zero-cost-production-composition-root.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 132 | U | `tests/real-2027-haier/haier-2027-canary.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 133 | U | `tests/real-2027-zhenghan/zhenghan-2027-source.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |
| 134 | U | `tests/real-legal-canary/shenzhen-bankruptcy-observation-canary.test.ts` | C | no/yes/no | - | Node test discovery / fixture | PRESERVE / VERSION |

## Reproduction and acceptance

Use a real clone of the consolidation branch; never copy missing code from the dirty tree. Install locked dependencies using the package-manager cache offline. Confirm all graph seeds resolve, import the six mandated core modules, then run TypeScript, P1, SOV Support, Presentation V2/duplicate regression, persistence, architecture/network guards, root execution and independent child Process B.

The 93-file full offline suite must be executed without deleting or suppressing the known historical failing test. Verification distinguishes its known failure from all new failures. Fresh-clone execution is only local/offline fixture validation, not real unattended collection or deployed production.

The completed run report is separate from this pre-commit audit. No Actions, Web, actual Zhenghan/Haier requests, source expansion or continuous authorization implementation are permitted in this stage.
