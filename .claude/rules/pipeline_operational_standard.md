# Pipeline Operational Standard

Use this rule for any change to the real-time chat pipeline or the report
generator pipeline. Every pipeline change lands on a single repeatable loop:
instrument → judge → persist → surface → measure → regress.

## When to trigger
- Orchestrator write path changed (structuring pass, merge, projection emit)
- Judge gate added / modified / removed
- Telemetry shape changed
- Operator UI that surfaces verdicts changed
- New pipeline added that emits structured projections

## Required workflow sections
1. **Contract** — `EmitProjectionArgs` + `RunTelemetry` reflect the new emit
2. **Instrument** — writer uses `emitDiligenceProjectionInstrumented`
3. **Judge inline** — `judgeDiligenceRun(...)` runs deterministically after emit
4. **Persist** — `recordTelemetry` → `recordVerdict`
5. **Surface** — operator UI shows verdict + gate breakdown above raw trace
6. **Measure** — dashboard rollups subscribed
7. **Regress** — scenario tests for happy, sad, adversarial, long-running

## Invariants (from `.claude/rules/agentic_reliability.md`)
- `BOUND` — every query capped at ≤ 200
- `HONEST_STATUS` — failed emits record status="error" with errorMessage
- `HONEST_SCORES` — score = passCount / (pass + fail), skips excluded
- `TIMEOUT` — `latencyWithinBudget` gate defaults to 30s budget
- `DETERMINISTIC` — judge is a pure fn, same telemetry → same verdict
- `ERROR_BOUNDARY` — `onTelemetry` errors are swallowed — never break write path

## The 10 gate catalog
`hasValidTier`, `hasStableScratchpadRunId`, `hasMonotonicVersion`, `hasHeader`,
`tierMatchesBodyProse`, `latencyWithinBudget`, `reportsToolCalls`,
`reportsTokenCounts`, `capturedSources`, `emitStatusIsTerminal`.

Order is stable — dashboards rely on it. Add a gate by extending `GATE_ORDER`
in `workers/node/pipeline/diligenceJudge.ts`.

## Verdict tiers (bounded enum)
- `verified` — 0 failures, ≤ 2 skipped
- `provisionally_verified` — 0 failures, > 2 skipped
- `needs_review` — 1–2 failures
- `failed` — 3+ failures

## Verification floor
1. `npx convex codegen`
2. `npx tsc --noEmit`
3. `npx vitest run workers/node/pipeline/diligenceJudge.test.ts workers/node/pipeline/diligenceProjectionWriter.test.ts`
4. `npm run build`
5. `npm run dogfood:verify:smoke` when the UI changed

## Anti-patterns
- Inline judge that reads wall-clock or calls an LLM (DETERMINISTIC violation)
- Telemetry recorded only on success (hides failures)
- UI showing raw trace but no verdict
- Adding a gate without updating `GATE_ORDER` + docs + tests
- Weakening a gate to "improve" pass rate (HONEST_SCORES violation)

## Canonical reference
`docs/architecture/PIPELINE_OPERATIONAL_STANDARD.md`

## Related rules
- `agentic_reliability` — upstream invariants
- `agent_run_verdict_workflow` — verdict contract
- `owner_mode_end_to_end` — loop scope
- `scenario_testing` — test bar
- `completion_traceability` — cite the original request
