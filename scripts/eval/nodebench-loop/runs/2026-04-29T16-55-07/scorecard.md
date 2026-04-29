# NodeBench Loop Eval — 2026-04-29T16-55-07

**Agent chain (free OpenRouter via pi-ai):** `qwen/qwen3-next-80b-a3b-instruct:free` → `openai/gpt-oss-120b:free` → `z-ai/glm-4.5-air:free` → `meta-llama/llama-3.3-70b-instruct:free` → `google/gemma-4-31b-it:free` → `minimax/minimax-m2.5:free`  
**Judge chain (free OpenRouter via pi-ai):** `nvidia/nemotron-3-super-120b-a12b:free` → `openai/gpt-oss-120b:free` → `qwen/qwen3-next-80b-a3b-instruct:free` → `z-ai/glm-4.5-air:free` → `google/gemma-4-31b-it:free`  
**Agent models that produced responses:** `openai/gpt-oss-120b:free`  
**Judge models that produced verdicts:** `nvidia/nemotron-3-super-120b-a12b:free`  
**Generated:** 2026-04-29T16:55:21.243Z

## Summary

- **Queries:** 1
- **Overall score:** 0.00 / 4.00  (**0%**)
- **Verdicts:** pass = 0 · partial = 0 · fail = 1
- **Total runtime:** 13.5s · **avg query:** 13527ms

## By category

| Category | n | Avg score | Pass | Partial | Fail |
|---|---|---|---|---|---|
| core_flow | 1 | 0.00 | 0 | 0 | 1 |

## By dimension

| Dimension | n scored | Avg score |
|---|---|---|
| intent_accuracy | 1 | 0.00 |
| target_routing | 0 | 0.00 |
| entity_resolution | 1 | 0.00 |
| memory_first_behavior | 1 | 0.00 |
| source_citation_precision | 1 | 0.00 |
| claim_correctness | 1 | 0.00 |
| graph_edge_quality | 0 | 0.00 |
| notebook_update_correctness | 0 | 0.00 |
| privacy_budget_policy | 0 | 0.00 |
| time_to_first_useful_output | 0 | 0.00 |
| user_correction_needed | 0 | 0.00 |
| export_correctness | 0 | 0.00 |

## Per-query

| Id | Category | Verdict | Score | Agent ms | Judge ms | Flags |
|---|---|---|---|---|---|---|
| core-01 | core_flow | fail | 0.00 | 345 | 9447 | agent_error, no_reasoning_attempted |
