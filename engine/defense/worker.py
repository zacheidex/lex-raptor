import argparse
import logging
import multiprocessing
import os
import socket
import time

from . import budget, db, research
from .engine import extract_fact_table, generate
from .ingest import extract
from .local_provider import workspace_provider
from .settings import settings
from .storage import storage

log = logging.getLogger("defense.worker")


def parse_child(name, raw, pipe):
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (35, 35))
    try:
        pipe.send(extract(name, raw).to_dict())
    except BaseException:
        pipe.send(
            {
                "status": "failed",
                "error_code": "parser_resource_limit",
                "chunks": [],
                "warnings": [],
                "version": "extract-1.0",
            }
        )
    finally:
        pipe.close()


def bounded_extract(name, raw):
    context = multiprocessing.get_context("spawn")
    reader, writer = context.Pipe(duplex=False)
    process = context.Process(target=parse_child, args=(name, raw, writer))
    process.start()
    writer.close()
    try:
        if not reader.poll(45):
            raise ValueError("parser_timeout")
        result = reader.recv()
        process.join(2)
        return result
    finally:
        if process.is_alive():
            process.kill()
            process.join()
        reader.close()


def claim_job():
    with db.connect() as c:
        # Never automatically rerun a possibly billed job after a worker crash.
        c.execute("""update defense.jobs set state='needs_attention',error_code='worker_lease_expired'
           where state='running' and lease_until<now()""")
        row = c.execute("""select * from defense.jobs where state='queued' and not cancel_requested and kind!='benchmark'
             order by created_at for update skip locked limit 1""").fetchone()
        if not row:
            return None
        c.execute(
            "update defense.jobs set state='running',worker_id=%s,lease_until=now()+interval '10 minutes' where id=%s",
            (socket.gethostname() + ":" + str(os.getpid()), row["id"]),
        )
        return row


def process_job(job, provider_factory=workspace_provider):
    budget.assert_active(job["id"])
    if job["kind"] == "ingest":
        doc = db.one(
            "select * from defense.documents where id=%s and matter_id=%s and org_id=%s and active",
            (job["payload"]["document_id"], job["matter_id"], job["org_id"]),
        )
        if not doc:
            raise ValueError("document_relationship_invalid")
        result = bounded_extract(doc["name"], storage.get(doc["object_key"]))
        budget.assert_active(job["id"])
        db.execute(
            "update defense.documents set status=%s,error_code=%s,chunks=%s,warnings=warnings||%s,extraction_version=%s where id=%s",
            (
                result["status"],
                result.get("error_code"),
                db.Jsonb(result["chunks"]),
                db.Jsonb(result["warnings"]),
                result["version"],
                doc["id"],
            ),
        )
    elif job["kind"] == "research":
        if job["payload"]["inference_mode"] != settings.inference_mode:
            raise ValueError("inference_mode_changed_submit_new_request")
        cfg = db.one("select * from defense.paid_settings where id=true")
        provider = provider_factory(
            str(job["id"]), cfg["model_id"], cfg["reasoning"], 4096
        )
        hits = research.search_cases(
            job["payload"]["query"], **job["payload"]["filters"]
        )
        result = research.answer_question(provider, job["payload"]["query"], hits)
        selected = job["payload"]["filters"].get("database_ids")
        result["searched_databases"] = [
            {"id": d["id"], "name": d["name"]}
            for d in research.databases()
            if selected is None or d["id"] in selected
            if d["searchable"]
        ]
        result["model"] = getattr(provider, "model", settings.local_model)
        result["inference_mode"] = settings.inference_mode
        with db.connect() as c:
            budget.validate_job(c, job["id"])
            c.execute(
                "update defense.research_runs set result=%s where id=%s",
                (db.Jsonb(result), job["id"]),
            )
    elif job["kind"] == "draft":
        docs = db.many(
            "select * from defense.documents where matter_id=%s and org_id=%s and active order by created_at",
            (job["matter_id"], job["org_id"]),
        )
        if not docs or any(d["status"] != "ready" for d in docs):
            raise ValueError("incomplete_ingestion")
        hashes = sorted(d["sha256"] for d in docs)
        chunks = [c for d in docs for c in d["chunks"]]
        m = db.one("select * from defense.matters where id=%s", (job["matter_id"],))
        cfg = db.one("select * from defense.paid_settings where id=true")
        facts = db.many(
            "select statement,citations,source_hashes from defense.reviewed_facts where matter_id=%s and org_id=%s",
            (job["matter_id"], job["org_id"]),
        )
        facts = [
            {"statement": f["statement"], "citations": f["citations"]}
            for f in facts
            if sorted(f["source_hashes"]) == hashes
        ]
        template = None
        if job["payload"].get("template_id"):
            template = db.one(
                "select body from defense.templates where id=%s and org_id=%s",
                (job["payload"]["template_id"], job["org_id"]),
            )
            if not template:
                raise ValueError("template_not_authorized")
        assignment = {
            "title": m["title"],
            "instructions": f"Represented party: {m['represented_party']}. "
            + job["payload"]["instructions"],
            "deliverables": ["discovery-draft.docx"],
        }
        provider = provider_factory(
            str(job["id"]), cfg["model_id"], cfg["reasoning"], cfg["max_output_tokens"]
        )
        if job["payload"].get("facts_only"):
            facts = extract_fact_table(
                provider, assignment, chunks, job["payload"]["workflow"]
            )
            with db.connect() as c:
                budget.validate_job(c, job["id"])
                current = c.execute(
                    "select sha256 from defense.documents where matter_id=%s and active",
                    (job["matter_id"],),
                ).fetchall()
                if sorted(d["sha256"] for d in current) != hashes:
                    raise ValueError("source_changed_during_generation")
                c.execute(
                    "insert into defense.fact_sets(org_id,matter_id,job_id,content,source_hashes) values(%s,%s,%s,%s,%s) on conflict(job_id) do nothing",
                    (
                        job["org_id"],
                        job["matter_id"],
                        job["id"],
                        db.Jsonb(facts.model_dump()),
                        db.Jsonb(hashes),
                    ),
                )
                c.execute(
                    "update defense.jobs set state='completed',finished_at=now() where id=%s",
                    (job["id"],),
                )
            return
        draft, trace = generate(
            provider,
            assignment,
            chunks,
            job["payload"]["workflow"],
            reviewed_facts=facts,
            playbook=template["body"] if template else None,
        )
        trace.update(
            {
                "model": getattr(provider, "model", cfg["model_id"]),
                "inference_mode": settings.inference_mode,
                "reasoning": cfg["reasoning"],
                "max_output_tokens": cfg["max_output_tokens"],
            }
        )
        with db.connect() as c:
            budget.validate_job(c, job["id"])
            current = c.execute(
                "select sha256 from defense.documents where matter_id=%s and active",
                (job["matter_id"],),
            ).fetchall()
            if sorted(d["sha256"] for d in current) != hashes:
                raise ValueError("source_changed_during_generation")
            c.execute(
                """insert into defense.drafts(org_id,matter_id,job_id,revision,content,source_hashes,trace,created_by)
                 values(%s,%s,%s,1,%s,%s,%s,%s) on conflict(job_id,revision) do nothing""",
                (
                    job["org_id"],
                    job["matter_id"],
                    job["id"],
                    db.Jsonb(draft.model_dump()),
                    db.Jsonb(hashes),
                    db.Jsonb(trace),
                    job["user_id"],
                ),
            )
    else:
        raise ValueError("unknown_job_kind")
    db.execute(
        "update defense.jobs set state=case when cancel_requested then 'cancelled' else 'completed' end,finished_at=now() where id=%s",
        (job["id"],),
    )


def tick(provider_factory=workspace_provider):
    db.execute(
        "insert into defense.worker_status(id) values(%s) on conflict(id) do update set last_seen=now()",
        (socket.gethostname(),),
    )
    job = claim_job()
    if not job:
        return False
    try:
        process_job(job, provider_factory)
    except Exception as e:
        code = (
            str(e)
            if isinstance(e, (ValueError, budget.GateError)) and len(str(e)) < 150
            else "worker_operation_failed"
        )
        db.execute(
            "update defense.jobs set state=case when cancel_requested then 'cancelled' else 'failed' end,error_code=%s,finished_at=now() where id=%s",
            (code, job["id"]),
        )
        log.warning("job_failed id=%s code=%s", job["id"], code)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            found = tick()
        except Exception:
            log.error("worker_database_unavailable")
            found = False
        if args.once:
            return
        if not found:
            time.sleep(2)


if __name__ == "__main__":
    main()
