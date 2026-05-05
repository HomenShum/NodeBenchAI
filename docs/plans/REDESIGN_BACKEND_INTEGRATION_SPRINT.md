# Redesign → Live Backend Integration Sprint

**Owner:** Homen
**Status:** Plan, not yet started
**Last updated:** 2026-05-05

The /redesign route currently runs entirely on fixtures (`src/features/redesign/fixtures.ts`). The backend wiring shipped on PR #239 (modelRouter contract fixes, batchAutopilot runner, refreshForecastAction, GEMINI_API_KEY fallback in testDirectApi) gives us five live capabilities the redesign was already designed for. This plan slots each one in.

## Backend capability inventory

| Capability | Entry point | Tables | Contract |
|---|---|---|---|
| Batch autopilot run | [convex/domains/operations/batchAutopilot/runner.ts:24](../../convex/domains/operations/batchAutopilot/runner.ts:24) `executeBatchRun` | `batchAutopilotRuns` ([schema.ts:14401](../../convex/schema.ts:14401)), `batchAutopilotSchedules`, `operatorProfiles` | 6-step: collect→summarize→brief→plan→deliver→complete; status enum `collecting|summarizing|generating_brief|delivering|completed|failed`; writes brief as `documents` row |
| Schedule sweep | [convex/domains/operations/batchAutopilot/scheduler.ts:15](../../convex/domains/operations/batchAutopilot/scheduler.ts:15) `sweepPendingRuns` | same | 15-min cron, max 5 concurrent, jitter ±5min; auto-disables after 3 failures |
| Manual trigger | [batchAutopilot/mutations.ts:91](../../convex/domains/operations/batchAutopilot/mutations.ts:91) `triggerManualRun` | same | Returns runId; user-auth gated |
| Public list/get | [batchAutopilot/queries.ts:7](../../convex/domains/operations/batchAutopilot/queries.ts:7) `getSchedule`, `:29` `getRecentRuns` | same | `getRecentRuns({limit})` descends by start time |
| Delta collection | [batchAutopilot/deltaCollector.ts:8](../../convex/domains/operations/batchAutopilot/deltaCollector.ts:8) `collectDelta` | `feedItems`, `signals`, `narrativeEvents`, `researchTasks` | Window-bounded; caps 100/100/50/20 |
| Forecast refresh | [convex/domains/research/forecasting/actions/refreshForecast.ts:17](../../convex/domains/research/forecasting/actions/refreshForecast.ts:17) `refreshForecastAction` | `forecasts`, `forecastEvidence` | Calls `modelRouter.route({taskCategory:"validation", tier:"cheap"})`; updates probability + drivers + counterarguments |
| LLM agent judge | `convex/domains/evaluation/agentRunJudge.ts` | none | Returns `{verdict, passingCount, totalCount, model, reasoning}` |
| Diligence judge (deterministic) | [server/pipeline/diligenceJudge.ts](../../server/pipeline/diligenceJudge.ts) | none | Pure fn; `verdict ∈ {verified, provisionally_verified, needs_review, failed}` |
| Pi/AI-SDK runtime | `convex/domains/pipelines/piRuntime.ts` `runPiOrAiSdkCompletion` | none | Wraps Gemini/OpenAI/Anthropic; supports `GEMINI_API_KEY|GOOGLE_AI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY` |
| Pipeline workflow | `convex/domains/pipelines/pipelineWorkflow.ts` `startPipelineRun` | `pipelineRuns`, `pipelineSteps` | Verdict in `{verified, provisionally_verified, needs_review}`; steps emit `research.scope/synthesize/verify` |

## Surface → backend mapping

| Surface | Fixture today | Live wiring proposal |
|---|---|---|
| `HomeSurface` `pulseCards` | [fixtures.ts:233](../../src/features/redesign/fixtures.ts:233) | `useQuery(api.domains.batchAutopilot.queries.getRecentRuns, { limit: 5 })` → derive cards from `briefMarkdown` headlines + counts |
| `HomeSurface` `watchlist` | [fixtures.ts:729](../../src/features/redesign/fixtures.ts:729) | `useQuery(api.domains.entityWatchlist.queries.list)`; refresh CTA → `useAction(api.domains.forecasting.actions.refreshForecast.refreshForecastAction)` (needs public wrapper — see Gap 7) |
| `HomeSurface` `publicResearch` | [fixtures.ts:59](../../src/features/redesign/fixtures.ts:59) | `useQuery(api.feedItems.list, { since: Date.now()-86400000, limit: 20 })` |
| `ChatSurface` `activeBatchRun` | [fixtures.ts:854](../../src/features/redesign/fixtures.ts:854) | `useQuery(api.domains.batchAutopilot.queries.getRecentRuns, { limit: 1 })` filtered to `status !== "completed"`; `runOnList` → `useMutation(api.domains.batchAutopilot.mutations.triggerManualRun)` |
| `ChatSurface` `sampleAnswer` packet | static | Stream from `pipelineWorkflow.startPipelineRun({pipelineKind:"research", spec, ownerKey})` then `getRunDetail({runId})` (mirrors `convexResearchPipelineSmoke.mjs`) |
| `InboxSurface` `inboxItems` | [fixtures.ts:387](../../src/features/redesign/fixtures.ts:387) | New query `api.inbox.listItems({lane})` aggregating: `batch_review` from `batchAutopilotRuns where status=completed AND briefDocumentId IS NOT NULL`; `agent_suggestions` from `pipelineRuns where verdict=needs_review`; `watchlist` from forecast refresh deltas; `approvals` from `agentDelegations`; `captures` from `quickCaptures` |
| `ReportsSurface` `reports` | [fixtures.ts:276](../../src/features/redesign/fixtures.ts:276) | `useQuery(api.documents.listByTags, { tags: ["autopilot-brief"] })`; refresh-source CTA → `triggerManualRun` |
| `ReportsSurface` `universes` | [fixtures.ts:795](../../src/features/redesign/fixtures.ts:795) | New `universes` table; bulk-action bar → `triggerManualRun` per entity |
| `MeSurface` `memoStyles`, `inferredStyleProvenance` | [fixtures.ts:568](../../src/features/redesign/fixtures.ts:568), [:710](../../src/features/redesign/fixtures.ts:710) | `useQuery(api.styleProfile.get)` + `useAction(api.styleProfile.infer)` calling `modelRouter.route({taskCategory:"summarization", tier:"free", systemPrompt, messages})` (mirrors [scripts/qa/inferStyle.ts:134](../../scripts/qa/inferStyle.ts:134)) |
| `ReportNotebookView` `pendingPatches` | hardcoded | Patches sourced from `pipelineSteps where name in ("research.synthesize","research.verify")`; audit feed = `agentRunEvents` |

## Gaps (backend doesn't exist yet)

1. **No `inbox` aggregator query** — InboxSurface needs a single endpoint that unions 5 source tables. **Action:** create `convex/domains/inbox/queries.ts:listItems({lane, limit})` that fans out and tags each row with `lane`, `whyHere`, `whyTone`, `confidence`.
2. **No `styleProfiles` table** — MeSurface shows inferred style + provenance but only `convex/domains/operatorProfile/manifest.ts` exists. **Action:** add `styleProfiles: defineTable({ userId, voicePack, lensWeights, runtimePrefs, provenance, inferredAt, modelUsed })` to `convex/schema.ts`.
3. **No `universes` table** — ReportsSurface groups reports by universe. **Action:** add `universes: defineTable({ userId, name, slug, entityIds, entityCount })`.
4. **No `pulseCard` derivation** — Home cover hero shows pulse cards; closest live source is `batchAutopilotRuns.briefMarkdown` but it's prose, not structured cards. **Action:** during runner step 6, write structured `pulseCards` records OR parse markdown headlines into `documents.contentPreview`.
5. **No bidirectional `pendingPatches` contract** — ReportNotebookView consumes `pendingPatches` but no Convex mutation writes patches. **Action:** new `documentPatches` table + `proposePatch` mutation invoked by runner step 4 and by `pipelineWorkflow.research.synthesize`.
6. **No batch progress event stream** — ChatSurface ticks counters locally; live equivalent has no sub-second progress. Acceptable for MVP via polling `getRecentRuns({limit:1})` every 2s (Convex reactivity handles this).
7. **`refreshForecastAction` is `internalAction`** — UI cannot call directly. **Action:** add public `action` wrapper in `forecastManager.ts` with auth check.

## 5-step integration sprint (each shippable independently)

### Step 1 — Reports → live brief documents
**Lowest risk, biggest visible win.**
- Replace [ReportsSurface.tsx:9](../../src/features/redesign/surfaces/ReportsSurface.tsx:9) `reports` fixture with `useQuery(api.documents.listByTags, {tags:["autopilot-brief"]})`.
- Wire bulk-select "Refresh now" toolbar to `useMutation(api.domains.batchAutopilot.mutations.triggerManualRun)`.
- DoD: trigger run, see new brief document appear in grid within 30s. `npm run dogfood:full:local` passes. Gemini QA score not regressed.

### Step 2 — Chat → live batch monitor
- Replace [ChatSurface.tsx:42](../../src/features/redesign/surfaces/ChatSurface.tsx:42) `activeBatchRun` with `useQuery(api.domains.batchAutopilot.queries.getRecentRuns, {limit:1})` filtered to active statuses.
- Wire `runOnList` → `triggerManualRun` mutation.
- Map run status (runner.ts:54,82,127,187) → `recentSteps` array shape.
- Strip the `setInterval` faker; rely on Convex reactivity.

### Step 3 — Inbox aggregator
**Creates new backend.**
- Add `convex/domains/inbox/queries.ts:listItems({lane, limit})` fanning across 5 source tables.
- Replace [InboxSurface.tsx:15](../../src/features/redesign/surfaces/InboxSurface.tsx:15) import.
- Wire accept/reject buttons → mutations on source rows (e.g. `batchAutopilotRuns.markReviewed`).

### Step 4 — Home pulse + watchlist live
- Add `styleProfiles` + `universes` tables (gaps 2, 3). Migration: seed from fixtures for the dogfood user.
- Replace [HomeSurface.tsx:21](../../src/features/redesign/surfaces/HomeSurface.tsx:21) `pulseCards/watchlist` with live queries.
- Wire watchlist refresh chip → public wrapper of `refreshForecastAction` (gap 7).

### Step 5 — Style profile + agent patches
- Implement `styleProfiles.get/upsert/infer` action backed by `modelRouter.route` (mirrors [scripts/qa/inferStyle.ts](../../scripts/qa/inferStyle.ts)).
- Add `documentPatches` table + `proposePatch` mutation. Wire `pipelineWorkflow` synthesize/verify steps to emit patches.
- [ReportNotebookView.tsx:32](../../src/features/redesign/components/ReportNotebookView.tsx:32) consumes `useQuery(api.documents.listPatches, {documentId})`.

## Verification floor (each step)
```
npx convex codegen
npx tsc --noEmit
npm run build
BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/full-ui-dogfood.spec.ts
npx tsx scripts/qa/liveMultipleMeBackendQa.ts
node scripts/qa/convexResearchPipelineSmoke.mjs
npm run qa:redesign  # multi-persona Gemini judge
```

Per [.claude/rules/pipeline_operational_standard.md](../../.claude/rules/pipeline_operational_standard.md) and [.claude/rules/agent_run_verdict_workflow.md](../../.claude/rules/agent_run_verdict_workflow.md): surface verdict above raw trace, gates bounded, partial success first-class.
