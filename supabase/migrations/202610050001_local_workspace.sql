-- A single owner-selected workspace for the loopback-only, account-free app.
-- No Supabase Auth user, password, session or browser storage policy is needed.
create table defense.local_workspace (
 id boolean primary key default true check(id),
 user_id uuid not null references defense.memberships(user_id)
);
alter table defense.local_workspace enable row level security;
revoke all on defense.local_workspace from public, authenticated;
grant all on defense.local_workspace to service_role;
