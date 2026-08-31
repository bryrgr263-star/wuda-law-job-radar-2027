create extension if not exists pgcrypto;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  official_domain text not null,
  unit_name text not null,
  unit_type text not null,
  system_name text not null,
  industry text not null,
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  announcement_url text not null,
  application_url text,
  unit_name text not null,
  unit_type text not null,
  system_name text not null,
  industry text not null default '',
  location text not null default '全国/未注明',
  title text not null,
  direction text not null,
  recruitment_year integer not null check (recruitment_year = 2027),
  batch text not null default '校园招聘',
  education text not null default '学历要求待核验',
  non_law_rule text not null default '专业限制待核验',
  match_score integer not null check (match_score between 1 and 5),
  salary text not null default '未公开',
  development text not null default '',
  start_date date,
  deadline date,
  recruitment_status text not null default '网申进行中',
  source_status text not null default '来源待核验',
  source_name text not null default '',
  source_updated_at timestamptz,
  content_hash text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id text not null references public.jobs(job_id) on delete cascade,
  status text not null default '未投递' check (status in ('未投递','准备中','已投递','已结束')),
  favorite boolean not null default false,
  notes text not null default '',
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  source_count integer not null default 0,
  discovered_count integer not null default 0,
  upserted_count integer not null default 0,
  failure_count integer not null default 0,
  details jsonb not null default '[]'::jsonb
);

create index if not exists jobs_public_sort_idx on public.jobs (is_published, recruitment_year, match_score desc, deadline asc);
create index if not exists jobs_unit_type_idx on public.jobs (unit_type);
create index if not exists jobs_direction_idx on public.jobs (direction);
create index if not exists applications_user_idx on public.applications (user_id, updated_at desc);

alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.sources enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists "Public can read published 2027 jobs" on public.jobs;
create policy "Public can read published 2027 jobs" on public.jobs for select using (is_published = true and recruitment_year = 2027);

drop policy if exists "Users can read own progress" on public.applications;
create policy "Users can read own progress" on public.applications for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own progress" on public.applications;
create policy "Users can insert own progress" on public.applications for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own progress" on public.applications;
create policy "Users can update own progress" on public.applications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table public.jobs;
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at before update on public.jobs for each row execute function public.set_updated_at();
drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at before update on public.applications for each row execute function public.set_updated_at();
