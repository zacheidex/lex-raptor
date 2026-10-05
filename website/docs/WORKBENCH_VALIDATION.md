# Workbench validation — 2026-10-05

This is a bounded development audit with public opinions and synthetic citation/error fixtures, not a statistical accuracy claim or professional legal review.

## Baseline reproduced

The prior hosted route for `Brief Celotex Corp. v. Catrett, 477 U.S. 317 (1986)` took 37.37 seconds and queried CourtListener, eCFR, Federal Register and legal web. It included unrelated Interior Department/Federal Register material and related procedural records. The old response did not expose reliable per-provider request counts. A two-citation direct lookup took 1.69 seconds; that batch is not directly comparable to one-citation timings.

## Automated checks

**82 backend/unit tests passed; 52 browser workflow checks passed across desktop/mobile, with no browser errors or page overflow.** `npm run build`, `npm test`, and `npm run test:browser` are the required commands. The backend suite uses Miniflare and simulated providers. New coverage includes exact Celotex/Erie identities, principal/separate opinion ordering, ambiguous procedural stages, explicit-source conflicts, jurisdiction filtering, model-free collection, missing sections, quote/page/citation labels, valid DOCX XML, ZIP/CSV/manifest contents, provider concurrency, streaming before synthesis, cancellation/accounting, AI partial/unavailable support, PDF byte preservation and invite JWT rejection/acceptance. The original PDF fixture tests byte preservation/security, not a claim that a synthetic PDF is an authentic court file.

The browser suite mocks every provider/AI endpoint. At 1440 and 390 pixels it exercises lookup, briefing, evidence highlights, partial support, bookmarks, scope follow-ups, explicit project save/reload/import, DOCX, CSV and separate Celotex/Erie HTML files inside a packet, ambiguous selection, statute citations, unavailable text, keyboard submit/Escape and horizontal overflow. Generated DOCX is opened as an OpenXML ZIP and parsed as XML; no Microsoft Word installation is available for a native Word rendering test.

## Live local checks

CourtListener's active directory contained 472 courts, requiring 24 pages (the service returned 20 per page despite a larger page-size request). The full directory loaded in 7.04 seconds with earlier pages cached. Exact uncached Celotex source retrieval took 3.98 seconds and five provider requests; Erie citation resolution took 0.56 seconds/one request. Neither used AI. Collection resolved repeated/parallel Celotex, Erie, ambiguity, nonexistent/malformed citations and `Id.` without AI, in 0.60 seconds/one provider request plus two cache hits. These are individual observed runs, not percentile benchmarks.

Local Qwen3:14b initially misstated Celotex's disposition even though its selected quotation matched. That failure was retained in the audit history: quotation equality is not substantive validation. Retrieval now prioritizes the operative disposition before trailing footnotes and instructions distinguish reversal/remand from approving a trial judgment. The subsequent local run produced all eight brief sections, including the correct reversed-and-remanded disposition with its actual supporting quotation, in 11.30 seconds (cached public sources, one local model call). After reducing redundant prompt metadata and retaining separate-opinion excerpts, the final local run took 14.63 seconds and returned seven principal-brief sections plus three separately attributed concurrence/dissent findings, with no missing sections. This does not certify all local-model outputs or hardware compatibility.

The live Erie record identified principal opinion 9418969 separately from its concurrence. Full opinion retrieval used three additional provider requests and one cache hit in 2.88 seconds.

## Hosted checks

| Workflow | Elapsed | Provider requests | Cache hits | Model requests |
| --- | ---: | --- | ---: | ---: |
| Celotex exact lookup | 1.07 s | 1 CourtListener | 0 | 0 |
| Erie exact lookup | 0.86 s | 1 CourtListener | 0 | 0 |
| Fixture citation collection | 1.54 s | 1 CourtListener | 2 | 0 |
| Celotex brief | 21.12 s | 4 CourtListener | 1 | 1 |

The brief used CourtListener only and returned all eight sections, with the correct reversed-and-remanded disposition. The 37.37-second baseline is a single prior run; cache and provider variability preclude a general speed claim. A separate live AI support review marked seven findings supported and one unverified because its evidence references failed validation. These are AI review labels, not independent accuracy scores. No unsupported review was upgraded to supported.

The insurance-defense question without jurisdiction asked a focused jurisdiction question in 3.88 seconds, with no source retrieval. A live Alabama statutory question displayed `Alabama Code § 13A-3-23 (2024 edition)` and the exact Justia edition URL in 5.62 seconds. This tests citation display, not present-law certification.

A cold hosted directory refresh hit the provider quota. The release now uses the verified dated provider directory snapshot during its first 24 hours and falls back to it with a visible notice if a later refresh fails. The fallback has its own regression test. This avoids an empty selector and repeated cold-start requests.

## Limits

 Cloudflare Access is tested with signed fixture JWTs; no live Access tenant is configured. Scholar is an external search link. Source availability/editions vary; this is not Shepard's/KeyCite, an OCR service, or an exhaustive full-document/case-law analysis. Cases without permitted original PDFs offer labeled HTML/text. Projects are browser-local. No client files were used.
