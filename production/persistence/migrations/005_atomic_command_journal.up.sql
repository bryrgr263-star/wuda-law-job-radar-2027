begin;

create table trusted_chain.journal_heads (
  stream_id text primary key,
  scope text not null check (scope in ('PRODUCTION', 'SYNTHETIC_TEST')),
  current_sequence bigint not null check (current_sequence >= 0),
  current_hash text null,
  writer_epoch bigint not null check (writer_epoch > 0),
  state text not null check (state in ('ACTIVE', 'HALTED', 'RECOVERY_REQUIRED')),
  updated_at timestamptz not null
);

create table trusted_chain.command_journal (
  stream_id text not null references trusted_chain.journal_heads (stream_id),
  sequence bigint not null check (sequence > 0),
  restoration_record_id text not null unique,
  previous_record_hash text null,
  command_kind text not null,
  command_canonical_bytes text not null,
  command_hash char(64) not null,
  result_hash char(64) not null,
  expected_artifacts jsonb not null,
  scope text not null check (scope in ('PRODUCTION', 'SYNTHETIC_TEST')),
  actor text not null,
  recorded_at timestamptz not null,
  schema_version text not null,
  record_integrity_bytes text not null,
  integrity_hash char(64) not null unique,
  writer_epoch bigint not null,
  record_json jsonb not null,
  execution_json jsonb not null,
  primary key (stream_id, sequence)
);

create table trusted_chain.journal_artifact_seals (
  stream_id text not null,
  sequence bigint not null,
  ordinal integer not null check (ordinal >= 0),
  artifact_kind text not null,
  artifact_id text not null,
  expected_seal text not null,
  primary key (stream_id, sequence, ordinal),
  foreign key (stream_id, sequence)
    references trusted_chain.command_journal (stream_id, sequence)
);

create table trusted_chain.journal_checkpoints (
  checkpoint_id text primary key,
  stream_id text not null references trusted_chain.journal_heads (stream_id),
  scope text not null check (scope in ('PRODUCTION', 'SYNTHETIC_TEST')),
  sequence bigint not null check (sequence >= 0),
  head_hash char(64) not null,
  artifact_set_hash char(64) not null,
  previous_checkpoint_hash char(64) null,
  signer_key_id text not null,
  signature_algorithm text not null check (signature_algorithm = 'Ed25519'),
  signing_payload_bytes text not null,
  signature text not null,
  checkpoint_hash char(64) not null unique,
  created_at timestamptz not null,
  record_json jsonb not null,
  unique (stream_id, sequence)
);

create table trusted_chain.presentation_read_model_projections (
  presentation_read_model_id text primary key,
  presentation_decision_id text not null,
  opportunity_candidate_id text not null,
  decision_revision integer not null check (decision_revision > 0),
  presentation_status text not null check (
    presentation_status in ('DISPLAY', 'DISPLAY_WITH_REVIEW', 'EVIDENCE_BLOCKED', 'NOT_DISPLAY')
  ),
  canonical_bytes text not null,
  artifact_hash char(64) not null,
  seal text not null,
  scope text not null check (scope in ('PRODUCTION', 'SYNTHETIC_TEST')),
  journal_stream_id text not null,
  journal_sequence bigint not null,
  record_json jsonb not null,
  unique (opportunity_candidate_id, decision_revision),
  foreign key (journal_stream_id, journal_sequence)
    references trusted_chain.command_journal (stream_id, sequence)
);

do $security$
declare table_name text;
begin
  foreach table_name in array array[
    'journal_heads', 'command_journal', 'journal_artifact_seals',
    'journal_checkpoints', 'presentation_read_model_projections'
  ] loop
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
      'revoke all on trusted_chain.%I from public, anon, authenticated, service_role, trusted_chain_writer, trusted_chain_reader',
      table_name
    );
  end loop;
end
$security$;

do $immutable$
declare table_name text;
begin
  foreach table_name in array array[
    'command_journal', 'journal_artifact_seals', 'journal_checkpoints',
    'presentation_read_model_projections'
  ] loop
    execute format(
      'create trigger %I before update or delete on trusted_chain.%I for each row execute function trusted_chain.reject_immutable_mutation()',
      table_name || '_immutable_row', table_name
    );
    execute format(
      'create trigger %I before truncate on trusted_chain.%I for each statement execute function trusted_chain.reject_immutable_truncate()',
      table_name || '_immutable_truncate', table_name
    );
  end loop;
end
$immutable$;

create or replace function trusted_chain.execution_identity_json(execution jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  normalized jsonb;
  normalized_record jsonb;
  normalized_envelopes jsonb;
  normalized_expected_artifacts jsonb;
begin
  select coalesce(
    pg_catalog.jsonb_agg(envelope.value order by
      envelope.value->>'artifact_kind',
      envelope.value->>'artifact_id',
      envelope.value->>'seal',
      envelope.value::text
    ),
    '[]'::jsonb
  ) into normalized_envelopes
  from pg_catalog.jsonb_array_elements(
    coalesce(execution->'artifact_envelopes', '[]'::jsonb)
  ) envelope(value);

  select coalesce(
    pg_catalog.jsonb_agg(artifact.value order by
      artifact.value->>'artifact_kind',
      artifact.value->>'artifact_id',
      artifact.value->>'content_hash',
      artifact.value::text
    ),
    '[]'::jsonb
  ) into normalized_expected_artifacts
  from pg_catalog.jsonb_array_elements(
    coalesce(execution#>'{record,expected_artifacts}', '[]'::jsonb)
  ) artifact(value);

  normalized_record := (execution->'record') - 'integrity_hash';
  normalized_record := pg_catalog.jsonb_set(
    normalized_record,
    '{expected_artifacts}',
    normalized_expected_artifacts,
    true
  );
  normalized := execution - 'writer_epoch' - 'record_integrity_bytes';
  normalized := pg_catalog.jsonb_set(
    normalized,
    '{artifact_envelopes}',
    normalized_envelopes,
    true
  );
  return pg_catalog.jsonb_set(normalized, '{record}', normalized_record, true);
end
$function$;

alter function trusted_chain.execution_identity_json(jsonb) owner to trusted_chain_owner;
revoke all on function trusted_chain.execution_identity_json(jsonb)
  from public, anon, authenticated, service_role, trusted_chain_writer,
    trusted_chain_reader, trusted_chain_recovery, trusted_chain_auditor;

create or replace function trusted_chain.initialize_journal_stream(
  checkpoint jsonb,
  initial_writer_epoch bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (checkpoint->>'sequence')::bigint is distinct from 0
    or checkpoint->>'head_hash' is distinct from repeat('0', 64)
    or checkpoint->>'previous_checkpoint_hash' is not null
    or initial_writer_epoch is null
    or initial_writer_epoch < 1 then
    raise exception using errcode = '22000', message = 'Invalid genesis checkpoint';
  end if;
  perform trusted_chain.assert_canonical_hash(
    '[]', checkpoint->>'artifact_set_hash', 'artifact_set_hash'
  );
  perform trusted_chain.assert_sha256(checkpoint->>'checkpoint_hash', 'checkpoint_hash');
  if nullif(checkpoint->>'signature', '') is null then
    raise exception using errcode = '22000', message = 'Genesis checkpoint signature is required';
  end if;
  insert into trusted_chain.journal_heads values (
    checkpoint->>'stream_id', checkpoint->>'scope', 0, null,
    initial_writer_epoch, 'ACTIVE', (checkpoint->>'created_at')::timestamptz
  );
  insert into trusted_chain.journal_checkpoints values (
    checkpoint->>'checkpoint_id', checkpoint->>'stream_id', checkpoint->>'scope', 0,
    checkpoint->>'head_hash', checkpoint->>'artifact_set_hash', null,
    checkpoint->>'signer_key_id', checkpoint->>'signature_algorithm',
    checkpoint->>'signing_payload_bytes', checkpoint->>'signature',
    checkpoint->>'checkpoint_hash', (checkpoint->>'created_at')::timestamptz, checkpoint
  );
end
$function$;

create or replace function trusted_chain.acquire_writer_epoch(target_stream_id text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare next_epoch bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_stream_id, 0));
  update trusted_chain.journal_heads
    set writer_epoch = writer_epoch + 1, updated_at = pg_catalog.clock_timestamp()
    where stream_id = target_stream_id and state = 'ACTIVE'
    returning writer_epoch into next_epoch;
  if next_epoch is null then
    raise exception using errcode = '55000', message = 'Journal stream is unavailable';
  end if;
  return next_epoch;
end
$function$;

create or replace function trusted_chain.append_journal_checkpoint(checkpoint jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare head trusted_chain.journal_heads%rowtype; previous_hash text; existing jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(checkpoint->>'stream_id', 0));
  select record_json into existing from trusted_chain.journal_checkpoints
    where checkpoint_id = checkpoint->>'checkpoint_id';
  if existing is not null then
    if existing = checkpoint then return 'IDEMPOTENT_REUSE'; end if;
    raise exception using errcode = '23505', message = 'Checkpoint identity collision';
  end if;
  select * into head from trusted_chain.journal_heads
    where stream_id = checkpoint->>'stream_id' for update;
  if head.stream_id is null or head.state <> 'ACTIVE'
    or head.scope is distinct from checkpoint->>'scope'
    or head.current_sequence is distinct from (checkpoint->>'sequence')::bigint
    or coalesce(head.current_hash, repeat('0', 64))
      is distinct from checkpoint->>'head_hash' then
    raise exception using errcode = '55000', message = 'Checkpoint does not match journal head';
  end if;
  select checkpoint_hash into previous_hash from trusted_chain.journal_checkpoints
    where stream_id = head.stream_id order by sequence desc limit 1;
  if checkpoint->>'previous_checkpoint_hash' is distinct from previous_hash then
    raise exception using errcode = '55000', message = 'Checkpoint chain mismatch';
  end if;
  insert into trusted_chain.journal_checkpoints values (
    checkpoint->>'checkpoint_id', checkpoint->>'stream_id', checkpoint->>'scope',
    (checkpoint->>'sequence')::bigint, checkpoint->>'head_hash',
    checkpoint->>'artifact_set_hash', checkpoint->>'previous_checkpoint_hash',
    checkpoint->>'signer_key_id', checkpoint->>'signature_algorithm',
    checkpoint->>'signing_payload_bytes', checkpoint->>'signature',
    checkpoint->>'checkpoint_hash', (checkpoint->>'created_at')::timestamptz, checkpoint
  );
  return 'APPENDED';
end
$function$;

create or replace function trusted_chain.append_execution(execution jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  record jsonb := execution->'record';
  stream text := execution->>'stream_id';
  epoch bigint := (execution->>'writer_epoch')::bigint;
  head trusted_chain.journal_heads%rowtype;
  existing_execution jsonb;
  envelope jsonb;
  reference jsonb;
  projection jsonb := execution->'read_model_projection';
  artifact_row trusted_chain.artifacts%rowtype;
  projection_row trusted_chain.presentation_read_model_projections%rowtype;
  projection_record jsonb;
  ordinal integer;
  actual_count bigint;
  actual_distinct_count bigint;
  expected_count bigint;
  expected_distinct_count bigint;
  incoming_execution_identity jsonb;
  existing_execution_identity jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(stream, 0));
  select * into head from trusted_chain.journal_heads where stream_id = stream for update;
  if head.stream_id is null or head.state <> 'ACTIVE' then
    raise exception using errcode = '55000', message = 'Journal head is unavailable';
  end if;
  if head.writer_epoch is distinct from epoch then
    raise exception using errcode = '55000', message = 'Stale writer epoch';
  end if;

  incoming_execution_identity := trusted_chain.execution_identity_json(execution);
  select execution_json into existing_execution from trusted_chain.command_journal
    where restoration_record_id = record->>'restoration_record_id';
  if existing_execution is not null then
    existing_execution_identity := trusted_chain.execution_identity_json(existing_execution);
    if existing_execution_identity = incoming_execution_identity then
      return 'IDEMPOTENT_REUSE';
    end if;
    raise exception using errcode = '23505', message = 'Command identity collision';
  end if;

  if (record->>'sequence')::bigint is distinct from head.current_sequence + 1 then
    raise exception using errcode = '55000', message = 'Journal sequence gap or reorder';
  end if;
  if record#>>'{provenance,scope}' is distinct from head.scope then
    raise exception using errcode = '55000', message = 'Journal scope mismatch';
  end if;
  if head.current_sequence = 0 then
    if record->>'previous_record_hash' is not null then
      raise exception using errcode = '55000', message = 'Journal previous hash mismatch';
    end if;
  else
    if record->>'previous_record_hash' is null
      or record->>'previous_record_hash' is distinct from head.current_hash then
      raise exception using errcode = '55000', message = 'Journal previous hash mismatch';
    end if;
  end if;
  perform trusted_chain.assert_canonical_hash(
    execution->>'command_canonical_bytes', record->>'command_hash', 'command_hash'
  );
  perform trusted_chain.assert_canonical_hash(
    execution->>'record_integrity_bytes', record->>'integrity_hash', 'record_integrity_hash'
  );

  select count(*), count(distinct (
    envelope.value->>'artifact_kind', envelope.value->>'artifact_id'
  )) into actual_count, actual_distinct_count
  from pg_catalog.jsonb_array_elements(execution->'artifact_envelopes') envelope(value);
  select count(*), count(distinct (
    expected.value->>'artifact_kind', expected.value->>'artifact_id'
  )) into expected_count, expected_distinct_count
  from pg_catalog.jsonb_array_elements(record->'expected_artifacts') expected(value);
  if actual_count <> actual_distinct_count then
    raise exception using errcode = '55000', message = 'Artifact envelopes must be unique';
  end if;
  if expected_count <> expected_distinct_count then
    raise exception using errcode = '55000', message = 'Expected artifact seals must be unique';
  end if;
  if actual_count <> expected_count then
    raise exception using errcode = '55000', message = 'Artifact set cardinality mismatch';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(record->'expected_artifacts') expected(value)
    where nullif(expected.value->>'artifact_kind', '') is null
      or nullif(expected.value->>'artifact_id', '') is null
      or nullif(expected.value->>'content_hash', '') is null
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(execution->'artifact_envelopes') envelope(value)
    where nullif(envelope.value->>'artifact_kind', '') is null
      or nullif(envelope.value->>'artifact_id', '') is null
      or nullif(envelope.value->>'seal', '') is null
  ) then
    raise exception using errcode = '55000', message = 'Artifact set identity is incomplete';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(record->'expected_artifacts') expected(value)
    where not exists (
      select 1 from pg_catalog.jsonb_array_elements(execution->'artifact_envelopes') candidate(value)
      where candidate.value->>'artifact_kind' = expected.value->>'artifact_kind'
        and candidate.value->>'artifact_id' = expected.value->>'artifact_id'
        and candidate.value->>'seal' = expected.value->>'content_hash'
    )
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(execution->'artifact_envelopes') candidate(value)
    where not exists (
      select 1 from pg_catalog.jsonb_array_elements(record->'expected_artifacts') expected(value)
      where expected.value->>'artifact_kind' = candidate.value->>'artifact_kind'
        and expected.value->>'artifact_id' = candidate.value->>'artifact_id'
        and expected.value->>'content_hash' = candidate.value->>'seal'
    )
  ) then
    raise exception using errcode = '55000', message = 'Artifact sets do not match execution';
  end if;

  for envelope in select value from jsonb_array_elements(execution->'artifact_envelopes') loop
    perform trusted_chain.assert_canonical_hash(
      envelope->>'canonical_bytes', envelope->>'artifact_hash', 'artifact_hash'
    );
    perform trusted_chain.assert_canonical_hash(
      envelope->>'integrity_bytes', envelope->>'integrity_hash', 'artifact_integrity_hash'
    );
    if envelope->>'scope' <> head.scope then
      raise exception using errcode = '55000', message = 'Artifact scope mismatch';
    end if;
    select * into artifact_row from trusted_chain.artifacts
      where artifact_type = envelope->>'artifact_type'
        and artifact_id = envelope->>'artifact_id';
    if artifact_row.artifact_id is not null then
      if artifact_row.record_json <> envelope then
        raise exception using errcode = '23505', message = 'Artifact identity collision';
      end if;
    else
      insert into trusted_chain.artifacts values (
        envelope->>'artifact_type', envelope->>'artifact_kind', envelope->>'artifact_id',
        envelope->>'stream_id', nullif(envelope->>'revision', '')::integer,
        nullif(envelope->>'supersedes_artifact_id', ''), envelope->>'schema_version',
        envelope->>'canonical_bytes', envelope->>'artifact_hash', envelope->>'seal',
        envelope->>'scope', envelope->'provenance', (envelope->>'created_at')::timestamptz,
        envelope->'producer', envelope->>'integrity_bytes', envelope->>'integrity_hash',
        stream, (record->>'sequence')::bigint, envelope
      );
    end if;
  end loop;

  for envelope in select value from jsonb_array_elements(execution->'artifact_envelopes') loop
    ordinal := 0;
    for reference in select value from jsonb_array_elements(envelope->'upstream_references') loop
      select * into artifact_row from trusted_chain.artifacts
        where artifact_kind = reference->>'upstream_artifact_kind'
          and artifact_id = reference->>'upstream_artifact_id';
      if artifact_row.artifact_id is null
        or artifact_row.scope <> envelope->>'scope'
        or artifact_row.seal <> reference->>'expected_seal' then
        raise exception using errcode = '23503', message = 'Missing or invalid upstream artifact';
      end if;
      insert into trusted_chain.artifact_upstream_references values (
        envelope->>'artifact_type', envelope->>'artifact_id', ordinal,
        reference->>'relation', reference->>'upstream_artifact_kind',
        artifact_row.artifact_type, reference->>'upstream_artifact_id',
        reference->>'expected_seal', envelope->>'scope'
      ) on conflict do nothing;
      ordinal := ordinal + 1;
    end loop;
  end loop;

  insert into trusted_chain.command_journal values (
    stream, (record->>'sequence')::bigint, record->>'restoration_record_id',
    nullif(record->>'previous_record_hash', ''), record->>'command_kind',
    execution->>'command_canonical_bytes', record->>'command_hash', record->>'result_hash',
    record->'expected_artifacts', record#>>'{provenance,scope}', record#>>'{provenance,actor}',
    (record#>>'{provenance,recorded_at}')::timestamptz, record->>'schema_version',
    execution->>'record_integrity_bytes', record->>'integrity_hash', epoch, record, execution
  );

  ordinal := 0;
  for reference in select value from jsonb_array_elements(record->'expected_artifacts') loop
    insert into trusted_chain.journal_artifact_seals values (
      stream, (record->>'sequence')::bigint, ordinal, reference->>'artifact_kind',
      reference->>'artifact_id', reference->>'content_hash'
    );
    ordinal := ordinal + 1;
  end loop;

  if projection is not null and projection <> 'null'::jsonb then
    select * into artifact_row from trusted_chain.artifacts
      where artifact_type = 'PRESENTATION_READ_MODEL'
        and artifact_id = projection->>'presentation_read_model_id';
    if artifact_row.artifact_id is null
      or artifact_row.canonical_bytes <> projection->>'canonical_bytes'
      or artifact_row.artifact_hash <> projection->>'artifact_hash'
      or artifact_row.seal <> projection->>'seal' then
      raise exception using errcode = '55000', message = 'ReadModel projection artifact mismatch';
    end if;
    projection_record := artifact_row.canonical_bytes::jsonb;
    if projection_record <> projection->'record' then
      raise exception using errcode = '55000', message = 'ReadModel projection record mismatch';
    end if;
    select * into projection_row from trusted_chain.presentation_read_model_projections
      where presentation_read_model_id = projection->>'presentation_read_model_id';
    if projection_row.presentation_read_model_id is not null then
      if projection_row.canonical_bytes <> projection->>'canonical_bytes'
        or projection_row.artifact_hash <> projection->>'artifact_hash'
        or projection_row.seal <> projection->>'seal'
        or projection_row.scope <> head.scope
        or projection_row.record_json <> projection_record then
        raise exception using errcode = '23505', message = 'ReadModel projection identity collision';
      end if;
    else
      insert into trusted_chain.presentation_read_model_projections values (
        projection->>'presentation_read_model_id',
        projection_record->>'presentation_decision_id',
        projection_record->>'opportunity_candidate_id',
        (projection_record->>'decision_revision')::integer,
        projection_record->>'presentation_status', projection->>'canonical_bytes',
        projection->>'artifact_hash', projection->>'seal', head.scope, stream,
        (record->>'sequence')::bigint, projection_record
      );
    end if;
  end if;

  update trusted_chain.journal_heads set
    current_sequence = (record->>'sequence')::bigint,
    current_hash = record->>'integrity_hash',
    updated_at = (record#>>'{provenance,recorded_at}')::timestamptz
  where stream_id = stream and writer_epoch = epoch;
  if not found then
    raise exception using errcode = '55000', message = 'Journal head advance failed';
  end if;
  return 'APPENDED';
end
$function$;

alter function trusted_chain.initialize_journal_stream(jsonb, bigint) owner to trusted_chain_owner;
alter function trusted_chain.acquire_writer_epoch(text) owner to trusted_chain_owner;
alter function trusted_chain.append_journal_checkpoint(jsonb) owner to trusted_chain_owner;
alter function trusted_chain.append_execution(jsonb) owner to trusted_chain_owner;

revoke all on function trusted_chain.initialize_journal_stream(jsonb, bigint) from public, anon, authenticated, service_role, trusted_chain_writer;
revoke all on function trusted_chain.acquire_writer_epoch(text) from public, anon, authenticated, service_role, trusted_chain_writer;
revoke all on function trusted_chain.append_journal_checkpoint(jsonb) from public, anon, authenticated, service_role, trusted_chain_writer;
revoke all on function trusted_chain.append_execution(jsonb) from public, anon, authenticated, service_role;

grant execute on function trusted_chain.initialize_journal_stream(jsonb, bigint) to trusted_chain_recovery;
grant execute on function trusted_chain.acquire_writer_epoch(text) to trusted_chain_recovery;
grant execute on function trusted_chain.append_journal_checkpoint(jsonb) to trusted_chain_recovery;
grant execute on function trusted_chain.append_execution(jsonb) to trusted_chain_writer;

grant select on trusted_chain.journal_heads,
  trusted_chain.command_journal,
  trusted_chain.journal_artifact_seals,
  trusted_chain.journal_checkpoints,
  trusted_chain.artifacts,
  trusted_chain.artifact_upstream_references
to trusted_chain_recovery, trusted_chain_auditor;

commit;
