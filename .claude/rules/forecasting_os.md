---
paths:
  - "backend/convex/domains/forecasting/**"
  - "backend/convex/workflows/dailyLinkedInPost.ts"
  - "apps/web/src/features/research/components/Forecast*"
  - "apps/web/src/features/research/components/CalibrationPlot*"
  - "apps/web/src/features/research/components/BrierTrendChart*"
  - "apps/web/src/features/research/components/EvidenceTimeline*"
  - "apps/web/src/features/research/components/TraceBreadcrumb*"
  - "packages/mcp-local/src/tools/forecastingTools.ts"
related_: [reexamine_process, analyst_diagnostic, completion_traceability, reexamine_resilience]
---

# Forecasting OS

## Architecture

### Three surfaces, one data spine
1. **LinkedIn posts**: Signals surface as Δ badges (Post 1), evidence→forecast links (Post 2), delta + trace breadcrumbs (Post 3)
2. **Dashboard (ForecastCockpit)**: CalibrationPlot, BrierTrendChart, ForecastCard with evidence timeline, TraceBreadcrumb
3. **MCP tools**: 9 tools (create_forecast, refresh_forecast, resolve_forecast, get_forecast, list_forecasts, add_forecast_evidence, get_forecast_track_record, compute_calibration, create_forecast_from_signal)

### Cross-reference engine (deterministic, no LLM)
- `signalMatcher.ts`: keyword overlap (+1/token), entity match (+3), tag match (+2), driver match (+2). Threshold: score ≥ 3
- Exports: `matchSignalsToForecasts`, `matchFindingsToForecasts`, `formatDeltaBadge`, `formatEvidenceLink`

### TRACE wrapping
- Every forecast refresh is TRACE-audited: 6 steps (query → fetch → match → score → update → complete)
- Every LinkedIn post is TRACE-audited: 5 steps (digest → explanations → cross-ref → format → post)
- `workflowTag` links steps across an execution (e.g. `forecast_refresh_2026-02-15`)

## Key files
| File | Purpose |
|------|---------|
| `backend/convex/domains/forecasting/forecastManager.ts` | CRUD + 6 public dashboard queries |
| `backend/convex/domains/forecasting/signalMatcher.ts` | Deterministic signal↔forecast cross-reference |
| `backend/convex/domains/forecasting/traceWrapper.ts` | TRACE-wrapped forecast refresh (6 audit steps) |
| `backend/convex/domains/forecasting/scoringEngine.ts` | Brier + log scoring, proper scoring rules |
| `backend/convex/domains/forecasting/schema.ts` | 5 tables: forecasts, forecastEvidence, forecastResolutions, forecastUpdateHistory, forecastCalibrationLog |
| `backend/convex/workflows/dailyLinkedInPost.ts` | LinkedIn pipeline with Δ badges, evidence links, TRACE |
| `apps/web/src/features/research/components/ForecastCockpit.tsx` | Dashboard assembler (CalibrationPlot, BrierTrendChart, ForecastCard) |
| `packages/mcp-local/src/tools/forecastingTools.ts` | 9 MCP tools |

## Conventions
- Brier score: `(probability - outcome)^2`. Lower is better. Random = 0.25, good = <0.15, superforecaster = <0.12.
- Probabilities stored as 0-1 floats, displayed as percentages (e.g. 0.65 → "65%")
- Delta displayed as percentage points: `[was 62%, +6pp today]`
- Calibration bins: 10 bins (0-10%, 10-20%, ..., 90-100%), plotted against diagonal
- Track record requires ≥5 resolved forecasts before displaying
- `refreshFrequency`: "daily" (auto-refreshed), "weekly" (7-day gate), "on_trigger" (manual only)

## Gotchas
- `forecastManager.ts` has BOTH internal queries (for crons/actions) AND public queries (for dashboard) — don't confuse them
- `getTopForecastsForLinkedIn` enriches with `previousProbability` from forecastUpdateHistory — needed for Δ badges
- `getAuditLogByWorkflowTag` uses the `by_workflow_tag` index on traceAuditEntries — must match schema
- Cross-reference matching is deterministic (tokenize + entity extraction) — no LLM calls, no async
- LinkedIn Post 3 enhanced mode (≤2 forecasts) shows expanded cards with trace breadcrumbs; ≥3 forecasts uses compact mode
- ForecastCockpit lazy-loads evidence timeline only when a card is expanded (`useQuery` with `"skip"`)
- Cron handler `date` arg: `new Date().toISOString().split("T")[0]` — evaluated at module load, not at cron fire time
