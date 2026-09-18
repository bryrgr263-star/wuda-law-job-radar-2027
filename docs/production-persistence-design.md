# Production Persistence Design

Status: `DESIGN FROZEN / PHASE 3 FOUNDATION IMPLEMENTED / NOT DEPLOYED`

Implemented in Phase 1: migrations 001-003, Source Registry/Admission persistence
contracts, Raw object boundary, Snapshot/ExtractedRecord persistence contracts,
and offline security/architecture tests. Implemented in Phase 2: migrations
004-005, immutable Artifact Ledger and upstream references, one atomic
`appendExecution` RPC, fenced Journal Head, normalized artifact seals, checkpoint
persistence/verification contracts, and PostgreSQL-backed Process B journal
loading. Implemented in Phase 3: evidence-native Candidate Evidence issuance in
the existing owner, private evidence-object verification, journal replay for the
downstream chain, and a production PostgreSQL Presentation reader used by
`/api/presentation/v1`. Real KMS signing and real Supabase execution remain
explicitly unimplemented.

Target: Supabase PostgreSQL plus private Supabase Object Storage.

This design persists and restores the existing Trusted Chain. It does not create
another Source Registry, Recall, Relevance, Requirement, PredicateResolution,
Eligibility, PresentationDecision, PresentationReadModel, or API truth source.
The existing Shadow, Preview, P2-06, legacy `public.jobs`, `public.sources`, and
`public.sync_runs` paths are explicitly excluded.

## 1. Authoritative direction

```text
approved Source Registry / Source Admission revisions
  -> controlled acquisition
  -> private immutable RawBlob object + PostgreSQL manifest
  -> Snapshot / ExtractedRecord
  -> bootstrapTrustedChainCompositionRoot()
  -> existing authoritative processors
  -> one atomic PostgreSQL execution commit
       - restoration journal record
       - expected artifact seals
       - canonical artifact envelopes
       - PresentationReadModel query projection when present
  -> signed journal checkpoint

restart:
Production PostgreSQL journal
  -> verify signed checkpoint and hash-chain tail
  -> replay commands through fresh existing processors
  -> compare result hashes and artifact seals
  -> rebuild fresh in-memory authoritative registries
```

Persisted rows do not become trusted merely because they exist. Only successful
replay through the existing branded owners can repopulate authoritative runtime
state. The artifact ledger is an immutable audit and collision boundary; it is
not a direct registry hydration path.

## 2. Contract implementation status

These are supporting-boundary changes, not business-rule changes:

1. Implemented: the existing Source Registry is root-owned, canonical, and
   version-aware. Existing one-time registration remains revision 1; source
   updates append revisions without introducing another registry.
2. Implemented: the restoration repository uses atomic
   `appendExecution({ record, artifact_envelopes, read_model_projection })`.
   PostgreSQL commits the journal row, seals, artifacts, optional read projection,
   and Journal Head advance in one transaction.
3. Implemented: one evidence-native issuance command in the existing Candidate Evidence
   owner. Do not expose `CandidateProfile -> trusted evidence` as a production
   restoration or issuance path.
4. Implemented: the API depends on a read-only Presentation repository interface.
   The API contract and decisions remain unchanged; the production runtime will
   replace only the current Shadow SQLite adapter.

## 3. PostgreSQL namespace and roles

Use the non-exposed schema `trusted_chain`. Do not add its tables to Supabase's
exposed API schemas.

Roles:

| Role | Capability |
| --- | --- |
| `trusted_chain_owner` | NOLOGIN owner of schema, tables, triggers, and functions |
| `trusted_chain_migrator` | deployment-only DDL role |
| `trusted_chain_writer` | execute approved append/bootstrap RPCs; no direct table mutation |
| `trusted_chain_reader` | read only the PresentationReadModel projection/view |
| `trusted_chain_auditor` | read journal, artifacts, source metadata, and checkpoints |
| `anon`, `authenticated` | no schema usage or table privileges |

`service_role` and a Supabase secret key bypass RLS and therefore cannot be the
database authorization boundary. Production code should use dedicated server-
side database credentials for the writer and reader roles. Any Storage secret or
custom JWT stays server-side and is never exposed through `NEXT_PUBLIC_*`.

Every table enables and forces RLS as defense in depth. Grants remain the primary
barrier. Direct `UPDATE`, `DELETE`, and `TRUNCATE` are revoked from runtime roles.
Only narrowly scoped `SECURITY DEFINER` functions owned by the NOLOGIN owner may
advance mutable coordination rows such as the journal head.

## 4. Source Registry and admission schema

Source identity and access approval remain separate facts. Source Registry owns
Organizations, SourceDefinitions, Endpoints, and Adapter registrations. Existing
Source Admission owns whether one exact endpoint may be accessed.

### Tables

```sql
trusted_chain.source_organization_versions
  artifact_id text primary key
  organization_id text not null
  revision integer not null check (revision > 0)
  supersedes_artifact_id text null
  canonical_bytes text not null
  content_hash char(64) not null
  integrity_hash char(64) not null
  provenance jsonb not null
  effective_at timestamptz not null
  created_at timestamptz not null
  unique (organization_id, revision)

trusted_chain.source_definition_versions
  artifact_id text primary key
  source_definition_id text not null
  publisher_organization_id text not null
  revision integer not null check (revision > 0)
  active boolean not null
  authority_level text not null
  canonical_bytes text not null
  content_hash char(64) not null
  integrity_hash char(64) not null
  provenance jsonb not null
  effective_at timestamptz not null
  created_at timestamptz not null
  unique (source_definition_id, revision)

trusted_chain.recruitment_endpoint_versions
  artifact_id text primary key
  recruitment_endpoint_id text not null
  source_definition_id text not null
  revision integer not null check (revision > 0)
  active boolean not null
  canonical_locator text not null
  canonical_bytes text not null
  content_hash char(64) not null
  integrity_hash char(64) not null
  provenance jsonb not null
  effective_at timestamptz not null
  created_at timestamptz not null
  unique (recruitment_endpoint_id, revision)

trusted_chain.adapter_registration_versions
  artifact_id text primary key
  adapter_key text not null
  revision integer not null check (revision > 0)
  active boolean not null
  canonical_bytes text not null
  content_hash char(64) not null
  integrity_hash char(64) not null
  provenance jsonb not null
  created_at timestamptz not null
  unique (adapter_key, revision)

trusted_chain.source_admission_versions
  artifact_id text primary key
  source_admission_id text not null
  recruitment_endpoint_id text not null
  revision integer not null check (revision > 0)
  admission_decision text not null check
    (admission_decision in ('APPROVED', 'REVIEW', 'REJECTED'))
  canonical_bytes text not null
  content_hash char(64) not null
  integrity_hash char(64) not null
  provenance jsonb not null
  effective_at timestamptz not null
  created_at timestamptz not null
  unique (source_admission_id, revision)

trusted_chain.official_endpoint_allowlist_versions
  artifact_id text primary key
  allowlist_entry_id text not null
  recruitment_endpoint_artifact_id text not null
  source_admission_artifact_id text not null
  revision integer not null check (revision > 0)
  active boolean not null
  scheme text not null check (scheme = 'https')
  host text not null check (host = lower(host))
  port integer null
  path_prefix text not null check (left(path_prefix, 1) = '/')
  exact_path boolean not null
  allowed_method text not null check (allowed_method = 'GET')
  query_policy jsonb not null
  endpoint_purpose text not null
  authority_level text not null
  approval_evidence_ids jsonb not null
  canonical_bytes text not null
  content_hash char(64) not null
  integrity_hash char(64) not null
  provenance jsonb not null
  effective_at timestamptz not null
  created_at timestamptz not null
  unique (allowlist_entry_id, revision)
```

The allowlist is an execution policy artifact bound to an existing Endpoint and
approved Source Admission revision. It is not a second Source Registry. Current
state is selected by highest validated revision; old revisions remain immutable.
No wildcard hostname, inherited attachment path, redirect expansion, or query
parameter is permitted unless explicitly present in the approved revision.

## 5. RawBlob and acquisition persistence

### Private buckets

- `trusted-raw-production`: official pages, feeds, and recruitment attachments.
- `trusted-candidate-evidence-production`: candidate documents, isolated from
  recruitment Raw and from the Presentation API.

Both buckets are private. There are no `anon` or general `authenticated`
policies. The acquisition role receives only object `INSERT` and integrity-read
capability for `trusted-raw-production`; it receives no update, overwrite, move,
or delete capability. Candidate evidence uses a separate issuer/verifier role.

Content-addressed Raw key:

```text
sha256/<first-2>/<next-2>/<64-lowercase-hex>
```

Uploads use `upsert=false`. ETags are not accepted as SHA-256 proof. The worker
hashes the bytes before upload and verifies downloaded bytes when reconciling an
existing key.

### Tables

```sql
trusted_chain.acquisition_runs
  acquisition_run_id text primary key
  source_admission_artifact_id text not null
  endpoint_artifact_id text not null
  allowlist_artifact_id text not null
  status text not null check
    (status in ('SUCCESS','NOT_MODIFIED','PARTIAL','FAILED','SUSPICIOUS_EMPTY'))
  started_at timestamptz not null
  completed_at timestamptz null
  request_metadata jsonb not null
  result_metadata jsonb not null
  provenance jsonb not null

trusted_chain.raw_blobs
  raw_blob_id text primary key
  raw_content_sha256 char(64) not null unique
  byte_length bigint not null check (byte_length >= 0)
  content_type text not null
  bucket_id text not null check (bucket_id = 'trusted-raw-production')
  object_key text not null unique
  source_definition_id text not null
  recruitment_endpoint_id text not null
  first_acquired_at timestamptz not null
  provenance jsonb not null
  manifest_integrity_hash char(64) not null

trusted_chain.raw_blob_acquisitions
  raw_blob_id text not null
  acquisition_run_id text not null
  acquired_at timestamptz not null
  primary key (raw_blob_id, acquisition_run_id)

trusted_chain.snapshots
  snapshot_id text primary key
  acquisition_run_id text not null
  recruitment_endpoint_id text not null
  transport_status text not null check (transport_status in ('SUCCESS','FAILED'))
  raw_blob_id text null
  content_hash char(64) null
  content_length bigint null
  request_metadata jsonb not null
  response_metadata jsonb not null
  canonical_bytes text not null
  integrity_hash char(64) not null
  observed_at timestamptz not null

trusted_chain.extracted_records
  extracted_record_id text primary key
  snapshot_id text not null
  source_definition_id text not null
  schema_version text not null
  semantic_hash char(64) not null
  canonical_bytes text not null
  integrity_hash char(64) not null
  provenance jsonb not null
  extracted_at timestamptz not null
```

Storage and PostgreSQL cannot share one transaction. The safe order is:

1. acquire bytes only after Source Admission and exact allowlist validation;
2. calculate SHA-256 and upload the immutable content-addressed object;
3. atomically append Raw manifest, acquisition link, and Snapshot in PostgreSQL;
4. never publish downstream commands until step 3 commits;
5. audit unreferenced objects after a quarantine period; never delete a referenced
   object as part of normal ingestion.

A database manifest without a readable object is `EVIDENCE_BLOCKED`. An orphaned
object without a manifest is not trusted input.

## 6. Trusted artifact ledger

Use one persistence ledger, partitionable by `artifact_type`, rather than one new
runtime registry per artifact. Allowed types are closed:

```text
SOURCE_OCCURRENCE_VERSION
OPPORTUNITY_CANDIDATE
RECALL_DISPOSITION
POSITION_VERSION
PBOV
SOURCE_COMPOSITION
LEGAL_EMPLOYMENT_RELEVANCE_ASSESSMENT
REQUIREMENT_PROJECTION
REQUIREMENT_SET_VERSION
CANDIDATE_EVIDENCE
PREDICATE_RESOLUTION
TRUSTED_ELIGIBILITY
PRESENTATION_DECISION
PRESENTATION_READ_MODEL
```

```sql
trusted_chain.artifacts
  artifact_type text not null
  artifact_id text not null
  stream_id text not null
  revision integer null check (revision is null or revision > 0)
  supersedes_artifact_id text null
  schema_version text not null
  canonical_bytes text not null
  content_hash char(64) not null
  domain_integrity_hash text not null
  provenance jsonb not null
  created_at timestamptz not null
  primary key (artifact_type, artifact_id)

unique index artifacts_stream_revision_uq
  on trusted_chain.artifacts (artifact_type, stream_id, revision)
  where revision is not null

trusted_chain.artifact_upstream_references
  artifact_type text not null
  artifact_id text not null
  ordinal integer not null check (ordinal >= 0)
  relation text not null
  upstream_type text not null
  upstream_id text not null
  expected_hash text not null
  primary key (artifact_type, artifact_id, ordinal)
```

`content_hash` is SHA-256 over exact canonical bytes. The existing domain
integrity function remains authoritative for `domain_integrity_hash`; PostgreSQL
does not reimplement business hashing. Same type/ID plus identical canonical
bytes is idempotent. Same type/ID plus different bytes, revision collision,
supersedes mismatch, or missing expected upstream seal aborts the transaction.

## 7. Command journal and atomic execution commit

```sql
trusted_chain.journal_heads
  stream_id text primary key
  scope text not null check (scope in ('PRODUCTION','SYNTHETIC_TEST'))
  current_sequence bigint not null check (current_sequence >= 0)
  current_hash text null
  writer_epoch bigint not null check (writer_epoch > 0)
  state text not null check (state in ('ACTIVE','HALTED','RECOVERY_REQUIRED'))
  updated_at timestamptz not null

trusted_chain.command_journal
  stream_id text not null
  sequence bigint not null check (sequence > 0)
  restoration_record_id text not null unique
  previous_record_hash text null
  command_kind text not null
  command_canonical_bytes text not null
  command_hash char(64) not null
  result_hash char(64) not null
  expected_artifacts jsonb not null
  scope text not null check (scope in ('PRODUCTION','SYNTHETIC_TEST'))
  actor text not null
  recorded_at timestamptz not null
  schema_version text not null
  integrity_hash char(64) not null unique
  writer_epoch bigint not null
  primary key (stream_id, sequence)

trusted_chain.journal_artifact_seals
  stream_id text not null
  sequence bigint not null
  ordinal integer not null check (ordinal >= 0)
  artifact_type text not null
  artifact_id text not null
  expected_hash text not null
  primary key (stream_id, sequence, ordinal)

trusted_chain.journal_checkpoints
  checkpoint_id text primary key
  stream_id text not null
  sequence bigint not null
  head_hash char(64) not null
  artifact_set_hash char(64) not null
  previous_checkpoint_hash char(64) null
  signer_key_id text not null
  signature text not null
  checkpoint_hash char(64) not null unique
  created_at timestamptz not null
  unique (stream_id, sequence)
```

`trusted_chain.append_execution(...)` is the only writer RPC. It must:

1. acquire a transaction-scoped advisory lock and `FOR UPDATE` the stream head;
2. require the current writer epoch, next sequence, and explicit NULL-safe
   previous-hash continuity, with NULL allowed only at genesis;
3. validate schema, scope, record ID, canonical command hash, record integrity,
   a unique order-independent bidirectionally equal artifact seal/envelope set,
   and all upstream hashes;
4. insert canonical artifact envelopes with collision checks;
5. insert the immutable PresentationReadModel projection when present;
6. insert the journal and normalized seals;
7. advance `journal_heads` in the same transaction;
8. retain `writer_epoch` as persisted fencing metadata while excluding it from
   the normalized logical execution identity;
9. return `IDEMPOTENT_REUSE` for the same normalized execution under the current
   writer epoch, including a safe retry after an epoch change;
10. reject same identity/different semantic bytes, stale epochs, gaps, forks,
    duplicate artifacts, missing artifacts, and extra artifacts. Artifact array
    ordering alone is not identity.

Runtime roles cannot directly update `journal_heads`. A bootstrap/acquire-writer
RPC increments `writer_epoch`; any stale process is fenced out. A failed journal
commit halts the composition root before it exposes a command result.

### Journal-head protection

The database head alone does not protect against a privileged database rewrite.
Production therefore requires:

- a signed genesis checkpoint before accepting production commands;
- periodic signed checkpoints over stream ID, sequence, head hash, artifact-set
  hash, and previous checkpoint hash;
- an Ed25519 signing key held outside PostgreSQL in a deployment secret manager
  or KMS; PostgreSQL stores signatures and key IDs, never the private key;
- an off-site copy of checkpoints or checkpoint hashes;
- Process B verification of the latest trusted signature followed by every
  journal record and artifact seal after that checkpoint.

Without a valid checkpoint, Process B enters `RECOVERY_REQUIRED`; it must not
hydrate registries or convert missing evidence into negative business results.

## 8. PresentationReadModel projection

```sql
trusted_chain.presentation_read_models
  presentation_read_model_id text primary key
  presentation_decision_id text not null
  opportunity_candidate_id text not null
  decision_revision integer not null check (decision_revision > 0)
  presentation_status text not null check
    (presentation_status in
      ('DISPLAY','DISPLAY_WITH_REVIEW','EVIDENCE_BLOCKED','NOT_DISPLAY'))
  reason_codes jsonb not null
  policy_id text not null
  policy_version text not null
  employer jsonb not null
  position_title jsonb not null
  locations jsonb not null
  recruitment_year jsonb not null
  recruitment_batch jsonb not null
  announcement_link jsonb not null
  application_link jsonb not null
  requirement_summary jsonb not null
  upstream jsonb not null
  updated_at timestamptz not null
  effective_at jsonb not null
  canonical_bytes text not null
  integrity_hash char(64) not null
  unique (opportunity_candidate_id, decision_revision)
```

The current model view selects the highest `decision_revision` per candidate.
The API reader can select only this projection/view. It has no access to journal,
Raw, Candidate Evidence, Eligibility, or internal artifacts. The existing API
continues to apply the sealed status contract; `NOT_DISPLAY` is absent from its
normal list and detail results. No API query recalculates business state.

## 9. Candidate Evidence issuance

The existing Candidate Evidence owner must gain one evidence-native command,
not another tracker:

```text
IssueCandidateEvidenceCommand
  command_id
  candidate_profile_id
  evidence_stream_id
  revision
  supersedes_issuance_id | null
  provenance: CANDIDATE_ASSERTED | DOCUMENT_VERIFIED
  scope: PRODUCTION
  assertions[]
  evidence_source_references[]
  actor { actor_id, role }
  issued_at
  effective_from / effective_to
  command_integrity_hash
```

Rules:

- `CANDIDATE_ASSERTED`: records an explicit candidate assertion and remains
  insufficient wherever the existing Eligibility contract requires verification.
- `DOCUMENT_VERIFIED`: requires an immutable private evidence object, SHA-256,
  evidence locator, verifier identity/role, verification method, verification
  time, and issuance integrity hash.
- `SYNTHETIC_TEST`: accepted only by test-scoped roots and test repositories. The
  production append RPC rejects this scope.
- A CandidateProfile may identify the subject but cannot automatically create,
  upgrade, or mark Evidence as `DOCUMENT_VERIFIED`.
- New facts or corrections append a new issuance/evidence artifact and explicit
  supersedes relation. Historical evidence remains queryable for audit.
- Candidate documents never enter the recruitment Raw bucket or Presentation API.

```sql
trusted_chain.candidate_evidence_sources
  evidence_source_id text primary key
  candidate_profile_id text not null
  evidence_class text not null check
    (evidence_class in ('CANDIDATE_ASSERTED','DOCUMENT_VERIFIED'))
  bucket_id text null
  object_key text null
  object_sha256 char(64) null
  issuer text not null
  captured_at timestamptz not null
  provenance jsonb not null
  integrity_hash char(64) not null

trusted_chain.candidate_evidence_issuances
  issuance_id text primary key
  command_id text not null unique
  candidate_profile_id text not null
  evidence_stream_id text not null
  revision integer not null check (revision > 0)
  supersedes_issuance_id text null
  provenance text not null check
    (provenance in ('CANDIDATE_ASSERTED','DOCUMENT_VERIFIED'))
  actor_id text not null
  actor_role text not null
  evidence_source_ids jsonb not null
  issued_at timestamptz not null
  canonical_bytes text not null
  integrity_hash char(64) not null
  unique (evidence_stream_id, revision)
```

## 10. Migration sequence

Forward migrations 001-006 are implemented as an offline SQL contract. Migrations
007-008 remain design-only and no migration has been executed against a real
Supabase project in this phase.

1. `001_trusted_chain_roles_and_schema`: extensions, private schema, roles,
   default privileges, immutable trigger functions.
2. `002_source_registry_and_admission`: version tables, allowlist, current views,
   source bootstrap commands.
3. `003_raw_manifest`: acquisition runs, Raw manifests, Snapshots, ExtractedRecords.
4. `004_artifact_ledger`: artifact envelopes and upstream references.
5. `005_restoration_journal`: heads, journal, seals, checkpoints, writer fencing,
   atomic append RPC.
6. `006_candidate_evidence_presentation_reader`: private evidence-object policy
   plus production Presentation projection reader grants.
7. `007_candidate_evidence_operations`: optional operational issuance/audit
   extensions after production review.
8. `008_rls_and_storage_policies`: final privilege verification and any approved
   policies.

Production migrations are forward-only after the first production write. A down
migration may be used only in an empty pre-production environment. Migration CI
must run schema tests, privilege tests, append/collision tests, restart replay,
and a scan proving no legacy table dependency.

## 11. Environment and deployment contract

Server-only configuration:

```text
TRUSTED_CHAIN_DATABASE_WRITER_URL
TRUSTED_CHAIN_DATABASE_READER_URL
TRUSTED_CHAIN_DATABASE_AUDITOR_URL
SUPABASE_PROJECT_URL
SUPABASE_STORAGE_WRITER_TOKEN
TRUSTED_RAW_BUCKET=trusted-raw-production
TRUSTED_CANDIDATE_EVIDENCE_BUCKET=trusted-candidate-evidence-production
TRUSTED_JOURNAL_STREAM_ID
TRUSTED_JOURNAL_CHECKPOINT_PUBLIC_KEY
TRUSTED_JOURNAL_SIGNING_KEY_REF
TRUSTED_DEPLOYMENT_ID
```

No value above is `NEXT_PUBLIC_*`. Deployment order:

1. provision a separate staging Supabase project;
2. apply migrations with the migrator role;
3. create private buckets through supported Storage APIs;
4. install and test Storage RLS policies without exposing objects;
5. create signed genesis checkpoint;
6. run synthetic restart tests only in staging/test scope;
7. run one approved real-source `EVIDENCE_BLOCKED` flow without fabricating facts;
8. verify Process B on a separate process/instance;
9. audit grants, RLS, object access, legacy dependencies, and journal continuity;
10. approve production deployment separately.

## 12. Backup and recovery

- Enable Supabase daily backups and PITR appropriate to the required RPO/RTO.
- Take scheduled logical schema/config exports for independent recovery testing.
- Database backups do not restore deleted Storage object bytes; replicate both
  private buckets independently and retain content-hash manifests.
- Store signed journal checkpoints outside the primary database.
- After database restore, reset custom-role credentials, restore object bytes,
  verify every Raw/evidence manifest SHA-256, verify the signed checkpoint and
  journal tail, then run Process B replay.
- Do not serve the API until PresentationReadModel seals match replayed Decisions.
- Perform regular restore drills in an isolated project; never test recovery by
  mutating the production journal.

## 13. Current blockers

- `REAL_2027_SOURCE_REQUIRED`: no approved 2027 official URL/host/path,
  announcement, recruitment year, or attachment locator exists.
- Formal PostgreSQL schema and Storage buckets are not deployed or verified on a
  real Supabase project.
- Real production checkpoint signing/KMS and an approved trust anchor are not
  deployed; test signatures are never production trust anchors.
- Production Candidate Evidence object issuance requires approved operators,
  evidence sources, and deployed private Storage; no real user evidence was issued.
- Shadow SQLite remains historical test/diagnostic infrastructure and is not the
  production API runtime.

Production readiness remains blocked until these items are implemented,
deployed in staging, restored successfully, and validated against an approved real
2027 source.
