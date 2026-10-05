# Conversation and topic-search checks — 2026-10-05

This is a small development regression set, not a representative legal-accuracy
benchmark or an attorney evaluation. It tests whether chat asks for consequential
missing details, retains follow-up context, proceeds on clear requests, and
retrieves useful evidence. Routing success is separate from answering correctly.
All model runs used the hosted `gpt-6-luna` configuration and existing $10 ledger.
No answers, case mappings, claim categories or Georgia-specific clarification
rules were hardcoded into the application.

## Observations

| Request | Observed behavior |
| --- | --- |
| Statute of limitations in Georgia | Asks the type of claim instead of guessing one period or searching immediately. Final check: 3.940 s. |
| “Can my landlord do that?” | Asks what happened and where. |
| Secretly recording a boss at work | Asks the jurisdiction. |
| Time to appeal | Asks the court and kind of decision/case. |
| Enforceability of a noncompete | Asks the governing state or work location. |
| Greeting | Invites a legal question, without database retrieval. |
| Current Japanese inheritance law | Discloses the U.S. source coverage limit and offers a useful next step. |
| Celotex summary judgment burden | Proceeds directly; one finding with a matching quotation from the selected offline CAP source. |
| “Personal injury” after the Georgia question | Final check retains Georgia and limitations, uses semantic search scoped to Georgia appellate courts, and produces two findings from a 2025 opinion. 19.816 s; 2/2 quotations match supplied text. |
| California security-deposit return deadline | Correctly proceeds and scopes to California courts, but retrieved excerpts do **not** support the deadline. The retained finding is an abstention, not a successful answer. 44.645 s. |
| General New York written-contract limitation period | Retrieves New York opinions and states the general six-year rule/accrual at breach from a supplied excerpt. Exceptions and current statutory text were not independently checked. 36.056 s. |
| General overview of Georgia civil limitation periods | Respects the request for an overview; retrieves Georgia opinions, with four findings about selected periods, accrual, tolling and a distinct municipal notice requirement. This is a partial overview, not a complete schedule. 27.331 s. |

The final Georgia findings were manually compared with the retrieved passage of
[Cummings v. First Transit](https://www.courtlistener.com/opinion/10645313/robyn-leah-cummings-v-first-transit-inc/)
(July 31, 2025). That passage discusses the general personal-injury period and
application of a weekend extension in that case. This narrow passage review does
not independently verify present validity, every exception, or anyone's deadline.

## Failures retained and changes made

- `initial-results.json` contains all nine first-round requests. Their routing
  matched expectations, but the Georgia personal-injury follow-up produced no
  answer: ordinary keyword search returned unrelated opinions. Federal Register
  full-text requests also reported rate limits. Neither failure is removed.
- `intermediate/` contains the entire twelve-request second round. Eleven actions
  matched expectations. The personal-injury reply prompted another subdivision
  of the claim instead of general research; this is counted as over-clarification.
- Automatic topic retrieval now uses CourtListener semantic search. Free source
  probes showed that semantic search alone still returned other states' cases.
  Explicit single-state law questions therefore use a verified state-appellate
  court mapping for all 50 states and DC. Named cases and manual queries retain
  keyword search, and manual court/query selections take precedence.
- The planner was then told to proceed after a meaningful category and
  jurisdiction are supplied, reserving further questions for materially missing
  context or fact-specific requests. The two affected turns were rerun and are
  saved as `final-georgia.json` and `final-followup.json`. Both actions matched
  expectations, and the follow-up produced supported findings.
- Some intermediate search queries included an assumed answer (a period or
  section). Final planning guidance prohibits guessed answers in search terms.
  The final Georgia search contains no guessed deadline or statute citation.
- The final prompt revision was retested on those two turns, not on the entire
  twelve-request set. The California deadline remains an unresolved retrieval
  failure; do not count a literal quotation or an abstention as answer accuracy.

The initial run used Site source `1fcc05ee2467c69201dd3b9305fe4d2ed6ea102f`;
the twelve-request run used `bf3a8db8c7e14b5990d46a1a6c7b856e2152b78e`;
the final two-turn check used `80170bcdb3fb13ce43cdf5f7a9d68140ede61192`.

## Engineering checks and spending

39 automated tests pass, including no retrieval/drafting on clarification,
planning-only cost settlement, idempotency, short-reply context, local operation,
invalid follow-up rejection, bounded inputs, semantic search, court/date filters,
manual overrides, source isolation, documents, progress streams and the atomic
lifetime cap. Browser checks cover the small 60×24 meteor/Earth loader, reduced
motion, retained homepage T. rex, editable suggestions, context reset on New chat,
no false source counts on clarification, and a 390-pixel layout.

The 23 hosted requests charged **$0.017556** to the conservative application
ledger. Total lifetime charges/reservations were **$0.167562** after the run,
leaving **$9.832438** of the unchanged $10 cap. This is application accounting,
not an independently reconciled provider invoice. Source probes made no OpenAI
calls. No paid data subscription or automatic upgrade was added.

## Limits and reproduction

State codes, local ordinances, the U.S. Code and comprehensive foreign law are
not directly connected. The UI discloses relevant coverage gaps. State appellate
scoping can omit federal interpretations and trial decisions. Semantic ranking,
three-opinion retrieval and selected excerpts can still miss the governing rule.
Clarification and routing remain model decisions, not guarantees. Quote matching
does not establish legal entailment, correct application or current validity.

From `website/`:

```sh
npm run build && npm test
node scripts/diagnose-conversation.mjs
# Explicit hosted spending opt-in; no retries; existing server cap remains:
node scripts/diagnose-conversation.mjs https://lexraptor.com --allow-api-spend
```

The diagnostic makes at most twelve requests (at most $0.24 of reservations),
writes raw responses to ignored `.local-data/conversation/`, reports routing and
quotation counts, and requires manual review. Local runs use the configured
Ollama model and may behave differently. These are public synthetic questions;
do not substitute private client facts into published benchmark records.
