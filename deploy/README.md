> Lex Raptor: these production templates use explicit API mode. For free local inference, use the local Supabase + Ollama instructions in the root README. Run `scripts/package_source.py` before building the web image so users can download corresponding source. Managed-service billing is not implemented.

The native local app now opens without an account using `LEX_RAPTOR_AUTH=local`. That mode requires a loopback URL and local inference. These hosting templates explicitly use `LEX_RAPTOR_AUTH=account`; they do not expose the account-free local workspace on the purchased domain.

# One production deployment path

Use a managed Supabase project and a persistent Docker host with Docker Compose. The web, API and worker containers share the private Docker network. Only Caddy exposes ports 80/443 and obtains TLS for the configured domain. Private matter state lives in Supabase Postgres and private Storage, not a container filesystem.

The owner purchased **lexraptor.com through Porkbun** and authorized a public project website and public source repository. The project website is a separate static site, with source in `website/`; it does not expose this local research API. These templates are for a future hosted research service. Its eventual hostname must be configured separately using `APP_DOMAIN` and `APP_ORIGIN`. No managed Supabase credentials have been supplied for hosted research.

1. In the owner's managed Supabase project, enable email/password login, disable public registration/anonymous login, and configure the exact HTTPS app URL/redirect. Keep the `defense` schema out of publicly exposed PostgREST schemas. The private `matter-files` bucket has no anonymous/authenticated direct-object policies; authenticated downloads go through the API. Keep Supabase service credentials private.
2. Copy `.env.example` to a mode-0600 production environment file outside Git. Set `DATABASE_URL` (TLS, persistent/session-capable connection), `SUPABASE_URL`, public anon key, private service key, `APP_DOMAIN` and `APP_ORIGIN=https://APP_DOMAIN`. Give provider keys only to the worker and owner evaluator. Do not reuse the local Supabase keys/passwords.
3. Load that environment locally on the owner-controlled deployment machine and run `uv run defense migrate`. Migrations are ordered and tracked; Supabase CLI migrations can also apply the same SQL. Bootstrap the administrator using `uv run defense admin bootstrap EMAIL ORGANIZATION` and a hidden password prompt.
4. On the authorized Docker host, point the domain DNS at that host, then run:

   ```bash
   docker compose --env-file /private/path/lex-raptor.env -f deploy/compose.yaml up -d --build
   ```

5. Verify HTTPS shows only sign-in anonymously. Test invited login and a synthetic upload. `/api/health` verifies the API database connection. The worker heartbeat is stored in Postgres; the health check allows one bounded in-progress job. Its command is `python -m defense.worker`; long model work does not run inside a web request.
6. Configure model pricing and explicit caps before enabling paid calls. Run the bounded live smoke and benchmark from the owner-controlled evaluator machine, not a reviewer route. The evaluator checkout and run reports are excluded from production and generator images. The generator uses an unprivileged, read-only, no-network container and a single exact-request Unix-socket broker outside the provider-secret boundary.

For upgrades, back up the managed database under your actual retention policy, apply migrations, rebuild and restart the three services. Worker jobs are durable; expired leases become `needs_attention` and retain any uncertain call commitment. Do not blindly replay a job after a timeout.

`Dockerfile.web` builds a Next.js standalone server; `Dockerfile.worker` is shared by the Python API and persistent worker. Dependencies are pinned in `package-lock.json`, `uv.lock` and the exported `requirements-engine.txt`. The API service has no provider API-key environment variables in Compose. The web image receives no Supabase service-role, database or provider secrets.

No HIPAA, SOC 2, production penetration-test or legal-quality certification is claimed. Production auth/storage, TLS/domain routing and a real live-provider smoke remain to be verified in the owner's eventual hosting environment.
