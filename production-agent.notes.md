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

## release.canary — what is real, per deploy surface (2026-08-04)

The repo has three production deploy paths. `trafficPercent: 10` describes
the ONE surface where a true traffic canary is architecturally honest;
the other two get post-deploy smoke + automatic rollback, not a split.

| Surface | Deploy path | Guard |
|---|---|---|
| Node worker (Cloud Run `nodebench-server`) | `.github/workflows/worker-deploy.yml` (workflow_dispatch — there was NO automated deploy before; this adds one WITHOUT enabling auto-deploys) | **True traffic canary.** New revision deploys with `--no-traffic` + tag, `scripts/worker-health-check.sh` gates `/mcp/health` (readiness, `status: healthy` + `p99-latency-ms` content signal, p99 ≤ 30000ms), then the tag takes 10% traffic, bakes (default 300s), re-checks, promotes to 100%. Any failure routes the tag to 0% — previous revision keeps/regains all traffic. Needs repo secrets `GCP_SA_KEY`, `GCP_PROJECT_ID`. |
| Convex backend | `convex-deploy.yml` (push to main) | **Smoke + rollback, NOT a canary.** Convex is a single shared deployment — a traffic split is impossible, and claiming one would be a lie. Post-deploy, `convex run …goldenMetrics:getGoldenMetrics` must answer with the exact metric keys and `tool-call-error-rate ≤ 0.05`; on failure the workflow redeploys `HEAD^`'s `backend/convex` + `shared` and fails loudly. |
| Vercel frontend (www.nodebenchai.com) | Vercel git integration; verified by `post-deploy-verify.yml` on `deployment_status` | **Smoke + rollback, NOT a canary.** The app is a Vite SPA (no Next middleware to do cookie-sticky splits) and Vercel git deploys are all-or-nothing, so a plan-free traffic canary is not meaningful here. On failed verification of a Production deployment, the workflow runs `vercel rollback` to the previous production deployment (secrets `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`); scheduled/manual runs verify but never roll back. |

Honesty caveats that remain:
- The worker canary only runs when someone dispatches `worker-deploy.yml`;
  manual `gcloud builds submit` (workers/node/cloudbuild.yaml) still bypasses it.
- Convex rollback assumes `HEAD^` was green; it is the parent commit, not a
  recorded last-good marker.
- The `tool-call-error-rate` clause is enforced on the Convex surface, the
  `p99-latency-ms` clause on the worker surface — no single guard sees both.

## Aspirational (declared at truthful minimal values — NOT built)

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
