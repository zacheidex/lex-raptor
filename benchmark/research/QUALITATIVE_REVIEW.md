# Qualitative review of the local diagnostic

This is an assistant spot-check of the retained answers in `local-results.json`, run starting 2026-10-04T23:58:01Z. It is not an independent attorney review, an exhaustive proposition audit, or an overall legal-accuracy grade. Numbered propositions below are one-based within each retained answer. The unedited machine-readable report contains each claim, quotation, selected passage and original source URL.

## Confirmed support problems that survived the quote gate

All four quotations in the `erie` answer passed literal matching. Three retained propositions nevertheless illustrate separate support problems:

| Proposition | Retained statement / issue | Source evidence |
| --- | --- | --- |
| 2 | “The law to be applied in any case is the law of the State.” This drops an express exception, making the statement overbroad. | `cap-10687:943d7cfef836:1:19:0` begins with an exception for matters governed by the Federal Constitution or Acts of Congress. The generated quotation itself includes the exception. |
| 3 | Says federal courts are **not** free to exercise independent judgment on general law without a local statute, but cites a quotation saying they **are** free. The cited passage reports the lower court's reasoning; it does not substantiate the generated proposition as quoted. | `cap-10687:943d7cfef836:1:6:0` attributes the quoted rule to the Circuit Court of Appeals. The conclusion may relate to the Supreme Court's ultimate rejection of that approach, but this citation does not demonstrate that rejection. |
| 4 | Says previous justices protested the doctrine, while its quotation says, “The doctrine has not been without defenders.” That quotation does not support the stated proposition. | `cap-10687:943d7cfef836:1:69:0` lists defenders. A different selected passage mentions a protest by Justice Field; this does not repair the incorrect claim-to-quotation pairing. |

The source is the public [CAP record of Erie, 304 U.S. 64](https://static.case.law/us/304/cases/0064-01.json), SHA-256 `943d7cfef836feb62e1e88cf7d7f557b53010b4079fb373268e0d92a1411256f`. These are observable problems in the generated answer and its own supplied evidence, not a claim to have assessed every later qualification of Erie.

## Other limitations visible in the answers

- `twombly_iqbal` cites only Iqbal when both source cases were expected. `daubert` and `unnamed_experts` cite Kumho instead of Daubert. A later opinion discussing the requested rule can supply relevant authority, so these are failures of the stated source-coverage check, not automatic proof of fabricated law.
- `wrong_majority` correctly labels its two retained citations as majority and dissent. It does **not** establish a dissent-to-majority misattribution. Its majority summary omits the cited paragraph's ultimate rejection of the complaint despite the stated distinctions. The two earlier propositions, including the more direct explanation of the majority's reasoning, were removed for quotation mismatches. This illustrates how filtering can leave an incomplete comparison.
- Of the 11 raw quotation mismatches, one quotation exists in another selected passage but uses the wrong passage ID. Ten do not match any selected passage verbatim. Some mismatches involve punctuation or paraphrase; this count should not be described as 11 fabricated authorities. The application removes the affected propositions, and the report retains them for inspection.

## What the results justify

The MVP demonstrates retrieval, local generation, quote inspection, abstention on three bounded tasks, and an enforced absence of paid fallback. It does **not** demonstrate reliable legal conclusions. In particular, source identity and literal matching cannot establish speaker attribution, exceptions, legal context, or entailment.

Next evaluation work should use attorney-authored rubrics and independently reviewed proposition-level judgments, assess the answer **after** filtering, measure completeness and opinion attribution separately, and add a broader held-out corpus with conflicting and subsequent authorities. Prompt changes informed by this diagnostic must be reported as development work and evaluated on fresh tasks before claiming improved general performance.
