import json
import pytest
from defense import db, budget, worker
from defense.models import Verdict, FactSet
from defense.provider import PaidProvider


def test_timeout_reservation_and_retry_identity(tenant, monkeypatch):
    import openai

    monkeypatch.setenv("OPENAI_API_KEY", "OFFLINE_TEST_KEY")
    calls = []

    class Responses:
        def create(self, **kwargs):
            calls.append(kwargs)
            assert "tools" not in kwargs and "OFFLINE_TEST_KEY" not in json.dumps(
                kwargs
            )
            raise TimeoutError("uncertain transport result")

    class Client:
        responses = Responses()

    def constructor(**kwargs):
        assert kwargs["max_retries"] == 0
        assert kwargs["base_url"] == "https://api.openai.com/v1"
        return Client()

    monkeypatch.setattr(openai, "OpenAI", constructor)
    p = PaidProvider(tenant["job"], "test-model")
    with pytest.raises(budget.GateError, match="uncertain"):
        p.complete("instructions", "evidence", Verdict, "timeout")
    row = db.one("select * from defense.calls where job_id=%s", (tenant["job"],))
    assert row["state"] == "uncertain"
    with pytest.raises(budget.GateError, match="uncertain"):
        p.complete("instructions", "evidence", Verdict, "timeout")
    assert len(calls) == 1
    assert (
        db.one("select held_micro from defense.budgets where scope='global'")[
            "held_micro"
        ]
        == row["reserved_micro"]
    )


@pytest.mark.parametrize("scope_key", ["org", "user"])
def test_each_tenant_budget_enforced(tenant, scope_key):
    db.execute(
        "update defense.budgets set cap_micro=0 where scope=%s",
        (scope_key + ":" + tenant[scope_key],),
    )
    with pytest.raises(budget.GateError, match="budget_exhausted"):
        budget.reserve("x", tenant["job"], "test-model", "hash", 100, 100, "generation")
    assert not db.many("select * from defense.calls")


def test_cancel_and_worker_restart_do_not_reissue_paid_work(tenant):
    db.execute(
        "update defense.jobs set state='running',lease_until=now()-interval '1 second' where id=%s",
        (tenant["job"],),
    )
    budget.reserve(
        "inflight", tenant["job"], "test-model", "hash", 100, 100, "generation"
    )
    assert worker.claim_job() is None
    assert (
        db.one("select state from defense.jobs where id=%s", (tenant["job"],))["state"]
        == "needs_attention"
    )
    assert (
        db.one("select held_micro from defense.budgets where scope='global'")[
            "held_micro"
        ]
        == 300
    )
    db.execute(
        "update defense.jobs set cancel_requested=true where id=%s", (tenant["job"],)
    )
    with pytest.raises(budget.GateError, match="cancelled"):
        budget.assert_active(tenant["job"])


def test_budget_cap_change_preserves_uncertain_commitments(tenant):
    budget.reserve(
        "inflight", tenant["job"], "test-model", "hash", 100, 100, "generation"
    )
    budget.uncertain("inflight")
    db.execute("update defense.budgets set cap_micro=100 where scope='global'")
    row = db.one("select * from defense.budgets where scope='global'")
    assert row["held_micro"] == 300
    with pytest.raises(budget.GateError, match="budget_exhausted"):
        budget.reserve(
            "retry-new-id", tenant["job"], "test-model", "hash", 100, 100, "generation"
        )


def test_settlement_accounts_for_reasoning_cache_and_long_context():
    p = {
        "billing_rates": {
            "long_threshold_tokens": 272000,
            "short": {
                "input": 2000000,
                "cached_input": 100000,
                "cache_write": 2500000,
                "output": 10000000,
            },
            "long": {
                "input": 4000000,
                "cached_input": 200000,
                "cache_write": 5000000,
                "output": 15000000,
            },
        }
    }
    u = {
        "input_tokens": 300000,
        "output_tokens": 1000,
        "input_tokens_details": {"cached_tokens": 10000, "cache_write_tokens": 20000},
        "output_tokens_details": {"reasoning_tokens": 800},
    }
    # Output tokens already include reasoning; do not double-bill them.
    assert budget.actual_cost(p, u) == 1197000


def test_deleted_matter_does_not_regain_response_when_call_finishes(tenant):
    budget.reserve(
        "inflight", tenant["job"], "test-model", "hash", 100, 100, "generation"
    )
    db.execute(
        "update defense.matters set deleted_at=now() where id=%s", (tenant["matter"],)
    )
    budget.settle(
        "inflight",
        {"input_tokens": 10, "output_tokens": 10},
        {"raw": "private document"},
        "req",
    )
    assert (
        db.one("select response from defense.calls where id='inflight'")["response"]
        is None
    )
    with db.connect() as c:
        c.execute("set local role authenticated")
        c.execute(
            "select set_config('request.jwt.claim.sub',%s,true)", (tenant["user"],)
        )
        assert c.execute("select * from defense.matters").fetchall() == []


def test_fact_table_is_stored_before_any_draft(tenant):
    from defense.ingest import extract

    raw = b"SYNTHETIC evidence: event on October 1."
    doc = extract("source.txt", raw)
    db.execute(
        "insert into defense.documents(org_id,matter_id,name,sha256,object_key,size_bytes,status,chunks) values(%s,%s,'source.txt',%s,'synthetic',%s,'ready',%s)",
        (
            tenant["org"],
            tenant["matter"],
            doc.sha256,
            len(raw),
            db.Jsonb([c.__dict__ for c in doc.chunks]),
        ),
    )
    db.execute(
        "update defense.jobs set payload=%s where id=%s",
        (
            db.Jsonb(
                {
                    "workflow": "chronology",
                    "instructions": "Extract supported facts",
                    "facts_only": True,
                }
            ),
            tenant["job"],
        ),
    )

    class Stub:
        def __init__(self, *args):
            pass

        def complete(self, instructions, payload, schema, call_name):
            assert schema is FactSet and "Do not draft responses yet" in instructions
            c = doc.chunks[0]
            return FactSet.model_validate(
                {
                    "facts": [
                        {
                            "text": c.text,
                            "kind": "documented_fact",
                            "citations": [{"chunk_id": c.id, "quote": c.text}],
                            "review_note": "",
                        }
                    ],
                    "issues": [],
                }
            )

    assert worker.tick(Stub)
    assert db.one(
        "select * from defense.fact_sets where matter_id=%s", (tenant["matter"],)
    )
    assert not db.one(
        "select * from defense.drafts where matter_id=%s", (tenant["matter"],)
    )
