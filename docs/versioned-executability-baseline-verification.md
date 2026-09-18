# Versioned Executability Baseline — verification and blocker report

## State at original audit

This is the preserved pre-portability blocker report. Subsequent approved work is
documented in fresh-clone-historical-evidence-portability.md. A committed fresh-clone
result must be verified after consolidation, not preclaimed in this earlier report.

VERSIONED EXECUTABILITY BASELINE = NOT VERIFIED.
FRESH CLONE BLOCKER = NOT RESOLVED.
CONSOLIDATION COMMIT = PAUSED, NOT CREATED.

The source import closure is complete in the candidate index. The filesystem test-evidence closure is not versioned. The conditional authorization to consolidate a complete, consistent baseline is not used to publish an incomplete fresh-clone claim.

## Original inventory

134 original entries: 23 modified, 111 untracked, parent 7de0554d1fb23db8453376099f165fd4d0af33ee, branch codex/ingestion-foundation. Category counts: A22/B21/C61/D3/E9/F17/G0/H1. Complete per-entry source/test/guard references and decisions are in the baseline audit and inventory. All original files remain preserved. Three new audit/report documents are supplemental.

## New blocker: FRESH_CLONE_TEST_EVIDENCE_BOUNDARY

Nine existing test files read ignored outputs without portable committed equivalents. These are filesystem reads, not TypeScript module imports, so a successful 102/260/84 import closure does not prove runnable full tests.

The attachment execution manifest is itself untracked and its report.raw.local_artifact is an absolute locator into the original checkout. Copying only that manifest would still allow another checkout's evidence to satisfy tests. That is a hidden dependency, not evidence-native portability.

The existing committed-HEAD clone from the preceding audit lacks all the locators below. This is an absence probe at the old HEAD, not a post-consolidation clone, install or execution success claim.

| Test | External input locator | Present locally | Tracked |
|---|---|---|---|
| `tests/p2-acq-01/official-html-xlsx-canary.test.ts` | `outputs/p2-04d/p2-04d-run-3648affe-5bd5-471c-b557-085bfed0a3be/raw.html` | yes | no |
| `tests/p2-acq-01/official-html-xlsx-canary.test.ts` | `outputs/p2-04e/p2-04e-observation-run-c240b387-9ed7-415a-b7f1-4b53cc95bf6c` | yes | no |
| `tests/canonicalization/position-bound-opportunity-tracker.test.ts` | `outputs/p2-legal-04/attachment-observation-canary-execution.json` | yes | no |
| `tests/normalization/trusted-source-occurrence-registry.test.ts` | `outputs/p2-legal-02/p2-legal-02-run-514a72f9-0a36-4e8b-9358-73c2ebc88cae` | yes | no |
| `tests/normalization/trusted-source-occurrence-registry.test.ts` | `outputs/p2-legal-04/p2-legal-04-run-22ecbdab-0123-421d-994c-97a35cde4dcf` | yes | no |
| `tests/normalization/position-version-tracker.test.ts` | `outputs/p2-legal-04/attachment-observation-canary-execution.json` | yes | no |
| `tests/normalization/position-identity-resolver.test.ts` | `outputs/p2-legal-04/attachment-observation-canary-execution.json` | yes | no |
| `tests/p2-legal-05/guizhou-legal-xlsx-requirement-extraction.test.ts` | `outputs/p2-legal-04/attachment-observation-canary-execution.json` | yes | no |
| `tests/p2-legal-08b/target-source-composition.test.ts` | `outputs/p2-legal-02/p2-legal-02-run-514a72f9-0a36-4e8b-9358-73c2ebc88cae` | yes | no |
| `tests/p2-legal-08b/target-source-composition.test.ts` | `outputs/p2-legal-04/p2-legal-04-run-22ecbdab-0123-421d-994c-97a35cde4dcf` | yes | no |
| `tests/p2-legal-06/guizhou-legal-requirement-set-composition.test.ts` | `outputs/p2-legal-02/notice-observation-canary-execution.json` | yes | no |
| `tests/p2-legal-06/guizhou-legal-requirement-set-composition.test.ts` | `outputs/p2-legal-04/attachment-observation-canary-execution.json` | yes | no |
| `tests/p2-legal-07/guizhou-requirement-blocker-audit.test.ts` | `outputs/p2-legal-06/p2-legal-06-job-22828700101/requirement-set-composition.json` | yes | no |

Additional child files include raw HTML/XLSX and Snapshot JSON in the listed directories. Legal-06 loads notice/attachment manifests and follows their raw locators. Legal-07 loads a previously generated composition result. No outputs directory, report, raw file or state repository is added to the index here.

This blocker is distinct from the known historical parity assertion. Fresh-clone missing-input failures must never be relabeled PRE-EXISTING BASELINE FAILURE or skipped to get a green command.

## Verification actually executed

- TypeScript: pnpm exec tsc --noEmit --incremental false, exit 0.
- P1: pnpm test:phase1, 170/170 PASS, exit 0.
- Combined SOV Support, Presentation V2 including duplicate regression, architecture/persistence dependency boundaries and Network Guard: 61/61 PASS, exit 0.
- Full offline regression: all 93 discovered test files, 977 tests, 976 PASS, 1 FAIL, 0 cancelled/skipped, duration 539479.5892 ms, exit 1.
- The sole full-suite failure is the known parity test at line 434, assertion 439: PRE-EXISTING BASELINE FAILURE. No new failures in this existing locally provisioned worktree.
- Root execution, committed Git restoration and independent child Process B are included in the full suite; local fixture success does not prove their availability in a fresh clone.
- No unresolved module imports within the production/test/guard closures; no prohibited legacy, preview, canary orchestration or Web business import edges in the production closure.
- Staging closure audit: 136 candidate paths before this report (original 134 plus two audit documents), no absent/extra paths, no log/cache/state/environment file included; closure paths present in the candidate index.
- Secret-literal scan of those 136 paths: no suspicious private keys, GitHub tokens, JWT literals or credential-bearing PostgreSQL URLs.
- git diff --cached --check and git diff --check: PASS after correcting one new documentation trailing blank line.
- Protected old business/Web/workflow diff: zero. No second business chain or authority is introduced.

The full-suite log is a local temporary verification artifact named versioned-baseline-precommit-full-offline.log. It is not source-controlled.

## Not executed or claimed

No consolidation commit, post-versionization clone, locked install, fresh-clone full regression or fresh-clone production execution is claimed. No real official endpoint was requested; no continuous acquisition grant was issued; no Scheduler, workflow or Web change occurred.

## Minimal next step requiring scope confirmation

Approve a narrowly scoped portable archived-test-evidence boundary before consolidation:
1. Inventory only the exact raw/snapshot/report fields consumed by the nine existing tests; assess privacy, credentials and publication/licensing suitability.
2. Preserve existing source URLs, capture IDs, SHA-256, snapshots, original provenance and expected outcomes. Historical 2025/2026 evidence remains test/reference, never real 2027 production.
3. Define a versioned TEST_ONLY evidence package/manifest with repository-relative or content-addressed locators. Translate historical local path locators only at the test boundary; do not rewrite sealed authoritative artifacts or business facts.
4. Convert generated-result dependencies into deterministic recomputation from approved archived inputs where feasible, keeping historical blockers and assertions.
5. Update only test loaders/support necessary for portability; do not create a second real pipeline or duplicate evidence set.
6. Do not bulk-add outputs, manufacture substitute raw bytes, download sources, copy files into a clone, alter business semantics, or suppress tests.
7. Rerun all tests, then make the authorized complete consolidation commit and perform actual fresh-clone locked installation/root/child restoration validation.

## Phase 2

No formal Phase 2 design freeze is declared because Phase 1 remains blocked. A read-only sidecar review identified future design concerns: exact mode enforcement rather than permission.allowed; freshest committed revocation state rather than a cached version list; Zhenghan's two URLs explicitly bound; cadence/approval authority; pre-send concurrency and the check-to-dispatch revocation race. These require explicit design resolution, not an implicit permission upgrade. No continuous contract is implemented.
