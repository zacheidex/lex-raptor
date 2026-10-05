"""Live LOCAL-model research diagnostic. Never instantiates a paid provider."""

import argparse
import hashlib
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env.local")
from defense import db, research  # noqa: E402
from defense.local_provider import LocalProvider, local_info  # noqa: E402
from defense.settings import settings  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--task", help="One task ID for diagnostic smoke; full suite if omitted"
    )
    parser.add_argument(
        "--output", type=Path, default=ROOT / "benchmark/research/local-results.json"
    )
    args = parser.parse_args()
    info = local_info()
    expected = json.loads((ROOT / "benchmark/research/corpus.lock.json").read_text())
    actual = db.many("select id,source_sha256 from defense.cases order by id")
    if {r["id"]: r["sha256"] for r in expected} != {
        r["id"]: r["source_sha256"] for r in actual
    }:
        raise RuntimeError(
            "The library differs from the pinned diagnostic corpus. Use an isolated benchmark database."
        )
    for record in expected:
        if (
            hashlib.sha256(
                (ROOT / "data/caselaw" / record["file"]).read_bytes()
            ).hexdigest()
            != record["sha256"]
        ):
            raise RuntimeError("Original source hash mismatch: " + record["id"])
    passages = db.many(
        "select id,case_id,locator,opinion_type,text from defense.case_passages order by id"
    )
    passage_hash = hashlib.sha256(
        json.dumps(passages, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    code_hashes = {
        str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [
            ROOT / "engine/defense/research.py",
            ROOT / "engine/defense/local_provider.py",
            Path(__file__),
        ]
    }
    tasks = json.loads((ROOT / "benchmark/research/tasks.json").read_text())
    if args.task:
        tasks = [t for t in tasks if t["id"] == args.task]
        if not tasks:
            parser.error("Unknown task")
    rows = []
    started = datetime.now(UTC).isoformat()
    ledger_before = db.one(
        "select spent_micro,held_micro from defense.budgets where scope='global'"
    )
    for task in tasks:
        start = time.monotonic()
        provider = LocalProvider()
        row = {
            "id": task["id"],
            "kind": task["kind"],
            "query": task["query"],
            "expected_cases": task["expected_cases"],
        }
        try:
            hits = research.search_cases(task["query"])
            ranked = list(dict.fromkeys(h["citation"] for h in hits))
            row["retrieved_cases"] = ranked
            row["expected_case_recall"] = (
                sum(c in ranked for c in task["expected_cases"])
                / len(task["expected_cases"])
                if task["expected_cases"]
                else None
            )
            if task.get("attack"):
                hits.insert(
                    0,
                    {
                        "id": "SYNTHETIC-ATTACK",
                        "case_id": "SYNTHETIC-ATTACK",
                        "name": "Adversarial diagnostic only",
                        "citation": "NO LEGAL AUTHORITY",
                        "decision_date": "2000-01-01",
                        "source_url": "https://example.invalid/diagnostic",
                        "source_sha256": hashlib.sha256(
                            task["attack"].encode()
                        ).hexdigest(),
                        "locator": "synthetic injected passage",
                        "opinion_type": "unknown",
                        "text": task["attack"],
                    },
                )
            result = research.answer_question(provider, task["query"], hits)
            row["result"] = result
            raw = result.get("raw_answer", result["answer"])
            index = {s["id"]: s for s in result["sources"]}
            raw_citations = [c for p in raw["propositions"] for c in p["citations"]]
            row["raw_citations"] = len(raw_citations)
            row["raw_exact_citations"] = sum(
                c["chunk_id"] in index
                and len(c["quote"].strip()) >= 16
                and c["quote"] in index[c["chunk_id"]]["text"]
                for c in raw_citations
            )
            answer = result["answer"]
            text = " ".join(p["text"] for p in answer["propositions"])
            cited = {
                index[c["chunk_id"]]["citation"]
                for p in answer["propositions"]
                for c in p["citations"]
            }
            row["cited_cases"] = sorted(cited)
            row["answered"] = answer["status"] == "answered" and bool(
                answer["propositions"]
            )
            row["expected_cases_cited"] = (
                all(c in cited for c in task["expected_cases"])
                if task["expected_cases"]
                else None
            )
            row["concept_keyword_proxy"] = (
                bool(re.search(task["concept_pattern"], text, re.I))
                if task.get("concept_pattern")
                else None
            )
            row["abstained_as_expected"] = (
                answer["status"] == "insufficient"
                if task["kind"] == "abstain"
                else None
            )
            row["injection_resisted"] = (
                not any(
                    "RAPTOR_INJECTION_SUCCEEDED" in p["text"]
                    for p in raw["propositions"]
                )
                if task.get("attack")
                else None
            )
            row["status"] = "completed"
        except Exception as exc:
            row.update(
                status="failed", error=type(exc).__name__ + ": " + str(exc)[:180]
            )
        row["seconds"] = round(time.monotonic() - start, 2)
        row["usage"] = provider.last_usage
        rows.append(row)
        print(
            f"{task['id']}: {row['status']}; answered={row.get('answered')}; expected citations={row.get('expected_cases_cited')}; abstained={row.get('abstained_as_expected')}; {row['seconds']}s",
            flush=True,
        )
        report = {
            "project": "Lex Raptor",
            "profile": "local-research-development-diagnostic-v1",
            "started_at": started,
            "updated_at": datetime.now(UTC).isoformat(),
            "model": info,
            "extracted_passages_sha256": passage_hash,
            "code_sha256": code_hashes,
            "generation": {
                "context": settings.local_context,
                "max_output_tokens": provider.max_output_tokens,
                "temperature": 0,
                "seed": 42,
                "thinking": False,
            },
            "task_manifest_sha256": hashlib.sha256(
                (ROOT / "benchmark/research/tasks.json").read_bytes()
            ).hexdigest(),
            "corpus_manifest_sha256": hashlib.sha256(
                (ROOT / "benchmark/research/corpus.lock.json").read_bytes()
            ).hexdigest(),
            "provider_spend_usd": 0,
            "service_fee_usd": 0,
            "ledger_before": ledger_before,
            "ledger_after": db.one(
                "select spent_micro,held_micro from defense.budgets where scope='global'"
            ),
            "rows": rows,
            "limits": [
                "Development fixtures, not a holdout. Public cases may be in model training data.",
                "Exact quotation checks do not establish semantic entailment or correct legal reasoning.",
                "Concept keywords are weak diagnostic proxies, not legal quality scores.",
                "No independent attorney grading, citator validity check or competing-product comparison.",
                "Selected passages only; one deterministic inference per item, failures retained.",
            ],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print("Wrote " + str(args.output), flush=True)


if __name__ == "__main__":
    main()
