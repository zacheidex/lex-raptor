# Lex Raptor research chat

The public website and research workbench use a Cloudflare Worker, D1 spending
ledger, and static assets. The same workbench runs on loopback with local Ollama.
Both are account-free. The original Python/Next.js matter workspace is separate.

## Research tools

- Search selected databases without an AI call.
- Draft a research answer, case brief, memo, comparison, or arguments and responses.
- Filter cases by CourtListener court ID and decision date; filter Federal
  Register documents by publication date.
- Inspect full-text excerpts, source type, dated regulations, partial database
  failures, and missing draft sections. Search snippets never become evidence.
- Look up case citations through CourtListener, including ambiguity and missing
  records. This is not a citator or a good-law determination.
- Download the draft, quotations and sources as text or JSON.

Chat is the homepage. Auto mode uses one bounded model call to select the task, search terms, databases and explicit court/date constraints, followed by at most one drafting call. Manual choices override the plan. Recent conversation context is kept only in browser memory and sent with follow-ups. Fully manual requests use one drafting call. These are structured, source-grounded
workflows, not autonomous full-matter agents. Retrieval reads up to three public
records per live database, ranks passages locally, interleaves the selected
collections, and sends at most twelve passages within the existing token budget.
Search terms may need refinement. A case brief based on excerpts can omit facts;
a comparison may miss relevant differences or adverse authorities.

## Run the workbench locally

With Node 20.20+, npm, and Ollama already installed:

```sh
ollama pull qwen3:14b
npm ci
npm run local
```

Open http://127.0.0.1:8787/demo. The launcher binds only to loopback and uses
Ollama at `127.0.0.1:11434`. It never loads or forwards `OPENAI_API_KEY`. Use
`OLLAMA_MODEL` to choose an installed local model and `LEX_RAPTOR_PORT` to change
the port. Local inference has no demo spending cap or API fee. Hardware,
electricity and any independently purchased data service are your responsibility.

The starter CAP library works offline. Online database selections send search
terms to those providers, even when inference is local. An optional
`COURTLISTENER_API_TOKEN` can be supplied in the environment or ignored
`.env.local`. Public records persist in ignored
`.local-data/`; questions and drafts are not stored by this workbench.

## Database connections

| Database | Access | Coverage |
| --- | --- | --- |
| CourtListener | Owner API token required | Live federal/state case search; publication/court/date filters; full opinion records and citation lookup |
| eCFR | No key | Live federal-regulation search and dated full section text |
| Federal Register | No key | Published rules, proposals, notices and presidential documents; full text and official PDF links |
| CAP starter | Offline | The original twelve Supreme Court opinions only |

The CourtListener connector is disabled until its token is configured. It uses
the authenticated v4 API. No PACER purchase, RECAP Fetch/Pray-and-Pay request,
commercial subscription, or automatic upgrade is made. One case search can use up to four requests (search plus three opinions).
Existing public records are cached for 24 hours to reduce repeat downloads.
Provider 429s are reported without automatic retries. Lex Raptor imposes no
per-minute, hourly, daily or concurrency request-count cap during testing;
providers still apply their account-wide quotas across local and hosted use.

See [data access and student resources](../docs/DATA_AND_STUDENT_ACCESS.md).

## Build and verify

Use Node 20.20+ and npm. Run `npm ci`, `npm run build`, then `npm test`.
The tests use a local Workers runtime and a simulated provider; they spend no
API credits. They verify public access, origin checks, database selection, quotation
validation, idempotency, concurrent budget admission, failure reservations,
removed historical count limits, automatic task planning and manual overrides, live-source adapters, partial failures, destination restrictions,
full-text evidence, and local inference without an API key. They are not a legal-quality benchmark.

With the local workbench running, `node scripts/diagnose-workbench.mjs` runs
the six public development prompts. It refuses API-model deployments and saves
results in ignored `.local-data/`. See `../benchmark/workbench/RESULTS.md` for
retained failures, iteration history and qualitative limitations.

`db/schema.ts` is the schema source. Run `npm run db:generate` after schema
changes and inspect the generated SQL. Preserve already applied migrations.
The build puts the Worker in `dist/server/index.js`, static files in
`dist/client`, and schema migrations in `dist/.openai/drizzle`.

Hosting requires a D1 binding named `DB` and a static-assets service binding
named `ASSETS`. On a new Site, copy `hosting.example.json` to
`.openai/hosting.json` and add the new Site's assigned `project_id`. The existing
deployment keeps its own project identity. Other Workers hosts can bind the
same resources and apply the SQL migrations with their own tooling.

## Server configuration

All runtime values are server-side. Never put them in browser JavaScript or
commit them. Configure these through the hosting provider's secret settings:

| Name | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Dedicated project key for hosted AI drafts; secret |
| `COURTLISTENER_API_TOKEN` | Optional CourtListener data-access token; secret |
| `DEMO_SESSION_SECRET` | Stable IP-hashing key, at least 32 characters; secret |
| `DEMO_ENABLED` | Exactly `true` to enable paid requests; otherwise disabled |
| `DEMO_EXPIRES_AT` | Unix timestamp; missing or expired disables paid requests |

The demo requires no account, passcode, or session cookie. Preserve the existing
`DEMO_SESSION_SECRET` value when upgrading to keep usage accounting consistent. Set an expiration when reviewing the model's current
price and access. Disabling the demo blocks new requests; requests already
sent to the provider can still complete and charge.

## Spending controls

The lifetime cap is **$10**, persisted in D1 across browsers and deployments.
There is no reset, top-up, or browser-controlled budget setting. **Never delete
or reset `demo_calls` on a funded deployment.** A fresh database is a fresh
budget and requires owner authorization. This app cap covers requests through
this demo, not other uses of the provider account or hosting charges.

Before the first model call for a request, one atomic `INSERT ... SELECT`
reserves **$0.02** only if it fits under the lifetime cap. The reservation covers
both automatic planning and drafting. Planning input is bounded at 14,000 UTF-8
bytes including schema, with at most 1,024 output tokens. Drafting input is
bounded at 32,768 bytes, with at most 4,096 output tokens. Each call includes a
conservative 4,096-token framing allowance. Together these bounds cost less than
$0.016 at the pinned rates, including the cache-write allowance. There are no
paid tools, agent loops, automatic retries, or visitor-selected model endpoints.
Manual source-only search never calls the model.
Successful requests settle conservatively against the sum of reported input/output tokens from every model call,
rounded up. The ledger allows $0.225/million input tokens (both the standard
$0.10 input rate and the $0.125 cache-write rate) and $0.50/million output tokens;
this intentionally overestimates ordinary input cost. Timeouts, rejected requests, missing usage, and
interrupted workers retain the full reservation. The owner must reconcile
unknown charges against provider usage before changing those rows; automatic
expiry never refunds money. Duplicate request IDs cannot make another call.

The pinned model is `gpt-6-luna`, a current low-cost model available in Codex,
using the Responses API, standard service, and low reasoning. Rates verified
2026-10-05: $0.10/million input and $0.50/million output tokens, with cache writes
listed at $0.125/million. Historical charges stay in the same lifetime ledger.
There is no silent model fallback. Recheck prices and revise the reservation
before changing models or extending access. The initially attempted
`gpt-5.1-codex-mini` had been retired and returned `model_not_found`; its failed
requests retain their reservations rather than assuming they were unbilled.

- [Official model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Codex model availability](https://learn.chatgpt.com/docs/models)
- [Official pricing](https://developers.openai.com/api/docs/pricing)

The owner removed application request-count limits for testing on 2026-10-05,
while explicitly retaining the $10 lifetime spending cap. Historical ledger rows
and applied migrations remain intact. The legacy `demo_attempts` and
`source_requests` tables are retained but no longer gate requests. Input sizes,
model output bounds, provider timeouts, origin checks and idempotency remain.
The edge's `CF-Connecting-IP` is HMAC-hashed for accounting; direct hosts must
sanitize it. Source-service quotas still apply and return visible errors.

## Research scope and privacy

`worker/corpus.json` retains the 979 passages from the original twelve CAP cases,
with original URLs and hashes. Live-source adapters fetch selected public
records and extract text with explicit source type and date. The model never
gets provider credentials, tools, user-selectable endpoints, or private matter
documents. Empty or unavailable selections are rejected before model use.

Questions/search terms are sent only to selected data providers. CourtListener
can log queries according to its account settings. Automatic settings use the model before source retrieval; drafting occurs only
when supporting text is retrieved. Fully manual requests with no evidence make
no model call. Free source search remains available
when the AI allowance is exhausted. Date/court filters do not apply to eCFR's
current dated snapshot; that distinction is shown in the UI and results.

D1 additionally stores public source-record cache entries without question text. A source fetch is capped at 1.5 MB; cached
responses are below 900 KB. Redirects and non-allowlisted destinations are
rejected. Source outages and oversized documents are disclosed as incomplete
coverage, never silently substituted with another database.

Questions and selected public passages are sent to OpenAI with `store:false`.
This setting does not promise zero provider retention. The server stores no
question/answer history; the current chat is held in browser memory until reload
or New chat. Recent conversation context is sent with follow-ups. The server stores hashed visitor IDs, legacy session IDs or
public visitor markers, request IDs, timestamps, reservation states, and token counts. Questions must not
contain confidential client information. No documents can be uploaded here.

Claims lacking a literal quote from the selected passage are removed. A
matching quote does not prove legal entailment, correct context, or current
validity. The local Qwen benchmark does not measure this different hosted
retriever/model. Human review remains necessary.

## License

AGPL-3.0-only. Full corresponding source is in the public Lex Raptor repository
and source download. The source archive deliberately omits secrets and runtime
state. See the root project's LICENSE, NOTICE, and corpus lockfile.
