"""Authenticated real-provider smoke; explicit live flag and cap, no stub fallback."""

import argparse
import json
import time
import uuid
from pathlib import Path

import httpx


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--live", action="store_true")
    p.add_argument("--max-usd", required=True)
    p.add_argument("--origin", default="http://localhost:3000")
    p.add_argument(
        "--credentials-file", type=Path, default=Path("data/local-admin.json")
    )
    a = p.parse_args()
    if not a.live:
        raise SystemExit(
            "Dry run: no calls. Supply --live after configuring the provider and DB quotas."
        )
    from defense import budget, db

    cap = budget.dollars_to_micro(a.max_usd)
    row = db.one("select * from defense.budgets where scope='global'")
    if not row or row["cap_micro"] > cap or cap <= 0:
        raise SystemExit(
            "Configure a global DB cap no greater than the explicit smoke cap."
        )
    credentials = json.loads(a.credentials_file.read_text())
    c = httpx.Client(base_url=a.origin, headers={"Origin": a.origin}, timeout=30)
    r = c.post(
        "/api/auth/login", json={k: credentials[k] for k in ["email", "password"]}
    )
    r.raise_for_status()
    r = c.post(
        "/api/matters",
        json={
            "title": "SYNTHETIC live end-to-end smoke",
            "represented_party": "Example Supply LLC",
            "synthetic": True,
        },
    )
    r.raise_for_status()
    mid = r.json()["id"]
    r = c.post(
        "/api/matters/" + mid + "/documents",
        files={
            "file": (
                "synthetic-discovery.txt",
                b"SYNTHETIC ONLY. Represented party: Example Supply LLC. Interrogatory 1: State the delivery date. Warehouse record: Delivery took place October 1, 2026. Interrogatory 2: Identify the driver. No driver identity was recorded.",
                "text/plain",
            )
        },
    )
    r.raise_for_status()
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        state = c.get("/api/matters/" + mid).json()
        if state["documents"][0]["status"] == "ready":
            break
        if state["documents"][0]["status"] == "failed":
            raise RuntimeError("Ingestion failed")
        time.sleep(2)
    r = c.post(
        "/api/matters/" + mid + "/generate",
        json={
            "workflow": "discovery_responses",
            "instructions": "Draft responses to both interrogatories with source citations. Identify unknown facts for review.",
            "idempotency_key": str(uuid.uuid4()),
            "acknowledge_warnings": True,
        },
    )
    r.raise_for_status()
    jid = r.json()["id"]
    while time.monotonic() < deadline:
        status = c.get("/api/jobs/" + jid).json()
        if status["state"] == "completed":
            break
        if status["state"] in ["failed", "cancelled", "needs_attention"]:
            raise RuntimeError(status.get("error_code", "Job failed"))
        time.sleep(2)
    else:
        raise TimeoutError("Smoke job did not complete; reservation retained")
    draft = c.get("/api/matters/" + mid).json()["draft"]
    result = {
        "matter_id": mid,
        "job_id": jid,
        "draft_id": draft["id"],
        "live_model_generated": True,
        "human_review_completed": False,
        "note": "An attorney must review and mark the draft reviewed in the UI before exporting. The script does not impersonate an attorney.",
    }
    Path("data/live-smoke.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
