alter table defense.paid_settings add column max_judge_output_tokens integer not null default 64000;
create table defense.worker_status(id text primary key,last_seen timestamptz not null default now());
alter table defense.worker_status enable row level security;
grant all on defense.worker_status to service_role;

create or replace function defense.visible_matter(mid uuid,oid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select oid=defense.current_org() and exists(select 1 from defense.matters where id=mid and org_id=oid and deleted_at is null)
$$;
revoke all on function defense.visible_matter(uuid,uuid) from public;
grant execute on function defense.visible_matter(uuid,uuid) to authenticated;
drop policy tenant_read on defense.matters;
create policy tenant_read on defense.matters for select to authenticated using(org_id=defense.current_org() and deleted_at is null);
do $$ declare t text; begin
 foreach t in array array['documents','jobs','drafts','reviewed_facts'] loop
  execute format('drop policy tenant_read on defense.%I',t);
  execute format('create policy tenant_read on defense.%I for select to authenticated using (defense.visible_matter(matter_id,org_id))',t);
 end loop;
end $$;
