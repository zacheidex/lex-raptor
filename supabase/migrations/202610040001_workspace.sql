create extension if not exists pgcrypto;
create schema if not exists defense;

create table defense.organizations (
 id uuid primary key default gen_random_uuid(), name text not null,
 created_at timestamptz not null default now()
);
create table defense.memberships (
 user_id uuid primary key, org_id uuid not null references defense.organizations,
 role text not null check(role in ('admin','reviewer')), active boolean not null default true,
 email text not null, created_at timestamptz not null default now(), unique(user_id,org_id)
);
create table defense.matters (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references defense.organizations,
 title text not null, represented_party text not null, synthetic boolean not null default false,
 created_by uuid not null, created_at timestamptz not null default now(), deleted_at timestamptz,
 unique(id,org_id)
);
create table defense.documents (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, matter_id uuid not null,
 name text not null, sha256 text not null, object_key text not null, size_bytes bigint not null,
 status text not null default 'queued', error_code text, warnings jsonb not null default '[]',
 extraction_version text, chunks jsonb not null default '[]',
 active boolean not null default true, supersedes uuid references defense.documents,
 created_at timestamptz not null default now(), unique(id,org_id,matter_id),
 foreign key(matter_id,org_id) references defense.matters(id,org_id)
);
create table defense.templates (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references defense.organizations,
 name text not null, version integer not null, body text not null, sha256 text not null,
 created_at timestamptz not null default now(), unique(org_id,name,version)
);
create table defense.jobs (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, matter_id uuid not null,
 user_id uuid not null, kind text not null check(kind in ('ingest','draft','benchmark')),
 payload jsonb not null, state text not null default 'queued', error_code text,
 idempotency_key text not null, cancel_requested boolean not null default false,
 lease_until timestamptz, worker_id text, created_at timestamptz not null default now(),
 finished_at timestamptz, unique(user_id,idempotency_key),
 foreign key(matter_id,org_id) references defense.matters(id,org_id),
 foreign key(user_id,org_id) references defense.memberships(user_id,org_id)
);
create table defense.drafts (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, matter_id uuid not null,
 job_id uuid not null references defense.jobs, revision integer not null,
 content jsonb not null, source_hashes jsonb not null, trace jsonb not null default '{}',
 review_state text not null default 'draft', reviewed_by uuid, reviewed_at timestamptz,
 created_by uuid not null, created_at timestamptz not null default now(),
 unique(job_id,revision), foreign key(matter_id,org_id) references defense.matters(id,org_id)
);
create table defense.reviewed_facts (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, matter_id uuid not null,
 statement text not null, citations jsonb not null, source_hashes jsonb not null,
 reviewed_by uuid not null, created_at timestamptz not null default now(),
 foreign key(matter_id,org_id) references defense.matters(id,org_id)
);
create table defense.paid_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 failure_count integer not null default 0, circuit_open boolean not null default false,
 model_id text, reasoning text not null default 'low', max_input_tokens integer not null default 200000,
 max_output_tokens integer not null default 16000, max_calls integer not null default 4
);
insert into defense.paid_settings(id) values(true);
create table defense.prices (
 model_id text primary key, provider text not null check(provider in ('openai','anthropic')),
 input_micro_per_million bigint not null check(input_micro_per_million > 0),
 output_micro_per_million bigint not null check(output_micro_per_million > 0),
 context_limit integer not null, verified_at timestamptz not null, source_url text not null,
 enabled boolean not null default false,
 notes text not null default ''
);
create table defense.budgets (
 scope text primary key, cap_micro bigint not null check(cap_micro >= 0),
 spent_micro bigint not null default 0 check(spent_micro >= 0),
 held_micro bigint not null default 0 check(held_micro >= 0)
);
insert into defense.budgets(scope,cap_micro) values ('global',0);
create table defense.calls (
 id text primary key, job_id uuid not null references defense.jobs,
 category text not null, model_id text not null, request_hash text not null,
 scopes text[] not null, reserved_micro bigint not null,
 price_snapshot jsonb not null,
 state text not null default 'reserved', actual_micro bigint, usage jsonb,
 provider_request_id text, response jsonb,
 created_at timestamptz not null default now(), settled_at timestamptz
);
create table defense.audit (
 id bigint generated always as identity primary key, user_id uuid, org_id uuid,
 event text not null, resource_id text, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create table defense.rate_limits (
 key text primary key, count integer not null, window_start timestamptz not null default now()
);
create index jobs_queue on defense.jobs(state,created_at);
create index documents_matter on defense.documents(matter_id,active);
create index drafts_matter on defense.drafts(matter_id,created_at desc);

-- No browser writes or access to service accounting. Supabase authenticates users;
-- the API validates active memberships and uses an authenticated proxy for objects.
create or replace function defense.current_org() returns uuid language sql stable security definer
set search_path = '' as $$
 select org_id from defense.memberships where user_id=auth.uid() and active
$$;
revoke all on function defense.current_org() from public;
grant usage on schema defense to authenticated, service_role;
grant execute on function defense.current_org() to authenticated;
do $$ declare t text; begin
 foreach t in array array['organizations','memberships','matters','documents','templates','jobs','drafts','reviewed_facts','paid_settings','prices','budgets','calls','audit','rate_limits'] loop
  execute format('alter table defense.%I enable row level security',t);
  execute format('grant all on defense.%I to service_role',t);
 end loop;
 foreach t in array array['matters','documents','templates','jobs','drafts','reviewed_facts'] loop
  execute format('grant select on defense.%I to authenticated',t);
  execute format('create policy tenant_read on defense.%I for select to authenticated using (org_id=defense.current_org())',t);
 end loop;
end $$;
grant usage,select on all sequences in schema defense to service_role;

-- Private bucket. No browser storage policies: all downloads go through the
-- authorized API, so revocation applies immediately and URLs are not bearer links.
insert into storage.buckets(id,name,public,file_size_limit)
 values ('matter-files','matter-files',false,20971520) on conflict(id) do update set public=false;
