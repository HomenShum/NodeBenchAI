# Model Leaderboard

Ranks LLMs against a fixed 8-query NodeBench eval set. Different
goal from the main loop eval (`scripts/eval/nodebench-loop`):

| Pipeline | Goal | Iterates over |
|---|---|---|
| `nodebench-loop` | Grade the loop coverage | Queries (79 / 30 P0) |
| `model-leaderboard` | Grade & rank models | Models (16 free + 5 paid) |

Same judge schema (12 dimensions, 0–4). Same pi-ai dispatch
(openrouter provider). The leaderboard's eval set is a
representative slice of the loop's query bank, picked to span the
core categories: research, memory, capture, comparison, budget,
safety (×2), graph.

## Models tested

### Frontier-free (recent, large, capable — 2025-H2 / 2026)
- `inclusionai/ling-2.6-1t:free`           — 1T sparse MoE
- `qwen/qwen3-next-80b-a3b-instruct:free`  — Qwen3 next-gen
- `openai/gpt-oss-120b:free`               — OpenAI open-weight 120B
- `nvidia/nemotron-3-super-120b-a12b:free` — Nemotron 3 Super
- `minimax/minimax-m2.5:free`              — MiniMax M2.5
- `tencent/hy3-preview:free`               — Tencent Hunyuan 3
- `z-ai/glm-4.5-air:free`                  — GLM 4.5 Air
- `inclusionai/ling-2.6-flash:free`        — Ling 2.6 Flash
- `qwen/qwen3-coder:free`                  — code-tuned

### Mid + small free
- `google/gemma-4-31b-it:free`
- `google/gemma-4-26b-a4b-it:free`
- `openai/gpt-oss-20b:free`
- `meta-llama/llama-3.3-70b-instruct:free`
- `nvidia/nemotron-3-nano-30b-a3b:free`
- `nvidia/nemotron-nano-12b-v2-vl:free`
- `nvidia/nemotron-nano-9b-v2:free`

### Paid frontier (reference ceiling)
- `anthropic/claude-opus-4.7`           — current Anthropic frontier
- `anthropic/claude-sonnet-4.6`         — balanced
- `moonshotai/kimi-k2.6`                — proven in parity-studio
- `deepseek/deepseek-v4-pro`
- `google/gemini-3.1-pro-preview`

## Usage

```bash
# Full sweep (all free + paid)
OPENROUTER_API_KEY=$(npx convex env get OPENROUTER_API_KEY) \
  npx tsx scripts/eval/model-leaderboard/runner.ts

# Free only (zero cost)
npx tsx scripts/eval/model-leaderboard/runner.ts --free-only

# Filter by id substring
npx tsx scripts/eval/model-leaderboard/runner.ts --filter qwen,gpt-oss

# Custom judge (recommended: pick a stable judge that's not on the
# leaderboard so it doesn't grade itself)
npx tsx scripts/eval/model-leaderboard/runner.ts \
    --judge anthropic/claude-sonnet-4.6
```

## Outputs

`runs/<runId>/`:
- `leaderboard.json` — ranked rows + per-model summary
- `leaderboard.md` — human-readable scoreboard
- `per-model/<id>.json` — full per-query output for that model

## Methodology notes

- **Sort key**: avg score desc, ties broken by latency asc
- **Score**: mean of relevant dimension scores (0–4) per query
- **Cost**: free models report $0 (no usage data on free tier).
  Paid models populate `usage.cost.total` from pi-ai.
- **Judge stability**: a single judge model scores all candidates
  for fair comparison. Default `z-ai/glm-4.5-air:free` chosen for
  high availability. Override with `--judge` for higher rigor.
- **Pacing**: 800ms between calls per model to avoid 429s on free tier.
- **Per-query timeout**: 60s. Models that exceed it count as errors
  (and surface as `err=N` in the leaderboard table).
