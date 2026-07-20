# NodeBench Agent Workflow

## Agent coordination (Codex ↔ Claude) — read FIRST

`AGENT_COORDINATION.md` (repo root) is the live ledger of **who is editing what right now**
and **what backend contracts are ready to call**. Before editing a hot file
(`public/proto/home-v5.html`, `backend/convex/events.ts`, `backend/convex/schema/eventsSchema.ts`): scan
**Active claims**, **claim your region** before you start, and **hand off** new backend
contracts there. **Never** `convex deploy`/`deploy:prod` out-of-band to the shared prod
deployment — it pushes un-reviewed schema/functions and breaks the other agent's next
deploy (this caused a Convex schema-validation incident this session). Declare new
shared-table fields `v.optional(...)` and announce them in the ledger instead.

## Prod-parity and UI kit workflow

Use this rule before any UI, design-system, route-parity, or newly uploaded UI kit task.

Source of truth:
- Git source of truth: `origin/main`
- Start UI/design work from a clean worktree based on `origin/main`.
- In this desktop session, the clean prod-parity worktree is `D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\nodebench-ai\.worktrees\prod-parity-runtime`.
- A UI kit packet is a design target, not an implementation branch.

Rules:
- Do not work from `hotfix/workspace-routing-export` unless the user explicitly names one file to salvage.
- Do not wholesale merge old dirty worktrees or old design/parity branches.
- Start from prod parity, inspect the new UI kit packet, compare, then implement only the delta.
- Preserve live Convex-backed runtime flows; no silent fixture fallback in production paths.
- Preserve web nav as `Home - Reports - Chat - Inbox - Me`.
- Keep Workspace as a separate deployed surface, not a sixth web tab.
- Verify against the latest UI kit packet and current prod/prod-parity screenshots, not stale local branch screenshots.

Required runbook:
- `docs/runbooks/PROD_PARITY_UI_KIT_WORKFLOW.md`

Required checks for UI-kit work:
- `npx tsc --noEmit --pretty false`
- Targeted Vitest for touched surfaces
- `npm run build`
- Browser screenshots for changed views
- Explicit before/after comparison against the UI kit packet

## Social Post Quality, Dedup, and Cleanup

This repo uses Convex for workflows and a React UI for reviewing outputs.

This file documents the standardized agent procedure used to:
- Diagnose repeated LinkedIn posts and "Unknown Company" output
- Add deterministic guardrails to prevent new repeats
- Hide duplicates in the archive UI and queries
- Run a one-time cleanup job in Convex and optionally LinkedIn

Reference: agents.md standard guidance. See `https://agents.md/`.

## Scope and goals

Primary goals:
- Prevent repeated posts in production runs (idempotency)
- Prevent placeholder company names ("Unknown", "Unknown Company") in funding outputs
- Ensure archive browsing does not show duplicates
- Provide a one-time cleanup tool for existing duplicates, with safe dry-run defaults
- Full self-maintenance: autonomous detect, fix, verify, document

Non-goals:
- Retroactively changing the meaning of past posts
- Rewriting all historical content for formatting

## Oracle harness-first workflow

Use this when building or refining the internal Oracle builder system.

Required docs:
- `ORACLE_VISION.md`
- `ORACLE_STATE.md`
- `ORACLE_LOOP.md`

Rules:
- Extend the existing NodeBench harness. Do not build a second agent platform.
- Every non-trivial Oracle slice must store and surface:
  - `goalId`
  - `visionSnapshot`
  - `successCriteria[]`
  - `sourceRefs[]`
  - `crossCheckStatus`
  - `deltaFromVision`
  - `dogfoodRunId`
- The first shipped surface is the builder-facing control tower, not end-user career coaching.
- Always run the closed loop after Oracle changes:
  - typecheck
  - build
  - tests
  - dogfood verification when UI changed
- Always update `ORACLE_STATE.md` after the loop so the next agent can resume without re-deriving context.

## Unified Temporal local stack

Use this when the current slice needs the Oracle UI, headless QA API, TSFM service, and ingestion service running together on day 1.

Primary entrypoint:

```powershell
docker compose up --build tsfm-inference ingestion-extract api-headless oracle-ui
```

Rules:
- Keep Convex external to the compose stack and pass `CONVEX_URL` through the environment.
- Do not invent a new frontend entrypoint. The current Oracle UI is the root Vite app on port `5173`.
- The ingestion service must stay extraction-only. It maps source text into entities, claims, numeric facts, and temporal markers. Narrative reasoning happens elsewhere.
- The TSFM service must stay math-only. It forecasts and detects anomalies or structural breaks; it does not write narratives.
- The day-1 bridge into Convex is `domains/temporal/ingestion:ingestStructuredSourceText`. Use it to turn raw text into stored observations, derived signals, and the first forecastable stream.
- The day-1 public grounding surface in `apps/api-headless` is `POST /v1/search` and `POST /v1/fetch`. Keep these thin: search should reuse Convex search actions, and fetch should normalize web content then call `ingestion-extract` for exact-source extraction.
- When adding enterprise-grade temporal reasoning, prefer extending `outputType` on `/v1/search` rather than creating a new public route unless the contract truly diverges.
- Evidence claims should carry immutable content hashes whenever possible. Do not rely on mutable URLs alone for audit-critical reasoning.
- Before claiming search or temporal API performance improvements, run `npm run bench:api-headless:guard`.
- When `CONVEX_URL` is available and the claim depends on real backend latency or fetched-source behavior, run `npm run bench:api-headless:live` and inspect `docs/architecture/benchmarks/api-headless-live-guard-latest.md`.
- If you change this local stack workflow, update `docs/guides/UNIFIED_TEMPORAL_LOCAL_STACK.md` and this file in the same loop.

## How the investigation was done

### 1. Pull historical posts from Convex

Fetch the latest archive rows:

```powershell
npx convex run --push "domains/social/linkedinArchiveQueries:getArchivedPosts" "{limit:500,dedupe:false}"
```

Store to a file to allow offline analysis:

```powershell
npx convex run --push "domains/social/linkedinArchiveQueries:getArchivedPosts" "{limit:500,dedupe:false}" | Out-File -Encoding utf8 .tmp/linkedin_archive.json
```

### 2. Identify anomalies

Check for:
- Exact duplicate content on the same `dateString`, `persona`, `postType`, and `metadata.part`
- Placeholder tokens in content such as "Unknown" and "Unknown Company"
- Oversized content (over 2900 chars) that will not match actual posted content
- Demo or mock markers ("demo") that should not ship to production

### 3. Trace source of anomalies in code

Typical root causes:
- Repeated LinkedIn API calls during retries or multiple cron invocations
- Archive logger always inserting (no dedupe or upsert)
- Multi-part posts storing post URLs by push order rather than by part index
- Funding enrichment not triggered when companyName is generic
- Demo fallback paths enabled in production workflows

## Preventing repeats (idempotency)

### Archive-level idempotency

`workflows/dailyLinkedInPostMutations:logLinkedInPost` now dedupes by:
`dateString + persona + postType + metadata.part + content`

If an identical row already exists, it patches the existing row instead of inserting a new one.

### Pre-post idempotency

Posting workflows now support `forcePost` (default false) and will skip posting if there is already any archived post for that `dateString + persona + postType`:
- Daily digest
- Funding tracker
- Multi-persona digest
- Startup funding brief parts
- FDA updates parts

This blocks repeats caused by cron overlap and retry loops.

## Hiding duplicates in queries and UI

Archive queries accept `dedupe` (default true).

The React archive view requests deduped data and deduped stats so duplicate rows do not show up in the UI.

## One-time cleanup job

### Preflight audit (read every archive row)

Run an archive audit before any deletes. This reports duplicates, reused post URNs, and common content anomalies.

```powershell
npx convex run --push "domains/social/linkedinArchiveAudit:runArchiveAudit" "{pageSize:200,maxRows:200000,includeSamples:true,sampleLimit:25}"
```

### Autonomous maintenance loop (small to full)

Rules:
- Start small. Single function. Dry-run.
- Expand. End-to-end dry-run.
- Full. Real write + re-audit.
- Always regression test after plumbing changes.
- Always update `AGENTS.md` when a new operational process ships.

Loop:
1. Generate and judge (no publish)
2. Dry-run publish
3. Publish
4. Verify archive row includes full metadata
5. Re-run archive audit
6. Run regression tests

### Required announcement before destructive cleanup

Destructive cleanup is gated. You must post a maintenance notice first.

Dry-run (logs the notice to the archive, does not post to LinkedIn):

```powershell
npx convex run --push "domains/social/linkedinArchiveMaintenance:postCleanupAnnouncement" "{dryRun:true}"
```

Post to LinkedIn (creates a real LinkedIn post and logs it to the archive):

```powershell
npx convex run --push "domains/social/linkedinArchiveMaintenance:postCleanupAnnouncement" "{dryRun:false}"
```

### Convex cleanup (archive)

Dry-run:

```powershell
npx convex run --push "domains/social/linkedinArchiveCleanup:cleanupLinkedInArchiveAndLinkedIn" "{dryRun:true,maxScan:5000,maxDeletes:2000,allowLinkedInDeletes:false}"
```

Real delete in Convex only:

```powershell
npx convex run --push "domains/social/linkedinArchiveCleanup:cleanupLinkedInArchiveAndLinkedIn" "{dryRun:false,maxScan:5000,maxDeletes:2000,allowLinkedInDeletes:false}"
```

### Convex cleanup (archive post URN reuse + orphan rows)

This removes:
- Multiple archive rows pointing to the same LinkedIn post URN (keeps best row)
- Orphan archive rows missing both `postId` and `postUrl`

Dry-run:

```powershell
npx convex run --push "domains/social/linkedinArchiveCleanup:cleanupLinkedInArchivePostUrnReuse" "{dryRun:true,maxScan:5000,maxDeletes:5000,deleteOrphansMissingIds:true}"
```

Apply:

```powershell
npx convex run --push "domains/social/linkedinArchiveCleanup:cleanupLinkedInArchivePostUrnReuse" "{dryRun:false,maxScan:5000,maxDeletes:5000,deleteOrphansMissingIds:true}"
```

### LinkedIn cleanup (delete duplicate posts)

This is best-effort and requires `LINKEDIN_ACCESS_TOKEN` to have permissions to delete the posts.

Dry-run (no API deletes):

```powershell
npx convex run --push "domains/social/linkedinArchiveCleanup:cleanupLinkedInArchiveAndLinkedIn" "{dryRun:true,maxScan:5000,maxDeletes:250,allowLinkedInDeletes:true}"
```

Real delete (archive + LinkedIn):

```powershell
npx convex run --push "domains/social/linkedinArchiveCleanup:cleanupLinkedInArchiveAndLinkedIn" "{dryRun:false,maxScan:5000,maxDeletes:250,allowLinkedInDeletes:true}"
```

Safety notes:
- Always run the dry-run first and inspect the returned `linkedInPostUrnsToDelete`.
- Keep `maxDeletes` low for LinkedIn deletes.
- If `unsafeLinkedInPostUrns` is non-empty, do not automate LinkedIn deletes for those URNs.

### Editing existing LinkedIn posts

LinkedIn supports partial updates for some posts. Use dry-run first.

```powershell
npx convex run --push "domains/social/linkedinPosting:updatePostText" "{postUrn:'urn:li:share:...',text:'...',dryRun:true}"
```

Real update:

```powershell
npx convex run --push "domains/social/linkedinPosting:updatePostText" "{postUrn:'urn:li:share:...',text:'...',dryRun:false}"
```

### One-time legacy text edits (optional)

This is for low-risk string fixes (example: "Round: Unknown" -> "Round: Undisclosed").

Preview only:

```powershell
npx convex run --push "domains/social/linkedinArchiveEdits:proposeAndApplyLegacyEdits" "{dryRun:true,mode:'round_unknown_to_undisclosed',maxEdits:25}"
```

Apply edits:

```powershell
npx convex run --push "domains/social/linkedinArchiveEdits:proposeAndApplyLegacyEdits" "{dryRun:false,mode:'round_unknown_to_undisclosed',maxEdits:25}"
```

Unknown placeholder cleanup (example: "Unknown - $250M", "Company: Unknown"):

```powershell
npx convex run --push "domains/social/linkedinArchiveEdits:proposeAndApplyLegacyEdits" "{dryRun:true,mode:'unknown_placeholders_to_undisclosed',maxEdits:25}"
```

Apply:

```powershell
npx convex run --push "domains/social/linkedinArchiveEdits:proposeAndApplyLegacyEdits" "{dryRun:false,mode:'unknown_placeholders_to_undisclosed',maxEdits:25}"
```

### Full live page sweep for Unknown placeholders (org posts)

Use this when the LinkedIn page still shows legacy posts with `Unknown Company`, `Unknown round`, or synthetic unknown hashtags that are not fully represented in archive rows.

1) Collect target post URNs from LinkedIn page-posts UI (Boost links include `content=urn:li:share:...`).
2) Dry-run the sweep:

```powershell
npx convex run "domains/social/linkedinPosting:sweepAndFixUnknownPlaceholders" "{postUrns:['urn:li:share:...'],dryRun:true,maxPosts:50}"
```

3) Apply live updates:

```powershell
npx convex run "domains/social/linkedinPosting:sweepAndFixUnknownPlaceholders" "{postUrns:['urn:li:share:...'],dryRun:false,maxPosts:50}"
```

4) Verify in LinkedIn page-posts UI that no post text matches unknown placeholders.

### One-time demo URL cleanup (LinkedIn + archive)

Purpose: replace accidental demo/example URLs inside already-posted content with `https://accessdata.fda.gov`.

Preview:

```powershell
npx convex run --push "domains/social/linkedinArchiveEdits:proposeAndApplyLegacyEdits" "{dryRun:true,mode:'demo_urls_to_fda_accessdata',maxEdits:50}"
```

Apply:

```powershell
npx convex run --push "domains/social/linkedinArchiveEdits:proposeAndApplyLegacyEdits" "{dryRun:false,mode:'demo_urls_to_fda_accessdata',maxEdits:50}"
```

### One-time purge of obvious test rows (archive only)

Strict rule: deletes only rows with persona `TEST` or multiple hard test signals (example.com, future date, postId like `t2`, content `TEST POST`).

Preview:

```powershell
npx convex run --push "domains/social/linkedinArchivePurge:scanAndPurgeObviousTestRows" "{dryRun:true,maxScan:200000,maxDeletes:200}"
```

Apply:

```powershell
npx convex run --push "domains/social/linkedinArchivePurge:scanAndPurgeObviousTestRows" "{dryRun:false,maxScan:200000,maxDeletes:200}"
```

## Did You Know (Daily Brief + LinkedIn)

Constraints:
- No em dash, no en dash
- Boolean checks only for gating
- LLM judge required (JSON pass/fail)
- sourcesUsed entries must include `publishedAtIso`

### Generate and judge from URLs

```powershell
npx convex run --push "domains/narrative/didYouKnow:generateAndJudgeDidYouKnowFromUrls" "{workflowId:'exp_dyk_2026_02_02',urls:['https://...','https://...'],tonePreset:'homer_bot_clone',preferLinkup:true}"
```

### Post standalone to LinkedIn (ad hoc)

Dry-run:

```powershell
npx convex run --push "workflows/dailyLinkedInPost:postDidYouKnowToLinkedIn" "{persona:'GENERAL',dryRun:true,urls:['https://...','https://...'],tonePreset:'homer_bot_clone'}"
```

Apply (real post + archive log):

```powershell
npx convex run --push "workflows/dailyLinkedInPost:postDidYouKnowToLinkedIn" "{persona:'GENERAL',dryRun:false,urls:['https://...','https://...'],tonePreset:'homer_bot_clone'}"
```

Post-run verification:

```powershell
npx convex run --push "domains/social/linkedinArchiveQueries:getArchivedPosts" "{postType:'did_you_know',limit:10,dedupe:true}"
npx convex run --push "domains/social/linkedinArchiveAudit:runArchiveAudit" "{pageSize:200,maxRows:200000,includeSamples:false}"
```

### Inject into Daily Brief (override URLs)

Find latest memory:

```powershell
npx convex run --push "domains/research/dailyBriefMemoryQueries:getLatestMemoryInternal" "{}"
```

Generate executive brief with Did You Know override:

```powershell
npx convex run --push "domains/research/executiveBrief:generateExecutiveBriefForMemoryInternal" "{memoryId:'<dailyBriefMemoryId>',forceRefresh:true,didYouKnowUrls:['https://...','https://...'],didYouKnowTonePreset:'homer_bot_clone'}"
```

## Validator: LLM explanation without affecting scoring

`validateWorkflowRun` can optionally generate an LLM explanation tied to the scored booleans.

```powershell
npx convex run --push "domains/narrative/tests/qaFramework:validateWorkflowRun" "{workflowId:'<workflowId>',includeLlmExplanation:true}"
```

## Closed Loop Verification Coverage Map

Rule: boolean gates decide pass or fail. Optional LLM explanations are allowed but do not affect scoring.

### LinkedIn plane
- Post generation: `workflows/dailyLinkedInPost:testLinkedInWorkflow` (dry-run)
- Archive invariants: `domains/social/linkedinArchiveAudit:runArchiveAudit` (must be clean before deletes)
- Cleanup tooling: `domains/social/linkedinArchiveCleanup:*` (dry-run first)
- **Engagement quality gate** (deterministic, pre-post): see below

### LinkedIn Engagement Quality Gate

Automated org page posts currently read like machine-generated reports. 67 posts yielded 1 genuine human comment. The gate below is a set of boolean checks that run BEFORE posting to LinkedIn. Posts that fail are flagged for rewrite or held.

**Anti-patterns (boolean FAIL if detected)**:
- `noReportHeader`: First 2 lines must NOT be a title card ("Daily Intelligence Brief", "VC DEAL FLOW MEMO", etc.). LinkedIn shows ~2 lines before fold — waste them on a header and nobody clicks "see more"
- `hasHook`: First sentence must be a concrete claim, surprising stat, or contrarian take — not a label
- `noWallOfText`: No more than 3 consecutive structured blocks (bullet lists, `═══` headers). Break with a 1-sentence human observation between sections
- `hasQuestion`: Post must contain at least one genuine question to the audience (not rhetorical). Questions drive comments
- `noGenericHashtags`: Must NOT use `#AI`, `#TechIntelligence`, `#DailyBrief` alone — these attract bots. Use specific hashtags tied to the content (`#Medtronic`, `#FDAApproval`, `#SeriesB`)
- `underCharLimit`: Max 1500 chars for org page daily posts (not 2900). Shorter posts get higher engagement on LinkedIn
- `hasOpinion`: Post must contain at least one first-person interpretive statement ("This signals...", "The real story here is...", "Watch for..."). Pure information delivery gets no engagement

**Soft checks (logged, not blocking)**:
- `mentionsPeople`: Tags or names specific people/companies who might respond
- `hasCallToAction`: Ends with a specific ask ("What's your read on this?", "Anyone seeing this in their portfolio?")
- `variesFormat`: Post format differs from the last 3 posts in archive (avoid predictability)

**Engagement feedback loop** (post-hoc, runs on cron):
- `fetchPostComments` scans org page posts 48h after posting
- Comments classified: genuine human / bot-engagement / promotional spam / no comments
- Posts with genuine comments: their format, hook, and structure are logged as "winning patterns"
- Posts with 0 engagement after 48h: flagged for format review
- Weekly engagement digest: ratio of genuine comments to total posts, trend over time

**Implementation**: Add these checks as a `validatePostEngagement` function in `linkedinPosting.ts` that runs before `createTargetedTextPost`. Failed checks return `{ passed: false, failures: string[] }` and the post is held for rewrite rather than silently posted.

**Personal profile posts** (agent-initiated) are exempt from this gate — they are written by the user or agent with personal voice already.

### Daily Brief plane
- Generate: `domains/research/executiveBrief:generateExecutiveBriefForMemoryInternal`
- Did You Know: brief `didYouKnow.passed=true`, `sourcesUsed[].publishedAtIso` present, `llmJudge.passed=true`

### Narrative production plane
- Deterministic QA lane: `domains/narrative/tests/qaFramework:runFullSuite` (CI gate)
- Per-run validator: `domains/narrative/tests/qaFramework:validateWorkflowRun` (persisted-output scoring)

### Feed ingestion plane
- Ingest: `feed:ingestAll` or `feed:ingest*Internal`
- Spot check: `feed:*` reader queries, entityKeys present, no placeholder values

### Privacy and retention plane
- Scheduled enforcement: `domains/operations/privacyEnforcement:*`
- Safety: dry-run where supported, never delete without audit trail

### MCP Unified Server plane (Render) — 114 tools, 9 domains
- Health: `curl https://nodebench-mcp-unified.onrender.com/health` (must return `{"status":"ok","tools":114}`)
- Full tools list: `tools/list` with `full` / `internal-full` returns 114 tools across research, narrative, verification, knowledge, documents, planning, memory, search, financial + findTools meta-tool
- Tool profile layer:
  - Full internal surface remains available through `full` / `internal-full`.
  - External users should use scoped profiles: `public-research`, `gmail-research`, `documents`, `memory`, `financial`, `knowledge`, or `builder`.
  - HTTP profile selection: `?profile=public-research`, `x-nodebench-profile`, or `x-mcp-profile`.
  - Hosted `public-research` and `gmail-research` are anonymous by default through `MCP_PUBLIC_PROFILES=public-research,gmail-research`; token auth is still required for internal/full and any profile not in that allowlist.
  - Profile-scoped tokens are configured with `MCP_PROFILE_TOKENS=token:profile,token2:profile2`; scoped token profile wins over query/header requests.
  - `findTools` is profile-scoped and only searches tools visible to that profile.
  - Profile runbook: `docs/guides/MCP_TOOL_PROFILES.md`.
- Architecture: Convex-side dispatcher at `/api/mcpGateway`
  - Gateway calls single endpoint with `x-mcp-secret` header (no admin key)
  - Convex httpAction validates secret, resolves function from static allowlist, injects userId server-side
  - Admin key never exposed to gateway service
  - Financial tools call public APIs directly (Stooq, Yahoo Finance, World Bank) — no Convex dispatch
- Auth model (dispatcher allowlist groups):
  - Group A (25 public queries): no userId needed, dispatched directly
  - Group B (8 internal MCP variants): userId injected server-side via `MCP_SERVICE_USER_ID` Convex env var
  - Group C (20 document internal endpoints): userId injected server-side
  - Group D (5 agent planning): key-based lookup, no userId needed
  - Group E (6 agent memory): key-based lookup, no userId needed
  - Group F (3 search/research): public actions dispatched directly
  - `runNewsroomPipeline`: returns structured error in guest mode (requires user auth)
- Smoke tests:
  - `curl -X POST <url>/api/mcpGateway -d '{"fn":"getForYouFeed"}' -H "Content-Type: application/json"` — 401 (no secret)
  - Same with `x-mcp-secret` header — returns feed items
  - `{"fn":"mcpCreateDocument","args":{"title":"Test"}}` — creates doc (userId injected server-side)
  - `{"fn":"createPlan","args":{"plan":{"id":"test","goal":"Test","steps":[],"createdAt":"...","updatedAt":"..."}}}` — creates plan
  - `{"fn":"doesNotExist"}` — 400 with helpful error
  - `equity_price_quote` with `symbol: "AAPL"` — returns price data (direct HTTP, no dispatcher)
  - `findTools` with `query: "stock price"` — returns matching financial tools
- Env vars required (Render service): `CONVEX_URL`, `MCP_SECRET`, `MCP_HTTP_TOKEN` (optional)
- Env vars required (Convex dashboard): `MCP_SERVICE_USER_ID`, `MCP_SECRET`
- Audit + trust: MCP Tool Call Ledger UI at `/mcp/ledger` (args/result previews + policy evaluation + request metadata). Local dev: `http://127.0.0.1:5173/mcp/ledger`. Workflow: run a tool call, then click the row to inspect Call Detail (human-auditable trace).

Trusted access framing (Reasoning x Access = Capability):
- In NodeBench, "Access" is safe tool execution across APIs and data under policy, with a deterministic audit trail.
- Our current primitives are: secret-gated gateway, static allowlist dispatcher, server-side userId injection, risk tiers + budgets, and the MCP Ledger.
- Next step if capability lift is small: add more deterministic access primitives (e.g., file parsing/search, spreadsheet filters/aggregations) and re-measure on GAIA capability lanes.
- Founder ambient intelligence ops are owner-scoped only. Public reads and writes for packet readiness, canonical objects, session delta, change detections, and ambient ingestion must resolve through an owned `companyId` or `workspaceId`; do not ship global or cross-tenant variants without explicit server-side owner checks.

### File vault plane (Obsidian + Git)
- Init: `npm run vault:init`
- Health check: `npm run vault:health` (writes `.tmp/vault_health_report.json`, boolean exit code)
- Quorum merge: `npm run vault:merge` (writes `vault/master/merge_report.json`)
- Rules: `vault/SOP.md` (kebab-case, required frontmatter keys, no broken wikilinks)

### MCP local eval harness plane (open-source long-running tasks)
- Dataset: `gorilla-llm/Berkeley-Function-Calling-Leaderboard`, split `BFCL_v3_multi_turn_long_context`
- Source URL: `https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard`
- Local fixture generator:
```powershell
npm run mcp:dataset:refresh
```
- Parallel subagent benchmark (task-worker pool):
```powershell
$env:NODEBENCH_OPEN_DATASET_TASK_LIMIT=12
$env:NODEBENCH_OPEN_DATASET_CONCURRENCY=6
npm run mcp:dataset:test
```
- One-shot refresh + benchmark:
```powershell
npm run mcp:dataset:bench
```
- Second lane dataset: `OpenBMB/ToolBench`, split `data_example/instruction (G1,G2,G3)`
- Source URL: `https://github.com/OpenBMB/ToolBench`
- ToolBench fixture generator:
```powershell
npm run mcp:dataset:toolbench:refresh
```
- ToolBench parallel subagent benchmark:
```powershell
$env:NODEBENCH_TOOLBENCH_TASK_LIMIT=6
$env:NODEBENCH_TOOLBENCH_CONCURRENCY=3
npm run mcp:dataset:toolbench:test
```
- Third lane dataset: `princeton-nlp/SWE-bench_Verified`, split `test`
- Source URL: `https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified`
- SWE-bench fixture generator:
```powershell
npm run mcp:dataset:swebench:refresh
```
- SWE-bench parallel subagent benchmark:
```powershell
$env:NODEBENCH_SWEBENCH_TASK_LIMIT=8
$env:NODEBENCH_SWEBENCH_CONCURRENCY=4
npm run mcp:dataset:swebench:test
```
- Run all lanes (BFCL + ToolBench + SWE-bench):
```powershell
npm run mcp:dataset:bench:all
```
- Benchmark implementation files:
  - `packages/mcp-local/src/__tests__/fixtures/generateBfclLongContextFixture.ts`
  - `packages/mcp-local/src/__tests__/fixtures/bfcl_v3_long_context.sample.json`
  - `packages/mcp-local/src/__tests__/openDatasetParallelEval.test.ts`
  - `packages/mcp-local/src/__tests__/fixtures/generateToolbenchInstructionFixture.ts`
  - `packages/mcp-local/src/__tests__/fixtures/toolbench_instruction.sample.json`
  - `packages/mcp-local/src/__tests__/openDatasetParallelEvalToolbench.test.ts`
  - `packages/mcp-local/src/__tests__/fixtures/generateSwebenchVerifiedFixture.ts`
  - `packages/mcp-local/src/__tests__/fixtures/swebench_verified.sample.json`
  - `packages/mcp-local/src/__tests__/openDatasetParallelEvalSwebench.test.ts`
- Assertions enforced by the benchmark:
  - Every dataset task must complete recon, tool discovery, eval bookkeeping, closed-loop checks, and mandatory flywheel checks
  - Required tools must be called: `run_recon`, `log_recon_finding`, `findTools`, `getMethodology`, `start_eval_run`, `record_eval_result`, `complete_eval_run`, `run_closed_loop`, `run_mandatory_flywheel`, `search_all_knowledge`
- Cross references:
  - `### Mandatory: AI Flywheel testing after any update or change`
  - `## 6-Phase Iterative Deep-Dive Verification Process`
  - `## How the Two Loops Compose: The AI Flywheel (Verification × Eval)`

### MCP execution trace plane

Purpose: make multi-step agent workflows traceable without exposing raw chain-of-thought.

- Default local MCP preset now includes the `execution_trace` toolset.
- Core tools:
  - `start_execution_run`
  - `complete_execution_run`
  - `record_execution_step`
  - `record_execution_decision`
  - `record_execution_verification`
  - `attach_execution_evidence`
  - `request_execution_approval`
- Workflow rule:
  1. Start the run first.
  2. Record meaningful steps, evidence, decisions, and verifications as the work happens.
  3. Request approval before risky or externally visible actions.
  4. Complete the run with final status and drift summary if applicable.
- Protocol-native MCP prompts are available for reusable workflow shaping:
  - `execution-trace-workflow`
  - `spreadsheet-enrichment-trace`
  - `company-direction-analysis-trace`
  - `agent-delegation-with-approval-trace`
- Convex backing:
  - `domains/mcp/mcpExecutionTraceEndpoints:mcpStartExecutionRun`
  - `domains/operations/taskManager/mutations:*`
- Live UI surface:
  - `/execution-trace`

### Control-plane shared context delegation plane

Purpose: let the public search-first control plane publish a versioned packet into shared context, then prepare a bounded coding-agent handoff without forcing the founder to restate the same context in a new thread.

Production HTTP surfaces:
- `GET /api/shared-context/snapshot`
- `POST /api/shared-context/publish`
- `POST /api/shared-context/delegate`
- `GET /api/sync-bridge/health`
- `GET /api/sync-bridge/accounts/:userId`

Rules:
- Treat the search result packet as the canonical source when publishing or delegating. Do not rebuild the company story ad hoc in the browser.
- Always register the web control-plane peer before publishing or proposing a task so the shared-context packet keeps a durable producer identity.
- Delegation should create both:
  - a shared-context packet
  - a shared task handoff tied to that packet
- The browser flow may prepare a handoff prompt for Claude Code or OpenClaw, but the prompt is a consequence of the shared packet and task id, not a replacement for them.
- After changes to these routes or the control-plane handoff UI, run:
  - `npx tsc --noEmit`
  - `npx vitest run workers/node/searchRoute.test.ts workers/node/sharedContextRoute.test.ts`
  - `npx vitest run apps/web/src/features/controlPlane/views/ControlPlaneLanding.test.tsx apps/web/src/features/controlPlane/components/SyncProvenanceBadge.test.tsx apps/web/src/features/mcp/components/SharedContextProtocolPanel.test.tsx apps/web/src/features/mcp/components/SyncBridgeAccountPanel.test.tsx`
  - `npm run build`

## Self maintenance (nightly, autonomous)

Purpose: run invariant audits, persist a boolean-gated report, attach an optional LLM explanation.

### Continuous observability control tower

Purpose: unify health checks, active alerts, self-healing, nightly maintenance, intent hotspots, and bug-loop backlog into one operator view inside NodeBench.

In-app surface:
- `Autonomous Operations` panel in the agents workspace now reads from `domains/operations/autonomousControlTower:getAutonomousControlTowerSnapshot`
- The panel shows:
  - current system health and active alerts
  - 24h self-healing success rate and recent actions
  - latest nightly maintenance status
  - intent hotspot loop counts and bug-loop counts
  - prioritized attention queue for issues that need intervention

Manual run from the UI:
- Use `Run Now` in the `Autonomous Operations` panel. This triggers:
  - `domains/observability/healthMonitor:runAllHealthChecks`
  - `domains/observability/selfHealer:runSelfHealing`
  - `domains/operations/selfMaintenance:runNightlySelfMaintenance`

Manual run from Convex:

```powershell
npx convex run --push "domains/operations/autonomousControlTower:getAutonomousControlTowerSnapshot" "{}"
```

Immediate maintenance pass:

```powershell
npx convex run --push "domains/operations/autonomousControlTower:runAutonomousMaintenanceNow" "{includeLlmExplanation:false}"
```

Manual run:

```powershell
npx convex run --push "domains/operations/selfMaintenance:runNightlySelfMaintenance" "{includeLlmExplanation:true,didYouKnowPostLimit:10}"
```

Strict Daily Brief Did You Know gate (use for experiments and rollout checks):

```powershell
npx convex run --push "domains/operations/selfMaintenance:runNightlySelfMaintenance" "{includeLlmExplanation:true,didYouKnowPostLimit:10,requireDailyBriefDidYouKnow:true}"
```

Fetch latest snapshot (stored in `checkpoints`):

```powershell
npx convex run --push "domains/operations/selfMaintenance:getLatestSelfMaintenanceSnapshot" "{}"
```

Cron:
- `backend/convex/crons.ts` schedules `domains/operations/selfMaintenance:runNightlySelfMaintenanceCron` daily.

## Flywheel mode (UI dogfood + Gemini QA)

Purpose: continuous UI verification until issues stop reproducing and the dogfood artifacts show stability.

Scoring and release policy:
- Follow `docs/architecture/APP_SCORING_AND_DOGFOOD_INSTRUCTIONS.md` for the standing product rule:
  - dogfood every workflow
  - grade every output
  - freeze every recommendation
  - compare against reality later when outcomes exist
  - trace every UI and backend step
- Treat that document as the default operator standard for visual quality, design clarity, usage value, and alignment scoring.

Rules:
- Poll every 60 seconds for new issues (logs, console, visual regressions).
- Always do 5-whys root-cause analysis; fix the cause, not the symptom.
- Never ask "should I continue?" in flywheel mode — keep iterating until verified.
- After 3 consecutive failures on the same issue, change strategy (instrument, isolate, rollback, or reduce scope).
- Motion safety: avoid high-contrast flashes (large-area pulses/fades). Default to subtle or non-animated loading states and honor `prefers-reduced-motion`.

Local commands:
```powershell
# Segmented repo test gate (app + first-party MCP packages)
npm run test:run

# Increase independent test-lane parallelism when the machine can handle it
$env:NODEBENCH_TEST_SEGMENT_PARALLEL=2
npm run test:run

# Optional: include the embedded Overstory Bun suite as a separate lane
npm run test:run:full

# Capture end-to-end walkthrough evidence (screenshots + video + scribe + frames)
npm run dogfood:full:local

# Parallelize dogfood route capture into small shards plus a dedicated interactions lane
$env:DOGFOOD_ROUTE_SHARDS=3
npm run dogfood:full:local -- --routeShards 3

# Segmented dogfood smoke gate (capture + artifact verification, Gemini auto-skips if no key)
npm run dogfood:verify

# Force the Gemini scoring lane
npm run dogfood:verify:strict

# Run Gemini QA (video + sampled frames + screenshots) and persist runs for /dogfood review
npm run dogfood:qa:gemini

# Verification floor
npx tsc --noEmit
npm run build

# Current-build full-stack eval (capability + judge + UX + capacity + prolonged usage)
npm run eval

# Prolonged usage lane only (multiple entities + sessions + histories)
npm run chat:history:loadtest
```

Review the output in-app:
- Navigate to `/dogfood` and review: gallery, walkthrough video, scribe steps, Gemini QA runs, and trending issues.

### Gemini QA Loop (automated scoring + fix cycle)

**→ Quick Refs:** `gemini_qa_loop` rule (`.claude/rules/`, `.cursor/rules/`, `.windsurf/rules/`)

Full pipeline for any coding agent (Claude Code, Cursor, Windsurf, Codex):

```bash
# Full cycle: build → capture → publish → record → score
npx vite build
BASE_URL=http://127.0.0.1:4173 npx playwright test evals/e2e/full-ui-dogfood.spec.ts --project=chromium --workers=1
npm run dogfood:publish
node scripts/ui/recordDogfoodWalkthrough.mjs --baseURL http://127.0.0.1:4173 --publish static
BASE_URL=http://127.0.0.1:4173 node scripts/ui/runDogfoodGeminiQa.mjs
```

Score formula: `100 - P1×6 - P2×2 - P3×1`. Results at `.tmp/dogfood-gemini-qa/screens-qa.json` and `video-qa.json`.

Model: Gemini 3 Flash Preview → gemini-3-flash → gemini-2.0-flash (auto-fallback chain in both `screenshotQa.ts` and `videoQa.ts`).

Loop: read issues → fix P1s first (6 pts each) → batch P2 fixes → rebuild → re-score → repeat until target.

Noise: ±8pt variance per run. Track P1 count trend, not raw score. Cross-check screenshots before fixing — Gemini hallucinates ~1/run.

## Bug loop (Ralph-style back pressure)

**→ Quick Refs:** `analyst_diagnostic` rule, `critter_check` (check 11: bandaid detection)

### Analyst diagnostic — mandatory for all bug work
Guide yourself like an analyst diagnosing the root cause, NOT a junior dev slapping on a bandaid.
1. **Reproduce** the exact failure mode before touching any code
2. **Trace upstream**: symptom → intermediate state → root cause. Follow the data, not assumptions.
3. **Ask "why" 5 times**: stop when you reach a design decision, missing constraint, or wrong assumption
4. **Fix the cause**: the right fix makes the symptom impossible, not just invisible
5. **Verify no sideways shift**: bandaids move bugs, they don't fix them — check adjacent behavior
6. **Document**: record_learning with the root cause so the next agent doesn't re-discover it

Red flags you're bandaiding: try/catch that swallows errors, `?.` to mask undefined, `as any` to silence types, timeout increases to hide race conditions, deleting failing tests.

Goal: errors become deduped cards, humans approve, agent does legwork, humans review.

Card substrate: `agentTaskSessions` rows with `metadata.kind='bug_card'` and deterministic `metadata.signature`.

Client capture (prod only):
- `apps/web/src/main.tsx` reports `window.error` and `unhandledrejection` to `domains/operations/bugLoop:reportClientError` with local rate limit.

Manual triage:

```powershell
npx convex run --push "domains/operations/bugLoop:listBugCards" "{limit:50}"
```

Move card to Ralph investigation:

```powershell
npx convex run --push "domains/operations/bugLoop:moveBugCard" "{sessionId:'<agentTaskSessionsId>',toColumn:'ralph_investigate'}"
```

This schedules an investigation artifact (LLM-generated plan, no claims of fix) and attaches it to the session metadata.

Export bug cards to the file vault (external filesystem context preservation):

```powershell
npm run bugloop:export:vault
```

## MCP Server Deployment (Render)

NodeBench AI exposes MCP tools as HTTP services for external agents to consume.

### Architecture

Single unified MCP server deployed on Render ($7/mo starter plan):

| Service | Runtime | Tools | Default Port |
|---------|---------|-------|-------------|
| `nodebench-mcp-unified` | Node.js (TypeScript) | 101 tools across 9 domains + findTools meta-tool | 10000 |

**Domains**: research (8), narrative (10), verification (7), knowledge (8), documents (20), planning (3), memory (4), search (3), financial (9), meta (1 — findTools)

The server speaks JSON-RPC 2.0 over HTTP POST. Render injects `PORT` at runtime. All Convex-backed tools route through a single dispatcher at `/api/mcpGateway`. Financial tools call public APIs directly (Stooq, Yahoo Finance, World Bank).

### Tool catalog

The unified server (`nodebench-mcp-unified`) exposes 101 tools across 9 domains:

**Research & Intelligence (8 tools)**
- `getForYouFeed` — Personalized feed with verification-tagged items
- `getLatestDashboard` — Dashboard metrics (deal flow, coverage, costs)
- `getTrendingRepos` / `getFastestGrowingRepos` — GitHub intelligence
- `getLatestPublicDossier` — Company/industry competitive dossier
- `getDealFlow` — Funding events and investment signals
- `getEntityInsights` — Deep entity analysis with persona hooks (banker, VC, CTO, founder)
- `getSignalTimeseries` — Time-series signal data

**DRANE Narrative Engine (10 tools)**
- `getPublicThreads` / `getThread` / `searchThreads` / `getThreadsByEntity` — Thread discovery
- `getThreadsWithEvents` / `getThreadStats` — Thread overviews
- `getThreadPosts` — Analyst notes and thesis updates
- `getOpenDisputes` / `getContradictoryPosts` — Contradiction detection
- `runNewsroomPipeline` — Trigger Scout > Historian > Analyst > Publisher pipeline

**Verification Pipeline (7 tools)**
- `getVerificationSummary` — Trust scores by verdict (VERIFIED through INSUFFICIENT)
- `getVerificationsForFact` / `getFactById` / `getFactsByRun` — Fact-checking
- `getArtifactsWithHealth` — Source health status
- `getCalibrationStats` / `getSloMetricsSummary` — Pipeline performance

**Knowledge Graph (8 tools)**
- `searchEntityContexts` / `getEntityContext` / `getEntityContextByName` — Entity lookup
- `listEntityContexts` / `getEntityContextStats` — Knowledge base browsing
- `getKnowledgeGraph` / `getKnowledgeGraphClaims` — Graph and claim extraction
- `getSourceRegistry` — Source reliability and freshness

**Documents & Files (20 tools)** — all route to internal MCP endpoints, userId injected by Convex-side dispatcher
- `createDocument` / `createDocumentWithContent` / `getDocument` / `updateDocument` — Document CRUD
- `archiveDocument` / `restoreDocument` — Soft delete and restore
- `searchDocuments` / `listDocuments` — Title search and listing
- `exportDocumentToMarkdown` — ProseMirror JSON → Markdown export
- `duplicateDocument` — Clone document with content/icon/type
- `createFolder` / `listFolders` / `getFolderWithDocuments` — Folder management
- `addDocumentToFolder` / `removeDocumentFromFolder` — Folder organization
- `createSpreadsheet` / `listSpreadsheets` — Spreadsheet CRUD
- `getSpreadsheetRange` / `applySpreadsheetOperations` — Cell-level spreadsheet operations
- `listFiles` — File listing with type filtering

**Agent Planning (3 tools)** — via Convex dispatcher
- `createPlan` — Create a task plan with steps (pending/in_progress/completed)
- `updatePlanStep` — Update status or notes of a specific plan step
- `getPlan` — Retrieve a task plan by ID

**Agent Memory (4 tools)** — via Convex dispatcher
- `writeAgentMemory` — Store key-value memory with optional metadata
- `readAgentMemory` — Read memory entries by key
- `listAgentMemory` — List memory entries with optional text search
- `deleteAgentMemory` — Delete a memory entry by key

**Search & Research (3 tools)** — via Convex dispatcher
- `quickSearch` — Fast multi-source search
- `fusionSearch` — Advanced fusion search with mode selection
- `getMigrationStats` — Model migration statistics

**Financial Data (9 tools)** — direct HTTP to public APIs (Stooq, Yahoo Finance, World Bank)
- `equity_price_quote` — Real-time stock quote (Stooq → Yahoo fallback)
- `equity_price_historical` — Historical OHLCV data
- `equity_fundamental_overview` — Company fundamentals from Yahoo Finance
- `crypto_price_quote` — Cryptocurrency price quote
- `crypto_price_historical` — Historical crypto OHLCV data
- `economy_gdp` — GDP data by country (World Bank)
- `economy_inflation` — Inflation data by country (World Bank)
- `news_company` — Company-specific financial news
- `news_world` — Global financial news headlines

**Meta (1 tool)**
- `findTools` — Search available tools by keyword or capability description. Returns matching tool names and descriptions. Use this to discover which tools are available for a task.

### Blueprint deploy

```powershell
# render.yaml at repo root defines the unified service.
# Connect the repo in Render Dashboard > Blueprints > New Blueprint Instance.
# Set secrets (sync: false vars) in the Render dashboard:
#   MCP_HTTP_TOKEN, CONVEX_URL, MCP_SECRET
# Convex dashboard env vars: MCP_SERVICE_USER_ID, MCP_SECRET
```

### Local dev

```powershell
cd mcp_tools/gateway_server && npm install && npm run start:http
```

### External agent connection (remote — Render)

Any MCP-compatible agent can connect to the deployed Render service:

**Cursor** (`.cursor/mcp.json` project-level, or `~/.cursor/mcp.json` global):

```jsonc
{
  "mcpServers": {
    "nodebench": {
      "url": "https://nodebench-mcp-unified.onrender.com",
      "transport": "http",
      "headers": { "x-mcp-token": "<MCP_HTTP_TOKEN>" }
    }
  }
}
```

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```jsonc
{
  "mcpServers": {
    "nodebench": {
      "url": "https://nodebench-mcp-unified.onrender.com",
      "transport": "http",
      "headers": { "x-mcp-token": "<MCP_HTTP_TOKEN>" }
    }
  }
}
```

**Claude Code** (`~/.claude/settings.json`):

```jsonc
{
  "mcpServers": {
    "nodebench": {
      "url": "https://nodebench-mcp-unified.onrender.com",
      "transport": "http",
      "headers": { "x-mcp-token": "<MCP_HTTP_TOKEN>" }
    }
  }
}
```

**Windsurf / Cline / Continue** — same JSON format, drop into respective config.

**OpenAI Agents SDK** (Python):

```python
from agents import Agent
from agents.mcp import MCPServerHTTP

mcp = MCPServerHTTP(
    url="https://nodebench-mcp-unified.onrender.com",
    headers={"x-mcp-token": "<MCP_HTTP_TOKEN>"}
)
agent = Agent(name="Research Agent", mcp_servers=[mcp])
```

**Raw HTTP** (any language):

```python
import requests
headers = {"Content-Type": "application/json", "x-mcp-token": "<MCP_HTTP_TOKEN>"}
# List tools
requests.post("https://nodebench-mcp-unified.onrender.com",
    json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers=headers)
# Call a tool
requests.post("https://nodebench-mcp-unified.onrender.com",
    json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
          "params": {"name": "equity_price_quote", "arguments": {"symbol": "AAPL"}}},
    headers=headers)
```

### Local MCP server — stdio transport (recommended for local dev)

Spawned as a local process by the MCP client. No HTTP server, no port, no auth token needed. The client manages the process lifecycle.

**Cursor** (`.cursor/mcp.json`):

```jsonc
{
  "mcpServers": {
    "nodebench": {
      "command": "npx",
      "args": ["tsx", "mcp_tools/gateway_workers/node/stdioServer.ts"],
      "env": {
        "CONVEX_URL": "https://formal-shepherd-851.convex.site",
        "MCP_SECRET": "<your-mcp-secret>"
      }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "nodebench": {
      "command": "npx",
      "args": ["tsx", "mcp_tools/gateway_workers/node/stdioServer.ts"],
      "env": {
        "CONVEX_URL": "https://formal-shepherd-851.convex.site",
        "MCP_SECRET": "<your-mcp-secret>"
      }
    }
  }
}
```

**Claude Code** (`~/.claude/settings.json`):

```jsonc
{
  "mcpServers": {
    "nodebench": {
      "command": "npx",
      "args": ["tsx", "mcp_tools/gateway_workers/node/stdioServer.ts"],
      "env": {
        "CONVEX_URL": "https://formal-shepherd-851.convex.site",
        "MCP_SECRET": "<your-mcp-secret>"
      }
    }
  }
}
```

**How it works**: The MCP client spawns `npx tsx stdioServer.ts` as a child process, communicates over stdin/stdout using JSON-RPC 2.0. The `StdioServerTransport` from `@modelcontextprotocol/sdk` handles the protocol. All 73 tools are registered. Convex-backed tools call the dispatcher at `CONVEX_URL/api/mcpGateway`. Financial tools call public APIs directly.

**npm script**: `cd mcp_tools/gateway_server && npm run start:stdio`

### Local MCP server — HTTP transport (alternative)

Run the HTTP server locally if you prefer the HTTP transport or need to test the same protocol used in production.

**1. Set environment variables** (create `mcp_tools/gateway_workers/node/.env` or export):

```bash
CONVEX_URL=https://formal-shepherd-851.convex.site   # .convex.site, NOT .convex.cloud
MCP_SECRET=<your-mcp-secret>                          # must match Convex env var
MCP_HTTP_TOKEN=<any-token-for-local-auth>              # optional, skip for local dev
PORT=4002                                              # default if not set
```

**2. Start the server:**

```powershell
cd mcp_tools/gateway_server && npm install && npm run start:http
# Listening on http://0.0.0.0:4002 (73 tools)
```

**3. Connect agents to local HTTP server:**

```jsonc
{
  "mcpServers": {
    "nodebench-local": {
      "url": "http://localhost:4002",
      "transport": "http"
    }
  }
}
```

No `x-mcp-token` header needed if `MCP_HTTP_TOKEN` env var is unset (auth is skipped).

**4. Verify locally:**

```bash
curl http://localhost:4002/health
curl -X POST http://localhost:4002 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### JSON-RPC 2.0 protocol examples

```bash
# List all tools
curl -X POST https://nodebench-mcp-unified.onrender.com \
  -H "Content-Type: application/json" \
  -H "x-mcp-token: $MCP_HTTP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Discover tools by keyword
curl -X POST https://nodebench-mcp-unified.onrender.com \
  -H "Content-Type: application/json" \
  -H "x-mcp-token: $MCP_HTTP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"findTools","arguments":{"query":"stock price"}}}'

# Call a tool
curl -X POST https://nodebench-mcp-unified.onrender.com \
  -H "Content-Type: application/json" \
  -H "x-mcp-token: $MCP_HTTP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"createPlan","arguments":{"goal":"Research NVIDIA","steps":[{"step":"Find SEC filings","status":"pending"}]}}}'
```

### Health check

```bash
curl https://nodebench-mcp-unified.onrender.com/health
# Returns: {"status":"ok","service":"nodebench-mcp-unified","tools":101,"categories":["research","narrative","verification","knowledge","documents","planning","memory","search","financial"]}
```

### Render deployment checklist

1. **Render Dashboard** → **Blueprints** → **New Blueprint Instance**
2. Connect repo `HomenShum/nodebench-ai`, branch `main`
3. Render reads `render.yaml` and creates `nodebench-mcp-unified` (Starter, $7/mo)
4. Set the 3 secrets (`sync: false` vars) in the Render UI:

| Key | Where to find |
|-----|---------------|
| `CONVEX_URL` | Convex HTTP actions URL — use `.convex.site` NOT `.convex.cloud` (e.g. `https://xxx.convex.site`). The `.convex.cloud` domain is for client SDK only and returns 404 for HTTP routes. |
| `MCP_SECRET` | Must match `MCP_SECRET` env var in Convex Dashboard → Settings → Environment Variables |
| `MCP_HTTP_TOKEN` | Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |

5. Click **Deploy Blueprint**
6. Wait for Docker build + health check pass
7. Verify:

```bash
# Health check (no auth needed)
curl https://nodebench-mcp-unified.onrender.com/health

# Auth rejection (no token → 401)
curl -X POST https://nodebench-mcp-unified.onrender.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Tools list (with token → 200)
curl -X POST https://nodebench-mcp-unified.onrender.com \
  -H "Content-Type: application/json" \
  -H "x-mcp-token: $MCP_HTTP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Convex-side env vars** (set in Convex Dashboard → Settings → Environment Variables):

| Key | Purpose |
|-----|---------|
| `MCP_SECRET` | Shared secret — must match Render service |
| `MCP_SERVICE_USER_ID` | Convex user ID for server-side injection on document/authenticated tools |

**Dockerfile details**: `node:20-slim`, `tsx` runtime (no build step), `PORT=10000` default (Render overrides at runtime), `curl` installed for health checks.

### What shipped in the unified service (commit history)

| Commit | Description |
|--------|-------------|
| `62eb0ca` | Initial MCP gateway with 33 tools (research, narrative, verification, knowledge) |
| `0e298ab` | Add document tools (20 tools), batch ops, content search, Markdown export |
| `77a97a8` | Route document tools through internal endpoints for admin-key auth |
| `36acf80` | Replace admin-key auth with Convex-side dispatcher (no admin key exposed) |
| `da6e093` | Merge 4 services into 1 unified service ($28/mo → $7/mo), add planning/memory/search/financial tools |
| `7d3fb40` | MCP protocol compliance fixes (content array format, crypto symbols, rate limits, protocol version) |
| `fa3595c` | LinkedIn content pipeline, Dockerfile port fix, 6-phase verification docs |

## LinkedIn Posting Targets (Personal vs Organization Page)

All automated cron-triggered posts now route to a **LinkedIn Organization Page** instead of the personal profile. Personal profile remains available for manual/agent-initiated posts.

### Architecture

Two posting targets:
- `personal` — User's personal LinkedIn profile (via `LINKEDIN_ACCESS_TOKEN` + `urn:li:person:{id}`)
- `organization` — Company page (via `LINKEDIN_ORG_ACCESS_TOKEN` + `urn:li:organization:{LINKEDIN_ORG_ID}`)

Routing is handled by `createTargetedTextPost` internal action in `domains/social/linkedinPosting.ts`. It reads `LINKEDIN_DEFAULT_TARGET` env var as fallback when no explicit target is passed.

### Required Convex environment variables

| Variable | Purpose |
|----------|---------|
| `LINKEDIN_ORG_ACCESS_TOKEN` | OAuth token with `w_organization_social` + `r_organization_social` scopes for the Company Page |
| `LINKEDIN_ORG_ID` | Numeric organization ID (constructs `urn:li:organization:{id}`) |
| `LINKEDIN_DEFAULT_TARGET` | Set to `organization` for crons to default to org page |
| `LINKEDIN_ACCESS_TOKEN` | Existing personal profile token (unchanged) |

### Posting rules

| Context | Default target | Override |
|---------|---------------|----------|
| Cron-triggered posts (daily digest, funding, FDA, research, clinical, M&A) | `organization` | Hardcoded in workflow |
| Manual triggers (`linkedinTrigger.ts`) | `organization` | Pass `target: "personal"` to override |
| Agent tool (`postToLinkedIn`) | `personal` | Pass `target: "organization"` to override |
| Archive maintenance / corrections | `organization` | — |

### Posting frequency (org page)

Current: 8+ posts/day. Recommended: **2-3 posts/day max**.

LinkedIn's algorithm penalizes accounts that post too frequently — each post competes with your other posts for follower impressions. Consolidate: instead of separate daily_digest + funding_brief + fda_update + research + clinical + ma posts, batch the day's intelligence into 1-2 high-quality posts with the strongest hooks, plus 1 specialized deep-dive (FDA or funding) if the day's data warrants it. Skip days with weak signals entirely.

### Content principles for engagement

What gets engagement on LinkedIn (from analyzing 67 posts, 1 genuine comment):
1. **Hook in line 1** — A surprising stat, contrarian take, or specific claim. Not a title card
2. **Opinion, not just information** — "Here's what I think this means" beats "Here are the facts"
3. **Questions** — Ask the audience something specific. "Anyone seeing this trend in their portfolio?"
4. **Short** — 800-1200 chars outperforms 2500+ chars on LinkedIn. Leave them wanting more
5. **Specific hashtags** — `#Medtronic #FDAApproval` beats `#AI #TechIntelligence`
6. **Vary format** — Same structure every day = predictable = ignorable

What kills engagement:
- Report headers as first line
- Walls of structured text with `═══` dividers
- Generic hashtags that attract bots
- No question, no opinion, no personality
- Posting 8x/day (signal dilution)

### Rollback

Set `LINKEDIN_DEFAULT_TARGET=personal` in Convex dashboard to instantly revert all crons to personal posting without code changes.

### Verification

Test org posting:

```powershell
npx convex run workflows/linkedinTrigger:postTechnicalReport '{"content":"Org test post","dryRun":true,"target":"organization"}'
```

Live test:

```powershell
npx convex run workflows/linkedinTrigger:postTechnicalReport '{"content":"NodeBench AI - Organization page test.","target":"organization"}'
```

Check archive for target field:

```powershell
npx convex run --push "domains/social/linkedinArchiveQueries:getArchivedPosts" "{limit:10,dedupe:true}"
```

New archive rows include `target: "personal" | "organization"`. Existing rows without a target are implicitly `"personal"`.

### Comment fetching (API limitation)

`r_member_social` is a **closed LinkedIn permission** — not available for new applications. This means:
- **Personal post comments/reactions CANNOT be fetched via API** — must be viewed manually on linkedin.com
- **Organization post comments CAN be fetched** via `r_organization_social` scope on the org token
- `fetchPostComments` in `linkedinPosting.ts` defaults to org token for this reason
- Org token requires both `w_organization_social` (post) and `r_organization_social` (read comments)

## LinkedIn Content Pipeline

All content flows through a queue-based pipeline before posting to the org page:

```
Content Sources → linkedinContentQueue → Judge → Schedule → Post → Archive
```

### Pipeline stages

1. **Enqueue** — Content enters `linkedinContentQueue` table via:
   - `backfillPersonalToQueue`: Loads 67 personal archive posts (one-time)
   - Fresh cron-generated content (daily digests, funding, FDA, etc.)
   - Manual additions
   - 3-layer dedup: content hash → queue check → org archive check

2. **Judge** (cron: every 30 min, `batchJudgePending`)
   - **Engagement gate** (existing 7 boolean checks): noReportHeader, hasHook, noWallOfText, hasQuestion, noGenericHashtags, underCharLimit, hasOpinion
   - **LLM judge** (3 boolean criteria): hookQuality, opinionDepth, questionAuthenticity
   - Verdict: `approve` (all pass) | `needs_rewrite` (1-2 fail) | `reject` (all fail or 3+ gate failures)
   - Model: devstral-2-free ($0.00/M via OpenRouter)

3. **Schedule** (cron: hourly, `scheduleNextApprovedPost`)
   - 3 time slots for org page:
     - `org_morning`: 8 AM UTC, Mon-Fri
     - `org_midday`: 1 PM UTC, Mon/Wed/Fri
     - `org_afternoon`: 4 PM UTC, Tue/Thu
   - Priority-based: manual (90+) > fresh (60-80) > backfill (40-60)

4. **Post** (cron: hourly, `processQueuedPost`)
   - Posts due items via `createTargetedTextPost` (engagement gate skipped — already judged)
   - Logs to `linkedinPostArchive` with `queueId` in metadata

### Status flow

```
pending → judging → approved → scheduled → posted
                  → needs_rewrite (fixable)
                  → rejected (permanently weak)
                                            → failed (posting error)
```

### Monitoring

```powershell
# Queue stats (counts by status/source/target)
npx convex run domains/social/linkedinContentQueue:getQueueStats

# List items by status
npx convex run domains/social/linkedinContentQueue:listQueueItems '{"status":"pending","limit":10}'
npx convex run domains/social/linkedinContentQueue:listQueueItems '{"status":"approved","limit":10}'
npx convex run domains/social/linkedinContentQueue:listQueueItems '{"status":"scheduled","limit":10}'

# Backfill personal posts (dry run first)
npx convex run domains/social/linkedinScheduleGrid:backfillPersonalToQueue '{"limit":67,"dryRun":true}'
npx convex run domains/social/linkedinScheduleGrid:backfillPersonalToQueue '{"limit":67,"dryRun":false}'

# Manual judge trigger
npx convex run domains/social/linkedinQualityJudge:batchJudgePending '{"limit":5}'

# Manual schedule trigger
npx convex run domains/social/linkedinScheduleGrid:scheduleNextApprovedPost '{"target":"organization"}'
```

### Key files

- `backend/convex/domains/social/linkedinContentQueue.ts` — Queue CRUD, dedup, stats
- `backend/convex/domains/social/linkedinQualityJudge.ts` — LLM judge + batch processor
- `backend/convex/domains/social/linkedinScheduleGrid.ts` — Time slots, scheduling, backfill
- `backend/convex/domains/social/linkedinPosting.ts` — Queue processor (`processQueuedPost`)

### Founder voice & writing style guide

All thought leadership and non-data posts MUST match the founder's natural writing style. Do NOT generate corporate or "LinkedIn influencer" tone.

**Voice rules**:
- Lowercase default. No title case, no all-caps emphasis unless it's a single word for effect
- Conversational openers: "hey so", "hey did you know", "so we just" — never "Most teams..." or "Here's what..."
- No arrow bullets (→), no numbered lists with bold headers, no formatted frameworks
- Reads like you're talking to one person, not presenting to an audience
- Run-on sentences are fine. Periods between thoughts, not semicolons
- First person casual: "we built", "i think", "we call it" — never "One should consider"
- Include real numbers and proof points from the actual system ("the judge rejected 80% of backfill posts")
- End with a casual question, not a polished CTA. "still shipping and praying?" not "What's your take on this emerging paradigm?"
- No hashtags unless the post type specifically requires them (funding/fda data posts only)

**What to avoid**:
- Corporate buzzword framing: "leverage", "paradigm", "synergy", "at scale"
- Listicle formatting with bold sub-headers and arrow points
- Opening with a dramatic one-liner followed by a line break (the "LinkedIn hook" pattern)
- Emoji usage
- Signing off with "Thoughts?" or "Agree?"

**Reference post** (approved, matches voice):
```
hey so we just built something at cafecorner that i think more teams should be doing

we call it the AI flywheel. basically two loops that feed each other.

loop 1 is verification. every time we ship something we run a 6-phase process:
deep dive context gathering, gap analysis against what production actually looks
like, implement the fix, test it across 5 layers (static, unit, integration,
manual, live e2e), then run parallel verification checks before documenting
every edge case we found.

...

still shipping and praying or have you closed the loop?
```

### Personal profile content strategy

Auto-generated founder-voice posts on the personal profile, 3/week. Org page crons stay untouched.

**Weekly cadence**:

| Day | Category | Target Audience | Signal Source |
|-----|----------|-----------------|---------------|
| Monday | `funding_take` | VCs, founders | Top funding round from digest `fundingRounds[]` |
| Wednesday | `build_log` | Builders, CTOs | Trending repo or tech entity from digest signals |
| Friday | `industry_signal` | General | Lead story + fact-check findings + predictions |

**How it works**:
- Sunday 10PM UTC: `weeklyFounderBatch` cron generates all 3 posts using daily intelligence already collected by existing digest/feed systems
- Posts enqueue to `linkedinContentQueue` with `target: "personal"`, `persona: "FOUNDER"`, `priority: 85`
- Existing judge cron (every 30min) scores them — same engagement gate + LLM judge criteria
- Personal schedule cron (every 2h) assigns to evening slots: Mon/Wed/Fri 6PM UTC
- Existing `processQueuedPost` cron (hourly) posts when due — handles both org and personal targets

**Schedule slots (personal)**:
- `personal_monday` — Mon 6PM UTC
- `personal_wednesday` — Wed 6PM UTC
- `personal_friday` — Fri 6PM UTC

**Manual triggers**:
```powershell
# Dry-run (see output without enqueuing)
npx convex run --prod workflows/founderPostGenerator:generateFounderPost '{"postCategory":"funding_take","dryRun":true,"hoursBack":72}'

# Live enqueue
npx convex run --prod workflows/founderPostGenerator:generateFounderPost '{"postCategory":"build_log","dryRun":false,"hoursBack":48}'

# Schedule personal posts
npx convex run --prod domains/social/linkedinScheduleGrid:scheduleNextApprovedPost '{"target":"personal"}'

# Check personal queue items
npx convex run --prod domains/social/linkedinContentQueue:listQueueItems '{"status":"approved","limit":5}'
```

**Key file**: `backend/convex/workflows/founderPostGenerator.ts` — `generateFounderPost` + `weeklyFounderBatch`

### Pre-post verification pipeline

Every post goes through 4 verification checks before hitting LinkedIn. Runs inside `processQueuedPost` before the actual API call.

**File**: `backend/convex/domains/social/linkedinPrePostVerification.ts` — `verifyBeforePosting` internalAction

**4 checks (run in order, cheapest first):**

| # | Check | What it catches | How it works | Cost |
|---|-------|----------------|-------------|------|
| 1 | **Staleness** | Posts generated 72+ hours ago | Time comparison against `createdAt`. >72h = auto-regenerate, 48-72h = stricter freshness | $0.00 |
| 2 | **Variety** | Same topic posted within 3 days | Queries `linkedinPostArchive` (last 7 days) + scheduled queue items. LLM entity extraction for lowercase posts. Fails if 2+ entity overlaps in last 3 days | $0.00 |
| 3 | **Freshness** | Outdated facts (name changes, deal cancellations) | `fusionSearch` (Brave/Serper/Tavily free tier) for each entity + LLM contradiction detection via devstral-2-free | $0.00 |
| 4 | **Claim verification** | Factually incorrect claims | LLM extracts 1-3 verifiable claims, searches each via `fusionSearch`, LLM judge checks supported/contradicted/not_found | $0.00 |

**Total cost: $0.00/month** — uses fusionSearch FREE-FIRST strategy (~126 searches/month out of 5,500 free) + devstral-2-free LLM.

**Failure handling:**
- Staleness hard fail or variety/freshness fail → status set to `needs_rewrite` → `regenerateFailedPersonalPosts` picks it up
- Claim contradiction → status set to `failed` → held for manual review
- Search/LLM errors → soft warning, non-blocking (post proceeds)

**Auto-regeneration**: `backend/convex/workflows/founderPostGenerator.ts` — `regenerateFailedPersonalPosts` queries `needs_rewrite` items with persona FOUNDER, generates fresh replacements, marks old ones as rejected.

**Manual commands:**
```bash
# Test verification on a specific queue item
npx convex run --prod domains/social/linkedinPrePostVerification:verifyBeforePosting '{"queueId":"...","content":"...","postType":"...","persona":"...","target":"personal","createdAt":1234567890}'

# Trigger regeneration for failed personal posts
npx convex run --prod workflows/founderPostGenerator:regenerateFailedPersonalPosts '{}'

# Check items needing rewrite
npx convex run --prod domains/social/linkedinContentQueue:listQueueItems '{"status":"needs_rewrite","limit":10}'
```

## What to watch for next

Common follow-on issues:
- Backfilled archive entries can exceed 2900 chars and will not match actual posted content
- Encoding or Unicode issues can produce mojibake like "â" in archive content
- "Demo" content leakage if any workflow still has mock data enabled (fix with `demo_urls_to_fda_accessdata`)

Recommended checks:
- Run `getArchiveStats` with `dedupe:true` and ensure counts match UI expectations
- Periodically run the cleanup job in dry-run mode for monitoring only
- `workflows/dailyLinkedInPostMutations:clearArchive` now requires confirm arg and should only be used for full resets

---

## 6-Phase Iterative Deep-Dive Verification Process

Standard verification workflow for any non-trivial implementation. Run this before declaring any integration, migration, or protocol-level change "done."

### Phase 1: Context Gathering (Parallel Subagent Deep Dive)

Launch parallel subagents to research reference materials:
- **SDK/Protocol research**: Latest spec versions, blogs, announcements, GitHub repos, official SDKs
- **Implementation deep dive**: Audit current codebase for patterns, inconsistencies, unused code
- **Dispatcher/backend audit**: Verify function signatures, allowlists, argument shapes match
- **External API research**: Check if third-party APIs still work, find known breaking changes

Goal: Build a comprehensive picture of "what production looks like" vs "what we have."

### Phase 2: Gap Analysis

Compare Phase 1 findings against current implementation. Categorize gaps:
- **CRITICAL**: Protocol violations, broken responses, security issues
- **HIGH**: API incompatibilities, silent failures, wrong data formats
- **MEDIUM**: Outdated versions, missing features, suboptimal patterns
- **LOW**: Missing error handling for edge cases, cosmetic issues

Output: Numbered gap list with severity, root cause, and fix strategy.

### Phase 3: Implementation

Apply fixes following production patterns exactly. Rules:
- Fix CRITICAL and HIGH gaps first
- Each fix is a discrete, testable change
- Follow the reference pattern found in Phase 1 — don't invent new patterns
- Document why each change was made (comments in code where non-obvious)

### Phase 4: Testing & Validation (CRITICAL — Multi-Layer)

Layer 1: **Static analysis** — TypeScript `tsc --noEmit`, Convex typecheck
Layer 2: **Unit tests** — Run existing test suites, add targeted tests for fixes
Layer 3: **Integration tests** — End-to-end flow through dispatcher/handler chain
Layer 4: **Manual verification** — Spot-check critical paths with curl or direct invocation
Layer 5: **Live end-to-end** — Deploy to staging, hit real endpoints, verify real responses

All layers must pass before proceeding to Phase 5.

### Phase 5: Self-Closed-Loop Verification (Parallel Subagents)

Launch parallel verification subagents, each checking a different dimension:
- **Spec compliance**: Does every response match the protocol spec exactly?
- **Functional correctness**: Do tools return correct data for known inputs?
- **Argument compatibility**: Do all handler→backend function pairs have matching shapes?

Each subagent produces a PASS/FAIL checklist. Any FAIL loops back to Phase 3.

### Phase 6: Document Learnings

Update AGENTS.md (this file) with:
- Edge cases discovered during verification
- Key learnings that prevent future regressions
- Updated verification coverage map entries

---

### Edge Cases & Learnings (from MCP Unified Server verification)

**MCP Protocol**:
- `tools/call` responses MUST use `result.content` array with `{type: "text", text: "..."}` items and `isError: boolean`. Tool execution errors return `isError: true` at HTTP 200 — NOT JSON-RPC error objects. JSON-RPC errors are reserved for protocol-level failures only.
- All valid JSON-RPC responses (including `error` responses like method-not-found) should return HTTP 200. Non-200 is only for transport-level failures (parse errors, malformed HTTP).
- Protocol version matters. Clients may reject outdated versions. Keep `protocolVersion` in `initialize` response current (currently `2025-11-25`).

**Financial APIs**:
- **Stooq**: Crypto symbols use `.V` suffix (`BTC.V`, `ETH.V`), NOT `-USD`. Has undocumented daily rate limit — response body contains "Exceeded the daily hits limit" when hit. CSV format, no auth required.
- **Yahoo Finance v7**: Effectively broken since ~2025 — returns 401 without crumb/cookie auth. Use as fallback only, expect failures. `equity_fundamental_overview` has no alternative source — documented limitation.
- **World Bank API v2**: Stable, no auth, correct indicators: `NY.GDP.MKTP.CD` (GDP), `FP.CPI.TOTL.ZG` (inflation). Response is `[metadata, data]` array — always index `[1]` for actual data.

**Convex HTTP Routing**:
- HTTP action routes (defined via `httpRouter`) are served on `.convex.site`, NOT `.convex.cloud`. The `.convex.cloud` domain only handles client SDK queries/mutations and returns 404 for all HTTP routes.
- `CONVEX_URL` env var on external services (Render) must use `https://xxx.convex.site` for HTTP action endpoints like `/api/mcpGateway`.
- OPTIONS preflight works on both domains (Convex default CORS), but POST/GET only work on `.convex.site`.

**Dispatcher Pattern**:
- All 9 gateway tool handler → Convex function pairs verified compatible by argument shape analysis
- Planning/memory tools use key-based lookup (no userId injection needed)
- Search tools are public actions (no userId injection needed)
- Document tools require userId injection via `MCP_SERVICE_USER_ID` env var

### Edge Cases & Learnings (from LinkedIn Content Pipeline verification)

**Convex Runtime Constraints**:
- `"use node"` files can ONLY export actions (`internalAction`, `action`). Mutations and queries must live in separate non-node files. Violating this causes silent deployment failures.
- Index predicates MUST use `.withIndex("name", (q) => q.eq("field", value))` — NOT `.withIndex("name").filter(...)`. The latter compiles but bypasses the index, causing full table scans.
- Pure helper functions (no Convex context) CAN be imported across `"use node"` boundaries. Only exports that use `ctx` are restricted.
- `crypto` module is unavailable in Convex runtime (non-node files). Use pure JS hashes like cyrb53 for content deduplication instead of SHA-256.

**Content Pipeline Design**:
- Archive dedup uses `.take(500)` lookback — posts beyond 500 could theoretically slip through as duplicates. Acceptable trade-off: archive grows slowly (2-3 posts/day) and 500 covers ~6 months of history.
- `getScheduledDueNow` collects all scheduled items then filters in JS (no `<=` index predicate available in Convex). Acceptable at current scale (<100 scheduled items).
- Concurrent `enqueueContent` calls could race past the hash uniqueness check. Low risk at 2-3 posts/day cadence, and the `by_content_hash` index provides a second layer of protection on read.
- `Date.setUTCDate()` correctly handles month boundary overflow (e.g., Jan 31 + 1 = Feb 1). No manual month arithmetic needed.

**LLM Judge Pattern**:
- FREE-FIRST model strategy: `devstral-2-free` ($0.00/M via OpenRouter) handles quality judging. Fallback chain via `getLanguageModelSafe()`.
- JSON parsing with `responseText.match(/\{[\s\S]*\}/)` is adequate for single-object responses. For multi-object or nested JSON, use a stricter parser.
- On LLM failure or parse error, revert queue item to `pending` status so it retries on next cron run. Never leave items stuck in `judging` state.
- Backfill posts (old-style report format) have high rejection rates (~80%). Expected behavior — these were written before the engagement gate criteria existed.

---

## Eval-Driven Development Loop

Continuous improvement cycle for agent workflows, tool quality, and prompt effectiveness. Changes only ship if evals improve — never on gut feel alone.

### Step 1: Run Eval Batch

Send a batch of test cases through the target workflow. Each test case defines:
- **Input**: The user prompt, context, and any seeded state
- **Intent**: What the agent is supposed to accomplish (ground truth goal)
- **Expected behavior**: Tool calls made, action steps taken, final output shape

### Step 2: Capture Full Session Telemetry

For every eval run, collect the complete agent execution trace:
- Tool calls (name, arguments, return values)
- Action steps and intermediate reasoning
- Model responses at each turn
- Latency, token usage, error counts
- Final output vs expected output

### Step 3: LLM-as-Judge Analysis Batch

Send the full telemetry (input + intent + output + trace) to an analysis batch where an LLM judge scores each run:
- **Goal alignment**: Did the output match the stated intent?
- **Tool efficiency**: Were the right tools called in the right order? Any redundant or missing calls?
- **Output quality**: Accuracy, completeness, formatting
- **Failure modes**: Where did it go wrong and why?
- **Suggestions**: Concrete improvements — prompt rewording, new tool additions, parameter changes, guard rails

### Step 4: Retrieve Analysis Results

Collect judge verdicts and aggregate:
- Pass/fail rate per test case
- Recurring failure patterns across the batch
- Ranked improvement suggestions by expected impact

### Step 5: Fix, Optimize, Enhance

Apply changes based on judge feedback:
- **Fix**: Correct broken tool implementations, wrong defaults, missing error handling
- **Optimize**: Reduce unnecessary tool calls, improve prompt specificity, tighten output schemas
- **Enhance**: Add new tools for gaps the judge identified, expand intent coverage
- **Variations**: Test multiple approaches to the same fix (prompt A vs prompt B, tool X vs tool Y)

### Step 6: Re-run Evals — Deploy Only If Better

Run the same eval batch against the modified workflow. Compare scores:
- If eval scores improved → deploy the change
- If eval scores regressed or stayed flat → revert and try a different approach
- Track eval history over time to detect drift

**Rule: No change ships without an eval improvement. The eval batch is the gatekeeper, not human intuition.**

---

## How the Two Loops Compose: The AI Flywheel (Verification × Eval)

The **6-Phase Verification** and **Eval-Driven Development Loop** are not separate processes — they're nested loops that reinforce each other.

```
┌─────────────────────────────────────────────────────────────────┐
│  OUTER LOOP: Eval-Driven Development                           │
│                                                                 │
│  Eval Batch ──→ Telemetry ──→ LLM Judge ──→ Suggestions        │
│       │                                          │              │
│       │         ┌───────────────────────────┐    │              │
│       │         │ INNER LOOP: 6-Phase       │    │              │
│       │         │                           │    │              │
│       ▼         │  P1 Context Gather        │    │              │
│   Regression    │  P2 Gap Analysis    ◄─────┼────┘              │
│   detected or   │  P3 Implementation       │  Judge suggestions │
│   new intent    │  P4 Test & Validate ─────┼──► feeds back as   │
│   added         │  P5 Self-Closed Verify   │    new eval cases  │
│       │         │  P6 Document Learnings ──┼──► updates edge    │
│       │         │                           │    case registry   │
│       │         └───────────────────────────┘                   │
│       │                      │                                  │
│       ▼                      ▼                                  │
│  Re-run Eval Batch ──→ Score improved? ──→ Deploy              │
│                          │                                      │
│                          NO → revert, try different approach    │
└─────────────────────────────────────────────────────────────────┘
```

### Inner loop → Outer loop (Verification feeds Evals)

| 6-Phase output | Feeds into Eval Loop as |
|---|---|
| Phase 4 test cases (static, unit, integration, E2E) | New eval batch test cases with known-good expected outputs |
| Phase 5 subagent PASS/FAIL checklists | Eval scoring rubrics — each checklist item becomes a boolean eval criterion |
| Phase 6 edge cases & learnings | New adversarial eval cases targeting discovered failure modes |

### Outer loop → Inner loop (Evals trigger Verification)

| Eval Loop output | Triggers 6-Phase as |
|---|---|
| Judge finds tool calling inefficiency | Phase 2 gap analysis scoped to that tool's implementation |
| Eval scores regress after deploy | Full Phase 1-6 cycle on the regression — treat as a production incident |
| Judge suggests new tool or prompt change | Phase 3 implementation following existing patterns, validated through Phase 4-5 |
| Recurring failure pattern across batch | Phase 1 deep dive into root cause (maybe upstream API changed, maybe schema drifted) |

### When to use which

- **Building or changing a feature** → Run the 6-Phase inner loop. You're asking: *"Is this implementation correct?"*
- **Measuring system quality over time** → Run the Eval outer loop. You're asking: *"Is the system getting better?"*
- **Both, always** → Every 6-Phase run produces artifacts (test cases, edge cases, checklists) that expand the eval suite. Every eval regression triggers a 6-Phase investigation. They are not optional alternatives — they compound.

### Mandatory: AI Flywheel testing after any update or change

For a concise, repo-root reference, see `AI_FLYWHEEL.md`.
For the next execution-model architecture, see `docs/architecture/plans/2026-03-12-hierarchical-mission-harness-plan.md`.

After any non-trivial code change, feature addition, or bug fix, the AI Flywheel verification process **must** be run before considering the work done. This is not optional.

**Minimum required steps:**
1. **Static analysis** — `tsc --noEmit` and `convex dev --once --typecheck=enable` must pass with zero errors
2. **Happy-path test** — Run the changed functionality with valid inputs and confirm expected output
3. **Failure-path test** — Test each failure mode the code is supposed to handle (invalid inputs, edge cases, error states)
4. **Gap analysis** — Review the code for dead code, unused variables, missing integrations, or logic that doesn't match the stated intent
5. **Fix and re-verify** — If any gap is found, fix it and re-run steps 1-3 from scratch
6. **Deploy and document** — Deploy the verified fix, document any gaps found and how they were resolved

**Additional required when changing tool-facing behavior (capability regression guard):**
- Run GAIA capability eval (web lane, accuracy: LLM-only vs LLM+tools): `npm run mcp:dataset:gaia:capability:test`
- If your change touches local file tooling or attachment handling, also run the file-backed lane: `npm run mcp:dataset:gaia:capability:files:test`
- Pass condition (web lane): tool-augmented accuracy must be >= baseline accuracy on the sampled tasks (see `packages/mcp-local/src/__tests__/gaiaCapabilityEval.test.ts`)
- Pass condition (file lane): tool-augmented accuracy must be >= baseline accuracy, and should show at least 1 improvement on the sampled tasks (see `packages/mcp-local/src/__tests__/gaiaCapabilityFilesEval.test.ts`)

If the capability delta barely improves, treat it as a signal that "Access" is not increasing, not that the model is weak:
- Benchmark tool-dependent tasks first (GAIA file-backed lane is the fastest check for deterministic gains).
- Prefer `NODEBENCH_GAIA_CAPABILITY_TOOLS_MODE=agent` when a single extract is insufficient.
- Add missing deterministic access primitives (PDF search, sheet selection, table filters/aggregations) before tweaking prompts or switching models.

**When to skip:** Only for trivial changes (typo fixes, comment updates, config tweaks) where the blast radius is near zero.

**Why this matters:** The first deployment of the pre-post verification pipeline had a bug where the variety check fetched scheduled queue items but never actually compared entities against them (dead code). This was only caught because the flywheel process was run after the initial "it works" smoke tests. Without it, the bug would have gone to production silently.

### Mandatory: Post-Implementation Audit Checklist

After every implementation — before moving to the next task — answer these 3 questions:

1. **Has the MCP been performing optimally? Any gaps in the MCP?**
   - Review MCP tool chain usage: Were all relevant tools called? Did any return unexpected results?
   - Check for orphaned verification cycles (started but never completed/abandoned)
   - Verify search_all_knowledge returns relevant results for the domain you just worked on
   - Confirm learnings from this implementation were recorded via record_learning
   - **Completion traceability:** Each record_learning and save_session_note must cite the original request/task that prompted this work. Without traceability, knowledge compounds but context is lost — future sessions can't trace *why* something was built.

2. **Are there any gaps in the actual implementation?**
   - Dead imports, unused variables, unreachable code
   - Missing integrations (new mutations not wired to crons, new tables missing cross-references to existing governance tables like authorTrust)
   - Schema additions without corresponding CRUD operations
   - Hardcoded values that should be configurable (acceptable for v1, but log the gap)

3. **Did everything go through the AGENTS.md AI Flywheel process?**
   - All 6 mandatory flywheel steps completed (static analysis, happy-path, failure-path, gap analysis, fix & re-verify, deploy & document)
   - All 5 test layers exercised (static, unit, integration, live_e2e, manual)
   - Quality gates passed (code_review ≥ 0.8, deploy_readiness ≥ 0.8)
   - Findings promoted to eval loop via promote_to_eval where applicable
   - Gaps logged, resolved, and learnings recorded in MCP knowledge base

**This checklist is not optional.** Every implementation must end with these 3 questions answered and documented. If any answer reveals a gap, fix it before proceeding.

---

## Dataset-Driven Eval Bench (SWE-bench Verified)

Real-world evaluation of MCP tool orchestration using open-source software engineering tasks from the SWE-bench Verified dataset (500 human-validated GitHub issues from princeton-nlp).

**→ Quick Refs:** Run dataset bench: `cd packages/mcp-local && npx vitest run apps/web/src/__tests__/evalDatasetBench.test.ts` | Run tool coverage: `npx vitest run apps/web/src/__tests__/evalHarness.test.ts` | Dataset: [SWE-bench Verified](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified) | See [AI Flywheel](#how-the-two-loops-compose-the-ai-flywheel-verification--eval) | See [Eval-Driven Development Loop](#eval-driven-development-loop) | See [6-Phase Verification](#6-phase-iterative-deep-dive-verification-process)

### What it tests

20 real GitHub issues from 8 repositories (django, scikit-learn, sympy, astropy, sphinx, xarray, pylint, matplotlib) across 5 task categories:

| Category | Count | Example |
|----------|-------|---------|
| bug_fix | 11 | django HttpResponse memoryview, sympy evalf crash |
| feature | 5 | Django get_inlines() hook, Sphinx PEP 604 union types |
| api_change | 2 | xarray dim vs coord naming inconsistency |
| refactor | 1 | matplotlib cla()/clf() stale references |
| documentation | 1 | scikit-learn add joblib to show_versions |

Complexity distribution: 6 low, 9 medium, 5 high.

### How it tests — Full Agent Pipeline

Each SWE-bench task runs through the **complete 8-phase MCP tool pipeline**:

```
Meta → Recon → Risk → Verification → Eval → Quality Gate → Knowledge → Flywheel
```

| Phase | Tools Used | What it proves |
|-------|-----------|---------------|
| 1. Meta | `findTools`, `getMethodology` | Agent discovers the right tools for the task category |
| 2. Recon | `run_recon`, `log_recon_finding`, `get_recon_summary` | Research pipeline captures root cause analysis |
| 3. Risk | `assess_risk` | Risk tiering works for different action types |
| 4. Verification | `start_verification_cycle`, `log_phase_findings`, `log_gap`, `resolve_gap`, `log_test_result`, `get_verification_status` | Full 6-phase verification cycle tracks implementation |
| 5. Eval | `start_eval_run`, `record_eval_result`, `complete_eval_run` | Eval runs score implementation quality |
| 6. Quality Gate | `run_quality_gate`, `run_closed_loop` | Deploy readiness gate enforces pass/fail |
| 7. Knowledge | `record_learning`, `search_all_knowledge` | Learnings persist and are searchable |
| 8. Flywheel | `run_mandatory_flywheel` | All 6 flywheel steps enforced |
| 9. Re-examine | Fresh-eyes review | Re-examine the completed work for 11/10 opportunities — micro-interactions, a11y gaps, error resilience, keyboard efficiency, progressive disclosure |

### Re-examine modular rules (`related_` hop pattern)

Phase 9 is backed by **6 modular rule files** in `.cursor/rules/` and `.windsurf/rules/`. Each rule has a `related_` frontmatter field listing one-hop neighbors. Following a neighbor's `related_` gives two-hop discovery.

| Rule file | Focus | related_ (one-hop) |
|-----------|-------|---------------------|
| `reexamine_process` | Orchestrator — when & how to re-examine | a11y, resilience, polish, keyboard, performance |
| `reexamine_a11y` | ARIA, reduced motion, color-blind, screen readers | keyboard, polish, process |
| `reexamine_resilience` | Retry/backoff, partial failures, graceful degradation | performance, process, polish |
| `reexamine_polish` | Skeleton loading, staggered fade-ins, print stylesheet | a11y, performance, process |
| `reexamine_keyboard` | Skip links, shortcuts, tab order, focus traps | a11y, process |
| `reexamine_performance` | Progressive disclosure, smart refresh, lazy loading | resilience, polish, process |

**Two-hop example**: `reexamine_process` → `reexamine_a11y` (one hop) → `reexamine_keyboard` (two hops). An agent starting at the process orchestrator discovers keyboard efficiency via the a11y rule's `related_` field.

**MCP parallel**: The `relatedTools` field on every tool's `_quickRef` mirrors this `related_` hop pattern in live tooling. `get_tool_quick_ref({ depth: 2 })` performs the same multi-hop BFS traversal across 215 tools that `related_` enables across rule files.

**→ Quick Refs:** `register_skill` tracks freshness of these rule files. `check_skill_freshness` detects when source docs drift. `toolRegistry.ts` (`computeRelatedTools`, `_populateRelatedTools`), `progressiveDiscoveryTools.ts` (BFS traversal handler, pagination handler).

### Cross-task integration tests

Beyond per-task pipelines, 3 cross-task tests prove the flywheel loops connect:

| Test | Tools | What it proves |
|------|-------|---------------|
| Eval Comparison | `compare_eval_runs` | Baseline vs candidate → DEPLOY/REVERT/INVESTIGATE |
| Promote to Eval | `promote_to_eval` | Verification findings → eval test cases |
| Trigger Investigation | `trigger_investigation` | Eval regression → new verification cycle |

### Running the bench

```bash
# Full dataset bench (20 tasks, 473 tool calls)
cd packages/mcp-local && npx vitest run apps/web/src/__tests__/evalDatasetBench.test.ts --reporter=verbose

# Tool-level coverage (47 tools, 76 calls)
cd packages/mcp-local && npx vitest run apps/web/src/__tests__/evalHarness.test.ts --reporter=verbose

# Both together
cd packages/mcp-local && npx vitest run apps/web/src/__tests__/evalDatasetBench.test.ts apps/web/src/__tests__/evalHarness.test.ts --reporter=verbose
```

### Latest results

```
SWE-BENCH DATASET BENCH — PROOF OF WORK REPORT

Total Tool Calls:             473
Unique Tools Exercised:        23
Success Rate:              473/473 (100%)
Tasks Completed:               23 (20 SWE-bench + 3 cross-task)
Pipeline Phases:                8

PER-TASK RESULTS: 20/20 PASS (all categories, all complexities)

TOOL COVERAGE (evalHarness.test.ts):
47 total tools | 44 tested (94%) | 12 external (API keys) | 0 gaps
```

### How the eval bench connects to the AI Flywheel

```
┌────────────────────────────────────────────────────────────────────┐
│                    AI FLYWHEEL + DATASET BENCH                      │
│                                                                     │
│  SWE-bench Tasks ──────────────────────────────────────────────┐   │
│  (20 real issues)                                               │   │
│       │                                                         │   │
│       ▼                                                         │   │
│  ┌─────────────────────────────────────────────────────────┐   │   │
│  │ INNER LOOP (per task)                                    │   │   │
│  │                                                          │   │   │
│  │  Meta → Recon → Risk → Verification → Eval → Gate       │   │   │
│  │    │                       │              │              │   │   │
│  │    │                       │              ▼              │   │   │
│  │    │                       │         Knowledge           │   │   │
│  │    │                       │         (learnings)         │   │   │
│  │    │                       ▼              │              │   │   │
│  │    │                  Mandatory            │              │   │   │
│  │    │                  Flywheel ◄───────────┘              │   │   │
│  │    │                       │                             │   │   │
│  └────┼───────────────────────┼─────────────────────────────┘   │   │
│       │                       │                                  │   │
│       ▼                       ▼                                  │   │
│  ┌─────────────────────────────────────────────────────────┐   │   │
│  │ OUTER LOOP (cross-task)                                  │   │   │
│  │                                                          │   │   │
│  │  compare_eval_runs ──→ Regression? ──→ trigger_          │   │   │
│  │                              │          investigation    │   │   │
│  │                              │               │           │   │   │
│  │  promote_to_eval ◄───────────┘               │           │   │   │
│  │  (verification → eval cases)                 │           │   │   │
│  │                                              │           │   │   │
│  │  New verification cycle ◄────────────────────┘           │   │   │
│  └──────────────────────────────────────────────────────────┘   │   │
│                                                                     │
│  VERDICT: Pipeline orchestrates end-to-end for ALL task types      │
└────────────────────────────────────────────────────────────────────┘
```

### Adding new dataset tasks

To add more tasks from SWE-bench or other datasets:

1. Add entries to the `SWE_BENCH_TASKS` array in `evalDatasetBench.test.ts`
2. Each task needs: `instance_id`, `repo`, `problem_statement`, `category`, `complexity`
3. The `runFullPipeline()` function handles everything — no per-task code needed
4. Run the bench and check the report for 100% pass rate

Compatible datasets for future expansion:
- **SWE-bench Verified** (full 500 tasks) — same format, just add more entries
- **GAIA** (gated multi-step tool-augmented tasks) — supported via `.cache/gaia` fixtures + `openDatasetParallelEvalGaia.test.ts` (do not commit GAIA content)
- **MCP-AgentBench** (600 queries across 33 MCP servers) — direct MCP tool evaluation
- **HumanEval/MBPP** (164/974 code tasks) — eval-driven development pipeline testing

GAIA lane quick commands (gated):
- Refresh fixture: `npm run mcp:dataset:gaia:refresh` (requires `HF_TOKEN` or `HUGGINGFACE_HUB_TOKEN`)
- Run: `NODEBENCH_GAIA_TASK_LIMIT=8 NODEBENCH_GAIA_CONCURRENCY=4 npm run mcp:dataset:gaia:test`
- Capability (accuracy) fixture: `npm run mcp:dataset:gaia:capability:refresh` (writes ground truth into `.cache/gaia`, do not commit)
- Capability (accuracy) run: `NODEBENCH_GAIA_CAPABILITY_TASK_LIMIT=6 NODEBENCH_GAIA_CAPABILITY_CONCURRENCY=1 npm run mcp:dataset:gaia:capability:test`
- Capability (accuracy) files fixture: `npm run mcp:dataset:gaia:capability:files:refresh` (downloads referenced attachments into `.cache/gaia/data`, do not commit)
- Capability (accuracy) files run: `NODEBENCH_GAIA_CAPABILITY_TASK_LIMIT=6 NODEBENCH_GAIA_CAPABILITY_CONCURRENCY=1 npm run mcp:dataset:gaia:capability:files:test`
- Capability (accuracy) media fixture: `npm run mcp:dataset:gaia:capability:media:refresh` (image OCR lane, do not commit)
- Capability (accuracy) media run: `NODEBENCH_GAIA_CAPABILITY_TASK_LIMIT=6 NODEBENCH_GAIA_CAPABILITY_CONCURRENCY=1 npm run mcp:dataset:gaia:capability:media:test`
- Capability (accuracy) audio fixture: `npm run mcp:dataset:gaia:capability:audio:refresh` (speech-to-text lane, do not commit)
- Capability (accuracy) audio run: `NODEBENCH_GAIA_CAPABILITY_TASK_LIMIT=4 NODEBENCH_GAIA_CAPABILITY_CONCURRENCY=1 npm run mcp:dataset:gaia:capability:audio:test`
- UI proof (safe screenshots): `npm run build` then `node scripts/ui/captureUiSnapshots.mjs` (writes into `screenshots/`)
- Full suite (public + GAIA): `npm run mcp:dataset:bench:full`

### Test file cross-references

| File | Purpose | Tools Tested | Calls |
|------|---------|-------------|-------|
| `evalDatasetBench.test.ts` | Real-world task orchestration | 23 unique | 473 |
| `evalHarness.test.ts` | Tool-level coverage (every tool) | 48 unique | 83 |
| `openDatasetParallelEval.test.ts` | BFCL long-context parallel | 10 unique | 80 |
| `openDatasetParallelEvalGaia.test.ts` | GAIA gated parallel | 10 unique | 80 |
| `gaiaCapabilityEval.test.ts` | GAIA capability (LLM-only vs tools) | external | varies |
| `gaiaCapabilityFilesEval.test.ts` | GAIA capability (files lane: PDF/XLSX/CSV/etc) | external | varies |
| `gaiaCapabilityMediaEval.test.ts` | GAIA capability (media lane: image OCR) | external | varies |
| `gaiaCapabilityAudioEval.test.ts` | GAIA capability (audio lane: speech-to-text) | external | varies |
| `tools.test.ts` | Static + unit + integration | 60 total | varies |

---

## Self-Reinforced Learning Loop (v1.4.0)

The MCP now includes trajectory analysis and self-evaluation tools that enable agents to observe their own tool usage patterns, identify gaps, and improve over time. This creates a closed-loop: **Use → Log → Analyze → Recommend → Apply → Re-analyze**.

**→ Quick Refs:** `selfEvalTools.ts` (4 tools), `tool_call_log` table in `db.ts`, methodology topic `self_reinforced_learning`

### New Tools (4)

| Tool | Purpose |
|------|---------|
| `log_tool_call` | Record a tool invocation with timing, status, phase context |
| `get_trajectory_analysis` | Analyze tool usage patterns, frequencies, error rates, sequential bigrams |
| `get_self_eval_report` | Cross-reference all data: cycles, evals, gates, gaps, learnings, trajectories → health score |
| `get_improvement_recommendations` | Surface actionable improvements: unused tools, error patterns, process gaps, quality decline |

### The Self-Reinforced Learning Cycle

```
┌─────────────────────────────────────────────────────┐
│               SELF-REINFORCED LEARNING              │
│                                                     │
│   Step 1: INSTRUMENT                                │
│   └→ log_tool_call after each tool invocation       │
│                                                     │
│   Step 2: ANALYZE TRAJECTORIES                      │
│   └→ get_trajectory_analysis (patterns, errors)     │
│                                                     │
│   Step 3: SELF-EVALUATE                             │
│   └→ get_self_eval_report (health score A-F)        │
│                                                     │
│   Step 4: GET RECOMMENDATIONS                       │
│   └→ get_improvement_recommendations                │
│       (unused tools, process gaps, quality decline)  │
│                                                     │
│   Step 5: APPLY & RE-ANALYZE                        │
│   └→ Fix issues → record_learning → re-run report   │
│       Compare health scores before/after             │
│                                                     │
│   ↺ Loop continuously — system gets smarter          │
└─────────────────────────────────────────────────────┘
```

### Health Score Components

The `get_self_eval_report` health score is a weighted composite:
- **Cycle completion rate** (25%) — Verification cycles completed vs total
- **Eval pass rate** (25%) — Average pass rate across completed eval runs
- **Gap resolution rate** (20%) — Resolved gaps vs total open gaps
- **Quality gate pass rate** (15%) — Quality gates passed vs total
- **Tool error rate** (15%) — Inverse of tool call error rate

Grades: A (≥90%), B (≥75%), C (≥60%), D (≥40%), F (<40%)

### Recommendation Categories

| Category | Detects |
|----------|---------|
| `tools` | Unused tools, error-prone tools (>20% error rate), slow tools (>5s avg) |
| `process` | Abandoned cycles (>30%), stuck cycles (3+ days), missing flywheel runs |
| `quality` | Declining eval pass rates, unresolved CRITICAL/HIGH gaps |
| `knowledge` | Low learning-to-cycle ratio (<1:1), orphan recon sessions (7+ days) |

### How It Connects to the AI Flywheel

The self-reinforced learning loop wraps around the existing AI Flywheel:

```
Outer: Self-Reinforced Learning
  └→ Middle: Eval-Driven Development (outer loop)
       └→ Inner: 6-Phase Verification (inner loop)
            └→ Tools in action
                 └→ log_tool_call (instrumentation)
       └→ get_trajectory_analysis (pattern detection)
  └→ get_improvement_recommendations (improvement surface)
```

Trajectory data flows into eval case design. Recommendations trigger new verification cycles. Learnings persist across sessions and inform future tool selection.

---

## Agent Protocol (Peter Style)
- Role: Specialized builder agent. Peter is the Architect.
- Objective: Close-the-loop verification cycle. Iterate until green.
- Communication: High-level architecture. Peter handles taste/vision. You handle plumbing/verification.

## Closed Loop (Verification)
- Step 1: Compile. Build clean.
- Step 2: Lint. Style clean. No warnings.
- Step 3: Test. Run automated suites.
- Step 4: Self-debug. If 1-3 fail: read logs, hypothesize, fix, restart loop.
- Goal: Never present changes to Architect without full local green loop.

## Git Workflow
- PRs = Prompt Requests. Submit intent (prompt), not just code.
- Weaving. Integrate changes into existing architecture. Keep design consistent.
- Commits: Atomic only. Conventional Commits: `feat`, `fix`, `refactor`.
- Parallelism: Multiple agents (3-8) in a 3x3 terminal grid. Stay in assigned subspace.

## Architecture and Conventions
- Hierarchy: System understanding first. Avoid line-by-line thrash.
- Refactoring: If bloat/mess detected, propose weave into cleaner plugin architecture.
- Bugs: Every fix ships with a regression test.

## Environment and Tools
- CLI: Primary driver `codex` CLI or similar.
- Sandbox: Run loops inside Docker or fast local environment.
- Validation: Use `pnpm test` or `gh run` to verify CI locally.

## Style Guidelines
- Output: Telegraphic. Drop filler grammar.
- Min tokens: Concise. No conversational overhead.
- Taste: If UI feels clunky, ask for taste check before proceeding.

## Why this format
- AGENTS.md replaces manual onboarding and "vibe coding".
- Constraint: strict automated verification loop. Prevents slop at scale.

---

## Top 10 Claude Code Power-User Tips

### 1. Work in parallel
Set up 3-5 git worktrees, each with its own Claude session. Single biggest productivity unlock.

### 2. Plan mode first
Complex tasks always start with a plan. Pour energy into planning → Claude implements in one shot. Pro tip: Have a second session review the plan as a "Staff Engineer."

### 3. Maintain CLAUDE.md
After every correction: "Update your CLAUDE.md so you don't make that mistake again." Claude writes excellent rules for itself. Mistake rate drops measurably over time.

### 4. Build your own skills
Repetitive tasks → skill or slash command. Example: `/techdebt` at the end of every session to find duplicated code. Commit skills to git and reuse across projects.

### 5. Automate bug fixes
Enable Slack MCP, paste a bug thread, say "fix." Or: "Go fix the failing CI tests." Don't micromanage -- Claude finds the way.

### 6. Better prompts
- "Grill me on these changes -- no PR until I pass your test"
- "Knowing everything you know now, scrap this and implement the elegant solution"
- Detailed specs = better output

### 7. Use subagents
Append "use subagents" to requests for more compute. Offload tasks to subagents to keep main context clean.

### 8. Data & Analytics
Claude + bq CLI = metrics on the fly. "I haven't written a line of SQL in 6+ months."

### 9. Voice Dictation
You speak 3x faster than you type. Prompts automatically get more detailed. (fn x2 on macOS)

### 10. Learn with Claude
Enable "Explanatory" output style, generate HTML presentations or ASCII diagrams. Claude explains the why behind changes.

---

## Parallel Agent Teams (NodeBench MCP v1.6.0)

Learnings from Anthropic's ["Building a C Compiler with Parallel Claudes"](https://www.anthropic.com/engineering/building-c-compiler) (Feb 5, 2026).

### What Anthropic did

16 parallel Claude Opus 4.6 instances built a 100,000-line Rust-based C compiler from scratch. Nearly 2,000 Claude Code sessions, $20,000 in API costs. The compiler can build Linux 6.9 on x86, ARM, and RISC-V.

### Key patterns integrated into NodeBench MCP

| Pattern | Anthropic Implementation | NodeBench MCP Tool |
|---------|--------------------------|-------------------|
| Task locking | File-based locks in `current_tasks/` dir | `claim_agent_task` / `release_agent_task` |
| Role specialization | Separate agents for dedup, perf, docs, quality | `assign_agent_role` (7 predefined roles) |
| Context pollution prevention | Minimal output, log to files, pre-compute stats | `log_context_budget` |
| Oracle testing | GCC as known-good compiler oracle | `run_oracle_comparison` |
| Agent orientation | READMEs and progress files for fresh sessions | `get_parallel_status` |
| Time blindness | `--fast` 1-10% random sampling of tests | Built into `log_context_budget` best practices |

### Workflow for this repo

When running parallel agents on this codebase:

1. Each agent calls `get_parallel_status` first to orient
2. Each agent calls `assign_agent_role` with a different role
3. Before working: `claim_agent_task({ taskKey: "descriptive_name" })`
4. Track context: `log_context_budget({ eventType: "test_output", tokensUsed: N })`
5. Validate: `run_oracle_comparison({ testLabel: "...", actualOutput: "...", expectedOutput: "...", oracleSource: "prod" })`
6. After work: `release_agent_task({ taskKey: "...", status: "completed", progressNote: "..." })`

### Anti-patterns to avoid (from blog)

- Two agents working on the same bug (always claim first)
- Dumping thousands of lines of test output into context (log to file, print summary)
- Spending hours stuck on one problem (mark as blocked, move on)
- Overwriting each other's changes (commit frequently, pull before push)
- Not maintaining progress files (fresh agents waste time re-orienting)

### Delta debugging pattern

When tests pass individually but fail when combined:
1. Split the test set in half
2. Test each half
3. Narrow down to the minimal failing combination
4. Assign each failing pair to a different parallel agent

### MCP Prompts available

- `parallel-agent-team` -- Full team setup with role assignment and task breakdown
- `oracle-test-harness` -- Oracle-based testing setup for any component

### Bootstrap for External Repos

When nodebench-mcp is connected to another project that lacks parallel agent capabilities, it can auto-detect and scaffold everything:

```
bootstrap_parallel_agents({ projectRoot: "/path/to/their/repo", dryRun: true })
```

Scans 7 categories using real filesystem access:
1. Task coordination (lock dirs, claim files)
2. Role specialization (role configs, AGENTS.md mentions)
3. Oracle testing (golden files, snapshots)
4. Context budget tracking
5. Progress files (PROGRESS.md, STATUS.md, claude-progress.txt)
6. AGENTS.md parallel section
7. Git worktrees

If gaps found, run with `dryRun: false` to scaffold `.parallel-agents/` directory with lock dirs, progress.md, roles.json, oracle dirs, and a portable AGENTS.md section.

Use `generate_parallel_agents_md` to produce a standalone, framework-agnostic parallel coordination protocol that works with any AI agent (Claude, GPT, etc.) and any tech stack (TypeScript, Python, Rust).

The AI Flywheel closed loop: **detect -> scaffold -> verify (6-step flywheel) -> fix -> document**

### Claude Code Native Parallel Path

For Claude Code users, parallel subagents are already built-in via the `Task` tool. NodeBench MCP adds coordination on top of that:

1. **COORDINATOR (main session):** Break work into independent tasks
2. **SPAWN:** Each `Task` tool call creates a subagent. Include in its prompt:
   - `claim_agent_task({ taskKey: "task_name" })` — lock the task
   - `assign_agent_role({ role: "implementer" })` — specialize
   - Do the work
   - `release_agent_task({ taskKey: "task_name", progressNote: "..." })` — handoff
3. **MONITOR:** Main session calls `get_parallel_status()` to see all subagent activity
4. **GATE:** Main session runs `run_quality_gate` on the aggregate result

Use the `claude-code-parallel` MCP prompt for step-by-step guidance.

### When to use parallel tools vs not

**USE parallel tools when:**
- Running 2+ agent sessions (Claude Code subagents, worktrees, separate terminals)
- Need to prevent two agents from working on the same thing
- Want oracle-based testing to split failures into independent work items
- Bootstrapping parallel infrastructure for an external project

**DO NOT USE when:**
- Single agent working sequentially — standard verification/eval tools are sufficient
- Task is simple enough for one agent end-to-end
- Not in a multi-agent or multi-session context

`findTools` now contextually filters parallel tools: they only appear when the query includes parallel/agent/team keywords, or when explicitly requesting `category: "parallel_agents"`.

### Impact

- 10 new tools in `parallel_agents` category (8 core + 2 bootstrap)
- 1 new methodology: `getMethodology("parallel_agent_teams")` with `claudeCodeNativePath` and `impactPerStep`
- 4 new MCP prompts: `parallel-agent-team`, `oracle-test-harness`, `bootstrap-parallel-agents`, `claude-code-parallel`
- 4 new DB tables: `agent_tasks`, `agent_roles`, `context_budget_log`, `oracle_comparisons`
- Comparative benchmark Scenario 9: parallel agent coordination (from real Claude Code usage)
- Version 2.0.0 (72 tools total)

**→ Quick Refs:** `parallelAgentTools.ts` (10 tools), `claude-code-parallel` prompt in `index.ts`, `parallel_agent_teams` methodology in `metaTools.ts`

## Impact-Driven Methodology

Every NodeBench MCP tool call, methodology step, and workflow path must answer: **"What concrete thing did this produce?"**

This principle applies to:
- **Tool recommendations:** `findTools` only surfaces tools relevant to the current query context
- **Methodology steps:** Each step in `getMethodology` now includes expected concrete output
- **Parallel tools:** Only recommended when the user is actually doing multi-agent work
- **Documentation:** Every section ties back to measurable outcomes

### Comparative Benchmark (9 Real Scenarios)

`comparativeBench.test.ts` validates impact across 9 real production prompts:

| Metric | Bare Agent | MCP Agent |
|--------|-----------|-----------|
| Issues detected | 0 | 13 (4 HIGH, 8 MEDIUM, 1 LOW) |
| Recon findings | 0 | 21 |
| Risk assessments | 0 | 9 |
| Test layers | 9 (1x) | 27 (3x) |
| Integration failures caught | 0 | 4 |
| Regression eval cases | 9 | 22 |
| Quality gate rules | 0 | 52 |
| Gate violations blocked | 0 | 4 |
| Knowledge entries | 0 | 9 |
| Blind spots prevented | 0 | 26 |

Scenario 9 specifically tests parallel agent coordination — "I launched 3 Claude Code subagents... they keep overwriting each other's changes" — demonstrating that task locking, progress files, and context budget tracking prevent real coordination failures.

**→ Quick Refs:** `comparativeBench.test.ts` (9 scenarios, 20 tests), `AI_FLYWHEEL.md` (impact table), `metaTools.ts` (`impactPerStep` in parallel_agent_teams)

---

## Toolset Gating & Presets (NodeBench MCP Local)

NodeBench MCP exposes 10 themed presets that control which domain toolsets are loaded at startup. Agents select a preset via `--preset <name>` on the CLI. Meta tools (`findTools`, `getMethodology`, `check_mcp_setup`) and discovery tools (`discover_tools`, `get_tool_quick_ref`, `get_workflow_chain`) are always included on top of any preset — they are never gated.

**→ Quick Refs:** `packages/mcp-local/src/index.ts` (PRESETS map, parseToolsets, CLI subcommands), `--preset default|web_dev|research|data|devops|mobile|academic|multi_agent|content|full`, `TOOLSET_MAP` (39 domain keys), `createMetaTools` + `createProgressiveDiscoveryTools` (always-on), `getHookHint` (auto-save + attention refresh hooks), `getToolComplexity` in toolRegistry.ts (model-tier routing), `embeddingProvider.ts` (Agent-as-a-Graph bipartite search), `--no-embedding` flag, MCP annotations in tools/list

### 10 Presets

| Preset | Domains | Tools | Use Case |
|--------|---------|-------|----------|
| **default** | 8 (verification, eval, quality_gate, learning, flywheel, recon, security, boilerplate) | **54** | Core AI Flywheel — verification, eval, quality gates, learning, recon |
| **web_dev** | +ui_capture, vision, web, seo, git_workflow, architect, ui_ux_dive, ui_ux_dive_v2, mcp_bridge, pr_report | **106** | Web projects — visual QA, SEO audit, git workflow, PR reports, code architecture |
| **research** | +web, llm, rss, email, docs | **71** | Research workflows — web search, LLM calls, RSS feeds, email, docs |
| **data** | +local_file, llm, web | **78** | Data analysis — CSV/XLSX/PDF/JSON parsing, LLM extraction, web fetch |
| **devops** | +git_workflow, session_memory, benchmark, pattern, pr_report | **68** | CI/CD & ops — git compliance, session memory, benchmarks, pattern mining, PR reports |
| **mobile** | +ui_capture, vision, flicker_detection, ui_ux_dive, ui_ux_dive_v2, mcp_bridge | **95** | Mobile apps — screenshot capture, vision analysis, flicker detection |
| **academic** | +research_writing, llm, web, local_file | **86** | Academic papers — polish, review, translate, logic check, data analysis |
| **multi_agent** | +parallel, self_eval, session_memory, pattern, toon | **83** | Multi-agent teams — task locking, messaging, roles, oracle testing |
| **content** | +llm, critter, email, rss, platform, architect | **73** | Content & publishing — LLM, accountability, email, RSS, platform queue |
| **full** | all 39 domains | **218** | Everything — all toolsets for maximum coverage |

All presets include 6 always-on meta/discovery tools + 6 dynamic loading tools on top of domain tools.

### Always-On Discovery Tools

Every preset includes these 6 tools regardless of configuration — they are the agent's front door:

| Tool | Purpose |
|------|---------|
| `findTools` | Keyword search across all registered tools (even those not loaded) |
| `getMethodology` | Load step-by-step methodology for a topic (mandatory_flywheel, parallel_agent_teams, etc.) |
| `check_mcp_setup` | Diagnostic wizard — checks env vars, API keys, optional deps across all domains |
| `discover_tools` | 14-strategy hybrid search with cursor pagination (`offset`/`hasMore`/`totalMatches`), result expansion (`expand` adds `relatedTools` neighbors at 50% parent score), and `explain` mode |
| `get_tool_quick_ref` | Quick ref card with multi-hop BFS traversal (`depth` 1-3) — follows `nextTools` + `relatedTools` edges, returns `hopDistance` and `reachedVia` per discovered tool |
| `get_workflow_chain` | Get a complete step-by-step tool sequence for a workflow (fix_bug, new_feature, etc.) |

**Self-escalation pattern**: An agent started with `--preset default` uses `discover_tools` to find tools in other presets, then requests a restart with `--preset web_dev`, `--preset full`, or targeted `--toolsets` flags to unlock the required capabilities.

**Multi-hop discovery**: `get_tool_quick_ref({ tool_name: "run_recon", depth: 2 })` follows both `nextTools` (workflow-sequential) and `relatedTools` (conceptual adjacency) edges via BFS. depth=2 discovers 24-40 additional tools beyond direct neighbors. All 215 tools have auto-populated `relatedTools` (949 total connections, 191% amplification over 498 `nextTools`, 90% cross-domain, 0% overlap with `nextTools`).

**Pagination**: `discover_tools({ query: "verify", limit: 5, offset: 5 })` returns page 2 with stable `totalMatches` across pages. `hasMore` flag indicates whether more pages exist.

### CLI Usage (MCP Server)

```bash
# Default preset (54 tools) — core AI Flywheel
npx nodebench-mcp

# Themed presets
npx nodebench-mcp --preset web_dev       # Web development (106 tools)
npx nodebench-mcp --preset research      # Research workflows (71 tools)
npx nodebench-mcp --preset data          # Data analysis (78 tools)
npx nodebench-mcp --preset devops        # CI/CD & ops (68 tools)
npx nodebench-mcp --preset full          # Everything (218 tools)

# Fine-grained: pick specific toolsets
npx nodebench-mcp --toolsets verification,eval,recon

# Fine-grained: exclude specific toolsets from full
npx nodebench-mcp --exclude vision,ui_capture,parallel
```

### CLI Subcommands (Human-Friendly Demo)

Try NodeBench's discovery layer directly — no MCP client needed:

```bash
# Search for tools by intent
npx nodebench-mcp discover "security audit"

# Check which domains are configured
npx nodebench-mcp setup

# List all 28 workflow recipes, or show a specific one
npx nodebench-mcp workflow list
npx nodebench-mcp workflow security_audit

# Get tool info + graph neighbors (multi-hop BFS)
npx nodebench-mcp quickref run_recon --depth 2

# Call any tool directly (JSON output, pipeable to jq)
npx nodebench-mcp call search_all_knowledge --args '{"query": "security", "limit": 3}'
```

All subcommands respect `--preset` and `--no-embedding` flags. Output is color-formatted on TTY, clean text when piped.

### Escalation Path

```
default (54 tools) → web_dev/research/data/... (68-106 tools) → full (218 tools)
     │                        │                                        │
     │                        │                                        └── All 39 domains
     │                        └── Default + themed domain tools
     └── Verification + eval + flywheel + recon + security + boilerplate
```

When `discover_tools` returns nothing useful, or a tool says "not configured":
1. **Escalate preset**: Switch to a themed preset (`web_dev`, `research`, `data`) or `--preset full`
2. **Resolve providers**: Configure missing API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, etc.)
3. **Run setup check**: `npx nodebench-mcp setup` to see which domains need configuration
4. **Bootstrap infra**: Run `scaffold_nodebench_project` or `bootstrap_parallel_agents` if repo lacks infra
5. **Smoke-test**: Re-run the first workflow chain step to confirm the capability is available

### TOOLSET_MAP Domain Keys (39)

| Domain Key | Source File | Tools |
|-----------|------------|-------|
| verification | verificationTools.ts | 8 |
| eval | evalTools.ts | 6 |
| quality_gate | qualityGateTools.ts | 4 |
| learning | learningTools.ts | 4 |
| flywheel | flywheelTools.ts | 4 |
| recon | reconTools.ts | 7 |
| ui_capture | uiCaptureTools.ts | 2 |
| vision | visionTools.ts | 4 |
| local_file | localFileTools.ts | 19 |
| web | webTools.ts | 2 |
| github | githubTools.ts | 3 |
| docs | documentationTools.ts | 4 |
| bootstrap | agentBootstrapTools.ts | 11 |
| self_eval | selfEvalTools.ts | 9 |
| parallel | parallelAgentTools.ts | 13 |
| llm | llmTools.ts | 3 |
| security | securityTools.ts | 3 |
| platform | platformTools.ts | 4 |
| research_writing | researchWritingTools.ts | 8 |
| flicker_detection | flickerDetectionTools.ts | 5 |
| figma_flow | figmaFlowTools.ts | 4 |
| boilerplate | boilerplateTools.ts | 2 |
| benchmark | cCompilerBenchmarkTools.ts | 3 |
| session_memory | sessionMemoryTools.ts | 3 |
| gaia_solvers | localFileTools.ts (gaiaMediaSolvers) | 6 |
| toon | toonTools.ts | 2 |
| pattern | patternTools.ts | 2 |
| git_workflow | gitWorkflowTools.ts | 3 |
| seo | seoTools.ts | 5 |
| voice_bridge | voiceBridgeTools.ts | 4 |
| critter | critterTools.ts | 1 |
| email | emailTools.ts | 4 |
| rss | rssTools.ts | 4 |
| architect | architectTools.ts | 3 |
| ui_ux_dive | uiUxDiveTools.ts | 11 |
| mcp_bridge | mcpBridgeTools.ts | 5 |
| ui_ux_dive_v2 | uiUxDiveToolsV2.ts | 14 |
| skill_update | skillUpdateTools.ts | 4 |
| pr_report | prReportTools.ts | 3 |

### Lightweight Hooks (Auto-Save + Attention Refresh)

The tool dispatch path includes two inline hooks that append `_hint` reminders to tool responses:

| Hook | Trigger | Reminder |
|------|---------|----------|
| Auto-save | 2+ consecutive `web_search`/`fetch_url` calls without `save_session_note` | "Consider calling save_session_note to persist findings" |
| Attention refresh | Every 30 tool calls | "Consider calling refresh_task_context to reload your bearings" |

Hooks never block — they only append text hints to the response `content` array.

### Model-Tier Complexity Routing

Each tool has a recommended model complexity tier (`low`/`medium`/`high`) for cost-aware routing:

| Tier | Model | Example tools |
|------|-------|---------------|
| `low` | Haiku | `log_gap`, `record_learning`, `save_session_note`, `fetch_url` |
| `medium` | Sonnet | `start_verification_cycle`, `run_recon`, `web_search` |
| `high` | Opus | `compare_eval_runs`, `grade_agent_run`, GAIA solvers, `check_contract_compliance` |

Use `getToolComplexity("tool_name")` from `toolRegistry.ts`. 3-tier fallback: per-tool override → entry field → category default → medium.

### Embedding Search & Agent-as-a-Graph (v2.15.0)

Tool discovery uses a **bipartite knowledge graph** (arxiv:2511.18194) with neural embeddings for true semantic search. The graph has two node types: **tool nodes** (individual tools) and **domain nodes** (category aggregates). When a domain node matches a query, all sibling tools in that domain get a boost via upward traversal.

**Provider fallback** (mcp-local): Local HuggingFace `Xenova/all-MiniLM-L6-v2` (384-dim, 23MB INT8, zero API keys) → Google `text-embedding-004` (768-dim, free) → OpenAI `text-embedding-3-small` (1536-dim). Convex-mcp uses Google → OpenAI only (16 tools doesn't justify local model).

**Scoring**: Type-conditioned weighted Reciprocal Rank Fusion (wRRF) per the paper's Equation 3:
- `α_T = 1.0` (tool weight — direct embedding match)
- `α_D = 1.5` (domain weight — upward traversal boost)
- `K = 60` (RRF smoothing constant)
- Max contribution at rank 1: tool ≈ 16pts, domain ≈ 25pts

These parameters were validated via a 6-config ablation grid (see `tools.test.ts`). Key finding: K and α_D are coupled — K=60 dampens enough for α_D=1.5 to lift gently. K=20 with α_D=1.5 overshoots.

**14 search strategies** in `hybridSearch`: keyword, fuzzy, n-gram, prefix, semantic (synonym families), TF-IDF, regex, bigram, domain cluster boost, dense, embedding tool_rrf, embedding domain_rrf, graph traversal (trace edges), execution trace co-occurrence.

**8 search modes**: hybrid, fuzzy, regex, prefix, semantic, exact, dense, embedding.

**CLI**: `--no-embedding` disables neural embeddings (search falls back to lexical-only).

**Cache**: `~/.nodebench/embedding_cache.json` (mcp-local), `~/.convex-mcp-nodebench/embedding_cache.json` (convex-mcp). Invalidated via FNV-1a corpus hash.

**Transitive co-occurrence**: `getCooccurrenceEdges(toolName, { transitive: true })` infers A→C from A→B + B→C edges with 15-edge cap (vs 10 for direct-only). Separate cache key prevents collisions.

**`relatedTools` auto-derivation**: `computeRelatedTools()` uses 5 strategies — same-category siblings, DOMAIN_CLUSTERS neighbors, 2+ tag overlap, 1-tag overlap fallback, same-phase last resort — capped at 7 per tool. Populates all 215 entries at load time.

**→ Quick Refs:** `embeddingProvider.ts` (provider fallback, cache, cosine KNN), `toolRegistry.ts` (wRRF block, `_setWrrfParamsForTesting`, `computeRelatedTools`, `_populateRelatedTools`, `getCooccurrenceEdges` transitive mode), `progressiveDiscoveryTools.ts` (`discover_tools` pagination + expansion handler, `get_tool_quick_ref` BFS traversal handler), `index.ts` (`initEmbeddingIndex` background init, `relatedTools` in embedding corpus text)

### MCP Annotations (v2.15.0)

The `tools/list` handler returns MCP 2025-11-25 spec `annotations` for each tool:

```json
{
  "name": "start_verification_cycle",
  "annotations": {
    "title": "start verification cycle",
    "category": "verification",
    "phase": "audit",
    "complexity": "medium"
  }
}
```

This enables MCP hosts to display category badges, sort by phase, and route to model tiers based on complexity.

### Critter Tool (v2.15.0)

The `critter_check` tool is an intentionality checkpoint — "the accountability partner that wants to know everything." It scores agent responses against 10 checks for circular reasoning, vague audience, empty rationale, deference patterns, buzzwords, hedging, and repetitive padding. Verdicts: proceed (≥70), reconsider (40-69), stop (<40). In the `core` preset. Persists to SQLite `critter_checks` table.

**→ Quick Refs:** `critterTools.ts` (10 checks, v2 calibrated scoring), `critterCalibrationEval.ts` (19 scenarios, 100% pass)
