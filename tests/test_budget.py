from concurrent.futures import ThreadPoolExecutor

import pytest
from defense import budget, db


def reserve(t, call="one", **kwargs):
    return budget.reserve(
        call, t["job"], "test-model", "hash", 100, 100, "generation", **kwargs
    )


def test_concurrent_caps_and_idempotency(tenant):
    db.execute("update defense.budgets set cap_micro=500 where scope='global'")

    def attempt(i):
        try:
            return reserve(tenant, str(i))["id"]
        except budget.GateError:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        result = list(pool.map(attempt, range(8)))
    assert sum(x is not None for x in result) == 1
    assert (
        db.one("select held_micro from defense.budgets where scope='global'")[
            "held_micro"
        ]
        == 300
    )
    with pytest.raises(budget.GateError):
        reserve(tenant, next(x for x in result if x))


def test_settle_once_and_cache(tenant):
    reserve(tenant)
    budget.settle(
        "one",
        {"input_tokens": 50, "output_tokens": 50},
        {"parsed": {"x": 1}},
        "request-1",
    )
    budget.settle(
        "one",
        {"input_tokens": 50, "output_tokens": 50},
        {"parsed": {"x": 1}},
        "request-1",
    )
    assert reserve(tenant)["state"] == "settled"
    assert db.one(
        "select spent_micro,held_micro from defense.budgets where scope='global'"
    ) == {"spent_micro": 150, "held_micro": 0}


def test_uncertain_is_never_refunded_or_retried(tenant):
    reserve(tenant)
    budget.uncertain("one")
    with pytest.raises(budget.GateError, match="uncertain"):
        reserve(tenant)
    assert (
        db.one("select held_micro from defense.budgets where scope='global'")[
            "held_micro"
        ]
        == 300
    )


def test_revocation_kill_unknown_price_and_scope(tenant):
    db.execute(
        "update defense.memberships set active=false where user_id=%s",
        (tenant["user"],),
    )
    with pytest.raises(budget.GateError, match="revoked"):
        reserve(tenant)
    db.execute(
        "update defense.memberships set active=true where user_id=%s", (tenant["user"],)
    )
    db.execute("update defense.paid_settings set enabled=false")
    with pytest.raises(budget.GateError, match="disabled"):
        reserve(tenant)
    db.execute("update defense.paid_settings set enabled=true")
    db.execute("delete from defense.prices")
    with pytest.raises(budget.GateError, match="pricing"):
        reserve(tenant)


def test_benchmark_needs_separate_cap_and_admin(tenant):
    db.execute(
        "update defense.jobs set kind='benchmark',payload=%s where id=%s",
        (
            db.Jsonb({"benchmark_scope": "benchmark:test", "max_calls": 5}),
            tenant["job"],
        ),
    )
    with pytest.raises(budget.GateError, match="scope_required"):
        reserve(tenant)
    with pytest.raises(budget.GateError, match="budget_exhausted"):
        reserve(tenant, benchmark_scope="benchmark:test")
    db.execute(
        "insert into defense.budgets(scope,cap_micro) values('benchmark:test',500)"
    )
    assert reserve(tenant, benchmark_scope="benchmark:test")


def test_database_failure_prevents_provider(monkeypatch, tenant):
    import openai
    from defense.models import Verdict
    from defense.provider import PaidProvider

    called = []
    monkeypatch.setenv("OPENAI_API_KEY", "test-do-not-send")
    monkeypatch.setattr(openai, "OpenAI", lambda **kw: called.append(True))
    monkeypatch.setattr(
        db, "one", lambda *args: (_ for _ in ()).throw(RuntimeError("database offline"))
    )
    with pytest.raises(RuntimeError):
        PaidProvider(tenant["job"], "test-model").complete(
            "test", "test", Verdict, "db-down"
        )
    assert not called


def test_circuit_breaker_retains_all_commitments(tenant):
    for i in range(3):
        reserve(tenant, str(i))
        budget.uncertain(str(i))
    with pytest.raises(budget.GateError, match="circuit_open"):
        reserve(tenant, "four")
    assert (
        db.one("select held_micro from defense.budgets where scope='global'")[
            "held_micro"
        ]
        == 900
    )
