# Oracle State

## 2026-07-22 NodeKit RFS benchmark P0 receipt and runner slice

### Completed work

- Added the canonical `nodekit.rfs-benchmark-run/v1` JSON Schema at `proof/contracts/nodekit-rfs-benchmark-run-v1.schema.json`.
- Added strict runtime types and semantic validation at `packages/mcp-local/src/contracts/nodekitRfsBenchmark.ts`.
- Preserved unavailable time, token, model cost, non-model cost, intervention, proof, trace, and publication values as `{ value: null, unavailableReason: <non-empty reason> }`; the validator rejects silent nulls, false zeroes, and unknown receipt fields.
- Added seal-time fail-closed gates for all standard lifecycle stages, source/local/dogfood/taste/deployment/production-browser proof, trace IDs, clean immutable revisions, release readiness, deployment revision, and receipt integrity.
- Added model-route honesty: completed or provider-started calls cannot seal without `resolvedModel`, and `fullTokenAccounting` cannot be true while any token category is unavailable.
- Added the canonical `nodekit.rfs-proofloop-runner/v1` runner-contract JSON Schema and a compiler to NodeProof's native `proofloop-runner-plan-v1` format.
- Every standard runner stage is followed by a receipt checkpoint; the final seal checkpoint invokes strict seal validation. NodeProof remains responsible for append-only state, budget, locks, and resume.
- Reused the existing execution-trace plane through exact bindings to `start_execution_run`, `record_execution_step`, `record_execution_decision`, `record_execution_verification`, `attach_execution_evidence`, `request_execution_approval`, and `complete_execution_run`. No parallel trace system or Convex table was introduced.
- Added `scripts/nodekit-rfs/benchmark-contract.mts` for receipt validation, runner-contract validation, and runner-plan generation.

### Immutable revision audit

- NodeBench base at slice start: `abbb23287225d31dbfebf716b4f278d7d4f1800f`.
- Clean NodeProof candidate: `53e084ee4a9941fb205ebc66380e2fc009c4d465`.
- Clean NodeAgent candidate: `c0ad5236d5424fca60008ed500cb565683bcd1d5`.
- Discoverable NodeKit commit: `c701819f06c04c8be894f5f89cf5b2ae5d969675`; the inspected NodeKit worktree had 398 dirty entries and is explicitly ineligible. Run 00 must use a clean checkout at an approved immutable revision.

### Verification and reality check

- `node packages/mcp-local` focused Vitest lane: 12/12 new tests passed.
- Targeted strict TypeScript check for the contract and CLI passed.
- Root TypeScript checks passed for both `backend/convex` and the repository project.
- `npm run build` passed and produced the production Vite/PWA bundle.
- The broader `packages/mcp-local` build remains blocked by pre-existing dependency/type failures (`better-sqlite3` declarations, optional `read-excel-file/node` and `pdf-parse` resolution, and an existing readonly registry mutation). None originate in this slice; the focused compiler check proves the new files themselves.
- No UI surface changed, so browser dogfood was not applicable. The artifact check is the runtime validator, JSON Schemas, plan compiler, CLI, and focused invariant suite.
- Reality-check invariant: a receipt cannot advance through a configured checkpoint unless that stage is present and passed, and cannot seal with unavailable required proof or unresolved provider identity.
- Main remaining risk: the runner compiler produces the resumable ProofLoop task plan and exact trace arguments, but a campaign orchestrator still has to call the trace primitives around task execution and persist the returned session/trace IDs into the receipt.

### Vision alignment

- `crossCheckStatus`: `aligned`.
- `deltaFromVision`: the slice adds the required goal/vision/source/dogfood fields and observable proof boundaries without building a second harness. It stops before campaign UI or Run 00 execution, as intended for the smallest P0 contract slice.

### Next quest

Create a clean Run 00 workspace, select the approved immutable NodeKit revision, instantiate the runner contract, and reconstruct Founder Quest into the first validated receipt while leaving genuinely unavailable historical metrics null with reasons.

## Current milestone
Milestone: Unified Temporal Agentic OS Phase 1 substrate plus V3 trajectory intelligence and Success Loops OS

## Completed work
- Oracle prompt pack contract defined at the repo root.
- Oracle control tower metadata fields added to task and trace surfaces.
- Builder-facing Oracle UI slice added to the agents workspace.
- Segmented test lanes and segmented dogfood verification added.
- Route-sharded dogfood capture added so smoke verification can exploit small parallel lanes.
- Temporal substrate tables added for observations, signals, causal chains, zero-drafts, and proof packs.
- Oracle control tower now exposes the 4-phase Unified Temporal Agentic OS roadmap.
- Task-manager Oracle contract repaired so sessions can persist vision fields instead of only typing them in the frontend.
- Root `docker-compose.yml` now boots the current day-1 local Unified Temporal stack: Oracle UI, headless QA API, TSFM inference, and ingestion extract.
- `services/ingestion-extract/app.py` now exposes extraction endpoints for entities, claims, numeric facts, and temporal markers with exact-source metadata.
- `apps/api-headless` route typing is repaired for Express 5 so the package builds cleanly in the local stack.
- Local stack runbook added at `docs/guides/UNIFIED_TEMPORAL_LOCAL_STACK.md`.
- `domains/temporal/ingestion:ingestStructuredSourceText` now bridges raw text into extracted observations, stored temporal signals, and first-pass forecasts.
- Temporal extraction now prefers the local `ingestion-extract` service and falls back to deterministic regex extraction when the service is unavailable.
- Forecasting now handles identical timestamps safely instead of dividing by a zero time step.
- `apps/api-headless` now exposes Linkup-style `POST /v1/search` and `POST /v1/fetch` endpoints backed by Convex search actions and the local extraction service.
- Grounded fetch now normalizes readable text from HTML and can attach exact-source extraction output for entities, claims, numeric facts, and temporal markers.
- `POST /v1/search` now uses a simpler mode model: `depth` plus `outputType`, so callers can request raw search hits, a cited answer, a temporal brief, or structured output from one endpoint.
- `POST /v1/fetch` now returns `markdown`, optional image extraction, and explicit warnings when callers ask for features like JS rendering that are not yet implemented.
- `POST /v1/search` now also supports `outputType: "enterpriseInvestigation"` for a VP-level temporal diagnosis payload with anomalies, forecast summary, causal chain, organizational friction analysis, recommended action, and audit metadata.
- `POST /v1/fetch` now returns immutable `snapshotHash` values so evidence chains can reference the exact content payload the system saw instead of only a mutable URL.
- `packages/eval-engine` now includes OTel-style MCP tool span helpers with CAS-hashed input, output, and monologue events for traceable agent trajectories.
- `POST /v1/search` enterprise investigations now register deterministic replay manifests, and `GET /v1/replay/:traceId` plus `GET /v1/replay/:traceId/trace` expose the stored request, response hash, source hashes, and replay-safe span timeline.
- The Oracle prompt pack now explicitly blocks "looks correct" completion criteria and requires measured invariants, remaining-risk notes, and anti-self-review guardrails.
- `apps/api-headless` now has a CI-safe latency regression guard for the fast search lane and the temporal enterprise investigation lane, with explicit p95 thresholds and evidence-shape assertions.
- A live api-headless guard script now measures the same public lanes against a real Convex backend, writes benchmark artifacts, and fails if latency or evidence integrity regresses under real source fetch conditions.
- The live api-headless guard has now been executed against `https://agile-caribou-964.convex.cloud` and produced a passing benchmark artifact using the default real-query lane.
- The Oracle UI now hard-gates live Convex queries behind `VITE_ENABLE_ORACLE_LIVE_DATA`, so the builder surface falls back to demo mode instead of crashing when the Oracle backend is not deployed.
- Builder-facing benchmark and navigation UX have been upgraded from the latest QA pass: mobile drawer behavior, tablet collapsed rail defaults, clickable published video proof, expandable telemetry payloads, clearer disabled-state explanations, improved benchmark empty states, and a text-based breadcrumb separator.
- The local dogfood runner now clears stale `dist/dogfood` output robustly on Windows before preview builds, which removes a recurring `ENOTEMPTY` failure during segmented verification.
- The Oracle homepage is now framed as a public product surface with a clear value proposition, explicit starting points, and preview/live data status instead of opening with unexplained internal jargon.
- Oracle session and trace surfaces now format long durations compactly and replace raw goal IDs with short goal references so internal storage identifiers are no longer leaked into the public UI.
- The command palette now only advertises real product destinations that exist in the current navigation model, replacing the previous dead-end analytics, calendar, and quality-review shortcuts.
- Research Hub embedded chrome now uses a neutral top summary instead of a misleading back-navigation control, and guest footer copy now explains what preview mode includes.
- Signal feed cards now use semantic headings and text-based source labels instead of emoji-only source markers, reducing ambiguity across screen readers and OS renderers.
- Benchmark copy now clarifies score and latency units, renames the chart toggle to a clearer action, and explains unrun leaderboard lanes as pending the first benchmark app connection.
- Oracle deep links are now protected at the shell level: explicit `/oracle` routes no longer get overwritten by persisted cockpit mode, and the classic shell force-corrects stray view drift back to Oracle.
- Cockpit mode now includes Oracle as a first-class system view, and the cockpit focal renderer has an explicit Oracle branch instead of falling through to the workspace default.
- Sidebar grouping now treats Oracle as a research-adjacent proof surface so breadcrumbs, active state, and public navigation stay consistent.
- Added a regression test for `useCockpitMode` covering both protected Oracle deep links and home-route mode restoration.
- Added a new Convex `trajectory` domain with V3 tables for entities, spans, evidence bundles, judge verdicts, feedback, interventions, trust nodes and edges, summaries, compounding scores, and benchmark runs.
- Added projection and scoring queries and mutations so trajectory intelligence can be derived from task sessions, traces, spans, proof packs, judge reviews, dogfood runs, benchmark rows, and temporal entities without replacing existing source-of-truth tables.
- Oracle, Execution Trace, Entity Profile, and Benchmark surfaces now render trajectory summaries and timeline context inside the existing builder-facing UI instead of creating a separate V3 app.
- Execution Trace now guards trajectory queries behind a stable workflow fallback path so pending public sessions without a live trace no longer trip the global error boundary during dogfood.
- Added a new Convex `successLoops` domain with Loop Registry, loop events, experiments, frozen decisions, and outcome-linkage tables for outer-loop product instrumentation.
- Added a Success Loops projection layer that scores problem selection, activation, retained value, outcome attribution, distribution proof, revenue expansion, market sensing, and organization learning from current operational signals plus explicit loop events.
- Oracle control tower now includes a builder-facing Success Loops panel that surfaces weakest and strongest loops, next recommended intervention, top experiments, frozen decisions, proof graph, and account-value state without creating a separate product surface.
- Added focused Loop OS tests for the scoring logic and the Oracle panel rendering path.
- Added a persistent agent response flywheel so completed assistant replies are reviewed deterministically, stored in `agentResponseReviews`, projected into trajectory, and surfaced in Oracle as weakest/strongest response lanes.
- Added shared routing and review logic in `shared/agentResponseFlywheel.ts`, turning the question catalog into executable infrastructure rather than markdown-only guidance.
- Response flywheel maintenance now runs on a recurring cron for both backfill and forced re-judge windows, and writes a visible cron result for the maintenance pass.
- Success Loops scoring now consumes recent `agentResponseReviews` directly as proxy product signals for activation, retained value, outcome attribution, and organization learning when explicit downstream events are still missing.
- The app shell now defaults to the persistent cockpit layout, with canonical `/?surface=...` routing, legacy route redirects into the cockpit model, a cached active-surface host, a query-backed workspace rail, a resident agent-presence rail, and a live receipt trace strip.
- `App.tsx` now mounts the cockpit directly instead of carrying a dead `LayoutSwitch` wrapper and classic-layout framing comments.
- The public cockpit chrome no longer advertises a switch back to classic layout, and `src/layouts/index.ts` now exposes the cockpit shell as the canonical layout barrel instead of mixing active and legacy shells.
- Added `docs/architecture/DEVELOPER_CODEBASE_MAP.md` as the current-state repo guide, and updated `docs/architecture/CODEBASE_RESTRUCTURE.md` to explicitly defer to that map for the present-tense structure.
- Marked `MainLayout`, `FocalArea`, `ModeRail`, and `CockpitIntelRail` as legacy compatibility modules so new developers can distinguish active shell code from historical scaffolding immediately.
- Moved cockpit-owned chrome helpers out of the root `src/components/` dump into `src/layouts/chrome/` (`CommandPalette`, `commandPaletteUtils`, `AgentMetadata`, `HashtagQuickNotePopover`) so the active shell has a clearer physical boundary and fewer root-level shell files.
- Canonicalized shared crash handling by moving the real `ErrorBoundary` implementation into `src/shared/components/ErrorBoundary.tsx` and leaving `src/components/ErrorBoundary.tsx` as a compatibility re-export only.
- Repointed active telemetry/cockpit imports to the feature-owned `src/features/admin/components/CostDashboard.tsx` implementation instead of routing current shell code through the root `src/components/CostDashboard.tsx` compatibility path.
- Moved more active root-level UI out of `src/components/` into canonical homes: `FiltersToolsBar` is now feature-owned under `src/features/documents/components/`, `TokenUsageBadge` under `src/features/agents/components/FastAgentPanel/`, and `SkipLinks` / `LiveRegion` under `src/shared/components/`, with the old root files left as compatibility re-exports.
- Fixed cockpit direct-view rendering for canonical root query URLs so non-default `view=` overrides like `/?surface=telemetry&view=dogfood` render the intended surface instead of collapsing back to the telemetry default stack.
- Repointed stale registry imports so direct cockpit routes resolve to the current feature-owned implementations for industry updates and document recommendations.
- Repaired a stale social archive import path in `LinkedInPostArchiveView` so the app build stays green after the cockpit consolidation.
- Physically reduced the active `src/components/` root again by moving shared UI primitives into `src/shared/components/`, moving cockpit quick capture into `src/layouts/chrome/QuickCaptureWidget.tsx`, and isolating older shell files under `src/components/legacy/`.
- `docs/agents/OPENCLAW_ARCHITECTURE.md` is now explicitly treated as the reference pattern for the repo's deep-agent architecture, while the current Convex orchestrator and cockpit shell remain the implementation reality.
- Added a new Convex `trajectory` domain with V3 tables for entities, spans, evidence bundles, judge verdicts, feedback, interventions, trust nodes and edges, summaries, compounding scores, and benchmark runs.
- Added projection and scoring queries and mutations so trajectory intelligence can be derived from task sessions, traces, spans, proof packs, judge reviews, dogfood runs, benchmark rows, and temporal entities without replacing existing source-of-truth tables.
- Oracle, Execution Trace, Entity Profile, and Benchmark surfaces now render trajectory summaries and timeline context inside the existing builder-facing UI instead of creating a separate V3 app.
- Execution Trace now guards trajectory queries behind a stable workflow fallback path so pending public sessions without a live trace no longer trip the global error boundary during dogfood.
- Added a new Convex `successLoops` domain with Loop Registry, loop events, experiments, frozen decisions, and outcome-linkage tables for outer-loop product instrumentation.
- Added a Success Loops projection layer that scores problem selection, activation, retained value, outcome attribution, distribution proof, revenue expansion, market sensing, and organization learning from current operational signals plus explicit loop events.
- Oracle control tower now includes a builder-facing Success Loops panel that surfaces weakest and strongest loops, next recommended intervention, top experiments, frozen decisions, proof graph, and account-value state without creating a separate product surface.
- Added focused Loop OS tests for the scoring logic and the Oracle panel rendering path.
- Added a persistent agent response flywheel so completed assistant replies are reviewed deterministically, stored in `agentResponseReviews`, projected into trajectory, and surfaced in Oracle as weakest/strongest response lanes.
- Added shared routing and review logic in `shared/agentResponseFlywheel.ts`, turning the question catalog into executable infrastructure rather than markdown-only guidance.
- Response flywheel maintenance now runs on a recurring cron for both backfill and forced re-judge windows, and writes a visible cron result for the maintenance pass.
- Success Loops scoring now consumes recent `agentResponseReviews` directly as proxy product signals for activation, retained value, outcome attribution, and organization learning when explicit downstream events are still missing.
- The app shell now defaults to the persistent cockpit layout, with canonical `/?surface=...` routing, legacy route redirects into the cockpit model, a cached active-surface host, a query-backed workspace rail, a resident agent-presence rail, and a live receipt trace strip.
- `App.tsx` now mounts the cockpit directly instead of carrying a dead `LayoutSwitch` wrapper and classic-layout framing comments.
- The public cockpit chrome no longer advertises a switch back to classic layout, and `src/layouts/index.ts` now exposes the cockpit shell as the canonical layout barrel instead of mixing active and legacy shells.
- Added `docs/architecture/DEVELOPER_CODEBASE_MAP.md` as the current-state repo guide, and updated `docs/architecture/CODEBASE_RESTRUCTURE.md` to explicitly defer to that map for the present-tense structure.
- Marked `MainLayout`, `FocalArea`, `ModeRail`, and `CockpitIntelRail` as legacy compatibility modules so new developers can distinguish active shell code from historical scaffolding immediately.
- Moved cockpit-owned chrome helpers out of the root `src/components/` dump into `src/layouts/chrome/` (`CommandPalette`, `commandPaletteUtils`, `AgentMetadata`, `HashtagQuickNotePopover`) so the active shell has a clearer physical boundary and fewer root-level shell files.
- Canonicalized shared crash handling by moving the real `ErrorBoundary` implementation into `src/shared/components/ErrorBoundary.tsx` and leaving `src/components/ErrorBoundary.tsx` as a compatibility re-export only.
- Repointed active telemetry/cockpit imports to the feature-owned `src/features/admin/components/CostDashboard.tsx` implementation instead of routing current shell code through the root `src/components/CostDashboard.tsx` compatibility path.
- Moved more active root-level UI out of `src/components/` into canonical homes: `FiltersToolsBar` is now feature-owned under `src/features/documents/components/`, `TokenUsageBadge` under `src/features/agents/components/FastAgentPanel/`, and `SkipLinks` / `LiveRegion` under `src/shared/components/`, with the old root files left as compatibility re-exports.
- Fixed cockpit direct-view rendering for canonical root query URLs so non-default `view=` overrides like `/?surface=telemetry&view=dogfood` render the intended surface instead of collapsing back to the telemetry default stack.
- Repointed stale registry imports so direct cockpit routes resolve to the current feature-owned implementations for industry updates and document recommendations.
- Repaired a stale social archive import path in `LinkedInPostArchiveView` so the app build stays green after the cockpit consolidation.
- Physically reduced the active `src/components/` root again by moving shared UI primitives into `src/shared/components/`, moving cockpit quick capture into `src/layouts/chrome/QuickCaptureWidget.tsx`, and isolating older shell files under `src/components/legacy/`.
- `docs/agents/OPENCLAW_ARCHITECTURE.md` is now explicitly treated as the reference pattern for the repo's deep-agent architecture, while the current Convex orchestrator and cockpit shell remain the implementation reality.
- The cockpit FastAgent sidebar is now rendered as a proper right-side overlay shell inside the center workspace instead of a cramped resizable split-pane, and the compact sidebar variant strips out overlay-era chrome so the answer stream has materially more readable width.

## Open defects
- Connect proof-pack generation to a real task session once the first end-to-end temporal loop lands.
- Containerizing Convex is still deferred. The local stack expects an external `CONVEX_URL`.
- A real Convex ingestion run has not been executed yet because the repo-wide Convex resolver lane is currently blocked by unrelated pre-existing domain export issues.
- `npx convex codegen` is still blocked by unrelated pre-existing TypeScript errors in non-trajectory Convex files, so the V3 slice is currently validated through `tsc`, `build`, vitest, traversal, and dogfood rather than full Convex regeneration.
- `npx convex codegen` still fails on the pre-existing Node-runtime violation in `convex/domains/missions/preExecutionGate.ts` (`import { createHash } from "crypto"` without `"use node"`), which is outside this cockpit/codebase-map cleanup slice.
- `npx convex codegen` now passes again after removing the non-`"use node"` barrel re-export of `convex/domains/missions/preExecutionGate.ts` and tightening the related Convex TypeScript helper signatures.
- The traversal runner now clears stale `dist/dogfood` output before preview builds, which removes the old Windows `ENOTEMPTY` failure path. A fresh full `npm run dogfood:traverse` should still be rerun before claiming a new all-green traversal artifact for the latest cockpit cleanup slice.

## Next quest
Write the first direct product-growth events into `successLoopEvents`, add explicit operator feedback capture for assistant replies, and then replace the current proxy-based response-loop signals with real acceptance, reuse, and benchmark outcome linkage.

## Blockers
- None at the contract level.

## Latest dogfood status
- Builder UI build passes.
- Dogfood verification uses segmented lanes.
- Parallel route shards are enabled through `DOGFOOD_ROUTE_SHARDS` or `--routeShards`.
- Oracle control tower now shows temporal substrate counts and the phase-by-phase execution roadmap.
- Full `npm run dogfood:verify` now passes again after the Oracle live-data gate and the layout/benchmark QA fixes.
- Scenario regression now passes the long-session route-accumulation lane, the mobile dark-mode lane, and the dogfood artifact ingestion lane in the same closed loop.
- The remaining dogfood noise is limited to benign `net::ERR_ABORTED` media request logs after navigation; artifact verification still passes with `screenshots=145`, `frames=36`, `scribe=36`, and `chapters=36`.
- After the public-facing copy and navigation cleanup, `npm run dogfood:verify` still passes with the same artifact floor and no new route-regression failures.
- After the Oracle route fix, local browser verification now shows `data-agent-id="view:oracle:content"` on `/oracle` and the Telemetry Inspector still renders correctly on `/benchmarks`.
- `npm run dogfood:verify:smoke` passes after the Oracle route fix, including segmented route shards and scenario regression. The only remaining noise is a Playwright HTML reporter `EBUSY` write on Windows after the run completes; the verification itself still passes.
- `npm run dogfood:traverse` now passes across 48 screens and scopes with 0 failures after the command-palette traversal fallback was hardened.
- The V3 trajectory rollout passed `npx tsc --noEmit`, targeted trajectory vitest coverage, `npm run build`, and `npm run dogfood:verify:smoke`. The only remaining dogfood noise is benign media `net::ERR_ABORTED` logs after route changes, and artifact verification now passes with `screenshots=168`, `frames=36`, `scribe=36`, and `chapters=36`.
- The Success Loops rollout passed `npx tsc --noEmit`, targeted Loop OS vitest coverage, `npm run build`, `npm run dogfood:verify:smoke`, and `npm run dogfood:traverse`.
- Current dogfood and traversal still show the same non-blocking media request abort noise after navigation, while the verification floor remains green with `screenshots=168`, `frames=36`, `scribe=36`, `chapters=36`, and traversal `48 screens/scopes, 0 failures`.
- The response flywheel rollout passed `npx tsc --noEmit`, targeted vitest coverage, `npm run build`, `npm run dogfood:verify:smoke`, and `npm run dogfood:traverse`; the only remaining noise is the same benign media `net::ERR_ABORTED` logging after route changes.
- The response flywheel outer-loop integration also passed the same floor after the Success Loops proxy wiring and maintenance cron were added. `npm run test:run` still ends with the pre-existing `packages/mcp-local` Vitest worker timeout (`[vitest-worker]: Timeout calling "onTaskUpdate"`), while the app, convex-mcp, and openclaw-mcp lanes pass.
- The persistent cockpit consolidation passed `npx tsc --noEmit`, `npm run build`, and `npm run dogfood:traverse` across `49` screens/scopes with `0` failures after the root query-surface model and legacy redirect compatibility shims landed.
- The cockpit/codebase-map cleanup slice passed `npx tsc --noEmit`, `npm run build`, and `npm run dogfood:traverse` across `52` screens/scopes with `0` failures after the entrypoint simplification, cockpit-only chrome cleanup, and developer-facing repo map landed.
- The follow-up cockpit-structure slice also passed `npx tsc --noEmit`, `npm run build`, and `npm run dogfood:traverse` across `52` screens/scopes with `0` failures after moving active shell chrome helpers into `src/layouts/chrome/` and updating the package-level architecture test path.
- The latest structure-cleanup slice also passed `npx tsc --noEmit`, `npm run build`, and a fresh `npm run dogfood:traverse` sweep with `49` screens/scopes and `0` failures after canonicalizing the shared `ErrorBoundary` implementation and repointing active cost-dashboard imports to the feature-owned telemetry surface.
- The latest root-component consolidation slice passes `npx tsc --noEmit` and `npm run build`, and the previously failing `/dogfood` scenario-regression tests now pass directly after fixing canonical `view=` override rendering in `ActiveSurfaceHost`.
- `npm run dogfood:verify:smoke` no longer fails on the `/dogfood` route itself, but the full segmented wrapper still does not return cleanly on Windows in this slice, so the verified floor here is the targeted `/dogfood` scenario-regression lane rather than a full wrapper pass.
- The latest component-compaction slice still passes `npx tsc --noEmit` and `npm run build`. A fresh full `npm run dogfood:traverse` run now stalls consistently inside `/benchmarks` after route 15 without producing a report, while the earlier `/dogfood` regression remains fixed. `npx convex codegen` still fails on the same pre-existing Node-runtime violation in `convex/domains/missions/preExecutionGate.ts`.
- `npm run dogfood:traverse` now passes across 48 screens and scopes with 0 failures after the command-palette traversal fallback was hardened.
- The V3 trajectory rollout passed `npx tsc --noEmit`, targeted trajectory vitest coverage, `npm run build`, and `npm run dogfood:verify:smoke`. The only remaining dogfood noise is benign media `net::ERR_ABORTED` logs after route changes, and artifact verification now passes with `screenshots=168`, `frames=36`, `scribe=36`, and `chapters=36`.
- The Success Loops rollout passed `npx tsc --noEmit`, targeted Loop OS vitest coverage, `npm run build`, `npm run dogfood:verify:smoke`, and `npm run dogfood:traverse`.
- Current dogfood and traversal still show the same non-blocking media request abort noise after navigation, while the verification floor remains green with `screenshots=168`, `frames=36`, `scribe=36`, `chapters=36`, and traversal `48 screens/scopes, 0 failures`.
- The response flywheel rollout passed `npx tsc --noEmit`, targeted vitest coverage, `npm run build`, `npm run dogfood:verify:smoke`, and `npm run dogfood:traverse`; the only remaining noise is the same benign media `net::ERR_ABORTED` logging after route changes.
- The response flywheel outer-loop integration also passed the same floor after the Success Loops proxy wiring and maintenance cron were added. `npm run test:run` still ends with the pre-existing `packages/mcp-local` Vitest worker timeout (`[vitest-worker]: Timeout calling "onTaskUpdate"`), while the app, convex-mcp, and openclaw-mcp lanes pass.
- The persistent cockpit consolidation passed `npx tsc --noEmit`, `npm run build`, and `npm run dogfood:traverse` across `49` screens/scopes with `0` failures after the root query-surface model and legacy redirect compatibility shims landed.
- The cockpit/codebase-map cleanup slice passed `npx tsc --noEmit`, `npm run build`, and `npm run dogfood:traverse` across `52` screens/scopes with `0` failures after the entrypoint simplification, cockpit-only chrome cleanup, and developer-facing repo map landed.
- The follow-up cockpit-structure slice also passed `npx tsc --noEmit`, `npm run build`, and `npm run dogfood:traverse` across `52` screens/scopes with `0` failures after moving active shell chrome helpers into `src/layouts/chrome/` and updating the package-level architecture test path.
- The latest structure-cleanup slice also passed `npx tsc --noEmit`, `npm run build`, and a fresh `npm run dogfood:traverse` sweep with `49` screens/scopes and `0` failures after canonicalizing the shared `ErrorBoundary` implementation and repointing active cost-dashboard imports to the feature-owned telemetry surface.
- The latest root-component consolidation slice passes `npx tsc --noEmit` and `npm run build`, and the previously failing `/dogfood` scenario-regression tests now pass directly after fixing canonical `view=` override rendering in `ActiveSurfaceHost`.
- `npm run dogfood:verify:smoke` no longer fails on the `/dogfood` route itself, but the full segmented wrapper still does not return cleanly on Windows in this slice, so the verified floor here is the targeted `/dogfood` scenario-regression lane rather than a full wrapper pass.
- The latest component-compaction slice still passes `npx tsc --noEmit`, `npm run build`, and `npx convex codegen`. The traversal runner now clears stale `dist/dogfood` output before preview builds, so the old Windows `ENOTEMPTY` failure path is removed; a fresh full `npm run dogfood:traverse` should be rerun before this slice is claimed as traversal-green.
- The FastAgent sidebar cleanup slice passes `npx tsc --noEmit` and `npm run build`. A fresh preview build on `127.0.0.1:4176` was used for visual review of the new assistant sidecar shell; full dogfood traversal was not rerun in this slice.

## Update rule
Any agent changing Oracle-related behavior must update this file after implementation, tests, dogfood, and a vision cross-check are complete.
