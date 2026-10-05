# Workbench development diagnostic — 2026-10-05

This update adds live public-data search and structured research workflows. These
are small development and integration checks, not a legal-accuracy benchmark,
an independent attorney review, or a comparison against Westlaw/CoCounsel or
Lexis+ AI. The prompts below were used during development and are **not held out**.

## Final local model run

Model: Qwen3:14b via local Ollama, thinking disabled, temperature 0, 16,384-token
context, 4,096-token output cap. API-model spending: **$0**. Source searches used
the bundled CAP opinions or the public eCFR/Federal Register services.

| Task | HTTP | Retained claims / exact quotations | Rejected claims | Missing sections | Seconds |
| --- | --- | --- | --- | --- | --- |
| case_brief | 200 | 5 / 5 | 3 | Issue | 10.828 |
| case_comparison | 200 | 6 / 6 | 2 | Shared rule, Practical implications | 9.92 |
| opposing_arguments | 200 | 3 / 3 | 5 | None | 9.107 |
| regulation_research | 200 | 6 / 6 | 2 | None | 12.953 |
| proposed_rule_memo | 200 | 6 / 6 | 2 | Application, Conclusion | 9.421 |
| absent_current_treatment | 200 | 0 / 0 | 0 | Findings | 0.351 |

The five answerable tasks produced 26 retained claims; all retained quotations matched the exact extracted passage because nonmatching claims were removed. 14 generated claims were removed. Median elapsed time across the six requests: 9.67 seconds.

The current-validity task returned no propositions. This is one abstention
example, not an estimate of false-answer rates.

## What still failed or remains uncertain

- The case brief omitted the issue section after quotation validation.
- The comparison omitted shared-rule and practical-implications sections, and
  its retained findings were repetitive. A comparison interface does not mean
  a complete comparative legal analysis.
- The arguments task sometimes labels a rebuttal as a supporting argument.
- The broad regulation query mixed veterans benefits and state vocational
  rehabilitation provisions, including tangential pre-employment material.
  Better search constraints and human relevance review remain necessary.
- A literal quotation may be accurate while the associated proposition is too
  broad, omits an exception, or misstates the procedural or opinion context.
  These checks do not establish entailment, controlling authority, good-law
  status, or completeness of adverse authority.

## Development changes and earlier runs

The initial run is retained in `initial-results.json`. Both regulatory tasks
produced zero retained claims in that run. Inspection found that the model
sometimes returned a document ID instead of a passage ID. The second run,
`intermediate-results.json`, used short passage IDs constrained by the output
schema; regulation research improved but the Federal Register memo still failed.

Federal Register quotations differed mainly in publisher line wrapping. The
final extraction collapses whitespace **before** passage ranking, prompting,
display and validation. It does not fuzzy-match a generated quotation or rewrite
its words to force acceptance. Locators explicitly say whitespace-normalized
extracted text; original source links remain available. The same prompts were
rerun after this change, so their results are development evidence only.

## Source and application checks

- Twelve local Workers/D1 integration tests passed using simulated providers.
  They cover source selection, dated/full-text evidence, partial outages,
  credential boundaries, blocked source destinations, citation lookup, local
  inference without an API key, origin checks, duplicate requests, historical
  visitor limits, concurrent budget admission, and held failure reservations.
- Real CourtListener search returned 499 reported matches for `caseName:Celotex`
  and eight retrieved passages from up to three opinion records. One earlier
  broad search timed out at 20 seconds. The adapter now avoids unnecessary
  highlighting and allows 45 seconds for CourtListener. Failed searches stay
  visible; they are not represented as searches with no relevant authorities.
- A real citation lookup matched `477 U.S. 317` to the Celotex record. It did not
  check later treatment or legal support.
- Real eCFR and Federal Register searches fetched full text. Search-result
  snippets are never passed to the model as evidence.
- Browser checks covered database selection, source rendering, citation links
  opening their passage, exports retaining the submitted question after editing,
  and a 390-pixel layout with no horizontal overflow or JavaScript errors.

The raw public-source results accompany this report. No provider tokens, IP
hashes, session cookies, request identifiers, or private documents are included.

The hosted demo uses a different model (GPT-6 Luna); these local-model outcomes
must not be described as its scores. The original $10 hosted lifetime budget and
historical charges remain intact.

## Hosted production check

After publishing, a real CourtListener search from lexraptor.com completed in
1.86 seconds and returned eight passages from the live collection. The new
source-cache and provider-counter tables were present in the deployed database.
An attempted hosted regulatory AI draft returned HTTP 429 because the testing
network had already consumed its rolling ten-request allowance. The test stopped
without another model attempt. The lifetime ledger stayed at **$0.130570**
consumed or reserved (**$9.869430** remaining), so this update added **$0** in
model API spending. The UI now reports daily allowance and the next available
slot before submission; source search stays enabled.

The new prompts were therefore not smoke-tested against GPT-6 Luna on the live
server. Existing provider behavior was covered by earlier deployment checks,
and the new request/validation paths by simulated-provider tests. This limit is
reported explicitly rather than bypassing the established request controls.
