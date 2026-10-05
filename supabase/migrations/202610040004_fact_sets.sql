create table defense.fact_sets (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, matter_id uuid not null,
 job_id uuid not null unique references defense.jobs, content jsonb not null, source_hashes jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(matter_id,org_id) references defense.matters(id,org_id)
);
alter table defense.fact_sets enable row level security;
grant all on defense.fact_sets to service_role;
grant select on defense.fact_sets to authenticated;
create policy tenant_read on defense.fact_sets for select to authenticated using(defense.visible_matter(matter_id,org_id));
