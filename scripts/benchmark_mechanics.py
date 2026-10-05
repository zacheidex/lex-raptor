"""Explicitly unpaid, deterministic plumbing check. Never a legal-quality benchmark."""

import json
import subprocess
import time
from uuid import uuid4

from defense import bench
from defense.models import Draft


class MechanicsStub:
    def __init__(self, *args):
        pass

    def complete(self, instructions, payload, schema, call_name):
        p = json.loads(payload)
        chunk = p["source_passages"][0]
        claim = {
            "text": "DETERMINISTIC MECHANICS STUB. No legal analysis or model inference was performed.",
            "kind": "unknown",
            "citations": [{"chunk_id": chunk[0], "quote": chunk[3][:200]}],
            "review_note": "Fixture quotation tests locator/export mechanics only. It does not support a substantive legal conclusion.",
        }
        return Draft.model_validate(
            {
                "facts": [claim],
                "artifacts": [
                    {
                        "filename": name,
                        "title": "MECHANICS TEST — NOT LEGAL WORK PRODUCT",
                        "sections": [
                            {"heading": "Offline fixture check", "claims": [claim]}
                        ],
                    }
                    for name in p["assignment"]["deliverables"]
                ],
                "issues": [
                    "No model was called. All legal performance metrics are unmeasured."
                ],
            }
        )


def main():
    bench.verify()
    run_id = "mechanics-" + str(uuid4())
    root = bench.ROOT / "data/mechanics" / run_id
    tasks = bench.select(all_tasks=True)
    run = {
        "run_id": run_id,
        "created_at": bench.stamp(),
        "model": "DETERMINISTIC_STUB",
        "reasoning": "none",
        "max_output_tokens": 0,
        "scope": "unpaid",
        "tasks": tasks,
    }
    report = {
        "run_id": run_id,
        "mode": "offline_mechanics_only",
        "paid_calls": 0,
        "actual_cost_micro": 0,
        "entries": [],
        "legal_quality": "unmeasured",
        "headline_LAB_score": None,
        "attorney_correction_time": None,
        "commit": bench.PIN,
        "fixture_lock_sha256": bench.sha256(
            (bench.ROOT / "benchmark/fixtures.lock.json").read_bytes()
        ).hexdigest(),
    }
    # Verify the actual image cannot see evaluator checkouts, host home, or keys.
    check = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--user",
            "65534:65534",
            "defense-generator:local",
            "python",
            "-c",
            "import os,pathlib; assert not pathlib.Path('/home/zach').exists(); assert not pathlib.Path('/app/defense/bench.py').exists(); assert not pathlib.Path('/data/evaluator').exists(); assert not any(k in os.environ for k in ['OPENAI_API_KEY','ANTHROPIC_API_KEY','DATABASE_URL']); print('isolation passed')",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    report["container_isolation_passed"] = check.returncode == 0
    if check.returncode:
        raise RuntimeError("Generator isolation failed")
    for t in tasks:
        for system in ["chat_baseline", "product_pipeline"]:
            e = {
                "task_id": t["task_id"],
                "tier": t["tier"],
                "system": system,
                "repetition": 1,
                "job_id": "unpaid-stub",
            }
            start = time.monotonic()
            try:
                e.update(
                    bench.isolated_generate(
                        run, e, bench.entry_dir(root, e), MechanicsStub
                    )
                )
                sidecar = json.loads(
                    (bench.entry_dir(root, e) / "sidecar.json").read_text()
                )
                e["source_locator_findings"] = sidecar["trace"]["source_findings"]
                e["status"] = "mechanics_passed"
            except Exception as err:
                e["status"] = "mechanics_failed"
                e["error"] = str(err)
            e["latency_seconds"] = round(time.monotonic() - start, 3)
            report["entries"].append(e)
            bench.dump(root / "report.json", report)
            print(system, t["task_id"].split("/")[-1], e["status"], flush=True)
    report["intended_task_system_pairs"] = 16
    report["passed_pairs"] = sum(
        e["status"] == "mechanics_passed" for e in report["entries"]
    )
    report["unique_core_files"] = sum(len(bench.corpus(t["task_id"])[2]) for t in tasks)
    bench.dump(root / "report.json", report)
    bench.dump(bench.ROOT / "benchmark/operational-report.json", report)
    print(json.dumps({k: v for k, v in report.items() if k != "entries"}, indent=2))


if __name__ == "__main__":
    main()
