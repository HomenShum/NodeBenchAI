# NodeBench AI

Entity intelligence for any company, market, or question.

**Live:** [nodebenchai.com](https://www.nodebenchai.com)  
**npm:** `npx nodebench-mcp` / `npx nodebench-mcp-power` / `npx nodebench-mcp-admin`  
**Workspace MCP (atomic edits, 12 tools):** [`packages/mcp-nodebench-workspace/`](packages/mcp-nodebench-workspace/README.md)  
**GitHub:** [HomenShum/nodebench-ai](https://github.com/HomenShum/nodebench-ai)

---

## Try It Now — 60-second walkthrough

For first-time visitors, hackathon attendees, or anyone wanting to see the
system work end-to-end. Anonymous, no signup required.

1. **Open** [nodebenchai.com/?surface=workspace](https://www.nodebenchai.com/?surface=workspace).
   A *Temporary workspace* banner shows your anonymous session id.
2. **Pick a model** — click the model badge in the composer footer. Default
   is **Nemotron 3 Super 120B** (free, NodeBench leaderboard rank #2 by raw
   score, **#1 by reliable score** — clean 0-error sweep on the 8-query bench).
   The picker shows score / pass-rate / errors / latency per model so you can
   compare quality vs speed vs reliability.
3. **Capture something messy** — paste a meeting note like:
   `Met Priya from Acme Bio at SciCon. AI lab notebooks with Benchling integration. Looking for early users in pharma R&D.`
4. **Watch atomic edits fire** — within ~5–30s the agent persists 4–8
   structured side effects to your workspace ledger (entity captures, claims
   with `verified` / `needs_review` / `rumor` status, source attachments, graph
   edges, follow-ups). They render as inline run-update chips on the agent
   turn.
5. **Try the prompt enhancer** — type a vague prompt, click the ✨ Sparkles
   icon next to the textarea. Kilo Code-style — small fast free model rewrites
   it with workspace context + acceptance criteria in ~3s for $0.
6. **Reload the page** — captures persist (Convex-backed, scoped by anon
   session id). Click **Claim workspace →** in the banner to sign in with
   Google. Convex Auth migrates `anon:<sessionId>` → `user:<userId>` so the
   workspace becomes cross-device.

**Cost protection:** every anon session is capped at 60 calls / 10 min and
$0.50 / hour cumulative paid spend. Free models are unmetered cost-wise. After
hitting a cap, the agent returns `ok: false, errorMessage: "rate_limit: ..."`
— the user just picks a free model and continues.

**For hackathon organizers:** [`HACKATHON_DAY0.md`](HACKATHON_DAY0.md) covers
pre-flight checks, multi-user verification, expected cost ranges, sharing one
workspace across browser + Cursor / Claude Desktop, and troubleshooting.

---

## Product

NodeBench is a research and reporting product built around five user-facing
surfaces:

- `Home` = start quickly
- `Reports` = reusable memory
- `Chat` = do the work
- `Inbox` = captures, nudges, alerts, automations, and unassigned review
- `Me` = operator context and control

Deep research opens in the separate Workspace surface at `nodebench.workspace`;
it is not a sixth tab in the operating app.

The core idea is simple:

users do not just need a chatbot that answers once.

They need a system that can:

- take a question, file, URL, or prior thread
- search and synthesize with sources
- turn the run into a reusable artifact
- watch for meaningful change later
- improve the next run from what it learned

## What Shipped

**Recently shipped (April 2026 — hackathon-ready):**

- live agent in chat composer — `convex/domains/product/chatAgent.ts`
  exposes `runChatAgent` action that calls pi-ai → OpenRouter, handles
  tool calling (5 atomic-edit primitives + multi-turn loop), persists
  user + agent turns to `productActivityLedger` with full telemetry
- Kilo-Code-style auto-router — per-model 60s cooldown registry
  (bounded LRU map, ≤64 entries), capability filter
  (`TOOL_CAPABLE_PREFIXES`), free-first ranked fallback chain
  (Nemotron 3 Super → Ling 2.6 → GLM 4.5 Air → Hunyuan 3 → kimi-k2.6
  paid)
- prompt enhancer — `enhancePrompt` action rewrites vague prompts
  with workspace context (active entity, pinned context) using a fast
  free model (~3s, $0). UI: ✨ Sparkles button next to composer
- benchmark-aware ModelPicker — 12 models with leaderboard rank,
  pass / partial / fail / error counts, latency per row. Default = the
  highest-reliable-score free model from the 16-model leaderboard
- multi-tenancy + cost protection — every product table carries
  `ownerKey`, every action gates through `requireProductIdentity`. Per-
  session rate limit (60 calls / 10min) + cost ceiling ($0.50 / hour)
  enforce honest backpressure (HONEST_STATUS — return `ok: false`, no
  silent drops)
- `nodebench-mcp-workspace` MCP server — 12 tools (5 atomic edits +
  5 read tools + 2 workflow/delivery tools), Zod-validated, 30s timeout,
  ERROR_BOUNDARY wrapped. Lets Claude Desktop / Cursor / Windsurf share
  the same workspace as the browser via `NODEBENCH_ANON_SESSION_ID`
- model leaderboard pipeline — `scripts/eval/model-leaderboard/`
  ranks free + paid LLMs on a fixed 8-query NodeBench eval set. 16-
  model free-tier sweep + comparative paid kimi-k2.6 results published
- live-Convex eval runner — `scripts/eval/nodebench-loop/liveRunner.ts`
  exercises real `recordActivity` round-trips so judge can score
  notebook-correctness + export-correctness from real side effects, not
  agent text alone

**Foundational (already shipped):**

- five-surface web app across `Home`, `Reports`, `Chat`, `Inbox`, and `Me`
- separate deep-work Workspace shell at `nodebench.workspace`
- typed search and reporting pipeline
- live SSE streaming with saved runtime state
- Convex-backed product state for sessions, reports, entities, nudges, files,
  and related objects
- shared-context handoff and delegation plumbing
- local and deployed server runtime for search, streaming, voice, and shared
  context routes
- `nodebench-mcp`, `nodebench-mcp-power`, and `nodebench-mcp-admin`
  distribution lanes
- builder-facing Oracle, dogfood, eval, replay, and control-plane
  infrastructure

## Product At A Glance

```text
USER SURFACES
-------------
Home      -> start quickly
Reports   -> reusable report memory
Chat      -> answer, sources, trace, follow-ups
Inbox     -> captures, nudges, automations, alerts, unassigned items
Me        -> operator context, permissions, controls

BACKEND
-------
Convex tables and product state for sessions, reports, entities, nudges,
files, shared context, and evaluation artifacts

RUNTIME
-------
search pipeline
  -> answer packet
  -> saved report
  -> tracked entity / tracked theme / follow-up task
  -> nudge or prep brief
  -> resumed chat or reopened report

COMPOUNDING LOOP
----------------
question
  -> answer
  -> saved report
  -> watch item
  -> useful nudge
  -> better next run

DISTRIBUTION
------------
nodebenchai.com
nodebench.workspace
nodebench-mcp
nodebench-mcp-power
nodebench-mcp-admin
```

## Event Intelligence Serving Model

Event serving extends the same budgeted search route used by the main app and
MCP runtime. NodeBench treats search as a memory-building operation with a
budget. For events, NodeBench checks the event corpus and workspace memory
before live search, then persists useful results as entities, claims, sources,
and workspace context.

The event flow is:

```text
Before event
  -> build event corpus

During event
  -> capture messy notes instantly

After event
  -> turn captures into report, cards, follow-ups, and reusable memory
```

The product model is:

```text
Event corpus + live capture + post-event intelligence workspace
```

Event corpus and capture data stay separated:

- `Shared event corpus` = public event info, speakers, sponsors, company pages,
  sessions, and public source cache.
- `Private captures` = what a user personally heard, wrote, recorded, or
  photographed.
- `Team/org memory` = shared only inside the fund, company, or workspace.
- `Event aggregate insights` = opt-in or anonymized only.

During the event, most captures should hit the event corpus first and avoid paid
search:

```text
voice memo / text / screenshot
  -> captureRouter
  -> active event corpus
  -> entity and claim extraction
  -> active event session attachment
  -> budget policy
  -> ack + next action
```

Example mobile ack:

```text
Saved to Ship Demo Day session
Detected 1 person | 1 company | 2 claims | 1 follow-up
Using event corpus | 0 paid calls
```

After the event, the report opens in `nodebench.workspace`:

```text
Brief      -> post-event memo
Cards      -> people, companies, products, themes
Notebook   -> raw notes, transcripts, screenshot OCR, cleaned notes
Sources    -> field notes, public evidence, verification status
Chat       -> follow-up questions and deeper refreshes
Map        -> graph view later
```

The canonical spec lives in
[EVENT_INTELLIGENCE_SERVING_MODEL.md](./docs/architecture/EVENT_INTELLIGENCE_SERVING_MODEL.md).

## Why This Design

NodeBench is designed around a few product realities:

1. A useful answer should not disappear after one chat turn.
2. Saved work should become reusable memory, not a dead archive row.
3. The product should bring the user back only when something meaningful
   changes.
4. The system should gradually learn how the user works without forcing a heavy
   onboarding flow.
5. Operator context should improve future runs without turning the system into
   corporate-speak or fake-agreeable sludge.

That drives the current design:

- answer-first execution
- advisor mode by design via dynamic routing:
  - fast executive lane for routine work
  - deeper advisor lane for ambiguity, planning, and harder reasoning
  - similar in spirit to Claude Code's official `opusplan` split:
    stronger planning lane, cheaper execution lane
- saved artifacts as first-class objects
- visible sources and traceability
- a five-page loop instead of five unrelated tabs
- future `Harness v2` work focused on specification, operator context, and
  compounding behavior

Plain English:

```text
NodeBench should not spend the most expensive reasoning path on every request.
It should move fast by default, then go deeper when the task, evidence, or user
request justifies it.
```

The detailed implementation, verification, and evaluation plan for this mode
lives in:

- [HARNESS_V2_PROPOSAL.md](./docs/architecture/HARNESS_V2_PROPOSAL.md)
- [HARNESS_V2_BUILD_PLAN.md](./docs/architecture/HARNESS_V2_BUILD_PLAN.md)

## How The Five Pages Compound

NodeBench should not feel like five separate destinations.

The intended product behavior is:

```text
Home
  -> start quickly

Reports
  -> turn that artifact into reusable memory

Chat
  -> do the work
  -> create the first useful artifact

Inbox
  -> triage captures, nudges, automations, alerts, and unassigned items

Me
  -> improve how the next run is handled

Workspace
  -> open deep Brief / Cards / Notebook / Sources / Chat / Map work
  -> lives at nodebench.workspace, not in the operating tab bar

Next Home or Chat run
  -> starts with more context than before
```

The shortest version of the compounding loop is:

```text
question
  -> answer
  -> saved report
  -> watch item
  -> useful nudge
  -> better next run
```

Plain-English artifact flow:

```text
input
  -> answer packet
  -> saved report
  -> tracked entity / tracked theme / follow-up task
  -> nudge or prep brief
  -> resumed report or resumed chat
  -> user correction or confirmation
  -> updated operator context
  -> better next run
```

What each page contributes:

- `Home` starts the run with the least friction possible
- `Reports` turns those into a durable report the user can reopen, refresh, and
  reuse
- `Chat` creates the answer, sources, trace, entities, and next actions
- `Inbox` collects nudges, captures, automations, alerts, and unassigned items
- `Me` stores the operator context that improves the next answer
- `Workspace` owns recursive cards, notebook editing, source verification, and
  long-lived intelligence memory

## Current Legacy Infrastructure

NodeBench is not starting from zero. The repo already contains a substantial
legacy stack that works today.

Current legacy foundation:

- five-surface web product
- Convex-backed canonical data layer
- local and deployed server runtime
- harness v1 planning and execution path
- shared-context handoff and delegation support
- MCP distribution lanes
- builder-facing evaluation and control-plane systems

What that means:

- the problem is not missing architecture
- the problem is product behavior, workflow compression, and clearer
  cross-surface compounding

## Roadmap

The near-term goal is:

```text
keep the working legacy foundation
remove accidental complexity
add specification-aware operator context
ship one clear compounding workflow
```

Main tasks still to finish:

- [ ] make `Home -> Reports -> Chat -> Inbox -> Me` behave like one continuous
      workflow instead of five adjacent surfaces
- [ ] turn harness v1 into the clearer v2 shape described in
      [HARNESS_V2_PROPOSAL](docs/architecture/HARNESS_V2_PROPOSAL.md)
- [ ] ship `Layer 0` operator context so the system can learn useful workflow
      patterns without forcing a heavy onboarding flow
- [ ] support permissioned transcript ingestion from NodeBench chats first, then
      optional external logs such as Claude Code JSONL transcripts for
      `nodebench-mcp`
- [ ] add style-drift guardrails so the system learns judgment and workflow
      without overfitting to corporate voice, filler, or sycophancy
- [ ] add anticipatory prep behavior so the system can prepare the user before
      important interactions, not only answer after the fact
- [ ] make saved reports behave like reusable memory, not storage
- [ ] keep `Nudges` as an Inbox section with at least one working daily trigger
- [ ] make `Me` clearly improve future runs by exposing what context is being
      used and why
- [ ] finish the `nodebench-mcp` v3 cut-and-split plan so default runtime,
      power runtime, and admin runtime are clearly separated
- [ ] instrument real latency, real cost, real artifact completion, and real
      reuse across both web and MCP flows
- [ ] keep README, runtime behavior, and exposed tool counts in sync so the
      public story matches the actual system
- [ ] keep dogfood, eval, and builder-control infrastructure as internal
      leverage instead of letting it leak into the main user-facing product

## Quick Start

### Web app

Open [nodebenchai.com](https://www.nodebenchai.com) and start in `Home`.

### MCP

```bash
# Claude Code
claude mcp add nodebench -- npx -y nodebench-mcp

# Claude Code power lane
claude mcp add nodebench-power -- npx -y nodebench-mcp-power

# Claude Code admin lane
claude mcp add nodebench-admin -- npx -y nodebench-mcp-admin

# Cursor
npx nodebench-mcp --preset cursor

# Generic MCP client
npx nodebench-mcp
```

### Local development

```bash
git clone https://github.com/HomenShum/nodebench-ai.git
cd nodebench-ai
npm install
cp .env.example .env.local

# Frontend + Convex + voice server
npm run dev

# Production build
npm run build
```

## Architecture

```text
nodebenchai.com (React + Vite + Tailwind)
    |
Convex Cloud (sessions, reports, entities, nudges, files, product state)
    |
server runtime + search pipeline + SSE
    |
answer packet
    |
saved report
    |
tracked entities / watch conditions / nudges
    |
future runs with better operator context
```

## Student Learning Lessons

The notebook and diligence stack in this repo are a good example of a common
product engineering tradeoff:

- the best user experience is one notebook that feels continuous
- the safest current runtime is still layered and block-addressable underneath

For NodeBench, that means:

- `founder` is a trait and diligence block, not a permanent sixth tab
- diligence should use one generic pipeline, not many narrow `*Identify.ts`
  features
- the runtime should stay `scratchpad-first -> structuring pass ->
  deterministic merge`
- user-owned prose should feel local-first and calm while typing
- live agent output should arrive as overlays or decorations first, not as
  direct document mutations
- accepted agent output should become frozen, user-owned notebook content
- provenance should stay available, but secondary to the reading and writing
  flow

Why the notebook does **not** use one giant live editor model yet:

- collaboration is more reliable when the system can address bounded sections
- provenance, evidence, and contribution logs need stable attachment points
- background agent updates should not compete with user keystrokes
- deterministic section-level merge is easier to reason about than whole-page
  mutation churn

The practical rule in this repo is:

```text
UX should feel monolithic.
Runtime should stay layered.
Typing should be local-first.
Agent output should be overlay-first.
Accepted output should become owned prose.
```

Current notebook refactor lessons:

- hide the block machinery from the reading path
- keep chrome quiet and move metadata to hover or focus
- isolate the notebook surface from page-level re-render churn
- favor one memoized notebook boundary over many inline object props
- treat live diligence as read-only reference overlay until the user accepts it
- when accepted, materialize a frozen notebook snapshot with explicit provenance
- anchor live overlays at the notebook surface, not inside the first editable row
- let Convex projection rows carry real source metadata so the UI is not forced to reconstruct trust state from prose alone
- use one generic projection producer for overlays: report save writes the same structured rows that page-load backfill and manual refresh re-run
- when moving beyond report-backed overlays, stream raw scratchpad only in a secondary rail and emit structured projection rows on checkpoint rather than dumping scratchpad prose into the notebook body
- if checkpoint structure comes from an LLM, keep it block-scoped and schema-bound: `scratchpad checkpoint -> JSON -> validation/repair -> deterministic fallback -> projection row`
- let the model structure intermediate JSON, but keep merge, persistence, and notebook ownership deterministic
- ship generic diligence primitives first, then block-specific renderers

For students reading the code, the most relevant docs are:

- [`AGENT_PIPELINE`](docs/architecture/AGENT_PIPELINE.md)
- [`DILIGENCE_BLOCKS`](docs/architecture/DILIGENCE_BLOCKS.md)
- [`SCRATCHPAD_PATTERN`](docs/architecture/SCRATCHPAD_PATTERN.md)
- [`PROSEMIRROR_DECORATIONS`](docs/architecture/PROSEMIRROR_DECORATIONS.md)
- [`SESSION_ARTIFACTS`](docs/architecture/SESSION_ARTIFACTS.md)

The live notebook refactor is deliberately incremental:

- current shipped slices make the notebook feel more continuous and reduce
  per-keystroke render churn
- current shipped slices also move live diligence into notebook-surface
  overlays instead of seeded block-like records and freeze accepted snapshots
- the end state is one notebook experience with layered internals, not a raw
  block UI and not a brittle giant document runtime

### Key tech

- Frontend: React, Vite, TypeScript, Tailwind CSS
- Backend: Convex
- Search: Linkup + Gemini extraction + grounding pipeline
- MCP server: Node.js + TypeScript
- Realtime runtime: SSE + Convex-backed persistence

## API Keys

Set these in `.env.local` for local work or in Convex / Vercel for deployed
environments.

| Key | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | classification, extraction, synthesis |
| `LINKUP_API_KEY` | Recommended | web search and sourced answers |
| `VITE_CONVEX_URL` | Yes | Convex deployment URL |

## Codebase map

Top-3 levels, annotated. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the
pipeline diagram and [`docs/architecture/README.md`](docs/architecture/README.md)
for the 13 canonical architecture docs.

```text
nodebench-ai/
├── README.md                   ← you are here
├── ARCHITECTURE.md             ← top-level pipeline diagram
├── CONTRIBUTING.md             ← contribution bar
├── CLAUDE.md                   ← Claude Code conventions for this repo
├── AGENTS.md                   ← agent methodology + eval bench
├── LICENSE                     ← MIT
│
├── src/                        ← React frontend (Vite)
│   ├── features/               ← feature-first, 30 folders (Home · Reports · Chat · Inbox · Me · Workspace · entities · agents · …)
│   │   └── <feature>/          ← views · components · hooks · lib · __tests__ (colocated)
│   ├── shared/                 ← shared UI primitives, hooks, utils
│   ├── lib/                    ← registry, analytics, error reporting
│   └── layouts/                ← shell + cockpit + public
│
├── server/                     ← Node runtime (Express + MCP gateway)
│   ├── pipeline/               ← agent harness runtime + diligence blocks
│   ├── routes/                 ← HTTP routes (search, harness, founder episodes)
│   ├── mcpGateway.ts           ← WebSocket MCP gateway
│   └── services/               ← shared services
│
├── convex/                     ← Convex backend
│   ├── domains/                ← 19 domain folders (agents · product · research · founder · search · …)
│   ├── schema.ts               ← database schema (includes agentScratchpads)
│   └── crons.ts                ← scheduled jobs
│
├── packages/
│   ├── mcp-local/              ← the published nodebench-mcp npm package (MIT)
│   ├── mcp-client/             ← typed client SDK
│   └── convex-mcp-nodebench/   ← Convex-side MCP auditor
│
├── .claude/
│   ├── README.md               ← map of the .claude/ layout
│   ├── rules/                  ← 31 modular rules with related_ cross-refs
│   ├── skills/                 ← reusable how-to procedures
│   ├── agents/                 ← subagent configs
│   └── commands/               ← custom slash commands
│
├── docs/
│   ├── README.md               ← docs tree map
│   ├── ONBOARDING.md           ← 30-minute new-contributor path
│   ├── architecture/           ← 13 canonical specs + plans/ + README index
│   ├── agents/                 ← agent docs + bootstrap configs
│   ├── guides/                 ← how-to for builders
│   ├── decisions/              ← ADRs
│   ├── changelog/              ← release notes
│   ├── product/                ← product decisions
│   ├── qa/                     ← QA protocols
│   └── archive/                ← superseded content, provenance-only
│
├── tests/
│   ├── e2e/                    ← Playwright end-to-end
│   └── fixtures/               ← shared fixtures
│
├── scripts/                    ← dogfood, eval harness, one-offs
├── public/                     ← static assets served by Vite + Vercel
└── vendor/                     ← third-party references
```

## Related Docs

**For new users / hackathon attendees:**
- [`HACKATHON_DAY0.md`](HACKATHON_DAY0.md) — 60-second attendee guide + organizer pre-flight checklist
- [`docs/architecture/MULTI_TENANCY.md`](docs/architecture/MULTI_TENANCY.md) — identity model (`anon:<sessionId>` vs `user:<userId>`), end-to-end first-landing story, threat model, MCP session-linking patterns

**For builders / contributors:**
[`docs/ONBOARDING.md`](docs/ONBOARDING.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`docs/architecture/README.md`](docs/architecture/README.md)

The 13 canonical architecture docs are organized in 4 tiers. See [`docs/architecture/README.md`](docs/architecture/README.md) for the indexed map:

- **Tier 1 (core pipeline):** [`AGENT_PIPELINE`](docs/architecture/AGENT_PIPELINE.md) · [`DILIGENCE_BLOCKS`](docs/architecture/DILIGENCE_BLOCKS.md) · [`USER_FEEDBACK_SECURITY`](docs/architecture/USER_FEEDBACK_SECURITY.md)
- **Tier 2 (sub-patterns):** [`SCRATCHPAD_PATTERN`](docs/architecture/SCRATCHPAD_PATTERN.md) · [`PROSEMIRROR_DECORATIONS`](docs/architecture/PROSEMIRROR_DECORATIONS.md) · [`AGENT_OBSERVABILITY`](docs/architecture/AGENT_OBSERVABILITY.md) · [`SESSION_ARTIFACTS`](docs/architecture/SESSION_ARTIFACTS.md)
- **Tier 3 (features):** [`FOUNDER_FEATURE`](docs/architecture/FOUNDER_FEATURE.md) · [`REPORTS_AND_ENTITIES`](docs/architecture/REPORTS_AND_ENTITIES.md) · [`AUTH_AND_SHARING`](docs/architecture/AUTH_AND_SHARING.md)
- **Tier 4 (cross-cutting):** [`MCP_INTEGRATION`](docs/architecture/MCP_INTEGRATION.md) · [`EVAL_AND_FLYWHEEL`](docs/architecture/EVAL_AND_FLYWHEEL.md) · [`DESIGN_SYSTEM`](docs/architecture/DESIGN_SYSTEM.md)

Historical specs are preserved in [`docs/archive/2026-q1/`](docs/archive/2026-q1/INDEX.md).

## Production Readiness & Evaluation

NodeBench ships with a comprehensive evaluation harness that proves correctness
across 32+ scenarios, 9 user personas, and 9 feature categories. This is not
hand-wavy "it works" — it is measured, versioned, and reproducible.

### Two-Layer Judge Architecture

Every production run is evaluated by two independent systems:

**Layer 1: Deterministic Boolean Gates** (`server/pipeline/diligenceJudge.ts`)
- 10 strict pass/fail checks: tier validity, latency budget, token tracking,
  source capture, terminal status
- Verdicts: `verified` | `provisionally_verified` | `needs_review` | `failed`
- Zero LLM involvement — pure deterministic validation

**Layer 2: LLM Semantic Scoring** (`server/pipeline/diligenceLlmJudge.ts`)
- 5 dimensions scored [0,1]: prose quality, citation coherence, source
  credibility, tier appropriateness, overall semantic fit
- Prompt version tracking (`llmjudge-v1`) for cohort separation
- Bounded: 30s timeout, 512KB response cap, honest error reporting

This dual-layer approach means hallucinations and quality regressions are
caught by **two independent systems** before they reach users.

### Current Production Status

**Latest Full-Stack Eval:** `2026-04-23T06:46:53Z`

```text
Overall Pass Rate:     100% ✅
LLM Judge Average:     9.6/10 (target: ≥7 for production)
Dogfood Score:         100/100 (0 real issues)
Entity Resolution:     100% ✅
Factual Accuracy:      90.6% ✅
No Hallucinations:     90.6% ✅
Actionable Output:     100% ✅
Answer Control:        100% ✅ (all 8 dimensions)
Feature Breadth:       100% ✅ (31 scenarios)
Retention/Continuity:  4/4 passed ✅
```

All production gates **passing**:
- ✅ Expanded Feature Coverage Production Gate
- ✅ Answer Control Production Gate  
- ✅ Dogfood Production Gate
- ✅ Notebook Capacity Production Gate
- ✅ History Soak Production Gate

**Note:** The only outstanding item is p95 latency optimization (174s vs 90s
target) — a performance enhancement, not a correctness blocker. The system is
**production-ready for all quality scenarios**.

### Evaluation Coverage

**Capability Eval — 32 Persona Scenarios**

| Persona | Example Query | Status |
|---------|---------------|--------|
| JPM Startup Banker | "DISCO — worth reaching out? Fastest debrief" | ✅ 100% |
| Early Stage VC | "OpenAutoGLM — what's the wedge?" | ✅ 100% |
| CTO Tech Lead | "QuickJS — do I have exposure?" | ✅ 100% |
| Enterprise Exec | "Gemini 3 — procurement next step?" | ✅ 100% |
| Ecosystem Partner | "SoundCloud VPN — who benefits?" | ✅ 100% |
| Founder Strategy | "Salesforce Agentforce — counter-positioning?" | ✅ 100% |
| Academic R&D | "RyR2/Alzheimer's — literature anchor?" | ✅ 100% |
| Quant Analyst | "DISCO — extract funding signal" | ✅ 100% |
| Product Designer | "DISCO — schema-dense UI card JSON" | ✅ 100% |
| Sales Engineer | "DISCO — share-ready outbound summary" | ✅ 100% |

**Expanded Feature Breadth — 31 Scenarios**

| Category | Count | Pass Rate |
|----------|-------|-----------|
| Calendar | 3 | 100% ✅ |
| Disclosure | 4 | 100% ✅ |
| Document | 3 | 100% ✅ |
| Hybrid | 4 | 100% ✅ |
| Media | 3 | 100% ✅ |
| Skills | 4 | 100% ✅ |
| Spreadsheet | 3 | 100% ✅ |
| Tools | 4 | 100% ✅ |
| Web | 3 | 100% ✅ |

**Answer Control — 8 Dimensions**

- Entity resolution: 100% ✅
- Retrieval relevance: 100% ✅
- Claim support: 100% ✅
- Final response quality: 100% ✅
- Trajectory quality: 100% ✅
- Actionability: 100% ✅
- Artifact decision quality: 100% ✅
- Ambiguity recovery: 100% ✅

### How to Verify

Run the full production evaluation suite:

```bash
# Full 8-phase evaluation (typecheck → build → capability → expanded →
# answer-control → dogfood → notebook → history)
npm run eval

# Quick verification (3 scenarios)
npm run eval:quick-slice

# Individual lanes
npm run eval:capability      # 32 persona scenarios
npm run eval:feature-breadth # 31 feature scenarios  
npm run eval:retention       # Wiki continuity suite
```

All artifacts are versioned in `docs/architecture/benchmarks/`:
- `full-stack-eval-latest.md` — aggregate summary
- `comprehensive-eval-*.md` — capability results
- `expanded-eval-*.md` — feature breadth results
- `product-answer-control-eval-*.md` — answer control results

### What "Production Ready" Means Here

1. **Deterministic gates pass** — no regressions in core correctness
2. **LLM judge scores ≥7** — semantic quality validated by independent LLM
3. **Dogfood score ≥85** — internal usage shows no real issues
4. **All 32 persona scenarios pass** — diverse user types handled correctly
5. **All 31 feature scenarios pass** — broad surface area covered
6. **Retention/continuity passes** — long-term memory works
7. **Answer control 100%** — artifact decisions, ambiguity recovery solid

The system meets all of these. The only remaining work is latency optimization
— making fast answers even faster, not making broken answers work.

### Model Strategy

- **Primary:** `moonshotai/kimi-k2.6` (OpenRouter) — 100% capability pass
- **Fallback:** `gpt-5.4` — automatic retry on empty/missing debrief
- **Judge:** `kimi-k2.6` — 9.6/10 average across all scenarios

Kimi is the primary lane. GPT-5.4 remains the safety fallback until Kimi's
first-attempt stability improves, but both paths are production-tested.

## Product Suite

```text
NodeBench AI   = flagship user surface
nodebench-mcp  = workflow lane
Attrition.sh   = measured replay + optimization lane
```

Attrition is not a third flagship. It is the measurable optimization lane for
the same NodeBench workflow.

## License

MIT
