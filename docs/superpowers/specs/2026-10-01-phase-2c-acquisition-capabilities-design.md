# Phase 2C acquisition capabilities — design for review

## Status, purpose and frozen scope

The human approved MINIMAL ARCHITECTURE GAP CONFIRMATION and authorized this written spec and implementation plan. This document is not approval to execute the plan, issue authorization, or change production state. Written-plan acceptance remains a human gate.

Reviewed baseline: `695f197a4c9eb281d4dee99a938daf569345edf0`, local HEAD and fetched remote main equal; clean before drafting. Startup fix `80bfbc8becc5c8e7dbdf7f4becf9b71863a64225` remains an ancestor. A later legitimate remote commit must be inspected/preserved before any implementation integration; no force push or journal rewrite.

Goal: close only (B) finite authorized query/pagination, (A) public structured-data acquisition, and (C) provenance-preserving PDF text extraction, in that order. The five first-batch sources are acceptance cases, not hardcoded employers. No second batch, second crawler/registry/authority, browser automation, OCR, new business domain, Candidate Evidence change, Scheduler/cadence/status change, Pages change, or Legacy change.

Discovery != Admission != Authorization != Acquisition != Extraction != Business Evidence. Success at one stage does not grant the next stage's permission or trust. Evidence shortage stays REVIEW_REQUIRED/EVIDENCE_BLOCKED; it never implies NOT_RELEVANT, INELIGIBLE or NOT_DISPLAY.

## 1. Existing owners and exact gaps

| Concern | Existing owner/component | Reuse / gap |
| --- | --- | --- |
| Source identity/revision | Source Registry, GitSourceRegistryPersistence, source-owner-rehydration | Reuse; no extra registry |
| Access approval | application/source-admission types/register | Existing third-party, DOCUMENT/DYNAMIC and endpoint-purpose concepts; add only versioned query constraints and discovery evidence references |
| Request authority | Continuous Acquisition records/context/request gate | Reuse GRANT/REVOKE/RESERVE/COMPLETE/fencing/cadence; today rejects all query |
| Request accountability | source-execution request intent/plan/outcome | Versioned query-aware branch required; v1 coverage/seals unchanged |
| Network | continuous-request-gate transport | Keep GET, stateless cookies-discarded behavior, credentials omit and manual redirect; query only after verified request contract |
| Runtime | CollectionRunner and RecruitmentAdapter | Existing page/attempt budgets and repeated-locator protection; add content/empty stop and awaitable extraction |
| Bytes/facts | RawCaptureService, GitRawObjectPersistence, ExtractedRecordV2 | Reuse raw objects, Snapshot and identity/hash validation; versioned evidence attachments needed |
| Semantic authority | SourceOccurrence/SOV, SourceComposition, trusted root/journal | Reuse processors; extraction evidence is not a new SOV authority |
| Composition boundary | OpportunityVersion-bound DiscoveryBoundary | Post-discovery composition only, NOT a pre-position network permission |
| PDF | DOCUMENT/page locators and attachment publication/position bindings | Existing binding semantics; no registered production PDF decoder; fixture text/live Canary not substitutes |

Existing `OfficialEndpointAllowlist.query_policy.ALLOW_LIST` validates names only. It is insufficient for continuous production requests and must not be silently reinterpreted as value authorization. Current v1 Continuous, request intent/plan and production transport independently enforce query denial.

## 2. Alternatives and selected approach

1. **Selected:** versioned finite request contract inside existing Admission/allowlist/grants; explicit per-target requests; extraction evidence attached to existing acquisition persistence; replay by existing root. Small reviewable changes, no new authority.
2. Names-only ALLOW_LIST or deleting query rejection: rejected; unlimited values/filters and historical interpretation change.
3. Browser execution, runtime endpoint auto-discovery or a new fetching service: rejected; expands permissions and duplicates acquisition ownership.

Decoder choice is Mozilla PDF.js `pdfjs-dist` **5.4.149**, exact dependency and lockfile integrity, server-only `legacy/build/pdf.mjs`. It is a reviewed API baseline, not a claim that it is latest or vulnerability-free. Installation/package-integrity/security and Node compatibility checks are C1 release gates; if that version cannot pass, stop for reviewed version amendment rather than substituting a library. Existing pinned Node/PNPM stay unchanged. No product dependency is installed during design.

Primary API basis: [versioned PDF.js source](https://github.com/mozilla/pdf.js/blob/v5.4.149/src/display/api.js), [versioned package metadata](https://github.com/mozilla/pdf.js/blob/v5.4.149/package.json). The implementation must use the versioned source, not assume draft API options match.

## 3. B — QueryAuthorizationContract v2

### 3.1 Shape and bounds

`QueryAuthorizationContract` is immutable, sealed configuration embedded in the versioned OFFICIAL_ENDPOINT_ALLOWLIST and referenced by Admission; it is not a standalone authority or registry.

- `schema_version: query-authorization/2.0.0`
- `base_exact_url`: canonical HTTPS URL with exact origin/path, no query, fragment or userinfo; non-default ports denied in v2.
- `parameters`: at most eight unique entries `{ name, required, allowed_values }`; names match `[A-Za-z][A-Za-z0-9_]{0,31}`.
- `allowed_values`: at most 64 finite distinct strings per parameter, each <=128 UTF-8 bytes without controls or credential values. Numeric pagination is materialized from a closed integer range into finite decimal strings; no runtime regular expression wildcard.
- `approved_combinations`: explicit vectors of name/value pairs, including an empty vector only when approved. This avoids an implicit Cartesian-product expansion.
- `pagination`: null or `{ parameter, minimum_page, maximum_page, ordering: ASCENDING_INTEGER, empty_stop: STOP, repeated_content_stop: STOP }`.
- `maximum_pages`: positive integer <=32; `request_budget`: positive integer <=64, counts all attempts/retries, not only successful pages.
- `canonicalization: QUERY_ASCII_RFC3986_V1`; `contract_hash` computed with existing canonicalHash over content excluding hash.

Each materialized URL is also a separate `continuous_acquisition_scope.exact_targets` entry, allowlist artifact and independent Continuous grant. At most 64 materialized targets in a query-enabled run. Every page still requires its own current grant, reservation, cadence and revocation check. A base URL grant never covers pages. Admission exact targets and approved combinations must match one-to-one; configured bounds can be stricter than these ceilings.

Constraints/value validation does not identify jobs or interpret requirements. No employer branching. Current three production targets retain their existing grants and 86,400-second cadence untouched.

### 3.2 Canonical bytes and request validation

Pure API: `canonicalizeApprovedQueryTarget(rawUrl: string, contract: QueryAuthorizationContract): string`. It either returns the unique approved serialized URL or throws a structured validation code.

Parse the raw query without permissive URLSearchParams ambiguity: require `name=value` components; reject duplicates, empty components, unknown names, missing required parameters, invalid UTF-8, userinfo, fragments, control characters, plus encoding, malformed/lowercase/noncanonical percent escapes, and encoded unreserved characters. Decode once, then re-encode exactly and require equality to the component. Literal values must be approved and combinations must be listed. Names sort by ASCII code point; values use UTF-8 RFC3986 escaping with uppercase hex, including escaping `!'()*` rather than using encodeURIComponent alone. Production request input must already equal the returned canonical URL; do not silently normalize an attempted request after authorization.

Numeric pages use `1`, not `01`, `+1`, `1.0` or encoded aliases. An omitted page and page=1 may both be approved fetch targets only if explicit configuration says so; they are never automatically equated. Repeated-content detection catches duplicate fetched evidence without merging authority identities.

Example, NOT a grant: Junhe base `/careers/locations/4` plus explicitly approved empty query and page=2,3,4. No request to those pages is authorized by this spec. Canonical multi-parameter tests must demonstrate ordering and rejection of an unapproved combination.

### 3.3 Integration and compatibility

New allowlists use `query_policy.mode: FINITE_VALUES`, carrying the complete contract. Existing DENY_ALL and names-only ALLOW_LIST payloads keep their bytes and prior semantics; ALLOW_LIST still cannot become Continuous-query authority.

Query-enabled grants alone carry `request_contract_version: continuous-request/2.0.0` and `query_contract_hash` in their canonical payload. Missing discriminator selects the historical v1 no-query codepath. Missing/unknown version, contract mismatch or v2 fields injected into a v1 object fail closed. Record schema/hash-chain algorithm remains unchanged; only genuinely new grants contain new payload fields. Historical grants are not reissued or enriched.

New request intents and plans use `source-execution-request-intent/2.0.0` and `source-execution-request-plan/2.0.0`, target policy `query: FINITE_VALUES` with contract hash and resolved canonical target. A v2 plan can include no-query targets only via an explicit DENY policy branch, never a fake finite-query grant. V1 serializers/verifiers remain byte-compatible, including exact-key checks. Historical no-query commands never receive v2 defaults/null fields. New versions dispatch validators explicitly; unsupported versions reject.

Transport enforcement must consume a root-verified immutable request contract derived from current committed versions/grant, not a caller-provided `allow_query` boolean. Direct `executeContinuousOfficialRequest` with no verified contract remains query-denying. Callers cannot confer trust by constructors, branding assertions or private Map injection; any request contract supplied across a helper boundary is checked against the current grant/allowlist hash before reservation and before send.

Request intent includes the entire approved finite inventory before any network request. Early stop retains those planned entries. A v2 final plan adds a per-target `execution_disposition` of REQUESTED or SKIPPED_BY_BOUNDED_STOP and optional safe `stop_reason_code`; REQUESTED requires actual observations, and SKIPPED requires no observations/reservations for that run plus an earlier verified empty/repeated-content/budget stop. Do not add these output fields to pre-request intent. Existing v1 source/batch outcomes and status semantics stay unchanged. Incomplete coverage is PARTIAL/SUSPICIOUS_EMPTY according to existing contracts, not false COMPLETE.

### 3.4 Pagination safety

Reuse CollectionRunner page/request/visited-locator budgets. Compare normalized extracted-content fingerprints defined by the pinned adapter extraction contract, excluding Snapshot/time/URL IDs but retaining actual vacancy fields. Exact raw hashes alone are an additional duplicate signal, not the sole detector; dynamic metadata can change raw bytes. This fingerprint only stops pagination and is NOT semantic-equivalence/SOV evidence.

Repeated content stops with `REPEATED_CONTENT_BLOCKED`; explicit empty page stops with `EMPTY_PAGE_STOP`. Neither licenses dropping previously extracted opportunities. Zero first page remains SUSPICIOUS_EMPTY unless a trusted completeness assessment establishes a legitimate empty result; an unparsed page is not empty. If unvisited required pages exist, preserve PARTIAL. Scheduled cadence, CAS, retries and pending-RESERVE recovery rules are not changed.

## 4. A — EndpointDiscoveryEvidence

### 4.1 Evidence, not permission

Pure deterministic extraction starts from a successful parent Snapshot and matching RawBlob; verify byte length/SHA, Source identity and approved parent locator. Read HTML/JSON using existing parsing tools and source-specific configuration, not employer-specific business logic.

Supported initial mechanisms:
- Explicit HTML endpoint attributes/links with configured locators and purpose.
- Script element containing valid JSON (application/json, application/ld+json or a specifically configured hydration JSON block).
- JSON Pointer to a reference in parent JSON.
- Script-source references as candidates only; reading that script requires separate admission/authorization.

Arbitrary JavaScript objects/assignments, computed URLs, function execution, imports and eval are not supported. A JSON parse failure is REVIEW_REQUIRED, never evidence that the page is empty. Script-embedded structured content must be strict JSON; no regular-expression execution of JS.

`EndpointDiscoveryEvidence` contains:
- `schema_version: endpoint-discovery-evidence/1.0.0`, stable `evidence_id` and `integrity_hash`.
- Parent source/endpoint artifact IDs, exact parent surface URL, Snapshot ID, RawBlob ID/SHA.
- Mechanism, extractor name/version, exact HTML selector/span or JSON Pointer locator, referenced text hash.
- `raw_referenced_endpoint`, `canonical_endpoint` or null; method GET, endpoint purpose and expected response content kind.
- `discovered_at = parent_snapshot.observed_at`, not wall clock.
- Origin relation SAME_ORIGIN/CROSS_ORIGIN, validation status CANDIDATE/REVIEW_REQUIRED and safe reason codes.
- Binding hash over parent references, locator/reference bytes, endpoint/method/purpose.

Credentials/tokens in referenced URLs must not be duplicated into evidence records: reject the candidate, store only a safe code/locator and reference hash, with endpoint strings null. Do not log the value. Existing Raw capture retention is separate; if a source embeds sensitive material, halt promotion and apply existing privacy review, not silent sanitization of raw hashes.

Canonical reference resolution is not authorization. Relative endpoints resolve against the exact parent URL; no implicit HTML base-tag trust. Cross-origin candidates remain REVIEW_REQUIRED until official referral/ownership evidence and a separate exact target are approved. SAME_ORIGIN still needs independent approval. Foreign domains may be admitted separately with official referral; parent trust never automatically expands origin/path scope.

### 4.2 State progression and extraction

`VERIFIED_PARENT → DISCOVERED_CANDIDATE → REVIEWED_ADMISSION → CURRENT_GRANT → RESERVED_REQUEST → RAW/SNAPSHOT → EXTRACTED_RECORD → EXISTING_TRUSTED_PROCESSORS`.

The candidate discovery helper makes **zero network requests**. It returns evidence, not a transport handle. Existing source admission register reviews references; existing Source Registry versions endpoint and allowlist; existing continuous gate requests it. The new exact endpoint must be predeclared in intent/plan. No request for discovered links during the same run unless independently approved/versioned before the run; this phase does not implement automatic approval.

Embedded JSON needs no additional fetch; its JSON Pointer is within the parent Snapshot. Endpoint binding does not prove response employer/job identity. Source-specific mapping must retain raw IDs and separate descriptions from candidate requirements, through ExtractedRecordV2 and existing SOV/composition invariants. No generic keyword-to-Relevance or Requirement inference.

## 5. C — Production PDF evidence

### 5.1 Root-owned input and decoder

Root API planned: `extractProductionPdfEvidence({ snapshot_id, extraction_profile_id })`. Caller supplies references only. The root resolves the successful committed Snapshot and its RawBlob through existing persistence, verifies hash/length/MIME and profile from registered local configuration, then calls the decoder. It never accepts supplied trusted text, supplied decoder output or URLs to fetch.

Internal decoder API: `decodePdfEvidence(snapshot: Snapshot, raw: RawBlob): Promise<PdfExtractionEvidence>`. It is an ordinary deterministic extraction helper, not a trust constructor. Root alone binds its results to acquisition/extracted evidence and rechecks them before downstream use. Helper outputs are not authoritative just because their type is correct.

PDF.js is fed a copied Uint8Array; no URL, headers, password, range transport or docBaseUrl. Disable eval, XFA, system font fallback, worker fetching, WASM/image rendering, streaming/range/autofetch. CMaps/fonts if necessary are bundled from the pinned package, read through fixed local factories with manifest hashes; never fetched from the PDF or network. Use a dedicated cancellable Node worker with no network-capable resource factory; worker is a computation boundary, not browser automation or a claimed OS sandbox. Network Guard must prove zero network activity, including workers.

Limits: input <=20 MiB, pages <=100, text items <=100,000, decoded UTF-16 characters <=2,000,000, worker heap <=256 MiB, deadline <=30,000 ms. Timeouts/limits are failed extraction observations, not deterministic successful output. Always terminate/clean up worker and parser on success/failure. Parse attachment active content as data only; never invoke PDF actions, scripts, navigation or external resources.

### 5.2 Exact output and locators

`PdfExtractionEvidence` contains schema `pdf-extraction-evidence/1.0.0`, evidence ID/hash; Snapshot/Raw IDs/SHA; parser package/version and local resource-manifest hash; extraction-contract version; `observed_at` fixed from Snapshot; document/page completeness and safe failure codes; successful page payloads.

Read pages in ascending one-based order. `getTextContent` uses `disableNormalization: true` and `includeMarkedContent: false` from the versioned API. Ignore structural markers, preserve decoder text-item order. Each text item is a **decoder block**, not a claim about visual paragraph/table order. Page text concatenates item strings and an LF only for explicit hasEOL; no inferred spacing, Unicode folding, OCR or punctuation changes. No timestamps, OS path, locale sorting or floating geometry enters canonical text/evidence. Each block stores item index, string, UTF-16 start/end offsets and original hasEOL; offsets are half-open into page text. Page/block/span IDs are derived from Raw SHA, parser/contract version and locator, not employer/title.

Use existing DOCUMENT locator: `page_number`, `text_locator: pdf-text-v1/page/{p}/block/{b}`, `start_offset/end_offset` in page text; Snapshot and hash are in the evidence envelope and ExtractedRecordV2 binding. `SourceRecordLocator.text_locator` encodes the same item/span reference. A cross-page condition cites multiple exact spans; do not merge pages and erase boundaries. Tables/sections are not inferred visually. Source-specific section labels are allowed only with explicit heading spans and pinned mapping rules; ambiguous groups remain REVIEW_REQUIRED.

Decoder completeness does NOT prove recruitment-package completeness. Bank's PDF can be a valid common/group evidence surface while institution detail remains missing. Its conditions must not be assigned to every role, and no page/block gets an invented employer or Position identity. Decoder logs/errors are converted to safe structural codes; PDF author metadata, arbitrary parser messages or extracted contact details must not be echoed into diagnostics.

### 5.3 Fail-closed matrix

| Input/result | Extraction outcome | Downstream boundary |
| --- | --- | --- |
| Raw/Snapshot/hash mismatch | INTEGRITY_INVALID | No extracted evidence promoted |
| Non-PDF or malformed structure / parser repair warning | MALFORMED_PDF | Raw preserved; REVIEW_REQUIRED |
| Password request/encryption, including empty-password encrypted file | ENCRYPTED_PDF | Reject; never ask for password or decrypt to bypass policy |
| No text, image-only page or required page without text | IMAGE_ONLY_OR_UNLOCATABLE | EVIDENCE_BLOCKED, no OCR |
| Missing font/CMap, replacement characters, invalid Unicode or unresolved glyph mapping | UNSUPPORTED_ENCODING | No guessed text promoted |
| Page contains text plus unaccounted visual/image material | PARTIAL | Text retained as partial evidence only; no completeness claim |
| Parser drops/fails any required page | PARTIAL_EXTRACTION | Package COMPLETE not allowed |
| Resource limit / worker timeout | LIMIT_EXCEEDED / EXTRACTION_TIMEOUT | Safe failure observation, no partial text upgraded |
| Exact successful text extraction | COMPLETE_TEXT_EXTRACTION | Locator evidence eligible for existing composition validation; not automatic Requirement/Eligibility |

Do not claim all glyph loss can be detected by a replacement-character check. Missing font mapping, parser warnings and unaccounted content trigger review; undecidable extraction reliability cannot become COMPLETE. Detect encryption from parser document state/structured dictionaries, not just an unreliable `/Encrypt` byte substring. If the selected parser cannot provide required reliability/encryption signals, C remains BLOCKED pending a narrow design amendment.

### 5.4 Async seam and trusted integration

Extend RecruitmentAdapter.extract's return type to `readonly ExtractedRecord[] | Promise<readonly ExtractedRecord[]>`; CollectionRunner awaits it and the root's observed-adapter wrapper awaits before recording outputs. Existing synchronous implementations remain synchronous; no extra fields/time changes in their outputs. Other callers are typechecked; do not refactor unrelated adapters.

For PDF profiles, the root-owned extraction preparation derives evidence from raw bytes, and source-specific adapter projects only real page/section records using that root-controlled result. The preparation result is not a caller injectable cache. No requirement is inferred by the decoder. Root validates each ExtractedRecordV2 Snapshot/hash/locator against the prepared evidence. A generic PDF page is an evidence surface, not necessarily a position; emission into Recall requires the existing adapter identity/composition rules.

## 6. Persistence and Process B

### 6.1 Versioned evidence in existing acquisition persistence

Add an optional **new-bundle-only** `evidence_contract_version: acquisition-evidence/2.0.0` and `evidence_supplement` to AcquisitionPersistenceBundle. The supplement contains discovery/PDF evidence references and canonical payloads, resource-manifest references and hash. GitRawObjectPersistence continues to be the only byte/fact owner; no new evidence registry, database, journal authority or mutable trusted cache.

New acquisition manifests/state indexes use a v2 schema when carrying these references. The existing raw manifest hash chain can include v1 and v2 entries; sequence/previous hash stay enforced. Earlier immutable manifests, object bytes and state snapshots are not rewritten. When building a new state snapshot from an old one, retain the exact historical manifest references; new outer state uses its own version only. Mixed-version loaders reconstruct v1 bundles WITHOUT supplemental defaults and v2 with mandatory checked references; verify their respective original bundle hashes.

Missing evidence/version, unexpected supplemental fields on v1, collision, mismatched upstream or unknown schema fail restoration. Same evidence ID/same canonical bytes is reuse; same ID/different bytes rejects. Supplements are atomically included with acquisition facts under existing CAS/fencing. Discovery derived later uses publication-only-style local processing of committed bytes but appends a new evidence-bearing acquisition processing record; it cannot mutate a historical bundle or pretend a new HTTP request happened. This later-processing extension is NOT implemented in Phase 2C: initial scope attaches evidence during new approved acquisitions, or uses isolated offline forks for historical samples.

Only successful extraction payloads use deterministic evidence IDs; failure observations cite the actual attempt/Snapshot and safe error code, not an assumed reproducible timeout. PDF/Discovery evidence contains no new Candidate information and stays outside public projection.

### 6.2 Restoration order and verification

1. Pin committed SHA, validate Source Registry revisions and original Continuous records.
2. Validate exact v1/v2 request intents/plans, grant/allowlist/admission bindings and per-target attempts, without new requests.
3. Verify raw objects and original acquisition bundles; load v2 evidence supplements through the same GitRaw owner.
4. Recompute discovery from parent raw/locator and PDF **successful** evidence with pinned parser/resource profile; compare canonical evidence bytes/hashes. Failed/timeout records verify bindings/hash and remain non-authoritative observations; do not fabricate repeat failures.
5. Validate ExtractedRecordV2 provenance and supplemental locators before the existing raw-validated SOV restoration journal can replay downstream commands.
6. Replay the existing trusted processors/journal, compare original result/artifact seals and Position-scoped current heads.

Do not add a second business replay path or register deserialized DB/Git objects as trusted. Old journals are replayed as originally recorded; no retroactive discovery/PDF commands, defaults, seals or semantic-hash migration. Missing pinned decoder resources safely blocks v2 restoration; cannot fallback to fixture/plain text.

### 6.3 Migration/deployment/rollback contract

No SQL migration or Supabase deployment. Implementation migration is additive TypeScript schema readers, package lock and registered extraction-profile metadata. Ship dual readers before enabling v2 writers; keep existing production sources on v1 unless a separate admission approves new targets. Current schema writer remains v1 for existing runs.

An old binary encountering v2 must fail unknown-version, not ignore evidence. After v2 production records exist, rollback requires a v2-capable compatible binary; do not rewrite records to v1. Revoke/disable new source grants through existing mechanisms if necessary, preserving pending-attempt/fencing rules. No deployment, push or production activation is implied by this design approval.

## 7. Tests and acceptance

B: finite values/combinations, deterministic ordering/encoding, duplicate/unknown/ambiguous inputs, boundaries, zero-request denial, revocation/cadence/RESERVE, modified policy reauthorization, empty/repeated-content stop, request budget including retries, v1 byte parity.

A: known parent and locator, embedded JSON, same-origin but unapproved denial, cross-origin review without fetch, authenticated/challenge references rejection, zero arbitrary script execution, safe diagnostic redaction, parent-hash/locator tamper and fresh restoration.

C: deterministic repeated decode, page/block/span round-trip, hash/Snapshot tamper, encrypted even with empty password, malformed/repair warnings, image-only/mixed page, font/encoding problem, partial/limits/timeout, no outbound parser/resource access, no injected text, independent Process A/B recomputation.

Relevant shared regression only: Continuous transport/gate/root, CollectionRunner, raw Git persistence, trusted-chain restoration and source request intent/plan/outcome, plus P1 tests touching those seams, Architecture, Network Guard and TypeScript. Expand beyond this only for demonstrated shared risk; preserve historical `source-occurrence-materializer-parity.test.ts:434` classification and never relabel new failures as baseline. Docs-only design runs none of these execution tests.

Five-source revalidation remains bounded: CRRC does not get an extra capability; Post/Shenzhen dynamic surfaces require explicit endpoint review; Bank PDF does not close missing job details; Junhe finite pages do not manufacture 2027 identity. Junhe's earlier language-header observation does not permit production headers: transport stays headers-empty. Compare only permitted stateless responses; if content negotiation needs an approved header contract, record NEW CAPABILITY GAP and do not implement that fourth capability. If no source qualifies, zero new authorization/acquisition is correct. R3 controlled first acquisition requires separately sealed APPROVED Admission and human-supported exact scope; not a Scheduler run.

## 8. Readiness review

| Question | Design answer / implementation gate |
| --- | --- |
| Second authority/crawler? | NO; existing owners persist/replay, helpers derive evidence only |
| Broader existing network permission? | NO; old grants unchanged, each new target independently admitted/granted |
| Historical bytes/hash changes? | NO; absence dispatches v1, exact parity fixture required |
| Process B compromised? | NO by design; dual-version/raw-derived verification must pass |
| Arbitrary query? | NO; finite explicit combinations and exact grants |
| Discovered endpoint auto-request? | NO; candidate helper has no network capability |
| Caller trusted PDF text? | NO; reference-only root input, recomputed bytes/locators |
| Browser/OCR? | NO / OUT_OF_SCOPE |
| Source business hardcode? | NO; adapters/configuration only |
| Business rules/Scheduler/Pages/Legacy changed? | NO |

Implementation readiness: design and staged plan are review-ready, not runtime-verified. B is foundational; A/C can be withheld independently if tests reveal unsafe assumptions. Decoder reliability/security gates and real platform exact endpoint bindings remain explicit prerequisites, not concealed completed work. Written Implementation Plan must be approved before implementation starts.
