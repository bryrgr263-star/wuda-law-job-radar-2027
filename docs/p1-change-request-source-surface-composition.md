# P1 Change Request — Source-Surface Composition

## Status

`IMPLEMENTED / VERIFIED`

## 1. Objective

This Change Request defines the smallest source-composition boundary required to answer one question safely:

> Which evidenced source surfaces form the Requirement Set for one exact OpportunityVersion?

It establishes how surfaces are discovered, bound, authorized, selected, related, versioned, conflicted, and hashed before they are admitted to a Requirement Set. Requirement semantics, Candidate evaluation, and recruitment identity remain dependencies, not subjects of this CR.

## 2. Scope

This CR designs only:

1. first-class SourceSurface records;
2. AttachmentToPositionBinding records;
3. surface-level AuthorityAssertion records;
4. an Evidence-backed Expected-Surface Manifest;
5. source publication/effective-time and revision selection;
6. conflict and precedence decisions;
7. an immutable SourceCompositionResult and content hash;
8. the gate from a COMPLETE composition into CR#12 StructuredRequirementSet.

This CR does not authorize collection, parsing of new Requirement semantics, CandidateProfile changes, Eligibility-result changes, production persistence, network access, real data ingestion, or source expansion.

## 3. Invariants

The following are non-bypassable:

1. **Recall First / No False Exclusion.** Missing, unresolved, conflicting, or non-authoritative source content never becomes Candidate `NOT_MATCH`.
2. **False Merge is worse than False Split.** A surface is not shared across Positions, Batches, Locations, or OpportunityVersions without explicit binding Evidence.
3. **Surface is not occurrence.** One SourceOccurrenceVersion may yield several independently bound surfaces.
4. **Source URL is not scope.** A shared URL, Snapshot, publisher, title, attachment, or text proximity does not establish shared Requirement applicability.
5. **Authority is not domain name.** An official domain does not alone prove that an individual surface is authoritative for Requirement content.
6. **Latest observation is not current effect.** Snapshot observation or ingestion time never selects a Requirement version by itself.
7. **Precedence is not a heuristic.** No fetch time, URL, text length, source score, fuzzy similarity, or bare `official > third-party` ordering may resolve a conflict.
8. **Composition is upstream.** Only a COMPLETE composition may enter CR#12; a non-COMPLETE composition produces `NOT_ALLOWED`, creates no EligibilityAssessment, and retains the Opportunity.
9. **History is immutable.** Source surfaces, manifests, composition results, Requirement Sets, and prior assessments are never overwritten or destructively migrated.
10. **Known-but-unresolved content is retained.** It must appear in the result and hash; it may not be omitted to obtain COMPLETE.

## 4. SourceSurface Model

`SourceSurface` is a first-class immutable Domain object. It represents the exact Requirement-bearing or Requirement-relevant fragment of a source, not an entire source occurrence by default.

### 4.1 Surface Identity and Provenance

Every SourceSurface must contain:

- `source_surface_id`;
- `surface_kind`;
- `source_occurrence_version_id`;
- `snapshot_id` and `extracted_record_id` provenance;
- one exact surface locator and, when applicable, ordered span/row/cell/page locators;
- `surface_content_hash` over the represented source content;
- source publication time when observed;
- source effective period when observed;
- `surface_status` and all blocker Evidence;
- resolver and serialization versions.

`source_occurrence_version_id` must identify the observed source version, but is not itself a SourceSurface. A single announcement occurrence may yield an announcement-body surface, several attachment surfaces, a table-row surface, and a correction-reference surface.

### 4.2 Surface Kinds

The minimal closed kind set is:

- `ANNOUNCEMENT_BODY`;
- `ANNOUNCEMENT_ATTACHMENT`;
- `POSITION_TABLE_ROW`;
- `OFFICIAL_SYSTEM_RECORD`;
- `SUPPLEMENT_NOTICE`;
- `CORRECTION_NOTICE`;
- `REPLACEMENT_NOTICE`;
- `OFFICIAL_DIRECTORY_REFERENCE`;
- `THIRD_PARTY_RECORD`;
- `OTHER_REQUIREMENT_SURFACE`;
- `UNRESOLVED`.

`surface_kind` describes what was observed. It does not establish authority, applicable target, composition role, or precedence.

### 4.3 Surface Status

The surface status must distinguish `OBSERVED`, `ACQUIRED`, `PARSED`, `MISSING`, `BINDING_UNRESOLVED`, `AUTHORITY_UNRESOLVED`, `RELATION_UNRESOLVED`, `EXCLUDED_BY_EVIDENCED_DECISION`, and `UNRESOLVED`. Status is additive evidence state; it is not a deletion mechanism.

### 4.4 Composition Role

Each surface has an Evidence-backed composition role for one target scope:

- `PRIMARY` — may directly satisfy the covered Requirement scope;
- `SUPPLEMENT` — adds a proven missing scope without replacing another scope;
- `REFERENCE` — discovery, cross-validation, or contextual reference only;
- `OVERRIDE` — replaces only an explicitly proven affected scope;
- `CORRECTION` — corrects only an explicitly proven affected scope;
- `SUPERSEDES` — succeeds a prior surface only through an explicit relationship;
- `CONFLICT` — a non-contributing state assigned after incompatible content is detected.

The role must carry its target, authority assertion, binding, effective scope, relationship, Evidence, and decision provenance. A caller may not mark a source `OVERRIDE`, `CORRECTION`, `SUPERSEDES`, or `CONFLICT` without the corresponding relation Evidence.

## 5. Attachment Binding

`AttachmentToPositionBinding` is a first-class immutable relation. It answers which portion of an attachment applies to which PositionVersion and OpportunityVersion.

Each binding contains:

- `attachment_to_position_binding_id`;
- attachment `source_surface_id`;
- target `position_version_id` and `opportunity_version_id`;
- exact `row_locator`, `cell_locator`, `page_locator`, and/or text-span locator as applicable;
- binding Evidence Fragment IDs and Identity Evidence IDs;
- `binding_state` (`RESOLVED` or `UNRESOLVED`);
- certainty, resolver version, and `binding_hash`.

The relation supports independent bindings such as:

```text
Attachment surface
  ├── row 12 → Position A001 → OpportunityVersion A001-v1
  ├── row 13 → Position A002 → OpportunityVersion A002-v1
  └── row 14 → Position A003 → OpportunityVersion A003-v1
```

An attachment-wide Requirement may be used only when its own Evidence explicitly states the attachment-wide target scope. Attachment membership alone never broadcasts a row Requirement to sibling Positions.

## 6. AuthorityAssertion

`SourceDefinition.authority_level` remains a publisher-level discovery signal. This CR adds a separate Surface-level `AuthorityAssertion`; it does not widen or reinterpret `SourceDefinition.authority_level`.

### 6.1 Assertion Contract

Every assertion contains:

- `authority_assertion_id` and `authority_assertion_hash`;
- asserted `source_surface_id`;
- `authority_state`;
- authority issuer and, when distinct, authorizing organization;
- exact target and target scope;
- effective period;
- Evidence showing the authority relationship;
- issuer, resolver, and serialization versions.

The closed state set is:

- `OFFICIAL_AUTHORITATIVE`;
- `AUTHORIZED_SCOPED`;
- `THIRD_PARTY_REFERENCE_ONLY`;
- `UNKNOWN`.

### 6.2 Authority Rules

An official attachment may become Requirement-authoritative only when the evidence chain proves:

```text
Official Announcement or official system record
  → explicitly publishes or references
Official Attachment
  → exact attachment surface and applicable target
```

An official hostname, storage hostname, publication proximity, or mirror URL alone is not this chain. `AUTHORIZED_SCOPED` must not be used outside its explicit issuer, target, and time scope. `UNKNOWN` blocks COMPLETE.

## 7. Expected-Surface Manifest

The Expected-Surface Manifest prevents false COMPLETE caused by caller-selected input.

### 7.1 Manifest Contract

`ExpectedSurfaceManifest` is produced by the source-composition resolver from the immutable observed source graph. It is not a parser argument that may be manually narrowed.

It contains:

- `expected_surface_manifest_id` and `manifest_hash`;
- target `opportunity_version_id`;
- source inventory boundary and discovery resolver version;
- ordered manifest entries;
- all discovery Evidence and source metadata references;
- completeness state for discovery itself.

Every manifest entry contains:

- an expected-surface identity or a clearly identified missing expected surface;
- `REQUIRED`, `OPTIONAL`, `REFERENCE_ONLY`, or `UNEXPECTED` classification;
- runtime status: `PRESENT`, `MISSING`, or `UNRESOLVED`;
- applicable target scope;
- discovery reason and Evidence;
- any cross-reference that made the surface expected.

`UNEXPECTED` surfaces are retained. They cannot be silently excluded or silently admitted; they require classification before final COMPLETE.

### 7.2 Closure Rule

The resolver must include all surfaces and cross-references observable within the declared official source package. A required attachment named by an announcement, table, plan, batch, correction, or official metadata is mandatory even when absent locally.

If the inventory boundary itself cannot establish whether a referenced Requirement-bearing surface exists, the manifest is `UNRESOLVED`, not caller-complete. A self-contained official surface may be composition-complete only when all observed cross-references and Requirement-bearing links have been accounted for with Evidence.

## 8. Version / Effective Time

The following times are distinct and never substituted automatically:

- source publication time;
- source effective-from and effective-to time;
- correction or superseding time;
- Snapshot observation time;
- ingestion time.

`SourceVersionSelection` must identify the target scope, candidate Surface versions, selected period, Evidence, and resolver version. It may select a Surface only when target scope, relationship, and effective period are resolved.

If effective time or version relation is unknown, the result is `REVIEW_REQUIRED / NOT_ALLOWED`; the system must not select the newest Snapshot, latest ingestion run, or longest text as current.

## 9. Revision Relation

This CR consumes the existing recruitment revision lifecycle but adds a source-composition-level `SurfaceRevisionRelation` for exact surface effects.

It records:

- source and target surface IDs;
- `ORIGINAL`, `CORRECTION`, `SUPPLEMENT`, `REPLACEMENT`, `SUPERSEDES`, `CANCELLED`, or `REINSTATED` relationship;
- affected target and Requirement scope;
- effective period;
- authority assertion;
- relation Evidence, certainty, resolver version, and hash.

`SUPPLEMENT` adds only its proven scope. `CORRECTION`, `REPLACEMENT`, and `SUPERSEDES` may change a selected scope only if their target, authority, scope, and effective period are explicit. An unresolved relation remains retained and blocks COMPLETE; it never deletes the original Surface.

## 10. Precedence Decision

`PrecedenceDecision` is separate from authority. It never derives a winner from a numeric source score.

The decision considers, with direct Evidence for each relevant factor:

1. Surface-level authority;
2. explicit correction or superseding relation;
3. exact target specificity;
4. effective period;
5. Evidence adequacy for the asserted relation;
6. composition role.

The only decisions are `NO_DECISION`, `EVIDENCED_OVERRIDE`, `MANUAL_RESOLUTION`, and `CONFLICT`. `MANUAL_RESOLUTION` is future controlled review with preserved Evidence and is never an automatic parser action. Lack of sufficient evidence yields `NO_DECISION` or `CONFLICT`, not a winner.

## 11. Conflict Contract

`SourceConflict` represents incompatible Requirement-bearing observations after target and temporal scope are compared.

It records:

- `source_conflict_id`;
- competing surface IDs and authority assertions;
- target and affected Requirement dimension/scope;
- competing Observation and Evidence IDs;
- effective periods;
- status and resolution record;
- resolver version and content hash.

Allowed statuses are `DETECTED`, `REVIEW_REQUIRED`, `RESOLVED_BY_EVIDENCED_OVERRIDE`, and `RESOLVED_MANUALLY`.

For example, `学历 = 硕士` versus `学历 = 本科` remains two evidenced observations. Until an explicit and valid resolution exists:

```text
Composition = CONFLICT
Requirement = REVIEW_REQUIRED
Eligibility = NOT_ALLOWED
Opportunity = retained
```

The resolver must not choose by fetch time, URL, text length, source ranking, or an unscoped official/third-party comparison.

## 12. Composition Result

`SourceCompositionResult` is a first-class immutable result for exactly one OpportunityVersion. It contains:

- `source_composition_id`;
- target `opportunity_version_id`;
- selected surfaces;
- expected manifest and all expected surfaces;
- excluded surfaces with evidenced reasons;
- unresolved and missing surfaces;
- authority assertions;
- attachment bindings and other target bindings;
- source-version selections;
- revision relations;
- conflicts and precedence decisions;
- composition status;
- `content_hash`, `manifest_hash`, resolver version, and serialization version.

The only statuses are `COMPLETE`, `INCOMPLETE`, `CONFLICT`, `REVIEW_REQUIRED`, and `UNRESOLVED`.

Only `COMPLETE` permits construction of a CR#12 StructuredRequirementSet. All other states produce `NOT_ALLOWED`, create no EligibilityAssessment, and retain the Opportunity for product review.

## 13. Composition Hash

The canonical composition hash covers, at minimum:

- Surface identity, kind, status, content hash, locator, and ordered spans;
- SourceOccurrenceVersion, Snapshot, ExtractedRecord, and source provenance;
- all authority assertions and effective periods;
- attachment and other target bindings;
- target scopes, relations, and version selections;
- every Expected-Surface Manifest entry and discovery Evidence;
- selected, excluded, missing, unexpected, and unresolved surfaces;
- conflicts, precedence decisions, and resolutions;
- resolver and serialization versions.

Any change produces a new immutable Composition Result and a new hash. A Requirement Set that consumes a composition must retain the source-composition ID and matching hash in its manifest; mismatch blocks dispatch.

## 14. Announcement / Position / Batch / Location Binding

- Announcement-level Requirements may project only to explicitly evidenced OpportunityVersion targets.
- Position-table row Requirements bind only to the exact row target.
- Batch-level Requirements bind only to the proven RecruitmentBatch and its evidenced OpportunityVersion targets.
- Location-level Requirements bind only to the exact `LocationAssignment` targets.
- Plan, publisher, company, title, URL, Snapshot, attachment membership, and physical text proximity are never default inheritance rules.
- Provisional Plan, Position, Employer, or Opportunity identity remains retainable. A source-local provisional OpportunityVersion may receive a source-local composition only when its binding evidence is exact; it must never be automatically merged with another opportunity.

## 15. CR#11 Boundary

CR#11 owns `MajorExpression`, `MajorTarget`, versioned major-directory identity, and `MajorMatchRelation` semantics. This CR decides only whether a particular authoritative and correctly bound Surface contributes that expression.

This CR must not reinterpret or equate `法律`, `法学`, `法学类`, `法律类`, `法律（0351）`, `法律（非法学）`, or `法律硕士（非法学）`.

## 16. CR#12 Boundary

CR#12 owns Requirement logic trees, modality, selectors, applicability, and condition-level context binding. This CR supplies the verified source package from which CR#12 may construct those conditions.

CR#12 does not discover attachments, close an expected-surface inventory, assert authority, choose precedence, or resolve source conflicts. A CR#12 source reference remains downstream provenance, not a source-composition resolver.

## 17. CR#10 Boundary

CR#10 evaluates Candidates only against a COMPLETE, hash-validated, context-bound Requirement Set with supported capabilities. It must not choose surfaces, locate attachments, determine authority, resolve conflicts, or infer source precedence.

`SourceCompositionResult.status != COMPLETE` always results in `NOT_ALLOWED`; it never becomes `NOT_MATCH` and never creates an EligibilityAssessment.

## 18. Third-party Boundary

Third-party surfaces default to `THIRD_PARTY_REFERENCE_ONLY` and `REFERENCE`. They may support discovery, official-link discovery, cross-validation, and retained reference context.

They may not independently form a COMPLETE composition, override official Requirement content or Position identity, produce `NOT_MATCH`, or establish a vacancy as closed. A third-party/official disagreement retains both Evidence and becomes `CONFLICT / REVIEW_REQUIRED` unless a future approved authority assertion proves another treatment.

## 19. Failure Matrix

| # | Scenario | Composition allowed | Composition result | Requirement state | Eligibility | Opportunity / product retention |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Announcement references attachment; attachment absent | No | INCOMPLETE | INCOMPLETE | NOT_ALLOWED | Retain; show reviewable uncertainty |
| 2 | Attachment exists; Position binding fails | No | REVIEW_REQUIRED | REVIEW_REQUIRED | NOT_ALLOWED | Retain; show reviewable uncertainty |
| 3 | One attachment, multiple Positions | Only per resolved row binding | Per-target result | Isolated per target | Only COMPLETE target | Retain all; never broadcast rows |
| 4 | One Position, multiple sources | Only after scope/relation resolution | COMPLETE or REVIEW_REQUIRED | Same mapping | Per gate | Retain all evidence |
| 5 | Original plus Correction | Only explicit target/scope/effect | COMPLETE or REVIEW_REQUIRED | Same mapping | Per gate | Retain original and correction |
| 6 | Original plus Supplement | Only explicit added scope | COMPLETE or REVIEW_REQUIRED | Same mapping | Per gate | Retain both |
| 7 | Original plus Superseding | Only explicit target/effect | COMPLETE or REVIEW_REQUIRED | Same mapping | Per gate | Retain historical surface |
| 8 | Two authoritative sources conflict | No unresolved selection | CONFLICT | REVIEW_REQUIRED | NOT_ALLOWED | Retain; show conflict |
| 9 | Official and third-party conflict | No unresolved selection | CONFLICT | REVIEW_REQUIRED | NOT_ALLOWED | Retain both Evidence |
| 10 | Announcement-level Requirement | Only explicit target projection | COMPLETE or REVIEW_REQUIRED | Same mapping | Per gate | Retain; no broadcast by URL |
| 11 | Position-level Requirement | Only exact Position/row target | COMPLETE or REVIEW_REQUIRED | Same mapping | Per gate | Sibling Positions isolated |
| 12 | Batch-level Requirement | Only exact Batch target | COMPLETE or REVIEW_REQUIRED | Same mapping | Per gate | Other Batches isolated |
| 13 | Location-level Requirement | Only exact LocationAssignment | COMPLETE or REVIEW_REQUIRED | Same mapping | Per gate | Other locations isolated |
| 14 | Effective time unknown | No | REVIEW_REQUIRED | REVIEW_REQUIRED | NOT_ALLOWED | Retain |
| 15 | Version unknown | No | REVIEW_REQUIRED | REVIEW_REQUIRED | NOT_ALLOWED | Retain |
| 16 | Authority unknown | No | REVIEW_REQUIRED | REVIEW_REQUIRED | NOT_ALLOWED | Retain |
| 17 | Position identity provisional | Source-local only, with exact binding | COMPLETE or UNRESOLVED | Per result | Only former may run | Retain; no cross-source merge |
| 18 | Opportunity identity provisional | Source-local only, with exact binding | COMPLETE or UNRESOLVED | Per result | Only former may run | Retain; no cross-source merge |
| 19 | Required Surface missing | No | INCOMPLETE | INCOMPLETE | NOT_ALLOWED | Retain |
| 20 | Unexpected Surface discovered | Finalization paused | REVIEW_REQUIRED | REVIEW_REQUIRED | NOT_ALLOWED | Retain and classify |
| 21 | Historical and current source mixed | No until temporal selection resolves | REVIEW_REQUIRED | REVIEW_REQUIRED | NOT_ALLOWED | Retain versions |
| 22 | Source relation unresolved | No | REVIEW_REQUIRED | REVIEW_REQUIRED | NOT_ALLOWED | Retain relations |

## 20. Product Retention Semantics

Identity `UNRESOLVED`, composition `INCOMPLETE/CONFLICT/REVIEW_REQUIRED/UNRESOLVED`, Requirement `INCOMPLETE/REVIEW_REQUIRED`, and Eligibility `NOT_ALLOWED/INSUFFICIENT/UNKNOWN` are not product-pool exclusion states.

Future product presentation may label these states for review, but must not hide, delete, or mark an Opportunity unsuitable. Eligibility-based exclusion may be considered only under a separately approved product policy and only from a complete, traceable, capability-supported, affirmatively proven `NOT_MATCH`.

## 21. Implementation Whitelist

No implementation is authorized by this draft. A future approval may be limited to:

1. a new source-surface composition Domain module and branded IDs;
2. additive Composition Result and manifest references in Requirement contracts;
3. a deterministic, offline source-composition resolver and validators;
4. a narrow CR#12 input gate that rejects non-COMPLETE/mismatched composition hashes without changing CR#12 logic semantics;
5. synthetic offline tests for this CR, CR#9–CR#12, recruitment-context compatibility, and guards;
6. this CR's implementation-status update only after verification.

It must preserve legacy Requirement Sets and identities through additive provenance and versioned references. Persistence changes, if ever needed, require separate approval.

## 22. Forbidden Scope

This CR must not modify CR#10 Engine semantics, CR#11 major semantics, CR#12 logic/modality/applicability semantics, Recruitment Context & Position Identity, P2, Canary data, collectors, scheduler, API, Web, Supabase, production persistence, Recommendation, Application State, third-party integrations, nationwide directories, organization resolution, real production data, or any network behavior.

It must not use LLM reasoning, embeddings, fuzzy matching, title/duty/unit inference, CandidateProfile reverse inference, historical hiring outcomes, URL-only identity, or destructive legacy migration.

## 23. Test Plan

Future synthetic offline controls must cover every row of Section 19 and additionally prove:

1. attachment row/cell/page binding hash mutation invalidates composition;
2. required-surface manifest cannot be narrowed by caller input;
3. official-domain-only authority is rejected;
4. explicit announcement-to-attachment authority chains are accepted;
5. third-party `REFERENCE` cannot contribute to COMPLETE;
6. override without target, scope, authority, or effective-time Evidence is rejected;
7. unknown relation and unknown authority cannot be converted to Candidate failure;
8. a corrected target updates only its new OpportunityVersion and preserves history;
9. selected, excluded, unexpected, unresolved, and missing surfaces all affect the composition hash;
10. Composition non-COMPLETE blocks CR#12 construction and CR#10 dispatch without creating an assessment;
11. provisional source-local targets are retained and never automatically merged;
12. product-retention invariants hold for every non-COMPLETE state.

Required regressions remain CR#9, CR#10, CR#11, CR#12, Recruitment Context & Position Identity, P1, tracked P2, TypeScript, Architecture Boundary, Application Boundary, Network Guard, and `git diff --check`.

## 24. Network Status

This design requires no network request. Any future implementation validation uses synthetic local fixtures only unless a separately approved collection phase authorizes a new endpoint.

`NETWORK REQUESTS = 0`

## 25. Readiness Checklist

Implementation approval requires all of the following to be explicitly reviewed and approved:

- [ ] SourceSurface and SourceSurface status are first-class and immutable.
- [ ] AttachmentToPositionBinding has exact target and locator Evidence.
- [ ] AuthorityAssertion is Surface-level and time/scope bound.
- [ ] Expected-Surface Manifest is resolver-produced and cannot be caller-narrowed.
- [ ] Version/effective-time and revision selection are evidence-bound.
- [ ] Conflict and precedence decisions preserve competing Evidence.
- [ ] Composition Result and hash include every required semantic input.
- [ ] CR#11, CR#12, CR#10, and recruitment identity boundaries remain unchanged.
- [ ] Non-COMPLETE composition retains Opportunities and blocks Eligibility only.
- [ ] Future implementation file whitelist and test plan receive separate approval.

## 26. Final Verdict

`IMPLEMENTED / VERIFIED`

This document records the verified, whitelist-bounded implementation of source-surface composition. It does not authorize source collection, real Requirement composition, or Eligibility execution.

## 27. Final Closure Revision and Normative Supersession

This section is the final closure revision. It is normative and supersedes only any conflicting statement in Sections 2, 4–13, 21, 22, 23, 25, and 26. It does not change the ownership of CR#10, CR#11, CR#12, or Recruitment Context & Position Identity.

The verified status is:

```text
IMPLEMENTED / VERIFIED
```

The approved implementation boundary, when separately approved, is the closed chain below. No stage may be skipped.

```text
DiscoveryBoundary
  → SourcePackageInventory
  → SourceSurface
  → SourceSurfaceBinding
  → AuthorityAssertion
  → Expected-Surface Manifest
  → SourceVersionSelection
  → PrecedenceDecision / SourceConflict
  → SourceCompositionResult
  → CompositionHash
  → CR#12 composition-backed manifest
  → CR#10 runtime Composition Gate
```

## 28. SourceSurfaceBinding Contract

`SourceSurfaceBinding` is the general, first-class, immutable relationship between any SourceSurface and any recruitment-context target. `AttachmentToPositionBinding` is a specialization; it is never the general binding substitute.

### 28.1 Required Fields

Every binding contains:

- `source_surface_binding_id`;
- `source_surface_id`;
- `target_type`;
- `target_id`;
- `target_version_id` when that target has a versioned identity;
- `binding_kind`;
- `binding_status`;
- target and binding Evidence Fragment IDs;
- `created_context` and `observed_context` containing source occurrence version, Snapshot, ExtractedRecord, observed time, and resolver version;
- `binding_hash` and schema version.

`target_type` is one of `ANNOUNCEMENT`, `ANNOUNCEMENT_VERSION`, `RECRUITMENT_PLAN`, `RECRUITMENT_BATCH`, `POSITION`, `POSITION_VERSION`, `OPPORTUNITY`, `OPPORTUNITY_VERSION`, `LOCATION_ASSIGNMENT`, `SYSTEM_RECORD`, or `UNRESOLVED`.

`binding_kind` is one of `SURFACE_DECLARATION`, `ANNOUNCEMENT_UNIFORM`, `ATTACHMENT_PUBLICATION`, `ATTACHMENT_ROW`, `BATCH_APPLICABILITY`, `LOCATION_APPLICABILITY`, `SYSTEM_RECORD_APPLICABILITY`, `REVISION_SCOPE`, `AUTHORITY_BASIS`, `OTHER`, or `UNRESOLVED`.

`binding_status` is `RESOLVED`, `MISSING_TARGET`, `TARGET_VERSION_MISMATCH`, `LOCATOR_INVALID`, `EVIDENCE_INCOMPLETE`, or `UNRESOLVED`. Only `RESOLVED` may contribute to COMPLETE.

### 28.2 Binding Integrity

The resolver must prove that a referenced PositionVersion is the PositionVersion of the referenced OpportunityVersion. A target missing either required version, a Position/Opportunity version mismatch, an invalid row/cell/page/span locator, or missing binding Evidence is never repaired by inference. It creates the corresponding non-resolved binding status and blocks COMPLETE whenever the binding is material.

The binding hash canonically includes every field above, ordered locators, exact target references, Evidence IDs, source provenance, resolver version, and schema version. A binding may not be mutated after it is consumed by a Composition Result.

## 29. Attachment Publication and Row Binding

An attachment has two separate first-class relationships:

1. `AttachmentPublicationBinding` is a `SourceSurfaceBinding` with kind `ATTACHMENT_PUBLICATION`. It links the official Announcement Surface or official System Record Surface that publishes or explicitly declares an attachment to the exact Attachment Surface.
2. `AttachmentToPositionBinding` is a specialization of `SourceSurfaceBinding` with kind `ATTACHMENT_ROW`. It links a bounded attachment row, cells, page, or span to one exact PositionVersion and OpportunityVersion.

`AttachmentToPositionBinding` must include `attachment_publication_binding_id`, attachment surface ID, PositionVersion ID, OpportunityVersion ID, row/cell/page/span locators, all binding Evidence, binding status, binding version, and binding hash.

The following graph is mandatory for an attachment used as Requirement authority:

```text
Official Announcement Surface or official System Record Surface
  → AttachmentPublicationBinding
  → Attachment Surface
  → AttachmentToPositionBinding
  → PositionVersion and OpportunityVersion
```

For an attachment-wide clause, the row binding may be replaced only by an explicit `ANNOUNCEMENT_UNIFORM` or `SURFACE_DECLARATION` binding whose Evidence establishes the entire target set. Attachment membership never establishes such scope.

## 30. AuthorityAssertion Closure

`AuthorityAssertion` has two required surface references:

- `asserted_source_surface_id` — the Surface whose Requirement-bearing authority is asserted;
- `authority_basis_source_surface_id` — the official Surface that publishes, delegates to, references, or otherwise establishes that authority.

The assertion also contains `authority_assertion_id`, `authority_assertion_hash`, issuer organization identity, `authority_state`, target scope, effective period, Evidence Fragment IDs, basis binding ID when applicable, resolver version, and schema version.

The only authority states are `OFFICIAL_AUTHORITATIVE`, `AUTHORIZED_SCOPED`, `THIRD_PARTY_REFERENCE_ONLY`, and `UNKNOWN`.

For a self-published official announcement body, the basis Surface may equal the asserted Surface only when the issuer and direct official publication Evidence are explicit. For an attachment, the basis Surface must be a distinct official publication/declaration Surface and must be linked through `AttachmentPublicationBinding`. Text Evidence alone cannot replace the required surface graph.

`UNKNOWN`, absent issuer, absent basis Surface, unresolved target scope, invalid effective period, or missing Evidence is an unresolved authority state and blocks COMPLETE for a material Surface.

## 31. DiscoveryBoundary and SourcePackageInventory

`DiscoveryBoundary` and `SourcePackageInventory` are first-class immutable contracts. They close the question of what source package was examined and why its manifest cannot be caller-narrowed.

### 31.1 DiscoveryBoundary

Every DiscoveryBoundary contains:

- `discovery_boundary_id`;
- target OpportunityVersion ID and the immutable source-context identities considered;
- boundary kind: `ANNOUNCEMENT_PACKAGE`, `PLAN_PACKAGE`, `BATCH_PACKAGE`, `POSITION_PACKAGE`, `OFFICIAL_SYSTEM_PACKAGE`, or `UNRESOLVED`;
- initiating official Surface IDs and source metadata references;
- discovery scope and admissible source relation types;
- discovery Evidence;
- `as_of` time;
- discovery observed-at time, extractor/discovery-resolver versions, and schema version;
- `discovery_boundary_hash`.

The boundary must be derived from the Recruitment Context evidence graph and observed official cross-references. A caller cannot replace it with an arbitrary subset of Snapshots, rows, URLs, or surfaces.

### 31.2 SourcePackageInventory

Every SourcePackageInventory contains:

- `source_package_inventory_id` and inventory hash;
- exactly one DiscoveryBoundary ID and matching `as_of`;
- all discovered Surface IDs in deterministic order;
- all expected-surface entries, including missing expected surfaces;
- discovery Evidence and cross-reference Evidence for each entry;
- inventory-completeness status: `CLOSED`, `OPEN_MISSING_REQUIRED`, `OPEN_UNRESOLVED`, or `UNRESOLVED`;
- unexpected-surface disposition and discovery/resolver/schema versions.

An inventory is `CLOSED` only when all observed official cross-references and Requirement-bearing source metadata inside its boundary are classified and every required expected surface is represented as present or explicitly missing. It is never closed merely because a caller supplied one Surface.

## 32. Expected-Surface Manifest Entry Closure

The Expected-Surface Manifest is deterministically derived from one closed SourcePackageInventory. It is not a hand-authored parser input.

Every entry contains:

- `expected_surface_entry_id` and non-null `expected_surface_key`;
- `source_surface_id` when present, otherwise `null` plus a missing-surface declaration locator;
- `expectedness`: `REQUIRED`, `OPTIONAL`, `REFERENCE_ONLY`, or `UNEXPECTED`;
- `requirement_level`: `REQUIREMENT_BEARING`, `NON_REQUIREMENT_REFERENCE`, or `UNRESOLVED`;
- authority status and AuthorityAssertion ID when present;
- binding status and material SourceSurfaceBinding IDs;
- version-selection status and SourceVersionSelection ID when present;
- coverage status: `COVERED`, `MISSING`, `UNRESOLVED`, or `OUT_OF_SCOPE`;
- resolution status, target scope, discovery Evidence, and entry hash.

Expectedness answers only whether the Surface is expected in this inventory. It does not substitute for authority, binding, version, coverage, or conflict resolution.

An `OPTIONAL`, `REFERENCE_ONLY`, or `UNEXPECTED` entry does not independently block COMPLETE merely because it is absent or non-authoritative. It becomes material and blocks COMPLETE when it is a required coverage source or an authority, binding, revision, version-selection, precedence, or conflict dependency of a selected required Surface. An unexpected Requirement-bearing surface within the target scope blocks COMPLETE until it is classified as required, optional, reference-only, or evidenced out-of-scope.

## 33. As-Of and SourceVersionSelection

Every SourceCompositionResult has a non-null, immutable `composition_as_of`. "Current effective version" means only the selected result at this exact time.

`SourceVersionSelection` contains:

- `source_version_selection_id`;
- source identity and target scope;
- candidate Surface/version IDs;
- selected Surface/version ID or `null`;
- excluded Surface/version IDs and evidenced reasons;
- selection status: `RESOLVED`, `NO_EFFECTIVE_VERSION`, `EFFECTIVE_TIME_UNKNOWN`, `RELATION_UNRESOLVED`, `CONFLICT`, or `UNRESOLVED`;
- publication, effective-from/effective-to, correction, observation, and ingestion times as separately observed values;
- selection Evidence, resolver version, schema version, and selection hash.

Selection is resolved only when the target, candidate versions, effective period at `composition_as_of`, and all material correction/replacement/superseding relations are evidenced. A newer Snapshot, later ingestion time, matching URL, or similar title never selects a version.

## 34. Revision Relation and PrecedenceDecision

`SurfaceRevisionRelation` binds a source Surface to exact target Surface IDs and contains relation kind, affected target scope, affected Requirement scope, effective period, AuthorityAssertion IDs, Evidence, certainty, resolver version, and hash. Its relation kinds are `ORIGINAL`, `CORRECTION`, `SUPPLEMENT`, `REPLACEMENT`, `SUPERSEDES`, `CANCELLED`, and `REINSTATED`.

`PrecedenceDecision` is first-class and contains:

- `precedence_decision_id`;
- selected Surface IDs;
- excluded Surface IDs;
- applicable target and Requirement scope;
- effective period and `composition_as_of`;
- AuthorityAssertion IDs;
- explicit `precedence_rule` limited to an evidenced revision/authority/specificity/time rule;
- decision Evidence;
- decision status: `NOT_APPLICABLE`, `RESOLVED`, `NO_DECISION`, `CONFLICT`, or `UNRESOLVED`;
- resolver version, schema version, and decision hash.

It is incomplete when selected/excluded sets are inconsistent, an affected scope or effective period is absent, an asserted precedence factor lacks Evidence, or its target conflicts with a material binding/version selection. Any material non-`RESOLVED`/non-`NOT_APPLICABLE` decision prevents COMPLETE.

Authority is evidence about who may speak. Precedence is an evidence-backed choice among overlapping, effective, authoritative content. Neither is a heuristic score, and neither implies the other.

## 35. SourceConflict Closure

Conflict comparison occurs only after target binding, authority, temporal selection, and Requirement semantic projection are resolved. A `SourceConflict` records competing Surface IDs, selected target and Requirement scope, competing Observation/Fact IDs, authority assertions, effective periods, Evidence, status, resolution, resolver version, schema version, and hash.

The only statuses are `DETECTED`, `REVIEW_REQUIRED`, `RESOLVED_BY_EVIDENCED_OVERRIDE`, and `RESOLVED_MANUALLY`. `RESOLVED_MANUALLY` is a future controlled-review decision with preserved evidence; it is never a parser heuristic.

An unresolved conflict affecting required coverage makes the Composition `CONFLICT`, maps the Requirement Set to `REVIEW_REQUIRED`, blocks CR#10 execution, and retains the Opportunity. A non-material reference-only conflict remains retained but cannot be used to override authoritative Requirement content.

## 36. SourceCompositionResult and CompositionHash

`SourceCompositionResult` is immutable and contains its ID, target OpportunityVersion ID, `composition_as_of`, DiscoveryBoundary, SourcePackageInventory, Expected-Surface Manifest, all SourceSurface registries, bindings, authority assertions, version selections, revision relations, precedence decisions, conflicts, selected/excluded/missing/unresolved Surfaces, status, content hash, manifest hash, extractor/parser/resolver versions, schema/domain version, and serialization version.

The only Composition statuses are `COMPLETE`, `INCOMPLETE`, `CONFLICT`, `REVIEW_REQUIRED`, and `UNRESOLVED`.

CompositionHash canonically covers the complete semantic content of every object named above, including ordered locators and spans, evidence IDs, all Surface provenance, selected and excluded Surface reasons, `composition_as_of`, extractor version, parser version, discovery-resolver version, composition-resolver version, schema/domain version, and serialization version.

Any change to Surface segmentation, attachment locator, discovery rule, parser rule, target binding, authority, version selection, conflict, precedence, manifest, or versions creates a new Composition Result and hash. A prior Composition Hash is never reused under a changed extractor, parser, resolver, schema, or domain version.

## 37. Complete Determination Formula

To avoid a circular dependency, Source Composition and CR#12 admission have distinct complete predicates. A SourceCompositionResult is completed before CR#12 is constructed; a CR#12 Requirement Set is composition-backed complete only after it references that completed result.

Let:

- `D` = DiscoveryBoundary is valid and SourcePackageInventory is `CLOSED`;
- `R` = every material `REQUIRED` manifest entry has `COVERED` coverage;
- `A` = every material Surface has resolved AuthorityAssertion;
- `B` = every material SourceSurfaceBinding is `RESOLVED`;
- `V` = every material SourceVersionSelection is `RESOLVED`;
- `P` = every material PrecedenceDecision is `RESOLVED` or `NOT_APPLICABLE`;
- `C` = no unresolved conflict affects required coverage;
- `T` = `composition_as_of` is present and internally consistent;
- `H` = the Composition Hash and all nested hashes validate;
- `X` = CR#12 composition reference, manifest, target, `as_of`, and hashes exactly match the verified SourceCompositionResult.

```text
SourceCompositionResult.status = COMPLETE
  ⇔ D ∧ R ∧ A ∧ B ∧ V ∧ P ∧ C ∧ T ∧ H

CR#12.composition_backed_complete
  ⇔ SourceCompositionResult.status = COMPLETE ∧ X ∧ CR#12 semantic completeness

CR#10.composition_gate_pass
  ⇔ CR#12.composition_backed_complete ∧ trusted-runtime verification
```

Failure of any predicate makes the corresponding result non-complete. `OPTIONAL`, `REFERENCE_ONLY`, and `UNEXPECTED` entries are non-blocking only under the materiality rule in Section 32; they become blocking as soon as required coverage or a material authority/binding/version/precedence/conflict dependency relies on them.

## 38. Composition Invariants

| ID | Invariant |
| --- | --- |
| I-01 | Without a valid DiscoveryBoundary and closed SourcePackageInventory, Composition is never COMPLETE. |
| I-02 | A material required Surface without resolved authority is never COMPLETE. |
| I-03 | A material required Surface without resolved binding is never COMPLETE. |
| I-04 | A material required Surface without resolved version selection is never COMPLETE. |
| I-05 | An unresolved required conflict is never COMPLETE. |
| I-06 | A Composition without explicit `composition_as_of` is never COMPLETE. |
| I-07 | A CompositionHash omitting extractor, parser, discovery-resolver, composition-resolver, schema, or domain version is invalid. |
| I-08 | CR#12 without exact source-composition ID, hashes, status, and `as_of` cannot be composition-backed COMPLETE. |
| I-09 | A Legacy RequirementSet is readable but `LEGACY_UNCOMPOSED`; it cannot be silently promoted. |
| I-10 | CR#10 must reject every StructuredRequirementSet that fails trusted Composition Gate verification. |
| I-11 | Missing, uncertain, conflicting, or unverifiable source state never becomes Candidate `NOT_MATCH`. |
| I-12 | Any state that cannot prove non-satisfaction remains `INSUFFICIENT`, `REVIEW_REQUIRED`, `UNKNOWN`, `INCOMPLETE`, `CONFLICT`, or another explicit non-exclusion state. |

## 39. CR#12 Composition-Backed Manifest Contract

The future additive CR#12 manifest contract must contain a `SourceCompositionReference` with:

- `source_composition_id`;
- `composition_hash`;
- `composition_status`, which must be `COMPLETE` for a composition-backed set;
- `composition_as_of`;
- `composition_manifest_hash`;
- composition schema/domain version and Composition Gate version.

The CR#12 parser and integrity validator must verify that the reference target OpportunityVersion equals the Requirement Set target, the `as_of` values match, the composition status is COMPLETE, every RequirementSourceReference traces to a selected material Surface, and all composition identifiers/hashes exactly match the trusted result. These fields must participate in the existing CR#12 manifest and Requirement Set content hash.

No source-composition `COMPLETE` assertion supplied solely as a caller parameter, unchecked string, or documentation claim is valid.

## 40. CR#10 Minimal Runtime Composition Gate

Section 22 is amended only for the following minimal CR#10 change. It is necessary to make the gate non-bypassable and is not permission to place composition business logic in CR#10.

CR#10 may add a `SourceCompositionGate` dependency that resolves a Composition Result by ID/hash from a trusted composition-result registry or verifier created by the deterministic composition resolver. The structured Eligibility evaluation input must not accept a caller-provided boolean, caller-provided `COMPLETE` flag, or caller-selected surface list as a bypass.

For every composition-backed StructuredRequirementSet, CR#10 may only:

1. resolve the referenced immutable Composition Result through the trusted dependency;
2. recompute or verify its Composition Hash and nested integrity;
3. verify target OpportunityVersion, `as_of`, manifest hash, status, and CR#12 reference equality;
4. return `NOT_ALLOWED` with a composition-gate reason when any verification fails.

CR#10 must not discover Surfaces, inspect attachments to create bindings, determine authority, choose a version, apply precedence, resolve a conflict, or re-run composition. The default for an unavailable trusted resolver or missing Composition Result is `NOT_ALLOWED`, never a fallback evaluation.

Legacy flat evaluation and historical assessments remain outside this new gate and remain readable under their frozen legacy contracts. They are not treated as composition-backed evaluation.

## 41. Legacy RequirementSet Contract

Every existing legacy RequirementSet remains `READABLE` and is explicitly classified `LEGACY_UNCOMPOSED` for this CR. It has no implicit Composition Result, no implicit Composition Hash, and no eligibility to be silently promoted to composition-backed COMPLETE.

Historical Legacy EligibilityAssessments remain immutable and linked only to their historical Requirement Set IDs/hashes. They neither gain a Composition reference nor authorize a new structured dispatch.

An explicit recompose operation must start from retained raw Source evidence, create a new DiscoveryBoundary, inventory, Composition Result, composition ID/hash, CR#12 composition-backed Requirement Set ID/hash, and—only after every gate passes—a new Assessment. Recompose never rewrites legacy IDs, Requirement Sets, SourceOccurrences, or Assessments.

## 42. False-Complete Protection Matrix

| Scenario | Composition | CR#12 | CR#10 |
| --- | --- | --- | --- |
| Required attachment not discovered | never COMPLETE; INCOMPLETE | never composition-backed COMPLETE | must not execute |
| Attachment discovered but unbound | never COMPLETE; REVIEW_REQUIRED | never composition-backed COMPLETE | must not execute |
| Authority unresolved | never COMPLETE; REVIEW_REQUIRED | never composition-backed COMPLETE | must not execute |
| `composition_as_of` absent | never COMPLETE; REVIEW_REQUIRED | never composition-backed COMPLETE | must not execute |
| Two versions cannot be selected | never COMPLETE; REVIEW_REQUIRED or CONFLICT | never composition-backed COMPLETE | must not execute |
| Required conflict unresolved | never COMPLETE; CONFLICT | never composition-backed COMPLETE | must not execute |
| Legacy RequirementSet | LEGACY_UNCOMPOSED | readable; never assumed composition COMPLETE | must not bypass Composition Gate for structured dispatch |
| All complete predicates hold | COMPLETE | may become composition-backed COMPLETE after `X` validates | may continue only after trusted gate passes |

No failure row may create a Candidate `NOT_MATCH` or a product-exclusion state.

## 43. Composition to CR#12 to CR#10 State Machine

```text
DISCOVERING
  → DISCOVERED
  → COMPOSING
  → INCOMPLETE | CONFLICT | REVIEW_REQUIRED | UNRESOLVED
      → retain Opportunity; CR#12 composition-backed construction blocked;
        CR#10 Composition Gate FAIL; no assessment
  → COMPLETE
      → CR#12 COMPOSITION-BACKED CONSTRUCTION
      → CR#12 semantic COMPLETE + exact CompositionReference
      → CR#10 trusted Composition Gate PASS
      → deterministic Eligibility evaluation
```

No arrow exists from any non-COMPLETE Composition state to Candidate `MATCH`, `NOT_MATCH`, or Eligibility execution.

## 44. Final Implementation Whitelist

No implementation is authorized by this draft. A future approval may modify only the following files, and only for the stated Composition contracts:

| File | Allowed change |
| --- | --- |
| `lib/ingestion/domain/primitives.ts` | Add branded IDs for boundaries, inventory, Surface, binding, authority, selection, precedence, conflict, and composition. |
| `lib/ingestion/domain/source-surface-composition.ts` | New Domain contracts, canonical hash inputs, validators, and non-destructive legacy classification. |
| `lib/ingestion/domain/requirements.ts` | Additive `SourceCompositionReference` fields to CR#12 manifest/structured contracts only. |
| `lib/ingestion/domain/index.ts` | Export the new Domain module only. |
| `lib/ingestion/requirements/types.ts` | Add Composition resolver/verifier types only. |
| `lib/ingestion/requirements/source-surface-composer.ts` | New deterministic, offline discovery-inventory, binding, authority, selection, precedence, conflict, result, and hash resolver. |
| `lib/ingestion/requirements/deterministic-requirement-parser.ts` | Accept only verified COMPLETE Composition Results and include the reference in CR#12 manifest/hash; do not change Requirement semantics. |
| `lib/ingestion/requirements/index.ts` | Export the new composer only. |
| `lib/ingestion/eligibility/types.ts` | Add the minimal trusted Composition Gate dependency and gate reasons for structured dispatch only. |
| `lib/ingestion/eligibility/deterministic-eligibility-engine.ts` | Verify the referenced Composition Result; reject failed/missing verification; no discovery or composition logic. |
| `tests/domain/domain-types.test.ts` | Add contract and hash validation controls. |
| `tests/requirements/source-surface-composition.test.ts` | New synthetic offline controls for this CR. |
| `tests/requirements/requirement-parser.test.ts` | Add parser composition-reference and hash-gate controls only. |
| `tests/requirements/p1-cr12-requirement-logic-modality-applicability.test.ts` | Add CR#12 composition-backed manifest regression controls only. |
| `tests/eligibility/p1-cr10-engine-integration-cr11-major-match-relation.test.ts` | Add CR#10 minimal Composition Gate regression controls only. |
| `tests/canonicalization/recruitment-context-position-identity.test.ts` | Add binding-version and non-destructive identity compatibility controls only. |
| `docs/p1-change-request-source-surface-composition.md` | Update implementation status and verification record only after approval and verification. |
| `docs/phase-1-requirements.md` | Add the approved source-composition contract summary only. |

The CR#10 rows are an explicit, tightly bounded exception to the earlier frozen prohibition. They permit verification only; they do not permit any composition business decision.

## 45. Final Forbidden Scope

The following files and scopes remain forbidden: `lib/ingestion/domain/source.ts`, `lib/ingestion/domain/raw.ts`, `lib/ingestion/domain/opportunity.ts`, `lib/ingestion/domain/recruitment-context.ts`, all collectors/adapters/transport/registry/lifecycle modules, all persistence and Supabase modules, Scheduler, API, Web, P2, Canary, real data, third-party integrations, nationwide source expansion, organization/entity resolution, Recommendation, Application workflow, LLM, embedding, fuzzy matching, and any destructive migration.

CR#11 major semantics, CR#12 logic/modality/applicability semantics, and CR#10 Candidate-result semantics remain frozen. No implementation may infer Requirement content from title, duties, organization, CandidateProfile, historical hiring outcomes, or third-party rewrites.

## 46. Final Test and Verification Contract

Future implementation must provide synthetic offline controls for all 22 Section 19 failure cases, all 12 Section 38 invariants, the Section 42 matrix, Composition Hash mutation for every nested contract/version, trusted-gate bypass rejection, CR#12 reference mismatch, CR#10 resolver absence, legacy recompose isolation, provisional identity retention, and third-party reference-only behavior.

It must then run CR#9, CR#10, CR#11, CR#12, Recruitment Context & Position Identity, P1, tracked P2, TypeScript, Architecture Boundary, Application Boundary, Network Guard, and `git diff --check`. No test fixture may use network, real data, P2 mutation, Canary mutation, production persistence, or a real EligibilityAssessment.

## 47. Final Readiness Verdict

The 12 design BLOCKERs are closed by Sections 28–46. The only CR#10 change permitted by this design is the verification-only runtime gate in Section 40.

```text
DESIGN READINESS = IMPLEMENTED / VERIFIED
CR STATUS = IMPLEMENTED / VERIFIED
```

## 48. Implementation Verification Record

The implementation adds deterministic, self-excluding canonical hashes for DiscoveryBoundary, SourcePackageInventory, ExpectedSurfaceManifestEntry, SourceSurfaceBinding (including attachment specializations), AuthorityAssertion, SourceVersionSelection, SurfaceRevisionRelation, SourcePrecedenceDecision, and SourceConflict. The Composer persists those hashes, and trusted Composition verification recomputes and compares each before accepting the Composition Result.

Synthetic composition controls, CR#9–CR#12 and Recruitment Context regressions, P1, tracked P2, TypeScript, Architecture Boundary, Application Boundary, Network Guard, and `git diff --check` passed with zero network requests. This record does not authorize collection, real data composition, Eligibility execution, or any follow-on phase.
