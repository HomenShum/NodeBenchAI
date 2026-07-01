# FR-A5: AR aging — third live accounting proofloop run, full pass + one more gate extension

## The task, with hand-computed ground truth

> "I need an AR aging analysis. We have an invoice for $3,200 issued on May 15, 2026, with payment
> terms of Net 30. Today's date is July 1, 2026. Which aging bucket does this invoice fall into
> (current, 1-30 days past due, 31-60 days, 61-90 days, or 90+ days past due), and exactly how many
> days past due is it? Please show your calculation."

Ground truth (computed independently before running): due date = May 15 + 30 days = June 14, 2026.
Days past due as of July 1, 2026 = 16 remaining days in June + 1 day in July = **17 days**, which
falls in the **1-30 days past due** bucket.

## Result — full pass

**SHORT ANSWER:** *"The $3,200 invoice is exactly 17 days past due and falls into the **1-30 days past
due** aging bucket."*

**WHY USEFUL:** *"...the invoice due date was June 14, 2026 (May 15 + 30 days). As of July 1, 2026,
the calculation is: 16 remaining days in June + 1 day in July = 17 days past due. **Status: FAIL**;
the invoice has exceeded its Net 30 credit terms..."*

Bucket ✅ correct. Days-past-due ✅ correct, exact match to hand-computed ground truth. Derivation ✅
shown, and the shown arithmetic is itself correct (matches the ground truth's own decomposition).
Evidence: chaserhq.com, tabs.com, content.one.lumenlearning.com, paidnice.com — 4/5 genuinely
AR-aging-relevant and source-body-verified, 1/5 fetch-blocked (403, an honest `SOURCE_FETCH_BLOCKED`
flag rather than a silent fabrication).

**Verdict: FULL PASS.** Third real live accounting scenario this session (bank reconciliation,
journal entry, AR aging) and the second full pass after the two fixes shipped.

## But the routing worked by accident, not by design — a real gap, now fixed

Trace: `google_search grounding · medium risk · Freshness intent detected, so live grounded search
stays enabled.` — **not** the `CALCULATION_INTENT_PATTERNS` gate. The prompt's "Please show your
calculation" doesn't match `/\bshow\s+(?:your\s+)?(?:math|work)\b/i` (no "math"/"work" token), and
none of the reconcile/journal-entry/trial-balance/tie-out/debits=credits patterns fired either. It
only got correctly routed because "**Today's** date is..." independently tripped the pre-existing
`FRESHNESS_PATTERNS` (`/\btoday\b/i`). Had the user phrased it "As of 2026-07-01" instead of "Today's
date is", it would have fallen straight back through to the irrelevant-cache bug the calculation gate
exists to fix.

**Extended** `CALCULATION_INTENT_PATTERNS` (`shared/redesign/contextRuntimePolicy.ts`) to cover this
shape directly rather than relying on freshness-keyword luck: added `show your calculation` (not just
math/work), `aging bucket/analysis/report/schedule`, `days past due`, `AR/AP aging`, and `Net \d{1,3}`
(payment-terms convention, e.g. "Net 30/60/90" — bounded to 1-3 digits so it doesn't match years).
Added a scenario test proving the calculation gate fires (not freshness) for the exact same query with
the freshness word removed, plus a guard test that an ordinary earnings headline mentioning "net
income" near a number does NOT over-fire. 8/8 tests pass.

## Maps to the oracle + Kaggle pin

`packages/nodeeval/src/accounting/arApAging.ts` is the deterministic oracle this scenario should
eventually be scored against mechanically (bucket classification is a pure function of invoice date,
terms, and as-of date — exactly the kind of check that doesn't need an LLM judge). No Kaggle AR/AP
aging-specific dataset was found in the earlier dataset search; the 3 pinned datasets
(`noderl/docs/accounting-benchmarks.md`) don't cover this task type specifically — worth a follow-up
search if the oracle gets wired to real external data.
