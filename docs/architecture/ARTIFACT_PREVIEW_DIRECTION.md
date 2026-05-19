# Artifact Preview Direction

First-principles design direction for how chat-generated artifacts become
live-rendered, editable, previewable extensions of the entity graph.

## The chain

```
Chat conversation
  → Agent gathers local context + public web context
    → Generates a report / analysis / visual artifact
      → Artifact is an HTML/JS bundle (like home-v3.html)
        → Preview renders inline in chat as thumbnail
          → Click expands to split-pane or full-screen live preview
            → Notebook editor makes the artifact code-editable
              → Edits re-render the preview in real-time
```

## Why this direction

### What we already have
1. **Chat thread** — agent researches entities, extracts signals, produces narratives
2. **Reports surface** — entity cards with scores, signals, coverage status
3. **Notebook editor** — TipTap-based rich text editor in the Workspace surface
4. **Entity graph** — d3 force layout showing relationships between entities
5. **Prototype HTML files** — `public/proto/home-v3.html` proves we can build
   rich, interactive views as standalone HTML/JS bundles

### What's missing
The gap between "agent produced an insight" and "user can see/edit/share
a rendered artifact" is currently filled by static text. The agent writes
prose. The user reads prose. But the agent could produce **rendered artifacts**
— visual, interactive, shareable — that are one level deeper than text.

### The insight
**An artifact is a one-level-deeper extension of the entity graph.**

- Entity: Anthropic → Report: coverage memo → Artifact: interactive pricing
  comparison chart (HTML/JS)
- Entity: OpenAI vs Anthropic → Report: competitive analysis → Artifact:
  side-by-side feature matrix with live data (HTML/JS)
- Entity: Portfolio → Report: daily brief → Artifact: dashboard with
  signal timeline and coverage heatmap (HTML/JS)

The artifact inherits context from its parent entity/report. It's not a
generic code file — it's a contextual visualization of structured data
the agent already gathered.

## What we're NOT building

- **Not a full VM or isolated sandbox.** No Docker, no WebContainers, no
  StackBlitz-style environments. The constraint is intentional.
- **Not arbitrary code execution.** Artifacts are HTML + CSS + vanilla JS
  bundles. No build step, no npm, no framework compilation.
- **Not a general-purpose IDE.** The notebook editor handles these specific
  artifact bundles, not arbitrary codebases.

This constraint keeps the system lightweight, fast, and auditable. A single
HTML file with inline styles and scripts is inspectable, shareable, and
renders identically everywhere.

## The preview pattern

### In chat thread (inline)

After the agent produces an artifact, the changes block shows it:

```
┌──────────────────────────────────────────────┐
│ ✎  1 entity updated, 1 artifact created      │
│     +3 signals  +1 visual                    │
│                          [Dismiss] [Preview] │
├──────────────────────────────────────────────┤
│ [ent] Anthropic        +3 signals -1 expired │
│ [vis] pricing-comparison.html       created  │
└──────────────────────────────────────────────┘
```

Below the changes block, an inline preview thumbnail renders:

```
┌──────────────────────────────────────────────┐
│  ┌────────────────────────────────────────┐  │
│  │  [rendered thumbnail, ~200px tall]     │  │
│  │  Interactive pricing comparison        │  │
│  │  Anthropic vs OpenAI vs Mistral        │  │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  │
│  └────────────────────────────────────────┘  │
│  Live preview · pricing-comparison.html      │
│  [Split pane]  [Full screen]  [Edit]         │
└──────────────────────────────────────────────┘
```

Design: thin 1px `var(--line-faint)` border, no chrome, rendered pixels
only. Label below in 9px mono. Mute, minimal, exquisite.

### Side panel (on click)

The artifact panel slides in from the right as a resizable side panel.
Chat content remains visible on the left. User drags the handle to
adjust width (20–85%). Code editor toggles above preview:

```
┌─────────────────────────┬─┬─────────────────────────┐
│                         │ │ ← Back  vis  pricing-.. │
│   [Chat content stays   │◄│ [✎ Code] [Discard] [Save│
│    visible and reflows] │ ├─────────────────────────┤
│                         │ │ ┌─ Editor (toggle) ───┐ │
│   Messages, changes     │ │ │ <div class="chart">  │ │
│   block, composer all   │ │ │   ...                │ │
│   remain accessible     │ │ └─────────────────────┘ │
│                         │ ├─────────────────────────┤
│                         │ │ ┌─ Live preview ──────┐ │
│                         │ │ │ Anthropic  $0.168/1K │ │
│                         │ │ │ OpenAI     $0.200/1K │ │
│                         │ │ │ Mistral    $0.150/1K │ │
│                         │ │ │ ████████████████     │ │
│                         │ │ └─────────────────────┘ │
└─────────────────────────┴─┴─────────────────────────┘
                          ▲
                    drag handle
```

Default: preview only fills the panel. "Code" button toggles
editor above preview in a stacked vertical layout.

### Full screen

Same layout but takes the full viewport. Escape or back button returns
to chat. The artifact URL is shareable — renders standalone without
the editor chrome.

## How the notebook connects

The existing TipTap notebook editor in the Workspace surface can host
artifact blocks. A notebook about Anthropic might contain:

1. Rich text analysis (existing)
2. Embedded artifact: `<artifact src="pricing-comparison.html" />`
3. More rich text with interpretation

The artifact block renders as an inline preview in read mode, and
expands to the split-pane editor in edit mode. This makes the notebook
a hybrid document — prose + live visualizations.

## Context gathering for artifact generation

When the agent generates an artifact, it draws from:

### Local context (already gathered)
- Entity data (fields, signals, coverage status)
- Report history (previous memos, diffs over time)
- User's notebook content (existing analysis, annotations)
- Session context (what was discussed in chat)

### Public web context (gathered on demand)
- Competitor pricing pages (for comparison artifacts)
- Industry benchmarks (for positioning charts)
- News/signal feeds (for timeline artifacts)
- Design inspiration references (for layout patterns)

This is exactly what we do now when building prototypes — the agent
searches for inspiration, gathers references, and synthesizes them into
an HTML artifact. The difference is making this a first-class product
feature rather than a developer workflow.

## Artifact types (expanded from research)

See `docs/architecture/ARTIFACT_TYPES_RESEARCH.md` for full taxonomy
(15 types with data sources and scale justifications).

| Type | Badge | Scale | Description |
|------|-------|-------|-------------|
| `comparison` | vis | 2-10 | Side-by-side entity comparison matrix |
| `timeline` | vis | 1-N | Signal/change timeline with d3 |
| `matrix` | vis | 2-10 | Feature/capability matrix |
| `dashboard` | vis | 1-N | Multi-metric overview |
| `tiering` | vis | 50-5000 | Portfolio classification grid |
| `heatmap` | vis | 100+ | Coverage depth across dimensions |
| `landscape` | vis | 10-50 | Competitive bubble chart (BCG/McKinsey) |
| `sankey` | vis | N | Funding/capital flow diagram |
| `network` | vis | N | Entity relationship force graph |
| `scorecard` | doc | 1 | Diligence scorecard (print-ready) |
| `briefing` | doc | portfolio | Weekly intelligence dashboard |
| `classifier` | vis | 50-5000 | User-pasted policy applied to entities |
| `memo` | doc | 1 | Formatted coverage memo (print-ready) |
| `decay` | vis | 1-N | Signal strength decay sparkline |

All are HTML + CSS + JS bundles. No build step. The agent generates
them; the user edits them; the preview renders them.

### Prototype artifact inventory (5 implemented in home-v3.html)

| Artifact file | Type | Strip visual | Content |
|---------------|------|-------------|---------|
| `pricing-comparison.html` | comparison | bar-chart | 3-card pricing grid (Anthropic $0.168, OpenAI $0.200, Mistral $0.150) |
| `feature-matrix.html` | matrix | heatmap | 7-row QA comparison table (Bug0 vs NodeBench vs Selenium vs Playwright) |
| `signal-decay.html` | decay | sparkline | 10-day signal coverage decay chart + 5 claim statuses (Stale/Active/Fading) |
| `signal-timeline.html` | dashboard | timeline-dot | Multi-entity daily brief: 4 metric cards + 8-row cross-entity signal feed |
| `portfolio-tiering.html` | tiering | (chat inline) | Portfolio classification: 2,847 entities across 5 sectors × 3 tiers with applied policy |

The portfolio-tiering artifact demonstrates the highest-scale use case from
the artifact types table — classifying thousands of entities against a
user-pasted tiering policy. The policy box shows the classification criteria;
the sector × tier grid shows counts + named entities per cell; the summary
stats show distribution. This artifact type connects entity reports to
portfolio-level analysis, bridging the gap between single-entity artifacts
(comparison, matrix, decay) and cross-entity artifacts (dashboard, tiering).

### Card strip visual vocabulary

Four CSS-only mini-visualization types for report card artifact strips.
Each renders without an iframe — pure CSS shapes.

| Strip type | CSS class | Use case |
|------------|-----------|----------|
| `bar-chart` | (default `.v3-artifact-strip-vis`) | Horizontal bars for comparison |
| `timeline-dot` | `.v3-artifact-strip-vis--timeline` | Positioned dots for temporal data |
| `heatmap` | `.v3-artifact-strip-vis--heatmap` | 6-col grid of colored cells |
| `sparkline` | `.v3-artifact-strip-vis--sparkline` | Vertical micro-bars for trends |

### Live data protocol (postMessage)

Artifacts receive data from the host app via `window.postMessage`:

```
Parent (NodeBench app):
  iframe.contentWindow.postMessage({ type: 'init', entities, metadata })
  iframe.contentWindow.postMessage({ type: 'update', entityId, signals })

Artifact (sandboxed HTML):
  window.addEventListener('message', handler)
```

Works with sandboxed iframes, no CORS, sub-millisecond latency, no build
step. Artifact can also request specific data back from the host.

## Technical implementation path

### Phase 1: Preview thumbnail in chat (prototype HTML)
- Add `chat-preview` component after changes block
- Render artifact in a sandboxed iframe (srcdoc or blob URL)
- Thumbnail: 680px wide, 200px tall, `overflow: hidden`, `pointer-events: none`
- Click area below with "Open" action (opens resizable side panel)

### Phase 2: Split-pane review panel
- Extend `chat-review` panel with two-column layout
- Left column: `<textarea>` with the HTML source (syntax-highlighted via CSS)
- Right column: `<iframe>` rendering the artifact
- On textarea change: debounce 300ms → update iframe srcdoc
- Save writes back to the artifact file

### Phase 3: Notebook integration
- Add artifact block type to TipTap editor schema
- Inline preview in read mode (same iframe pattern)
- Click-to-edit opens the split-pane editor
- Artifact files stored alongside notebook in entity directory

### Phase 4: Agent-generated artifacts
- New tool: `generate_artifact(entitySlug, type, context)`
- Agent gathers local + web context, produces HTML bundle
- Bundle includes inline data (no external fetches needed to render)
- Artifact appears in chat changes block + inline preview

### Phase 1b: Report card artifact strips (prototype HTML)
- Cards with associated artifacts show a `v3-artifact-strip` between body
  and footer
- Four visual types, all CSS-only, no iframe overhead:
  1. **bar-chart** — horizontal colored bars (comparison artifacts,
     e.g. `pricing-comparison.html`)
  2. **timeline-dot** — positioned dots along a horizontal axis with one
     active node highlighted (signal timelines, e.g. `signal-timeline.html`)
  3. **heatmap** — 6-column CSS grid of colored cells showing feature
     coverage depth (matrix artifacts, e.g. `feature-matrix.html`)
  4. **sparkline** — vertical micro-bars declining left-to-right showing
     signal decay or trend (decay artifacts, e.g. `signal-decay.html`).
     Red status dot instead of green when data is stale.
- Strip footer: green live dot + artifact filename + `vis` type badge
- Click opens the artifact in side-panel mode on the chat surface
- Cross-surface navigation: strip click saves origin, back button restores

### Phase 1c: Resizable side panel (prototype HTML)
- **Single mode**: artifact panel slides in from the right as a side panel.
  Default width 50%, min 320px, max 85% of `.chat-main`.
- **Chat reflow**: `.chat-main` content remains visible alongside the panel.
  No fullscreen overlay mode — the user controls width via drag handle.
- **Drag-to-resize**: a 6px handle on the left edge of the panel. Drag
  adjusts `--artifact-panel-width` CSS custom property (clamped 20–85%).
  Double-click toggles between 50% and 85%.
- **Code toggle**: always visible in header. Toggles editor above preview
  in a stacked vertical layout (`grid-template-rows: 2fr 3fr`).
- **No mode toggle or fullscreen button.** The user achieves full-width
  by dragging the handle to 85%. This replaces the split/fullscreen
  duality with a single continuous interaction.

### Cross-surface navigation: origin surface restoration
When an artifact is opened from a non-chat surface (e.g., clicking an
artifact strip on a report card in the Gallery view), the system:

1. Saves the current surface as `data-origin-surface` on the panel
2. Calls `switchSurface('chat')` to show the chat column
3. Opens the artifact panel

On close (back button or Escape):

1. Reads `data-origin-surface` from the panel
2. If set, calls `switchSurface(origin)` to restore the previous view
3. Removes the attribute

This ensures the back button always returns the user to where they
came from. Opening from chat clears any stale origin, so closing
from chat stays on chat. Drag-to-resize preserves the origin
across width adjustments.

**Anti-pattern avoided:** hard-coding the back destination or always
returning to chat. The origin must be captured at navigation time and
restored at close time — same principle as browser history pushState.

## Design constraints

- **Mute, minimal, exquisite, elegant, silent yet informative**
- Preview thumbnail: no chrome, no toolbar, just rendered pixels + 9px label
- Split pane: thin divider, no drag handle, fixed 50/50 split
- Editor: monospace, minimal line numbers, no minimap
- All transitions: 280ms cubic-bezier(0.16, 1, 0.3, 1)
- Respect `prefers-reduced-motion`: skip transitions
- Dark mode native: `var(--paper)` background in iframe too

## Prior art

- **Parity Studio** (github.com/HomenShum/parity-studio) — split-pane
  editor + preview for UI kit generation. Key pattern: the preview IS
  the artifact, not a simulation of it.
- **Claude Code** — Preview/Diff/Terminal/Files panel tabs. Key pattern:
  the right panel is contextual to what the agent just did.
- **Claude Artifacts** — inline rendered HTML/React in chat. Key pattern:
  the artifact appears naturally in the conversation flow.
- **Observable notebooks** — code cells + rendered output interleaved.
  Key pattern: the notebook IS the artifact, not a container for it.
- **Notion embeds** — inline preview of external content. Key pattern:
  preview thumbnail that expands on interaction.

## Relationship to entity graph

```
Entity (Anthropic)
  ├── Report (Coverage Memo)
  │   ├── Signals (3 new)
  │   ├── Sources (5 verified)
  │   └── Artifact (pricing-comparison.html)  ← NEW
  ├── Report (Competitive Analysis)
  │   └── Artifact (feature-matrix.html)      ← NEW
  └── History (signal timeline)
      └── Artifact (timeline-viz.html)        ← NEW
```

Artifacts are leaf nodes in the entity graph. They inherit context from
their parent entity and report. They're generated by agents, edited by
users, and rendered as live previews.

## What this enables

1. **Show, don't tell** — Agent produces a rendered visualization, not
   just prose about what the data says
2. **Edit in context** — User refines the artifact without leaving the
   notebook or chat
3. **Share the artifact** — The HTML bundle is self-contained and
   shareable as a URL
4. **Progressive depth** — Chat shows thumbnail → click for split pane
   → click for full screen → open in notebook for deep editing
5. **Agent + human collaboration** — Agent generates v1, human edits to
   v2, agent sees edits and learns preferences

---

*Documented 2026-05-14. First-principles direction, not a build spec.
Implementation starts at Phase 1 (preview thumbnail in chat prototype).*
