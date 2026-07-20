# Telemetry & Trajectory Visualization

Make telemetry and agent step trajectories measurable, debuggable, and beautifully interactive. Two audiences: dev-side (internal debugging) and user-side (trace, validate, cite results).

## When to activate
- After any change to agent execution, tool dispatch, or search pipeline
- When building or modifying telemetry surfaces
- User says "show trace", "debug trajectory", "visualize steps"
- When adding new MCP tools or modifying existing tool handlers

## Dev-side telemetry (internal)

### Search trace (workers/node/routes/search.ts)
Every search request emits a `trace` array with structured steps:
```typescript
interface TraceStep {
  step: "classify_query" | "build_context_bundle" | "tool_call" | "llm_extract" | "assemble_response";
  tool?: string;          // tool name or model name
  status: "ok" | "error";
  durationMs: number;
  detail?: string;        // human-readable detail
}
```

### Eval results (packages/mcp-local/src/benchmarks/)
- `searchQualityEval.ts` — 53+ query corpus, Gemini 3.1 Flash Lite judge
- `/search/eval-history` endpoint — returns last 50 eval runs with scores
- Results stored in SQLite `eval_results` table
- Track: structural pass rate, Gemini pass rate, combined, avg latency

### Agent execution trace (Convex)
- `traceAuditEntries` table — deterministic audit log per execution
- `parallelTaskTrees` / `parallelTaskNodes` — parallel execution state
- `toolHealthMetrics` — adaptive routing, circuit breaker status

### Local observability (MCP tools)
- `get_system_pulse` — health snapshot (DB size, errors, tool count)
- `start_watchdog` — continuous drift detection
- `start_execution_run` / `log_execution_step` / `finalize_execution_run`

## User-side telemetry (in-app)

### Search trace UI (SearchTrace component)
- Renders the `trace` array from each search response
- Collapsible "How we got this answer" section below results
- Shows: classify → context → web_search → extraction → assembly
- Each step shows duration, status badge, detail text
- Sources linked with web URLs when available

### Agent panel trace
- `StepTimeline` — vertical timeline of tool executions
- `ParallelTaskTimeline` — decision tree kanban for parallel work
- `ToolResultPopover` — expand tool results with rich media
- `TraceAuditPanel` — full audit trail viewer
- `DisclosureTrace` — transparency trace (what data was used)

### Trajectory scoring (8 dimensions)
- spanQuality, evidenceCompleteness, adaptationVelocity
- trustLeverage, interventionEffect, drift
- rawCompounding, trustAdjustedCompounding
- Labels: "compounding" | "improving" | "flat" | "drifting"

### Telemetry dashboard (`/?surface=telemetry`)
- Tool breakdown table (calls, avg latency, cost, errors, success rate)
- Action entry log (timestamp, tool, entity, status, input/output)
- Error log (timestamp, tool, message, severity)
- Metrics header (duration, actions, cost, avg latency, errors)

## Design principles
- Glass card DNA: `bg-surface/80 backdrop-blur-md border border-edge/40`
- Terracotta accent `#d97757` for active/CTA states
- Manrope UI font, JetBrains Mono for trace/code data
- Section headers: `text-[11px] uppercase tracking-[0.12em] text-content-muted`
- Respect `prefers-reduced-motion` — no flash animations
- Density-aware via `data-density` attribute

## Making traces citable
Every search result should be traceable back to:
1. Which web sources were consulted (URLs)
2. Which tools were called (tool names + args)
3. What the LLM judge said (verdict + criteria)
4. How confident the system is (0-100 score)
5. What the user should verify independently

## Key files
- `apps/web/src/features/controlPlane/components/SearchTrace.tsx` — User-facing trace UI
- `apps/web/src/features/agents/components/FastAgentPanel/StepTimeline.tsx` — Agent step timeline
- `apps/web/src/features/agents/components/FastAgentPanel/FastAgentPanel.ParallelTaskTimeline.tsx` — Parallel execution
- `apps/web/src/features/monitoring/views/AgentTelemetryDashboard.tsx` — Telemetry dashboard
- `apps/web/src/features/trajectory/types.ts` — Trajectory score types
- `backend/convex/domains/agents/traceTypes.ts` — TRACE framework types
- `workers/node/routes/search.ts` — Search trace emission
- `packages/mcp-local/src/benchmarks/searchQualityEval.ts` — Eval harness

## Related rules
- `eval_flywheel` — self-judging eval loop
- `dogfood_verification` — UI dogfood protocol
- `flywheel_continuous` — continuous improvement
- `reexamine_performance` — progressive disclosure, lazy loading
- `analyst_diagnostic` — root cause diagnosis
