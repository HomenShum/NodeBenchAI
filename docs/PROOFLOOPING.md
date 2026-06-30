# proof-looping

> No "done" without proof. Run the real product, capture evidence, let an **independent judge**
> score it, and only believe a pass that survives that judge — not a deterministic heuristic that
> can be fooled by template content.

Two runnable proofs, both driven against the **real app** (no mocks):

## `npm run proofloop:ui` — breadth (every UI surface, live browser)
[`surface-bench.mjs`](../surface-bench.mjs) drives each nodebench-ai UI surface on the live site
(`BASE_URL`, default `https://www.nodebenchai.com`) through a real Chromium browser and, per surface,
captures a **screenshot + video + console log**, runs **deterministic UI-contract checks**
(renders, per-surface acceptance `expect`, console-error count, overflow, AgentNativeUI root attrs),
and scores it with a **Gemini visual judge** (`gemini-flash-latest`, `GEMINI_API_KEY`). It also drives
one **interactive task** (anonymous user submits a research query and must get a real answer).

Evidence → `.proofloop-ui/<ts>/{screenshots,videos,scorecard.json,scorecard.md}`.

## `npm run proofloop:engine` — depth (the harness, one real task)
[`proofloop-run.ts`](../proofloop-run.ts) runs the real `server/agentHarness.ts`
(`generatePlan → executeHarness → synthesizeResults`) end-to-end, with the model + web substrate
injected through the harness's own `callTool` seam — used here to run it on **`z-ai/glm-5.2` (OpenRouter)
+ Firecrawl** (parity with the NodeRoom default) and export an `(s,a,o,r)` trace.

Evidence → `.proofloop-run/<ts>/{report,packet,events}.json`.

## What the first runs proved (honest)
- **Breadth:** 16 public surfaces render clean (det 100/100, visual ~1.7/2). The visual judge surfaced
  real defects: `agents` card overflow + button/timestamp overlap, `reports` tag contrast, `lens`/`pricing`
  truncation, `changelog` wrong active-nav. Deep surfaces (`/chat`, `/me`, `/inbox`) are reachable but
  auth-gated.
- **Depth:** the harness runs on glm-5.2 in ~22s for ~$0.0015; `company_search` synthesis is
  deterministic-first (model = analyst feeding a template, not the narrator); glm-5.2 (~8s/call) needs a
  wider `toolTimeoutMs` than the Gemini-Flash-tuned default.
- **The load-bearing lesson:** the interactive task's *deterministic* detector returned a false PASS
  **twice** (fooled by the seeded demo conversation's own copy-buttons + template text). Only the
  **independent visual judge** + a query-topic content check caught that anonymous submit is
  **sign-in-gated** — the task does not actually complete. A deterministic-only gate would have shipped
  a lie. That is the entire reason proof-looping pairs an independent judge with the deterministic floor.

## Honest scope / next
- The UI bench scores **render + visual quality + reachability** and one interactive task. Full
  task-completion across the deep app needs an **authenticated session** (storageState) — anonymous
  submit is gated (proven above).
- Live runs show some flakiness; add an **N-run / retry** policy before treating a single run as the verdict.
- Promote each visual-judge defect to a deterministic regression check.
