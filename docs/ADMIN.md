# Administrator guide

## Accounts and invitations

For local review, open `data/local-admin.json` on this machine to obtain the random local administrator credentials. That file is mode 0600 and ignored by Git. It is not a public default account.

For production, disable new signups in Supabase Auth and keep the email/password provider enabled. Set the production site URL and exact allowed redirect URL to the HTTPS application origin. In the local CLI configuration, `[auth].enable_signup=false` closes registration while `[auth.email].enable_signup=true` keeps the email provider usable; an actual signup request was checked to return `signup_disabled`.

After migrations, run `defense admin bootstrap EMAIL ORGANIZATION`. The password is entered through a hidden prompt and is never a command-line argument. Bootstrap is rejected after an administrator exists.

In the UI, open **Workspace administration**, enter an authorized recipient and create an invitation link. No invitation email is sent. Deliver the link through your chosen approved channel. It is a temporary credential: do not place it in shared logs. The recipient sets their password on acceptance. Membership is bound to the organization on the server, not from browser input. Revocation is available at `POST /api/admin/members/{user_id}/revoke`; every subsequent private request and paid call rechecks active membership. An in-flight provider request cannot be recalled.

## Quotas and allowed models

Paid calls start disabled. Owner commands use the server's private database configuration. `defense admin configure` installs allowlisted model IDs, reviewed pricing and explicit global, organization and user dollar caps. A caller cannot choose arbitrary endpoints or models through the application. Prices older than 30 days fail closed. The provided OpenAI price file covers default service tier, global endpoint, long-context pricing and cache-write maxima; returned token/cache/reasoning usage determines settlement. Other models need their own verified pricing.

The global cap applies to application work and **all** benchmark runs. Each benchmark also receives its own separate cap. Caps are lifetime ledger allowances, not silently resetting monthly counters. Increasing/changing a cap never removes already settled spend or uncertain reservations. Configure a new user's allowance with:

```bash
defense admin quota --owner ADMIN_UUID --user-id REVIEWER_UUID --max-usd 10
```

View configuration and holds with `defense admin status`. In the UI, **Disable all paid calls**, or `defense admin disable-paid`, immediately blocks future reservations. A paid call already in progress may still complete and settle. Provider account spend controls and alerts are additional protection, not the application's concurrency ledger.

The worker reserves an upper bound in integer microdollars in a Postgres transaction before every provider call. A single serialization lock protects global and tenant scopes across replicas. Unknown pricing, unavailable accounting, an inactive user/matter, cancellation, an open circuit, excessive input/output bounds or missing scope prevents the call. There are no automatic model SDK retries. Three uncertain provider failures open the circuit.

Timeout/crash reservations stay held. Do not delete them or reduce `held_micro` merely to retry. Reconcile against provider request/usage records, then settle once with `defense admin reconcile --owner ADMIN_UUID --call-id CALL_ID --usage-file verified-usage.json --provider-request-id PROVIDER_ID --verified-from-provider`. The file must contain independently verified `input_tokens`, `output_tokens`, and any cache/reasoning usage details. Unknown billing remains reserved. `defense admin reset-circuit --owner ADMIN_UUID` resets the failure circuit but neither enables calls nor refunds reservations. If a running worker's lease expires, the job becomes `needs_attention`; it is not automatically replayed as a new paid request.

Generation is one bounded structured call per action. The job allowance is four calls, zero automatic retries. Default text limits are 20 MB/file, 80 MB expanded package, 150 files/matter, 500 PDF pages, 100,000 spreadsheet cells, 2 million extracted characters/file, 1 MB serialized prompt and a 10-minute job lease. The configured generator is capped at 900,000 input-bound tokens and 16,000 output/reasoning tokens; the custom judge at 200,000 input-bound tokens and 8,192 output tokens. Input bounds deliberately use UTF-8 bytes plus schema/framing allowance. Oversize evidence is rejected visibly, never silently truncated. Workers take one durable job at a time; multiple replicas use `SKIP LOCKED` and the same accounting lock.

## Reviewing a matter

1. Create a matter and identify the represented party. Label synthetic demos explicitly.
2. Upload requests and source records. Inspect every file's status and warnings. Duplicate hashes are detected; same-name/different-content files are flagged. Preserve originals.
3. Choose workflow/playbook and assignment. Review extraction warnings, then select **Extract fact table**. Inspect quoted sources and save reviewed facts for reuse.
4. Prepare the draft. Edit request responses, statement type, source quotations and review notes. Each saved edit creates a revision; competing edits receive a conflict instead of overwriting one another.
5. Have an attorney review the exact revision and record the attestation. Download the editable DOCX. The application does not sign, verify, serve or file anything.

Source replacement retains the original version and invalidates draft review status and stale citations. Source hashes must match before review/export. Reviewed facts are reused only while their complete source-hash set remains current. Templates/playbooks are organization-scoped immutable versions; create a version at `POST /api/admin/templates` with `name` and `body`. No document text grants permissions or tools to the model.

Private originals and exports are served through authenticated endpoints, not reusable signed URLs. This makes revocation effective on subsequent download requests. Browser output is escaped; source text is never rendered as HTML. There is no generic model proxy or reviewer-facing grading endpoint.

## Deletion and retention

An administrator can delete a matter in its workspace. Access is revoked before object deletion; drafts, extracted text, reviewed facts, job payload content and cached provider responses are purged. Audit identifiers, monetary ledger entries and a matter tombstone remain. If storage deletion fails, the matter stays inaccessible and the response reports pending purge. Retry with:

```bash
defense admin purge --owner ADMIN_UUID --matter-id MATTER_UUID
```

Database/object-store backups, infrastructure snapshots and provider retention are governed by their separately configured policies; this MVP does not claim immediate removal from those systems. OpenAI Responses uses `store=false`, which does not by itself assert a contractual zero-retention arrangement. Configure the required agreements/retention before uploading client matters.

## Benchmark review

`benchmark/RESULTS.md` distinguishes fixture validation, deterministic mechanics, and live performance. A custom judge result is labeled custom even though it uses the pinned LAB criteria. The source locator validator only checks existence and verbatim quotations. Unsupported material assertions, omissions, semantic entailment and attorney correction time are separately marked unmeasured until reviewed.

Every live run keeps its ID, source/prompt/model/price information, per-criterion results, usage ledger, output hashes and an empty attorney review form in `data/runs/RUN_UUID`. Failed/unrun tasks remain in the intended denominator. Resume only the same run to reuse its settled calls. Public fixtures are development material; do not claim an untouched holdout or firm-level legal competence from them.

## Documentation sources checked on 2026-10-04

- [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs), [reasoning/output accounting](https://developers.openai.com/api/docs/guides/reasoning), [spend-limit enforcement latency](https://developers.openai.com/api/docs/guides/spend-limits).
- [GPT-6.1 Sol pricing/context](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Luna pricing/context](https://developers.openai.com/api/docs/models/gpt-6-luna). The price snapshot preserves maximum rates for reservation and per-tier rates for settlement.
- [Supabase private storage/RLS](https://supabase.com/docs/guides/storage/security/access-control), [server-side authentication](https://supabase.com/docs/guides/auth/server-side/advanced-guide), [invitation-link generation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).
- [Pinned Harvey LAB source](https://github.com/harveyai/harvey-labs/tree/465d1fcf270daa01b0d1d63e30e3da9876d7a268). The actual pinned evaluator was inspected, hashed and invoked with an offline scoped-deliverable test.
