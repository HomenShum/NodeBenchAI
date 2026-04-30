# NodeBench Performance And Product Plan

Last updated: April 30, 2026

## Input

This plan translates performance and product-shape ideas from two Gmail workspace notes into NodeBench terms:

- `engineering-decision-log.md`
- `performance-and-product-principles.md`

Those notes are useful as reference material, not implementation instructions. NodeBench has different surfaces, a Convex-backed runtime, mobile Reports parity, live pipeline workflows, and a separate workspace product. The plan below keeps those constraints intact.

## Working Principle

Treat performance as four related systems:

1. Data shape: what each surface asks Convex or HTTP routes to return.
2. Render shape: how much DOM and editor state a route mounts at first paint.
3. Background shape: what work runs during navigation versus idle time.
4. Product shape: how many decisions the user must understand before acting.

A route can have fast queries and still feel slow if it mounts too many panels, runs background work immediately, or splits one workflow across too many destinations.

## NodeBench Budgets

| Interaction | Target |
| --- | ---: |
| Mobile tab switch after initial load | under 100ms perceived |
| Reports pipeline block first useful paint | under 1.5s on mobile |
| Cached report or entity card open | under 500ms |
| Notebook shell before editor hydration | under 1s |
| Command palette open | under 75ms |
| Source or evidence panel open from cached data | under 500ms |
| Background pipeline refresh | never blocks route navigation |
| Deep research or paid search | explicit background run with progress |

These are product budgets. If a feature cannot meet them, it should be precomputed, deferred, hidden behind an explicit action, or removed from the default route.

## Near-Term Plan

### 1. Add Route-Level Performance Records

Create a tiny client-side route timing buffer, modeled for NodeBench rather than Gmail:

- route id
- surface id
- viewport class
- time to root test id visible
- time to first action visible
- console or page error count
- live Convex warning state

Expose it as `window.__nodebenchPerf` in development and dogfood only. Do not add visible product UI yet.

### 2. Shape Reports Around A Compact Read Model

Reports now carry pipeline launcher, schedules, eval, runs, findings, report cards, notebook detail, and graph workspace paths. The default Reports surface should not recompute or mount all detail structures at once.

Plan:

- Define a compact Reports read model for the first viewport.
- Keep pipeline run detail and stream expansion lazy.
- Keep notebook/editor hydration behind the report detail or notebook tab.
- Track whether each block came from live Convex data, cached Convex data, or local starter data.

### 3. Window Long Lists Before Adding More Rows

Candidate surfaces:

- pipeline runs
- report cards when there are many saved reports
- sources and claims panels
- execution trace ledgers
- MCP ledger rows
- entity graph edge lists

Start with fixed-height windowing where row heights are stable. Use a mature virtualizer only when dynamic heights become necessary.

### 4. Move Background Work To Idle Or Explicit Runs

Pipeline schedules, eval aggregation, dogfood artifact checks, and agent suggestions should not compete with initial route interaction.

Plan:

- Make route entry render from existing data first.
- Use idle callbacks or explicit refresh buttons for heavy recomputation.
- Surface stale state honestly instead of silently blocking on refresh.
- Keep paid or deep research behind approval and progress states.

### 5. Keep The Main IA Constrained

Locked web nav remains:

```text
Home - Reports - Chat - Inbox - Me
```

Workspace remains a separate deployed surface, not a sixth web tab.

Performance work should reinforce that product shape. Add modes, display options, and drill-ins before adding top-level routes.

### 6. Make Actions Contextual, Not Page-Heavy

NodeBench should move repeated operations into a shared action model:

- open sources
- export CRM CSV
- refresh stale sources
- use memory only
- run deep refresh with approval
- attach source to claim
- create follow-up
- open notebook
- resume source chat

The same action should be available from buttons, command palette, graph cards, and notebook affordances when the context supports it.

### 7. Add Measurement To Dogfood Gates

Extend existing dogfood checks with lightweight product-performance assertions:

- mobile Reports first useful block visible under budget
- route has no horizontal overflow
- console has no uncaught errors
- no production fixture fallback warning
- pipeline controls visible without desktop-only affordances
- background work does not block first interaction

Keep Gemini or LLM review optional. Boolean gates should decide pass/fail.

## What Not To Copy

Do not copy Gmail-specific routes, email caches, or Next.js APIs directly. NodeBench is not an inbox app and is not on the same runtime stack.

Do not turn every performance idea into a new abstraction. Add read models and caches only where route timing or dogfood evidence shows repeated work.

Do not create another top-level product surface to solve density. Prefer progressive disclosure inside the locked IA.

## First Suggested Slice

Implement route timing records for the five main web surfaces plus mobile Reports:

1. Add a tiny recorder under `src/lib/performance`.
2. Record route id, viewport class, and first visible root timing.
3. Have dogfood smoke assert mobile Reports reaches the pipeline block under the budget.
4. Document the current baseline before changing data fetching.

This gives NodeBench its own measurement loop before heavier optimization work starts.
