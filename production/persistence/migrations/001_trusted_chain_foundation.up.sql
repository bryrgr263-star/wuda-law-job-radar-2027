begin;

create extension if not exists pgcrypto with schema extensions;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'trusted_chain_owner') then
    create role trusted_chain_owner nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'trusted_chain_migrator') then
    create role trusted_chain_migrator nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'trusted_chain_writer') then
    create role trusted_chain_writer nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'trusted_chain_reader') then
    create role trusted_chain_reader nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'trusted_chain_recovery') then
    create role trusted_chain_recovery nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'trusted_chain_auditor') then
    create role trusted_chain_auditor nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'trusted_chain_storage_writer') then
    create role trusted_chain_storage_writer nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end
$roles$;

grant trusted_chain_owner to trusted_chain_migrator;

create schema if not exists trusted_chain authorization trusted_chain_owner;
alter schema trusted_chain owner to trusted_chain_owner;

revoke all on schema trusted_chain from public, anon, authenticated, service_role;
grant usage on schema trusted_chain to
  trusted_chain_writer,
  trusted_chain_reader,
  trusted_chain_recovery,
  trusted_chain_auditor;

create or replace function trusted_chain.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%s is immutable and append-only', tg_table_schema || '.' || tg_table_name);
end
$function$;

create or replace function trusted_chain.reject_immutable_truncate()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%s is immutable and cannot be truncated', tg_table_schema || '.' || tg_table_name);
end
$function$;

create or replace function trusted_chain.assert_sha256(value text, label text)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if value is null or value !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22000', message = label || ' must be lowercase SHA-256';
  end if;
end
$function$;

create or replace function trusted_chain.assert_canonical_hash(
  canonical_bytes text,
  expected_hash text,
  label text
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
begin
  perform trusted_chain.assert_sha256(expected_hash, label);
  if encode(extensions.digest(convert_to(canonical_bytes, 'UTF8'), 'sha256'), 'hex') <> expected_hash then
    raise exception using errcode = '22000', message = label || ' does not match canonical bytes';
  end if;
end
$function$;

alter function trusted_chain.reject_immutable_mutation() owner to trusted_chain_owner;
alter function trusted_chain.reject_immutable_truncate() owner to trusted_chain_owner;
alter function trusted_chain.assert_sha256(text, text) owner to trusted_chain_owner;
alter function trusted_chain.assert_canonical_hash(text, text, text) owner to trusted_chain_owner;

revoke all on function trusted_chain.reject_immutable_mutation() from public;
revoke all on function trusted_chain.reject_immutable_truncate() from public;
revoke all on function trusted_chain.assert_sha256(text, text) from public;
revoke all on function trusted_chain.assert_canonical_hash(text, text, text) from public;

alter default privileges for role trusted_chain_owner in schema trusted_chain
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role trusted_chain_owner in schema trusted_chain
  revoke execute on functions from public, anon, authenticated, service_role;

comment on schema trusted_chain is
  'Private production persistence for the existing Trusted Chain; not a Data API schema.';

commit;
