# Proofloop gap ledger — accounting + Notion SDR + modern-design readiness

> **Question asked:** can proof-looping *guarantee* that NodeRoom + NodeBench AI are end-to-end ready
> for accounting tasks (top finance benchmarks + pinned Kaggle datasets) and the Notion SDR/BDR
> scenarios, on the **prod app UI**, with modern web-design principles?
>
> **Honest verdict: NOT YET — and that is proof-looping working as intended.** Per the operating rule
> ("if we can't guarantee it, then something must be updated for our proofloop"), the gaps below ARE
> the answer. No guarantee is faked (PROVE-BEFORE-CLAIM); see `PROOFLOOP-FAILURE-SIGNALS.md`.

## The ledger (close in order — #1 is the prerequisite for everything)

| # | Gap | Type | Status / evidence |
|---|---|---|---|
| **1** | **Agent doesn't use its tools** | app-not-ready · **P0 prerequisite** | Prod comprehensive benchmark = **1/43** (`BENCHMARK-BASELINE.md`). 28/42 fails = zero tools called. Tool-needing queries land on the no-tools lane. **Nothing else can pass until this is fixed.** |
| 2 | Accounting proofloop suite (scenarios / oracles / rubrics) | proofloop-gap · P1 | **Does not exist** — net-new. `proofloop/accounting/{scenarios,oracles,rubrics}` unbuilt. |
| 3 | Finance benchmarks + datasets | proofloop-gap · P1 | Names (Finch, BizFinBench, FinTMMBench, QuantEval, FATURA, CORU, AMuRD) are **ChatGPT-supplied and UNVERIFIED.** Must confirm each exists + license, then **pin** `{slug, version, sha256}`. Kaggle: no `latest` — pin or reject. |
| 4 | Notion SDR/BDR 4-scenario suite | proofloop-gap · P1 | **Does not exist** — net-new (warm-intro / follow-up / pipeline / meeting-prep). |
| 5 | Modern-design / WCAG-2.2 rubric | proofloop-gap · P2 | **Partial** — `surface-bench.mjs` visual judge exists; no accounting/Notion design rubrics; WCAG-2.2 mapping unbuilt. |
| 6 | Clips wired to scenarios | proofloop-gap · P2 | `feature-walkthrough-gif` **exists but is not wired** as a `proofloop:accounting` / `proofloop:notion` clip step (replacing the manual Loom). |

## Why #1 gates everything

Building an accounting benchmark or Notion scenario suite on an agent that punts 42/43 tool tasks would
just fail everything for one reason. So the sequence is not negotiable:

```
#1 fix agent tool-routing  →  #2/#4 build the suites on a tool-using agent  →  #3 verify+pin datasets
   (verified, not blind)                                                     →  #5/#6 design + clips
                                                                             →  THEN a real
                                                                                proofloop:accounting /
                                                                                proofloop:notion GUARANTEE run
```

## Gap #1 — the prerequisite, scoped

- **Symptom:** 1/43 on `tools/evaluation/comprehensiveTest`; 28/42 fails = ZERO tools called (document
  read/create/edit, tasks, events, media). Only search/SEC/web tools fire.
- **Root cause (code-grounded):** `fastAgentPanelStreaming.ts` routes each turn to one of three lanes —
  Coordinator, **FastResponder (`tools:{}`)**, ChatAgent (full tools). The eval calls `sendMessageInternal`
  **without `useCoordinator`**, and `chooseNodeBenchRuntimeRoute` / `shouldUseFastResponder` can drop
  tool-needing queries onto the no-tools FastResponder lane. The "no tools called → force tool-first
  follow-up" safety net (~L5956) is not recovering them.
- **Fix (proposed, PR-gated):** ensure tool-needing intents route to the full-tools lane; make the forced
  follow-up use the full-tools lane. Locus: lane select (~L5523) + route fn + `shouldUseFastResponder`.
- **Verify (safe, no blind prod deploy):** `convex deploy --preview-create` an isolated preview →
  re-run the **failing slice** → a fix counts only if the task's score flips **with evidence** → then the
  full 43 → open a PR for prod. All-green is not claimed until the re-run proves it.

## What is already TRUE on prod (not vaporware)

- The **benchmark/proofloop runs on prod** — the eval executes inside live Convex (`agile-caribou-964`);
  that is how the 1/43 baseline was produced.
- **PROVE-BEFORE-CLAIM gate** is canonical in noderl and linked from every ecosystem repo's NODE-LOOPS.md.
- **Google OAuth** on prod was broken (SITE_URL mismatch) and is **fixed + verified** (`SITE_URL` →
  `https://www.nodebenchai.com`).

## Status

Cannot guarantee accounting/Notion/design readiness today. The blocker is one systemic app bug (#1) plus
four net-new proofloop suites (#2–#6). Closing #1 (verified via preview) is the single next action that
unblocks the rest.
