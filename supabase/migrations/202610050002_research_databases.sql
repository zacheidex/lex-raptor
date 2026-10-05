create table defense.research_databases (
 id text primary key,
 name text not null,
 description text not null,
 homepage text not null,
 enabled boolean not null default false
);
insert into defense.research_databases(id,name,description,homepage,enabled) values
 ('cap','Harvard Caselaw Access Project','Imported court opinions, searched locally. This is a selected library, not the full CAP archive.','https://case.law/',true),
 ('courtlistener','CourtListener','Not connected. No CourtListener search requests are made by this version.','https://www.courtlistener.com/',false);
alter table defense.research_databases enable row level security;
grant all on defense.research_databases to service_role;
alter table defense.cases add column database_id text not null default 'cap'
 references defense.research_databases(id);
create index cases_database on defense.cases(database_id);
