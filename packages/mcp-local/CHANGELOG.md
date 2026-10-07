# NodeBench MCP Changelog

## Unreleased — Honest tool outcomes (2026-10-07)

A developer or coding agent needs to stop when a capture fails, rather than continue using an unsuccessful attempt as evidence. Returned capture/provider errors now carry an explicit failure status through stdio, WebSocket, CLI, profiling, and the local engine (MCP-HONEST-RESULT-02).

- Preserve successful text/image blocks, order, and literal error-looking content. Invalid Delta watch actions exit nonzero. Engine HTTP failures return non2xx; streamed lifecycle completion includes the current chain's `ok`, and infrastructure failures terminate with an error event. Malformed results are classified before successful call/report records are written.
- Cap engine history at 10,000 calls and 20,000 disclosure events while retaining lifetime totals and completed checks. Recovery extraction uses the retained tail. Audit batches cap at 256; storage outages discard detached batches with warnings and later calls recover. Profiling outages warn without replacing the tool's result or exception; attempted observations are not certified as persisted.
- Matched local proof: the same 31 scenarios on the same installed dependency graph changed from 2 passed / 29 failed at `f4ef6b0534ab3615fb56d76611b91335cc8f762f` to 31 passed / 0 failed. Both strict package builds passed; the four existing Delta suites passed 12 tests, and the expanded strict slice typecheck passed. Scenarios use real SDK/stdio, loopback WebSocket/HTTP/SSE, native SQLite, mocked browser/providers, burst failures, and sustained sessions.
- Reproduce after installing root and package dependencies: `npm run build`, then `npx vitest run src/__tests__/mcpResultStatus.test.ts`. The Delta gate includes this build, regression, and typecheck. Declare only the missing `@types/yauzl` dev prerequisite at the compared version `3.4.0`; package-only installation still lacks root-owned SDK/types. No runtime dependency upgrade or fresh clean-root installation is certified by this comparison.
- Canonical publication, automatic CI, and live provider/deployment behavior remain pending. The pre-verb boolean CLI flag parsing defect is a separate retained gap; this proof uses supported verb-first commands. Audit/collector outage data can be lost, and retained trace limits are explicit.

## v2.61.0 — Trajectory Visualization (2026-03-24)
- **Agent Trajectory panel** in operating dashboard (waterfall bars, step list, cite buttons, `/api/trajectory/recent`)
- **TrajectoryDebugger** React component (dev-side): timeline + waterfall view, JSON expand, judge verdicts, search/filter
- **TraceValidationView** React component (user-side): confidence bars, source badges, verify button, export citations
- **useTrajectoryCapture** hook for step-by-step trajectory recording
- 12 missing registry entries added (benchmark, dogfood_judge, session_memory, entity_enrichment)
- `session_memory` category added to discover_tools enum

## v2.60.0 — LLM Judge Eval Flywheel (2026-03-24)
- Self-improving eval flywheel: `--flywheel` CLI runs eval -> diagnose -> grow corpus -> re-eval -> compare
- `diagnoseFailures()` classifies 5 root cause types
- `growCorpus()` auto-generates variant queries from failure patterns
- Gemini 3.1 Flash Lite Preview as judge model (with .env.local fallback loading)
- Context seeding for 0% scenarios (competitor_brief, delegation, packet_diff)
- `[judge:gemini]` / `[judge:heuristic]` labels on every query result
- Gateway-dependent tools auto-skipped

## v2.59.0 — LLM Judge Boolean Metrics (2026-03-24)
- 500-query corpus across 11 personas x 8 scenarios
- Data-oriented boolean criteria (not prose-quality)
- Heuristic fallback judge rewritten for structured data
- Regression detection across runs
- SQLite persistence for eval history

## v2.58.0 — Session Memory + Compaction Resilience (2026-03-24)
- `summarize_session` — Layer 2 session memory persisted to SQLite
- `track_intent` — Intent residuals survive compaction (fuzzy-match dedup)
- `get_compaction_recovery` — Post-compaction context re-injection
- Post-compaction hook script (`.claude/hooks.json`)
- N=1000 longitudinal simulation with compaction every 100th session
- 350 MCP tools

## v2.57.0 — Tiered Context Injection (2026-03-24)
- Message 1000 retains intent from message 1 via tiered context system

## v2.56.0 — Perturbation-Aware Longitudinal Benchmark (2026-03-24)
- Perturbation engine: thread_reset, tool_failure, stale_memory, model_swap, schema_change
- Per-action tracking (ActionRecord type, session_actions SQLite table)
- Drift durability score, composite durability score (6 weighted dimensions)
- Period rollups (daily/weekly/monthly), workflow maturity levels (A-E)
- Durability score: 83/100, perturbation survival: 100%

## v2.54.0 — Longitudinal Benchmark Harness (2026-03-24)
- N=1/5/10/100 cohort layers with RCA and PRR metrics
- 10 seeded cohort users, 6 scenario tool chains
- CLI: `npx tsx src/benchmarks/longitudinalHarness.ts [n1|n5|n10|n100|all]`

## v2.50.0 — User Feedback + Agent Validation (2026-03-24)
- **FeedbackWidget** — floating terracotta button, 5-star rating, localStorage-backed
- **FeedbackSummary** — dashboard card with aggregates
- **SinceLastSession** — "what changed since your last visit" with Convex wiring
- Agent validation harness: 5 personas (claude_code, openclaw, cursor, windsurf, generic_mcp)
- Provider bus 9/9, SupermemoryProvider 19/19 tests pass
- Convex ambient crons registered (30s/5min/15min/daily)

## v2.49.0 — Quality Fixes Cycle 3 (2026-03-24)
- Importance-weighted event ranking (type weights + recency decay + thesis relevance)
- Entity extraction from web search (companies, financials, people, dates, metrics)
- Prior-packet diffing (`founder_packet_history_diff`)
- Source URL provenance on decision memos
- Export-ready artifact formatting (`export_artifact_packet` — 5 audiences x 4 formats)
- Prior-brief cross-referencing, watchlist alerts, repeated question detection

## v2.46.0 — Dogfood Cycle 3 — 5.0/5 (2026-03-24)
- Gemini Flash Lite web enrichment in `run_recon` + standalone `enrich_recon`
- 3 dogfood cycles: 4.1 -> 4.6 -> 5.0/5
- Regression gate: PASS

## v2.42.0 — Dogfood Judge Fix System (2026-03-24)
- 15 dogfood judge MCP tools
- 8 SQLite tables, DogfoodRun telemetry schema (33 columns)
- 7 dogfood scenarios executed and judged
- `dogfood_judge` toolset + category

## v2.41.0 — Dogfood Runbook Execution (2026-03-24)
- README rewritten: "Operating Intelligence for Founders"
- Stale DeepTrace references fixed
- 4 persona presets (founder, banker, operator, researcher)
- Starter preset (15 tools) as default

## v2.39.0 — Tool Decoupling (2026-03-24)
- Dynamic imports: 57 static -> async loaders
- `localFileTools.ts` split: 6,640 lines -> 9 submodules
- MCP tool annotations with prefix inference
- `getFilteredRegistry()`, `toolNameToTitle()`

## v2.38.0 — Persona Presets (2026-03-24)
- `starter` (15), `founder` (30), `banker` (28), `operator` (32), `researcher` (26), `cursor` (28)

## v2.35.0 — Phase 10-13 Foundation (2026-03-23)
- **Phase 10: Causal Memory** — 8 Convex tables, 10 MCP tools, 5 frontend views, 7 background jobs
- **Phase 11: Ambient Intelligence** — 4 Convex tables, ingestion/canonicalization/change detection
- **Phase 12: Provider Abstraction** — MemoryProvider interface, LocalMemoryProvider, SupermemoryProvider, ProviderBus
- **Benchmark suite** — 5 benchmarks (packet reuse, contradiction, profiling, provenance, continuity)
- **Operating Dashboard** — 15-section HTML on port 6274
- 338 MCP tools

---

**Total: 27 releases (v2.35.0 - v2.61.0) | 350+ tools | 858 tests | 5 benchmarks | N=1/5/10/100/1000 longitudinal | 500-query LLM judge eval**
