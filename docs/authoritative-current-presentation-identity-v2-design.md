# Authoritative Current-Presentation Identity V2 — Design Freeze

Status: READY FOR IMPLEMENTATION — design only; implementation NOT IMPLEMENTED.

This document supersedes the unresolved compatibility proposals in the previous design review. It does not claim that duplicate presentation is fixed, scheduler prerequisites are verified, or production activation is approved.

## 1. Scope and authoritative owner

Use Approach B: consume the existing trusted `Position.id`; do not create a PresentationSubjectIdentity entity or another registry. The public series key is `(scope, position_id)` inside the existing authoritative Trusted Chain stream. A deployment must use the existing single owner for that stream; separately hosted streams must not each issue a competing series for the same product scope.

Existing root, processors, canonical registry, command journal, and Git artifact ledger remain the only owners. No changes to Recall, Position entity resolution, Relevance, Requirement, PredicateResolution, Eligibility, or Presentation Policy V1 business semantics are authorized.

Scope continues to separate PRODUCTION and SYNTHETIC_TEST. This design does not create per-user presentation series or derive keys from CandidateProfile. The existing single configured candidate-evidence context is retained; switching to a different user's context is not an unattended acquisition event.

## 2. Positionless compatibility: two layers, one existing decision owner

PresentationDecision becomes a versioned discriminated contract, not two decision engines:

| V2 record kind | Binding | Subject/revision contract | Purpose |
| --- | --- | --- | --- |
| UNBOUND_RETAINED_OUTCOME | No verified discovery-to-Position binding | No public subject, no Position-series revision or supersedes | Immutable audit/retention result |
| POSITION_PRESENTATION | Verified binding through existing Position/PBOV authority | Non-null position_id, positive contiguous revision, same-subject supersedes | Formal public presentation series |

Positionless results continue to be sealed PresentationDecision audit outcomes produced by the same owner and Policy V1. Their existing status, reason codes, exclusion proof, Candidate/Recall references, and evidence are preserved. `public_series_member = false` is a contract classification, not NOT_DISPLAY and not a business exclusion. An EXCLUDED/NOT_DISPLAY audit outcome is still retained for audit; the term retained here does not change the Recall disposition.

An audit outcome has a content-addressed artifact ID in a distinct audit namespace, computed from its versioned immutable payload and scope. Candidate references are provenance within that payload, never a public subject fallback. It has no public revision. Ledger revision metadata is null; its stream metadata uses its audit artifact ID, not a counterfeit Position series.

A Position ID appearing in an old decision is insufficient: the discovery-to-Position binding must itself verify. A decision carrying `candidate_source_binding = UNBOUND` cannot be migrated into the public Position series merely because Relevance referred to a Position.

### Public compatibility, explicitly not silent hiding

The normal `opportunities` current collection contains V2 POSITION_PRESENTATION records only. Unbound EVIDENCE_BLOCKED outcomes no longer masquerade as ordinary Position listings. They are not deleted, converted to NOT_DISPLAY, or made indistinguishable from a genuinely empty acquisition.

The existing read-only API receives additive compatibility metadata from the same ledger-derived read repository, not a second API or truth source:

- `retention.unbound_outcome_count`: retained unbound outcomes at the reported authoritative HEAD;
- `retention.pending_candidate_count`: discoveries without a subsequently verified public binding;
- `retention.items`: separately paginated audit references containing audit outcome ID, discovery Candidate ID, original status/reasons, and `public_collection_state = POSITION_BINDING_REQUIRED`;
- independent retention pagination and the authoritative HEAD/contract version; pagination totals for `opportunities` do not include audit references;
- `migration.blocked_position_count` and separately paginated migration audit references for subjects awaiting migration resolution.

Retained audit references, including approved exclusions, are not normal published jobs. Only recruitment-side metadata is exposed; private candidate documents, assertions, and evidence values are not added to this metadata.

The existing Candidate detail route can read an audit-only result before binding, explicitly tagged `record_kind = UNBOUND_RETAINED_OUTCOME`, with original EVIDENCE_BLOCKED/NOT_DISPLAY status and `public_series_member = false`. It never pretends that this is a Position-scoped current job. Unknown references remain not found; valid retained references are not silently treated as unknown.

After verified binding, the same route resolves through a ledger-derived support association to the Position's current public read model. A current NOT_DISPLAY is not publicly returned as a job; audit history remains available under the existing audit permissions. No new endpoint or UI work is included.

All counts, associations, and audit references are deterministic projections of the committed journal/artifacts. No independently editable retention table is authoritative. If the compatibility metadata cannot be built consistently, return a technical integrity error rather than a misleading empty success response.

## 3. Unbound-to-bound transition

```
UNBOUND_RETAINED_OUTCOME (immutable history)
  -> existing source/Position authority establishes a verified binding
  -> root validates Candidate + Recall + SOV + Position/PV/PBOV + selected composition
  -> existing Policy V1 produces its result from trusted inputs
  -> POSITION_PRESENTATION V2
```

The journal execution links the retained audit artifact and the newly verified binding to the resulting Decision ID/seal. The old audit bytes, status, ID, and envelope never change.

- If the Position has no V2 series: create its initial revision 1, subject to the migration rule in section 8.
- If it has a head and the semantic projection equals that head: reuse the existing Decision/ReadModel; append support provenance only.
- If verified business semantics differ: append N+1 with supersedes pointing to N.
- If binding remains uncertain/conflicting: retain the audit result; do not create a Position subject or negative conclusion.
- An old approved exclusion is not silently revoked by binding. Any later changed Recall outcome must come from the existing approved Recall owner before Policy V1 is consumed again.

Binding, promotion, and support associations are reconstructed from successful journal executions. They are not mutable flags on historical audit outcomes.

A V2 command may reference an existing trusted PBOV by ID to prove binding even when Relevance or Eligibility is absent. The root must verify the discovery source tuple against that graph through the existing authorities; callers cannot supply a Position object or guessed Position ID. Verified binding permits a Position-series EVIDENCE_BLOCKED result without fabricating Relevance, Requirement or Eligibility. If that proof is unavailable, the result remains the audit variant.

## 4. Artifact issuance versus execution provenance

| Boundary | Immutable artifact issuance | New execution provenance |
| --- | --- | --- |
| Meaning | Why and from which trusted basis these exact artifact bytes were first issued | Who executed this command, when, against which discovery/input references |
| Contents | Artifact kind/ID/schema, scope, canonical bytes/hash, seal, original producer, issuance actor/time, original upstream references | Command/hash, sequence/previous hash, actor/time, validated command-input dependencies, result hash, output IDs/seals, reference to original issuance envelope |
| Reuse | Original bytes and issuance envelope are unchanged | A new journal record may reference the same artifact |
| Authority | Existing canonical artifact owner and ledger | Existing root and append-only journal |

### First issuance

Validate trusted inputs; execute the existing processor; canonicalize and seal the artifact; create exactly one issuance envelope; atomically append its identity/object and the execution record through the existing Git boundary. The committed result is the first issuance. A failed/uncommitted attempt is not a new authoritative issuance.

### Reuse

The root obtains the original envelope through a verified ledger repository read boundary (kind + ID + scope), not from the caller. It checks exact artifact bytes, artifact hash, seal, schema, scope, original envelope integrity, and original upstream dependencies. It supplies the original envelope in the existing execution artifact references. It does not call the envelope generator with the new execution actor/time for an already issued artifact.

The new journal command records the new Candidate/Recall/upstream support. Replay revalidates these command inputs; an arbitrary string in a command is not proof of support. A reused Decision retains its original primary provenance; additional provenance is discoverable through the journal association. No Candidate list is appended into an old sealed Decision or ReadModel.

Git identity retains the existing binding to the original `envelope_integrity_hash` and object path. Exact kind/ID/scope/bytes/seal/original envelope reuses the existing object. Any differing bytes or envelope for that identity is rejected. No hash check is weakened.

Every execution, including reuse, requires complete scope, non-empty actor, valid execution timestamp, canonical command, validated dependency bindings, sequence/previous hash, result hash, output seals, and integrity hash. If these are incomplete, a new reuse execution is rejected before commit. The existing artifact/current state is unaffected. Exact retry of an already committed execution can return its original idempotent receipt without creating another execution.

Process B verifies the anchored committed HEAD, manifest/journal chain, original issuance reference (which must exist at or before the referencing execution), artifact/envelope hashes/seals, scope, and input/output dependencies; then replays through the existing owners. It must never require the original issuance actor/time to equal a later execution actor/time. Later or dangling issuance references, scope mixing, or altered command/support references are rejected.

Hashes detect corruption or alteration against the trusted committed state. They are not authentication by themselves: a fully rewritten self-consistent history cannot be identified merely by recalculating its hashes. Existing authorized Git ref/HEAD anchoring and append-only history verification remain prerequisites; no new fixed-repository deployment or CAS retry orchestration is implemented here.

## 5. PresentationSemanticProjectionV2: closed, explicit whitelist

Version: `presentation-semantic-projection/2.0.0`. It is a read-only canonical representation of sealed input/result data, not another evaluator. The root constructs it; callers cannot provide its fields, hash, status, or trust conclusions.

The following are the complete top-level keys. Additional keys are rejected, not silently dropped. Branches use explicit availability unions: AVAILABLE(value) or NOT_YET_AVAILABLE(reason_code); no implicit undefined/default-to-complete behavior is permitted. Missing optional fields become explicit null within available typed objects. Unsupported upstream contract versions stop semantic comparison for review rather than inventing equivalence.

| Key | Allowed fields / source |
| --- | --- |
| projection_version | Literal `presentation-semantic-projection/2.0.0` |
| scope | Existing PRODUCTION or SYNTHETIC_TEST scope |
| subject | `position_id`, verified existing Position `identity_state`, `identity_hash`, `identity_resolver_version`; stable identity comes only from position_id |
| policy | Existing `policy_id`, `policy_version` |
| decision | Existing Policy output `status`, `reason_codes`; complete existing decision_basis: `recall_status`, `relevance_state`, `eligibility_result`, `candidate_source_binding`, `approved_exclusion`; approved exclusion rule descriptor below |
| relevance | Availability; `assessment_state`, `coverage_state`, taxonomy/schema/materialization versions; complete existing Relevance decision_basis; finding descriptors below |
| eligibility | Availability; existing `result`, `reason_codes`, assessment/candidate-evidence scope, predicate/assessment rule and materialization versions, `as_of`, aggregation/unresolved reasons, condition/predicate/evidence descriptors below |
| requirement | Availability; existing RSV materialization/projector/logic/parser/resolver/gate versions, source-composition state, completeness and execution-gate descriptors, public fact summary, dereferenced business structure and unparsed observation descriptors below |
| source_trust | Availability; validated integrity marker, composition status/contract versions, inventory/coverage, authority, binding, selection, precedence, revision-relation and conflict descriptors below |
| display | Employer, position title, locations, recruitment year/batch, announcement/application links, requirement summary, and effective_at; each includes its availability state/reason |

### 5.1 Exact nested descriptors

An exclusion descriptor contains only existing `policy_id`, `policy_version`, `rule_id`, `rule_version`, `reason_code`, and `matched_subject_identity`. This is an approved recruitment-publisher exclusion reference, not candidate matching.

Relevance decision_basis contains exactly `position_binding`, `direct_legal_evidence`, `legal_major_evidence`, `legal_qualification_evidence`, `legal_adjacent_evidence`, `non_law_function`, `material_conflict`, and `evidence_gap_codes`. A finding descriptor contains `finding_kind`, `semantic_code`, `original_text`, its resolved surface descriptor, and its typed EvidenceLocator. No regex, threshold, or relevance assessment is run by this projection.

Eligibility descriptors contain:

- condition: original condition reference resolved to its Requirement business structure, `modality`, sealed `logical_result`, and corresponding fact descriptors;
- predicate: corresponding fact/predicate business target, sealed `applicability`, `resolution_status`, `logical_result`, `reason_codes`, predicate semantic hash, and candidate-evidence references;
- candidate-evidence reference: original issued evidence ID/hash, `observation_status`, existing evidence provenance class, `synthetic_test`, `observed_at`, `effective_from`, `effective_to`.

Candidate-evidence issuance IDs/hashes and predicate semantic hashes are conservatively retained: their change is not assumed to be ordinary job-discovery provenance. They are hashed privately into this comparison, not exposed as new public candidate details. The projector does not issue evidence, inspect CandidateProfile, compare credentials, or recalculate logical_result.

Requirement summary entries contain typed `dimension`, `operator`, `value` (the existing closed RequirementValue union), `subject_scope`, `polarity`, `certainty`, `applicability`, and parser version. Public summary values are these recruitment-side fields only. Original Fact IDs remain in provenance/support metadata, not in the semantic summary; the root must verify their exact graph bindings before comparing descriptors.

Requirement business structure is a lossless, version-pinned copy of the existing resolved business graph, with local registry IDs replaced by their verified referenced descriptors, not inferred constraints. Its allowed variants are:

- mandatory root: EMPTY_CONFIRMED, SINGLE, AND, retaining each existing branch;
- condition: modality, resolution_state, representation_kind, existing credential/state applicability descriptors and context-binding descriptors;
- requirement logic: existing AND/OR/NOT nodes and corresponding fact/predicate descriptors;
- selector logic: existing selector predicates, logic operators and conditional branch cases; preserve applicability, unresolved/default behavior and source order;
- credential/state applicability and context targets: all business fields of the pinned existing discriminated unions, with internal registry references resolved through the sealed set; stable Position/plan/batch/organization targets remain explicit;
- completeness: status, blocker `code`, `diagnostic_code`, `description`, referenced original clauses/roles/dimension hints, required engine capabilities and execution-gate status/reason/missing capabilities;
- observation: status, clause_role, dimension_hint, original_clause text/encoding, typed clause locator, parser version, corresponding confirmed fact descriptors.

These are the existing contract variants, not new Requirement domains or an attempt to interpret unsupported clauses. The projector preserves UNKNOWN, AMBIGUOUS, UNPARSED_CLAUSE, DOMAIN_GAP, unresolved logic and INFORMATIONAL only as already sealed by the existing owner. It cannot promote UNKNOWN to MANDATORY, drop a blocker, or change a clause role.

For recursive pinned unions, copy every business field explicitly; arbitrary additional properties or a new union tag fail schema validation. Internal reference substitution must preserve edge roles, grouping, cardinality, NOT, AND/OR, modality and source order. Missing, cyclic, ambiguous or unsupported references prevent comparison. Descriptor hashing never performs entity resolution or merges identical-looking nodes. No credentials or conditions are evaluated.

### 5.2 Source/composition trust descriptors

A surface descriptor contains verified source_definition_id, recruitment_endpoint_id, existing stable source occurrence identity, any existing source_version_selection.source_identity, surface_kind, typed EvidenceLocator, surface_content_hash, surface_status, composition_role, target_scope, effective_period, source_publication_time, and extractor/parser/resolver/schema versions. These are evidence/trust attributes, not public identity keys. No attachment identity is invented from an attachment index or guessed URL.

Source trust contains only the following descriptors, including referenced surface descriptors instead of unverified Surface IDs:

- composition: status, schema/serialization/extractor/parser/discovery/composition-resolver versions, `composition_as_of`;
- discovery boundary: boundary_kind, discovery_scope, admissible_relation_kinds, initiating surfaces;
- inventory: inventory_completeness_status and expected entries (`expected_surface_key`, expectedness, requirement_level, authority_status, binding_status, version_selection_status, coverage_status, resolution_status, target_scope, corresponding surface); unexpected-surface dispositions;
- authority: issuer, authority_state, target_scope, effective_period, asserted/basis surfaces and verified authority-basis binding;
- binding: target_type, verified target identity/business descriptor, binding_kind, binding_status, typed locator; attachment publication exact attachment locator, row/cell/page/span locator and existing binding_version when present;
- selection: source_identity, target_scope, selection_status, candidate/selected/excluded surfaces, source_publication_time, effective_period, correction_time, resolver/schema versions;
- precedence: applicable_scope, effective_period, composition_as_of, precedence_rule, decision_status, selected/excluded surfaces, corresponding authority descriptors;
- revision relation: relation_kind/status, target/requirement scope, effective_period, affects_required_coverage, source/target surfaces and authorities;
- conflict: status, target/requirement scope, effective_period, affects_required_coverage, competing surfaces and sealed observations/authorities;
- integrity: constant VERIFIED only after all existing hash/seal/upstream assertions succeed. Corrupted bytes never produce an INVALID-trust business Decision; they cause a technical integrity failure.

`composition_as_of`, effective periods, correction/publication times, Eligibility `as_of`, candidate-evidence observation/effective times, and display effective_at are conservatively semantic. They are not automatically treated as discovery timestamps: current contracts use them for evidence validity or expose them publicly. A future proven classification change would require a new projection contract, not a silent exception.

The existing source selection's observation_time/ingestion_time are retained as comparison guards when populated, because their lack of influence has not been established for every selected-version case. They are not the scheduler execution time. This may create conservative revisions after actual reevaluation, but never a second current subject. The new source discovery's snapshot capture/first_observed timestamps alone remain outside the projection.

### 5.3 Display whitelist and canonicalization

Display contains exactly:

`employer`, `position_title`, `locations`, `recruitment_year`, `recruitment_batch`, `announcement_link`, `application_link`, `requirement_summary`, `effective_at`.

Values are copied from the same trusted PBOV/PV/RSV references that the Decision binds. Preserve exact existing original strings and link values; do not rewrite URLs, normalize title/location into identities, or fill from legacy data. NOT_YET_AVAILABLE reason changes and availability changes are semantic.

`updated_at` remains the issuance time of the current Decision, not the latest acquisition time. It does not enter the semantic hash. A discovery-only reuse cannot refresh it; new acquisition timestamps remain in execution/run audit.

Use existing canonicalSerialize/canonicalHash. Object key ordering is canonical. Existing set-valued reason/code lists are deterministically sorted; other arrays preserve existing contract order and multiplicity unless that contract explicitly establishes set semantics. Do not equate paraphrases, commute new logic, discard duplicate evidence roles, or reinterpret free text.

The semantic projection is embedded in the new immutable Decision (with its version/hash) as the checked canonical revision basis. It is not a separately issued authoritative artifact/registry. ReadModel fields must match this basis and the original trusted upstream bindings.

### 5.4 Excluded provenance and conservative comparison rule

The following do not enter the semantic hash: OpportunityCandidate ID, discovery event ID/time, Snapshot ID/capture time, ExtractedRecord ID, ordinary SOV materialization observation time, execution actor/time, Decision ID/revision/supersedes/issuance time, artifact issuance envelope hash, and Fact/finding/surface local reference IDs after successful descriptor resolution. RawBlob hash remains integrity/provenance, not subject identity; a selected surface_content_hash is explicitly a trust/evidence descriptor and can change semantic input.

All excluded fields remain in immutable artifact provenance, original input references, or the new execution journal. Exclusion from the comparison never means deletion from the audit chain.

PV/PBOV/Composition/RSV/Assessment artifact IDs, aggregate integrity hashes, and source manifests are verified and retained in provenance; they are not blindly used as event-insensitive semantic digests. Their identified business contents are projected through the whitelist above. Changing bytes under the same artifact ID is still an integrity/collision error, not semantic reuse.

If two sealed inputs differ outside proven provenance-only fields and the versioned whitelist cannot represent or verify that difference, return `SEMANTIC_PROJECTION_REVIEW_REQUIRED` as an execution/migration audit result. Do not assert equivalence, fabricate a Decision, silently extend the whitelist, or overwrite the existing current head. This is a technical projection boundary, not a new Requirement/Eligibility domain or negative result. Such differences are conservatively treated as potentially semantic pending contract review.

Different referenced objects may compare equal only after each is independently verified and its typed descriptor resolves exactly under this version. Matching public title/status alone, matching only RawBlob hash, or stripping arbitrary IDs is never sufficient.

## 6. Decision and ReadModel revision semantics

For POSITION_PRESENTATION:

- Decision identity = canonical hash of new Decision contract version, scope, position_id, and subject revision;
- revision 1 has no supersedes; revision N+1 supersedes the exact same-subject head at N;
- compare the proposed projection only with the current head; equal -> reuse head, unequal verified projection -> append N+1;
- do not reuse an older historical Decision as the new head after a business state reversal;
- same semantic projection reuses the original complete Decision, not a same-ID object with freshly swapped upstream IDs/provenance;
- ReadModel identity deterministically binds new ReadModel contract, scope, position_id, Decision ID/seal, and projector version;
- one matching ReadModel per Decision; its revision equals Decision revision; immutable history is preserved.

Root-owned allocation uses the replayed head and journal order. The execution declares/validates its expected prior subject head as well as existing journal/commit parent invariants. A stale writer cannot replace N+1 or issue a conflicting branch. Local speculative state is not public state. Retry orchestration remains out of scope.

Both a changed display value and a changed verified trust/basis value can create a revision even if status stays DISPLAY. Ordinary Candidate/execution identity changes alone cannot.

Decision, matching ReadModel, execution/support references and validated current snapshot must become publicly authoritative in the same existing root-owned atomic commit. Intermediate local journal commits are not a publishable current snapshot. Failure before the final commit cannot advance public current; the previously committed state remains. This is reuse of the existing atomic boundary, not a new transaction system.

## 7. Current-selection contract

```
(scope, position_id)
  -> validated contiguous immutable Decision chain
  -> exactly one terminal head, if the subject has been issued
  -> exactly one matching sealed ReadModel
```

An unissued or migration-blocked subject has no fabricated head. Its audit/migration state is explicitly reported. Validation checks: unique subject/revision; initial revision 1; no gaps; exact same-subject predecessor at N-1; no branch; consistent schema/semantic hash/seal; one matching ReadModel at every committed public Decision revision. Missing matching ReadModel is an integrity failure, not permission to fall back to a historical visible model.

Validated history produces a rebuildable current index. Cache/index snapshots must identify authoritative HEAD, schema version and content hash; rebuild is deterministic. No UPDATE current row in the authoritative ledger. A mutable derived cache may be replaced atomically only as a checked rebuild from immutable history; it is never independently edited truth.

Resolve the head before API status filtering. A current NOT_DISPLAY must not resurrect an old DISPLAY. Technical acquisition/restoration failure cannot manufacture NOT_DISPLAY, INELIGIBLE or NOT_RELEVANT. A failed write leaves the last committed valid state intact.

## 8. V1 -> V2 migration state machine

V1 = immutable historical verification only after activation; V2 = the only new production Presentation writes. Policy V1 is unchanged; Presentation Contract V2 is not Presentation Policy V2.

```
V1_HISTORY_ANCHORED
  -> V1_REPLAY_VERIFIED
  -> CLASSIFIED_BY_VERIFIED_BINDING
       -> UNBOUND: retain audit-only compatibility projection/references
       -> POSITION_BOUND: compute PresentationSemanticProjectionV2 per V1 result
            -> EQUIVALENT: append migration-generated V2 revision 1 + ReadModel
            -> CONFLICT / UNPROVABLE: append blocked migration audit; no V2 head
  -> VERIFIED_V2_READ_SNAPSHOT
  -> PRESENTATION_CONTRACT_V2_ACTIVATED
```

### Unique initial-revision rule

For every Position with historical, verifiably bound V1 Presentation artifacts: V2 revision 1 is always a migration-generated initial revision. First post-migration acquisition cannot bypass this gate or compete for initial issuance. A blocked/conflicting group must first obtain reviewed, verifiable resolution through existing authoritative evidence/selection owners; migration then creates revision 1. The migration cannot resolve a conflict by editing sealed results.

For a Position with no bound V1 presentation history, including a Position first bound from an old positionless outcome: first eligible V2 issuance is revision 1 with production-first origin. This is one deterministic rule: anchored V1 bound-history presence controls origin, not race or caller preference. Migration audit includes that inventory membership proof.

If equivalent V1 records have different primary provenance, choose the earliest verified issuance journal sequence as the primary source for deterministic bytes; record every equivalent V1 artifact/envelope reference. This tie-break is permitted only after full semantic equivalence is proved, never to resolve conflicting outcomes.

The migration command/result records migration ID/version, scope, anchored input HEAD and V1 IDs/seals/envelope hashes, classification/comparison result, primary issuance sequence, output V2 IDs/seals/projection hash or blocked reason, actor/time, and counts. It is appended through the existing journal/ledger. No old artifact, identity file, seal, journal segment or hash is rewritten.

V1 unbound compatibility projections preserve original artifact identity/status and reference their original envelope; they do not need to become new public Decision artifacts. New unbound executions use the V2 audit variant. Migration inventories record all V1 exclusions, blocked and positionless outcomes; no record may disappear between inventory and compatibility/read outputs without an explicit audit classification.

New commands carry explicit Presentation contract version. During replay only, old unversioned Presentation commands dispatch to the legacy historical codec/behavior in the same owner to reproduce old result hashes and seals. Live new production writes require V2; explicit V1/unversioned writes are rejected. ReadModel replay dispatches from the referenced Decision contract. No second production resolver is introduced; V1 entries are historical and excluded from the V2 public head index.

The existing verified ledger envelope read boundary must be forwarded through any restoration repository wrapper, preserving original validated envelopes; Process B cannot recover issuance provenance from a new command actor/time.

A complete migration inventory, retention/migration metadata, and coherent V2 current snapshot must be verified before switching the read contract. Conflicting subjects remain explicitly blocked and represented in migration audit metadata; no arbitrary V1 row is grandfathered into V2 current. Activation changes the formal collection membership contract, never the stored business statuses. If compatibility/audit coverage is incomplete, activation is blocked and the previously approved serving mode is not silently swapped.

## 9. API and persistence effects

Public collection uses the existing API and a single ledger-derived read repository. That repository returns a validated V2 current snapshot plus retention/migration compatibility metadata pinned to one HEAD. The API only applies the existing sealed-status filter/pagination/sorting and routes existing detail reads; it performs no group-by, latest selection, semantic comparison or entity resolution.

Existing Git run manifests remain historical run outputs. Their flatMap of models and `listVerifiedPresentationReadModels()` history are not the public current set. Restoration output must distinguish history and validated current models, including retention/migration audit. Publish/retry entrypoints must receive the checked current snapshot, not republish stale run arrays as current truth.

The existing root's non-empty ReadModel success prerequisite must distinguish an audit-only retained result from an invalid empty chain: a source execution with verified Candidate/Recall and sealed unbound audit outcomes may commit those artifacts and its explicit audit-only run manifest even with zero Position ReadModels. Zero public models is not CONFIRMED_EMPTY, exclusion, or permission to discard discovered records. Run manifests retain separate audit-outcome references, public-model references and blocked reasons; this change is limited to the identity/retention boundary and introduces no acquisition status interpretation or scheduler logic.

SQLite remains a rebuildable derived index. New derived migration adds kind/scope/position_id/projection-version/hash/subject revision indexes without rewriting old immutable V1 payloads. Unique subject/revision enforcement applies to V2 Position records only, never to null Position audit outcomes. SQL MAX alone is not history validation: the repository validates the chain/model invariants before serving its materialized head index. No production table jobs/sources/sync_runs or old migration is modified.

PostgreSQL is outside this zero-cost identity implementation. Its historical reader/schema must not be silently designated the V2 runtime. The currently Postgres-composed API runtime remains unchanged in this design-only round; future V2 composition must explicitly select the sole approved Git-ledger-derived repository. No fixed production repository, deployment, or backend activation is included here.

## 10. Failure matrix

| Situation | Contract result |
| --- | --- |
| Same Position, equivalent projection, new Candidate | Same head/ReadModel, original envelope, new journal support |
| Same Position, verified newer business/evidence/display semantics | Append N+1, same subject, preserve history |
| Different trusted Positions, same title/employer/location | Two subjects, never merge |
| Positionless or unverified binding | Retained audit outcome, explicit compatibility metadata, no subject fallback |
| Approved exclusion before binding | Original NOT_DISPLAY audit outcome retained; no fake Position |
| FAILED/PARTIAL rediscovery | No disappearance or new negative result; committed current stays |
| Incomplete execution provenance | Reject new issuance/reuse execution; old artifact/current unchanged |
| Different bytes/envelope under same ID | Collision/integrity failure |
| Missing/dangling/future issuance reference | Restoration/reference failure |
| Scope mixing or synthetic -> production reuse | Reject before commit |
| Unknown semantic difference/unmodeled upstream schema | Projection review audit; no guessed equivalence or overwritten head |
| V1 equivalent migration group | One migration-generated V2 revision 1, all V1 provenance preserved |
| V1 conflicting/unprovable group | Blocked migration audit, explicit metadata, no guessed initial head |
| Stale writer / subject branch / revision gap | Reject; no authoritative current advancement |
| Missing matching model / tampered current cache | Integrity failure; no fallback to old visible revision |
| Current NOT_DISPLAY | Excluded by status filter, history retained, old DISPLAY not resurrected |
| Incomplete compatibility inventory | Activation blocked, no silent collection cutover |

## 11. Required regression matrix

| Case | Required evidence |
| --- | --- |
| Duplicate discovery / same trusted tuple | Same Position, two Candidate observations, one V2 Decision head/model/current row, both journal supports |
| New snapshot/extracted event only | Excluded event identities differ; verified descriptors equal; no revision or issuance-envelope regeneration |
| Newer evidence / DISPLAY_WITH_REVIEW -> DISPLAY | Same subject, N+1, current DISPLAY, full history |
| Changed employer/title/location/year/batch/link | New revision even if status unchanged; no identity drift |
| Changed summary values/availability/blockers/logic | Exact change represented; no unsupported-domain invention or gate weakening |
| Authority/selection/conflict/completeness change | New verified projection/revision or safe review when unprovable; never status-only equivalence |
| Distinct Positions / identical display strings | Two current rows |
| Failed rediscovery | Existing committed current preserved |
| Unbound EVIDENCE_BLOCKED/exclusion | Original status retained; not in opportunities; explicit retention count/reference/detail; no fake subject |
| Later verified binding | Old audit bytes unchanged; initial/new/reused Position revision as appropriate; verified transition/support association |
| Envelope reuse under different execution actor/time | Exact original bytes/hash/path, new journal record, no collision |
| Invalid execution/source/envelope refs | Rejection before commit; no branding bypass or Map injection |
| Business state reversal | New N+1 rather than historical-head reuse |
| Fresh Process B | Original V1 seals/replay, V2 bytes/IDs/seals, support/audit/migration metadata and current identical; no Process A memory |
| Duplicate revision/branch/gap/cross-subject predecessor/missing model | Explicit integrity failure; no timestamp/order fallback |
| Stale processes based on N | Conflicting N+1 rejected by existing subject/journal/Git parent checks; no force push or retry feature |
| Equivalent/conflicting V1 groups | Deterministic migration primary only for equivalence; conflict stays audited/blocked |
| New bound-history Position / previously unbound-only Position | Migration-generated vs production-first revision-1 rule enforced, not selected by caller |
| Incomplete migration inventory/compatibility coverage | Read activation blocked |
| Candidate B detail after reuse | Same Position current resolved by journal support, no API search/dedup |
| Current NOT_DISPLAY and unsupported projection | No false historical resurrection; no fabricated negative eligibility/presentation |
| Architecture/legacy/network/P1/trusted-chain regression | Same owners, no legacy or CandidateProfile dependency, no new network, no new Requirement domain |

Reuse existing fixture and real canary stored evidence; do not create a second synthetic pipeline or acquire sources for this identity fix. Tests listed here are planned, not executed by writing this design.

## 12. Updated implementation whitelist and prohibited changes

The following repository-relative files are the complete core implementation whitelist for subsequent approval:

- lib/ingestion/domain/presentation.ts: versioned Decision audit/public variant, embedded projection, versioned ReadModel.
- lib/ingestion/pipeline/presentation-decision.ts: sole owner, Position revision series, V1 historical compatibility, validated V2 migration entrypoint.
- lib/ingestion/pipeline/presentation-read-model.ts: pure V2 descriptor/display projection and deterministic model, V1 historical codec.
- lib/ingestion/pipeline/presentation-persistence.ts: matching artifact/model assertions.
- lib/ingestion/pipeline/trusted-chain-composition-root.ts: explicit command version, read-only existing upstream resolver wiring, issuance/reuse references, journal support/migration replay.
- lib/ingestion/pipeline/trusted-chain-restoration.ts: verified original-envelope read contract and execution dependency assertions; do not rewrite old record schema/bytes.
- lib/ingestion/persistence/repositories.ts: one checked read snapshot with current/audit/migration metadata and detail support lookup.
- lib/ingestion/persistence/sqlite-shadow-persistence.ts: derived-only V2 indexes/compatibility repository.
- lib/production-persistence/git-append-only-execution-store.ts: verified original-envelope reads/reference reuse, checked history/current read projection; no second writer.
- lib/production-persistence/zero-cost-production-composition-root.ts: history/current separation and current publishing/restore; forward verified envelope boundary through its existing wrapper.
- lib/presentation-read-api/api.ts: additive retention/migration metadata and repository detail routing only; no dedup or decisions.
- lib/presentation-read-api/runtime.ts: future explicit selection of approved read-repository boundary only; no new backend/deployment.

Only when needed, add one internal pure helper `lib/ingestion/pipeline/presentation-semantic-projection.ts` for this version-pinned projection; no registry, engine, authority or separately sealed domain artifact. Update necessary existing exports. Add a new derived SQLite migration after the existing 003; do not edit 003 or production PostgreSQL migrations.

Test whitelist: existing presentation-decision, presentation-shadow, presentation-fixture, presentation-api, trusted-chain-restoration, Git execution-store, zero-cost composition-root/architecture, ingestion-boundary and shadow-migration tests plus a narrowly scoped V2 semantic-projection/migration test. Existing real canary tests may only receive contract/assertion updates using stored evidence. No canary orchestration becomes the production owner.

Forbidden: core Recall/Position resolution/Relevance/Requirement/PredicateResolution/Eligibility business changes; Candidate Evidence issuance; Admission/Source revision/incremental collection; Scheduler/retry/Actions; paid infrastructure; new endpoints/Web/JobBoard; third source/live network; legacy cleanup or writes to jobs/sources/sync_runs; old crawler/scoring/sync/jobs/API/workflows; edits to V1 authoritative persisted bytes.

## 13. Consistency review and completion meaning

All three design blockers are closed:

1. Unbound audit retention and bound public presentation are distinct variants of the same owner, with explicit read compatibility, no Candidate fallback, and append-only promotion.
2. Artifact issuance envelope remains unique; later executions preserve it and record new provenance in the existing journal; Process B verifies both boundaries.
3. A closed versioned semantic whitelist, safe unknown-difference handling, unique revision-1 migration rule, and V1 historical-only verification are specified.

The current-by-Position invariant is enforced by validated immutable history, not API/UI dedup or timestamps. No additional authoritative domain/Registry/Trusted Chain is introduced. No remaining architecture decision is left to an implementer; unsupported runtime data remains an honest review/integrity condition rather than a reason to weaken this design.

Final design conclusion: READY FOR IMPLEMENTATION, awaiting explicit implementation approval. The duplicate blocker remains NOT FIXED until implementation and the regression matrix pass. Scheduler prerequisites, remote executability, production deployment and Web cutover remain unverified/out of scope.
