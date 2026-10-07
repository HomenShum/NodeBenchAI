# FR-A6: Trial balance — 4th live scenario, full pass, and a live confirmation the layered fix is robust

## Task + ground truth

> "Please check this trial balance for me. Cash is $18,750 debit. Inventory is $11,250 debit.
> Accounts Payable is $4,900 credit. Owner's Equity is $25,100 credit. Add up all the debit balances
> and all the credit balances separately, then tell me if the two totals match, and show me the math
> you used."

Ground truth: debits $18,750 + $11,250 = $30,000. Credits $4,900 + $25,100 = $30,000. Balances exactly.

## Result — full pass

*"The trial balance is in equilibrium as both total debits and total credits equal $30,000... The math
is as follows: Total Debits ($18,750 + $11,250) = $30,000; Total Credits ($4,900 + $25,100) = $30,000.
Since $30,000 - $30,000 = $0, the trial balance achieves an explicit **pass** confirmation."* — exact
match to ground truth, full derivation shown, explicit confirmation stated. Evidence:
floqast.com/abacum.ai/openstax.org, all genuinely accounting-relevant.

## A live demonstration that the layered fix is more robust than fixing the classifier directly

`classify_query` misfired again — this time as `company_search · Please`, extracting the sentence's
first word ("Please") as an entity-search target. Same bug family as FR-A1's `company_search · Bank`
misfire (a capitalized/leading word gets grabbed as a pseudo-entity). **This did not degrade the
answer**, because `decideLiveGrounding`'s `CALCULATION_INTENT_PATTERNS` gate operates independently of
entity classification — it forced live grounding based on the prompt's calculation-shape alone
("Calculation/verification request detected" fired regardless of the classifier's unrelated mistake).

This is a real, live-confirmed argument for the choice made earlier this session: fixing the
*grounding-routing* layer rather than attempting to fix `classify_query`'s entity-extraction logic
directly. `classify_query` is still buggy (worth its own fix eventually, filed under task #12's "true
agent frontier" harness-bottleneck thread) — but the system is now resilient to that bug for
calculation-shaped queries specifically, because the fix doesn't depend on the classifier being right.

## Accounting proofloop suite — final tally this session

| Scenario | Verdict | Notes |
|---|---|---|
| FR-A1 (bank reconciliation, original) | Partial pass | Root cause found: `classify_query` + irrelevant grounding |
| FR-A1 (rerun after both fixes) | **Full pass** | Derivation shown, explicit confirmation |
| FR-A4 (journal entry) | Near-pass (5/6) | Correct entries; missing explicit balance confirmation |
| FR-A5 (AR aging) | **Full pass** | 17 days past due, correct bucket, derivation matches hand-computed ground truth |
| FR-A6 (trial balance) | **Full pass** | Exact match to ground truth; also proves fix robustness to a live classifier misfire |

3 full passes + 1 near-pass across 4 distinct accounting task types (reconciliation, journal entry,
aging, trial balance), 2 real production bugs found+fixed+deployed+live-reverified this session
(`chatRuns.ts` synthesis prompt, `contextRuntimePolicy.ts` calculation-intent gate + AR/AP aging
extension), full repair-loop closure proven on real data (task #5). A separate deterministic
derivation-injection attempt was built, adversarially reviewed, found unsafe (P0 deposit-in-transit
sign inversion), and fixed+reverified — currently uncommitted pending final review before any decision
to ship.
