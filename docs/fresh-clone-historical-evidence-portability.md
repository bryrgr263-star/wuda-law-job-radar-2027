# Fresh clone historical evidence portability audit

## Approved boundary and plan

TEST_ONLY / NOT_PRODUCTION_AUTHORITY / NOT_RUNTIME_SOURCE / NOT_NEW_TRUST_SOURCE.
Parent: 7de0554d1fb23db8453376099f165fd4d0af33ee; branch: codex/ingestion-foundation.
Original consolidation index: 23 modified + 114 added. Preserve all existing staged成果.

User chose the narrow exception: public official business contacts and original document
metadata may be retained exactly as TEST_ONLY. Private candidate documents, IDs,
credentials, cookies, tokens and secrets remain prohibited. The exception is not a
claim that historical official files contain no third-party personal identifiers.

Implementation sequence: original-file audit → exact selective packaging → logical
portable loader → nine loader-only test changes → integrity/read/import guards →
independent staged-index export + frozen offline installation + full verification →
conditional consolidation commit → genuine committed-branch clone + repeat verification.
No production business semantics, identity, API/Web, Scheduler or authorization changes.

## Nine tests and precise minimum dependencies

| Test file | Complete required fixture IDs | Assertion role |
|---|---|---|
| tests/p2-acq-01/official-html-xlsx-canary.test.ts | beijing-detail-html, beijing-attachment-xlsx, beijing-attachment-snapshot | Archived HTML/XLSX: three provisional positions, blocked DOCX |
| tests/p2-legal-05/guizhou-legal-xlsx-requirement-extraction.test.ts | guizhou-attachment-xlsx, guizhou-attachment-snapshot | Exact raw/Snapshot reconstruction, bindings, identity, provenance and existing parser/assertions |
| tests/p2-legal-06/guizhou-legal-requirement-set-composition.test.ts | guizhou-notice-html, guizhou-notice-snapshot, guizhou-attachment-xlsx, guizhou-attachment-snapshot | Exact raw/Snapshot reconstruction, bindings, identity, provenance and existing parser/assertions |
| tests/p2-legal-07/guizhou-requirement-blocker-audit.test.ts | guizhou-requirement-composition | Original result: all 24 blockers, no reinterpretation |
| tests/normalization/trusted-source-occurrence-registry.test.ts | guizhou-notice-html, guizhou-notice-snapshot, guizhou-attachment-xlsx, guizhou-attachment-snapshot | Exact raw/Snapshot reconstruction, bindings, identity, provenance and existing parser/assertions |
| tests/normalization/position-identity-resolver.test.ts | guizhou-attachment-xlsx, guizhou-attachment-snapshot | Exact raw/Snapshot reconstruction, bindings, identity, provenance and existing parser/assertions |
| tests/normalization/position-version-tracker.test.ts | guizhou-attachment-xlsx, guizhou-attachment-snapshot | Exact raw/Snapshot reconstruction, bindings, identity, provenance and existing parser/assertions |
| tests/canonicalization/position-bound-opportunity-tracker.test.ts | guizhou-attachment-xlsx, guizhou-attachment-snapshot | Exact raw/Snapshot reconstruction, bindings, identity, provenance and existing parser/assertions |
| tests/p2-legal-08b/target-source-composition.test.ts | guizhou-notice-html, guizhou-notice-snapshot, guizhou-attachment-xlsx, guizhou-attachment-snapshot | Four attachment identities; source closure remains incomplete |

All required files are complete originals. HTML/XLSX hashes and parser workbook structure
require full bytes; Snapshots retain exact IDs, raw hashes, timestamps, request/response
metadata and locators. The composition JSON is the original captured result, not rerun,
reinterpreted or reformatted; its 24 blockers remain. No excerpt is an equivalent substitute.
ExtractedRecords are reconstructed by unchanged existing tests from exact original inputs.
Position identity, PV, PBOV, authority, publication and attachment binding assertions remain.
Existing independent Process B tests are reused, not a second test pipeline.

## File inventory

| Fixture | Repository-relative location | Bytes | Original SHA-256 | Action |
|---|---|---:|---|---|
| beijing-detail-html | fixtures/p2-04d/beijing-public-institution-job-detail.html | 40310 | 8a44dad79da041e1aefb7d9aed442df40f5de844eefe5d1708cb52996f511d8a | REUSE_EXISTING_TRACKED |
| beijing-attachment-xlsx | fixtures/p2-04e/beijing-public-institution-job-table.xlsx | 12414 | b8a3c2832ab77782b2215370a72f40c524ab1e8179731fc025aafd6452514766 | REUSE_EXISTING_TRACKED |
| beijing-attachment-snapshot | tests/fixtures/historical-evidence/beijing-attachment.snapshot.json | 1666 | ae2e1ff391236654220e21b373bfb99384c0d46d6104f646fe3450e8994c8f60 | COPY_EXACT |
| guizhou-notice-html | tests/fixtures/historical-evidence/guizhou-notice.html | 84811 | e517ef5af83b57eea41f953e12117a677e5486cda3b7c521b9888ae5d86b004a | COPY_EXACT |
| guizhou-notice-snapshot | tests/fixtures/historical-evidence/guizhou-notice.snapshot.json | 1012 | 5092a2f889a92dcccec18116f1ab1145bc4ed52f613ab8e33afd14dad1797764 | COPY_EXACT |
| guizhou-attachment-xlsx | tests/fixtures/historical-evidence/guizhou-attachment.xlsx | 13319 | 87b013e13ea78cd1de130553f203024fbd8c274479219b39ae1bd4280fc8f7ec | COPY_EXACT |
| guizhou-attachment-snapshot | tests/fixtures/historical-evidence/guizhou-attachment.snapshot.json | 1222 | fca0071222c7d44b05c22d0d5e555d074c0aa70569ca098a8de3db2df856c3e7 | COPY_EXACT |
| guizhou-requirement-composition | tests/fixtures/historical-evidence/guizhou-requirement-composition.json | 141281 | a2b5dc702e75dcb944b006eca78b8d15d71855ce73502f9386eec0508f0614ad | COPY_EXACT |

Eight referenced files total 296035 bytes. Six newly preserved historical files total
243311 bytes. Only one new binary is required: guizhou-attachment.xlsx (13319 bytes),
used by seven tests listed in the manifest, for hash/workbook/row/0351/PV/PBOV checks.
Existing byte-identical Beijing HTML/XLSX are reused without duplication. Manifest
origin_reference records exact original ignored capture locations, never runtime lookup.
Versioned .gitattributes disables all Git text transformations for historical bytes.
The original Guizhou HTML contains ten trailing-whitespace lines. An exact-file
whitespace attribute exempts only those captured line endings from diff --check;
historical bytes are not cleaned, and code/document whitespace checks remain active.
An initial independent export exposed a separate existing Beijing job-list fixture
conversion: Git autocrlf changed LF to CRLF during export, breaking its existing
SHA-256 assertion. Its original index/worktree bytes match; an exact-file -text
attribute preserves those unchanged bytes in independent checkouts. No hash/assertion
or fixture bytes are changed, and the initial failure is recorded, not labeled baseline.

## Historical location versus provenance

Original execution reports:
- outputs/p2-legal-02/notice-observation-canary-execution.json: 5250 bytes,
  SHA-256 98c58bf26bdba5dab55b3d4671c5e42d86e1ba4221ffd90b7874fb256aa46d24.
- outputs/p2-legal-04/attachment-observation-canary-execution.json: 5982 bytes,
  SHA-256 2433c9e872a443ecd4cdef7d372fa6cacb4e968580b01f9c8a468c203cd626ea.

Reports only supplied raw.local_artifact filesystem pointers in affected tests;
no report semantic field is asserted. They are therefore omitted, not rewritten.
Exact original snapshots/raw/composition are used directly through fixture IDs.
No absolute recorded locator or original ignored file is edited. Historical recorded
URLs and provenance are preserved; no download, recapture, replacement or regeneration.

## Guards

The test-only loader roots resolution in its own versioned import location, not an
original absolute checkout, environment override or fallback. Only manifest-listed
relative paths resolve. Paths reject traversal, Windows/Unix absolute paths, outputs,
unlisted files and symlink escape. Every read checks exact length and SHA-256; defensive
copies prevent mutation. This fixture inventory has no authority/resolver/branding role.

Scoped test filesystem wrappers reject outputs and external historical HTML/XLSX/PDF/
DOC/WPS/Snapshot/composition locators, including direct sync/async reads. Source/module
reads and legitimate dependency loading are not a blanket filesystem sandbox. No claim
is made that arbitrary hostile code is confined; independent staged export and fresh
clone are required to prove the nine tests do not need original evidence directories.

TypeScript AST transitive closures (including aliases, imports/exports, type imports,
literal dynamic import/require) are checked for the current production root, Trusted
Chain and Presentation API route/runtime. Nonliteral local loader use requires review.
Production fixture/helper reachability is forbidden, and runtime historical fixture
path literals are rejected. Scheduler remains NOT IMPLEMENTED, not a claimed closure;
its future root foundation is the existing guarded zero-cost production root.

## Verification gate

The final independent staged-index export (tree
374364de9379f3354a65f925ca7220ec946e092f) finished normally: 95 test files,
990 tests, 989 PASS, 1 FAIL, exit 1, zero cancelled/skipped/todo, duration
582791.9821 ms. Its sole failure is the unchanged historical parity test at
definition line 434 / assertion 439; new regressions = 0. The earlier diagnostic
export had two failures (baseline plus the identified Git conversion); it is
not the accepted final run. Final code/fixture/lockfile/attribute bytes are
identical to this fully tested tree; only audit documentation is updated later.

Independent frozen offline installation used its own node_modules, 373 packages,
zero downloads, and no original outputs or NODE_PATH/authority environment override.
Final TypeScript PASS; historical + helper + import guard group 153/153 PASS;
P1 170/170 PASS; SOV Support/Presentation/architecture/Network Guard group 59/59 PASS.
Full-suite production root and independent child Process B tests PASS, including
exact restored SOV/bindings/IDs/hashes/seals. Original = packaged = index bytes
rechecked for all eight historical files. Read-only independent review found no
blocking findings. Production import guards have zero TEST_ONLY dependencies.

Final staging categories and complete paths are in
versioned-executability-baseline-final-staging.json. The narrow historical-file
whitespace exception is explicit; cached and working-tree diff --check PASS.
No private candidate document, credential-shaped literal, generated state/log/cache,
old business/Web/workflow change or accidental large binary is included.

These results authorize the consolidation commit only. Genuine committed-branch
clone verification must follow; its results are reported in task completion, not
preclaimed in this immutable precommit report. This is not Production readiness
or Scheduler/continuous-authorization completion.

Local targeted historical tests + helper: 145/145 PASS before two additional negatives.
Helper + import boundary tests: 13/13 PASS. TypeScript PASS.
These are local checks, not committed fresh-clone certification.
Independent staged-index and committed fresh-clone results must be recorded before
VERSIONED EXECUTABILITY BASELINE = VERIFIED can be claimed.

Known full-suite baseline failure remains source-occurrence-materializer-parity.test.ts,
original test definition line 434 / assertion 439. It must not be suppressed or edited.
No Scheduler, Actions, real endpoint, Web/API business or legacy production change.
