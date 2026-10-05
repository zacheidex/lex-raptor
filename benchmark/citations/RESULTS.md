# Fresh citation review — October 5, 2026

The final live run returned the expected verdict for **7 of 7 focused diagnostic cases** on gpt-6-luna. This is a small, deliberately constructed regression set, not a general legal-accuracy score or an independent evaluation of model reliability.

| Source | Accurate claim | Deliberately wrong claim |
| --- | --- | --- |
| National Archives First Amendment transcription | Supported | Contradicted |
| Supreme Court Dobbs PDF, June 24, 2022 | Supported | Contradicted |
| Georgia Code § 9-3-32, explicitly identified 2024 edition | Supported | Contradicted |
| Deliberately nonexistent government page | Unverified | — |

Raw claims, expected outcomes, progress events, source retrieval methods and the review’s evidence excerpts are retained in [live-results.json](live-results.json). The test distinguishes a historical edition from a claim about current law. It does not determine whether Georgia's law changed after that edition, comprehensively check case treatment, or assess a real person's circumstances.

The initial batch-reader attempt matched 3 of 7 expectations: the HTML pair and the unavailable page. It reported only one attributable open-page record; the PDF and statute findings were left unverified. Those results are preserved in [iteration-batched-reader.json](iteration-batched-reader.json). The fix reads each unavailable URL in its own bounded request. The four-call total and lifetime spending ledger are unchanged. The final request completed in 29.51 seconds.

All three readable sources in this hosted run were read through the provider's web reader after direct publisher fetches failed. Their excerpts are clearly labeled as provider-reported transcriptions. They are not independently authenticated verbatim copies. The support review is a separate model call with no search tools; it receives the claims and retrieved excerpts. The reader receives only the public URLs. A completed open-page record for the exact URL is required before its text is eligible. Search snippets and remembered law cannot qualify on their own.

67 automated tests pass. The new tests cover fresh-text evidence, invented evidence IDs, missing companion pages, PDF open provenance, unsafe URLs and redirects, credential isolation, duplicate requests, lifetime-cap enforcement, held uncertain costs, and local-mode isolation. Browser checks at 390px and 1440px cover the fixed cyan SVG, removed labels, one-click recheck, progress, contradictory finding display, reviewed excerpts and layout. Existing one-click CourtListener checks also pass.

The two live diagnostic requests charged **$0.063953** in the conservative ledger; the final request used four web calls. At measurement, lifetime charged or held spending was **$1.741141 of $10**, including **$0.38 held** from earlier uncertain requests. No reservations were reset or refunded. See [metrics.json](metrics.json).

Run `python3 benchmark/citations/live-check.py https://lexraptor.com /tmp/recheck.json` only when live spending is authorized. It uses the public endpoint and the site's existing cap. Browser checks use a local workbench and mocked research/recheck responses, spending no API credits. No API keys or visitor identifiers are in these files.
