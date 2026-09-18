begin;

do $bucket$
declare existing_public boolean;
begin
  select public into existing_public from storage.buckets
    where id = 'trusted-candidate-evidence-production';
  if existing_public is null then
    insert into storage.buckets (id, name, public)
      values (
        'trusted-candidate-evidence-production',
        'trusted-candidate-evidence-production',
        false
      );
  elsif existing_public then
    raise exception 'trusted-candidate-evidence-production bucket is public';
  end if;
end
$bucket$;

grant usage on schema storage to trusted_chain_storage_writer;
grant select, insert on storage.objects to trusted_chain_storage_writer;
revoke update, delete, truncate on storage.objects from trusted_chain_storage_writer;

create policy trusted_candidate_evidence_production_insert
on storage.objects for insert to trusted_chain_storage_writer
with check (
  bucket_id = 'trusted-candidate-evidence-production'
  and name ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{2}/[a-f0-9]{64}$'
);

create policy trusted_candidate_evidence_production_verify_read
on storage.objects for select to trusted_chain_storage_writer
using (
  bucket_id = 'trusted-candidate-evidence-production'
  and name ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{2}/[a-f0-9]{64}$'
);

create policy presentation_read_model_reader_select
on trusted_chain.presentation_read_model_projections
for select to trusted_chain_reader
using (scope = 'PRODUCTION');

grant usage on schema trusted_chain to trusted_chain_reader;
grant select on trusted_chain.presentation_read_model_projections
to trusted_chain_reader;

commit;
