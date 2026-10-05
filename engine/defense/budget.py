"""Postgres-resident reservations shared by every process and paid operation."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from . import db


class GateError(RuntimeError):
    pass


def dollars_to_micro(value):
    d = Decimal(str(value)) * 1_000_000
    if not d.is_finite() or d < 0 or d != d.to_integral_value():
        raise ValueError("Use a nonnegative dollar amount with at most six decimals")
    return int(d)


def cost(price, input_tokens, output_tokens):
    if input_tokens < 0 or output_tokens < 0:
        raise GateError("invalid_usage")
    numerator = (
        input_tokens * price["input_micro_per_million"]
        + output_tokens * price["output_micro_per_million"]
    )
    return (numerator + 999_999) // 1_000_000


def actual_cost(price, usage):
    rates = price.get("billing_rates", {})
    if not rates:
        usage["cost_basis"] = "conservative_configured_rate; invoice_cost_unmeasured"
        return cost(price, int(usage["input_tokens"]), int(usage["output_tokens"]))
    inputs = int(usage["input_tokens"])
    outputs = int(usage["output_tokens"])
    details = usage.get("input_tokens_details") or {}
    cached = int(
        details.get("cached_tokens", usage.get("cache_read_input_tokens", 0)) or 0
    )
    writes = int(
        details.get("cache_write_tokens", usage.get("cache_creation_input_tokens", 0))
        or 0
    )
    if min(inputs, outputs, cached, writes) < 0 or cached + writes > inputs:
        raise GateError("unrecognized_usage_retained")
    band = rates["long"] if inputs > rates["long_threshold_tokens"] else rates["short"]
    total = (
        (inputs - cached - writes) * band["input"]
        + cached * band["cached_input"]
        + writes * band["cache_write"]
        + outputs * band["output"]
    )
    usage["cost_basis"] = "returned_usage_x_verified_tier_and_cache_rates"
    return (total + 999999) // 1000000


def price_for(model):
    price = db.one(
        "select * from defense.prices where model_id=%s and enabled", (model,)
    )
    if not price or price["verified_at"] < datetime.now(UTC) - timedelta(days=30):
        raise GateError("missing_disabled_or_stale_verified_pricing")
    return price


def validate_job(c, job_id):
    job = c.execute(
        """select j.*,m.active, m.role, a.deleted_at from defense.jobs j
      join defense.memberships m on m.user_id=j.user_id and m.org_id=j.org_id
      join defense.matters a on a.id=j.matter_id and a.org_id=j.org_id
      where j.id=%s for share of m,a""",
        (job_id,),
    ).fetchone()
    if not job or not job["active"] or job["deleted_at"] or job["cancel_requested"]:
        raise GateError("job_revoked_or_cancelled")
    if job["kind"] == "benchmark" and job["role"] != "admin":
        raise GateError("benchmark_requires_admin")
    if job["state"] not in {"queued", "running"}:
        raise GateError("job_not_active")
    return job


def reserve(
    call_id,
    job_id,
    model,
    request_hash,
    input_bound,
    output_bound,
    category,
    benchmark_scope=None,
):
    if input_bound <= 0 or output_bound <= 0:
        raise GateError("invalid_token_bounds")
    with db.connect() as c:
        # This row serializes reservations, admin toggles, settlements and cap edits.
        cfg = c.execute(
            "select * from defense.paid_settings where id=true for update"
        ).fetchone()
        if not cfg or not cfg["enabled"] or cfg["circuit_open"]:
            raise GateError("paid_calls_disabled_or_circuit_open")
        job = validate_job(c, job_id)
        if job["kind"] == "benchmark" and benchmark_scope is None:
            raise GateError("benchmark_scope_required")
        if benchmark_scope and benchmark_scope != job["payload"].get("benchmark_scope"):
            raise GateError("benchmark_scope_mismatch")
        old = c.execute(
            "select * from defense.calls where id=%s", (call_id,)
        ).fetchone()
        if old:
            if (
                str(old["job_id"]) != str(job_id)
                or old["request_hash"] != request_hash
                or old["model_id"] != model
            ):
                raise GateError("idempotency_conflict")
            if old["state"] == "settled" and old["response"] is not None:
                return old
            raise GateError("uncertain_or_inflight_call_requires_reconciliation")
        price = c.execute(
            "select * from defense.prices where model_id=%s and enabled for share",
            (model,),
        ).fetchone()
        if not price or price["verified_at"] < datetime.now(UTC) - timedelta(days=30):
            raise GateError("missing_disabled_or_stale_verified_pricing")
        max_calls = (
            cfg["max_calls"]
            if job["kind"] != "benchmark"
            else min(int(job["payload"].get("max_calls", 0)), 3000)
        )
        calls = c.execute(
            "select count(*) as n from defense.calls where job_id=%s", (job_id,)
        ).fetchone()["n"]
        if calls >= max_calls:
            raise GateError("job_call_limit")
        output_cap = (
            cfg["max_judge_output_tokens"]
            if category == "grading" and job["kind"] == "benchmark"
            else cfg["max_output_tokens"]
        )
        input_cap = (
            cfg["max_judge_input_tokens"]
            if category == "grading" and job["kind"] == "benchmark"
            else cfg["max_input_tokens"]
        )
        if (
            input_bound > input_cap
            or output_bound > output_cap
            or input_bound + output_bound > price["context_limit"]
        ):
            raise GateError("token_or_context_limit")
        scopes = sorted(
            ["global", f"org:{job['org_id']}", f"user:{job['user_id']}"]
            + ([benchmark_scope] if benchmark_scope else [])
        )
        amount = cost(price, input_bound, output_bound)
        for scope in scopes:
            row = c.execute(
                "select * from defense.budgets where scope=%s for update", (scope,)
            ).fetchone()
            if (
                not row
                or row["spent_micro"] + row["held_micro"] + amount > row["cap_micro"]
            ):
                raise GateError(
                    "budget_exhausted_or_unconfigured:" + scope.split(":")[0]
                )
        snapshot = {
            k: price[k]
            for k in [
                "model_id",
                "provider",
                "input_micro_per_million",
                "output_micro_per_million",
                "context_limit",
                "source_url",
                "billing_rates",
            ]
        }
        snapshot.update({"input_bound": input_bound, "output_bound": output_bound})
        for scope in scopes:
            c.execute(
                "update defense.budgets set held_micro=held_micro+%s where scope=%s",
                (amount, scope),
            )
        return c.execute(
            """insert into defense.calls(id,job_id,model_id,request_hash,category,scopes,reserved_micro,price_snapshot)
            values(%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
            (
                call_id,
                job_id,
                model,
                request_hash,
                category,
                scopes,
                amount,
                db.Jsonb(snapshot),
            ),
        ).fetchone()


def settle(call_id, usage, response, provider_request_id):
    breach = False
    with db.connect() as c:
        c.execute("select id from defense.paid_settings where id=true for update")
        call = c.execute(
            "select * from defense.calls where id=%s for update", (call_id,)
        ).fetchone()
        if not call:
            raise GateError("unknown_reservation")
        if call["state"] == "settled":
            return
        if "input_tokens" not in usage or "output_tokens" not in usage:
            raise GateError("unknown_usage_retained")
        amount = actual_cost(call["price_snapshot"], usage)
        breach = amount > call["reserved_micro"]
        for scope in call["scopes"]:
            c.execute(
                "update defense.budgets set held_micro=held_micro-%s, spent_micro=spent_micro+%s where scope=%s",
                (call["reserved_micro"], amount, scope),
            )
        # A deleted matter must not regain content when an in-flight call settles.
        current = c.execute(
            "select a.deleted_at from defense.jobs j join defense.matters a on a.id=j.matter_id where j.id=%s for share of a",
            (call["job_id"],),
        ).fetchone()
        if current["deleted_at"]:
            response = None
        c.execute(
            """update defense.calls set state='settled',actual_micro=%s,usage=%s,response=%s,
           provider_request_id=%s,settled_at=now() where id=%s""",
            (amount, db.Jsonb(usage), db.Jsonb(response), provider_request_id, call_id),
        )
        c.execute("update defense.paid_settings set failure_count=0 where id=true")
        if breach:
            c.execute(
                "update defense.paid_settings set enabled=false,circuit_open=true where id=true"
            )
        c.execute(
            "insert into defense.audit(event,resource_id,details) values('call_settled',%s,%s)",
            (call_id, db.Jsonb({"actual_micro": amount, "bound_breach": breach})),
        )
    if breach:
        raise GateError("provider_usage_exceeded_bound_kill_switch_engaged")


def uncertain(call_id):
    with db.connect() as c:
        c.execute("select id from defense.paid_settings where id=true for update")
        c.execute(
            "update defense.calls set state='uncertain' where id=%s and state='reserved'",
            (call_id,),
        )
        c.execute(
            "update defense.paid_settings set failure_count=failure_count+1,circuit_open=(failure_count+1>=3) where id=true"
        )


def assert_active(job_id):
    with db.connect() as c:
        return validate_job(c, job_id)
