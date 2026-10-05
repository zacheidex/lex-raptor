# Lex Raptor website and hosted demo

The public project website and public research preview. Local Lex
Raptor remains account-free and does not need a provider key. This website is a
separate Cloudflare Worker with a D1 spending ledger and static assets.

## Build and verify

Use Node 20.20+ and npm. Run `npm ci`, `npm run build`, then `npm test`.
The tests use a local Workers runtime and a simulated provider; they spend no
API credits. They verify public access, origin checks, database selection, quotation
validation, idempotency, concurrent budget admission, failure reservations,
and visitor limits. They are not a legal-quality benchmark.

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
| `OPENAI_API_KEY` | Dedicated project key for the demo; secret |
| `DEMO_SESSION_SECRET` | Stable IP-hashing key, at least 32 characters; secret |
| `DEMO_ENABLED` | Exactly `true` to enable paid requests; otherwise disabled |
| `DEMO_EXPIRES_AT` | Unix timestamp; missing or expired disables paid requests |

The demo requires no account, passcode, or session cookie. Preserve the existing
`DEMO_SESSION_SECRET` value when upgrading: changing the IP-hashing key would
reset visitor limits. Set an expiration when reviewing the model's current
price and access. Disabling the demo blocks new requests; requests already
sent to the provider can still complete and charge.

## Spending controls

The lifetime cap is **$10**, persisted in D1 across browsers and deployments.
There is no reset, top-up, or browser-controlled budget setting. **Never delete
or reset `demo_calls` on a funded deployment.** A fresh database is a fresh
budget and requires owner authorization. This app cap covers requests through
this demo, not other uses of the provider account or hosting charges.

Before each model call, one atomic `INSERT ... SELECT` reserves **$0.02**, only
if the total ledger charge plus that reservation fits under the cap. Input is
bounded at 32,768 UTF-8 bytes including instructions/schema, with a 4,096-token
framing allowance, and output (including reasoning) at 4,096 tokens. At the
verified standard prices this is below $0.011. No paid tools, loops, automatic
retries, user-selected models, or user-selected endpoints are allowed.

Successful calls settle conservatively against reported input/output tokens,
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

Additional limits: 10 questions per rolling 24 hours per IP hash,
3 per minute per IP hash, and at most 2 recent in-flight reservations globally.
People on the same public network share the IP-based limit. IPs come from the
edge's `CF-Connecting-IP` header and are HMAC-hashed; a direct host must sanitize
that header itself. These limits discourage abuse; the durable global budget
remains authoritative when a visitor changes networks.

Opening public access preserves all ledger rows and applied migrations. The
legacy `session` column holds a public visitor marker on new rows; the old
`demo_attempts` table is retained but unused. Remove the obsolete
`DEMO_PASSCODE` hosting secret when deploying this version.

## Research scope and privacy

`worker/corpus.json` contains the 979 imported opinion passages from the same
12 public CAP cases as the local MVP, with original URLs and SHA-256 hashes.
No private matter documents or publisher headnotes are included. The hosted
demo uses a small lexical retriever; it is not the local PostgreSQL retriever.
CourtListener remains visibly unavailable. Empty or unavailable selections
are rejected on the server before model use.

Questions and selected public passages are sent to OpenAI with `store:false`.
This setting does not promise zero provider retention. The app stores no
question/answer history; it stores hashed visitor IDs, legacy session IDs or
public visitor markers, request
IDs, timestamps, reservation states, and token counts. Questions must not
contain confidential client information. No documents can be uploaded here.

Claims lacking a literal quote from the selected passage are removed. A
matching quote does not prove legal entailment, correct context, or current
validity. The local Qwen benchmark does not measure this different hosted
retriever/model. Human review remains necessary.

## License

AGPL-3.0-only. Full corresponding source is in the public Lex Raptor repository
and source download. The source archive deliberately omits secrets and runtime
state. See the root project's LICENSE, NOTICE, and corpus lockfile.
