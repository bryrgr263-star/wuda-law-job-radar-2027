# P1 Change Request — Recruitment Context Position Materialization

## Status

`IMPLEMENTATION APPROVED — PHASE A–B ONLY`

`P2-LEGAL-08B = DRAFT / DESIGN ONLY / NOT IMPLEMENTED / NOT APPROVED`

## 1. Scope

This Change Request authorizes the staged implementation of:

```text
context-bearing ExtractedRecord V2
  -> shared SourceOccurrence / SourceOccurrenceVersion materialization
  -> Position identity resolution
  -> Position / PositionVersion materialization and persistence
  -> Position-bound OpportunityVersion
```

Phase A Domain contracts and Phase B shared SourceOccurrenceVersion materialization are implemented
in the current gate. Phase C and later phases are not implemented or approved.

## 2. Recruitment Context Boundary

Recruitment Context remains a typed projection inside SourceOccurrenceVersion content. It is not a
standalone business entity.

This Change Request does not create a Recruitment Context ID, repository, persistence table,
lifecycle, or independent canonical identity.

## 3. Position Identity Basis

The closed Position identity-basis set is:

```text
OFFICIAL_POSITION_CODE
SOURCE_LOCAL_RECORD
EXPLICIT_RECONCILIATION
```

`PROVISIONAL` is an identity status, not an identity basis. A Position established only from a
reliable exact source-local identity uses:

```text
identity_basis.kind = SOURCE_LOCAL_RECORD
identity_state = PROVISIONAL
```

No fourth basis is permitted.

## 4. Canonical Position Identity

Position identity is deterministic:

```text
position_identity_hash = SHA-256(canonical PositionIdentityBasis)
position_id = position:<position_identity_hash>
```

Canonicalization is independent of object-field order. Reconciliation Position and Evidence IDs
are stably sorted before hashing.

The following fields are forbidden from PositionIdentityBasis:

- title;
- URL or DETAIL_URL;
- filename;
- attachment index;
- organization display name;
- manual order;
- Requirement text.

An official code is identity-bearing only with a non-empty proven namespace. If that namespace is
not established, the system may use a reliable exact `SOURCE_LOCAL_RECORD` basis and retain the
Position as `PROVISIONAL`. It must not guess the namespace.

## 5. Provisional and Reconciliation Safety

A PROVISIONAL Position is not updated or silently upgraded when later official-code evidence is
observed. Existing Position identity remains immutable. A relationship to a later identity requires
the existing formal correction or confirmed reconciliation contract and traceable Evidence.

Without a reliable exact source-local identity, no Position is materialized.

## 6. PositionVersion Contract

PositionVersion has a positive revision, deterministic ID, and deterministic semantic hash:

```text
position_version_id = position-version:<position_identity_hash>:<revision>
semantic_hash = SHA-256(canonical PositionVersion semantic payload)
```

The semantic payload includes Position ID, normalized title, Batch reference, Organization role
assignments, Location assignments, Headcount and Recruitment Population references, and
Requirement-surface reference keys. Unordered collections are stably sorted.

The semantic hash excludes its own hash, PositionVersion ID, revision, timestamps, Evidence order,
SourceOccurrenceVersion order, and serialization field order.

Every PositionVersion must reference its Position, at least one SourceOccurrenceVersion, and
traceable identity Evidence.

## 7. Position-Bound OpportunityVersion

Legacy OpportunityVersion remains readable with an optional PositionVersion reference. The new
contract `PositionBoundOpportunityVersion` requires `position_version_id`.

Validation rejects:

- a missing PositionVersion reference;
- a reference to a different PositionVersion;
- a PositionVersion belonging to a different Position;
- a PositionVersion and OpportunityVersion with no shared SourceOccurrenceVersion.

Validation never inserts a missing reference and never upgrades a legacy OpportunityVersion.

## 8. Recall-First Failure Semantics

Identity uncertainty, invalid Evidence, unconfirmed reconciliation, a missing PositionVersion, or
legacy-only input cannot produce `NOT_MATCH`. Such input remains unresolved, review-required,
blocked, or not allowed according to the existing upstream and runtime gates.

## 9. Non-Scope

Phase A does not implement or modify:

- Source Composition or SourceCompositionResult;
- RequirementSet or PredicateResolution;
- CR#10, CR#11, or CR#12;
- Candidate Evidence or EligibilityAssessment;
- P2 legal blockers;
- attachments 2–4;
- Collector, Scheduler, Web/API, Supabase, or Preview;
- production persistence or migrations;
- historical backfill;
- fuzzy, embedding, LLM, or legal common-sense inference.

## 10. Phase B Shared SourceOccurrenceVersion Materialization

Phase B adds an additive immutable `ExtractedRecordV2` contract. Its deterministic identity binds
the source definition, exact Snapshot identity and content hash, canonical extracted semantics, and
the extractor/schema contract. Retrieval timestamps and adapter runtime metadata are excluded from
semantic identity. Existing ExtractedRecord objects are neither rewritten nor upgraded.

The in-memory tracker and production repository delegate SourceOccurrence and
SourceOccurrenceVersion construction to one shared materializer. Legacy ExtractedRecord behavior
retains its existing content-hash policy. V2 SOV semantics additionally bind the SourceOccurrence
identity and extractor/schema contract while excluding retrieval time, Evidence ordering,
duplicate Evidence, and repository insertion order.

The V2 validator independently recomputes ExtractedRecord and SOV hashes and verifies the exact
ExtractedRecord, Snapshot, source, endpoint, normalized content, RecruitmentContext, and Identity
Evidence bindings. Missing or mismatched objects, hashes, provenance, or context Evidence are
rejected and never produce an Eligibility result.

The `22828700101` path is test-scoped and stops at a verified SOV. It creates no Position,
PositionVersion, Opportunity, SourceCompositionResult, RequirementSet, PredicateResolution,
Candidate Evidence, or EligibilityAssessment. No schema migration, persistence backfill, legacy
upgrade, attachment 2–4 work, or network request is included.

## 11. Gate

No Phase C work is authorized until Phase B focused tests, relevant Domain/canonicalization and
production regressions, TypeScript, architecture and network boundaries, diff validation, and exact
whitelist audit pass.
