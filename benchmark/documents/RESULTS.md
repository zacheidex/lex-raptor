# Document and CLI checks — 2026-10-05

These are synthetic-document development checks, not legal accuracy scores.
The sample agreement in `website/tests/fixtures/` is not a real client document.

- 26 automated tests passed: existing spending and research guards, PDF/DOCX
  extraction, XML/size/binary input rejection, document-only isolation, combined
  public/document sourcing, exact quotation validation, and CLI file handling.
- Browser checks passed for dark styling, the visible open-source identity,
  citation controls in chat, real PDF/DOCX/TXT extraction, no model call at attach
  time, document-only default, explicit combined scope, source passages, coverage
  disclosure, clearing files, unsupported types, and a 390-pixel layout.
- A real Qwen3:14b CLI request analyzed the sample DOCX using documents only. It
  retained four findings about termination notice, payment, confidentiality,
  and an unspecified governing-law term. All four quotations matched the
  extracted text. API model spend: $0. The model put all findings under Summary
  and omitted the other analysis sections; the UI reports those omissions.

Original files are parsed on the device. PDF page locations are preserved;
DOCX/text locators explicitly do not claim original pagination. Long files are
ranked into bounded excerpts, with coverage counts. Scans, images, formatting,
comments and deleted text are not analyzed. These tests do not establish
comprehensive review, correct reading order for complex PDFs, legal entailment,
or resistance to every adversarial document.

Runtime document-parser dependencies have no advisories in `npm audit --omit=dev`
on this date. The existing development toolchain still reports advisories in
Drizzle/esbuild and Miniflare's transitive dependencies; a full dependency/security
review is not represented as complete.

Interactive CLI checks covered `/files`, a real local timeline request, saving
structured output, and `/quit`. The timeline retained four literal quotations,
but omitted the end date as a separate event and mixed relative notice/payment
periods into Events. It is not a complete chronology; the retained output is in
`local-timeline.json`. No API model credits were spent.
