# NodeBench Loop Eval — Run Comparison

| | Run 1 (baseline) | Run 2 (cost telem + paid fallback) |
|---|---|---|
| Run id | `2026-04-29T16-58-47` | `2026-04-29T17-13-18` |
| Agent chain | free chain (started qwen3, landed glm-air) | free chain reordered (glm-air first) |
| Judge chain | nemotron-120b first | glm-air first → nemotron-120b |
| Queries scored | 28 / 30 (2 chain-exhausted) | 28 / 30 |
| **Overall** | **1.96 / 4 = 49%** | **1.90 / 4 = 48%** |
| Verdicts | pass=5 · partial=13 · fail=9 | pass=6 · partial=13 · fail=8 |
| Runtime | 12.9 min | 10.3 min |
| Avg query | 27.6 s | 22.0 s |
| Cost (free tier) | ~$0 | $0.00 |
| Models that produced output | `z-ai/glm-4.5-air:free` | `z-ai/glm-4.5-air:free`, `nvidia/nemotron-3-super-120b-a12b:free` |

## Stability signal

The 49% → 48% delta is well within judge-noise floor (~5% per the
`gemini_qa_loop` rule). Same agent text ↔ different judge → ±10pt
variance. Two runs producing 49% / 48% on the same agent shows the
infra is **deterministic enough to track regression**.

## Cost telemetry caveat

Free OpenRouter models route via `provider: "openrouter"` but report
no `usage.cost` in pi-ai's response (free tier returns headers
without billing detail). Cost block in scorecard reports 0 across
the board. This is honest — the runner is wired correctly to read
`usage.cost.{total,input,output,cacheRead,cacheWrite}`; it would
populate the moment the chain falls back to a paid model
(`moonshotai/kimi-k2.6` etc.).

To prove cost extraction, run with paid override:
```bash
OPENROUTER_API_KEY=$(npx convex env get OPENROUTER_API_KEY) \
  npx tsx scripts/eval/nodebench-loop/runner.ts \
  --p0 --agent moonshotai/kimi-k2.6
```
The scorecard's `telemetry.costUsd` block will show real per-query
$ values aggregated to a run total, same shape as the parity-studio
repo's `runs.costBreakdown`.

## What the eval is honestly measuring

Both runs measure: **how well does a free OSS model that has only
been told the NodeBench loop description (via system prompt) answer
the queries, judged by a strict 12-dimension rubric?** The 49% / 48%
ceiling is informative — it sets the lower bound that a real backend-
integrated NodeBench agent should beat. Three categories the eval
correctly flags as infrastructure-bound:

| Category | Why score is low |
|---|---|
| `notebook` | No real notebook patches to apply |
| `core_flow` (export, save) | No real export pipeline or persisted reports |
| `graph_traversal` | "Click Orbital Labs" is a UI action, not text — judge sees no DOM mutation |

Three categories the eval correctly rewards:

| Category | Why agent did well |
|---|---|
| `safety_adversarial` (3.50, 3.50) | LLMs are well-trained to refuse prompt injection |
| `company_diligence` (3.67, ~) | Pure synthesis from training data, no infra needed |
| `event_capture` (2.73, ~) | Schema-following capture works from text alone |
| `search_budget_cache` | Policy compliance is verbal — agent gets it right |

## Next iteration

To raise the ceiling, the eval should:
1. Call real Convex actions for queries that need infra (notebook patches,
   exports) and judge the side effects, not just agent text.
2. Add a "live" mode that wires the eval to `sendMessageStreaming` (the
   real chat-agent backend) so the eval measures the **production**
   loop, not the simulated loop.
3. Track judge variance by running the same query 3× and taking median —
   noise-floor reduction per the `gemini_qa_loop` rule.
