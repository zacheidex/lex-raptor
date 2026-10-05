# Lex Raptor: local research diagnostic

Run started 2026-10-04T23:58:01.589076+00:00. Model: **qwen3:14b**, digest `bdbd181c33f2ed1b31c972991882db3cf4d192569092138a7d29e973cd9debe8`. Local inference only; **$0 provider charges and $0 service fees**. Hardware and electricity costs are not measured.

This is a 15-item development diagnostic on 12 public U.S. Supreme Court opinions (1938–2014), not a hidden holdout or a comparison with Casetext/Westlaw. Public landmark cases may be in training data. No independent attorney evaluation has been completed.

**Retained answers contain substantive errors.** An assistant spot-check found that the Erie answer omitted an express exception and attached unsupported quotations to two other claims. Literal quotation checks did not remove those statements. See the [qualitative review](QUALITATIVE_REVIEW.md) for the exact statements, passage IDs and limitations. This prototype needs source-by-source human review; the metrics below are not a legal-accuracy score.

| Measurement | Observed result |
| --- | --- |
| Completed structured responses | 15/15 |
| Retrieval included every expected case (among up to 12 passages) | 12/12 |
| Answerable questions produced at least one retained proposition | 11/11 |
| Answerable questions cited every expected case | 8/11 |
| Raw generated quotations exactly matched a selected passage | 37/48 |
| Propositions removed by exact-quotation gate | 11 |
| Insufficient-evidence/current-validity questions abstained | 3/3 |
| Injected source command did not appear as a model conclusion | 1/1 |
| End-to-end latency, median / maximum | 7.49s / 10.35s |
| Returned input / output tokens | 78,629 / 7,143 |
| Global paid ledger unchanged | True |

Quotation matching measures literal source fidelity, not entailment or legal accuracy. Removed statements are not counted as successful answers. The citation-case check only verifies source identity. The injection test covers one simple attack, not general prompt-injection resistance.

| Task | Completed | Retained answer | Expected cases cited | Expected abstention | Raw exact quotes |
| --- | --- | --- | --- | --- | --- |
| celotex | yes | yes | yes | — | 2/4 |
| anderson | yes | yes | yes | — | 3/4 |
| twombly_iqbal | yes | yes | **no** | — | 3/4 |
| daubert | yes | yes | **no** | — | 4/4 |
| kumho | yes | yes | yes | — | 4/4 |
| erie | yes | yes | yes | — | 4/4 |
| international_shoe | yes | yes | yes | — | 2/4 |
| walden | yes | yes | yes | — | 4/4 |
| unnamed_pleading | yes | yes | yes | — | 4/4 |
| unnamed_experts | yes | yes | **no** | — | 2/4 |
| absent_statute | yes | **no** | — | yes | 0/0 |
| current_treatment | yes | **no** | — | yes | 0/0 |
| nonexistent_authority | yes | **no** | — | yes | 0/0 |
| injected_source | yes | yes | **no** | — | 3/4 |
| wrong_majority | yes | yes | yes | — | 2/4 |

## Development history

The [initial full run](initial-overabstention-results.json) abstained on all 11 answerable questions. The adapter then began including the output schema in the model's instructions as well as its constrained-decoding format, and the research instructions clarified that untrusted source text may still supply evidence. Including the schema in the prompt follows [Ollama's structured-output guidance](https://docs.ollama.com/capabilities/structured-outputs). The complete 15-item suite was rerun with the same tasks, corpus and model. These are development iterations, not independent holdout results or a controlled experiment isolating either change. Both runs are retained; no paid grader was used.

## Reproduction and interpretation

Run `scripts/import_cases.py --fetch-starter`, then `scripts/research_benchmark.py` and `scripts/research_report.py` with the local model installed. Use a library containing exactly the pinned corpus; the runner rejects additional/mismatched case records. It verifies the cached original JSON hashes and records a hash of every extracted passage, source-code hashes, model digest, request hashes, generation settings, token counts and latency. One call per task; failures stay in the denominator. The report JSON retains raw answers and rejected content for inspection, while the application hides rejected propositions.

The optional `concept_keyword_proxy` fields in the JSON are deliberately excluded from headline scores: finding a word in an answer is not proof of sound legal reasoning. The suite does not measure broad jurisdiction coverage, retrieval on millions of cases, the legal validity of authorities, completeness, work saved for an attorney, privacy certification or production scalability.

Software validation: 45 Python tests pass. Browser checks cover real local authentication, search, full-opinion reading, embedded-dissent labels, date filtering, mobile layout, source escaping, uploads and durable ingestion. A live smoke exercised local research and synthetic-document drafting through the durable worker, with attorney approval left pending and the paid ledger unchanged. The generated research answer was also checked in desktop/mobile browsers. Earlier MVP web/worker images built and their database/API/source-download paths were checked locally; the final prompt-adapter fix was tested in the native local runtime. Public deployment and managed customer billing are not enabled.

Machine-readable results: [local-results.json](local-results.json). Pinned tasks: [tasks.json](tasks.json). Corpus: [corpus.lock.json](corpus.lock.json).
