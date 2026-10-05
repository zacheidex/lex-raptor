alter table defense.matters add column workspace_kind text not null default 'matter'
 check(workspace_kind in ('matter','research'));
create unique index one_research_notebook on defense.matters(org_id,created_by)
 where workspace_kind='research' and deleted_at is null;
alter table defense.jobs drop constraint jobs_kind_check;
alter table defense.jobs add constraint jobs_kind_check check(kind in ('ingest','draft','benchmark','research'));

-- Only published court opinions belong in this shared library. Private records
-- continue to use the tenant-scoped matter/document tables.
create table defense.cases (
 id text primary key, name text not null, citation text not null,
 court text not null, jurisdiction text not null, decision_date date not null,
 source_url text not null, source_sha256 text not null,
 source_name text not null, rights text not null, imported_at timestamptz not null default now(),
 opinion_count integer not null, metadata jsonb not null default '{}'
);
create table defense.case_passages (
 id text primary key, case_id text not null references defense.cases on delete cascade,
 ordinal integer not null, locator text not null, opinion_type text not null,
 text text not null, search_vector tsvector generated always as (to_tsvector('english',text)) stored
);
create index case_passages_search on defense.case_passages using gin(search_vector);
create index case_passages_case on defense.case_passages(case_id,ordinal);
create index cases_date on defense.cases(decision_date);
create table defense.research_runs (
 id uuid primary key references defense.jobs, org_id uuid not null, matter_id uuid not null,
 query text not null, filters jsonb not null, result jsonb, created_at timestamptz not null default now(),
 foreign key(matter_id,org_id) references defense.matters(id,org_id)
);
create table defense.local_calls (
 id text primary key, job_id uuid not null references defense.jobs,
 model text not null, model_digest text not null, request_hash text not null,
 state text not null check(state in ('running','completed','failed')),
 input_tokens integer, output_tokens integer, duration_ms integer,
 created_at timestamptz not null default now()
);
alter table defense.cases enable row level security;
alter table defense.case_passages enable row level security;
alter table defense.research_runs enable row level security;
alter table defense.local_calls enable row level security;
grant all on defense.cases,defense.case_passages,defense.research_runs,defense.local_calls to service_role;
grant select on defense.cases,defense.case_passages,defense.research_runs to authenticated;
create policy library_read on defense.cases for select to authenticated using(defense.current_org() is not null);
create policy library_read on defense.case_passages for select to authenticated using(defense.current_org() is not null);
create policy tenant_read on defense.research_runs for select to authenticated
 using(org_id=defense.current_org() and defense.visible_matter(matter_id,org_id));
