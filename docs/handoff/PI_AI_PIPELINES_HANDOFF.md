# Pi-AI Pipelines Handoff

Production-shape integration of `@mariozechner/pi-ai` into NodeBench, layered alongside the existing Vercel AI SDK and Convex Agent stack. The full six-PR cascade is merged into `main`.

Last local verification: `main` at `2a541037874c0f8c675ab393d5c08f50123cf6d2` on 2026-04-30.

## Current State

- All six pipeline PRs are merged into `main`.
- Production surface: `https://www.nodebenchai.com/?surface=packets`
- Convex deployment: `agile-caribou-964`
- MCP HTTP bridge: `https://agile-caribou-964.convex.site/mcp/pipeline/*`
- MCP auth: `x-mcp-secret` header, backed by `MCP_SECRET`.

## Merged PR Cascade

| PR | Merge SHA | Scope |
|---|---|---|
| #211 | `e06c8f69` | pi-ai code-gen pipeline scaffold and Reports panel |
| #212 | `4f0a4f77` | design-gen, trace audit entries, streaming, bundle handoff |
| #213 | `84e48c9f` | research pipeline, reactive streaming, document handoff |
| #214 | `5e52f7ab` | Linkup web search, durable workflow, UI launcher |
| #215 | `2a899ed6` | cron schedules, Linkup deep mode, composed pipelines, auth-aware ownerKey |
| #216 | `2a541037` | schedule UI, session ownerKey, MCP HTTP bridge, eval scorecard |

Recent history:

```text
2a541037  #216  schedule UI + session ownerKey + MCP HTTP + eval scorecard
2a899ed6  #215  cron schedules + Linkup deep + composed + auth-aware
5e52f7ab  #214  Linkup web search + durable workflow + UI launcher
84e48c9f  #213  research pipeline + reactive streaming + doc handoff
4f0a4f77  #212  design-gen + traceAuditEntries + streaming + bundle handoff
e06c8f69  #211  pi-ai code-gen pipeline scaffold + Reports panel
```

## User-Facing Surface

Mounted on `/?surface=packets` through `src/features/designKit/exact/ExactKit.tsx`:

- `PipelineLauncher`: kind, model, depth, spec, schedule toggle, composition picker, session ownerKey.
- `PipelineSchedulesPanel`: schedule list with pause/resume and delete.
- `PipelineEvalScorecard`: verdict accuracy, Brier score, average duration/cost, per-kind breakdown.
- `PipelineRunsPanel`: status, cost, verdict, step count, expandable stream preview, bundle/image links.
- `EntityFindingsPanel`: pre-existing entity findings surface, mounted alongside pipeline panels.

## Backend Inventory

Core files:

- `convex/domains/pipelines/piRuntime.ts`: thin pi-ai runtime wrapper plus Vercel AI SDK fallback.
- `convex/domains/pipelines/codeGenPipeline.ts`: code generation primitive.
- `convex/domains/pipelines/designGenPipeline.ts`: design generation primitive, including image output.
- `convex/domains/pipelines/researchPipeline.ts`: Linkup-backed research primitive with streamed synthesis.
- `convex/domains/pipelines/composedPipeline.ts`: `research_then_code`, `research_then_design`, `code_then_design`.
- `convex/domains/pipelines/pipelineWorkflow.ts`: durable workflow entrypoints.
- `convex/domains/pipelines/pipelineSchedule.ts`: schedule CRUD and cron sweep.
- `convex/domains/pipelines/pipelineRunsMutations.ts`: run creation, idempotency, status transitions, steps.
- `convex/domains/pipelines/pipelineRunsQueries.ts`: run listing, detail, summaries, bundle URLs.
- `convex/domains/pipelines/pipelineStreamMutations.ts`: bounded partial-text streaming substrate.
- `convex/domains/pipelines/pipelineTrace.ts`: mirrors pipeline steps into `traceAuditEntries`.
- `convex/domains/pipelines/pipelineDocumentHandoff.ts`: creates workspace documents for `ownerKey = "user:<id>"`.
- `convex/domains/pipelines/pipelineEvalQueries.ts`: eval scorecard query.
- `convex/domains/pipelines/pipelineMcpHttp.ts`: MCP HTTP actions.
- `convex/domains/pipelines/linkupAdapter.ts`: Linkup API wrapper.

Schema and routing:

- `convex/schema.ts`: adds `pipelineRuns`, `pipelineSteps`, `pipelineRunStreams`, `scheduledPipelineRuns`; extends `traceAuditEntries.executionType` with `pipeline_run`.
- `convex/crons.ts`: hourly `pi-ai pipeline scheduler`.
- `convex/router.ts`: HTTP routes for `/mcp/pipeline/run`, `/run-composed`, `/status`, and `/list`.
- `convex/domains/agents/traceAuditLog.ts`: accepts `pipeline_run`.

## MCP HTTP Contract

Routes:

- `POST /mcp/pipeline/run`
- `POST /mcp/pipeline/run-composed`
- `GET /mcp/pipeline/status`
- `GET /mcp/pipeline/list`

Authentication:

- Requests require `x-mcp-secret: <MCP_SECRET>`.
- Missing or wrong secret returns unauthorized.

Example:

```bash
curl -X POST https://agile-caribou-964.convex.site/mcp/pipeline/run \
  -H "x-mcp-secret: $MCP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"pipelineKind":"research","spec":"What changed in FDA AI guidance this week?"}'
```

## Operational Notes

- Pipelines run as Convex actions/workflows and persist dedicated pipeline rows. They do not replace existing Vercel AI SDK or Convex Agent threads.
- `ownerKey` is auth-aware: `user:<id>` for signed-in users, `session:<id>` for anonymous/session flows.
- Document handoff writes documents only for `user:<id>` owners. Session-owned runs still get storage bundle output.
- Composed pipelines are supported for immediate runs. Scheduling composed pipelines is deliberately scoped out unless `scheduledPipelineRuns` and scheduler dispatch are extended.
- Linkup uses a constant endpoint through `linkupAdapter.ts`; user input is query text, not arbitrary fetch URLs.
- `pipelineSteps` and `traceAuditEntries` both receive step telemetry.

## Smoke Tests

```bash
npx convex run domains/pipelines/codeGenPipeline:runCodeGenPipeline \
  '{"spec":"Create a small dashboard widget","modelId":"gpt-4o-mini","forceFresh":true}'

npx convex run domains/pipelines/designGenPipeline:runDesignGenPipeline \
  '{"spec":"Create a clean enterprise analytics hero image","imageSize":"1024x1024","forceFresh":true}'

npx convex run domains/pipelines/researchPipeline:runResearchPipeline \
  '{"spec":"Find recent FDA AI medical device updates","linkupDepth":"deep","forceFresh":true}'

npx convex run domains/pipelines/composedPipeline:runComposedPipeline \
  '{"composition":"research_then_code","spec":"Research and scaffold a market monitor","forceFresh":true}'

npx convex run domains/pipelines/pipelineWorkflow:startPipelineRun \
  '{"pipelineKind":"research","spec":"Summarize this week in healthtech funding"}'

npx convex run domains/pipelines/pipelineSchedule:createSchedule \
  '{"pipelineKind":"research","spec":"Daily FDA AI updates","cadence":"daily","modelId":"gpt-4o-mini"}'

npx convex run domains/pipelines/pipelineSchedule:runDuePipelineSchedules '{}'

npx convex run domains/pipelines/pipelineEvalQueries:getPipelineEvalScorecard '{"limit":100}'
```

## Known Follow-Ups

- Add schedule support for composed pipelines if recurring compositions become a requirement.
- Add a second-opinion LLM judge if self-verdict consistency is not enough for release gating.
- Add per-user cost ceilings and rate limits if pipeline use grows beyond operator-controlled usage.
- Keep this document updated whenever pipeline schema, MCP routes, or mounted Reports surface panels change.
