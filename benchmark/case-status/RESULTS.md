# Case-status regression checks — 2026-10-05

These are three public development prompts, not a representative legal-accuracy
benchmark or an attorney evaluation. They were used to reproduce a reported
Roe retrieval failure and test a second changed precedent and an invented case.
The final run used the public website, `gpt-6-luna`, automatic tasks/search terms,
and all three connected online databases. The prompts and every retained model
answer are included, including unsuccessful intermediate answers.

| Prompt | Final observation | Time | Retained / literal quotes |
| --- | --- | --- | --- |
| What is the current status of Roe vs Wade? | Retrieved Dobbs and identified Roe's overruling on June 24, 2022. | 14.025 s | 1 / 1 |
| Is Chevron U.S.A. Inc. v. Natural Resources Defense Council still good law? | Retrieved Loper Bright; distinguished overruling the deference framework from automatically overturning earlier case-specific holdings. | 9.321 s | 2 / 2 |
| Is Raptor v. Galactic Toaster, 999 U.S. 999, still good law? | No matching text or invented authority; no drafting call after the planning call. | 2.857 s | 0 / 0 |

The first two outcomes were manually compared with the Supreme Court's
[Dobbs opinion](https://www.supremecourt.gov/opinions/21pdf/19-1392_6j37.pdf) and
[Loper Bright opinion](https://www.supremecourt.gov/opinions/23pdf/22-451_7m58.pdf),
including Loper Bright's qualification about earlier holdings (slip opinion,
pp. 34–35). This was a narrow review of the stated outcomes, not a comprehensive
check of every later authority or every passage the app retrieved.

## Retained failures and fixes

- The user-reported initial Roe search returned procedural orders and an
  unrelated case, with no answer. Named-case retrieval now uses the case-name
  field and citation prominence, prefers lead opinions, and searches later
  treatment separately. No case-specific answer or Roe/Dobbs mapping is coded.
- `initial-chevron.json` retrieved an agency account of the overruling but
  missed Loper Bright itself and its qualification. The planner can now suggest
  one later case as a search lead. Only independently fetched opinion text is
  evidence. General later-treatment and recent-treatment searches remain.
- `chevron-polarity-error.json` retrieved the correct opinion and qualification,
  but opened with a contradictory “Yes” to a good-law question. The final prompt
  requires a direct statement of status without a bare Yes/No. The final response
  corrected this; that does not prove all polarity or reasoning errors are solved.
- Intermediate requests began during deployment propagation. They lacked the
  candidate-treatment search; they are retained under `intermediate-*.json`.
  The diagnostic runner now checks a research revision before spending so it
  does not intentionally test an older deployment.
- The final fictional-case raw record labeled CourtListener `unavailable` even
  though all three searches succeeded with zero matches. This presentation bug
  was subsequently fixed and covered by an automated regression: successful
  zero-match searches are `empty`. The raw record is preserved without editing.
- The old empty-answer UI always blamed quotation checks. It now distinguishes
  no evidence, model abstention, incomplete output, and removed findings.

The final model-run records correspond to Site source
`b76d1aea5dfd35caf608ff47507cb41555e472f7`. Subsequent changes only correct the
zero-match status label, add its regression test, and package these results.

## Engineering and interaction checks

33 automated tests pass, covering retrieval and treatment gaps, unverified
search leads, manual database overrides, source isolation, source destination
restrictions, progress streaming, settlement after a client disconnect, and the
existing atomic $10 budget/idempotency guards, document handling and CLI checks.
Browser checks cover all three online databases selected by default, optional
automatic narrowing, no assistant logo, elapsed progress, accurate empty output,
document attachments and a 390-pixel layout. A live stream began reporting
progress after 0.223 seconds on the first hosted Roe check. These timings are
single observations, not latency guarantees.

Nine hosted research requests were made across this debugging session. The
conservative lifetime spending ledger increased by $0.012631, from $0.134167 to
$0.146798. The $10 cap and earlier charges/reservations were preserved. No paid
data subscription was added, and source-only probes made no model calls.

## Limits and reproduction

The answer model still sees selected excerpts. Relevant opinions, exceptions,
negative treatment, state law or statutory changes can be missed. Some full
opinion records combine majorities, syllabi, concurrences and dissents. Literal
quote matching does not establish legal entailment, correct speaker, or current
validity. A suggested later case can be wrong or absent; retrieval does not
certify its relationship to the original. This is not Shepard's or KeyCite.
Searching all databases can introduce irrelevant regulations or notices; users
can narrow the scope or enable automatic database selection. The small offline
CAP library remains opt-in and is not nationwide coverage.

From `website/`, run:

```sh
node scripts/diagnose-case-status.mjs
# Hosted calls require this explicit opt-in and use the server's existing cap:
node scripts/diagnose-case-status.mjs https://lexraptor.com --allow-api-spend
```

The runner makes at most three requests, no retries, with at most $0.06 of
reservations. It writes results to ignored `.local-data/case-status/`. Review the
outcomes and quotations manually. It does not assign an automated legal score.
