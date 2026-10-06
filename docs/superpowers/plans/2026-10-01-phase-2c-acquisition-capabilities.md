# Phase 2C Acquisition Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add finite authorized queries, permission-separated structured endpoint discovery, and verified PDF text evidence to the existing production acquisition chain.

**Architecture:** Existing Source Admission/Continuous owners remain the sole network authority. New evidence derives only from verified Raw/Snapshot, persists in versioned existing acquisition bundles, and is revalidated before existing Process B/business replay. No automatic source admission or business rule changes.

**Tech Stack:** Existing pinned Node/PNPM, TypeScript, tsx/node:test, Cheerio, SHA-256/canonical-artifact-registry, GitRawObjectPersistence; planned exact server-only `pdfjs-dist@5.4.149` subject to C1 security/compatibility gate.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-2c-acquisition-capabilities-design.md`.

## Global Constraints

### Human scope decision — A+B only

Approved implementation order: B → A. C1–C7 are DEFERRED_BY_PREVALENCE_EVIDENCE; no PDF dependency or decoder is authorized. Existing C design is retained. Revalidation follows the approved A/B source list; Bank remains evidence-blocked where PDF is required. After A/B validation, prepare the existing 13-source static HTML admission queue without admitting it.

Execution checkpoint: B1/B2 pure helper and offline tests added; focused 4/4 PASS and TypeScript PASS. No network authority integration or production activation has occurred. B3–B7 and A1–A6 remain pending; no historical compatibility or full Phase 2C completion claim is made at this checkpoint.

- A/B implementation is human-approved; C is deferred. This scope note supersedes the original three-capability execution order without expanding the design.
- Order B → A → approved A/B revalidation. No second batch/discovery.
- Defaults DENY; GET/credentials omit/manual redirect unchanged; no cookies stored/replayed, login, CAPTCHA bypass, browser or arbitrary JS.
- Maximum pages 32, materialized targets 64, request attempts 64 per query-enabled run; explicit combination inventory, independent per-target grants and existing minimum cadence.
- Preserve all v1 bytes/IDs/seals/journal; no defaults injected into historical objects. Unknown versions fail closed.
- PDF limits: 20 MiB, 100 pages, 100,000 items, 2,000,000 UTF-16 characters, 256 MiB worker heap, 30,000 ms deadline; no OCR.
- No production activation, Scheduler dispatch, Pages/Legacy/business-rule edits or automatic push. R3 only after actual APPROVED Admission.
- All tests use Network Guard and offline fixtures/temp Git remotes. No test creates a production grant or touches main state.

## Review Focus

1. Encoded duplicate/alias query versus exact authorization identity: B2 tests both canonicalizer and raw request validator.
2. Valid base URL plus unapproved parameter combination: B3/B5 ensure no RESERVE/send.
3. Genuine empty page versus parsing failure, or changing metadata hiding repeated jobs: B6 retains PARTIAL/blocked evidence rather than claiming COMPLETE.
4. PDF partial glyph/page loss and empty-password encryption: C2/C6 reject completeness; no caller text can cure it.
5. Mixed v1/v2 restart, missing parser profile and old-binary rollback: B7/A6/C7 preserve original bytes and fail unknown/incomplete versions.

## File map (planned, not existing implementation)

| Responsibility | Create | Modify only as needed |
| --- | --- | --- |
| B contract/URL validation | `lib/application/source-admission/query-authorization.ts` | types.ts, continuous-acquisition.ts, source-admission-register.ts, index.ts |
| B authorization/persistence wiring | corresponding focused tests | production-persistence/contracts.ts, continuous-source-context.ts, source-owner-rehydration.ts, source-execution-request-intent.ts, source-execution-request-plan.ts, continuous-request-gate.ts, zero-cost-production-composition-root.ts |
| B pagination stops | `tests/p2-03/authorized-pagination.test.ts` | collection-runtime/collection-runner.ts, types.ts, ingestion/adapters/contract.ts |
| A pure discovery | `lib/ingestion/adapters/endpoint-discovery.ts` | ingestion/adapters/index.ts and exports |
| Shared evidence persistence | `lib/production-persistence/acquisition-evidence.ts` | contracts.ts, git-raw-object-persistence.ts, zero-cost-production-composition-root.ts and exports |
| C decode/profile/worker | `lib/ingestion/adapters/pdf-evidence.ts`, `pdf-evidence-worker.ts`; `lib/production-persistence/production-pdf-extraction.ts` | adapter contract, runner/root await seam, package.json/pnpm-lock.yaml |
| Focused tests | files named in each task below | existing Continuous/raw/restoration/architecture tests where extending their contract |
| R report/configuration | `docs/source-discovery/2026-10-01-phase-2c-revalidation.md` | new source-specific adapters/config ONLY if independently admitted |

No global formatter, browser dependency, SQL table, alternative registry or generic webpage-to-business-facts engine.

## Delivery checkpoints

Small commits after B1–B2, B3–B7, A1–A6, C1–C7, and R if approved. Within each checkpoint run the task's red/green cycle. Do not commit incomplete privilege-enabling wiring; pure helpers can land unregistered. Stage only explicit files. Fetch/review remote before integration; preserve legitimate scheduler history. No giant all-capabilities commit, force push, or history rewrite.

### B1 — Finite contract model

**Files:** Create `lib/application/source-admission/query-authorization.ts`; tests `tests/production-persistence/query-authorization.test.ts`; modify types.ts/contracts.ts/export files only for types.

**Interfaces:** `QueryAuthorizationContract` per spec; `assertQueryAuthorizationContract(contract): void`; `sealQueryAuthorizationContract(content): QueryAuthorizationContract`.

- [ ] Write tests rejecting duplicate parameter names/values, unbounded patterns, absent combination inventory, pagination >32 or attempts >64; assert defensive clone and seal tamper rejection.
- [ ] Run `pnpm exec tsx --test tests/production-persistence/query-authorization.test.ts`; confirm expected missing-helper failure.
- [ ] Implement closed combinations, explicit required/optional parameters, bounds and schema/hash checks; no network calls.
- [ ] Run focused test green. Preserve existing v1 query policy object unchanged.

### B2 — Canonicalization and validator

**Files:** Same helper/test files as B1.

**Interfaces:** `canonicalizeApprovedQueryTarget(rawUrl: string, contract: QueryAuthorizationContract): string`; `assertApprovedQueryRequest(rawUrl, contract): void` rejects noncanonical raw input.

- [ ] Test `?page=2` accepted only when explicit, `?page=02`, `?page=5` beyond approved bound, duplicates, `+`, `%70age`, `%32`, lowercase escapes, malformed UTF-8, unknown filters, fragments/userinfo, and invalid combinations rejected.
- [ ] Test `?z=%E7%94%B2&a=1` canonicalizes to `?a=1&z=%E7%94%B2`, while request validator rejects the unsorted raw form; raw unescaped non-ASCII components fail the encoding check. Include cross-locale equality.
- [ ] Run same focused command red; implement the spec's ASCII/RFC3986 algorithm with no localeCompare.
- [ ] Run green, `pnpm typecheck`, `git diff --check`; commit only B1/B2 helper/types/tests as a non-enabled checkpoint.

### B3 — Continuous integration

**Files:** Modify `continuous-acquisition.ts`, register, types, contracts, continuous-source-context and source-owner-rehydration; test `tests/production-persistence/continuous-query.test.ts` using existing continuous-acquisition-fixture.

**Interfaces:** Existing validate/issue/reserve/restore functions accept version-discriminated v2 targets; no new grant issuer. New grant payload includes `request_contract_version` and `query_contract_hash` only for v2.

- [ ] Write tests: independent page grants, unknown combination denied before RESERVE, contract hash tamper, revoke, cadence, pending RESERVE, mismatched revision requires reauthorization; v1 grants compare exact old bytes and IDs.
- [ ] Run `pnpm exec tsx --test tests/production-persistence/continuous-query.test.ts` red.
- [ ] Implement dual contract verification and existing owner replay; no implicit mutation/reissue of old grants.
- [ ] Run green plus existing continuous-acquisition/gate tests; no main state writes.

### B4 — Request intent/plan integration

**Files:** Modify source-execution-request-intent.ts, source-execution-request-plan.ts and root planning seam; test `tests/production-persistence/query-request-plan.test.ts`.

**Interfaces:** Existing seal/read/assert helpers dispatch v1/v2 by explicit schema. V2 target policy binds query hash; complete finite inventory precedes acquisition.

- [ ] Test query contract/exact target inventory/grant mismatch, surplus fourth target, unknown schema, mutated intent and outcome binding; preserve v1 exact-key rejection.
- [ ] Test early-stop planned but unrequested entries carry safe dispositions and no fabricated Snapshot/attempt. V2 final-plan output dispositions must not be compared verbatim against pre-request intent; compare only the original immutable planned-target projection.
- [ ] Run focused file red; implement versioned branches, not normalization of v1 payloads.
- [ ] Run green plus `tests/production-persistence/source-execution-outcome.test.ts`.

### B5 — Transport enforcement

**Files:** Modify continuous-request-gate.ts; extend continuous-transport.test.ts and continuous-query.test.ts.

**Interfaces:** executeContinuousRequest derives verified v2 request context from committed source/grant; direct official transport remains DENY without verified context. Public boolean/object cannot authorize query.

- [ ] Test query request with no context sends zero requests; allowed target invokes mock once; unknown query/base-only grant/cross-origin rejected; credentials omit, cookie discard and redirect/auth/challenge stops remain.
- [ ] Run focused transport/query tests red; implement current-context revalidation immediately before reserve and send.
- [ ] Run green and existing Continuous suite. Ensure never silently strips or reorders an attempted noncanonical query.

### B6 — Pagination safety

**Files:** Modify CollectionRunner/types and adapter contract only for optional pagination fingerprint/empty result configuration; create authorized-pagination.test.ts.

**Interfaces:** Existing run(input) remains entry; optional versioned pagination safety configuration supplies approved inventory and adapter-derived extracted-content fingerprint. It is NOT SOV semantic equivalence.

- [ ] Test repeated locator, different raw metadata/same extracted page, empty later page, malformed extraction not empty, first-page suspicious empty, out-of-range nextPage, attempts exhausted through retries.
- [ ] Run `pnpm exec tsx --test tests/p2-03/authorized-pagination.test.ts` red.
- [ ] Add safe stop reasons; no requests after stop, all previously extracted records retained, required unvisited pages yield PARTIAL.
- [ ] Run green plus `tests/p2-03/collection-runner.test.ts`, `collection-timeout.test.ts`, and `collection-runtime-boundary.test.ts`; keep defaults behavior unchanged for old adapters.

### B7 — Historical/mixed restoration checkpoint

**Files:** Create `tests/production-persistence/acquisition-capability-compatibility.test.ts`; extend continuous-root/restoration tests only for v2 fixtures.

**Interfaces:** Existing zero-cost root restore() and fresh Process B. No second restorer.

- [ ] Pin historical state at `695f197a4c9eb281d4dee99a938daf569345edf0` using existing committed-state/temp-fork test patterns, never drifting HEAD/ignored output/absolute machine fixture paths. Build a temporary Git remote with that v1 state and a new controlled-test v2 grant/intent/plan; compare every preexisting immutable v1 fact/manifest/journal file hash and artifact ID before/after. New state-head indexes may change, historical indexed snapshots may not.
- [ ] Independent child Process B restores, verifies original v1 bytes and new finite grant, rejects missing/unknown contract version; no acquisition on restore.
- [ ] Run compatibility test plus continuous-root, trusted-chain-restoration, Architecture/Network Guard and TypeScript.
- [ ] Stage reviewed B wiring/tests and commit the B checkpoint only when all focused cases pass; stop if historical mismatch, never rewrite baseline expected hashes.

### A1 — Discovery evidence contract

**Files:** Create endpoint-discovery.ts, acquisition-evidence.ts; tests `tests/adapters/endpoint-discovery.test.ts`.

**Interfaces:** `discoverEndpointReferences(input: { snapshot: Snapshot; raw_blob: RawBlob; parent_source_artifact_id: string; parent_endpoint_artifact_id: string; profile: EndpointDiscoveryProfile }): readonly EndpointDiscoveryEvidence[]`. `EndpointDiscoveryProfile` has pinned ID/version, permitted locator/mechanism/purpose/GET/content-kind definitions; no runtime JS.

- [ ] Test input Raw SHA/Snapshot/URL mismatch, stable evidence ID/hash and discovered_at from Snapshot, invalid locator and safe redacted sensitive reference.
- [ ] Run focused red; implement schema and pure binding validation with existing canonicalHash.
- [ ] Run green; evidence is CANDIDATE/REVIEW_REQUIRED, not a SourceAdmission or transport capability.

### A2 — Strict JSON/HTML extraction

**Files:** endpoint-discovery.ts and test from A1.

**Interfaces:** Same pure discovery helper; embedded JSON records use existing ExtractedRecordV2 creation from parent Snapshot.

- [ ] Test HTML attribute, JSON Pointer, strict hydration JSON; malformed JSON, computed JS URL/assignment, hostile base tag and cross-origin reference; global fetch mock must be called zero times.
- [ ] Test login/token reference yields null endpoint strings and hash-only reference evidence; no token in JSON serialization/log capture.
- [ ] Run red; implement Cheerio/JSON.parse only, no eval/new Function/script interpreter.
- [ ] Run green; no guessed employer/year/title from script paths.

### A3 — Admission boundary

**Files:** Modify source-admission types/register validation as necessary; test `tests/production-persistence/dynamic-admission.test.ts`.

**Interfaces:** Existing register/revise consumes discovery evidence references in reviewed evidence records. Independent existing SourceAdmission remains mandatory.

- [ ] Test same-origin candidate alone denied; cross-origin candidate alone denied; independent official-referral/access-reviewed admission may be represented but no auto-grant.
- [ ] Run red; wire hash/parent/provenance references without adding a new SourceComposition pre-discovery boundary.
- [ ] Run green and existing admission tests.

### A4 — Authorization integration

**Files:** Same dynamic-admission test, existing Continuous integration seams.

**Interfaces:** Existing issueContinuousAuthorization uses the endpoint's independently versioned admission/allowlist. B contract applies if endpoint has query.

- [ ] Test parent grant cannot fetch endpoint, discovered link cannot reuse another target grant, changed discovery/admission revision requires reviewed reauthorization.
- [ ] Run red; only wire existing owner checks, do not introduce dynamic trust inheritance.
- [ ] Run green plus Continuous tests.

### A5 — Acquisition/evidence persistence integration

**Files:** Modify contracts.ts, git-raw-object-persistence.ts, zero-cost root; acquisition-evidence.ts; test `tests/production-persistence/acquisition-evidence-persistence.test.ts`.

**Interfaces:** Existing AcquisitionPersistenceBundle gains new-bundle-only `evidence_contract_version` and supplement; raw acquisition manifests/state have dual v1/v2 readers. `assertAcquisitionEvidenceSupplement(...)` validates all hashes/bindings. No new repository.

- [ ] Test acquisition+supplement atomic append, same bytes reuse, collision, missing evidence, manifest tamper, injected v2 fields into v1, mixed chain sequence and unchanged v1 bundle hash.
- [ ] Run red; use existing Raw owner staging/CAS and immutable fact references for supplements.
- [ ] Run green plus git-raw-object-persistence existing tests; failed append never leaves accepted trusted evidence.

### A6 — Fresh restoration and A checkpoint

**Files:** Extend acquisition-capability-compatibility/dynamic-admission/endpoint-discovery tests; root restoration seam.

**Interfaces:** restore() recomputes discovery from committed raw before existing SOV journal replay.

- [ ] Child Process B starts with no parent memory, recomputes canonical discovery bytes and rejects changed raw/locator; rejected endpoint has zero request count.
- [ ] Run focused A/B tests plus Process B, Architecture/Network Guard, TypeScript, diff check.
- [ ] Commit reviewed A checkpoint only; do not admit Post/Shenzhen merely because framework tests pass.

### C1 — Decoder boundary and dependency gate

**Files:** Create pdf-evidence.ts, pdf-evidence-worker.ts, production-pdf-extraction.ts; test `tests/adapters/pdf-evidence.test.ts`; package.json and pnpm-lock.yaml only after implementation approval.

**Interfaces:** `decodePdfEvidence(snapshot: Snapshot, raw: RawBlob): Promise<PdfExtractionEvidence>`; root `extractProductionPdfEvidence({ snapshot_id, extraction_profile_id })` resolves bytes/profile itself, no text parameter. `PdfExtractionEvidence` per spec, no trusted branding constructor.

- [ ] Verify exact package availability/integrity, licensing/security and existing pinned Node compatibility read-only; stop for amendment if parser unsafe or incapable.
- [ ] Write red tests rejecting supplied-text API/invalid Snapshot/Raw hash and external resource loads; dependency installation is implementation, forbidden until approved.
- [ ] Add exact pdfjs-dist@5.4.149 and pin lock, configure versioned data-only no-eval/no-fetch worker and local resource-manifest hashing.
- [ ] Run focused green; reject unknown profiles/resource versions. No recruitment network request for parser validation.

### C2 — Deterministic pages

**Files:** Decoder/worker and pdf-evidence.test.ts; explicit generated TEST_ONLY text PDFs in `tests/fixtures/acquisition-capabilities/pdf/`.

**Interfaces:** PdfPageEvidence uses page_number, ordered blocks, page text, block start/end/hasEOL; successful canonical result contains no runtime timestamps/geometry/paths.

- [ ] Test decode twice and in independent child, exact canonical bytes equal; non-ASCII text, explicit newlines, two pages, actual item index/order fixed.
- [ ] Test missing font/CMap and malformed Unicode never silently COMPLETE; no visual reordering/table inference.
- [ ] Run red; implement text-item extraction and page completeness under pinned parser options.
- [ ] Run green under Network Guard, including worker. Keep copied raw bytes unchanged by parser transfer.

### C3 — Locator round-trip

**Files:** pdf-evidence.ts/test.

**Interfaces:** `resolvePdfEvidenceSpan(evidence, { page_number, block_index, start_offset, end_offset }): string`; checks source/page/block bounds and UTF-16 offsets.

- [ ] Test substring matches every emitted locator; page zero/out-of-range/span overlap beyond block rejects; cross-page evidence uses multiple locators.
- [ ] Run red; implement locator IDs derived from raw/parser/profile, not employer/title or floating geometry.
- [ ] Run green; no section/table label without heading-span binding.

### C4 — Raw/Snapshot root binding

**Files:** production-pdf-extraction.ts, root preparation seam; test `tests/production-persistence/pdf-evidence-root.test.ts`.

**Interfaces:** root reference-only method from C1; existing verified Raw storage and supplement persist evidence. Profile IDs resolve only locally registered reviewed versions.

- [ ] Test wrong Snapshot, raw object missing, digest mismatch, caller-supplied fake decoder result and fixture preprocessed text reject; original raw persists on decode failure.
- [ ] Run red; add root-owned resolution and output validation, no second trusted registry/cache injection.
- [ ] Run green; decoder never fetches URL from caller/PDF.

### C5 — Async ExtractedRecord integration

**Files:** ingestion/adapters/contract.ts, collection-runtime/collection-runner.ts, zero-cost root; pdf profile helper; pdf-evidence-root.test.ts.

**Interfaces:** extract returns array or Promise of array; runner/root wrapper await. PDF source mapper consumes only root-prepared evidence and creates existing ExtractedRecordV2 with validated DOCUMENT locator and namespaced evidence references.

- [ ] Test synchronous historical adapter exact bytes unchanged; asynchronous PDF adapter errors become extraction failures, not successful empty pages.
- [ ] Test evidence surfaces don't invent position/employer, common conditions do not attach to all roles, source mapper locators must exist in evidence.
- [ ] Run red; implement minimal await seam, identify/typecheck every extract caller, no unrelated runtime refactor.
- [ ] Run green plus CollectionRunner/ExtractedRecord/source-composition tests.

### C6 — Failure semantics

**Files:** pdf-evidence tests/root tests; TEST_ONLY malformed/encrypted/scanned/partial fixtures in explicit fixture directory.

**Interfaces:** safe failure code set per spec; partial text is evidence-only, cannot satisfy complete package.

- [ ] Test malformed/repair warning, encrypted and empty-password encrypted, image-only, mixed visual content, unsupported font, page failure, limits and worker timeout.
- [ ] Run red; implement failure classification, worker cleanup and no-guessing rules; assert no RequirementFact/Eligibility created by decoder.
- [ ] Run green; log capture contains no PDF metadata/contact/password values.

### C7 — Restoration, real-PDF acceptance and C checkpoint

**Files:** compatibility/root tests; new `tests/adapters/bank-2027-pdf-evidence.test.ts` only if real approved bytes acquired and privacy-reviewed; fixture manifest under `tests/fixtures/acquisition-capabilities/pdf/`.

**Interfaces:** existing Process B resolves supplements and re-decodes successful PDF with pinned resource manifest before downstream journal. Parser failure records are checked, not trusted as successful extraction.

- [ ] Independent Process A→temp Git→Process B verifies page spans/canonical bytes; altered parser version/resource hash/missing supplement fail closed; historical v1 restoration unchanged.
- [ ] Use existing immutable local bank PDF if available. If absent, real bytes are an explicit later controlled/read-only approved evidence step, not fetched by unit tests and not synthesized from web-reader text. Record URL, SHA, byte length, observed time and TEST_ONLY scope; privacy review before versioning.
- [ ] Confirm seven pages and exact common/group locators; institution details still missing must retain incomplete composition. Raw PDF metadata is included in privacy review; do not sanitize original bytes or quietly waive the project's personal-data rules to create a fixture. If safe versioning or reliable extraction cannot be proven, real-PDF acceptance remains BLOCKED, not fabricated COMPLETE.
- [ ] Run C focused, restoration, Architecture/Network Guard, TypeScript and diff check; commit C only when passed. No production source count changes.

### R1 — Revalidate original five blockers

**Files:** phase-2c-revalidation.md; source-specific acceptance tests/config if warranted, no universal employer switch.

**Interfaces:** existing Source Registry/Admission structures plus new validated helpers. Research observations are not production records.

- [ ] For each of five report previous status, capability used, closed/remnant blocker and new status; obtain only bounded separately permitted evidence.
- [ ] CRRC major list still not a Position; Post/Shenzhen require actual exact public job endpoint bindings; Bank supplements required; Junhe vacancies remain undated absent year evidence. If headerless production responses differ and require a new language-header contract, record a fourth NEW CAPABILITY GAP without adding header permission.
- [ ] Record fourth capability gap without implementing it. No unsupported claim from one timeout/403 and no false exclusion for lack of current law/2027 vacancies.

### R2 — Admission decision gate

**Files:** reviewed source-specific config/admission evidence only if complete; phase-2c-revalidation.md.

**Interfaces:** existing register/revise with official ownership/referral, access policy, exact finite inventory, extraction profile and composition evidence.

- [ ] Run per-source acceptance tests first; approve only actually bound safe surfaces, explicitly distinguish research recommendation from sealed APPROVED Admission.
- [ ] Record zero approval when evidence incomplete; do not fill quotas or batch-approve the five.
- [ ] Any activation changes require reviewed target/authorizer evidence; this design itself is not that evidence.

### R3 — Approved-only controlled first acquisition

**Files:** existing production root/source activation configuration and per-source report; no Scheduler workflow changes.

**Interfaces:** existing root issuer/runProduction with independently approved exact targets and revocable grants; existing raw/trusted processors only.

- [ ] Re-fetch authoritative head, gate source/grants/cadence/RESERVE and exact intent inventory. Any failure: stop without request.
- [ ] Execute once per approved scope; record Raw/Snapshot/ExtractedRecord/Recall and safe downstream stop. No automatic API exploration, retry authorization extension or synthetic candidate evidence.
- [ ] Verify fresh Process B, source outcomes, no duplicate Position and unchanged history. Record zero acquisition if no source approved.
- [ ] Final report A/B/C statuses, five sources, counts, exact commits/remote/worktree and remaining blockers; stop without Phase3/schedule/Pages changes.

## Final verification / review gates

- [ ] Review patch dependencies for Legacy, second authorities, browser/OCR and public/private leaks; helpers must not authorize requests or make business conclusions.
- [ ] Run `pnpm typecheck`, `pnpm test:architecture`, `pnpm exec tsx --test tests/p2-03/network-guard.test.ts`, focused B/A/C and relevant Process B tests, then `git diff --check`.
- [ ] Because Continuous/raw/runner seams are shared, run their relevant P1 transport/adapter/registry/normalization/integration regressions. Do not mechanically run all historical tests; enlarge scope only with a concrete affected path.
- [ ] Preserve known parity baseline failure classification; any new stable failure blocks completion and cannot be labeled historical.
- [ ] Independent final review after implementation if supported; no claim that design review equals completed code verification.
- [ ] Only normal fast-forward integration after fresh remote review; preserve legal automatic commits. Push/production activation requires the approved implementation delivery scope, not inference from this plan.

## Design-only handoff

This plan is written, not executed. No checkbox is completed, no dependencies installed, no fixtures acquired, no code/tests/workflows altered. Recommended execution is Native with final independent review, delivered at B/A/C checkpoints because authorization and replay seams are sequentially coupled. Human must review/approve this plan and choose/confirm execution before any implementation.
