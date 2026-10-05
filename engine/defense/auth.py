import hashlib
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Request

from . import db
from .settings import settings


@dataclass
class Identity:
    user_id: str
    org_id: str
    role: str
    email: str


def limit(key, ceiling=30):
    # Durable server-side fixed windows, shared across replicas.
    with db.connect() as c:
        row = c.execute(
            """insert into defense.rate_limits(key,count) values(%s,1)
        on conflict(key) do update set count=case when defense.rate_limits.window_start < now()-interval '1 minute' then 1 else defense.rate_limits.count+1 end,
        window_start=case when defense.rate_limits.window_start < now()-interval '1 minute' then now() else defense.rate_limits.window_start end returning count""",
            (key,),
        ).fetchone()
    if row["count"] > ceiling:
        raise HTTPException(429, "Rate limit reached. Try again in a minute.")


def get_supabase_user(token):
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(503, "Authentication is not configured.")
    try:
        r = httpx.get(
            settings.supabase_url + "/auth/v1/user",
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": "Bearer " + token,
            },
            timeout=10,
        )
        if r.status_code != 200:
            raise HTTPException(401, "Sign in again.")
        return r.json()
    except httpx.HTTPError:
        raise HTTPException(503, "Authentication unavailable.") from None


def loopback_url(value):
    try:
        url = urlsplit(value)
        return (
            url.scheme == "http"
            and url.hostname in {"localhost", "127.0.0.1", "::1"}
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and url.path in {"", "/"}
        )
    except ValueError:
        return False


def local_identity(request: Request):
    if settings.inference_mode != "local" or not loopback_url(settings.origin):
        raise HTTPException(
            503, "Account-free mode requires local inference and a loopback app URL."
        )
    # Host checks cover DNS rebinding; only the native loopback listener is supported.
    # Forwarded headers may restrict access, never grant it.
    hosts = [request.headers.get("host", "")]
    if request.headers.get("x-forwarded-host"):
        hosts.append(request.headers["x-forwarded-host"])
    if (
        not request.client
        or request.client.host not in {"127.0.0.1", "::1"}
        or not all(loopback_url("http://" + host) for host in hosts)
        or request.headers.get("sec-fetch-site") == "cross-site"
        or (
            request.headers.get("origin")
            and request.headers["origin"] != settings.origin
        )
    ):
        raise HTTPException(
            403, "This local workspace is only available on this computer."
        )
    row = db.one(
        "select m.* from defense.local_workspace w join defense.memberships m on m.user_id=w.user_id where w.id=true and m.active and m.role='admin'"
    )
    if not row:
        raise HTTPException(
            503, "Initialize the local workspace with scripts/local_setup.py."
        )
    return Identity(str(row["user_id"]), str(row["org_id"]), row["role"], row["email"])


def identity(request: Request):
    if settings.auth_mode == "local":
        return local_identity(request)
    if settings.auth_mode != "account":
        raise HTTPException(503, "Unknown workspace access mode.")
    token = request.cookies.get("defense_access")
    if not token:
        raise HTTPException(401, "Sign in required.")
    user = get_supabase_user(token)
    row = db.one(
        "select * from defense.memberships where user_id=%s and active", (user["id"],)
    )
    if not row:
        raise HTTPException(403, "Active invitation required.")
    return Identity(str(row["user_id"]), str(row["org_id"]), row["role"], row["email"])


def admin(user):
    if user.role != "admin":
        raise HTTPException(403, "Administrator role required.")


def matter(user, matter_id):
    row = db.one(
        "select * from defense.matters where id=%s and org_id=%s and deleted_at is null",
        (matter_id, user.org_id),
    )
    if not row:
        raise HTTPException(404, "Matter not found.")
    return row


def audit(user, event, resource_id=None, details=None):
    db.execute(
        "insert into defense.audit(user_id,org_id,event,resource_id,details) values(%s,%s,%s,%s,%s)",
        (
            user.user_id,
            user.org_id,
            event,
            str(resource_id) if resource_id else None,
            db.Jsonb(details or {}),
        ),
    )


def email_key(email):
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()
