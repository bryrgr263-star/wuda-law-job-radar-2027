# Autonomous discovery implementation ledger

## Completed foundation

- Approved design and plan committed as `8cfe78577728c9cf5a09a7f8d39999211d55153e`.
- Deterministic import of 46 historical sources produces 46 seeds, 46 research observations and 46 untrusted candidates in memory.
- Research defaults, entry overrides, field origins, original claims and exact input SHA-256 retained.
- Historical officiality assertions do not become runtime verified officiality.
- Catalog rejects stale integrity hashes, conflicting identities, revision gaps and missing upstream records; callers receive detached copies.
- Admission proposal is unapproved review metadata only. Existing Admission validator integration remains pending.
- Initial offline budget primitive denies absent/revoked/expired scope, non-exact targets, excessive requests and response sizes. It is not a live HTTP authorization boundary.

## Remaining approved implementation tasks

- Typed artifact payload validation, verification evidence and candidate revision semantics.
- Root-owned scope issuance/restoration, durable request reservations, crash recovery, fairness/frontier accounting, DNS/address safeguards and privacy validation.
- Offline directory adapter and discovery root; no live transport is implemented or authorized.
- Existing SourceAdmission review-path integration without registration or authorization issuance.
- Append-only Git discovery store, fixed-SHA fresh child Process B and deterministic recovery.
- Persisted historical migration and import/run entry points.
- Architecture import-closure tests and final independent review.

## Verification so far

- Initial missing-module RED observed before implementation.
- Foundation focused tests: 5 PASS, 0 FAIL.
- TypeScript passed after initial implementation; repeat required before foundation commit.
- No live requests, production grants, scheduler runs or publication.

## Honest readiness boundary

This is an incomplete offline foundation, not verified autonomous discovery. There is no durable Discovery Process B yet. The budget primitive must not be connected to a live transport before the remaining approved safety and persistence tasks are complete. Historical research migration has been verified in memory only; no production or discovery-state migration has been performed.

National Energy authorization breakpoint and Haier natural-run verification are outside this task and remain untouched.
