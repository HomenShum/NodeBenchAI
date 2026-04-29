# NodeBench Loop Eval

Live LLM-judge eval suite for the NodeBench full product loop:

```
query/capture → memory search → entity resolution → report update →
notebook update → graph edges → sources/claims → follow-up/export
```

## Architecture (free first, paid fallback)

Inspired by the parity-studio repo's `lib/piAi.ts` dispatch chain
(ComposerCard → mutation → action → pi-ai's `complete()` → openrouter):

- **Agent stage** runs each query through a free OpenRouter model
  with a fallback chain. Free models tried in order:
  `z-ai/glm-4.5-air:free` → `qwen/qwen3-next-80b-a3b-instruct:free` →
  `openai/gpt-oss-120b:free` → `meta-llama/llama-3.3-70b-instruct:free` →
  `google/gemma-4-31b-it:free` → `minimax/minimax-m2.5:free`. If every
  free entry rate-limits or errors, the chain falls back to
  `moonshotai/kimi-k2.6` (paid, frontier) so the run still completes.

- **Judge stage** reads the agent's JSON output + the query's
  `expected` description + relevant dimensions, then scores 0–4 on
  each of the 12 eval dimensions. Same fallback shape, different
  primary: `nvidia/nemotron-3-super-120b-a12b:free` → free chain →
  `moonshotai/kimi-k2.6`.

- **Telemetry** (per-call): latency ms, input/output tokens, cost in
  USD (sum of `usage.cost` parts from pi-ai), model that actually
  responded. Aggregated into the scorecard.

## Query bank

`queryBank.ts` encodes 79 queries across 11 categories from the eval
spec dropped in PR #207's conversation:

| Category | n |
|---|---|
| core_flow | 10 |
| event_capture | 15 |
| company_diligence | 10 |
| person_footprint | 5 |
| graph_traversal | 6 |
| notebook | 5 |
| search_budget_cache | 6 |
| export | 5 |
| workspace_agent | 5 |
| safety_adversarial | 9 |
| performance | 3 |

30 queries are tagged `p0: true` and form the minimum kit suite.

## Eval dimensions (judged 0-4 each)

```
intent_accuracy
target_routing
entity_resolution
memory_first_behavior
source_citation_precision
claim_correctness
graph_edge_quality
notebook_update_correctness
privacy_budget_policy
time_to_first_useful_output
user_correction_needed
export_correctness
```

For each query, the judge only scores dimensions in the query's
`relevant_dimensions` array — others output `null` and are excluded
from the average.

## Running

```bash
# Pull OpenRouter key from Convex env (or set OPENROUTER_API_KEY directly)
OPENROUTER_API_KEY=$(npx convex env get OPENROUTER_API_KEY) \
  npx tsx scripts/eval/nodebench-loop/runner.ts

# Common flags
npx tsx scripts/eval/nodebench-loop/runner.ts --p0          # 30-query kit
npx tsx scripts/eval/nodebench-loop/runner.ts --limit 5     # smoke test
npx tsx scripts/eval/nodebench-loop/runner.ts \
    --agent moonshotai/kimi-k2.6 \
    --judge nvidia/nemotron-3-super-120b-a12b:free
```

## Outputs

Every run writes to `runs/<runId>/`:

- `raw.jsonl` — one record per query (full agent text + judge text)
- `scorecard.json` — aggregated stats, telemetry, per-query summary
- `scorecard.md` — human-readable report with category + dimension
  breakdowns, per-query table, and cost summary

## Run 1 baseline (2026-04-29T16-58-47)

- Agent: `z-ai/glm-4.5-air:free` (after rotation through 2 rate-limits)
- Judge: `nvidia/nemotron-3-super-120b-a12b:free`
- 28 queries scored (2 chain-exhausted)
- **Overall: 1.96 / 4 (49%)** — pass=5, partial=13, fail=9

Strongest categories: company_diligence (3.67), safety_adversarial
(3.50), event_capture (2.73). Weakest: notebook (0.67), graph_traversal
(1.50), core_flow (1.28). Strongest dimensions: privacy_budget_policy
(3.50), memory_first_behavior (3.33). Weakest:
notebook_update_correctness (0.00), export_correctness (0.00),
source_citation_precision (0.25) — these dimensions need real backend
integration to score above 0 (the agent has no actual notebook patches
or export bundles to produce yet).

## Honest interpretation

A free OSS model with only a system-prompt description of the loop
scoring 49% on a strict 12-dimension judge is a meaningful baseline.
The 0.00 scores on notebook + export aren't agent failures — they're
infrastructure dependencies the eval correctly surfaces. To raise
those, the eval would need to call the real Convex actions
(`recordActivity`, `runReportExport`, etc.) and judge the side
effects, not just the agent's text response.
