begin;

create table trusted_chain.acquisition_runs (
  acquisition_run_id text primary key,
  source_admission_artifact_id text not null references trusted_chain.source_admission_versions (artifact_id),
  endpoint_artifact_id text not null references trusted_chain.recruitment_endpoint_versions (artifact_id),
  allowlist_artifact_id text not null references trusted_chain.official_endpoint_allowlist_versions (artifact_id),
  status text not null check
    (status in ('SUCCESS', 'NOT_MODIFIED', 'PARTIAL', 'FAILED', 'SUSPICIOUS_EMPTY')),
  started_at timestamptz not null,
  completed_at timestamptz not null check (completed_at >= started_at),
  request_metadata jsonb not null,
  result_metadata jsonb not null,
  provenance jsonb not null,
  record_json jsonb not null
);

create table trusted_chain.raw_blobs (
  raw_blob_id text primary key,
  raw_content_sha256 char(64) not null unique,
  byte_length bigint not null check (byte_length >= 0),
  content_type text not null,
  bucket_id text not null check (bucket_id = 'trusted-raw-production'),
  object_key text not null unique check
    (object_key ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{2}/[a-f0-9]{64}$'),
  source_definition_id text not null,
  recruitment_endpoint_id text not null,
  first_acquired_at timestamptz not null,
  provenance jsonb not null,
  canonical_bytes text not null,
  manifest_integrity_hash char(64) not null,
  record_json jsonb not null
);

create table trusted_chain.raw_blob_acquisitions (
  raw_blob_id text not null references trusted_chain.raw_blobs (raw_blob_id),
  acquisition_run_id text not null references trusted_chain.acquisition_runs (acquisition_run_id),
  acquired_at timestamptz not null,
  record_json jsonb not null,
  primary key (raw_blob_id, acquisition_run_id)
);

create table trusted_chain.snapshots (
  snapshot_id text primary key,
  acquisition_run_id text not null references trusted_chain.acquisition_runs (acquisition_run_id),
  recruitment_endpoint_id text not null,
  transport_status text not null check (transport_status in ('SUCCESS', 'FAILED')),
  raw_blob_id text null references trusted_chain.raw_blobs (raw_blob_id),
  content_hash char(64) null,
  content_length bigint null,
  request_metadata jsonb not null,
  response_metadata jsonb not null,
  canonical_bytes text not null,
  integrity_hash char(64) not null,
  observed_at timestamptz not null,
  record_json jsonb not null,
  check (
    (transport_status = 'SUCCESS' and raw_blob_id is not null and content_hash is not null and content_length is not null)
    or
    (transport_status = 'FAILED' and raw_blob_id is null and content_hash is null and content_length is null)
  )
);

create table trusted_chain.extracted_records (
  extracted_record_id text primary key,
  snapshot_id text not null references trusted_chain.snapshots (snapshot_id),
  source_definition_id text not null,
  schema_version text not null,
  semantic_hash char(64) null,
  canonical_bytes text not null,
  integrity_hash char(64) not null,
  provenance jsonb not null,
  extracted_at timestamptz not null,
  record_json jsonb not null
);

do $security$
declare
  table_name text;
begin
  foreach table_name in array array[
    'acquisition_runs', 'raw_blobs', 'raw_blob_acquisitions', 'snapshots', 'extracted_records'
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
    execute format(
      'grant select on trusted_chain.%I to trusted_chain_recovery, trusted_chain_auditor',
      table_name
    );
  end loop;
end
$security$;

create or replace function trusted_chain.append_acquisition_run(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare existing jsonb;
begin
  select record_json into existing from trusted_chain.acquisition_runs
    where acquisition_run_id = record->>'acquisition_run_id';
  if existing is not null then
    if existing = record then return 'IDEMPOTENT_REUSE'; end if;
    raise exception using errcode = '23505', message = 'Acquisition run collision';
  end if;
  insert into trusted_chain.acquisition_runs values (
    record->>'acquisition_run_id', record->>'source_admission_artifact_id',
    record->>'endpoint_artifact_id', record->>'allowlist_artifact_id', record->>'status',
    (record->>'started_at')::timestamptz, (record->>'completed_at')::timestamptz,
    record->'request_metadata', record->'result_metadata', record->'provenance', record
  );
  return 'APPENDED';
end $function$;

create or replace function trusted_chain.append_raw_blob_manifest(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare existing jsonb;
begin
  perform trusted_chain.assert_canonical_hash(
    record->>'canonical_bytes', record->>'manifest_integrity_hash', 'RawBlob manifest hash'
  );
  select record_json into existing from trusted_chain.raw_blobs where raw_blob_id = record->>'raw_blob_id';
  if existing is not null then
    if existing = record then return 'IDEMPOTENT_REUSE'; end if;
    raise exception using errcode = '23505', message = 'RawBlob manifest collision';
  end if;
  insert into trusted_chain.raw_blobs values (
    record->>'raw_blob_id', record->>'raw_content_sha256', (record->>'byte_length')::bigint,
    record->>'content_type', record->>'bucket_id', record->>'object_key',
    record->>'source_definition_id', record->>'recruitment_endpoint_id',
    (record->>'first_acquired_at')::timestamptz, record->'provenance',
    record->>'canonical_bytes', record->>'manifest_integrity_hash', record
  );
  return 'APPENDED';
end $function$;

create or replace function trusted_chain.append_raw_blob_acquisition(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare existing jsonb;
begin
  select record_json into existing from trusted_chain.raw_blob_acquisitions
    where raw_blob_id = record->>'raw_blob_id'
      and acquisition_run_id = record->>'acquisition_run_id';
  if existing is not null then
    if existing = record then return 'IDEMPOTENT_REUSE'; end if;
    raise exception using errcode = '23505', message = 'RawBlob acquisition collision';
  end if;
  insert into trusted_chain.raw_blob_acquisitions values (
    record->>'raw_blob_id', record->>'acquisition_run_id',
    (record->>'acquired_at')::timestamptz, record
  );
  return 'APPENDED';
end $function$;

create or replace function trusted_chain.append_snapshot(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare existing jsonb; canonical_bytes text; integrity_hash text;
begin
  canonical_bytes := record::text;
  integrity_hash := encode(extensions.digest(convert_to(canonical_bytes, 'UTF8'), 'sha256'), 'hex');
  select record_json into existing from trusted_chain.snapshots where snapshot_id = record->>'snapshot_id';
  if existing is not null then
    if existing = record then return 'IDEMPOTENT_REUSE'; end if;
    raise exception using errcode = '23505', message = 'Snapshot collision';
  end if;
  insert into trusted_chain.snapshots values (
    record->>'snapshot_id', record->>'acquisition_run_id', record->>'recruitment_endpoint_id',
    record->>'transport_status', nullif(record->>'raw_blob_id', ''), nullif(record->>'content_hash', ''),
    nullif(record->>'content_length', '')::bigint, record->'request_metadata', record->'response_metadata',
    canonical_bytes, integrity_hash, (record->>'observed_at')::timestamptz, record
  );
  return 'APPENDED';
end $function$;

create or replace function trusted_chain.append_extracted_record(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare existing jsonb; canonical_bytes text; integrity_hash text;
begin
  canonical_bytes := record::text;
  integrity_hash := encode(extensions.digest(convert_to(canonical_bytes, 'UTF8'), 'sha256'), 'hex');
  select record_json into existing from trusted_chain.extracted_records
    where extracted_record_id = record->>'extracted_record_id';
  if existing is not null then
    if existing = record then return 'IDEMPOTENT_REUSE'; end if;
    raise exception using errcode = '23505', message = 'ExtractedRecord collision';
  end if;
  insert into trusted_chain.extracted_records values (
    record->>'extracted_record_id', record->>'snapshot_id', record->>'source_definition_id',
    coalesce(record#>>'{extraction,schema_version}', 'EXTRACTED_RECORD_V1'),
    nullif(record->>'semantic_hash', ''), canonical_bytes, integrity_hash,
    jsonb_build_object('extraction', record->'extraction'),
    (record#>>'{extraction,extracted_at}')::timestamptz, record
  );
  return 'APPENDED';
end $function$;

do $functions$
declare function_name text;
begin
  foreach function_name in array array[
    'append_acquisition_run', 'append_raw_blob_manifest', 'append_raw_blob_acquisition',
    'append_snapshot', 'append_extracted_record'
  ] loop
    execute format('alter function trusted_chain.%I(jsonb) owner to trusted_chain_owner', function_name);
    execute format('revoke all on function trusted_chain.%I(jsonb) from public, anon, authenticated, service_role', function_name);
    execute format('grant execute on function trusted_chain.%I(jsonb) to trusted_chain_writer', function_name);
  end loop;
end
$functions$;

insert into storage.buckets (id, name, public)
values ('trusted-raw-production', 'trusted-raw-production', false)
on conflict (id) do nothing;

do $bucket$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'trusted-raw-production' and name = 'trusted-raw-production' and public = false
  ) then
    raise exception 'trusted-raw-production bucket exists with incompatible configuration';
  end if;
end
$bucket$;

grant usage on schema storage to trusted_chain_storage_writer;
grant select, insert on storage.objects to trusted_chain_storage_writer;
revoke update, delete, truncate on storage.objects from trusted_chain_storage_writer;

create policy trusted_raw_production_insert
on storage.objects for insert to trusted_chain_storage_writer
with check (
  bucket_id = 'trusted-raw-production'
  and name ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{2}/[a-f0-9]{64}$'
);

create policy trusted_raw_production_verify_read
on storage.objects for select to trusted_chain_storage_writer
using (
  bucket_id = 'trusted-raw-production'
  and name ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{2}/[a-f0-9]{64}$'
);

commit;
