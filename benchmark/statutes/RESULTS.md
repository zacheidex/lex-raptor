# Statute, local-rule and broader research checks — 2026-10-05

Development evaluation in progress. This is not an attorney assessment or a
representative legal-accuracy benchmark. All failed and partial outcomes are retained.
The runtime contains no canned Georgia/Atlanta answers or case-specific source map.

## Earlier iterations (12 live requests)

- [Revision 7](iterations/revision7.json): two web-tool calls, low reasoning,
  single web citation per finding. Property damage yielded only a relevant
  real-property case, not the general personal-property rule. Atlanta findings
  combined city and state propositions without citing both sources. California
  security-deposit and Roe status answers retrieved useful authorities.
- [Revision 8](iterations/revision8.json): resolved search topic and multiple
  web citations. Property damage reached both statutory categories, expressly
  noting an older edition for personal property. The Atlanta overview lost a
  city-code finding because its publisher was outside the source allowlist.
  A later “Both” test omitted medical detail and included a categorical federal
  schedule statement that did not account for 2026 regulatory developments.
  An invented-case control did not invent a holding, but misleadingly cited an
  unrelated Supreme Court volume as support for no matching case. Those are
  substantive failures; URL provenance alone does not establish support.

The “Both” replay in these iterations followed a model overview rather than the
user's exact clarification exchange. The broader stress suite explicitly includes
the user's original clarification context to test that interaction faithfully.
An Atlanta overview instead of a clarification can be reasonable; the raw routing
flag alone is not a correctness score.

## Current implementation under stress test

Revision 9 uses the same cheap gpt-6-luna model, medium reasoning for drafting,
up to four explicit research issues and four web-tool calls. Unsupported issues
are disclosed. Excerpt findings select exact segment IDs; web findings cite
actual tool-reported URLs on an eligible source domain. Neither mechanism
certifies legal entailment or current validity. A missing case/rule should yield
an unresolved issue, not an irrelevant citation as proof of nonexistence.

The $10 lifetime D1 cap remains. Web requests reserve $0.40 conservatively before
the paid tool call, then reconcile known token usage and $0.01 per tool call;
unknown costs retain the reservation. Planning-only and excerpt-only requests
reserve $0.02. Source search and local Ollama do not invoke the paid web tool.

49 offline automated checks and browser checks passed, including atomic budget
upgrades, failure reservations, multi-source citations, exact segment validation,
local/document-only isolation, immediate reply submission, mobile layout, source
exports, the small meteor impact animation, and reduced-motion behavior.

Broader current-law, comparison, false-premise, invented-authority, conversational,
Spanish-language and synthetic-document checks are running. Final outcomes and
cost reconciliation will be added here; do not interpret this report as a pass.
