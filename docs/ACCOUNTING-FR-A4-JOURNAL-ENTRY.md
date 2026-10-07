# FR-A4: Journal entry proposal — second live accounting proofloop run

> Second real, live, end-to-end accounting scenario against `www.nodebenchai.com`. Result is
> **meaningfully better than FR-A1** — this is honest signal that the classification-driven gap in
> FR-A1 was query-shape-dependent, not a blanket "accounting is broken" failure.

## The task

> "I need a journal entry proposal. We received a $5,000 cash payment from a customer for services
> not yet performed (deferred revenue), and we paid $1,200 cash for office rent for this month. Please
> propose the journal entries for both transactions, showing account names and whether each line is a
> debit or credit, and confirm debits equal credits for each entry."

Expected: (1) Dr Cash $5,000 / Cr Deferred Revenue $5,000. (2) Dr Rent Expense $1,200 / Cr Cash $1,200.

## What happened (live, DOM-extracted)

- Same `userLoading` race on first submit (expected, confirms that fix's behavior is consistent) →
  retry succeeded.
- `Entity identification: general · no entity` — **this time the classifier correctly avoided the
  entity-mismatch trap** that misrouted FR-A1 to `company_search · Bank`. No capitalized noun phrase
  in this query happened to trip the same regex/entity-match heuristic.
- Research run: **13/14 passed**, real accounting-education sources (accountingcapital.com,
  wallstreetprep.com, ramp.com — genuinely on-topic, one example source literally walks through a rent
  journal entry).
- **SHORT ANSWER:** *"The proposed journal entries include a debit to Cash and a credit to Deferred
  Revenue for $5,000, alongside a debit to Rent Expense and a credit to Cash for $1,200."*

## Honest scorecard

| Check | Result | Evidence |
|---|---|---|
| Entry 1 account names + side (Dr Cash / Cr Deferred Revenue) | ✅ PASS | stated exactly, correct |
| Entry 1 amount ($5,000) | ✅ PASS | correct |
| Entry 2 account names + side (Dr Rent Expense / Cr Cash) | ✅ PASS | stated exactly, correct |
| Entry 2 amount ($1,200) | ✅ PASS | correct |
| Evidence grounded in the actual transaction (not generic) | ✅ PASS | accountingcapital.com's cited example is a rent-expense journal entry — directly on-topic |
| **Explicit "debits = credits" confirmation (asked for)** | ❌ **FAIL** | never explicitly stated; entries are balanced by construction but the affirmative check-statement is missing |

**Verdict: near-PASS.** 5/6 checks pass, including every substantive accounting fact. The one gap —
not explicitly confirming the balance check the user asked for — is the same *category* of gap as
FR-A1 (answer format doesn't show/state the verification step), but far less severe: the underlying
accounting reasoning is fully correct here, whereas FR-A1 never derived its number at all.

## FR-A1 vs FR-A4 — what this comparison proves

| | FR-A1 (bank reconciliation) | FR-A4 (journal entry) |
|---|---|---|
| classification | `company_search · Bank` (misrouted) | `general · no entity` (correct) |
| evidence relevance | generic "how to reconcile" articles | genuinely on-topic accounting examples |
| core accounting answer | correct number, no derivation shown | correct entries, mostly complete |
| explicit verification statement requested | missing | missing |

**The consistent, real finding across both runs:** the underlying model/answer-synthesis is
capable of correct accounting reasoning — the recurring gap is the harness never asks it to show an
explicit derivation/verification line, regardless of whether classification succeeds or fails. That is
now a **repeated pattern** (2/2 runs), which is exactly what should be promoted to a shared regression,
per the repair-loop discipline ("a fix that only lifts one tuned task is reverted; a repeated pattern
across independent tasks is the real signal").

## CORRECTION — deeper root cause found (same session, after the synthesis-prompt fix)

The prompt fix above (instructing the model to show derivations for calculation requests) shipped to
prod (`chatRuns.ts`, commit `2f1f791`), but re-driving both FR-A1 and FR-A4-shaped queries live
**after** that deploy showed **no observable change** — if anything, the "Why it matters" section got
*thinner* ("Accurate [1]"), and evidence stayed pinned to the same 6 irrelevant cached sources ("Act
I/II/III", "r/technology", "GitHub", "r/Economics" — sources belonging to an unrelated tech/markets
"Daily Brief" thread) across two runs with different numbers.

Root cause, one layer up from the synthesis prompt: `shared/redesign/contextRuntimePolicy.ts`'s
`decideLiveGrounding()` has a branch — `if (memorySufficient && input.sourceRefCount >= 2)` — that
skips live web-search grounding based purely on *structural* signals (does the thread have ≥2 cached
source refs?), with **no check that those cached sources are topically relevant** to the question. A
calculation request asked inside any thread with unrelated cached context gets routed to "answer from
memory," and the model never sees anything to ground a derivation in — my prompt instruction had
nothing to work with. This explains both observed symptoms at once (no derivation shown; same
irrelevant evidence every time) and is the reason the earlier prompt-only fix, while directionally
correct, did not move the observed output.

Fixed in the same file: added a `CALCULATION_INTENT_PATTERNS` check (reconcile, journal entry, trial
balance, tie out, debits=credits, show your math/work) that forces `useLiveGrounding: true` regardless
of the structural "memory sufficient" shortcut — strictly additive (can only flip skip→do grounding,
never the reverse), so it cannot regress ordinary research/company queries. Covered by 3 new
scenario-based tests in `contextRuntimePolicy.test.ts` reproducing the exact live bug shape (calculation
query inside a thread with structurally-sufficient-but-irrelevant cached context), all passing, plus
confirmation that an ordinary funding-news query mentioning a dollar amount is untouched.

**Deployed and re-verified live** (commit `e13b9a0`, deployed to `agile-caribou-964`): re-ran the exact
bank-reconciliation shape with fresh numbers ($7,320.60 / $7,105.10 / $215.50 outstanding check). Trace
panel now shows the new reason string firing — *"Calculation/verification request detected — the
active thread's cached context is not a substitute for grounding the specific numbers asked about"* —
and evidence changed from the previous irrelevant tech/economics cache to genuinely on-topic sources
(quickbooks.intuit.com, netsuite.com, help.acst.com). **This part of the fix is confirmed live and
working.**

**Still open, honestly:** even with correct, relevant grounding now in place, the final answer still
does not show the explicit arithmetic ("$7,320.60 − $215.50 = $7,105.10") — it states the conclusion
("balances reconcile successfully") without deriving it. That is now a **3rd confirmed occurrence**
of the same gap (FR-A1, FR-A4, this rerun) — more confirmed than the grounding-routing bug was before
its fix. Conclusion: a natural-language prompt instruction ("show your derivation") is not a reliable
enough lever for a small, fast model under a tight "one paragraph" format constraint. The correctly-scoped
next fix is **deterministic, not another prompt tweak**: compute the reconciliation/journal-entry
arithmetic server-side (the deterministic oracles in `noderl/packages/nodeeval/src/accounting/*.ts`
already exist for exactly this) and inject the computed line as a pre-verified fact into the context
bundle, so the model relays a fact instead of being asked to both compute and format it under
constraint. Scoped as the next item under task #12 (true agent frontier) rather than attempted here —
it requires wiring the context-bundle assembly step to a numeric extractor + the existing oracle
functions, which is real feature work, not a safe small patch.
