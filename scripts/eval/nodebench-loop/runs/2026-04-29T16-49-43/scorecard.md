# NodeBench Loop Eval — 2026-04-29T16-49-43

**Agent model:** `meta-llama/llama-3.3-70b-instruct:free`  
**Judge model:** `nvidia/nemotron-3-super-120b-a12b:free`  
**Generated:** 2026-04-29T16:49:56.507Z

## Summary

- **Queries:** 1
- **Overall score:** 0.00 / 4.00  (**0%**)
- **Verdicts:** pass = 0 · partial = 0 · fail = 1
- **Total runtime:** 13.1s · **avg query:** 13143ms

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
| core-01 | core_flow | fail | 0.00 | 2501 | 10129 | agent_error, no_response |
