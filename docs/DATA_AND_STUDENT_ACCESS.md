# Data access and student resources

Checked 2026-10-05. No new paid subscription was purchased for this update.
The hosted model retains its owner-authorized $10 lifetime demo cap. Local
Ollama inference does not consume OpenAI credits.

## What is free now

| Source or tool | Cost/access | What Lex Raptor uses |
| --- | --- | --- |
| Federal Register API | Public; no API key | Document search and full published text, with source type and official PDF links |
| eCFR API | Public developer API; no account | Regulation search and dated section text |
| CAP starter collection | Included locally | Twelve public Supreme Court opinions; this is not the entire CAP archive |
| Local Ollama model | No model API fee | Workbench drafting on your hardware; electricity and hardware are yours |
| CourtListener | Free account and API token; default limits below | Connector supports nationwide opinion search, full opinion retrieval and citation lookup once configured |

[Federal Register API documentation](https://www.federalregister.gov/developers/documentation/api/v1)
explicitly states that no API key is needed.
[eCFR developer documentation](https://www.ecfr.gov/developers/documentation/api/v1)
provides the public regulation endpoints. eCFR is an editorial compilation;
FederalRegister.gov text should be checked against the linked official edition.
A proposal, notice, regulation, and judicial opinion are different source types.

## CourtListener: the next case-law connection

[Free Law Project's membership page](https://free.law/membership/) lists a free
non-member API tier of **5 requests/minute, 50/hour and 125/day**. Membership
API eligibility includes academics and pre-revenue, pre-funding organizations;
confirm the applicable tier as the project grows. Individual paid memberships
start at **$10/month or $100/year**. No paid membership is required to try this
connector within the free tier.

Students, faculty, and researchers with a valid **.edu address** can apply for a
complimentary EDU membership. Do not assume the educational grant covers every
future commercial deployment: verify eligibility and permitted use with Free Law
Project before expanding or funding the service. Their
[API membership announcement](https://free.law/2026/05/07/api-included-in-memberships/)
describes coverage of over nine million decisions from more than 2,000 courts.

1. Create or sign into your CourtListener account.
2. Retrieve the token from [your API-token profile](https://www.courtlistener.com/profile/api-token/).
3. Save `COURTLISTENER_API_TOKEN` in ignored `website/.env.local` for the local
   workbench, or the hosted site's private environment configuration. Never put
   it in GitHub, browser JavaScript, or a chat message.
4. For hosting, add the token as a server-side secret and redeploy. For local
   use, restart `npm run local`.

The workbench applies the free-tier ceiling conservatively to all visitors
sharing the token. A search can use one search request plus up to three opinion
requests; cached public documents reduce that. Citation lookup also consumes
source requests. It verifies existence/ambiguity only; it is not a replacement
for a treatment citator. Provider limits cover every installation sharing the
account. Rate-limited searches report incomplete coverage instead of retrying.

No PACER purchase endpoints are connected. We do not request paid docket
retrievals or enroll the owner in a recurring plan.

## Use your school's existing legal-research access

Ask your law librarian which tools are included in your account before buying
anything. Thomson Reuters provides a
[CoCounsel Legal law-school access page](https://lawschool.thomsonreuters.com/press-start-on-cocounsel-legal/).
Lexis announced
[free Lexis+ AI access for students at ABA-accredited law schools](https://www.lexisnexis.com/community/insights/legal/b/product-features/posts/lexisnexis-rolls-out-free-access-to-lexis-ai-for-law-students).
Current feature availability depends on your school, account, region and rollout.
These accounts are useful for learning the workflows and manually reviewing
research quality. School access is not evidence of permission to scrape,
redistribute proprietary content, or feed an open public service. Get separate
permission for any proposed automated integration.

The [GitHub Student Developer Pack](https://education.github.com/pack) may provide
development or hosting benefits after student verification. Offers have separate
eligibility and expiration rules; no new hosting purchase is needed for this
release. Do not enable paid overages just to redeem a credit.

## What still needs investment

The difficult gap with Westlaw/CoCounsel and Lexis+ is not just the model:
comprehensive coverage, reliable updating, editorial treatment analysis, and
independent legal evaluation all matter. This release has no KeyCite/Shepard's
equivalent, proprietary headnotes, docket purchasing, or comprehensive legal
accuracy claim. It does not bulk-copy those vendors' databases.

The next useful evaluation is a held-out set across jurisdictions and tasks,
with human review of retrieval completeness, controlling authority, exceptions,
adverse cases, and each proposition's support. Existing small diagnostics and
quote-match rates do not establish parity with commercial products.
