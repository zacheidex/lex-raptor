# Lex Raptor workbench

Open-source legal research with local Ollama or a hosted demo. The chat UI and Cloudflare Worker share retrieval, case resolution, evidence checks and spending controls. The public demo requires no account. An optional invite gate is available.

## Workflows

- **Research an issue:** automatic task/source selection, optional state/federal, searchable court and date controls under **Refine**, clarification when needed, and follow-up chat. Explicit source choices override automatic routing.
- **Brief a case:** resolve citations or unambiguous names before synthesis; choose between ambiguous decisions/stages. A simple brief uses the principal opinion and available separate opinions without regulatory retrieval. Facts, procedural history, issue, rule, holding, reasoning and disposition have explicit missing-section recovery.
- **Collect cited cases:** paste citations or attach a brief. Deterministic parsing and CourtListener resolution; no AI. Repeated/parallel citations group by case identity with original strings/document locations. Select/correct ambiguous entries and download cases, ZIP, CSV and manifest. Unresolved/unavailable entries remain visible.
- **Auto task** is the default; task formats and direct tools are available from its menu. The Demo badge in the sidebar explains the shared $10 budget.
- **Find a case** and **Search sources only** require no model. Automatic source-only topic search uses connected online connectors; exact cases retain their identity route. Paid web-tool research is not executed by source-only search.
- Click findings/citations for actual supporting excerpts, quotation highlights, court/date, source type, real page markers, full retrieved opinion and copy/download actions. Extraction offsets are never legal page numbers.
- **Check citations** resolves citations and runs AI support review. Web URLs are reopened; up to four individually attributed web-reader calls can read unavailable HTML/PDFs. Cases use re-resolved public opinions; offline/attachment excerpts are labeled saved-excerpt review. Supported, partial, contradicted and unverified describe AI assessments, separate from exact quotation matching and later treatment. New findings start not-yet-reviewed.
- Explicit browser-local projects retain questions, answers, scope, excerpts, references, notes, bookmarks and review state. IndexedDB survives reload; no device sync. Export/import JSON for backup. Original attachments are omitted. DOCX, text and JSON retain the visible verification state and unresolved items.

See [the walkthrough](docs/WORKFLOWS.md) and [validation report](docs/WORKBENCH_VALIDATION.md).

## Run locally

Install Node **20.20+**, npm and [Ollama](https://ollama.com/). From this directory:

```sh
npm ci
ollama pull qwen3:14b
npm run build
npm run check:setup
npm run local
```

Open http://127.0.0.1:8787. Set `OLLAMA_MODEL` for another installed model or `LEX_RAPTOR_PORT` for a different loopback port. The check script inspects Node, model availability and credential presence, without printing keys or making paid calls. It does not certify hardware performance. Missing model/service errors give recovery instructions. A native installer is not included.

The launcher/CLI never load or forward an OpenAI key. Only optional `COURTLISTENER_API_TOKEN` is loaded from the environment or ignored `.env.local`. Local inference has no model API fee; online source queries still leave the device. The 12-case CAP collection works offline. Public caches and local metadata persist in ignored `.local-data/`.

```sh
npm run cli -- ask "Review notice and payment terms" --file ./contract.pdf
npm run cli -- ask "Compare these documents" --dir ./agreements --task compare
cat notes.txt | npm run cli -- ask "Build a timeline" --stdin --task timeline
npm run cli -- chat --file ./brief.docx
npm run cli -- search "Celotex summary judgment" --sources courtlistener
npm run cli -- --help
```

The CLI defaults to documents-only or offline CAP; online sources require `--sources`. Use `--json` or `--output`; output files have owner-only permissions and require `--force` to overwrite. Folder scans skip symlinks, hidden and dependency/build directories. Interactive `/files`, `/attach`, `/clear`, `/new`, `/task`, `/sources`, `/save`, `/quit` do not execute shell commands.

## Sources and limits

| Source | Access and behavior |
| --- | --- |
| CourtListener v4 | Owner token; nationwide cases, citation resolution, active-court metadata, public opinion text and available PDFs. No PACER purchase or paid retrieval upgrade. |
| eCFR | No key; dated current federal regulations. Court/date filters do not restrict the current snapshot. |
| Federal Register | No key; agency publications and publication-date filtering. Notices/proposals are not automatically binding rules. |
| Public legal web | Hosted AI only; eligible government/legal sources for statutes and municipal law. Web search does not enforce court/date filters; results disclose this. Legal citation labels derive from supplied URLs/titles where available; missing metadata is not guessed. |
| CAP starter | Twelve historical Supreme Court opinions, offline. |
| Google Scholar | User-click case-law searches only. No scraping, bulk download or unofficial API. |

The court selector loads the complete paginated active CourtListener directory and caches it for 24 hours. A bundled, dated provider snapshot avoids a cold-start burst and remains available with a visible notice if refresh is rate limited. State membership uses provider metadata/name plus the provider-derived appellate map. Visible scope applies to cases and persists across follow-ups. Governing-law context informs planning but does not establish binding authority. Jurisdiction relationships remain undetermined without adequate context; matching a selected court does not certify precedential force.

Public records/citation resolutions cache for 24 hours; private briefs, questions and project contents are not cached. Provider concurrency is three per job. Default visitor limits: 120 jobs/hour, 20 AI jobs/hour, three active jobs. Job ID, hashed visitor, time, AI flag and state expire after 48 hours, cleaned on subsequent requests. Stop cancels future work at checkpoints; already-sent calls can finish and charge. No automatic retries.

Collection limits: 50 distinct candidates, 1,000 occurrences, 20 selected cases/50 MB per packet, 5 MB per original PDF. Public records and browser file caches avoid repeated downloads. Allowed original publisher PDFs are preserved byte-for-byte; generated HTML/text is explicitly labeled. Unresolved/unavailable entries stay in the CSV/manifest. Short forms, malformed reporters and OCR errors can require manual correction.

Attachments: text-layer PDF, DOCX, UTF-8 TXT/Markdown; five files, 5 MB each, 200 PDF pages, 300 KB combined text. Scans need external OCR or pasted citations. DOCX body/footnotes/endnotes lack original pagination, comments, layout and deleted text. Extraction and selected-excerpt analysis can omit context. Original files are not uploaded: extracted text goes to the runtime. Hosted analysis sends question/context and excerpts to OpenAI (`store:false`; provider retention policies still apply). Local analysis uses Ollama. Collection sends only detected citation strings to CourtListener, not the brief body.

Projects save only when requested, in this browser until deleted or browser data is cleared. No anonymous server project store exists. Feedback persists in D1 for owner review; question/answer sharing is off by default and separately opt-in. Attachments are never included. There is no public feedback-reading API.

## Hosted configuration and optional pilot gate

Values are server-side; never put keys in browser bundles. See `environment.example.txt`.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Dedicated hosted model key |
| `COURTLISTENER_API_TOKEN` | Optional public-data token |
| `DEMO_SESSION_SECRET` | Stable visitor hashing secret, 32+ characters; preserve on upgrades |
| `DEMO_ENABLED` | Exactly `true` enables hosted AI |
| `DEMO_EXPIRES_AT` | Unix timestamp; expired/missing disables hosted AI |
| `ACCESS_MODE` | `public` (default) or `invite` |
| `ACCESS_TEAM_DOMAIN` | `https://YOUR-TEAM.cloudflareaccess.com` |
| `ACCESS_AUD` | Cloudflare Access application's audience tag |
| `REQUESTS_PER_HOUR`, `AI_REQUESTS_PER_HOUR` | Defaults 120/20; bounds 1–1000/1–100 |

For a restricted pilot, configure a **Cloudflare Access** self-hosted application with an allow policy containing only invited identities. Use its established session login, audience tag, and proxy forwarding of `Cf-Access-Jwt-Assertion`. Set the three Access variables on the Worker. Server-side `jose` validates RS256 signature, issuer, audience, expiry and subject. Missing/invalid credentials fail closed on every research/data API; status supplies a login link. Direct-origin requests still need a valid signed JWT. Do not use an everyone policy for invite-only mode. Public mode preserves the example demo; local Ollama bypasses hosted access.

The gate is implemented and fixture-tested; an Access tenant/application is **not configured on the live public demo**. Verify current provider plan terms before enabling one.

## Shared budget

The hosted lifetime cap remains **$10**, persisted in D1 across deployments/browsers. Never reset/delete `demo_calls` or replace a funded database. Source-only search, lookup and collection make no AI calls. Local inference has no API budget.

The pinned model is `gpt-6-luna` through Responses, low planning/medium drafting reasoning. Atomic admission reserves $0.02 for bounded excerpt planning/drafting or support review; hosted web requests reserve $0.40 for up to four tools plus tokens. Known usage settles against reported tokens/tools; uncertain in-flight costs retain the reservation. Input/output ceilings remain enforced. Rechecking is a separate budgeted operation. The app cap excludes unrelated account usage and hosting/data subscriptions. Conservative accounting and pinned rates are in `worker/budget.js`.

## Checks and deployment

```sh
npm ci
npm run build
npm test
# Separate terminal: npm run local
npx playwright install chromium
npm run test:browser
node scripts/diagnose-authorities.mjs --brief
```

Unit/workflow tests use Miniflare with mocked providers. Browser checks mock all AI/data endpoints and exercise desktop/mobile, evidence, projects, exports and keyboard paths without credits. `diagnose-authorities` uses live lookup/collection; `--brief` adds one model brief. Hosted briefs require explicit `--allow-api-spend`, still within the cap. Set `LEX_RAPTOR_URL`; diagnostics go in ignored `.local-data/authority-audit`. Timings disclose cache hits/provider counts and are not legal-quality scores. Older bounded stress scripts remain available.

`db/schema.ts` is authoritative; `npm run db:generate` produces migrations. Preserve applied migrations and the spending ledger. Build output includes `dist/server/index.js`, `dist/client`, `dist/.openai/drizzle`. Hosting needs `DB` (D1) and `ASSETS`. The existing Site keeps `.openai/hosting.json`: run Sites workflow checks/build/package, save the matching pushed source/version, deploy that saved version. Ordinary releases need no DNS or secret changes. New independent hosts can use `hosting.example.json` and their own bindings/migrations; a new funded ledger requires owner budget authorization.

AGPL-3.0 source downloads include this workbench. The fixed cyan mascot carries Microsoft Fluent UI Emoji MIT attribution in `public/mascot-license.txt`.
