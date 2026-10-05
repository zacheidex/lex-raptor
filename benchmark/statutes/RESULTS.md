# Legal research development evaluation — 2026-10-05

These are development checks, manually reviewed by the coding agent against source
text and selected primary authorities. They are not attorney grading, a random
sample of legal questions, a blinded evaluation, or a comparison with Westlaw or
Lexis. Failed and partial outputs are preserved. Model and retrieval outputs vary
between runs. No case-specific answer or source map is hardcoded in the runtime.

## What changed

Hosted research now supplements CourtListener, eCFR and Federal Register with
selective Public legal web retrieval for statutes, official guidance and municipal
codes. Users can select databases themselves. The same inexpensive gpt-6-luna
model plans the request and drafts with medium reasoning and up to four web-tool
calls. The planner tracks up to four requested issues; issues without retained
findings are displayed. This bookkeeping does not measure substantive completeness.

Downloaded passages use exact segment IDs. Web references must appear in actual
provider source records, citation annotations, or completed page-open operations,
and pass the legal-source allowlist. Empty cache-busting parameters on government
PDFs and known tracking parameters are normalized; content-selecting parameters
are preserved. A completed open operation establishes URL provenance, not page
availability or legal support. Web text is not independently downloaded or
quote-checked. These distinctions remain visible to users.

Validated attachments no longer trigger a false request to upload again. Foreign-law
questions receive a coverage response when the available U.S. sources cannot answer;
foreign documents can still be analyzed as supplied text. Clarification chips submit
immediately. The compact meteor animation has an impact effect and respects reduced
motion. One-click citation checks compare saved quotations and request fresh case
records; they do not certify statutory correctness, entailment or current validity.

Feedback is available without an account: Helpful / Needs work, optional category
and note, and a separate unchecked-by-default option to share the question and answer.
Original attachments are never copied into feedback. Local browser checks and a
synthetic production write verified saving and the privacy default.

## Retained iterations

- [Revision 7](iterations/revision7.json), 6 live requests: two web calls, low
  reasoning and one web source per finding. Georgia property research retrieved a
  niche real-property case without the general personal-property rule. Atlanta
  claims combined city and state rules with insufficient source attribution.
- [Revision 8](iterations/revision8.json), 6 requests: resolved conversation topic
  and multiple citations improved coverage, but an Atlanta city source was outside
  the allowlist. A later test omitted medical detail and repeated a federal schedule
  statement without checking 2026 changes. An invented-case control cited an
  unrelated volume as support for nonexistence. These are substantive failures.
- [Revision 9](iterations/revision9.json), 21 questions across state deadlines,
  current law, comparisons, false premises, invented authorities, ambiguity,
  source-selection controls, Spanish and synthetic documents. Five clear failures:
  Roe's main finding was discarded; Japan was routed into U.S. research; two valid
  attachments were treated as missing; the Spanish answer lost its references.
  Other useful answers retained qualifications; Atlanta's overview was incomplete.
- [Revision 10](iterations/revision10.json), 10 targeted replays: Roe, Spanish,
  foreign scope, contract analysis and chronology recovered. Invented authority
  still yielded no fabricated findings. Georgia remained partial when a completed
  page-open URL was absent from the validator's search-results list. That led to
  the general page-open provenance fix in revision 11.
- [Revision 11](iterations/revision11.json), 6 requests, including four previously
  unused tasks: the memo and French-document summary were useful; Spanish remained
  useful. Georgia still lost its general-rule finding when the model rewrote a
  historical code URL as current. The Gideon brief and Miranda arguments lost
  findings because opinion pages from Justia/Cornell were excluded. Revision 12
  adds those recognized opinion collections, improves brief excerpt selection,
  and explicitly preserves edition URLs and separates distinct rule findings.

The early “Both” replay did not reproduce the user's exact clarification exchange.
The broader rounds use that exchange explicitly. Both a clarification and a
supported overview can be reasonable responses to an initial broad question;
routing alone is not a correctness score.

- [Revision 12](iterations/revision12.json), 3 replays: Georgia retained the general
  realty and personalty rules with edition disclosure; Gideon retained all four
  requested brief sections. Miranda failed during planning (a 502 response),
  before drafting. Revision 13 puts the existing planner length/count bounds into
  the structured schema and gives planning more output headroom. The exact cause
  of that prior formatting failure was not recorded, so a successful replay does
  not prove its root cause.

- [Revision 13](iterations/revision13.json), 2 replays: Roe retained the Dobbs
  holding and Miranda produced supported arguments, distinguishing Harris’s
  majority and dissent, involuntary statements, and separate state-law research.
  Its issue labels awkwardly split a sentence, so issue bookkeeping still needs
  refinement even when the answer is useful.

## Review criteria and observations

| Topic | Expected behavior / observed qualification |
| --- | --- |
| Georgia property damage | General four-year periods for realty and personalty, supported by code or relevant authority; distinguish accrual exceptions and product repose. Historical code editions must be labeled. Revision 9 reached both; revision 10 lost personalty and is partial. |
| Atlanta marijuana | Distinguish recreational state law, city penalties and medical authorization. Current answers must account for 2026 changes. Revisions 9–10 found the expanded medical program; revision 10 also found DEA's medical rescheduling. Historical 2017 city publicity does not prove the ordinance's current text. A compressed “THC or medical cannabis” quantity phrase is imprecise and should be checked against the THC-based statutory measure. |
| California deposit | General 21-day return/itemization rule with deduction and estimate qualifications. Both English and Spanish answers became useful; this does not cover every statutory exception. |
| New York contract | General six-year period and breach accrual. Special contract categories can differ. |
| Florida negligence | Two-year general deadline for the supplied 2025 accident, rather than the pre-2023 general rule. |
| Copyright clip | Reject a universal 30-second exemption; explain contextual fair use. |
| Call recording | Distinct California confidential-call and New York consent rules, with interstate complexity; avoid implying a complete multi-jurisdiction opinion. |
| FTC noncompete | The rule is not operative; the current source includes its February 2026 removal from the CFR. |
| Chevron / Roe | Report Loper Bright / Dobbs and the scope of the later holding, without a comprehensive good-law claim. |
| Invented case / statute | Leave unsupported; do not invent an authority or cite an unrelated page as proof of nonexistence. |
| Ambiguous appeal / landlord | Ask the consequential missing detail without guessing a deadline or facts. |
| Missing / valid document | Ask for an absent file; analyze an attached one. Do not obey embedded instructions. |
| CAP-only scope | Respect the chosen library; abstain if it does not support the requested Georgia rule. |

Primary spot-check references include [Georgia medical-program guidance](https://www.gmcc.ga.gov/faqs),
[the signed 2026 SB 220](https://gov.georgia.gov/document/2026-signed-legislation/sb-220/download),
[DEA regulatory actions](https://www.dea.gov/marijuana-rescheduling-regulatory-actions),
[California's tenant guide](https://www.dre.ca.gov/publications/ResourceGuidebook/gb10_movingout.html),
[New York CPLR 213](https://www.nysenate.gov/legislation/laws/CVP/213),
[Florida limitations text](https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0095/Sections/0095.11.html),
[Copyright Office fair-use guidance](https://www.copyright.gov/help/faq/faq-fairuse.html),
and [the FTC's February 2026 rule](https://www.govinfo.gov/content/pkg/FR-2026-02-12/pdf/2026-02866.pdf).
These establish selected checks, not validation of every sentence in every answer.

## Local model

A real CLI/Ollama qwen3:14b run analyzed the synthetic contract without OpenAI calls.
It found the payment inconsistency and termination provisions, but speculated about
why the injected instruction was present. The [raw result](iterations/local-document.json)
is retained as a partial-quality result. Local and hosted performance are not equivalent.

## Reproduction and limits

Run the hosted suite only with an authorized budget:

```sh
cd website
node scripts/diagnose-stress.mjs https://your-host --allow-api-spend
node scripts/diagnose-stress.mjs https://your-host --allow-api-spend --cases=roe,document_review
```

Runs save new files under ignored `.local-data/stress/`, stop on errors and never
retry automatically. Synthetic documents contain no client information. Browser
checks in this directory use the existing apps/web Playwright installation and a
local workbench on port 8787; research is mocked for UI checks, with real local
feedback database writes. The hosted feedback smoke was synthetic and used no AI.

The $10 lifetime cap is unchanged, across users and deployments. A hosted web
request reserves $0.40 before drafting; known usage settles against conservative
model rates plus $0.01 per executed web call. Excerpt-only/planning requests reserve
$0.02. Unknown costs retain their reservations. No ledger was reset or refunded.

Remaining limits: selective retrieval, historical code editions, partial issue
coverage, incomplete exception handling, nondeterministic model behavior, provider
outages and no comprehensive citator. A valid URL or exact quotation is not proof
that a legal conclusion follows. A specialist should review findings before reliance.

## Final validation and cost

61 automated checks passed. The four browser checks cover immediate clarification
submission, impact/reduced motion, web-citation display/export, one-click citation
lookup, feedback consent/updating, feedback after a research error, and mobile
layout. A real production feedback write retained no shared question/answer; a
fresh CourtListener lookup matched Celotex without a model call.

There were **54 live research requests** across revisions 7–13, with every raw
iteration preserved. One revision-12 request returned a planning-format error.
These are iterative development runs, not 54 independent questions or a held-out
accuracy score. Four new workflow tasks were introduced after the initial broad
suite; failed tasks were then replayed after changes. The final targeted replays
were useful, but the earlier failures show sensitivity to retrieval and model
choices. Comprehensive source coverage and legal reliability are not established.

The matching benchmark ledger rows total **$1.413336**, comprising $1.113336
in completed conservative charges and $0.300000 held for uncertain earlier calls.
The whole hosted ledger is **$1.63981 of $10**, including
$0.38 in held reservations, as of 2026-10-05T08:14:12.402Z. This is the application's
conservative estimate, not a provider invoice. Feedback and citation lookups used
no AI calls; local inference used no OpenAI tokens. [Machine-readable accounting](metrics.json).
