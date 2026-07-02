# Deterministic derivation-injection fix — adversarial review found a real P0, correctly blocked

> Task #12's deterministic compute-and-inject fix (scoped in `ACCOUNTING-FR-A4-JOURNAL-ENTRY.md`'s
> CORRECTION section) was built and adversarially reviewed via a background workflow. **Verdict: NOT
> safe to deploy.** Nothing was committed or deployed. This is the adversarial-verify discipline
> working exactly as intended — the exact risk flagged when this work was originally deferred
> ("auto-extracting financial semantics from free text... a misparse could inject a confidently wrong
> number") was real, and it was caught before shipping.

## What was built

`shared/redesign/bankReconciliationFactExtractor.ts` (new, untracked) — `extractBankReconciliationFact(prompt)`:
extracts exactly 3 dollar amounts from a bank-reconciliation-shaped prompt, role-assigns them via
keyword-tagged clauses (bank/ledger/outstanding), computes `bankBalance - outstandingItem` vs
`ledgerBalance`, and returns a `VERIFIED_CALCULATION` fact string — or `null` on any ambiguity. Wired
into `convex/domains/redesign/chatRuns.ts` (uncommitted diff) to inject the fact into the context
bundle and instruct the model to relay it verbatim rather than recompute. 12 scenario tests, all
passing; `tsc` clean; zero new lint errors.

## What the adversarial review found (empirically reproduced, not theoretical)

**P0 — deposit-in-transit sign inversion.** The extractor's `outstanding` role pattern matches
`deposits? in transit` and routes it into the same slot as an uncleared check, which is always
*subtracted*. Real accounting *adds* deposits-in-transit to the bank side. Reproduced live:
*"Bank shows $8,200.00. Ledger shows $8,700.00. We have a deposit in transit of $500.00."* — true
reconciliation ties out exactly (`8200 + 500 = 8700`); the extractor outputs a fabricated
`DOES NOT MATCH` with a $1,000 phantom discrepancy, which `chatRuns.ts`'s prompt then instructs the
model to relay verbatim, removing the model's own ability to catch the error. The builder's 12-test
suite has zero occurrences of "deposit" — the pattern was written but never exercised.

**P1 — lexical-only gating can fabricate a fact from non-financial text.** No semantic check that the
prompt is actually about a real bank/ledger balance — just keyword + exactly-3-amounts. Reproduced:
*"I need to reconcile my emotions. My bank account triggered a $500.00 wave of anxiety..."* produces a
fully fabricated `VERIFIED_CALCULATION`.

**Confirmed correctly handled:** amount-ordering independence, float-noise tie-out correctness (both
matching and genuinely-non-matching cases), all 8 of the builder's own ambiguous-shape null-gates,
multi-currency safely ignored.

**Minor, non-blocking:** negative/parenthesized amounts (`-$500`, `($500)`) silently drop the sign
instead of being rejected.

## Current state

Uncommitted in `/c/tmp/nodebench-ai` working tree (`git status --short` shows the 2 new files +
the `chatRuns.ts` diff). Not deployed. Not merged. The concurrent `CALCULATION_INTENT_PATTERNS`
commit (`30999b8`) landed independently and does not conflict.

## Required before this can ship (per the adversarial review)

1. Fix or remove deposit-in-transit handling — either give it its own role with `+` in the formula
   and prove both directions with tests, or strip it from the `outstanding` pattern entirely so it
   safely falls through to `null` until implemented.
2. Add explicit tie/non-tie/mixed tests for deposit-in-transit.
3. Add a rejection gate for negative/parenthesized amounts.
4. Consider tightening gate 1's keyword co-occurrence requirement (defense-in-depth against P1).
