# Counsel — insurance-defense MVP

An invite-only matter workspace built with Next.js, managed Supabase Auth/private Storage/Postgres, and a persistent Python worker. Discovery responses are the primary workflow. The application and benchmark use the same extraction, evidence preparation, structured drafting, citation checking and deterministic DOCX export code.

## Current handoff

The local application runs at **http://localhost:3000**. Anonymous visitors see sign-in only. Private, randomly generated local administrator credentials are in `data/local-admin.json` (owner-readable, excluded from Git). Local Supabase data persists in Docker volumes. This is a local development deployment, not a public production deployment.

Paid generation is **disabled**. The owner authorized **at most $100 total** for the session; the local global, organization and administrator caps are each $100. No model API key was available, so **no live generation or paid judging was performed**. Codex's existing ChatGPT sign-in was not repurposed as an application API key.

Implemented: invitation-link creation without sending email, active membership checks, tenant RLS, private proxy downloads, persistent upload/parse jobs, file manifests and warnings, fact extraction before drafting, reviewed-fact reuse, versioned firm playbooks, source-linked structured drafts, editable revisions, source support correction, review recording, editable DOCX export, cancellation, deletion, durable quotas/reservations, failure circuit breaker and an owner-only benchmark CLI.

**Validation and benchmark results:** see [benchmark/RESULTS.md](benchmark/RESULTS.md). Offline stubs test software mechanics only; they are not legal-quality scores.

## Quick start on this machine

```bash
cd /home/zach/legal-workspace
# Already initialized; retains existing local database volumes:
npx supabase start --exclude studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta,inbucket
.venv/bin/python scripts/start_local.py
```

Stop the web/API/worker with `.venv/bin/python scripts/stop_local.py`. Stop local Supabase with `npx supabase stop`; omit destructive reset/delete-volume flags. Runtime logs and PIDs are in `data/`.

For a fresh checkout, install Python 3.11+, Node 20.9+, Docker and uv, then:

```bash
uv sync --locked --group evaluator
npm ci --prefix apps/web
npm run build --prefix apps/web
npx supabase start --exclude studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta,inbucket
```

Populate a private `.env.local` using `.env.example`. Local Supabase provides its local configuration through `npx supabase status`; do not paste its service credentials into public logs. The `scripts/local_setup.py` helper is restricted to `http://127.0.0.1:54321` and creates a random local administrator without sending mail. It must not be used for production.

## Live model setup

1. Create a dedicated OpenAI API project/key and place `OPENAI_API_KEY=...` in the private `.env.local` file. Do not use the browser, a matter document or Git for keys.
2. Load the environment for owner commands:

   ```bash
   set -a
   source .env.local
   set +a
   ```

3. Read the administrator UUID from `data/local-admin.json`. The pricing snapshot was verified on 2026-10-04; reverify it after 30 days or any pricing change. Configure an allowed model and caps explicitly:

   ```bash
   .venv/bin/defense admin configure \
     --owner ADMIN_UUID --model gpt-6.1-sol \
     --pricing-file benchmark/verified-pricing-2026-10-04.json \
     --global-usd 100 --organization-usd 100 --user-usd 100 \
     --max-input-tokens 900000 --max-output-tokens 16000 --enable
   ```

4. Restart the worker after adding its provider secret. Review [docs/ADMIN.md](docs/ADMIN.md) before inviting users.
5. Run the synthetic authenticated smoke script, then review the generated draft in the UI:

   ```bash
   .venv/bin/python scripts/live_smoke.py --live --max-usd 100
   ```

The script records actual live generation and leaves attorney approval to a person. The offline integration test separately verifies edit/review/export mechanics. The global cap includes both application and benchmark work; an independent benchmark scope cannot bypass it.

## Reproducing the benchmark

The 16-task manifest comprises 8 core, 5 extended and 3 coverage tasks at Harvey LAB commit `465d1fcf270daa01b0d1d63e30e3da9876d7a268`. All 16 task hashes and 194 source documents are locked. The upstream MIT notice is retained in `benchmark/upstream-license/LICENSE`.

```bash
.venv/bin/defense benchmark fetch
.venv/bin/defense benchmark verify
.venv/bin/defense benchmark list --tier core
.venv/bin/defense benchmark estimate --tier core --all-tasks --max-usd 100

docker build -f deploy/Dockerfile.generator -t defense-generator:local .
.venv/bin/python scripts/benchmark_mechanics.py
```

The last command is a **deterministic, unpaid mechanics check**, not a model evaluation. It runs both adapters in an unprivileged, network-disabled container with only the clean assignment and original documents mounted. It writes clearly labeled stub artifacts and a mechanics report.

With an API key, allowlisted prices, enabled calls and an explicit owner cap, a cost-conscious custom comparison is:

```bash
# Default selection: one core task, baseline + product, one repetition.
.venv/bin/defense benchmark run --live --max-usd 100 --owner ADMIN_UUID \
  --model gpt-6.1-sol --judges gpt-6-luna --judge-output-tokens 8192

# Eight core tasks. The shared global ledger preserves spending from the smoke.
.venv/bin/defense benchmark run --tier core --all-tasks --live --max-usd 100 \
  --owner ADMIN_UUID --model gpt-6.1-sol --judges gpt-6-luna \
  --judge-output-tokens 8192

.venv/bin/defense benchmark resume RUN_UUID --live --max-usd 100
.venv/bin/defense benchmark grade RUN_UUID --live --max-usd 100
.venv/bin/defense benchmark report RUN_UUID
```

A full suite run creates new run IDs and can spend again on the smoke task; use `resume` to finish the same interrupted run without rebilling completed calls. The global cap still includes earlier runs. Do not infer that the full suite will fit after other work consumes the remaining allowance. `--system chat_baseline` / `--system product_pipeline`, `--task`, `--tier`, and `--repetitions` allow explicit selection. Extended and coverage are opt-ins.

The default pinned reference judge pair is **Claude Sonnet 4.6 + GPT-5.5**, with 64,000 maximum output tokens per criterion. It requires both providers' keys and independently verified pricing for both models. They are not silently replaced. The cheaper single-Luna profile above is labeled **custom-pinned-rubric**, never an official LAB score. It uses the pinned rubric/scoring code with a bounded adapter; retries and the unbounded LLM filename matcher are disabled.

All selected public tasks are declared **development/regression fixtures**. No untouched public holdout is claimed. Future transfer evaluation must use authorized private matters held out by whole matter/client. Baseline and product receive every extracted passage and the same generation model, reasoning setting and output cap. Product adds workflow guidance, fact structure and relevance ordering. Both use identical structured output and source-safety requirements; this is an adapted comparison, not a reproduction of upstream agent tools.

## Tests

A dedicated Postgres database is required; the test suite refuses non-test database names:

```bash
docker run -d --name defense-test-db \
  -e POSTGRES_PASSWORD=local-test-only -e POSTGRES_DB=defense_test \
  -p 127.0.0.1:55432:5432 postgres:17-alpine
.venv/bin/python -m pytest -q
.venv/bin/ruff check engine tests scripts
npm run build --prefix apps/web
node apps/web/browser-check.mjs
```

The browser check uses the real local Supabase login, private upload, durable worker ingestion, reload persistence, escaped source rendering and a narrow mobile viewport. It creates only visibly synthetic local records. The Python end-to-end model is explicitly stubbed and never represented as live legal performance.

## Production deployment

Use managed Supabase plus one Docker host for web/API/worker and Caddy TLS. See [deploy/README.md](deploy/README.md). A public deployment requires the owner's hosting account/domain and managed Supabase credentials. None were supplied; no paid account or public URL was created.

## Practical limits

This is an MVP, not a certification or a demonstrated legal-quality product. Image-only/partly unextractable PDFs require OCR outside this application. Email attachments are explicitly listed for separate upload. DOCX tracked changes/text boxes require manual handling. Workbook formulas are preserved, never executed; missing cached values are visible. Calls that exceed configured context bounds fail visibly without truncating evidence. Source quote/locator checks do not establish semantic entailment, absence of omissions, or correctness of proposed legal arguments. Those remain distinct human/evaluation tasks.

This implementation records reviewer attestation; it does not verify bar membership or independently certify legal review. Model-generated signing, service and filing actions are not available.

Post-training is deliberately absent. Consider it only after repeated measured failures survive prompt/retrieval/review improvements, and only with explicit data rights, attorney-audited examples and a matter/client-separated evaluation. No cross-client training on firm data is enabled.
