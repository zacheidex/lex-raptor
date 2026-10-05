# Hosted demo smoke checks — 2026-10-05

The deployed demo now uses **GPT-6 Luna**, Responses API, standard service,
low reasoning, a 4,096-token output ceiling, and the 12-case CAP starter corpus.
These are deployment checks on public questions, not a legal-accuracy benchmark.
The local Qwen diagnostic in `benchmark/research` evaluates a different model
and retriever and must not be presented as the hosted model's score.

## Current model

One live Celotex question completed through the actual public browser UI:

| Check | Observed |
| --- | --- |
| Model | gpt-6-luna |
| End-to-end request latency | 3.312 seconds |
| Input / output tokens | 4,003 / 227 |
| Displayed propositions | 2 |
| Quotations matching retrieved passages | 2 / 2 |
| Propositions removed | 0 |
| Conservative app-ledger charge | $0.001015 |

The browser check also verified passcode unlock, an initially disabled submit
button, rejection of empty database selection in the UI, a visible original
logo, no horizontal overflow at a 390-pixel viewport, rendering the real model
answer, citation links opening matching passages, and logout locking the demo.
No browser JavaScript errors occurred. The raw public question, answer and
retrieved passages are in `smoke-results.json`.

The sample preserved the discovery and trial-burden qualifications in its two
propositions. Literal quotation matching does not establish legal entailment,
complete coverage, opinion context, or current validity. There has been no
independent attorney review. This is one answerable example, with no confidence
interval, representative sample, baseline comparison, or general accuracy claim.

## Controls and earlier probes

Six local Workers/D1 integration tests passed. They exercise passcode and origin
checks, invalid database selections, fabricated evidence removal, idempotency,
30 concurrent requests contending for the last reservation (only one admitted),
provider-failure holds, daily visitor limits, and passcode-attempt throttling.
Those automated tests use a simulated provider and incur no model charges.

Before the cheaper-model request, GPT-5.3-Codex completed three live probes:
Celotex (8.29 seconds, four retained quotations), current validity of Twombly
(6.90 seconds, abstention), and a weak injection sanity check (9.23 seconds,
four retained quotations). The injection prompt also contained a corrective
instruction, so it is not persuasive evidence of adversarial robustness.
Those outcomes belong to GPT-5.3-Codex, not GPT-6 Luna. A duplicate live request
was rejected with HTTP 429 and an unauthenticated request with HTTP 401.

GPT-5.1-Codex Mini returned `model_not_found`; its shutdown notice showed it had
retired. One immediately post-publish browser attempt also reached that previous
Worker version before the new model reached the edge. The final browser check
verified the live model identity before submitting. All four rejected/uncertain
attempts retain their original reservations; none were silently refunded.

## Cost and remaining allowance

At the end of setup, the shared ledger had four completed calls totaling
**$0.048935** in conservative accounted usage and **$0.08** still held for four
failed requests. Total allowance consumed or reserved: **$0.128935**; remaining:
**$9.871065**. This is the app's ledger, not a provider invoice. GPT-6 Luna input
accounting deliberately allows both the normal input price and a cache-write
allowance and therefore overestimates ordinary input charges.

The same $10 lifetime cap survives the model changes and deployments. New calls
reserve $0.02 atomically. The demo does not reset the spending ledger, retry
model calls automatically, or select a more expensive fallback. Rates were
checked against official model/pricing documentation on 2026-10-05.

Eight paid-request attempts used the setup network's rolling 10-per-day limit;
two remain for that network until those attempts age out. Other visitors have
their own network/session limits but share the same $10 total allowance.

## Public access update — 2026-10-05

After the smoke checks above, the owner removed the passcode requirement.
Research now works without an account or cookie. The six updated local
Workers/D1 tests passed with a simulated provider and no API spending. They
verify no-cookie research, origin and database validation, missing edge-IP
rejection, duplicate-request rejection, concurrent budget admission, failure
reservations, and preservation of historical daily limits after opening access.
The unchanged lifetime ledger and IP-hashing secret preserve existing charges
and network limits. No additional live model call was made for this change;
the earlier passcode and logout observations describe the prior deployment.
