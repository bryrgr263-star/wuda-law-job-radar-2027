# Retained supporting extraction: bounded recovery plan

This is recovery of already captured bytes, not acquisition, admission,
authorization or a second Source/SOV authority. Original FAILED acquisition,
Snapshot and inspection RECEIPT remain immutable and truthful.

## Existing-owner contract

The Git Raw owner appends a content-addressed extraction derivation containing
the original acquisition ID and bundle hash, Snapshot ID and canonical hash,
Raw manifest hash and content hash, exact endpoint/source references, parser
key/version, derivation timestamp, outcome, canonical records and integrity.
The owner reads original committed bytes and performs the fixed parser itself;
caller-provided records, completion flags, transport and replacement bytes are
not accepted. Version 1.1.0 is explicit; old parser 1.0.0 remains unchanged.

Original transport must be SUCCESS with HTTP 200 and independently verified
Raw bytes. FAILED extraction may be recovered; failed transport, missing Raw,
ambiguous acquisition, binding mismatch or parser refusal cannot become a
COMPLETE extraction. Unknown storage, CAS and integrity failures propagate.

Derived records are not written into the original acquisition bundle. They
are immutable append-only artifacts under the existing Raw owner. Discovery
resolution uses the unique (Snapshot ID, record ID) pair, exact derivation
binding and re-extraction equality; duplicate conflicting records are refused.
The journal append and restart validation use the same resolver, not separate
weaker checks.

## Explicit source-evidence branch

The existing SOV discovery evidence preserves original acquisition status,
hash and completeness. An optional versioned extraction proof separately
proves derived COMPLETE extraction, with immutable artifact identity/hash and
all original bindings. The old SUCCESS/COMPLETE branch is unchanged. The new
branch cannot be triggered by a caller Boolean and must be independently
resolved by the persisted Raw owner. Any generated discovery-support seal
includes the derivation reference. Parser descriptor changes never qualify
for old VERIFIED_IDENTICAL reuse.

## Execution and verification

1. RED tests: original FAILED extraction remains rejected without derivation;
   owner recovery uses original Raw and makes no network request.
2. Minimal Raw-owner append/read contract and deterministic fresh-process
   recovery; no changes to historical state manifests or acquisition bytes.
3. Existing discovery resolver/journal Raw bindings and explicit SOV proof
   branch. Tampered bindings, failed transport, parser version ambiguity,
   caller-invented records and altered Raw remain blocked.
4. Root retained selection and final owner preparation consume independently
   verified derivation while preserving original receipt/status.
5. Offline production evidence replay, focused tests, typecheck, integrity and
   history checks before safe linear integration. Publication only after
   authoritative Position/ReadModel materialization; local success is not
   website completion.

No re-request of the spent campaign inspection, historical rewrite, new
Continuous grant, Scheduler scope or business-rule change is permitted.

## Git Raw derivation owner ledger

- Write set: git-raw-object-persistence.ts, supporting-extraction-derivation.test.ts and this ledger only; parent owns SOV types, validator, discovery resolver and root.
- Behavioral RED: missing append/read APIs; 5/5 initial negatives. Failed-transport fixture headers were corrected and its missing-owner RED independently confirmed.
- API: appendSupportingExtractionDerivation({ acquisition_run_id, expected_parent, derived_at }); listVerifiedSupportingExtractionDerivations(); readSupportingExtractionDerivation(derivation_id).
- Fixed supporting parser 1.1.0 reads original committed object bytes, original Snapshot and independently restored source references. No caller records, flags, parser, response or replacement bytes.
- Artifacts are content-addressed supporting-extraction-derivation/1.0.0 files under the existing trusted-objects/supporting-extraction-derivations directory. No new acquisition, Snapshot, source version, state manifest, transport, receipt or grant is created.
- Original FAILED acquisition and extraction remain FAILED. Derived COMPLETE/FAILED is separate and sealed with original bundle/Snapshot/manifest hashes, exact source references, parser, timestamp, record payload/hash and sanitized failure code.
- Reader independently reconstructs parser output; acquisition/parser and Snapshot/record ambiguity, deletion history, hash-address tampering, future time and failed transport are refused. Storage/integrity/CAS failures propagate.
- First implementation collection: 4/5 PASS; parser-refusal case failed due to a misplaced error-class import, corrected before the final collection. Typecheck then passed.
- Expanded collection: 6/8 PASS; two forged-artifact fixtures failed because Git removed their empty directory, corrected without owner behavior changes. Final targeted rerun 2/2 PASS, exit 0: all eight dedicated cases now have passing results, including fresh child-process restoration.
- Final typecheck PASS; tracked owner diff-check PASS and dedicated test/plan no-index checks emitted no whitespace diagnostics (exit 1 denotes differing new files).
- No production import, network, repository commit/push or parent resolver edits.
- Parent integration remains required: neither readVerifiedDiscovery nor assertRawBindings nor the SOV proof validator has been changed in this subtask. Original acquisition remains FAILED and the old discovery branch still rejects it without the explicit derived-proof integration.
- Parent added the first discovery-consumer regression: verified derived records
  must resolve through the existing reader while acquisition status remains
  FAILED and original completeness remains false. It has not yet been run;
  wait for the existing eight-case session 51310 to finish before starting
  the targeted RED. No consumer implementation has been added yet.
- Parent collected session 51310: one complete eight-case collection, 8/8
  PASS, exit 0, 255.684 seconds. Includes independent fresh-process recovery,
  forged/re-sealed output refusal, unchanged historical bytes and failed
  transport refusal. The new discovery-consumer test is now running alone;
  original owner cases are not being repeated.
- Discovery consumer RED was collected from 50681: expected refusal at
  original completeness check. Minimal existing-reader resolution now uses
  independently revalidated derivation, preserves original FAILED and
  complete=false; targeted GREEN 89380 exit0 1/1, 29.347s. Typecheck and
  diff-check pass. SOV still refuses this evidence until an explicit proof
  branch is supplied; neither acquisition success nor trust is invented.
- The next separate SOV consumer regression is running alone. It requires
  the genuine owner-derived record to pass the existing SOV validation while
  original acquisition remains FAILED. No SOV implementation change yet.
- Collected SOV RED 53796: completeness gate rejects original FAILED as
  expected. Added explicit hash-bound derivation evidence, separate from
  original acquisition status/completeness. Targeted GREEN 6727: 1/1 PASS,
  exit0, 18.185s; tsc/diff-check pass. No production import or final closure.
- Existing rediscovery support generation explicitly refuses derived evidence
  until a separately sealed derivation-reference contract is integrated;
  it must not silently generate historical support schemas omitting that
  reference. Negative SOV tests, shared journal Raw bindings, root consumers,
  final independent review and production fresh replay remain outstanding.
- Added SOV tamper/missing-proof/changed-status/scope/Raw negatives; targeted
  84163 exit0 1/1, 18.252s. Added actual existing-root PACKAGE journal test:
  RED 28684 refuses original missing record as expected. Minimal Raw journal
  fallback resolves independently validated derivation, preserving original
  bundle; tsc/diff-check pass. Targeted 59612 then fails STATE_TAMPERED on
  a missing committed artifact-identity file during journal.list. This is
  unresolved, not a passing Process B or integrity waiver. Investigate exact
  store/fixture path before claiming root recovery or committing integration.
- Preserved failing TEST_ONLY fixture and independently inspected its Git
  tree: the alleged missing identity is actually committed. Instrumented
  read-only Git invocation exposes `fatal: failed to stat ... Filename too
  long` for Windows Git's revision:path argument. The exact same object reads
  with `core.longpaths=true`. No integrity check was waived. Shortened only
  the TEST_ONLY temporary-directory prefix; isolated validation 87035 is
  running. Production store and history remain unchanged.
- Collected 87035: actual existing Trusted root journals the derived PACKAGE
  and a fresh root replays it, 1/1 PASS exit0, 27.431s. Original acquisition
  and historical bytes remain unchanged. This is local recovery verification,
  not production import or website publication. Separate child-process
  journal replay, adverse journal inputs, root consumers and sealed derived
  rediscovery references still need verification.
- Parent unified discovery-reader and journal derivation selection through the
  same independently verified exact bundle/Snapshot/record resolver. Direct
  TypeScript validation passes; the pnpm-generated tsc launcher fails because
  it references a removed historical dependency path, not a source error.
  Journal child-process/adverse-input tests are assigned to Huygens; retained
  selector/campaign consumers are assigned to Ampere with disjoint write sets.
  Both tasks remain pending; no production import/request/push occurred.
- Ampere execution could not initialize its read-only environment and made no
  edits. Parent resumed the root selector task. New real-Git derivation fixture
  first exposed a redundant fixture commit (owner already commits); corrected
  without implementation changes. Behavioral RED 21542 then refused at the
  selector's original COMPLETE check. Minimal selector now independently reads
  the unique owner-derived record, validates its SOV evidence and reparses with
  explicit 1.1.0 only for a genuine derivation. Original receipt/bundle hashes,
  transport, scope and all source bindings remain mandatory. GREEN 16711 is
  running, not yet classified. Huygens journal test work is active separately.
- Collected selector GREEN 16711: 1/1 PASS, exit0, 49.361s. Added a separate
  actual production-root derived-campaign case; RED 79934 is running. This
  covers preparation, ordinary job capture, journal and fresh restoration,
  not just adapter selection. No public jobs or production capture claimed.
- Actual production-root RED 79934 completed: ADAPTER_EXTRACTION_FAILED,
  original support was independently valid but root preparation reparsed it
  with the historical 1.0.0 parser. Existing root now chooses explicit 1.1.0
  only for independently verified derivation evidence; historical parsing is
  unchanged. Targeted GREEN 76452 is running; no final pass claim yet.
- Collected production-root GREEN 76452: 1/1 PASS exit0, 183.483s. Ordinary
  existing root prepared two detail records with verified 2027 binding and
  restored the committed result; original failed campaign bundle remains
  byte-identical. This is TEST_ONLY, not a real new job or publication.
- Huygens strengthened actual root journal test with independent child process,
  four adverse inputs and re-sealed/deleted derivation replay refusal: isolated
  1/1 PASS exit0, 100.577s. Parent TypeScript/diff-check PASS afterward.
- Added a separate versioned derivation-reference rediscovery regression. Old
  contracts must still refuse derived support. New contract must seal both
  original/next derivation references and restore through the existing journal.
  RED is running; no implementation or new contract pass claimed yet.
- Collected rediscovery RED 25520: unsupported explicit 4.0.0 contract refused
  at existing root tracker as expected. All workers now ended. Independent
  scoped review found no evidence-backed Critical/Important blocker, but noted
  that root fixture used SUCCESS acquisition/extraction FAILED. Strengthened
  derived-campaign fixture to retain full acquisition FAILED as in production;
  root and selector positives must be rerun with this stronger fixture before
  claiming production-shaped coverage. This is test-only, no receipt changed.
- Minimal support 4.0.0 now seals original/next derivation ID and integrity
  references into both artifact integrity and support identity. It still
  requires identical Raw bytes, parser descriptor and complete semantic
  descriptors; it does not allow a parser upgrade to claim equivalence.
  Version 1–3 payloads/IDs remain unchanged and refuse derived support.
  TypeScript/diff PASS; targeted GREEN 82274 is running and scoped independent
  review is pending. No production contract used or history rewritten yet.
- Collected 82274: versioned derived support and fresh existing-journal replay
  PASS 1/1 exit0, 61.526s. This includes old-schema refusal and sealed refs.
  Strengthened full-acquisition-FAILED selector/root pair is now running with
  test concurrency one; do not duplicate it or reuse weaker fixture results.
- Independent v4 review found no evidenced Critical/Important issue but noted
  first GREEN used a single event. Expanded the same regression to two genuine
  separately persisted failed acquisitions and independently derived records;
  distinct Snapshot/derivation IDs, all old-schema refusals and re-sealed
  missing/swapped-reference refusal are now included. TypeScript PASS;
  targeted 88971 is running. Strong root/selector pair 35842 remains running.
- Collected expanded 88971: fixture attempted to mint a second manifest for
  identical content at a new acquisition time, correctly rejected COLLISION.
  Test now references the existing verified content-addressed manifest via
  ordinary appendAcquisitionBundle; new Snapshot and request timestamps stay
  distinct. No Raw identity rule changed. Targeted 49309 is running; 35842
  still pending, no replacement or duplicate launched.
- Strengthened actual acquisition-FAILED selector/root pair 35842: 2/2 PASS
  exit0, 281.333s total. Two distinct persisted acquisition/derivation events
  with all legacy-schema and re-sealed reference negatives: 49309 PASS 1/1
  exit0, 157.428s. No public position claimed. Bounded historical support plus
  complete derivation regression is now running serially.
- Fresh read-only HTTPS fetch succeeded: remote advanced from a0e64bb to
  7eefcc2cc4bdd53a440ec79dcecd7a10a02c1cbd, only nine lawful production data
  commits, no runtime changes. Natural run37909786610 (schedule, Oct9) ended
  failure. Committed continuous records contain one RESERVE with no matching
  COMPLETE: bccb61fd-fdb9-4ffa-a901-69cacbe35638 at Oct9 09:14:40.511Z.
  Do not finalize or request around it. Integration tree remains untouched
  at a0e64bb; preserve all remote history during later integration. New
  requests are blocked pending exact recovery diagnosis; offline work continues.
- Collected complete bounded support/derivation regression 81391: 38/38 PASS,
  exit0, 403.187s. Historical v1/v2/v3 support contracts and complete twelve
  derivation cases all passed in one serial collection. Scoped Architecture
  and Network Guard collection passed 15/15, exit0. Final TypeScript/diff
  checks passed. Latest production restoration/integration and remaining
  pending-request recovery are separate gates, not implied by these tests.
