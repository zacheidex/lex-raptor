# MVP validation and benchmark status

Recorded on 2026-10-04. **No live legal-performance score exists yet.** A provider API key was not available. Additional application/benchmark provider spend: **$0.00**. The owner's **$100** maximum remains configured and paid calls are disabled.

## What actually ran

- **37 Python tests passed**, using a real dedicated PostgreSQL instance. Tests cover anonymous access, tenant isolation/RLS, revocation, origin/CSRF checks, deduplication, concurrent reservations, per-scope caps, uncertain timeout retention, circuit breaking, database failure before provider contact, cache/tier/reasoning accounting, worker lease expiry, deleted-content retention, source parsing, fact extraction persistence, revision conflicts, review/export, source replacement, fixture tampering and pinned-evaluator deliverable scoping.
- **Real local Supabase browser smoke passed**: invite-only login, private upload, persistent worker ingestion, reload, escaped malicious source text, and mobile layout. No JavaScript errors were observed. The initial public signup check returned `422 signup_disabled`.
- **Next.js production build and TypeScript passed**; Python Ruff checks passed. Worker and web Docker images build; worker-container database connectivity and deployment Compose configuration were checked.
- **All 16 task.json hashes and 194 original source documents verified** against the exact pinned Git commit. The evaluator source, upstream dependency lock and MIT notice are also hashed in `fixtures.lock.json`.
- **All 87 core source files ingested** without unsupported/failed files. PDF and OCR-needed handling are tested with explicitly synthetic PDF fixtures; the selected upstream core files are DOCX/EML/XLSX.
- **16/16 isolated baseline/product mechanics combinations passed**, producing **22 valid required DOCX artifacts**, with source quotation/locator checks. These outputs come from an explicitly deterministic stub. They are not model-generated legal analysis and were not assigned LAB performance scores.
- The actual isolated generator image was checked for the absence of host home/evaluator files and provider/database credentials. It has no network and receives only the clean package and an exact-request provider broker.

## Core task status

| Task | Original files | Rubric criteria | Offline mechanics | Live generation/grading |
| --- | ---: | ---: | --- | --- |
| draft-responses-to-interrogatories | 10 | 48 | Both passed | Not run |
| draft-litigation-discovery-responses | 7 | 61 | Both passed | Not run |
| build-litigation-case-timeline | 15 | 64 | Both passed | Not run |
| extract-key-admissions-from-deposition-transcript | 7 | 46 | Both passed | Not run |
| draft-case-assessment-memorandum | 8 | 55 | Both passed | Not run |
| categorize-document-production-set-by-relevance-and-privilege | 25 | 67 | Both passed | Not run |
| compare-document-production-against-discovery-requests | 8 | 46 | Both passed | Not run |
| draft-responses-to-requests-for-production | 7 | 45 | Both passed | Not run |

All eight live tasks remain unrun; none has been removed from the intended suite. Extended and coverage live tracks were not selected. Public fixtures are marked development/regression material; there is no untouched public holdout claim.

## Cost-aware live profile prepared

The default pinned LAB profile retains Claude Sonnet 4.6 and GPT-5.5, one call per criterion, and 64,000 maximum judge output tokens. Baseline + product across all eight core tasks requires **16 generation calls and 1,728 reference judge calls**. Both providers' credentials and verified prices would be required before any such call.

Under the owner's authorization to adjust the evaluation, the prepared **custom-pinned-rubric** comparison uses **GPT-6.1 Sol for both baseline and product** (low reasoning, 16,000 output/reasoning cap) and **GPT-6 Luna as a single custom judge** (8,192 output cap, 200,000 input-bound cap). It preserves the original tasks, documents, per-criterion prompts, scoped deliverables and pinned scoring function. It does not claim the standard dual-judge result.

- One initial task, both systems, all 48 criteria: **2 generation + 96 judge calls**, conservative maximum **$11.968859**.
- Complete core suite, both systems: **16 generation + 864 judge calls**.

The conservative complete-core maximum is **$87.643626**, before earlier application/smoke spending reduces the remaining global allowance. The estimator uses upper-bound input accounting and maximum verified pricing, including long-context/cache-write rates. Every actual call must reserve against the remaining global, organization, user and benchmark allowance. If an artifact exceeds the declared judge input limit, grading fails visibly rather than truncating the artifact. No automatic retries or price/model upgrades occur. Actual model access, output quality, usage and invoice amounts remain untested.

## Metrics not measured

Pinned LAB headline/per-judge/all-pass/strict agreement: **not measured**. Unsupported material assertions, material omissions, semantic citation entailment, attorney correction time and attorney acceptance: **not measured**. Mechanical matching of quoted text to a locator is not semantic entailment. No success rate on real firm matters, Georgia injury defense, scanned medical records or attorney time saved is claimed.

A live run will persist criterion diagnostics, generated artifacts and hashes, model/reasoning/prompt/judge metadata, provider request IDs, actual usage, generation-versus-grading costs, uncertain reservations, failures/unrun tasks, and an empty human review form. The pinned scoring function was exercised with a synthetic offline judge solely to confirm deliverable scoping, not to assess legal quality.

## Saved artifacts

- Mechanics run: `data/mechanics/mechanics-55fe1d1c-181b-4488-a0fc-80436731ef21/report.json`. Required outputs are inside each task/system/repetition `output/` directory; the sidecar preserves source/review traces.
- Shareable operational record: `benchmark/operational-report.json`.
- Cost estimates: `benchmark/smoke-preflight.json` and `benchmark/custom-preflight.json`.
- Provenance: `benchmark/fixtures.lock.json`, original `benchmark/manifest.json`, and `benchmark/upstream-license/LICENSE`.
- Test/browser records: `data/tests-final.txt`, `data/browser-report.json`, `data/sign-in.png`, `data/workspace.png`, `data/workspace-mobile.png`.

## Remaining external configuration

Add a dedicated `OPENAI_API_KEY` to the private local environment, then explicitly enable the already-capped provider configuration and run the live smoke/comparison. The standard reference pair additionally needs Anthropic credentials and verified pricing for both reference judge models. Public hosting needs an authorized host/domain and managed Supabase project; only the local app is running now. No paid hosting account or public URL was invented.
