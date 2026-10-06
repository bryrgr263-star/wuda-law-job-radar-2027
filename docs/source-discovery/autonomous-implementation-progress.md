# Autonomous discovery implementation ledger

## Completed foundation

- Approved design and plan committed as `8cfe78577728c9cf5a09a7f8d39999211d55153e`.
- Deterministic import of 46 historical sources produces 46 seeds, 46 research observations and 46 untrusted candidates in memory.
- Research defaults, entry overrides, field origins, original claims and exact input SHA-256 retained.
- Historical officiality assertions do not become runtime verified officiality.
- Catalog rejects stale integrity hashes, conflicting identities, revision gaps and missing upstream records; callers receive detached copies.
- Admission proposal is unapproved review metadata only. Existing Admission validator integration remains pending.
- Initial offline budget primitive denies absent/revoked/expired scope, non-exact targets, excessive requests and response sizes. It is not a live HTTP authorization boundary.

## Runtime closure implementation

- `GitDiscoveryStore` writes canonical records and an ordered integrity manifest to Git objects in `discovery-state/` only. Commits retain the entire parent tree outside that namespace and advance HEAD with expected-parent CAS. No index/worktree mutation, remote push or production writer is part of this store.
- Writer refuses repositories containing authoritative production state namespaces. Use an isolated local/bare Discovery repository; development code commits are separately integrated normally into the project. This prevents an import/runner invocation from appending candidate events to the production journal repository.
- Recovery fixes a full commit SHA, checks canonical bytes, schema, identity, integrity, upstream references and revisions; manifest prefixes and immutable record Git blob identities are checked at every historical namespace change. Namespace deletion and mutate-then-restore history fail closed.
- `DiscoveryRoot` fixes its expected commit and approved discovery-scope hash. Reservations are committed before the fixture send lifecycle. Crash-unknown reservations remain unresolved and consume budget; neither a new run ID nor restoration of another idle run can bypass the repository-wide gate.
- Budget replay re-executes the recorded RESERVE/SENT/OBSERVE transitions and compares deterministic integrity. Limits cover organizations, endpoints, exact URLs, requests including retries, domains, runtime, response bytes, total bytes and candidate count. Revocation, expiry and over-budget states fail closed.
- Cross-run cooldowns follow persisted outcomes (normal 72 hours; network failures 24 hours with exponential backoff capped at seven days). Same-run authorized second endpoints remain possible. Stable due-time ordering reserves at least 30% of selection capacity for unknown/unsignaled seeds.
- Directory links are observations, not requests. Safe deferred frontier survives in Git. Publisher surface and canonical exact target determine untrusted candidate continuity; changing employer text creates a persistent review conflict, never an automatic entity merge or trust upgrade.
- Officiality, recruitment-year signal, legal discovery signal and admission disposition have separate evidence records referencing observations/candidates. New candidate seeds and review proposals remain unapproved.
- `validateDiscoveryAdmissionDraft` calls the existing `validateSourceAdmission`, accepting only an unapproved REVIEW draft matching the observed endpoint. It never registers or revises Admission and never issues authorization. Third-party policy is unchanged.
- Root accepts plain `OFFLINE_DIRECTORY_FIXTURE` JSON, not a transport callback. This is an enforced offline boundary: no fetch, HTTP client, DNS request, browser, production transport, production credentials or paid provider is accepted. Fixture address/URL/challenge checks are tested; they are not a claim of live DNS pinning or live transport readiness.
- The import CLI reads the original research pool at a full fixed Git SHA; default is dry-run. The runner CLI operates in an explicitly supplied isolated Git repository using approved-hash scope plus offline fixture data. No scheduler/workflow integration exists.

## Execution boundaries

Original 46-source artifacts are unchanged; persistent migration is exercised in isolated test repositories, not reissued into production. Scope approval references and SHA-256 checks are provenance/integrity, not cryptographic signatures. Candidate catalog recovery is not production Trusted Registry recovery.

Live pilot remains NOT_RUN. A specific directory/seed exact surface and its discovery access policy have not been approved. There is deliberately no live transport in this offline implementation; production authorization is not interchangeable with discovery permission. This is an execution gate, not an external-network failure.

No unspecified Final Closure phase is started by completing this implementation.

## Verification so far

- Initial missing-module RED observed before implementation.
- Foundation focused tests: 5 PASS, 0 FAIL.
- TypeScript passed after initial implementation; repeat required before foundation commit.
- No live requests, production grants, scheduler runs or publication.

## Final offline verification, 2026-10-06

- Final low-concurrency Discovery / Architecture / Source Admission / Network Guard collection: **74 PASS, 0 FAIL**, exit 0.
- Includes fresh independent child Process B restoring canonical catalog and budget hashes, historical 46-source claims, new-directory candidate evidence, immutable history, global pending/cooldown gates and revocation.
- TypeScript: PASS. `git diff --check`: PASS.
- Independent final focused review: no residual blocker after repository-wide resume gate correction.
- Diff for production-state, production owners, workflows, Pages/Web and Legacy: zero.
- NEW REGRESSION = 0 in the required focused verification scope; full unrelated business regression was not rerun.
- Discovery implementation and runtime: VERIFIED **OFFLINE ONLY**. Live Pilot = NOT_RUN (specific discovery access scope unapproved; no live transport enabled).
- Original design/catalog commits are preserved. Production baseline fresh restore and final remote integration are separately recorded in the task's final report.

## Independent review

The reviewer identified stale-root budget rollback, cross-run crash/cooldown bypass, privacy redaction, mutable candidate identity/conflict, deferred frontier loss and historical blob mutation gaps. Each was addressed locally with focused regression coverage. Final verification results are recorded after the last run, not inferred from the earlier five foundation tests.

National Energy authorization breakpoint and Haier natural-run verification are outside this task and remain untouched.
