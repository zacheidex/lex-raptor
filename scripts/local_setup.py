"""Bootstrap only the isolated local Supabase project; never creates external accounts."""

import json
import argparse
import secrets
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
(ROOT / "data").mkdir(exist_ok=True)
load_dotenv(ROOT / ".env.local", override=True)
from defense import db  # noqa: E402 — load local environment before settings
from defense.settings import settings  # noqa: E402

assert settings.supabase_url == "http://127.0.0.1:54321", "This helper is local-only"
from defense.cli import migrate  # noqa: E402

migrate()
if settings.auth_mode == "local":
    from defense.local_workspace import initialize

    parser = argparse.ArgumentParser(
        description="Initialize an account-free local workspace"
    )
    parser.add_argument(
        "--existing-user-id", help="Preserve a selected existing owner's workspace"
    )
    args = parser.parse_args()
    existing = args.existing_user_id
    prior = ROOT / "data/local-admin.json"
    if not existing and prior.exists():
        existing = json.loads(prior.read_text())["user_id"]
    initialize(existing)
    print(
        "Local workspace ready. Open http://localhost:3000; no account or password required."
    )
    raise SystemExit(0)
if not db.one("select 1 from defense.memberships where role='admin'"):
    password = secrets.token_urlsafe(24)
    email = "owner@lexraptor.local"
    r = httpx.post(
        settings.supabase_url + "/auth/v1/admin/users",
        headers={
            "apikey": settings.supabase_service_key,
            "Authorization": "Bearer " + settings.supabase_service_key,
        },
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    if r.status_code not in (200, 201):
        raise RuntimeError("Local auth bootstrap failed: " + str(r.status_code))
    user = r.json()
    uid = user.get("id") or user["user"]["id"]
    with db.connect() as c:
        org = c.execute(
            "insert into defense.organizations(name) values('Lex Raptor local workspace') returning id"
        ).fetchone()["id"]
        c.execute(
            "insert into defense.memberships(user_id,org_id,email,role) values(%s,%s,%s,'admin')",
            (uid, org, email),
        )
        for scope in ["global", f"org:{org}", f"user:{uid}"]:
            c.execute(
                "insert into defense.budgets(scope,cap_micro) values(%s,100000000) on conflict(scope) do update set cap_micro=100000000",
                (scope,),
            )
        c.execute(
            "update defense.paid_settings set enabled=false,max_input_tokens=900000 where id=true"
        )
    p = ROOT / "data/local-admin.json"
    p.write_text(
        json.dumps(
            {
                "email": email,
                "password": password,
                "user_id": uid,
                "org_id": str(org),
                "url": "http://localhost:3000",
                "local_only": True,
            },
            indent=2,
        )
    )
    p.chmod(0o600)
    print(
        "Private local administrator credentials saved to data/local-admin.json. Paid calls disabled; global cap $100."
    )
else:
    print("Local administrator already bootstrapped; credentials left unchanged.")
