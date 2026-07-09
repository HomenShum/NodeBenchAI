# FR-A1: Bank reconciliation — first live accounting proofloop run

> The first real, live, end-to-end accounting scenario run against `www.nodebenchai.com`, as a real
> authenticated user, through the actual chat UI — no shortcuts, no seeded backend injection. Honest
> result: **partial pass**, with a precisely root-caused gap, not a vague "it failed."

## The task (a real bookkeeper's question)

> "I need to reconcile my bank statement and general ledger. Bank statement ending balance is
> $12,540.75. General ledger ending balance is $12,128.25. There is one outstanding item: check
> #1042 for $412.50 has not cleared yet. Please reconcile these two balances and tell me whether they
> tie out, showing your math."

Expected: $12,540.75 − $412.50 (outstanding check reduces bank-side) = $12,128.25 = GL. **Ties out.**

## What happened (live, verified via DOM extraction — not a screenshot)

1. First submission hit the `userLoading` race (the exact honest message from today's earlier fix:
   *"NodeBench is still confirming your account. Send your message again in a moment."*) — expected,
   not a new bug; confirms that fix is live and behaving correctly.
2. Retry succeeded. `classify_query` step: **`company_search · Bank`** — the intent classifier has no
   accounting/calculation category, so it fell back to treating "Bank" (from "bank statement") as an
   entity to research. This produced 5 generic **web-search citations** ("How to Reconcile the General
   Ledger", superfastcpa.com/reliabills.com/sage.com/help.acst.com/ledge.co) — process explainers, not
   anything grounded in the user's actual $12,540.75/$12,128.25/$412.50.
3. **The final SHORT ANSWER is nonetheless correct:** *"The bank statement and general ledger balances
   tie out exactly at $12,128.25 after adjusting for the outstanding check."* Right number, right
   conclusion.

## Honest scorecard (against the FR-A1 verifier categories)

| Check | Result | Evidence |
|---|---|---|
| Correct final tie-out amount | ✅ PASS | "$12,128.25" stated correctly |
| Correctly identifies the reconciling item | ✅ PASS | "after adjusting for the outstanding check" |
| **"Showing your math" (explicitly requested)** | ❌ **FAIL** | No visible arithmetic ($12,540.75 − $412.50 = $12,128.25) anywhere in the response — the answer asserts the conclusion without deriving it |
| Evidence grounded in the user's own numbers | ❌ **FAIL** | All 5 citations are generic "how to reconcile" web articles; `PROVIDER_GROUNDED_UNMATCHED` on 2 of 5 (source didn't even contain the cited snippet) |
| Query correctly classified as a calculation, not research | ❌ **FAIL** | `classify_query` → `company_search · Bank` |
| No private data leak / no clobber | ✅ PASS | n/a for this single-turn read task |

**Verdict: PARTIAL PASS.** The agent gets the right number by some path (likely the underlying model
computing it directly in synthesis despite the misrouted plan), but the *process* — the exact thing an
auditor/banker would need to trust the output — is missing. An accounting user cannot verify this
answer without redoing the arithmetic themselves, which defeats the point.

## Root cause (for repair, per the repair-prompt discipline)

`classify_query`'s intent taxonomy has no `accounting_reconciliation` / `calculation` category — free-text
numeric reconciliation requests fall through to `company_search`, extracting a noun phrase ("Bank") as
if it were a research subject. This is the same class of gap flagged in task #12 (true agent frontier):
the harness's classifier, not the underlying model, is the bottleneck.

## What this proves about the accounting proofloop, honestly

- **The live-user contract works end-to-end for a real financial task** — no shortcuts, real chat UI,
  real auth, real (correct) final answer, real evidence trail (even if the evidence itself is weak).
- **The deterministic oracles already shipped (`packages/nodeeval/src/accounting/bankReconciliation.ts`)
  are the right next-step scorer** — they would catch exactly this gap mechanically (checking for the
  presence of the actual computed line items, not just a stated conclusion) once the harness's output
  is in a checkable shape (a proposed JE / reconciliation schedule, not free text).
- **This is not a "the agent is broken" finding.** It is a precise, actionable "the classifier needs an
  accounting/calculation intent category, and the answer format needs to show derivations" finding —
  exactly the honest, root-caused signal the accounting benchmark exists to produce.
