# home-v3.html — Product Review & Hardening Plan

**Date:** 2026-05-17
**Reviewer:** Homen Shum (Founder)
**File:** `public/proto/home-v3.html` (~13,782 lines, ~707 KB)
**Method:** 12 parallel subagent reviews (product UX, layout, Home, Chat, graph, trace, artifacts, a11y, performance, mobile, production architecture, inconsistencies)

---

## Executive Verdict

**home-v3 is no longer just "Reports v3."** It now expresses the core NodeBench loop:

```
Home editorial brief
  -> chat-first composer
    -> mini report memory
      -> report / graph / notebook
        -> chat runtime
          -> trace / artifact provenance
```

**Next move:** Freeze new features. Convert working patterns into production components, contracts, and QA flows.

---

## What Is Strong (Keep Exactly)

| # | Pattern | Why it works |
|---|---------|-------------|
| 1 | Chat-first Home direction | Home = front page of intelligence workspace |
| 2 | Report halo / mini report memory | Communicates "NodeBench already remembers your entities" |
| 3 | Daily Brief as report-like editorial object | Bridges editorial + structured data |
| 4 | Graph hierarchy: entity -> report -> artifact | Right visual graph architecture |
| 5 | Agent trace as connective tissue | Answers "how did the agent produce this?" |
| 6 | Artifact preview / split-pane behavior | Mature state matrix (open/close, hot-swap, resize, keyboard) |
| 7 | Wide mode and normalized layout | Streamlit-style, rails preserved, smart content distribution |
| 8 | Rich chat interaction catalog | 12 display types give NodeBench real product language |

## What NOT to Add Yet

- More graph modes
- More presentation presets
- More chat card types
- More Home modules
- More animation
- More arbitrary visual metrics
- More notebook expansion layers

**The prototype already has enough. Next phase: wire, simplify, test, componentize, persist.**

---

## Review by Subagent (12 sections)

### 1. Product / UX

**Current Home is promising but overloaded.** It has: edition rail, report halo, composer, daily brief, what changed cards, competing views, what to watch table, visual modules, queue, right briefing agent.

**Target first screen:**
```
Mini report memory
  |
Big composer
  |
Daily Brief headline
```

**NOT:** dashboard + report library + editorial + controls + agent rail

Everything else: progressively disclosed.

### 2. Layout / Wide Mode

**Status: DONE.** Canonical layout stabilized:
- Left rail: `200px` | Center: `1fr` | Right rail: `360px`
- Center padding: `24px 32px 60px`
- Normal max-width: `820px` | Wide max-width: `1200px`

**One concern:** `W` shortcut may surprise users. Production should use `Cmd/Ctrl+Shift+W` or visible toggle only. Wide mode should be a saved user preference in Me settings, not just localStorage.

### 3. Home / Report Halo

**Gap:** CSS has advanced `.report-halo-card` + `.halo-dock` design, but actual Home markup uses `.mini-report-card`. Hover dock behavior is partially designed, not fully wired.

**Expected behavior (not yet working):**
```
hover card -> preview summary
click card -> open halo dock or report preview
  Open  -> report page
  Graph -> report graph tab
  Ask   -> chat with report context
```

**Current state:** cards do `switchSurface('reports')` generically. Production needs `openReport(reportId)`.

**Target component:**
```ts
<MiniReportCard
  reportId
  entityUri
  status
  freshness
  onPreview
  onOpenReport
  onOpenGraph
  onAskAboutThis
/>
```

### 4. Chat Runtime

**Chat display types are comprehensive** (12 types). But core runtime still needs to feel live and report-producing.

**Required runtime events (wire these 5 first):**
```
run.started
context.resolved
sources.checked
notebook.patch_ready
report.updated
```

**Do not add more chat card types yet.** Wire these events end-to-end first.

### 5. Agent Trace

**Three-tier model is exactly right:**
```
Tier 1: Output nodes
Tier 2: Phases
Tier 3: Tool calls
```

**Key insight:** Graph context resolution is a first-class trace node. Context selection defines the agent's belief boundary.

**Production enforcement — two modes:**
```
Live mode:  brief checkpoints only
Audit mode: full DAG / waterfall / tool calls
```

### 6. Graph Hierarchy

**Graph model is strong:**
```
entity -> report -> artifact
portfolio -> entity
artifact -- cause/correlate --> artifact
peek card opens report/artifact
```

**Keep it:** on demand, bounded, filtered, card/peek driven. NOT the default navigation surface.

**Risk:** Graph becomes a hairball. Default to lists, not graphs. Graph views scoped to 1-2 hops, pre-filtered.

### 7. Artifact / Presentation

**Artifact split-pane is mature.** Presentation engine turns agent research into slide-like HTML artifacts.

**Keep as:** report-attached outputs.
**Avoid becoming:** a standalone slide generator / second product.

### 8. Accessibility / Interaction

**Remaining concern:** Some Home mini report cards are `<article>` with `onclick`. Production needs:
```
role="button"
tabindex="0"
Enter / Space handling
aria-label
```

**Rule:** No raw `onclick` on non-buttons in production. Use real buttons or React components.

### 9. Performance

**Acceptable for prototype.** File contains:
- 96 function declarations
- 166 addEventListener occurrences
- 36 onclick occurrences

**Production requires componentization** (see Section 11).

### 10. Mobile / Responsive

**Current state:** Desktop-first. Responsive CSS exists, but no full MobileShell / bottom nav.

**P0 mobile flow needed:**
```
Home composer
  -> Chat full screen
    -> Saved report
      -> Report card
        -> Source/entity bottom sheet
```

**Recommendation:** Mobile is a separate pass. Do not retrofit through desktop CSS alone.

### 11. Production Architecture

**Prototype patterns to preserve -> production substrates:**
```
Report halo        -> Convex report query + Typesense search
Daily Brief        -> Convex scheduled action + TipTap renderer
Chat display       -> Runtime event stream + typed display components
Trace              -> Convex traceAuditEntries + run provenance
Graph              -> Convex entity/report/artifact edges
Artifact           -> Convex artifact table + iframe preview
Notebook           -> TipTap editor + Convex storage
```

**Production contracts needed:**
```ts
HomePulse
MiniReportCard
DailyBriefReport
AgentRunTrace
TraceNode / TracePhase / ToolCall
ReportArtifact
EntityGraphNode
NotebookMention
SourceCitation
```

### 12. Inconsistencies Found

| # | Issue | Fix |
|---|-------|-----|
| 1 | Docs say ~10,991 lines / ~580 KB but file is ~13,782 lines / ~707 KB | Add `scripts/audit-home-v3.js` to generate current stats |
| 2 | Score-like patterns remain (`5/6`, `3/6`) despite "no arbitrary scores" | Label as `5 of 6 evidence checks`, not `5/6 Demand-driven confidence` |
| 3 | Halo dock conceptually specified but not fully implemented | Complete hover preview / halo dock flow |
| 4 | Home composer submit is still placeholder | Wire to Chat with context pills |
| 5 | Inbox and Me are lower maturity than Home/Reports/Chat | Do not treat as release-ready until same QA depth |

---

## P0 Fixes (Before Another Design Pass)

### P0-1: Wire Home Composer to Chat
```
User types on Home
  -> switch to Chat
  -> create thread
  -> add context pills from Home/Daily Brief
  -> stream run checkpoints
```

### P0-2: Finish Report Halo Behavior
```
hover card -> preview summary
click card -> open halo dock or report preview
  Open  -> report page (by reportId)
  Graph -> report graph tab (by reportId)
  Ask   -> chat with report context (by reportId)
```

### P0-3: Replace Generic Report Routing
Current: `switchSurface('reports')`
Target:
```js
openReport(reportId)
openReportTab(reportId, "graph")
openChatWithContext(reportId)
```

### P0-4: Add Mobile Shell
```
bottom nav: Home | Reports | Chat | Inbox | Me
composer dock on Home/Chat
bottom sheet for agent/source/entity
single-column reports
```

### P0-5: Convert Interaction Logic to Components
Stop accreting functions into the single HTML file. Generate:
```
component inventory
event inventory
surface inventory
test matrix
```

---

## Sprint Plan (Implementation Sequence)

### Sprint 1: Home -> Chat -> Report Loop
```
Home composer submits
Chat thread opens
Report is created/updated
Mini report card points to actual report
Daily Brief opens as report
```

### Sprint 2: Agent Trace Persistence
```
run.started
context.resolved
tool.called
artifact.created
report.updated
run.completed
```
Persist as real Convex trace rows.

### Sprint 3: Artifact Production Path
```
artifact registry
Convex persistence
iframe preview
save to report
download/share
```

### Sprint 4: Graph Production Path
```
entity -> report -> artifact edges
source/citation edges
report graph query
bounded graph expansion
```

### Sprint 5: Mobile Shell
```
bottom nav
bottom sheets
mobile composer
mobile report cards
mobile chat
```

---

## Final Assessment

home-v3 captures the right product architecture:

> **Chat creates intelligence. Reports preserve it. Daily Brief summarizes it. Graph explains it. Trace proves it. Artifacts present it.**

The most important next step is to make the core path real:

```
Home composer
  -> Chat runtime
    -> report update
      -> notebook/artifact/trace persistence
        -> report card reflects new state
```

Once that works, the UI stops feeling like a beautiful prototype and starts feeling like a real NodeBench product.
