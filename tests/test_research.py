import json
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest

from defense import budget, db, local_provider, research, worker


def seed():
    data = {
        "id": 100,
        "name": "SYNTHETIC Alpha v. Beta",
        "name_abbreviation": "SYNTHETIC Alpha v. Beta",
        "decision_date": "2000-01-01",
        "citations": [{"type": "official", "cite": "1 Test 1"}],
        "court": {"name": "Synthetic Court"},
        "jurisdiction": {"name_long": "Synthetic jurisdiction"},
        "casebody": {
            "opinions": [
                {
                    "type": "majority",
                    "text": "A plaintiff must present evidence supporting each essential element.\nJustice Example, dissenting.\nI disagree with the majority and would require no evidence.",
                }
            ]
        },
    }
    return research.import_cap(
        json.dumps(data).encode(), "https://static.case.law/test/1/cases/0001-01.json"
    )


class SourceStub:
    model = "DETERMINISTIC TEST STUB"

    def __init__(self, *args):
        pass

    def complete(self, instructions, payload, schema, name):
        p = json.loads(payload)["passages"][0]
        return schema(
            status="answered",
            propositions=[
                {
                    "text": "Fixture paraphrase requiring review.",
                    "citations": [{"chunk_id": p["id"], "quote": p["text"]}],
                }
            ],
            limitations=["Synthetic software test, not legal analysis."],
        )


def test_import_preserves_text_and_corrects_embedded_dissent(tenant):
    cid = seed()
    rows = db.many(
        "select * from defense.case_passages where case_id=%s order by ordinal", (cid,)
    )
    assert rows[0]["opinion_type"] == "majority"
    assert rows[2]["opinion_type"] == "dissent"
    assert "CAP record labeled majority" in rows[2]["locator"]
    assert seed() == cid
    assert len(rows) == 3
    assert not research.search_cases("plaintiff", after="2001-01-01")
    assert not research.search_cases("plaintiff", court="Different Court")


def test_invalid_citations_are_removed_and_no_hits_skip_model():
    hit = dict(
        id="a",
        case_id="case",
        name="Test",
        citation="1 Test 1",
        decision_date="2000-01-01",
        source_url="https://example.test",
        source_sha256="x",
        locator="p1",
        opinion_type="majority",
        text="This is the actual source text.",
    )

    class Invalid:
        def complete(self, *args):
            return research.ResearchAnswer(
                status="answered",
                propositions=[
                    {
                        "text": "Fabricated claim",
                        "citations": [
                            {"chunk_id": "a", "quote": "This quotation does not exist."}
                        ],
                    }
                ],
                limitations=[],
            )

    result = research.answer_question(Invalid(), "A question", [hit])
    assert result["answer"]["status"] == "insufficient"
    assert result["answer"]["propositions"] == []
    assert result["checks"]["rejected_propositions"] == 1
    assert (
        research.answer_question(object(), "No evidence", [])["answer"]["status"]
        == "insufficient"
    )


def test_local_network_boundary(monkeypatch):
    for url in [
        "https://api.openai.com",
        "http://10.0.0.1:11434",
        "http://127.0.0.1.evil.test:11434",
        "http://user:secret@localhost:11434",
    ]:
        monkeypatch.setattr(
            local_provider, "settings", replace(local_provider.settings, ollama_url=url)
        )
        with pytest.raises(budget.GateError):
            local_provider.local_endpoint()
    monkeypatch.setattr(
        local_provider,
        "settings",
        replace(
            local_provider.settings,
            ollama_url="http://127.0.0.1:11434",
            local_model="test-cloud",
        ),
    )
    with pytest.raises(budget.GateError, match="cloud_model"):
        local_provider.local_info()


def test_local_call_records_zero_paid_spend_and_does_not_retry(tenant, monkeypatch):
    monkeypatch.setattr(
        local_provider, "local_info", lambda: {"model": "test", "digest": "sha256:test"}
    )
    calls = []

    class FakeClient:
        def __init__(self, **kw):
            assert kw["trust_env"] is False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, path, json):
            calls.append(json)
            assert "propositions" in json["messages"][0]["content"]
            assert json["think"] is False and not json.get("tools")
            return httpx.Response(
                200,
                request=httpx.Request("POST", "http://localhost/api/chat"),
                json={
                    "done": True,
                    "done_reason": "stop",
                    "message": {
                        "content": '{"status":"insufficient","propositions":[],"limitations":[]}'
                    },
                    "prompt_eval_count": 10,
                    "eval_count": 12,
                },
            )

    monkeypatch.setattr(local_provider.httpx, "Client", FakeClient)
    before = db.many("select * from defense.budgets order by scope")
    p = local_provider.LocalProvider(tenant["job"])
    p.complete("instructions", "payload", research.ResearchAnswer, "test")
    assert p.last_usage["provider_cost_usd"] == 0
    assert db.many("select * from defense.budgets order by scope") == before
    assert not db.many("select * from defense.calls")
    assert db.one("select state from defense.local_calls")["state"] == "completed"
    with pytest.raises(budget.GateError, match="already_attempted"):
        p.complete("instructions", "payload", research.ResearchAnswer, "test")
    assert len(calls) == 1


def test_large_local_prompt_fails_before_network(monkeypatch):
    monkeypatch.setattr(
        local_provider, "local_info", lambda: pytest.fail("Network must not be called")
    )
    with pytest.raises(budget.GateError, match="context_limit"):
        local_provider.LocalProvider().complete(
            "rules", "x" * 40000, research.ResearchAnswer, "test"
        )


def test_research_queue_privacy_and_cancellation(client, tenant):
    seed()
    assert client.get("/api/library").status_code == 401
    client.cookies.set("defense_access", tenant["user"])
    db.execute("update defense.paid_settings set enabled=false")
    before = db.many("select * from defense.budgets order by scope")
    payload = {
        "query": "What evidence must a plaintiff present?",
        "idempotency_key": str(uuid4()),
    }
    r = client.post("/api/research/ask", json=payload)
    assert r.status_code == 200, r.text
    jid = r.json()["id"]
    assert client.post("/api/research/ask", json=payload).json()["id"] == jid
    assert (
        client.post(
            "/api/research/ask", json={**payload, "query": "Different question"}
        ).status_code
        == 409
    )
    worker.process_job(
        db.one("select * from defense.jobs where id=%s", (jid,)), SourceStub
    )
    result = client.get("/api/research/runs/" + jid).json()
    assert result["state"] == "completed"
    assert result["result"]["checks"]["valid_citations"] > 0
    assert "raw_answer" not in result["result"]
    assert db.many("select * from defense.budgets order by scope") == before
    assert all(
        m["workspace_kind"] == "matter" for m in client.get("/api/matters").json()
    )
    client.cookies.set("defense_access", tenant["other_user"])
    assert client.get("/api/research/runs/" + jid).status_code == 404
    assert client.get("/api/research/runs").json() == []
    # Direct SQL clients also receive tenant isolation.
    with db.connect() as c:
        c.execute("set local role authenticated")
        c.execute(
            "select set_config('request.jwt.claim.sub',%s,true)",
            (tenant["other_user"],),
        )
        assert not c.execute("select * from defense.research_runs").fetchall()
    client.cookies.set("defense_access", tenant["user"])
    r = client.post(
        "/api/research/ask", json={**payload, "idempotency_key": str(uuid4())}
    )
    jid = r.json()["id"]
    assert client.post("/api/jobs/" + jid + "/cancel").status_code == 200
    with pytest.raises(budget.GateError):
        worker.process_job(
            db.one("select * from defense.jobs where id=%s", (jid,)), SourceStub
        )


def test_research_filters_and_origin_are_validated(client, tenant):
    client.cookies.set("defense_access", tenant["user"])
    assert (
        client.get("/api/research/search?q=evidence&after=invalid").status_code == 422
    )
    assert (
        client.get(
            "/api/research/search?q=evidence&after=2026-01-01&before=2000-01-01"
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/research/ask",
            headers={"Origin": "https://evil.test"},
            json={"query": "test question", "idempotency_key": str(uuid4())},
        ).status_code
        == 403
    )
