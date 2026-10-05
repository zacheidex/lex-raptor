"""Real local-model smoke, with or without accounts. Synthetic matter text only."""

import json
import time
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env.local")
from defense import db  # noqa: E402


def main():
    before = db.one(
        "select spent_micro,held_micro from defense.budgets where scope='global'"
    )
    for _ in range(30):
        try:
            ready = httpx.get(
                "http://localhost:3000/api/health", timeout=2, trust_env=False
            )
            if ready.status_code == 200:
                break
        except httpx.HTTPError:
            pass
        time.sleep(1)
    else:
        raise RuntimeError("Start Lex Raptor before running the local smoke test")
    with httpx.Client(
        base_url="http://localhost:3000/api",
        headers={"Origin": "http://localhost:3000"},
        timeout=30,
        trust_env=False,
    ) as client:

        def post(path, body):
            r = client.post(path, json=body)
            r.raise_for_status()
            return r.json()

        def get(path):
            r = client.get(path)
            r.raise_for_status()
            return r.json()

        def wait(jid):
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                job = get("/jobs/" + jid)
                if job["state"] == "completed":
                    return job
                if job["state"] in {"failed", "cancelled", "needs_attention"}:
                    raise RuntimeError("Local job failed: " + str(job["error_code"]))
                time.sleep(2)
            raise RuntimeError("Local job wait exceeded five minutes")

        access = get("/health")["auth_mode"]
        if access == "account":
            credentials = json.loads((ROOT / "data/local-admin.json").read_text())
            post(
                "/auth/login",
                {"email": credentials["email"], "password": credentials["password"]},
            )
        else:
            assert access == "local" and not client.cookies
        assert get("/me")["auth_mode"] == access
        runtime = get("/runtime")
        assert runtime["mode"] == "local" and runtime["ready"], (
            "Local model must be ready; no API fallback"
        )
        query = "How do Twombly and Iqbal describe the plausibility required in a complaint?"
        run = post(
            "/research/ask",
            {"query": query, "database_ids": ["cap"], "idempotency_key": str(uuid4())},
        )
        wait(run["id"])
        result = get("/research/runs/" + run["id"])["result"]
        assert result["answer"]["status"] == "answered", result["answer"]["limitations"]
        assert result["checks"]["valid_citations"] > 0
        assert [d["id"] for d in result["searched_databases"]] == ["cap"]
        assert {s["database_id"] for s in result["sources"]} == {"cap"}
        print(
            "Live local research completed with checked source quotations.",
            flush=True,
        )
        matter = post(
            "/matters",
            {
                "title": "SYNTHETIC · Lex Raptor local model smoke",
                "represented_party": "Example Company (synthetic)",
                "synthetic": True,
            },
        )
        original = b"SYNTHETIC TEST RECORD ONLY\nSeptember 1, 2026: Example Company received a letter from Sample Customer.\nSeptember 3, 2026: Example Company replied acknowledging receipt.\nSeptember 5, 2026: Sample Customer requested a meeting. No meeting date is recorded.\n"
        r = client.post(
            "/matters/" + matter["id"] + "/documents",
            files={"file": ("synthetic-timeline.txt", original, "text/plain")},
        )
        r.raise_for_status()
        for _ in range(25):
            detail = get("/matters/" + matter["id"])
            if detail["documents"][0]["status"] == "ready":
                break
            time.sleep(2)
        assert detail["documents"][0]["status"] == "ready"
        job = post(
            "/matters/" + matter["id"] + "/generate",
            {
                "workflow": "chronology",
                "instructions": "Prepare a concise chronology of the three dated events. Identify the missing meeting date without inventing it. Use exact source quotations.",
                "acknowledge_warnings": True,
                "idempotency_key": str(uuid4()),
            },
        )
        wait(job["id"])
        detail = get("/matters/" + matter["id"])
        assert detail["draft"] and detail["draft"]["review_state"] == "draft"
        report = {
            "model": runtime["model"],
            "model_digest": runtime["digest"],
            "access_mode": access,
            "account_required": access == "account",
            "local_research": True,
            "selected_database": "cap",
            "research_valid_quotations": result["checks"]["valid_citations"],
            "synthetic_upload_ingested": True,
            "live_local_document_draft": True,
            "attorney_review": "not performed; draft remains unapproved",
            "ledger_before": before,
            "ledger_after": db.one(
                "select spent_micro,held_micro from defense.budgets where scope='global'"
            ),
            "local_calls": db.one(
                "select count(*) n from defense.local_calls where job_id=any(%s)",
                ([run["id"], job["id"]],),
            )["n"],
        }
        assert report["ledger_before"] == report["ledger_after"]
        (ROOT / "data/local-model-smoke.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
        print(
            "Synthetic document draft completed; no attorney approval recorded. API ledger unchanged.",
            flush=True,
        )


if __name__ == "__main__":
    main()
