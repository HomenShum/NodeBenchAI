# Agent Trace Architecture — Three-Tier DAG

The agent trace is the connective tissue between Chat, Reports, and Artifacts.
A single agent run produces chat messages, entity updates, and generated artifacts —
the trace shows HOW those outputs were produced.

---

## Three-Tier Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│  TIER 1: OUTPUT NODES (the DAG)                                 │
│  What the agent produced. This is the top-level view.           │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │ Anthropic     │──▶│ pricing-     │──▶│ IC memo      │        │
│  │ entity +3sig  │   │ comparison   │   │ created      │        │
│  └──────┬───────┘   └──────────────┘   └──────────────┘        │
│         │                                                       │
│  ┌──────┴───────┐   ┌──────────────┐                           │
│  │ 3 stale      │──▶│ Weekly       │                           │
│  │ reports found │   │ digest ready │                           │
│  └──────────────┘   └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  TIER 2: PHASES (expand a node)                                 │
│  The stages of work that produced each output.                  │
│                                                                 │
│  Anthropic entity +3 signals:                                   │
│  ┌──────────┐ → ┌──────────────┐ → ┌──────────┐ → ┌─────────┐ │
│  │ Research  │   │ Cross-ref    │   │ Extract  │   │ Verify  │ │
│  │ 1.2s     │   │ 0.8s         │   │ 1.4s     │   │ 0.8s    │ │
│  └──────────┘   └──────────────┘   └──────────┘   └─────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  TIER 3: TOOL CALLS (expand a phase)                            │
│  The specific tools called within each phase.                   │
│                                                                 │
│  Research phase:                                                │
│    ▸ source_scan · 5 entities · 48 sources · 0.4s              │
│    ▸ web_search · "Anthropic pricing" · 12 results · 0.8s      │
│    ◦ cost: $0.01 · tokens: 2,400 in / 180 out                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## DAG Node Types

| Node type | Icon | Color | Links to | Example |
|-----------|------|-------|----------|---------|
| Entity update | ● entity initial | green border | Report card (split pane) | "Anthropic entity +3 signals" |
| Artifact created | ◆ vis badge | terracotta border | Artifact preview (split pane) | "pricing-comparison.html" |
| Document created | ✎ doc icon | terracotta border | Document editor (split pane) | "IC memo: Anthropic Tier Analysis" |
| Alert triggered | ⚠ alert icon | amber border | Alert card in chat | "Competitive alert: Bug0 pricing" |
| Digest ready | ★ star icon | blue border | Digest panel (split pane) | "Weekly digest: 5 entities, 14 signals" |
| Error/partial | ✗ error icon | red border | Error detail in chat | "2/5 refreshes failed" |
| Data export | ↓ export icon | muted border | Download or code block | "Exported 5 entities as JSON" |
| Graph context | ● graph icon | purple border | Graph view (split pane) | "34 reports · 13 visible · clustered" |

---

## Cross-Surface Connection Model

```
  ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
  │    CHAT      │        │   REPORTS    │        │  ARTIFACTS   │
  │              │        │              │        │              │
  │  .chat-step  │◀──────▶│ Entity card  │◀──────▶│ Preview panel│
  │  .chat-msg   │        │ .report-card │        │ #review-*    │
  │              │        │              │        │              │
  └──────┬───────┘        └──────┬───────┘        └──────┬───────┘
         │                       │                       │
         └───────────┬───────────┴───────────┬───────────┘
                     │                       │
              ┌──────┴───────┐        ┌──────┴───────┐
              │  TRACE DAG   │        │  TRACE DAG   │
              │  (panel)     │        │  (fullscreen) │
              └──────────────┘        └──────────────┘
```

### Navigation rules

| From | Click | Opens in |
|------|-------|----------|
| Trace DAG node (entity) | "Open report →" | Split pane: Reports entity card |
| Trace DAG node (artifact) | "Preview →" | Split pane: Artifact preview panel |
| Trace DAG node (alert) | "View alert →" | Scrolls chat to the alert message |
| Chat `.chat-changes` block | "View trace" | Opens trace DAG panel |
| Report entity card | "View run trace" | Opens trace DAG panel |
| Artifact panel header | "View provenance" | Opens trace DAG panel filtered to this artifact |

### Split pane behavior (consistent with existing pattern)
- Trace panel + linked surface share the viewport (same as chat + artifact preview)
- Cross-surface links use `data-artifact-open` pattern already implemented
- Closing the linked surface returns focus to the trace panel
- Escape closes the linked surface first, then the trace panel

---

## Live Streaming Behavior

### Node states

| State | Visual | Behavior |
|-------|--------|----------|
| `pending` | Muted outline, no fill | Not started yet |
| `active` | Pulsing border, phase steps streaming in | Currently executing |
| `complete` | Solid fill, green checkmark | Done, output available |
| `error` | Red border, ✗ icon | Failed, error detail available |
| `partial` | Amber border, warning icon | Partial success (e.g., 3/5 refreshed) |

### Streaming protocol
1. Run starts → DAG skeleton appears with `pending` nodes (the plan)
2. Orchestrator fans out → nodes transition to `active` in parallel
3. Tool calls stream within active nodes (Tier 3 appears live)
4. Node completes → transitions to `complete`, cross-surface link becomes clickable
5. All nodes complete → trace persists for review, "View summary" appears

### Animation budget
- Max 1 pulsing node border at a time (the currently active node)
- Tool call text appears via CSS `animation: fadeIn 150ms ease`
- Duration bars grow via `transition: width 100ms linear`
- `prefers-reduced-motion` → static badges, no pulse, instant text appearance

---

## React Flow Implementation Plan

### Node components (custom React Flow nodes)

```typescript
// Tier 1: Output node
type OutputNode = {
  id: string;
  type: 'output';
  data: {
    label: string;
    outputType: 'entity' | 'artifact' | 'document' | 'alert' | 'digest' | 'error' | 'export';
    status: 'pending' | 'active' | 'complete' | 'error' | 'partial';
    meta: string;          // "+3 signals · -1 expired"
    surfaceLink?: {        // cross-surface navigation
      surface: 'reports' | 'artifacts' | 'chat';
      target: string;      // entity slug, artifact key, or message ID
    };
    phases?: Phase[];      // Tier 2 (rendered on expand)
  };
};

// Tier 2: Phase (rendered inside expanded output node)
type Phase = {
  name: string;            // "Research", "Cross-reference", "Verify"
  status: 'pending' | 'active' | 'complete' | 'error';
  durationMs: number;
  tools: ToolCall[];       // Tier 3
};

// Tier 3: Tool call (rendered inside expanded phase)
type ToolCall = {
  tool: string;            // "source_scan", "web_search"
  args: string;            // "5 entities · 48 sources"
  status: 'ok' | 'error';
  durationMs: number;
  cost?: number;
  tokens?: { in: number; out: number };
};
```

### Edge types

| Edge | Style | Meaning |
|------|-------|---------|
| Data flow | Solid, directed arrow | Output A feeds into Output B |
| Dependency | Dashed, directed arrow | B waited for A to complete |
| Fan-out | Solid, from orchestrator | Parallel execution branches |
| Fan-in | Solid, to merger node | Parallel branches merge |

### Layout

- **dagre** layout algorithm (built into React Flow) for automatic DAG positioning
- Horizontal flow: left → right (matches temporal reading)
- Parallel branches stack vertically
- Minimap in bottom-right for complex runs
- Zoom controls: fit-to-view, zoom-in, zoom-out

---

## Prototype Mapping (home-v3.html)

In the static prototype, the trace panel is a simplified vertical DAG:

| Prototype element | Maps to React Flow |
|-------------------|-------------------|
| `.trace-node` | Custom React Flow node |
| `.trace-edge` (CSS border-left) | React Flow edge |
| `.trace-phase` (collapsible) | Phase accordion inside node |
| `.trace-tool` (list item) | Tool call row inside phase |
| `.trace-link` button | Cross-surface navigation via split pane |
| `.trace-node--active` pulse | React Flow node with animated border |

### Existing chat elements that feed the trace

| Chat element | Trace tier | DAG node |
|-------------|-----------|----------|
| `.chat-changes` with title | Tier 1 | Output node |
| `.chat-step` with `▸` | Tier 3 | Tool call |
| `.chat-step` with `◦` | Tier 2 | Phase summary |
| `.ar-msg--alert` | Tier 1 | Alert output node |
| `.chat-partial-result` | Tier 1 | Error/partial output node |
| `.chat-code-block` | Tier 1 | Data export output node |
| `.chat-schedule` | Tier 1 | Monitor output node |

---

## Data Flow Example (from the prototype chat)

The existing chat conversation maps to this trace DAG:

```
[Context: 5 entities, 48 sources, 312 claims]
    │
    ├──▶ [source_scan: 5 entities] ──▶ [3 stale reports found] ──▶ ALERT
    │                                          │
    │                                          ├──▶ [refresh: OpenAI] ✗ rate-limited
    │                                          ├──▶ [refresh: Mistral] ✗ 404
    │                                          └──▶ [refresh: Anthropic, Bug0, DeepMind] ✓
    │
    ├──▶ [Research: Anthropic] ──▶ [Cross-ref: 12 sources] ──▶ [Anthropic +3 signals]
    │         │                                                        │
    │         └──▶ [pricing-comparison.html] ◆ ARTIFACT                │
    │         └──▶ [IC memo: Tier Analysis] ✎ DOCUMENT                 │
    │                                                                  │
    ├──▶ [Compare: Bug0 vs competitors] ──▶ [feature-matrix.html] ◆ ARTIFACT
    │
    ├──▶ [Verify: "Anthropic repriced +40%"] ──▶ [Verification card] ✓
    │
    ├──▶ [Export: 5 entities JSON] ──▶ [Code block] ↓ EXPORT
    │
    ├──▶ [Monitor: Anthropic pricing] ──▶ [Schedule card] ⏱ MONITOR
    │
    └──▶ [Synthesize: 14 signals, 5 entities] ──▶ [Weekly digest] ★ DIGEST
```

---

## Graph Context Resolution — The Agent's Memory Boundary

The graph neighborhood query (`reportGraphNeighborhood.ts`) is a first-class
trace node, not infrastructure hidden from the user. It is the agent's answer
to: "What does NodeBench already know that's relevant?"

### Why it's a trace node

The graph context selection is the most consequential decision the agent makes
before tool fan-out. It determines:
- Which entities enter the context window (token budget)
- Which reports the agent can reference (belief boundary)
- Which sources are available for verification (evidence boundary)
- What the agent does NOT know about (blind spots)

If the user can't see this step, they can't audit the agent's reasoning.

### Trace node structure

```
┌──────────────────────────────────────────────────────┐
│ ● Graph context resolved                       0.2s  │
│   [clustered]  34 reports · 12 sources · 13 visible  │
│                                                       │
│   Neighborhood query ═══════════════════  0.1s        │
│     ▸ report_graph_neighborhood                       │
│       root: AI Infrastructure · limit: 64 · ret: 34  │
│     ▸ scope_metadata                                  │
│       scanned: 33 archive posts · hidden: 21          │
│                                                       │
│   Node promotion ═══════════════════════  0.1s        │
│     ▸ attention_score                                 │
│       13 promoted · 5 entities · 8 reports            │
│     ▸ context_budget                                  │
│       2,400 tokens selected · budget: 4,096           │
└──────────────────────────────────────────────────────┘
```

### contextRef shape (runtime integration)

```typescript
type GraphContextRef = {
  type: "report_graph_neighborhood";
  mode: "focus" | "clustered" | "expanded";
  rootId: string;
  query?: string;
  filters?: Record<string, unknown>;
  scope: {
    returnedReportCount: number;    // 34
    hiddenReportCount: number;      // 21
    scanLimit: number;              // 64
    totalCandidateReports: number;  // 87
    promotedVisible: number;        // 13
    tokenBudgetUsed: number;        // 2400
    tokenBudgetTotal: number;       // 4096
  };
};
```

### Node promotion rule

A node deserves visible attention only if it:
1. **Changes belief** — contradicts or updates existing entity data
2. **Changes priority** — affects urgency of user's current work
3. **Changes next action** — suggests a specific thing to do
4. **Explains other nodes** — provides context for a different visible node
5. **Represents costly uncertainty** — unconfirmed but high-impact

Everything else stays searchable but not visible. The trace records which
rule promoted each node, surfaced as task-relative annotations:
- "Contradicts previous Anthropic valuation data"
- "New funding round may affect your portfolio thesis"
- "Unconfirmed — may require manual verification"

### Human vs agent granularity

Same graph substrate, two rankings:

| Audience | Ranking formula | Presentation |
|----------|----------------|-------------|
| Human | readable + relevant + fresh + diverse + actionable | Reports, briefs, entity pages, evidence drawer |
| Agent | grounded + graph-close + evidence-complete + low-token-cost + action-ready | Retrieval packets with handles, claims, sourceRefs |

### Scale tiers (from projection analysis)

| Logical nodes | Visible browser nodes | Agent context nodes | Rendering strategy |
|---------------|----------------------|--------------------|--------------------|
| 0-200 | 13-50 | 20-100 | Current React/SVG |
| 200-1,000 | 13-50 (server-clustered) | 20-100 | Server clustering + label culling |
| 1,000-10,000 | 13-120 (viewport budget) | 50-200 | Sigma.js / WebGL |
| 10,000+ | 50-120 (precomputed layouts) | 100-500 | Cosmograph-style + search-first |

### Research-backed thresholds

| Dimension | Finding | Source |
|-----------|---------|--------|
| Working memory | 4±1 independent chunks | Cowan (2001) |
| Cluster size | 3-5 items per group | Gobet & Simon (1998) |
| Pre-attentive processing | <200ms for color/size/shape | Healey & Enns (2012) |
| Node-link superiority | <50 visible nodes | Ghoniem et al. (2005) |
| Disclosure tiers | 3 max for mainstream users | Krug (2014) |
| Curiosity gap | Quantified gaps 2-3x more effective | Golman & Loewenstein (2018) |
| 5-second test | Clustered view must be processable in <5s | Derived from Pirolli (2007) |

---

## Access Points (how the user opens the trace)

1. **Chat header button** — "⊞ Trace" button next to search. Opens trace panel as split-pane overlay.
2. **Chat changes block** — "View trace" link on any `.chat-changes` card. Opens trace panel scrolled to that output node.
3. **Report entity card** — "View last run" context menu item. Opens trace panel filtered to that entity's updates.
4. **Artifact panel header** — "Provenance" tab next to "Code" toggle. Shows the trace path that produced this artifact.

---

## Color & Visual Language

| Element | Color | CSS variable |
|---------|-------|-------------|
| Entity node border | `var(--green)` / `#4ade80` | `--trace-entity` |
| Artifact node border | `var(--accent)` / `#d97757` | `--trace-artifact` |
| Alert node border | `#fbbf24` | `--trace-alert` |
| Error node border | `#ef4444` | `--trace-error` |
| Digest node border | `#60a5fa` | `--trace-digest` |
| Graph context border | `#a78bfa` | `--trace-graph` |
| Active pulse | `var(--accent)` at 30% opacity | `--trace-active` |
| Edge line | `var(--line-faint)` | `--trace-edge` |
| Phase background | `rgba(255,255,255,0.02)` | `--trace-phase-bg` |
| Tool call text | `var(--mono)` font, `var(--ink-faint)` | — |

---

## Human-Agent Dual Graph Interface

The same Convex graph substrate serves two audiences — humans and agents — with
different presentation granularity but shared attention annotations.

### Human layer (how humans see the graph)

The human interacts with the graph through **seven surfaces**, not a raw graph viz:

| Surface | Graph role | What the user sees |
|---------|-----------|-------------------|
| Search result | Entry point | Matched entity card with scent preview (type + signal + count) |
| Report | Filtered list | Reports as cards with status badges, not graph nodes |
| Entity page | Focused subgraph | Entity notebook with related entities as sidebar shelf |
| Daily brief | Cross-entity synthesis | Compiled brief from tracked entities, signals cross-checked |
| Evidence drawer | Source chain | Per-claim citations with verification status |
| Relationship shelf | 1-hop neighbors | Related entities/reports as horizontal card rail |
| Graph peek | On-demand detail | Position-absolute card with full entity details, actions |

The Reports Graph tab is the **only** surface that renders a force-directed layout.
All other surfaces present graph data as filtered lists, cards, and rails —
following the research finding that lists outperform graphs for most tasks.

### Agent layer (how agents see the graph)

Agents interact with the same graph through **retrieval packets** with handles:

```typescript
interface AgentRetrievalPacket {
  nodeId: string;
  type: 'entity' | 'report' | 'artifact' | 'brief' | 'portfolio';
  claims: Array<{ text: string; sourceRef: string; grounded: boolean }>;
  graphNeighbors: string[];       // 1-hop IDs for context expansion
  actionHandles: string[];        // tool names routable from this node
  attentionScore: number;         // 0-100, shared with human layer
  reasonSelected: string;         // task-relative, same text humans see
  tokenCost: number;              // estimated tokens if included in context
}
```

### Node promotion rule (5 criteria)

A node earns visible attention if it satisfies ANY of:

1. **Changes belief** — new evidence contradicts or strengthens a tracked claim
2. **Changes priority** — funding round, pricing shift, leadership change
3. **Changes next action** — term sheet requires decision, signal needs triage
4. **Explains other nodes** — causal/correlation edge to a promoted node
5. **Represents costly uncertainty** — high-impact gap with known remediation path

Annotations use **task-relative language** ("Changes your competitive positioning")
not system internals ("score=92, graphClose=10").

### nodeAttentionScore / reasonSelected

Every node carries an `attentionScore` (0-100) and `reasonSelected` string that
serve both audiences:

- **Human view** (P1 — not yet surfaced): reason text in peek card, subtle
  visual weight on promoted nodes. No overlay chrome — the graph stays clean.
- **Agent view**: same score determines token budget allocation, same reason
  text included in retrieval packet for agent's context awareness

Score tiers:
- 75-100: high-confidence, primary attention — agent includes first
- 50-74: moderate, secondary — agent includes if budget allows
- 0-49: searchable background — agent excludes unless explicitly requested

> **Current state**: data model exists on every node (`attentionScore`,
> `reasonSelected`, `tier`). No UI rendering yet — overlay chrome (rings,
> badges, indicator bar) was prototyped and rejected as unnecessary decoration.
> P1 will surface attention subtly through the existing peek card.

### Three visibility tiers

| Tier | Graph rendering | Examples | Agent behavior |
|------|----------------|----------|---------------|
| **Promoted** (full) | Default rendering | Entities, reports, briefs, high-impact claims | Included in context window |
| **Searchable** (ghost) | Rendered but lower visual weight (P1) | Aliases, tags, source titles, scores, stale nodes | Excluded unless explicitly requested |
| **Agent-only** (hidden) | Not rendered in graph | Tool schemas, scratchpads, cache keys, internal IDs | Available to agent, never shown to human |

> **Current state**: tier data assigned per node. Visual differentiation between
> tiers is a P1 item — will use subtle opacity/weight, not overlay badges.

### Routing table (node type to skill/toolset)

When a human clicks a node, they get an interface (report, notebook, preview).
When an agent selects a node, the `contextRef` routes to a skill/toolset:

| Node type | Human click action | Agent routing |
|-----------|-------------------|---------------|
| Company | Open entity notebook | `notebook`, `report`, `enrichment` skills |
| Report | Open report detail | `regenerate`, `verify_claims` skills |
| Artifact | Open preview panel | `preview`, `edit`, `share` skills |
| Portfolio | Open workbench | `batch_review`, `export`, `re-classify` skills |
| Correlation edge | Show evidence drawer | `judge`, `verify_causal` skills |
| Ambiguous cluster | Show disambiguation UI | `planner`, `ask_scope` skills |
| Source-heavy cluster | Show source list | `verification`, `cross-reference` skills |

### Graph context indicator (deferred)

> **Status**: Prototyped as a visible bar above the graph, rejected as
> unnecessary chrome. The concept (surfacing mode/visible/hidden counts)
> is valid but needs a subtler form — likely integrated into existing
> graph controls or the peek card rather than a standalone bar.

The underlying data (server mode, visible count, hidden count, returned count)
is available from PR #362's bounded neighborhood response and should surface
where it naturally fits — not as a dedicated overlay.

### Connection to the trace

The graph and the trace's "Graph context resolved" node share the
**same underlying contextRef**:

- **Graph tab** (human): sees the neighborhood the agent selected from
- **Trace panel** (agent audit): "I selected 13 nodes using 2,400 of 4,096 token budget"

P1: clicking a graph node could open the trace panel scrolled to the relevant
context node, creating a direct bridge between the human's view
of the graph and the agent's trace of how it used that graph.
