begin;

create table trusted_chain.source_organization_versions (
  artifact_id text primary key,
  organization_id text not null,
  revision integer not null check (revision > 0),
  supersedes_artifact_id text null,
  canonical_bytes text not null,
  content_hash char(64) not null,
  integrity_bytes text not null,
  integrity_hash char(64) not null,
  provenance jsonb not null,
  effective_at timestamptz not null,
  created_at timestamptz not null,
  record_json jsonb not null,
  unique (organization_id, revision),
  foreign key (supersedes_artifact_id)
    references trusted_chain.source_organization_versions (artifact_id)
);

create table trusted_chain.source_definition_versions (
  artifact_id text primary key,
  source_definition_id text not null,
  publisher_organization_id text not null,
  revision integer not null check (revision > 0),
  supersedes_artifact_id text null,
  active boolean not null,
  authority_level text not null,
  canonical_bytes text not null,
  content_hash char(64) not null,
  integrity_bytes text not null,
  integrity_hash char(64) not null,
  provenance jsonb not null,
  effective_at timestamptz not null,
  created_at timestamptz not null,
  record_json jsonb not null,
  unique (source_definition_id, revision),
  foreign key (supersedes_artifact_id)
    references trusted_chain.source_definition_versions (artifact_id)
);

create table trusted_chain.adapter_registration_versions (
  artifact_id text primary key,
  adapter_key text not null,
  revision integer not null check (revision > 0),
  supersedes_artifact_id text null,
  active boolean not null,
  canonical_bytes text not null,
  content_hash char(64) not null,
  integrity_bytes text not null,
  integrity_hash char(64) not null,
  provenance jsonb not null,
  effective_at timestamptz not null,
  created_at timestamptz not null,
  record_json jsonb not null,
  unique (adapter_key, revision),
  foreign key (supersedes_artifact_id)
    references trusted_chain.adapter_registration_versions (artifact_id)
);

create table trusted_chain.recruitment_endpoint_versions (
  artifact_id text primary key,
  recruitment_endpoint_id text not null,
  source_definition_id text not null,
  revision integer not null check (revision > 0),
  supersedes_artifact_id text null,
  active boolean not null,
  canonical_locator text not null,
  canonical_bytes text not null,
  content_hash char(64) not null,
  integrity_bytes text not null,
  integrity_hash char(64) not null,
  provenance jsonb not null,
  effective_at timestamptz not null,
  created_at timestamptz not null,
  record_json jsonb not null,
  unique (recruitment_endpoint_id, revision),
  foreign key (supersedes_artifact_id)
    references trusted_chain.recruitment_endpoint_versions (artifact_id)
);

create table trusted_chain.source_admission_versions (
  artifact_id text primary key,
  source_admission_id text not null,
  recruitment_endpoint_id text not null,
  revision integer not null check (revision > 0),
  supersedes_artifact_id text null,
  admission_decision text not null check
    (admission_decision in ('APPROVED', 'REVIEW', 'REJECTED')),
  canonical_bytes text not null,
  content_hash char(64) not null,
  integrity_bytes text not null,
  integrity_hash char(64) not null,
  provenance jsonb not null,
  effective_at timestamptz not null,
  created_at timestamptz not null,
  record_json jsonb not null,
  unique (source_admission_id, revision),
  foreign key (supersedes_artifact_id)
    references trusted_chain.source_admission_versions (artifact_id)
);

create table trusted_chain.official_endpoint_allowlist_versions (
  artifact_id text primary key,
  allowlist_entry_id text not null,
  recruitment_endpoint_artifact_id text not null,
  source_admission_artifact_id text not null,
  revision integer not null check (revision > 0),
  supersedes_artifact_id text null,
  active boolean not null,
  scheme text not null check (scheme = 'https'),
  host text not null check (host = lower(host)),
  port integer null check (port is null or port between 1 and 65535),
  path_prefix text not null check (left(path_prefix, 1) = '/'),
  exact_path boolean not null,
  allowed_method text not null check (allowed_method = 'GET'),
  query_policy jsonb not null,
  endpoint_purpose text not null,
  authority_level text not null,
  approval_evidence_ids jsonb not null,
  canonical_bytes text not null,
  content_hash char(64) not null,
  integrity_bytes text not null,
  integrity_hash char(64) not null,
  provenance jsonb not null,
  effective_at timestamptz not null,
  created_at timestamptz not null,
  record_json jsonb not null,
  unique (allowlist_entry_id, revision),
  foreign key (supersedes_artifact_id)
    references trusted_chain.official_endpoint_allowlist_versions (artifact_id),
  foreign key (recruitment_endpoint_artifact_id)
    references trusted_chain.recruitment_endpoint_versions (artifact_id),
  foreign key (source_admission_artifact_id)
    references trusted_chain.source_admission_versions (artifact_id)
);

do $security$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_organization_versions',
    'source_definition_versions',
    'adapter_registration_versions',
    'recruitment_endpoint_versions',
    'source_admission_versions',
    'official_endpoint_allowlist_versions'
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

create or replace function trusted_chain.append_source_version(
  expected_kind text,
  target_table regclass,
  record jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  canonical_bytes text := record ->> 'canonical_bytes';
  content_hash text := record ->> 'content_hash';
  integrity_bytes text := record ->> 'integrity_bytes';
  integrity_hash text := record ->> 'integrity_hash';
  artifact_kind text := record #>> '{artifact,kind}';
  existing jsonb;
  previous jsonb;
  revision integer := (record ->> 'revision')::integer;
begin
  if artifact_kind <> expected_kind then
    raise exception using errcode = '22000', message = 'Source artifact kind mismatch';
  end if;
  perform trusted_chain.assert_canonical_hash(canonical_bytes, content_hash, 'content_hash');
  perform trusted_chain.assert_canonical_hash(integrity_bytes, integrity_hash, 'integrity_hash');
  if revision = 1 and record ->> 'supersedes_artifact_id' is not null then
    raise exception using errcode = '22000', message = 'Revision 1 cannot supersede an artifact';
  end if;
  if revision > 1 then
    if record ->> 'supersedes_artifact_id' is null then
      raise exception using errcode = '22000', message = 'Later source revision must supersede an artifact';
    end if;
    execute format('select record_json from %s where artifact_id = $1', target_table)
      into previous using record ->> 'supersedes_artifact_id';
    if previous is null
      or previous ->> 'stream_id' <> record ->> 'stream_id'
      or (previous ->> 'revision')::integer <> revision - 1 then
      raise exception using errcode = '22000', message = 'Source revision continuity mismatch';
    end if;
  end if;
  execute format('select record_json from %s where artifact_id = $1', target_table)
    into existing using record ->> 'artifact_id';
  if existing is not null then
    if existing = record then return 'IDEMPOTENT_REUSE'; end if;
    raise exception using errcode = '23505', message = 'Source artifact ID collision';
  end if;
  return 'APPENDED';
end
$function$;

create or replace function trusted_chain.append_source_organization_version(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare outcome text;
begin
  outcome := trusted_chain.append_source_version('ORGANIZATION', 'trusted_chain.source_organization_versions', record);
  if outcome = 'IDEMPOTENT_REUSE' then return outcome; end if;
  insert into trusted_chain.source_organization_versions values (
    record->>'artifact_id', record#>>'{artifact,payload,organization_id}', (record->>'revision')::integer,
    record->>'supersedes_artifact_id', record->>'canonical_bytes', record->>'content_hash',
    record->>'integrity_bytes', record->>'integrity_hash', record->'provenance',
    (record->>'effective_at')::timestamptz, (record->>'created_at')::timestamptz, record
  );
  return outcome;
end $function$;

create or replace function trusted_chain.append_source_definition_version(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare outcome text;
begin
  outcome := trusted_chain.append_source_version('SOURCE_DEFINITION', 'trusted_chain.source_definition_versions', record);
  if outcome = 'IDEMPOTENT_REUSE' then return outcome; end if;
  insert into trusted_chain.source_definition_versions values (
    record->>'artifact_id', record#>>'{artifact,payload,source_definition_id}',
    record#>>'{artifact,payload,publisher_organization_id}', (record->>'revision')::integer,
    record->>'supersedes_artifact_id', (record#>>'{artifact,payload,enabled}')::boolean,
    record#>>'{artifact,payload,authority_level}', record->>'canonical_bytes', record->>'content_hash',
    record->>'integrity_bytes', record->>'integrity_hash', record->'provenance',
    (record->>'effective_at')::timestamptz, (record->>'created_at')::timestamptz, record
  );
  return outcome;
end $function$;

create or replace function trusted_chain.append_adapter_registration_version(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare outcome text;
begin
  outcome := trusted_chain.append_source_version('ADAPTER_REGISTRATION', 'trusted_chain.adapter_registration_versions', record);
  if outcome = 'IDEMPOTENT_REUSE' then return outcome; end if;
  insert into trusted_chain.adapter_registration_versions values (
    record->>'artifact_id', record#>>'{artifact,payload,adapter_key}', (record->>'revision')::integer,
    record->>'supersedes_artifact_id', true, record->>'canonical_bytes', record->>'content_hash',
    record->>'integrity_bytes', record->>'integrity_hash', record->'provenance',
    (record->>'effective_at')::timestamptz, (record->>'created_at')::timestamptz, record
  );
  return outcome;
end $function$;

create or replace function trusted_chain.append_recruitment_endpoint_version(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare outcome text;
begin
  outcome := trusted_chain.append_source_version('RECRUITMENT_ENDPOINT', 'trusted_chain.recruitment_endpoint_versions', record);
  if outcome = 'IDEMPOTENT_REUSE' then return outcome; end if;
  insert into trusted_chain.recruitment_endpoint_versions values (
    record->>'artifact_id', record#>>'{artifact,payload,recruitment_endpoint_id}',
    record#>>'{artifact,payload,source_definition_id}', (record->>'revision')::integer,
    record->>'supersedes_artifact_id', (record#>>'{artifact,payload,enabled}')::boolean,
    record#>>'{artifact,payload,locator}', record->>'canonical_bytes', record->>'content_hash',
    record->>'integrity_bytes', record->>'integrity_hash', record->'provenance',
    (record->>'effective_at')::timestamptz, (record->>'created_at')::timestamptz, record
  );
  return outcome;
end $function$;

create or replace function trusted_chain.append_source_admission_version(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare outcome text;
begin
  outcome := trusted_chain.append_source_version('SOURCE_ADMISSION', 'trusted_chain.source_admission_versions', record);
  if outcome = 'IDEMPOTENT_REUSE' then return outcome; end if;
  insert into trusted_chain.source_admission_versions values (
    record->>'artifact_id', record#>>'{artifact,payload,source_admission_id}',
    record#>>'{artifact,payload,recruitment_endpoint_id}', (record->>'revision')::integer,
    record->>'supersedes_artifact_id', record#>>'{artifact,payload,admission_decision}',
    record->>'canonical_bytes', record->>'content_hash', record->>'integrity_bytes',
    record->>'integrity_hash', record->'provenance', (record->>'effective_at')::timestamptz,
    (record->>'created_at')::timestamptz, record
  );
  return outcome;
end $function$;

create or replace function trusted_chain.append_official_endpoint_allowlist_version(record jsonb)
returns text language plpgsql security definer set search_path = '' as $function$
declare outcome text;
begin
  outcome := trusted_chain.append_source_version('OFFICIAL_ENDPOINT_ALLOWLIST', 'trusted_chain.official_endpoint_allowlist_versions', record);
  if outcome = 'IDEMPOTENT_REUSE' then return outcome; end if;
  insert into trusted_chain.official_endpoint_allowlist_versions values (
    record->>'artifact_id', record#>>'{artifact,payload,allowlist_entry_id}',
    record#>>'{artifact,payload,recruitment_endpoint_artifact_id}',
    record#>>'{artifact,payload,source_admission_artifact_id}', (record->>'revision')::integer,
    record->>'supersedes_artifact_id', (record#>>'{artifact,payload,active}')::boolean,
    record#>>'{artifact,payload,scheme}', record#>>'{artifact,payload,host}',
    nullif(record#>>'{artifact,payload,port}', '')::integer,
    record#>>'{artifact,payload,path_prefix}', (record#>>'{artifact,payload,exact_path}')::boolean,
    record#>>'{artifact,payload,allowed_method}', record#>'{artifact,payload,query_policy}',
    record#>>'{artifact,payload,endpoint_purpose}', record#>>'{artifact,payload,authority_level}',
    record#>'{artifact,payload,approval_evidence_ids}', record->>'canonical_bytes',
    record->>'content_hash', record->>'integrity_bytes', record->>'integrity_hash',
    record->'provenance', (record->>'effective_at')::timestamptz,
    (record->>'created_at')::timestamptz, record
  );
  return outcome;
end $function$;

do $functions$
declare
  function_name text;
begin
  foreach function_name in array array[
    'append_source_organization_version', 'append_source_definition_version',
    'append_adapter_registration_version', 'append_recruitment_endpoint_version',
    'append_source_admission_version', 'append_official_endpoint_allowlist_version'
  ] loop
    execute format('alter function trusted_chain.%I(jsonb) owner to trusted_chain_owner', function_name);
    execute format('revoke all on function trusted_chain.%I(jsonb) from public, anon, authenticated, service_role', function_name);
    execute format('grant execute on function trusted_chain.%I(jsonb) to trusted_chain_writer', function_name);
  end loop;
end
$functions$;

alter function trusted_chain.append_source_version(text, regclass, jsonb) owner to trusted_chain_owner;
revoke all on function trusted_chain.append_source_version(text, regclass, jsonb)
  from public, anon, authenticated, service_role, trusted_chain_writer;

commit;
