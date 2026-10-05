"""Administrative commands run from the owner-controlled server, never web routes."""

import getpass
import json
import os
from datetime import UTC
from pathlib import Path

import typer

from . import budget, db
from .settings import settings

app = typer.Typer(no_args_is_help=True, pretty_exceptions_show_locals=False)
bench_app = typer.Typer(no_args_is_help=True, pretty_exceptions_show_locals=False)
admin_app = typer.Typer(no_args_is_help=True, pretty_exceptions_show_locals=False)
app.add_typer(bench_app, name="benchmark")
app.add_typer(admin_app, name="admin")


def display(value):
    typer.echo(json.dumps(value, indent=2, default=str))


@app.command()
def migrate():
    root = Path(os.getenv("DEFENSE_ROOT", str(Path(__file__).resolve().parents[2])))
    with db.connect() as c:
        c.execute(
            "create table if not exists public.defense_migrations(name text primary key,applied_at timestamptz default now())"
        )
        for p in sorted((root / "supabase/migrations").glob("*.sql")):
            if not c.execute(
                "select 1 from public.defense_migrations where name=%s", (p.name,)
            ).fetchone():
                has_supabase_history = c.execute(
                    "select to_regclass('supabase_migrations.schema_migrations') as table_name"
                ).fetchone()["table_name"]
                applied = (
                    has_supabase_history
                    and c.execute(
                        "select 1 from supabase_migrations.schema_migrations where version=%s",
                        (p.name.split("_")[0],),
                    ).fetchone()
                )
                if not applied:
                    c.execute(p.read_text())
                c.execute(
                    "insert into public.defense_migrations(name) values(%s)", (p.name,)
                )
    typer.echo("Migrations applied.")


@admin_app.command()
def bootstrap(email: str, organization: str):
    """Create the first administrator. Prompts for a password; sends no messages."""
    import httpx

    if db.one("select 1 from defense.memberships where role='admin' limit 1"):
        raise typer.BadParameter("An administrator already exists. Use invitations.")
    password = getpass.getpass("New administrator password (12+ characters): ")
    if len(password) < 12:
        raise typer.BadParameter("Password must contain at least 12 characters")
    r = httpx.post(
        settings.supabase_url + "/auth/v1/admin/users",
        headers={
            "apikey": settings.supabase_service_key,
            "Authorization": "Bearer " + settings.supabase_service_key,
        },
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    if r.status_code not in {200, 201}:
        raise RuntimeError(
            "Auth bootstrap failed; inspect provider configuration without logging keys"
        )
    user = r.json()
    uid = user.get("id") or user["user"]["id"]
    with db.connect() as c:
        org = c.execute(
            "insert into defense.organizations(name) values(%s) returning id",
            (organization,),
        ).fetchone()["id"]
        c.execute(
            "insert into defense.memberships(user_id,org_id,email,role) values(%s,%s,%s,'admin')",
            (uid, org, email),
        )
        for scope in [f"org:{org}", f"user:{uid}"]:
            c.execute(
                "insert into defense.budgets(scope,cap_micro) values(%s,0)", (scope,)
            )
    display(
        {
            "admin_user_id": uid,
            "organization_id": org,
            "paid_calls_enabled": False,
            "email_sent": False,
        }
    )


@admin_app.command()
def configure(
    owner: str,
    model: str,
    pricing_file: Path,
    global_usd: str,
    organization_usd: str,
    user_usd: str,
    enable: bool = False,
    reasoning: str = "low",
    max_output_tokens: int = 16000,
    max_input_tokens: int = 600000,
):
    """Install explicitly verified prices and lifetime caps; never clears spend/holds."""
    from .bench import owner_identity

    u = owner_identity(owner)
    prices = json.loads(pricing_file.read_text())
    if model not in [p["model_id"] for p in prices]:
        raise typer.BadParameter("Generation model missing from verified pricing file")
    from datetime import datetime, timedelta

    for p in prices:
        verified = datetime.fromisoformat(p["verified_at"])
        if verified.tzinfo is None or not datetime.now(UTC) - timedelta(
            days=30
        ) <= verified <= datetime.now(UTC):
            raise typer.BadParameter(
                "Prices require a recent UTC verification timestamp"
            )
        if (
            not p["source_url"].startswith("https://")
            or min(
                p["input_micro_per_million"],
                p["output_micro_per_million"],
                p["context_limit"],
            )
            <= 0
        ):
            raise typer.BadParameter("Invalid verified pricing")
    if not 256 <= max_output_tokens <= 64000 or not 8192 <= max_input_tokens <= 1000000:
        raise typer.BadParameter("Token bounds outside supported limits")
    with db.connect() as c:
        c.execute("select id from defense.paid_settings where id=true for update")
        for p in prices:
            c.execute(
                """insert into defense.prices(model_id,provider,input_micro_per_million,output_micro_per_million,context_limit,verified_at,source_url,enabled,notes)
               values(%s,%s,%s,%s,%s,%s,%s,true,%s) on conflict(model_id) do update set provider=excluded.provider,input_micro_per_million=excluded.input_micro_per_million,
               output_micro_per_million=excluded.output_micro_per_million,context_limit=excluded.context_limit,verified_at=excluded.verified_at,source_url=excluded.source_url,enabled=true,notes=excluded.notes""",
                tuple(
                    p[k]
                    for k in [
                        "model_id",
                        "provider",
                        "input_micro_per_million",
                        "output_micro_per_million",
                        "context_limit",
                        "verified_at",
                        "source_url",
                    ]
                )
                + (p.get("notes", ""),),
            )
            rates = p.get("billing_rates", {})
            if rates:
                for band in ["short", "long"]:
                    if (
                        min(rates[band].values()) < 0
                        or max(
                            rates[band][k]
                            for k in ["input", "cached_input", "cache_write"]
                        )
                        > p["input_micro_per_million"]
                        or rates[band]["output"] > p["output_micro_per_million"]
                    ):
                        raise typer.BadParameter(
                            "Reservation prices must cover all billing tiers"
                        )
            c.execute(
                "update defense.prices set billing_rates=%s where model_id=%s",
                (db.Jsonb(rates), p["model_id"]),
            )
        for scope, dollars in [
            ("global", global_usd),
            (f"org:{u['org_id']}", organization_usd),
            (f"user:{owner}", user_usd),
        ]:
            cap = budget.dollars_to_micro(dollars)
            c.execute(
                "insert into defense.budgets(scope,cap_micro) values(%s,%s) on conflict(scope) do update set cap_micro=excluded.cap_micro",
                (scope, cap),
            )
        c.execute(
            "update defense.paid_settings set model_id=%s,enabled=%s,reasoning=%s,max_input_tokens=%s,max_output_tokens=%s where id=true",
            (model, enable, reasoning, max_input_tokens, max_output_tokens),
        )
        c.execute(
            "insert into defense.audit(user_id,org_id,event,details) values(%s,%s,'owner_configuration',%s)",
            (
                owner,
                u["org_id"],
                db.Jsonb(
                    {
                        "model": model,
                        "enabled": enable,
                        "global_cap_micro": budget.dollars_to_micro(global_usd),
                    }
                ),
            ),
        )
    typer.echo("Configuration saved; prior spend and unresolved reservations retained.")


@admin_app.command()
def quota(owner: str, user_id: str, max_usd: str):
    from .bench import owner_identity

    u = owner_identity(owner)
    if not db.one(
        "select 1 from defense.memberships where user_id=%s and org_id=%s",
        (user_id, u["org_id"]),
    ):
        raise typer.BadParameter("Member not found in your organization")
    with db.connect() as c:
        c.execute("select id from defense.paid_settings where id=true for update")
        c.execute(
            "insert into defense.budgets(scope,cap_micro) values(%s,%s) on conflict(scope) do update set cap_micro=excluded.cap_micro",
            ("user:" + user_id, budget.dollars_to_micro(max_usd)),
        )


@admin_app.command()
def disable_paid():
    db.execute("update defense.paid_settings set enabled=false where id=true")
    typer.echo(
        "Paid calls disabled. In-flight calls may settle; reservations preserved."
    )


@admin_app.command()
def status():
    display(
        {
            "settings": db.one("select * from defense.paid_settings where id=true"),
            "budgets": db.many("select * from defense.budgets order by scope"),
            "uncertain_calls": db.many(
                "select id,provider_request_id,state,reserved_micro from defense.calls where state!='settled'"
            ),
        }
    )


@admin_app.command()
def reset_circuit(owner: str):
    from .bench import owner_identity

    owner_identity(owner)
    db.execute(
        "update defense.paid_settings set circuit_open=false,failure_count=0 where id=true"
    )
    typer.echo(
        "Circuit reset. This does not enable paid calls or release reservations."
    )


@admin_app.command()
def reconcile(
    owner: str,
    call_id: str,
    usage_file: Path,
    provider_request_id: str,
    verified_from_provider: bool = False,
):
    """Settle an uncertain call once, only using independently verified provider usage."""
    from .bench import owner_identity

    u = owner_identity(owner)
    call = db.one(
        "select c.* from defense.calls c join defense.jobs j on j.id=c.job_id where c.id=%s and j.org_id=%s",
        (call_id, u["org_id"]),
    )
    if not call or call["state"] == "settled":
        raise typer.BadParameter("Unsettled call not found in your organization")
    if not verified_from_provider:
        raise typer.BadParameter(
            "Supply --verified-from-provider only after reconciling provider usage records; unknown usage remains held"
        )
    usage = json.loads(usage_file.read_text())
    if any(
        not isinstance(usage.get(k), int) or usage[k] < 0
        for k in ["input_tokens", "output_tokens"]
    ):
        raise typer.BadParameter("Verified input_tokens and output_tokens are required")
    budget.settle(call_id, usage, None, provider_request_id)
    db.execute(
        "insert into defense.audit(user_id,org_id,event,resource_id) values(%s,%s,'owner_reconciled_call',%s)",
        (owner, u["org_id"], call_id),
    )
    typer.echo("Usage settled once; no generation or retry performed.")


@admin_app.command()
def purge(owner: str, matter_id: str):
    from .api import purge_matter
    from .bench import owner_identity
    from .storage import storage

    u = owner_identity(owner)
    m = db.one(
        "select * from defense.matters where id=%s and org_id=%s and deleted_at is not null",
        (matter_id, u["org_id"]),
    )
    if not m:
        raise typer.BadParameter("Deleted matter not found")
    storage.delete(
        [
            d["object_key"]
            for d in db.many(
                "select object_key from defense.documents where matter_id=%s",
                (matter_id,),
            )
        ]
    )
    purge_matter(matter_id)
    typer.echo("Matter content purged; audit metadata retained.")


@bench_app.command("fetch")
def fetch_benchmark():
    from .bench import fetch

    display(fetch())


@bench_app.command("verify")
def verify_benchmark():
    from .bench import verify

    display(verify())


@bench_app.command("list")
def list_benchmark(tier: str = "core"):
    from .bench import select

    display(
        [
            {k: t[k] for k in ["task_id", "tier", "workflow", "expected_deliverables"]}
            for t in select(tier, all_tasks=True)
        ]
    )


@bench_app.command("estimate")
@bench_app.command("dry-run")
def estimate(
    tier: str = "core",
    task: str | None = None,
    system: list[str] = typer.Option(["chat_baseline", "product_pipeline"]),
    all_tasks: bool = False,
    model: str | None = None,
    judges: list[str] = typer.Option(["claude-sonnet-4-6", "gpt-5.5"]),
    repetitions: int = 1,
    max_usd: str | None = None,
    judge_output_tokens: int = 64000,
):
    from .bench import dry_run, select

    if not 1 <= repetitions <= 3:
        raise typer.BadParameter("Repetitions must be 1–3")
    r = dry_run(
        select(tier, task, all_tasks),
        system,
        model,
        judges,
        repetitions,
        max_usd,
        judge_output_tokens,
    )
    display({k: v for k, v in r.items() if k != "tasks"})
    for t in r["tasks"]:
        display(
            {
                k: t[k]
                for k in [
                    "task_id",
                    "ingestion_complete",
                    "chunks",
                    "input_bounds",
                    "generation_calls",
                    "judge_calls",
                    "upper_bound_micro",
                    "blockers",
                ]
            }
        )


@bench_app.command("run")
def run(
    tier: str = "core",
    task: str | None = None,
    system: list[str] = typer.Option(["chat_baseline", "product_pipeline"]),
    all_tasks: bool = False,
    live: bool = False,
    max_usd: str | None = None,
    model: str | None = None,
    owner: str | None = None,
    judges: list[str] = typer.Option(["claude-sonnet-4-6", "gpt-5.5"]),
    reasoning: str = "low",
    repetitions: int = 1,
    judge_output_tokens: int = 64000,
):
    from .bench import dry_run, select, start_run

    if not 1 <= repetitions <= 3:
        raise typer.BadParameter("Repetitions must be 1–3")
    cap = max_usd or os.getenv("BENCHMARK_MAX_USD")
    tasks = select(tier, task, all_tasks)
    preflight = dry_run(
        tasks, system, model, judges, repetitions, cap, judge_output_tokens
    )
    if not live:
        display(
            {
                "mode": "dry-run",
                "report": "benchmark/latest-preflight.json",
                "calls": preflight["total_generation_calls"]
                + preflight["total_judge_calls"],
            }
        )
        return
    if not cap or not model or not owner:
        raise typer.BadParameter(
            "Live requires --max-usd (or BENCHMARK_MAX_USD), --model and --owner"
        )
    if preflight["pricing_status"] != "verified":
        raise typer.BadParameter(
            "Verified pricing required for every generation and judge model"
        )
    display(
        start_run(
            tasks,
            system,
            model,
            judges,
            reasoning,
            cap,
            repetitions,
            owner,
            judge_output_tokens,
        )
    )


@bench_app.command("resume")
def resume(run_id: str, live: bool = False, max_usd: str | None = None):
    from .bench import resume_run, run_path

    r = json.loads((run_path(run_id) / "run.json").read_text())
    if not live:
        display(r)
        return
    if not max_usd or budget.dollars_to_micro(max_usd) != budget.dollars_to_micro(
        r["cap_usd"]
    ):
        raise typer.BadParameter(
            "Resume requires the original explicit --max-usd; caps are never silently increased"
        )
    display(resume_run(run_id))


@bench_app.command("grade")
def grade(run_id: str, live: bool = False, max_usd: str | None = None):
    from .bench import resume_run, run_path

    r = json.loads((run_path(run_id) / "run.json").read_text())
    if not live:
        display(
            {
                "mode": "dry-run",
                "judge_profile": r["judge_profile"],
                "entries": r["entries"],
            }
        )
        return
    if not max_usd or budget.dollars_to_micro(max_usd) != budget.dollars_to_micro(
        r["cap_usd"]
    ):
        raise typer.BadParameter("Grading requires the original explicit --max-usd")
    display(resume_run(run_id, grade_only=True))


@bench_app.command("report")
def report(run_id: str):
    from .bench import report_run

    display(report_run(run_id))


if __name__ == "__main__":
    app()
