# production-agent.json — live vs aspirational

The schema (`schemas/production-agent.v1.schema.json`, copied from
[2026-senior-agent-engineering-checklist](https://github.com/HomenShum/2026-senior-agent-engineering-checklist))
forbids extra fields, so provenance notes live here. Every value in
`production-agent.json` is cited to code that exists; two required blocks are
declared at truthful minimal values because the guard is not built.

## Live (cited to code)

| Field | Source |
|---|---|
| loopBreaker.maxIterations = 50 | `workers/node/nemoclaw/agentRunner.ts` `maxTurns = 50` |
| per-tool breaker (onTrip text) | `agentRunner.ts` circuit breaker: forced synthesis after any tool called 3x |
| hitl tiers | `backend/convex/domains/agents/hitl/config.ts` `SENSITIVE_TOOLS` (deleteEvent, deleteTask, bulkUpdate, executeSQL, writeFile) |
| retry 3 attempts / exp / 2000ms base / 18000ms max / jitter | `workers/node/pipeline/retryPolicy.ts` (`MAX_TRANSIENT_ATTEMPTS`, `TRANSIENT_BASE_MS` x3 per attempt, `TRANSIENT_JITTER_MS`) |
| fallback queue-for-human | `retryPolicy.ts` `dead_letter` verdict + DLQ fingerprinting |
| interception | `agentRunner.ts` `sanitizeErrorMessage` (added with this contract) + `auditLog.ts` `sanitizeArgs` |
| context strategies | sliding-window: `backend/convex/domains/agents/swarmDeliberation.ts` `slidingWindowOverlap`; summarization: `workers/node/pipeline/topicCompaction.ts`; retrieval-extraction: `backend/convex/domains/agents/promptEnhancer.ts` budget hints |
| tokenBudgetPerRun = 16000 | `promptEnhancer.ts` `calculateBudgetHints` cap `Math.min(totalBudget, 16000)` |
| error-rate 0.05 / p99 30000ms / window 300s | `backend/convex/config/autonomousConfig.ts` `HEALTH_CONFIG` (`errorRateCritical`, `latencyP99Critical`, `healthCheckIntervalMs`) |
| costFuse maxSpendUsdPerDay = 5 | `workers/node/agents/realtimeVoicePolicy.ts` `DEFAULT_VOICE_DAILY_CAP_USD` — **voice lane only** |
| judgeRegression on-pr + nightly | `.github/workflows/convex-mcp-eval-gate.yml` (pull_request + cron `0 4 * * *`) |
| pinnedModel | `nodeagent.yaml` `provider.model.id: gemini-3.5-flash` |
| tracing field `traceId` | `workers/node/routes/search.ts` (generated via `genId("trace")`, propagated through run/packet/outcome ids) |
| toolContract.fewShotForComplexParams = false | honest: `agentRunner.ts` `getToolSchemas()` emits simplified empty parameter schemas |

## Aspirational (declared at truthful minimal values — NOT built)

- **release.canary** — there is NO deploy canary. The schema requires the
  block; `trafficPercent: 1` and the rollback clause describe the intended
  guard, not a live one. Deploys go through `convex-deploy.yml` /
  `vercel-preflight.yml` without traffic splitting or automatic rollback.
- **Global cost fuse** — only the voice lane has a dollars-per-day cap. LLM
  spend in the main agent loops has no global fuse; the declared
  `maxSpendUsdPerDay: 5` governs voice sessions only.
- **slos[task-completion-rate]** — declared `at-least 0` (vacuous floor).
  The metric is now *measured* (see below) but no code enforces a floor; the
  nightly eval suite is the path to a real threshold.

## Golden metrics — where the exact names are queryable

The three SLO metrics are exposed by exact name. The sources live in two
runtimes that cannot see each other (Convex backend vs Node worker), so each
runtime's existing surface exposes what it can see — no cross-runtime
aggregator was built.

| Exact name | Surface | Source |
|---|---|---|
| `task-completion-rate` | Convex query `getGoldenMetrics` (`backend/convex/domains/operations/observability/goldenMetrics.ts`, shim at `domains/observability/goldenMetrics.ts`) | latest `swarm_evolution` cron session `actionItemQuality.completionRate` (`autonomousCrons.ts`) |
| `tool-call-error-rate` | same Convex query | errors / calls over 24h of `modelRouterCalls` — same computation as `getRoutingStats` in `modelRouterQueries.ts`. Scoping: counts MODEL-call errors, the closest true tool-call error measure recorded in Convex |
| `p99-latency-ms` | worker `/mcp/health` JSON (`workers/node/mcpGateway.ts` healthHandler) | `McpSession.getLatencyPercentiles().p99`, aggregated across active sessions. Reported as `null` from the Convex query |

Unit test: `backend/convex/domains/operations/observability/goldenMetrics.test.ts`.
