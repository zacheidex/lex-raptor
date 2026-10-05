import os

os.environ.setdefault(
    "DATABASE_URL", "postgresql://postgres:local-test-only@127.0.0.1:55432/defense_test"
)
os.environ.setdefault("APP_ORIGIN", "http://localhost:3000")
from pathlib import Path
from uuid import uuid4

import pytest
from defense import auth, db
from defense.api import app
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def database():
    # Refuse destructive test setup against any database not explicitly named test.
    if "/defense_test" not in os.environ["DATABASE_URL"]:
        raise RuntimeError("Tests require the dedicated defense_test database")
    with db.connect() as c:
        c.execute("""do $$ begin
          if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
          if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
          end $$;
          create schema if not exists auth;
          create or replace function auth.uid() returns uuid language sql stable as
          'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
          create schema if not exists storage;
          create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
          drop schema if exists defense cascade;
        """)
        for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            c.execute(migration.read_text())


@pytest.fixture
def tenant():
    with db.connect() as c:
        c.execute(
            "truncate defense.calls,defense.audit,defense.reviewed_facts,defense.drafts,defense.jobs,defense.documents,defense.matters,defense.templates,defense.memberships,defense.organizations,defense.budgets,defense.prices,defense.rate_limits cascade"
        )
        c.execute(
            "update defense.paid_settings set enabled=true,circuit_open=false,failure_count=0,model_id='test-model',max_input_tokens=200000,max_output_tokens=16000,max_calls=4"
        )
        org, user, other_org, other_user, matter, job = map(lambda _: uuid4(), range(6))
        c.execute(
            "insert into defense.organizations(id,name) values(%s,'Synthetic A'),(%s,'Synthetic B')",
            (org, other_org),
        )
        c.execute(
            "insert into defense.memberships(user_id,org_id,email,role) values(%s,%s,'admin@example.test','admin'),(%s,%s,'other@example.test','reviewer')",
            (user, org, other_user, other_org),
        )
        c.execute(
            "insert into defense.matters(id,org_id,title,represented_party,created_by,synthetic) values(%s,%s,'SYNTHETIC test','Example Inc',%s,true)",
            (matter, org, user),
        )
        c.execute(
            "insert into defense.jobs(id,org_id,matter_id,user_id,kind,payload,idempotency_key) values(%s,%s,%s,%s,'draft','{}','fixture-job')",
            (job, org, matter, user),
        )
        c.execute(
            "insert into defense.prices(model_id,provider,input_micro_per_million,output_micro_per_million,context_limit,verified_at,source_url,enabled) values('test-model','openai',1000000,2000000,300000,now(),'https://example.test/fixture-only',true)"
        )
        for scope in [
            "global",
            f"org:{org}",
            f"user:{user}",
            f"org:{other_org}",
            f"user:{other_user}",
        ]:
            c.execute(
                "insert into defense.budgets(scope,cap_micro) values(%s,1000000)",
                (scope,),
            )
    return {
        k: str(v)
        for k, v in locals().copy().items()
        if k in ["org", "user", "other_org", "other_user", "matter", "job"]
    }


@pytest.fixture
def client(tenant, monkeypatch):
    def fake_user(token):
        if token not in [tenant["user"], tenant["other_user"]]:
            from fastapi import HTTPException

            raise HTTPException(401, "Invalid test session")
        return {"id": token}

    monkeypatch.setattr(auth, "get_supabase_user", fake_user)
    with TestClient(app, headers={"Origin": "http://localhost:3000"}) as c:
        yield c
