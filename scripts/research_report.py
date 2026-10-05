"""Summarize measured diagnostics without manufacturing legal-quality scores."""

import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
report = json.loads((ROOT / "benchmark/research/local-results.json").read_text())
rows = report["rows"]
answers = [r for r in rows if r["kind"] == "answer"]
abstentions = [r for r in rows if r["kind"] == "abstain"]
attacks = [r for r in rows if r["kind"] == "adversarial"]
known = [r for r in rows if r["expected_cases"]]
completed = sum(r["status"] == "completed" for r in rows)
raw = sum(r.get("raw_citations", 0) for r in rows)
exact = sum(r.get("raw_exact_citations", 0) for r in rows)
rejected = sum(
    r.get("result", {}).get("checks", {}).get("rejected_propositions", 0) for r in rows
)
latencies = [r["seconds"] for r in rows]
input_tokens = sum(r.get("usage", {}).get("input_tokens", 0) for r in rows)
output_tokens = sum(r.get("usage", {}).get("output_tokens", 0) for r in rows)
lines = [
    "# Lex Raptor: local research diagnostic",
    "",
    f"Run started {report['started_at']}. Model: **{report['model']['model']}**, digest `{report['model']['digest']}`. Local inference only; **$0 provider charges and $0 service fees**. Hardware and electricity costs are not measured.",
    "",
    f"This is a {len(rows)}-item development diagnostic on 12 public U.S. Supreme Court opinions (1938–2014), not a hidden holdout or a comparison with Casetext/Westlaw. Public landmark cases may be in training data. No independent attorney evaluation has been completed.",
    "",
    "**Retained answers contain substantive errors.** An assistant spot-check found that the Erie answer omitted an express exception and attached unsupported quotations to two other claims. Literal quotation checks did not remove those statements. See the [qualitative review](QUALITATIVE_REVIEW.md) for the exact statements, passage IDs and limitations. This prototype needs source-by-source human review; the metrics below are not a legal-accuracy score.",
    "",
    "| Measurement | Observed result |",
    "| --- | --- |",
    f"| Completed structured responses | {completed}/{len(rows)} |",
    f"| Retrieval included every expected case (among up to 12 passages) | {sum(r.get('expected_case_recall') == 1 for r in known)}/{len(known)} |",
    f"| Answerable questions produced at least one retained proposition | {sum(bool(r.get('answered')) for r in answers)}/{len(answers)} |",
    f"| Answerable questions cited every expected case | {sum(bool(r.get('expected_cases_cited')) for r in answers)}/{len(answers)} |",
    f"| Raw generated quotations exactly matched a selected passage | {exact}/{raw} |",
    f"| Propositions removed by exact-quotation gate | {rejected} |",
    f"| Insufficient-evidence/current-validity questions abstained | {sum(bool(r.get('abstained_as_expected')) for r in abstentions)}/{len(abstentions)} |",
    f"| Injected source command did not appear as a model conclusion | {sum(bool(r.get('injection_resisted')) for r in attacks)}/{len(attacks)} |",
    f"| End-to-end latency, median / maximum | {statistics.median(latencies):.2f}s / {max(latencies):.2f}s |",
    f"| Returned input / output tokens | {input_tokens:,} / {output_tokens:,} |",
    f"| Global paid ledger unchanged | {report['ledger_before'] == report['ledger_after']} |",
    "",
    "Quotation matching measures literal source fidelity, not entailment or legal accuracy. Removed statements are not counted as successful answers. The citation-case check only verifies source identity. The injection test covers one simple attack, not general prompt-injection resistance.",
    "",
    "| Task | Completed | Retained answer | Expected cases cited | Expected abstention | Raw exact quotes |",
    "| --- | --- | --- | --- | --- | --- |",
]


def mark(value):
    return "—" if value is None else "yes" if value else "**no**"


for r in rows:
    lines.append(
        f"| {r['id']} | {mark(r['status'] == 'completed')} | {mark(r.get('answered'))} | {mark(r.get('expected_cases_cited'))} | {mark(r.get('abstained_as_expected'))} | {r.get('raw_exact_citations', 0)}/{r.get('raw_citations', 0)} |"
    )
lines += [
    "",
    "## Development history",
    "",
    "The [initial full run](initial-overabstention-results.json) abstained on all 11 answerable questions. The adapter then began including the output schema in the model's instructions as well as its constrained-decoding format, and the research instructions clarified that untrusted source text may still supply evidence. Including the schema in the prompt follows [Ollama's structured-output guidance](https://docs.ollama.com/capabilities/structured-outputs). The complete 15-item suite was rerun with the same tasks, corpus and model. These are development iterations, not independent holdout results or a controlled experiment isolating either change. Both runs are retained; no paid grader was used.",
    "",
    "## Reproduction and interpretation",
    "",
    "Run `scripts/import_cases.py --fetch-starter`, then `scripts/research_benchmark.py` and `scripts/research_report.py` with the local model installed. Use a library containing exactly the pinned corpus; the runner rejects additional/mismatched case records. It verifies the cached original JSON hashes and records a hash of every extracted passage, source-code hashes, model digest, request hashes, generation settings, token counts and latency. One call per task; failures stay in the denominator. The report JSON retains raw answers and rejected content for inspection, while the application hides rejected propositions.",
    "",
    "The optional `concept_keyword_proxy` fields in the JSON are deliberately excluded from headline scores: finding a word in an answer is not proof of sound legal reasoning. The suite does not measure broad jurisdiction coverage, retrieval on millions of cases, the legal validity of authorities, completeness, work saved for an attorney, privacy certification or production scalability.",
    "",
    "Software validation: 45 Python tests pass. Browser checks cover real local authentication, search, full-opinion reading, embedded-dissent labels, date filtering, mobile layout, source escaping, uploads and durable ingestion. A live smoke exercised local research and synthetic-document drafting through the durable worker, with attorney approval left pending and the paid ledger unchanged. The generated research answer was also checked in desktop/mobile browsers. Earlier MVP web/worker images built and their database/API/source-download paths were checked locally; the final prompt-adapter fix was tested in the native local runtime. Public deployment and managed customer billing are not enabled.",
    "",
    "Machine-readable results: [local-results.json](local-results.json). Pinned tasks: [tasks.json](tasks.json). Corpus: [corpus.lock.json](corpus.lock.json).",
]
(ROOT / "benchmark/research/RESULTS.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines[4:22]))
