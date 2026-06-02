# NodeBench LLM Router (Prism-style planner-on-a-pool)

One deterministic entry point — `routeLLM(taskClass, signals)` in
`shared/llm/router.ts` — for "which model serves THIS turn?". Replaces the
~7 scattered, uncoordinated model-selection mechanisms across the codebase
with a single planner-on-a-pool, so every served LLM feature routes the same
way and emits the same telemetry.

## Prior art

- **Augment "Prism"** (2026) — *Introducing Augment Prism: model routing to
  reduce cost and maintain quality.*
  <https://www.augmentcode.com/blog/augment-prism-model-routing-to-reduce-cost-and-maintain-quality>
  - **Borrowed:** a small fast *planner* picks, per user turn, which model from
    a **fixed pool tuned to a quality target** handles the request ("you pick
    Prism, Prism picks the model"). Their measured result: **20–30% cheaper at
    negligible quality loss**, driven by the finding that *the top 10% of turns
    consume ~57% of LLM rounds* — most turns are light work billed at frontier
    rates because users pin the big model once and never switch.
  - **Their hard part we deliberately scope out of V1:** *switching evicts the
    prompt cache (~10× hit)*, so Prism only switches mid-session when the
    expected win beats the eviction cost, and keeps the route sticky across
    tool-call follow-ups. That cache-stickiness matters for long agent sessions.
- **"Kilo Code" complexity routing** — `assessComplexity() → model tier`,
  already present in `server/agentHarness.ts`. The router generalizes it.

## NodeBench adaptation (why it's *easier* here)

Most of NodeBench's served surface is **single-shot** — event `/ask`, query
classification, extraction, QA judging — independent requests with **no prompt
cache to evict between them**. Prism's ~10× switch penalty therefore does **not
apply** to those paths, so we route **per-request with a pure heuristic planner**
(zero added latency, no planner LLM call). Cache-aware stickiness — Prism's
genuinely hard part — is reserved for the **multi-turn agent loops** (FastAgent,
Convex agents) and layered on top of this core later.

## Routing direction

| Direction | When | Quality safety |
|---|---|---|
| **Escalate-up** (floor → climb on complexity) | default path is already cheap (e.g. `/ask` floors at Haiku) | always safe — going up never lowers quality. **V1 ships this.** |
| **Demote-down** (strong default → drop to cheaper on light turns) | path over-provisions (e.g. persona router pinning Opus for every banker turn) | **eval-GATED** — only demote once the cheaper model's measured agreement with the target stays above threshold (fed by `agentRunJudge` / dogfood scores). *Next layer.* |

## Reliability invariants (`.claude/rules/agentic_reliability.md`)

- **DETERMINISTIC** — `routeLLM` is a pure function of `(taskClass, signals, env)`.
  No `Date.now()` / `Math.random()`. Same turn → same route (replay-safe).
- **HONEST** — `forceTarget` and any uncertainty resolve **up** to the quality
  target, never silently down.
- **BOUND** — pools are fixed finite literals.

## Status

| Task class | Pool (floor → heavy) | Wired call site |
|---|---|---|
| `ask_answer` | Haiku `claude-haiku-4-5-20251001` → Sonnet `claude-sonnet-4-6` | ✅ `convex/events.ts` `generateProviderAnswer` (PR: this one) |
| `classify` | gemini-3.1-flash-lite (single) | ⬜ `server/routes/search.ts` query classify |
| `extract` | flash-lite → flash | ⬜ `server/routes/search.ts` signal extraction |
| `synthesize` | flash-lite → flash | ⬜ `server/routes/search.ts` answer synthesis |
| `agent_reason` | Sonnet → Opus | ⬜ FastAgent loop (needs cache-sticky wrapper) |
| `judge` | flash → haiku | ⬜ `agentRunJudge` / dogfood QA |

Floors are pinned to **current production behavior**, so wiring a call site
through the router is a no-op until signals say otherwise. Ops can pin/retune
any model via env (`SCRATCHNODE_ASK_MODEL_LIGHT` / `_HEAVY`;
`SCRATCHNODE_ASK_MODEL` still force-pins the whole `/ask` path).

## Observability

The `/ask` path emits a `model_route` trace step (visible in the "Show trace"
UI) and stores `modelId` + `estimatedCostCents` on `liveEventAnswers`, so
escalations and their cost are auditable per answer. `getAskTelemetry`
aggregates them.

## Roadmap (next PRs)

1. Wire `classify` / `extract` / `synthesize` in `server/routes/search.ts`.
2. Cache-sticky wrapper for `agent_reason` (FastAgent + Convex agents) — cache
   the route per conversation, reuse on tool-result turns, switch only when the
   expected win beats the cache-eviction cost.
3. Eval-gated **demote-down**: per `(taskClass, model)` rolling agreement from
   `agentRunJudge` / dogfood scores; demote only above threshold.
4. Routing dashboard: cost + escalation rate per task class.
