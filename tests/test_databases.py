from uuid import uuid4

import pytest

from defense import db, research, worker


@pytest.fixture
def selected_library(tenant):
    ids = ["fixture-" + uuid4().hex, "fixture-" + uuid4().hex]
    with db.connect() as c:
        for identifier in ids:
            c.execute(
                "insert into defense.research_databases(id,name,description,homepage,enabled) values(%s,%s,'Synthetic test database','https://example.test',true)",
                (identifier, identifier),
            )
            c.execute(
                "insert into defense.cases(id,name,citation,court,jurisdiction,decision_date,source_url,source_sha256,source_name,rights,opinion_count,database_id) values(%s,'Synthetic case','1 Test 1','Synthetic Court','Synthetic','2000-01-01','https://example.test','fixture','Synthetic','Synthetic fixture',1,%s)",
                (identifier, identifier),
            )
            c.execute(
                "insert into defense.case_passages(id,case_id,ordinal,locator,opinion_type,text) values(%s,%s,0,'Synthetic paragraph','majority','Database selection must exclude unselected evidence.')",
                (identifier, identifier),
            )
    yield ids
    db.execute("delete from defense.cases where database_id=any(%s)", (ids,))
    db.execute("delete from defense.research_databases where id=any(%s)", (ids,))


def test_database_filter_controls_retrieval_and_empty_never_means_all(selected_library):
    a, b = selected_library
    hits = research.search_cases("unselected evidence", database_ids=[a])
    assert hits and {h["database_id"] for h in hits} == {a}
    assert research.coverage([a])["cases"] == 1
    assert research.coverage([])["cases"] == 0
    assert {
        h["database_id"]
        for h in research.search_cases("unselected evidence", database_ids=[a, b])
    } == {a, b}
    for ids in [[], ["courtlistener"], ["unknown"], [a, "unknown"]]:
        with pytest.raises(ValueError):
            research.search_cases("evidence", database_ids=ids)


def test_api_and_worker_preserve_selected_database(client, tenant, selected_library):
    client.cookies.set("defense_access", tenant["user"])
    selected = selected_library[0]
    response = client.get(
        "/api/research/search",
        params={"q": "unselected evidence", "database_ids": selected},
    )
    assert response.status_code == 200, response.text
    assert [d["id"] for d in response.json()["searched_databases"]] == [selected]
    body = {
        "query": "What does the evidence say?",
        "database_ids": [selected],
        "idempotency_key": str(uuid4()),
    }
    queued = client.post("/api/research/ask", json=body)
    assert queued.status_code == 200, queued.text
    jid = queued.json()["id"]
    job = db.one("select * from defense.jobs where id=%s", (jid,))
    assert job["payload"]["filters"]["database_ids"] == [selected]
    assert (
        client.post(
            "/api/research/ask", json={**body, "database_ids": [selected_library[1]]}
        ).status_code
        == 409
    )

    class EvidenceOnly:
        model = "DETERMINISTIC TEST"

        def __init__(self, *args):
            pass

        def complete(self, instructions, payload, schema, name):
            import json

            passages = json.loads(payload)["passages"]
            assert {p["database_id"] for p in passages} == {selected}
            return schema(
                status="insufficient",
                propositions=[],
                limitations=["Synthetic mechanics check"],
            )

    worker.process_job(job, EvidenceOnly)
    result = client.get("/api/research/runs/" + jid).json()["result"]
    assert result["searched_databases"] == [{"id": selected, "name": selected}]
    for ids in [[], ["courtlistener"], ["unknown"]]:
        assert (
            client.post(
                "/api/research/ask",
                json={**body, "database_ids": ids, "idempotency_key": str(uuid4())},
            ).status_code
            == 422
        )
    assert (
        client.get(
            "/api/research/search?q=evidence&database_ids=courtlistener"
        ).status_code
        == 422
    )
