begin;

create table trusted_chain.artifacts (
  artifact_type text not null check (artifact_type in (
    'SOURCE_OCCURRENCE_VERSION', 'OPPORTUNITY_CANDIDATE', 'RECALL_DISPOSITION',
    'POSITION_VERSION', 'PBOV', 'SOURCE_COMPOSITION',
    'LEGAL_EMPLOYMENT_RELEVANCE_ASSESSMENT', 'REQUIREMENT_PROJECTION',
    'REQUIREMENT_SET_VERSION', 'CANDIDATE_EVIDENCE_SOURCE_MANIFEST',
    'CANDIDATE_EVIDENCE', 'PREDICATE_RESOLUTION',
    'TRUSTED_ELIGIBILITY', 'PRESENTATION_DECISION', 'PRESENTATION_READ_MODEL'
  )),
  artifact_kind text not null,
  artifact_id text not null,
  stream_id text not null,
  revision integer null check (revision is null or revision > 0),
  supersedes_artifact_id text null,
  schema_version text not null,
  canonical_bytes text not null,
  artifact_hash char(64) not null,
  seal text not null,
  scope text not null check (scope in ('PRODUCTION', 'SYNTHETIC_TEST')),
  provenance jsonb not null,
  created_at timestamptz not null,
  producer jsonb not null,
  integrity_bytes text not null,
  integrity_hash char(64) not null,
  journal_stream_id text not null,
  first_sequence bigint not null check (first_sequence > 0),
  record_json jsonb not null,
  primary key (artifact_type, artifact_id),
  unique (artifact_kind, artifact_id),
  foreign key (artifact_type, supersedes_artifact_id)
    references trusted_chain.artifacts (artifact_type, artifact_id)
);

create unique index artifacts_stream_revision_uq
on trusted_chain.artifacts (artifact_type, stream_id, revision)
where revision is not null;

create index artifacts_journal_sequence_idx
on trusted_chain.artifacts (journal_stream_id, first_sequence);

create table trusted_chain.artifact_upstream_references (
  artifact_type text not null,
  artifact_id text not null,
  ordinal integer not null check (ordinal >= 0),
  relation text not null check (relation = 'ARTIFACT_REFERENCE'),
  upstream_artifact_kind text not null,
  upstream_artifact_type text not null,
  upstream_artifact_id text not null,
  expected_seal text not null,
  scope text not null check (scope in ('PRODUCTION', 'SYNTHETIC_TEST')),
  primary key (artifact_type, artifact_id, ordinal),
  foreign key (artifact_type, artifact_id)
    references trusted_chain.artifacts (artifact_type, artifact_id),
  foreign key (upstream_artifact_type, upstream_artifact_id)
    references trusted_chain.artifacts (artifact_type, artifact_id)
);

do $security$
declare table_name text;
begin
  foreach table_name in array array['artifacts', 'artifact_upstream_references'] loop
    execute format('alter table trusted_chain.%I owner to trusted_chain_owner', table_name);
    execute format('alter table trusted_chain.%I enable row level security', table_name);
    execute format('alter table trusted_chain.%I force row level security', table_name);
    execute format(
      'create policy %I on trusted_chain.%I for all to trusted_chain_owner using (true) with check (true)',
      table_name || '_owner_all', table_name
    );
    execute format(
      'create policy %I on trusted_chain.%I for select to trusted_chain_recovery, trusted_chain_auditor using (true)',
      table_name || '_recovery_audit_read', table_name
    );
    execute format(
      'create trigger %I before update or delete on trusted_chain.%I for each row execute function trusted_chain.reject_immutable_mutation()',
      table_name || '_immutable_row', table_name
    );
    execute format(
      'create trigger %I before truncate on trusted_chain.%I for each statement execute function trusted_chain.reject_immutable_truncate()',
      table_name || '_immutable_truncate', table_name
    );
    execute format(
      'revoke all on trusted_chain.%I from public, anon, authenticated, service_role, trusted_chain_writer, trusted_chain_reader',
      table_name
    );
    execute format('grant select on trusted_chain.%I to trusted_chain_recovery, trusted_chain_auditor', table_name);
  end loop;
end
$security$;

commit;
