# Fresh clone acceptance guard count audit

## Scope and result

CASE A — incorrect hard-coded acceptance expectation. Verification-only correction;
no production, Trusted Chain, business test, fixture, guard implementation or Legacy changes.
No full regression rerun. Baseline commit remains dab9ad52ec6310bb4b2aafc4b9285111459227a9.

## Origin of 96

Original temporary runner: C:\\Users\\HUAWEI\\AppData\\Local\\Temp\\trusted-fresh-dab9ad52-final-runner.ps1.
Line 54 hard-codes both guard_active_reports >= 96 and guard_clean_exit_reports >= 96.
Line 31 dynamically discovers test files with rg; line 32 separately hard-codes 95 files.
The 96 threshold is not calculated from that discovery, a historical inventory,
a bootstrap command, or a Process B command. No explanatory comment or version history
exists for this TEMP runner; the author's intended rationale cannot be recovered.
CreationTimeUtc: 2026-09-18 13:22:26; LastWriteTimeUtc: 2026-09-18 13:23:18.
These filesystem timestamps bound the observed introduction; they are not a Git history.

Node v24.19.0 local built-in source confirms process-isolated --test main calls
prepareTestRunnerMainExecution, while internal/test_runner/runner forwards execArgv
to the per-file child processes. User --import execution in the runner itself is
in the isolation-none branch, not this process-isolated command.
Thus the parent does not provide an extra guard invocation. The original runner line 37
contains one node --import guard --import tsx --test invocation and no separate bootstrap.
Process B tests explicitly spawn tsx without the TEMP --import guard and assert independent
restoration; they are not a separately contracted 96th guard invocation. This audit does
not claim the TEMP filesystem shim automatically propagates into every nested subprocess.
No artificial guard invocation is added, nor is existing guard coverage weakened.

## Reporting root cause and correction

Runner lines 52–53 reset baseline_failure_count=0 and new_regression_count=null.
Lines 56–57 classify the known failure only inside the complete acceptance branch.
Consequently an unrelated coverage-count rejection discards already available classification.
The corrected reporter derives complete-log failure classification independently of acceptance.
Incomplete evidence retains null/unknown; an changed baseline error or additional failure
is not silently assigned to the historical exception.

The deterministic expectation is the discovered committed test-file inventory length,
with exactly one closed guard block per file, a unique source-literal test-name anchor,
no foreign-file anchors, no missing/extra blocks, and zero unexpected reads.
This is not a 96-to-95 magic-number substitution. Unsupported or ambiguous mapping fails closed.
The original status and full log are never rewritten; re-evaluation emits a separate result.

## Existing evidence binding

- Original status SHA-256: 003a9b648598fc8a145e2a18b7906ea62598799edf345c6f4e318094142fea89
- Full TAP log SHA-256: 49f087f480cd93b5f0b6fad17d7c87f1c7a0e0ea37d5bc1b1b1eb77effdbc56f
- Log: C:\\Users\\HUAWEI\\AppData\\Local\\Temp\\trusted-fresh-dab9ad52-final-full.log
- Original status: C:\\Users\\HUAWEI\\AppData\\Local\\Temp\\trusted-fresh-dab9ad52-final-status.json
- Original status remains COMPLETE_NOT_ACCEPTED.
- Re-evaluated status: COMPLETE_ACCEPTED_WITH_PRE_EXISTING_BASELINE_FAILURE.
- Total 990; PASS 989; FAIL 1; exit code 1.
- Historical failure: production repository delegates SOV construction to the shared materializer.
- Original test declaration: tests/normalization/source-occurrence-materializer-parity.test.ts:434;
  assertion :439, unchanged /prepareSourceOccurrenceMaterialization/u mismatch.
- Baseline failures 1; new regressions 0.
- Discovered/executed/mapped files 95; launches 95;
  clean guard exit reports 95; missing/abnormal guard exits 0.
- Process B restoration PASS; original status counters agree with complete log.
- Fresh clone exact HEAD checked before and after; clean before and after.
- Old worktree accidental reads 0. Hidden-output dependency 0 is the separately frozen
  prior boundary-audit fact; this count re-evaluation neither re-runs nor expands that scan.

## Verification

The verification tests live under verification/, outside the baseline tests/ discovery,
so they do not manufacture an extra invocation or change the historical 95-file inventory.
Eight initial regression tests reproduce the old threshold/reporting faults before correction.
Final verification-only regression: 12/12 PASS. TypeScript: PASS
(`pnpm exec tsc --noEmit --incremental false`). `git diff --check`: PASS.
Verification-only tests and TypeScript are run separately; 990 business tests are not rerun.
No claim of new production readiness or subsequent phase authorization is made.

## Complete 95-file invocation inventory

Each row has one launch, one zero-unexpected-read exit, and a unique test-name anchor
matched against the committed source AST. Line numbers refer to the immutable full TAP log.
This establishes execution identity beyond merely comparing aggregate counts.

| # | Test file | Guard launch line | Guard exit line | Unique test anchor |
| --- | --- | --- | --- | --- |
| 1 | `tests/adapters/fixture-adapter.test.ts` | 2 | 105 | ExtractedRecord contract preserves raw fields and identity candidates |
| 2 | `tests/architecture/historical-evidence-boundary.test.ts` | 106 | 143 | production fixture guard rejects forbidden helper and fixture dependency paths |
| 3 | `tests/architecture/ingestion-boundary.test.ts` | 144 | 223 | test network access is disabled |
| 4 | `tests/canonicalization/conservative-canonicalizer.test.ts` | 224 | 273 | official and third-party records merge when conservative evidence agrees |
| 5 | `tests/canonicalization/position-bound-opportunity-tracker.test.ts` | 274 | 492 | valid Position and validated PositionVersion materialize one PBOV |
| 6 | `tests/canonicalization/recruitment-context-position-identity.test.ts` | 493 | 662 | Control A: one announcement with same-title Positions remains row-scoped |
| 7 | `tests/ci/phase-1-ci.test.ts` | 663 | 682 | Phase 1 exposes independent repeatable test and CI commands |
| 8 | `tests/domain/domain-types.test.ts` | 683 | 774 | domain source contains no platform or legacy scoring fields |
| 9 | `tests/eligibility/eligibility-engine.test.ts` | 775 | 870 | GRADUATE scope accepts master or doctor without becoming MASTER |
| 10 | `tests/eligibility/p1-cr10-candidate-model-major-equivalence.test.ts` | 871 | 1022 | CandidateProfile models gender |
| 11 | `tests/eligibility/p1-cr10-engine-integration-cr11-major-match-relation.test.ts` | 1023 | 1078 | CR#10 structured controls cover all twelve frozen major outcomes |
| 12 | `tests/eligibility/p1-general-eligibility-prerequisites-gate.test.ts` | 1079 | 1116 | candidate assertion hashes are self-excluding, deterministic, and independently validatable |
| 13 | `tests/eligibility/p2-legal-08a-candidate-profile.test.ts` | 1117 | 1200 | synthetic CandidateProfile contains only the minimal control schema |
| 14 | `tests/helpers/historical-evidence.test.ts` | 1201 | 1244 | every packaged historical file has its exact original hash and size |
| 15 | `tests/integration/phase-1-pipeline.test.ts` | 1245 | 1282 | one Fixture Source reaches Eligibility when explicit requirements are complete |
| 16 | `tests/lifecycle/source-run-missing-guard.test.ts` | 1283 | 1368 | complete non-empty run resets observed and records only safe missing |
| 17 | `tests/normalization/opportunity-recall-tracker.test.ts` | 1369 | 1424 | every record entering Recall atomically receives Candidate and disposition |
| 18 | `tests/normalization/position-identity-resolver.test.ts` | 1425 | 1582 | OFFICIAL_POSITION_CODE resolves from validated SOV evidence |
| 19 | `tests/normalization/position-version-tracker.test.ts` | 1583 | 1752 | PositionVersion semantic hash is deterministic |
| 20 | `tests/normalization/source-discovery-support.test.ts` | 1753 | 1856 | Case A: exact rediscovery issues support, retains original SOV, and reuses original envelope |
| 21 | `tests/normalization/source-occurrence-materializer-parity.test.ts` | 1857 | 2909 | ExtractedRecord V2 identity and semantic hash are deterministic |
| 22 | `tests/normalization/source-occurrence.test.ts` | 2910 | 2993 | Source identity follows source ID, detail URL, then composite fields |
| 23 | `tests/normalization/trusted-source-occurrence-registry.test.ts` | 2994 | 3025 | trusted SOV registry seals package artifacts idempotently |
| 24 | `tests/p2-01/application-boundary.test.ts` | 3026 | 3045 | P2 application depends only downstream on frozen ingestion and has no network implementation |
| 25 | `tests/p2-01/observation-canary-authorization.test.ts` | 3046 | 3089 | B review with insufficient evidence can use one Observation Canary without upgrading |
| 26 | `tests/p2-01/source-admission-tiers.test.ts` | 3090 | 3157 | Level A expresses approved normal controlled collection permission |
| 27 | `tests/p2-01/source-admission.test.ts` | 3158 | 3255 | Source Admission Register preserves Chinese review evidence and all required fields |
| 28 | `tests/p2-02/preview-local-exercise.test.ts` | 3256 | 3281 | local Preview exercise supports a clean migration and replay |
| 29 | `tests/p2-02/preview-migration-contract.test.ts` | 3282 | 3313 | Preview PostgreSQL migration maps frozen domain entities into an isolated schema |
| 30 | `tests/p2-02/preview-persistence-boundary.test.ts` | 3314 | 3333 | P2-02 Preview implementation contains no network or collection capability |
| 31 | `tests/p2-02/preview-raw-storage.test.ts` | 3334 | 3359 | Preview Raw Storage uses deterministic private SHA-256 object paths |
| 32 | `tests/p2-02/preview-recovery.test.ts` | 3360 | 3385 | Preview recovery manifest is deterministic and content-addressed |
| 33 | `tests/p2-03/collection-runner.test.ts` | 3386 | 3405 | Collection Runner paginates local HTTP, captures Raw before Adapter extraction, and rate limits |
| 34 | `tests/p2-03/collection-runtime-boundary.test.ts` | 3406 | 3425 | P2-03 runtime is the only local HTTP layer and depends only on P1 plus itself |
| 35 | `tests/p2-03/collection-timeout.test.ts` | 3426 | 3433 | Collection Runner records timeout as FAILED without creating a successful RawBlob |
| 36 | `tests/p2-03/local-http-transport.test.ts` | 3434 | 3453 | Local HTTP Transport accepts only an explicit loopback test server and returns raw bytes |
| 37 | `tests/p2-03/network-guard.test.ts` | 3454 | 3467 | shared Network Guard still blocks accidental external network access |
| 38 | `tests/p2-04/beijing-canary-authorization-preparation.test.ts` | 3468 | 3505 | Beijing candidate remains Level B and REVIEW |
| 39 | `tests/p2-04/beijing-first-live-canary.test.ts` | 3506 | 3549 | human approval produces a valid Level B one-endpoint one-run authorization |
| 40 | `tests/p2-04/beijing-public-institution-html-adapter.test.ts` | 3550 | 3605 | real Canary fixture is byte-identical to its recorded Raw SHA-256 |
| 41 | `tests/p2-04/ntsc-official-html-adapter.test.ts` | 3606 | 3691 | synthetic/test-only HTML extracts traceable recruitment list records |
| 42 | `tests/p2-04d/beijing-public-institution-detail-html-adapter.test.ts` | 3692 | 3741 | real Detail Canary fixture is byte-identical to recorded Raw provenance |
| 43 | `tests/p2-04d/beijing-public-institution-detail-live-canary.test.ts` | 3742 | 3785 | human approval creates a directly bound Level B detail authorization |
| 44 | `tests/p2-04e/beijing-public-institution-attachment-observation-canary.test.ts` | 3786 | 3835 | manual approval is exactly bound to one attachment observation run |
| 45 | `tests/p2-04e/beijing-public-institution-xlsx-job-table-adapter.test.ts` | 3836 | 3897 | real XLSX fixture is byte-identical to the sealed Observation Canary Raw |
| 46 | `tests/p2-05/boundary.test.ts` | 3898 | 3917 | P2-05 is offline and depends only downstream on frozen P1/P2 contracts |
| 47 | `tests/p2-05/incremental-discovery.test.ts` | 3918 | 3961 | incremental discovery classifies NEW, UPDATED, and UNCHANGED by stable detail locator |
| 48 | `tests/p2-05/source-scheduler.test.ts` | 3962 | 4011 | approved A sources register and issue independently identified Collection Run dispatches |
| 49 | `tests/p2-06/production-isolated-write.test.ts` | 4012 | 4067 | production schema contract is isolated and is not a real production connection |
| 50 | `tests/p2-07/read-only-api.test.ts` | 4068 | 4111 | Opportunity list filters persisted projections and paginates without collection |
| 51 | `tests/p2-07/read-only-runtime-composition.test.ts` | 4112 | 4137 | runtime serves only the immutable official Beijing dataset through the P2-07 API |
| 52 | `tests/p2-acq-01/official-html-xlsx-canary.test.ts` | 4138 | 4145 | archived official HTML and XLSX retain all positions and stop at missing DOCX evidence |
| 53 | `tests/p2-legal-01/guizhou-legal-canary-admission-preflight.test.ts` | 4146 | 4195 | preflight binds the official source to the exact notice endpoint |
| 54 | `tests/p2-legal-02/guizhou-notice-observation-canary.test.ts` | 4196 | 4239 | approval is an exact B REVIEW observation canary |
| 55 | `tests/p2-legal-03/guizhou-attachment-admission-preflight.test.ts` | 4240 | 4289 | attachment reuses the source definition but has an independent exact endpoint |
| 56 | `tests/p2-legal-04/guizhou-attachment-observation-canary.test.ts` | 4290 | 4333 | approval is an exact independent B REVIEW attachment observation canary |
| 57 | `tests/p2-legal-05/guizhou-legal-xlsx-requirement-extraction.test.ts` | 4334 | 4411 | sealed P2-LEGAL-04 Raw and Snapshot are the only offline inputs |
| 58 | `tests/p2-legal-06/guizhou-legal-requirement-set-composition.test.ts` | 4412 | 4479 | announcement and XLSX compose into one Requirement Set with both sources |
| 59 | `tests/p2-legal-07/guizhou-requirement-blocker-audit.test.ts` | 4480 | 4553 | all 24 composition blockers are audited exactly once |
| 60 | `tests/p2-legal-08b/target-source-composition.test.ts` | 4554 | 4603 | offline discovery records all four official attachment identities |
| 61 | `tests/persistence/opportunity-recall-shadow.test.ts` | 4604 | 4623 | Recall registration persists Candidate and initial disposition atomically |
| 62 | `tests/persistence/presentation-shadow.test.ts` | 4624 | 4631 | Presentation persistence is immutable, idempotent, and current-revision ordered |
| 63 | `tests/persistence/shadow-migration.test.ts` | 4632 | 4669 | shadow migration applies to a fresh in-memory database |
| 64 | `tests/persistence/shadow-repository.test.ts` | 4670 | 4719 | repository contract round-trips the approved frozen domain graph |
| 65 | `tests/pipeline/approved-requirement-projection-coverage.test.ts` | 4720 | 4817 | approved projection covers explicit education ranges |
| 66 | `tests/pipeline/legal-employment-relevance.test.ts` | 4818 | 5071 | Source conflict is REVIEW_REQUIRED even with direct legal text |
| 67 | `tests/pipeline/position-bound-eligibility-assessment.test.ts` | 5072 | 5169 | Phase I consumes only trusted PredicateResolution IDs |
| 68 | `tests/pipeline/position-bound-predicate-resolution.test.ts` | 5170 | 5243 | Phase H resolves only trusted E/F/G IDs |
| 69 | `tests/pipeline/position-bound-requirement-set.test.ts` | 5244 | 5323 | Phase G uses the approved deterministic projection rather than caller typed facts |
| 70 | `tests/pipeline/position-bound-source-composition.test.ts` | 5324 | 5355 | Phase F resolves PBOV only through the root-pinned trusted resolver |
| 71 | `tests/pipeline/presentation-decision.test.ts` | 5356 | 5489 | PresentationPolicy V1 is an approved root-owned boundary |
| 72 | `tests/pipeline/trusted-candidate-evidence.test.ts` | 5490 | 5551 | synthetic Candidate Evidence preserves independent bachelor and master credentials |
| 73 | `tests/pipeline/trusted-chain-restoration.test.ts` | 5552 | 5655 | fresh composition root replays the complete trusted chain after restart |
| 74 | `tests/presentation-read-api/presentation-api.test.ts` | 5656 | 5663 | Presentation API returns all retained sealed statuses and hides NOT_DISPLAY |
| 75 | `tests/production-persistence/architecture-boundary.test.ts` | 5664 | 5689 | Trusted Chain never imports the production PostgreSQL infrastructure |
| 76 | `tests/production-persistence/git-append-only-execution-store.test.ts` | 5690 | 5727 | canonical Git layout is deterministic, append-only, and restart-readable |
| 77 | `tests/production-persistence/git-raw-object-persistence.test.ts` | 5728 | 5795 | RawBlob uses deterministic SHA-256 paths and exact replay is idempotent |
| 78 | `tests/production-persistence/journal-contract.test.ts` | 5796 | 5821 | verified checkpoint, journal, artifacts, and upstream seals restore records |
| 79 | `tests/production-persistence/migration-005-hardening.test.ts` | 5822 | 5847 | Migration 005 rejects NULL-unsafe journal and checkpoint continuity |
| 80 | `tests/production-persistence/migration-security.test.ts` | 5848 | 5927 | production persistence contains deterministic forward migrations 001 through 006 |
| 81 | `tests/production-persistence/phase-1-contracts.test.ts` | 5928 | 5983 | source versions are stable, immutable, and collision-addressed |
| 82 | `tests/production-persistence/phase-3-contracts.test.ts` | 5984 | 6003 | Candidate Evidence object boundary writes once and verifies SHA-256 before trust |
| 83 | `tests/production-persistence/zero-cost-production-architecture.test.ts` | 6004 | 6023 | zero-cost production root composes existing authoritative owners only |
| 84 | `tests/production-persistence/zero-cost-production-composition-root.test.ts` | 6024 | 6073 | one production run forms one atomic commit and fresh Process B restores it |
| 85 | `tests/real-2027-haier/haier-2027-canary.test.ts` | 6074 | 6099 | Haier admission and allowlist authorize only the exact approved URL |
| 86 | `tests/real-2027-zhenghan/zhenghan-2027-source.test.ts` | 6100 | 6119 | formal Source Admission and two exact allowlists preserve approved scope |
| 87 | `tests/real-legal-canary/shenzhen-bankruptcy-observation-canary.test.ts` | 6120 | 6157 | notice and PDF approvals remain separate B + REVIEW observation canaries |
| 88 | `tests/registry/source-registry.test.ts` | 6158 | 6231 | Source Registry registers Organization, SourceDefinition, and Endpoint separately |
| 89 | `tests/requirements/p1-cr11-recruitment-major-expression.test.ts` | 6232 | 6293 | CR#11 controls A-H keep distinct legal-major identities and source scopes |
| 90 | `tests/requirements/p1-cr12-requirement-logic-modality-applicability.test.ts` | 6294 | 6517 | Modality contract preserves mandatory, preferred, optional, and informational clauses |
| 91 | `tests/requirements/p1-cr9-minimal-domain-extension.test.ts` | 6518 | 6637 | GENDER formally models an explicit male restriction |
| 92 | `tests/requirements/p1-general-eligibility-prerequisites-disqualifications.test.ts` | 6638 | 6675 | accepts only a closed, evidence-backed citizenship predicate projection |
| 93 | `tests/requirements/requirement-parser.test.ts` | 6676 | 6833 | multi-source HTML and spreadsheet fragments form one traceable complete set |
| 94 | `tests/requirements/source-surface-composition.test.ts` | 6834 | 6961 | complete composition is hash-verified and records all material contracts |
| 95 | `tests/transport/transport-raw.test.ts` | 6962 | 7035 | FixtureTransport returns the original HTML Fixture bytes and MIME |
