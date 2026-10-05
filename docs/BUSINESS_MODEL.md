# Lex Raptor: free software and optional managed API connections

The product name is **Lex Raptor**. The first release focuses on source-grounded U.S. case-law research and private document work. It does not promise feature or coverage parity with Casetext, CoCounsel or Westlaw.

| Offering | Software fee | Inference cost | Status |
| --- | --- | --- | --- |
| Self-hosted local model | $0 | Own hardware/electricity; no per-call API fee | Implemented |
| Self-hosted provider connector | $0 to Lex Raptor | Provider bills user's own API account | Implemented, disabled until configured |
| Lex Raptor managed API connection | Small disclosed service fee | Provider usage plus fee | Planned; billing not enabled |

A reasonable initial managed-service proposal is **provider usage at published rates plus a 10% connection fee**, with a prepaid cap, a pre-call maximum, a separate provider/fee breakdown, no hidden minimum, and no charge on an unmade call. This is a proposal, not an activated price, a settled business decision, or a claim that 10% covers support, infrastructure and payment processing. Measure those costs before launching billing. The $100 authorized development budget is not a subscription or customer invoice.

A managed service can provide key custody, provider routing, consolidated billing, spend controls, hosting and support. The source of the adapters remains open. Users and competitors can run the code and connect directly to providers; a mandatory connector toll cannot be enforced while retaining these open-source freedoms. Our reason to charge is the service delivered, not control of the source code or legal information.

Before enabling managed billing, implement and test customer-level prepaid ledgers that reserve **provider cost plus the service fee** atomically, actual-usage settlement, refunds/reconciliation for uncertain outcomes, fee/tax disclosure, invoice exports and provider account terms. Existing development spend controls reserve provider usage only. Do not reuse them to imply a service-fee cap they do not enforce. Payment processing and customer money movement are not present in this MVP.

For independence, use AGPL-3.0-only, contributor-owned copyrights, portable source/data exports and a growing independent maintainer group. These measures keep compliant released versions runnable and forkable; they cannot make a company acquisition impossible. See GOVERNANCE.md.

Data strategy: begin with attributable public judicial opinions and local indexes; add licensed/open update feeds with explicit coverage and provenance. CourtListener is a potential optional connector, but its API needs authentication and has its own service terms; it is not required for free local research. No proprietary editorial analysis or treatment signals are copied. A credible, evaluated citator is a separate milestone.
