import json
from hashlib import sha256
from typing import Annotated, Literal
from uuid import UUID, uuid4
from urllib.parse import quote

import httpx
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import auth, db, research
from .engine import export_artifact, validate_sources
from .ingest import search
from .models import WORKFLOWS, Claim, Draft
from .settings import settings
from .storage import storage

app = FastAPI(title="Lex Raptor", docs_url=None, redoc_url=None, openapi_url=None)
User = Annotated[auth.Identity, Depends(auth.identity)]


@app.middleware("http")
async def boundary(request: Request, call_next):
    if settings.auth_mode == "local" and (
        request.url.path.startswith("/api/auth/")
        or request.url.path.startswith("/api/admin/")
    ):
        return JSONResponse(
            {"detail": "Accounts and invitations are disabled in local mode."},
            status_code=409,
        )
    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.headers.get("origin") != settings.origin
    ):
        return JSONResponse({"detail": "Origin rejected."}, status_code=403)
    length = request.headers.get("content-length")
    if length and (
        not length.isdigit() or int(length) > settings.max_file_bytes + 100000
    ):
        return JSONResponse({"detail": "Request size limit."}, status_code=413)
    if request.method in {"POST", "PUT", "PATCH"}:
        body = bytearray()
        maximum = (
            settings.max_file_bytes + 100000
            if request.url.path.endswith("/documents")
            else 2_000_000
        )
        async for piece in request.stream():
            body.extend(piece)
            if len(body) > maximum:
                return JSONResponse({"detail": "Request size limit."}, status_code=413)
        request._body = bytes(body)
    try:
        r = await call_next(request)
    except Exception:
        # Bodies, provider errors and secrets never enter browser responses/logs.
        return JSONResponse(
            {"detail": "Service unavailable; operation not completed."}, status_code=503
        )
    r.headers.update(
        {
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        }
    )
    return r


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Body):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


def cookies(response, data):
    for label, key in [("access", "access_token"), ("refresh", "refresh_token")]:
        response.set_cookie(
            "defense_" + label,
            data[key],
            httponly=True,
            secure=settings.origin.startswith("https://"),
            samesite="strict",
            max_age=3600 if label == "access" else 604800,
            path="/api",
        )


@app.get("/api/health")
def health():
    try:
        db.one("select 1")
        return {
            "status": "ok",
            "auth_mode": settings.auth_mode,
            "auth_configured": bool(
                settings.supabase_url and settings.supabase_anon_key
            ),
        }
    except Exception:
        return JSONResponse({"status": "database_not_configured"}, status_code=503)


@app.post("/api/auth/login")
def login(data: Login, request: Request, response: Response):
    auth.limit("login:" + auth.email_key(data.email), 8)
    auth.limit("login:global", 100)
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(
            503, "Authentication setup is required. See the admin guide."
        )
    r = httpx.post(
        settings.supabase_url + "/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_anon_key},
        json=data.model_dump(),
        timeout=15,
    )
    if r.status_code != 200:
        raise HTTPException(401, "Sign-in failed.")
    result = r.json()
    member = db.one(
        "select * from defense.memberships where user_id=%s and active",
        (result["user"]["id"],),
    )
    if not member:
        raise HTTPException(403, "Active invitation required.")
    cookies(response, result)
    return {"signed_in": True}


@app.post("/api/auth/refresh")
def refresh(request: Request, response: Response):
    token = request.cookies.get("defense_refresh")
    if not token:
        raise HTTPException(401, "Sign in required.")
    auth.limit("refresh:" + sha256(token.encode()).hexdigest(), 5)
    r = httpx.post(
        settings.supabase_url + "/auth/v1/token?grant_type=refresh_token",
        headers={"apikey": settings.supabase_anon_key},
        json={"refresh_token": token},
        timeout=15,
    )
    if r.status_code != 200:
        raise HTTPException(401, "Sign in again.")
    result = r.json()
    if not db.one(
        "select 1 from defense.memberships where user_id=%s and active",
        (result["user"]["id"],),
    ):
        raise HTTPException(403, "Membership revoked.")
    cookies(response, result)
    return {"signed_in": True}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("defense_access")
    if token and settings.supabase_url:
        httpx.post(
            settings.supabase_url + "/auth/v1/logout",
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": "Bearer " + token,
            },
            timeout=10,
        )
    response.delete_cookie("defense_access", path="/api")
    response.delete_cookie("defense_refresh", path="/api")
    return {"signed_out": True}


class Accept(Body):
    access_token: str = Field(max_length=10000)
    refresh_token: str = Field(max_length=10000)
    password: str = Field(min_length=12, max_length=200)


@app.post("/api/auth/accept")
def accept(data: Accept, response: Response):
    auth.limit("accept:global", 30)
    user = auth.get_supabase_user(data.access_token)
    if not db.one(
        "select 1 from defense.memberships where user_id=%s and active", (user["id"],)
    ):
        raise HTTPException(403, "Active invitation required.")
    r = httpx.put(
        settings.supabase_url + "/auth/v1/user",
        headers={
            "apikey": settings.supabase_anon_key,
            "Authorization": "Bearer " + data.access_token,
        },
        json={"password": data.password},
        timeout=15,
    )
    r.raise_for_status()
    cookies(response, data.model_dump())
    return {"signed_in": True}


@app.get("/api/me")
def me(user: User):
    scopes = ["global", f"org:{user.org_id}", f"user:{user.user_id}"]
    rows = db.many("select * from defense.budgets where scope=any(%s)", (scopes,))
    remaining = (
        min(
            (r["cap_micro"] - r["spent_micro"] - r["held_micro"] for r in rows),
            default=0,
        )
        if len(rows) == 3
        else 0
    )
    cfg = db.one(
        "select enabled,circuit_open,model_id from defense.paid_settings where id=true"
    )
    return {
        "email": user.email,
        "role": user.role,
        "remaining_micro": remaining,
        "paid_enabled": cfg["enabled"] and not cfg["circuit_open"],
        "model": settings.local_model
        if settings.inference_mode == "local"
        else cfg["model_id"],
        "inference_mode": settings.inference_mode,
        "auth_mode": settings.auth_mode,
        "generation_enabled": settings.inference_mode == "local"
        or (cfg["enabled"] and not cfg["circuit_open"]),
    }


class NewMatter(Body):
    title: str = Field(min_length=1, max_length=200)
    represented_party: str = Field(min_length=1, max_length=200)
    synthetic: bool = False


@app.get("/api/matters")
def matters(user: User):
    return db.many(
        "select * from defense.matters where org_id=%s and deleted_at is null and workspace_kind='matter' order by created_at desc",
        (user.org_id,),
    )


@app.post("/api/matters")
def new_matter(data: NewMatter, user: User):
    auth.limit("matter:" + user.user_id, 10)
    row = db.one(
        "insert into defense.matters(org_id,title,represented_party,synthetic,created_by) values(%s,%s,%s,%s,%s) returning *",
        (user.org_id, data.title, data.represented_party, data.synthetic, user.user_id),
    )
    auth.audit(user, "matter_created", row["id"])
    return row


@app.get("/api/matters/{matter_id}")
def detail(matter_id: UUID, user: User):
    m = auth.matter(user, matter_id)
    docs = db.many(
        "select id,name,sha256,status,error_code,warnings,active,extraction_version from defense.documents where matter_id=%s and org_id=%s order by created_at",
        (matter_id, user.org_id),
    )
    jobs = db.many(
        "select id,kind,state,error_code,cancel_requested,created_at from defense.jobs where matter_id=%s and org_id=%s order by created_at desc limit 30",
        (matter_id, user.org_id),
    )
    draft = db.one(
        "select * from defense.drafts where matter_id=%s and org_id=%s order by created_at desc,revision desc limit 1",
        (matter_id, user.org_id),
    )
    facts = db.one(
        "select content,source_hashes from defense.fact_sets where matter_id=%s and org_id=%s order by created_at desc limit 1",
        (matter_id, user.org_id),
    )
    if facts and sorted(facts["source_hashes"]) != sorted(
        d["sha256"] for d in docs if d["active"]
    ):
        facts = None
    return {
        "matter": m,
        "documents": docs,
        "jobs": jobs,
        "draft": draft,
        "fact_table": facts["content"] if facts else None,
        "workflows": list(WORKFLOWS)[:6],
    }


@app.post("/api/matters/{matter_id}/documents")
async def upload(
    matter_id: UUID,
    user: User,
    file: UploadFile = File(),
    supersedes: str | None = Form(None),
):
    auth.matter(user, matter_id)
    auth.limit("upload:" + user.user_id, 30)
    raw = await file.read(settings.max_file_bytes + 1)
    if len(raw) > settings.max_file_bytes:
        raise HTTPException(413, "File exceeds 20 MB.")
    name = (file.filename or "unnamed").replace("\\", "/").split("/")[-1][:200]
    digest = sha256(raw).hexdigest()
    with db.connect() as c:
        c.execute("select id from defense.matters where id=%s for update", (matter_id,))
        count = c.execute(
            "select count(*) as n from defense.documents where matter_id=%s",
            (matter_id,),
        ).fetchone()["n"]
        if count >= settings.max_files:
            raise HTTPException(409, "Matter file limit reached.")
        duplicate = c.execute(
            "select id from defense.documents where matter_id=%s and sha256=%s and active",
            (matter_id, digest),
        ).fetchone()
        if duplicate:
            return {
                "id": duplicate["id"],
                "duplicate": True,
                "message": "Identical file already exists.",
            }
        warnings = []
        if c.execute(
            "select id from defense.documents where matter_id=%s and name=%s and active",
            (matter_id, name),
        ).fetchone():
            warnings.append(
                "Same filename with different content: compare versions for conflicting records."
            )
        if supersedes:
            old = c.execute(
                "select id from defense.documents where id=%s and matter_id=%s and org_id=%s and active",
                (UUID(supersedes), matter_id, user.org_id),
            ).fetchone()
            if not old:
                raise HTTPException(404, "Replaced document not found.")
        did = uuid4()
        key = f"{user.org_id}/{matter_id}/{did}/original"
        # Persist intent before uploading; a failed storage upload remains visible.
        c.execute(
            "insert into defense.documents(id,org_id,matter_id,name,sha256,object_key,size_bytes,status,warnings,supersedes) values(%s,%s,%s,%s,%s,%s,%s,'uploading',%s,%s)",
            (
                did,
                user.org_id,
                matter_id,
                name,
                digest,
                key,
                len(raw),
                db.Jsonb(warnings),
                supersedes,
            ),
        )
    try:
        storage.put(key, raw)
    except Exception:
        db.execute(
            "update defense.documents set status='failed',error_code='storage_upload_failed' where id=%s",
            (did,),
        )
        raise HTTPException(503, "Upload failed; visible in file manifest.") from None
    with db.connect() as c:
        if supersedes:
            c.execute(
                "update defense.documents set active=false where id=%s", (supersedes,)
            )
            c.execute(
                "update defense.drafts set review_state='stale' where matter_id=%s",
                (matter_id,),
            )
        c.execute("update defense.documents set status='queued' where id=%s", (did,))
        c.execute(
            "insert into defense.jobs(org_id,matter_id,user_id,kind,payload,idempotency_key) values(%s,%s,%s,'ingest',%s,%s)",
            (
                user.org_id,
                matter_id,
                user.user_id,
                db.Jsonb({"document_id": str(did)}),
                "ingest:" + str(did),
            ),
        )
    auth.audit(user, "document_uploaded", did)
    return {"id": did, "status": "queued", "warnings": warnings}


def authorized_document(user, document_id):
    row = db.one(
        "select * from defense.documents where id=%s and org_id=%s",
        (document_id, user.org_id),
    )
    if not row:
        raise HTTPException(404, "Document not found.")
    auth.matter(user, row["matter_id"])
    return row


@app.get("/api/documents/{document_id}/source")
def source(document_id: UUID, user: User):
    row = authorized_document(user, document_id)
    return {
        k: row[k]
        for k in [
            "id",
            "name",
            "sha256",
            "extraction_version",
            "chunks",
            "warnings",
            "status",
            "active",
        ]
    }


@app.get("/api/documents/{document_id}/download")
def download(document_id: UUID, user: User):
    row = authorized_document(user, document_id)
    auth.audit(user, "original_download", document_id)
    return Response(
        storage.get(row["object_key"]),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''"
            + quote(row["name"], safe="")
        },
    )


@app.get("/api/matters/{matter_id}/evidence")
def evidence(matter_id: UUID, user: User, q: str = Query(default="", max_length=500)):
    auth.matter(user, matter_id)
    docs = db.many(
        "select chunks from defense.documents where matter_id=%s and org_id=%s and active",
        (matter_id, user.org_id),
    )
    chunks = [c for d in docs for c in d["chunks"]]
    return {
        "passages": search(chunks, q, 100) if q else chunks[:100],
        "total_passages": len(chunks),
        "limited_to": 100,
        "reviewed_facts": db.many(
            "select * from defense.reviewed_facts where matter_id=%s and org_id=%s",
            (matter_id, user.org_id),
        ),
    }


class NewJob(Body):
    workflow: str
    instructions: str = Field(min_length=5, max_length=12000)
    idempotency_key: str = Field(min_length=10, max_length=100)
    template_id: UUID | None = None
    acknowledge_warnings: bool = False
    facts_only: bool = False


@app.post("/api/matters/{matter_id}/generate")
def create_job(matter_id: UUID, data: NewJob, user: User):
    auth.matter(user, matter_id)
    auth.limit("generate:" + user.user_id, 5)
    if data.workflow not in list(WORKFLOWS)[:6]:
        raise HTTPException(422, "Workflow unavailable in this workspace.")
    old = db.one(
        "select * from defense.jobs where user_id=%s and idempotency_key=%s",
        (user.user_id, data.idempotency_key),
    )
    if old:
        if str(old["matter_id"]) != str(matter_id) or old["payload"] != json.loads(
            data.model_dump_json(exclude={"idempotency_key"})
        ):
            raise HTTPException(
                409, "Idempotency key already used for different input."
            )
        return {"id": old["id"], "state": old["state"]}
    cfg = db.one("select * from defense.paid_settings where id=true")
    if settings.inference_mode != "local" and (
        not cfg["enabled"] or cfg["circuit_open"]
    ):
        raise HTTPException(409, "Paid generation is disabled by the administrator.")
    docs = db.many(
        "select status,warnings from defense.documents where matter_id=%s and active",
        (matter_id,),
    )
    if not docs or any(d["status"] != "ready" for d in docs):
        raise HTTPException(
            409,
            "Every active file must finish parsing successfully. Resolve failed/OCR-needed files first.",
        )
    if any(d["warnings"] for d in docs) and not data.acknowledge_warnings:
        raise HTTPException(
            409, "Review and acknowledge the extraction warnings first."
        )
    if data.template_id and not db.one(
        "select id from defense.templates where id=%s and org_id=%s",
        (data.template_id, user.org_id),
    ):
        raise HTTPException(404, "Template not found.")
    row = db.one(
        """insert into defense.jobs(org_id,matter_id,user_id,kind,payload,idempotency_key)
       values(%s,%s,%s,'draft',%s,%s) on conflict(user_id,idempotency_key) do nothing returning id,state""",
        (
            user.org_id,
            matter_id,
            user.user_id,
            db.Jsonb(json.loads(data.model_dump_json(exclude={"idempotency_key"}))),
            data.idempotency_key,
        ),
    )
    if not row:
        raise HTTPException(409, "Submission already queued.")
    auth.audit(user, "draft_queued", row["id"])
    return row


@app.get("/api/jobs/{job_id}")
def job_status(job_id: UUID, user: User):
    row = db.one(
        "select id,org_id,matter_id,state,error_code,cancel_requested from defense.jobs where id=%s and org_id=%s",
        (job_id, user.org_id),
    )
    if not row:
        raise HTTPException(404, "Job not found.")
    auth.matter(user, row["matter_id"])
    return row


@app.post("/api/jobs/{job_id}/cancel")
def cancel(job_id: UUID, user: User):
    job_status(job_id, user)
    db.execute(
        "update defense.jobs set cancel_requested=true,state=case when state='queued' then 'cancelled' else state end where id=%s",
        (job_id,),
    )
    return {
        "cancel_requested": True,
        "note": "An in-flight billed call may finish; its reservation is retained.",
    }


class Edit(Body):
    content: Draft
    expected_revision: int


def get_draft(user, draft_id):
    draft = db.one(
        "select * from defense.drafts where id=%s and org_id=%s",
        (draft_id, user.org_id),
    )
    if not draft:
        raise HTTPException(404, "Draft not found.")
    auth.matter(user, draft["matter_id"])
    docs = db.many(
        "select sha256,chunks from defense.documents where matter_id=%s and active",
        (draft["matter_id"],),
    )
    if sorted(draft["source_hashes"]) != sorted(d["sha256"] for d in docs):
        raise HTTPException(409, "Sources changed; regenerate to refresh citations.")
    return draft, [c for d in docs for c in d["chunks"]]


@app.put("/api/drafts/{draft_id}")
def edit(draft_id: UUID, data: Edit, user: User):
    prior, chunks = get_draft(user, draft_id)
    validate_sources(data.content, chunks)
    with db.connect() as c:
        c.execute(
            "select id from defense.jobs where id=%s for update", (prior["job_id"],)
        )
        latest = c.execute(
            "select max(revision) as r from defense.drafts where job_id=%s",
            (prior["job_id"],),
        ).fetchone()["r"]
        if data.expected_revision != latest or prior["revision"] != latest:
            raise HTTPException(409, "A newer revision exists; reload before editing.")
        row = c.execute(
            """insert into defense.drafts(org_id,matter_id,job_id,revision,content,source_hashes,trace,created_by)
           values(%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
            (
                user.org_id,
                prior["matter_id"],
                prior["job_id"],
                latest + 1,
                db.Jsonb(data.content.model_dump()),
                db.Jsonb(prior["source_hashes"]),
                db.Jsonb(prior["trace"]),
                user.user_id,
            ),
        ).fetchone()
    auth.audit(user, "draft_edited", row["id"])
    return row


class Review(Body):
    attorney_confirmation: bool


@app.post("/api/drafts/{draft_id}/review")
def review(draft_id: UUID, data: Review, user: User):
    draft, chunks = get_draft(user, draft_id)
    if not data.attorney_confirmation:
        raise HTTPException(422, "Attorney confirmation is required.")
    content = Draft.model_validate(draft["content"])
    findings = validate_sources(content, chunks)
    if findings:
        raise HTTPException(
            409, "Correct invalid source citations before marking reviewed."
        )
    db.execute(
        "update defense.drafts set review_state='reviewed',reviewed_by=%s,reviewed_at=now() where id=%s",
        (user.user_id, draft_id),
    )
    auth.audit(user, "attorney_review_recorded", draft_id)
    return {"review_state": "reviewed"}


@app.get("/api/drafts/{draft_id}/export/{filename}")
def export(draft_id: UUID, filename: str, user: User):
    draft, chunks = get_draft(user, draft_id)
    if draft["review_state"] != "reviewed":
        raise HTTPException(409, "Mark the draft reviewed before export.")
    content = Draft.model_validate(draft["content"])
    artifact = next((a for a in content.artifacts if a.filename == filename), None)
    if artifact is None:
        raise HTTPException(404, "Artifact not found.")
    raw = export_artifact(artifact, chunks, "reviewed")
    auth.audit(user, "draft_exported", draft_id)
    return Response(
        raw,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{artifact.filename}"'},
    )


class FactInput(Body):
    fact: Claim


@app.post("/api/matters/{matter_id}/facts")
def save_fact(matter_id: UUID, data: FactInput, user: User):
    auth.matter(user, matter_id)
    docs = db.many(
        "select sha256,chunks from defense.documents where matter_id=%s and active",
        (matter_id,),
    )
    index = {c["id"]: c for d in docs for c in d["chunks"]}
    if (
        data.fact.kind != "documented_fact"
        or not data.fact.citations
        or any(
            c.chunk_id not in index
            or not c.quote
            or c.quote not in index[c.chunk_id]["text"]
            for c in data.fact.citations
        )
    ):
        raise HTTPException(422, "Reviewed facts require valid source quotations.")
    row = db.one(
        "insert into defense.reviewed_facts(org_id,matter_id,statement,citations,source_hashes,reviewed_by) values(%s,%s,%s,%s,%s,%s) returning id",
        (
            user.org_id,
            matter_id,
            data.fact.text,
            db.Jsonb([c.model_dump() for c in data.fact.citations]),
            db.Jsonb([d["sha256"] for d in docs]),
            user.user_id,
        ),
    )
    return row


@app.delete("/api/matters/{matter_id}")
def delete_matter(matter_id: UUID, user: User):
    auth.admin(user)
    auth.matter(user, matter_id)
    with db.connect() as c:
        c.execute(
            "update defense.matters set deleted_at=now() where id=%s", (matter_id,)
        )
        c.execute(
            "update defense.jobs set cancel_requested=true where matter_id=%s",
            (matter_id,),
        )
    keys = [
        d["object_key"]
        for d in db.many(
            "select object_key from defense.documents where matter_id=%s", (matter_id,)
        )
    ]
    try:
        storage.delete(keys)
    except Exception:
        auth.audit(user, "matter_deletion_storage_pending", matter_id)
        raise HTTPException(
            503,
            "Access revoked. Storage purge pending; administrator must retry via CLI.",
        ) from None
    purge_matter(matter_id)
    auth.audit(user, "matter_deleted", matter_id)
    return {
        "deleted": True,
        "retention": "Provider retention and infrastructure backups expire under their configured policies. Metadata and cost ledger retained.",
    }


def purge_matter(matter_id):
    with db.connect() as c:
        c.execute("delete from defense.research_runs where matter_id=%s", (matter_id,))
        c.execute("delete from defense.fact_sets where matter_id=%s", (matter_id,))
        c.execute("delete from defense.reviewed_facts where matter_id=%s", (matter_id,))
        c.execute("delete from defense.drafts where matter_id=%s", (matter_id,))
        c.execute(
            "update defense.calls set response=null where job_id in (select id from defense.jobs where matter_id=%s)",
            (matter_id,),
        )
        c.execute(
            "update defense.jobs set payload='{}' where matter_id=%s", (matter_id,)
        )
        c.execute("delete from defense.documents where matter_id=%s", (matter_id,))
        c.execute(
            "update defense.matters set title='Deleted matter',represented_party='Deleted' where id=%s",
            (matter_id,),
        )


@app.get("/api/admin/settings")
def admin_settings(user: User):
    auth.admin(user)
    return {
        "paid": db.one(
            "select enabled,circuit_open,model_id,reasoning,max_input_tokens,max_output_tokens,max_calls from defense.paid_settings where id=true"
        ),
        "budgets": db.many(
            "select * from defense.budgets where scope=%s or scope in (select 'user:'||user_id from defense.memberships where org_id=%s)",
            (f"org:{user.org_id}", user.org_id),
        ),
        "members": db.many(
            "select user_id,email,role,active from defense.memberships where org_id=%s",
            (user.org_id,),
        ),
    }


@app.post("/api/admin/disable-paid")
def disable(user: User):
    auth.admin(user)
    db.execute("update defense.paid_settings set enabled=false where id=true")
    auth.audit(user, "paid_kill_switch")
    return {"enabled": False}


class Invite(Body):
    email: str = Field(
        min_length=5, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    )
    role: Literal["admin", "reviewer"] = "reviewer"


@app.post("/api/admin/invitations")
def invite(data: Invite, user: User):
    auth.admin(user)
    auth.limit("invite:" + user.user_id, 5)
    # generate_link creates a link but sends no email.
    r = httpx.post(
        settings.supabase_url + "/auth/v1/admin/generate_link",
        headers={
            "apikey": settings.supabase_service_key,
            "Authorization": "Bearer " + settings.supabase_service_key,
        },
        json={"type": "invite", "email": data.email, "redirect_to": settings.origin},
        timeout=15,
    )
    if r.status_code != 200:
        raise HTTPException(409, "Invitation could not be created.")
    value = r.json()
    uid = value.get("id") or value.get("user", {}).get("id")
    if not uid:
        raise HTTPException(503, "Invitation response missing identity.")
    with db.connect() as c:
        existing = c.execute(
            "select * from defense.memberships where user_id=%s", (uid,)
        ).fetchone()
        if existing and str(existing["org_id"]) != user.org_id:
            raise HTTPException(409, "User belongs to another organization.")
        c.execute(
            "insert into defense.memberships(user_id,org_id,email,role) values(%s,%s,%s,%s) on conflict(user_id) do nothing",
            (uid, user.org_id, data.email, data.role),
        )
        c.execute(
            "insert into defense.budgets(scope,cap_micro) values(%s,0) on conflict do nothing",
            ("user:" + uid,),
        )
    auth.audit(user, "invitation_link_created", uid)
    return {
        "action_link": value.get("action_link")
        or value.get("properties", {}).get("action_link"),
        "email_sent": False,
    }


@app.post("/api/admin/members/{user_id}/revoke")
def revoke(user_id: UUID, user: User):
    auth.admin(user)
    if str(user_id) == user.user_id:
        raise HTTPException(
            409, "Use another administrator to revoke your own membership."
        )
    row = db.one(
        "update defense.memberships set active=false where user_id=%s and org_id=%s returning user_id",
        (user_id, user.org_id),
    )
    if not row:
        raise HTTPException(404, "Member not found.")
    auth.audit(user, "membership_revoked", user_id)
    return {"revoked": True}


class Template(Body):
    name: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=20000)


@app.get("/api/templates")
def templates(user: User):
    return db.many(
        "select id,name,version,sha256 from defense.templates where org_id=%s order by name,version desc",
        (user.org_id,),
    )


@app.post("/api/admin/templates")
def template(data: Template, user: User):
    auth.admin(user)
    with db.connect() as c:
        c.execute(
            "select id from defense.organizations where id=%s for update",
            (user.org_id,),
        )
        row = c.execute(
            "insert into defense.templates(org_id,name,body,sha256,version) select %s,%s,%s,%s,coalesce(max(version),0)+1 from defense.templates where org_id=%s and name=%s returning id,version",
            (
                user.org_id,
                data.name,
                data.body,
                sha256(data.body.encode()).hexdigest(),
                user.org_id,
                data.name,
            ),
        ).fetchone()
    auth.audit(user, "template_version_created", row["id"])
    return row


@app.get("/api/runtime")
def runtime(user: User):
    from .local_provider import local_info

    if settings.inference_mode == "local":
        try:
            info = local_info()
            return {
                **info,
                "mode": "local",
                "ready": True,
                "provider_cost_usd": 0,
                "service_fee_usd": 0,
            }
        except Exception:
            return {
                "mode": "local",
                "model": settings.local_model,
                "ready": False,
                "detail": "Start Ollama and install the configured model. No paid fallback.",
            }
    cfg = db.one(
        "select enabled,circuit_open,model_id from defense.paid_settings where id=true"
    )
    return {
        "mode": "api",
        "model": cfg["model_id"],
        "ready": cfg["enabled"] and not cfg["circuit_open"],
        "managed_billing_enabled": False,
    }


@app.get("/api/library")
def library(user: User):
    return research.coverage()


@app.get("/api/research/search")
def research_search(
    user: User,
    q: str = Query(min_length=1, max_length=1200),
    court: str | None = Query(default=None, max_length=200),
    after: str | None = None,
    before: str | None = None,
    database_ids: list[str] | None = Query(default=None, max_length=20),
):
    from datetime import date

    try:
        start, end = (
            date.fromisoformat(after) if after else None,
            date.fromisoformat(before) if before else None,
        )
        if start and end and start > end:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Use valid dates in chronological order.") from None
    auth.limit("research-search:" + user.user_id, 40)
    try:
        selected = research.select_databases(database_ids)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return {
        "passages": research.search_cases(
            q, court or None, start, end, database_ids=selected
        ),
        "coverage": research.coverage(selected),
        "searched_databases": [d for d in research.databases() if d["id"] in selected],
    }


@app.get("/api/library/cases/{case_id}")
def case_detail(case_id: str, user: User):
    row = db.one("select * from defense.cases where id=%s", (case_id,))
    if not row:
        raise HTTPException(404, "Opinion not in this library.")
    return {
        **row,
        "passages": db.many(
            "select id,locator,opinion_type,text from defense.case_passages where case_id=%s order by ordinal",
            (case_id,),
        ),
        "treatment": "Not checked",
    }


class ResearchRequest(Body):
    query: str = Field(min_length=5, max_length=1200)
    court: str | None = Field(default=None, max_length=200)
    after: str | None = Field(default=None, max_length=10)
    before: str | None = Field(default=None, max_length=10)
    database_ids: list[str] | None = Field(default=None, min_length=1, max_length=20)
    idempotency_key: str = Field(min_length=10, max_length=100)


@app.post("/api/research/ask")
def research_ask(data: ResearchRequest, user: User):
    from datetime import date

    try:
        start, end = (
            date.fromisoformat(data.after) if data.after else None,
            date.fromisoformat(data.before) if data.before else None,
        )
        if start and end and start > end:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Use valid dates in chronological order.") from None
    filters = {
        "court": data.court or None,
        "after": str(start) if start else None,
        "before": str(end) if end else None,
    }
    try:
        filters["database_ids"] = research.select_databases(data.database_ids)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    payload = {
        "query": data.query,
        "filters": filters,
        "inference_mode": settings.inference_mode,
    }
    with db.connect() as c:
        old = c.execute(
            "select id,state,payload from defense.jobs where user_id=%s and idempotency_key=%s",
            (user.user_id, data.idempotency_key),
        ).fetchone()
        if old:
            if old["payload"] != payload:
                raise HTTPException(
                    409, "Idempotency key already used for different input."
                )
            return {"id": old["id"], "state": old["state"]}
        cfg = c.execute("select * from defense.paid_settings where id=true").fetchone()
        if settings.inference_mode != "local" and (
            not cfg["enabled"] or cfg["circuit_open"]
        ):
            raise HTTPException(
                409,
                "API calls are disabled. Local mode is available through server configuration.",
            )
        auth.limit("research-ask:" + user.user_id, 5)
        c.execute(
            "insert into defense.matters(org_id,title,represented_party,created_by,workspace_kind) values(%s,'Research notebook','Private research',%s,'research') on conflict do nothing",
            (user.org_id, user.user_id),
        )
        matter = c.execute(
            "select id from defense.matters where org_id=%s and created_by=%s and workspace_kind='research' and deleted_at is null",
            (user.org_id, user.user_id),
        ).fetchone()
        job = c.execute(
            "insert into defense.jobs(org_id,matter_id,user_id,kind,payload,idempotency_key) values(%s,%s,%s,'research',%s,%s) on conflict(user_id,idempotency_key) do nothing returning id,state",
            (
                user.org_id,
                matter["id"],
                user.user_id,
                db.Jsonb(payload),
                data.idempotency_key,
            ),
        ).fetchone()
        if not job:
            raise HTTPException(409, "Submission already queued.")
        c.execute(
            "insert into defense.research_runs(id,org_id,matter_id,query,filters) values(%s,%s,%s,%s,%s)",
            (job["id"], user.org_id, matter["id"], data.query, db.Jsonb(filters)),
        )
    return job


@app.get("/api/research/runs")
def research_history(user: User):
    return db.many(
        """select r.id,r.query,r.created_at,j.state,j.error_code from defense.research_runs r
      join defense.jobs j on j.id=r.id join defense.matters m on m.id=r.matter_id
      where r.org_id=%s and m.deleted_at is null order by r.created_at desc limit 30""",
        (user.org_id,),
    )


@app.get("/api/research/runs/{run_id}")
def research_result(run_id: UUID, user: User):
    row = db.one(
        "select r.*,j.state,j.error_code,j.cancel_requested from defense.research_runs r join defense.jobs j on j.id=r.id where r.id=%s and r.org_id=%s",
        (run_id, user.org_id),
    )
    if not row:
        raise HTTPException(404, "Research not found.")
    auth.matter(user, row["matter_id"])
    if row["result"]:
        row["result"].pop(
            "raw_answer", None
        )  # rejected text is never shown as an answer
    return row
