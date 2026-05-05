# NodeBench Redesign — Comprehensive Change Log

**Route:** `/redesign/*` — parallel to the live cockpit at `/`. Scoped via `[data-redesign]` attribute so its tokens never leak into the production cockpit.

**Status:** UI complete · Sprint S1-S4 backend wiring shipped · Sprint S5 schema migration documented and ready to execute.

**Last updated:** 2026-05-05

---

## Why a parallel route

The cockpit at `/` is the live revenue-bearing surface. It must not break.

`/redesign/*` is the entity-intelligence redesign showcase: a clean Notion + Roam + Obsidian + Karpathy + Pitchbook hybrid built on top of the same Convex backend. It uses different design tokens (warm terracotta, Manrope display, JetBrains Mono mono), different layout primitives (`.rd-shell`, `.rd-pane`, `.rd-card`, `.rd-stack`, `.rd-row`), different surface IDs (Home / Reports / Chat / Inbox / Me / Workspace).

Production users don't see it until we promote it. Investors and operators see it via deep link.

---

## Surfaces

| Surface | Route | Pattern | Status |
|---|---|---|---|
| Home | `/redesign` | Bloomberg cover hero + Pitchbook entity feed + Notion-templates situation gallery + style strip | live |
| Reports | `/redesign/reports` | Crunchbase filter bar (Status + Type + View facets with count badges) + compact 3-col card grid + universe sections + bulk action bar | live, wired to `batchAutopilot.queries.getRecentRuns` |
| Reports detail | `/redesign/reports/:reportId` | TipTap notebook with three writers (user / chat / agent) + pending-patch queue + `?focus=zen` URL param | live |
| Chat | `/redesign/chat` | Avatar-based assistant rendering (parity-studio pattern) + sticky batch monitor + structured AnswerPacket + StreamingMarkdown + inline tool-call cards + per-message action toolbar + citation linkage + composer slash/@/paste/drop | live, batch monitor wired to `batchAutopilot.queries.getRecentRuns` |
| Inbox | `/redesign/inbox` | 5 lanes (batch_review / agent_suggestions / captures / watchlist / approvals) + date range filter + multi-select checkboxes + bulk Accept/Reject/Snooze + open-design header-anchored preview actions | live, lanes batch_review + agent_suggestions wired via client-side aggregator over `batchAutopilot` + `pipelineRuns` |
| Me | `/redesign/me` | Personal Context Notebook hero (USER.md sections) + completeness meter + Export USER.md + collapsed Style Profile + Runtime details | live |
| Workspace | `/redesign/workspace` | Existing workspace surface, mounted under redesign shell | live |

---

## Cross-surface primitives

| Primitive | File | Trigger | What it does |
|---|---|---|---|
| Command palette | [src/features/redesign/components/CommandPalette.tsx](../../src/features/redesign/components/CommandPalette.tsx) | `⌘K` / `Ctrl+K` | Linear / Raycast-style spotlight. Navigate / Create / Action / Entity groups. ↑↓ Enter Esc. |
| Shortcuts overlay | [src/features/redesign/components/ShortcutsOverlay.tsx](../../src/features/redesign/components/ShortcutsOverlay.tsx) | `?` key (or palette → "Show all keyboard shortcuts") | 5 groups · 23 shortcuts documented. |
| Toast system | [src/features/redesign/components/Toast.tsx](../../src/features/redesign/components/Toast.tsx) | `showToast({ tone, message, action })` | Info / success / warning / error variants with auto-dismiss + optional action button. |
| Skeleton primitives | [src/features/redesign/components/Skeleton.tsx](../../src/features/redesign/components/Skeleton.tsx) | `<Skeleton.Block />` / `Card` / `Row` | Reduced-motion-safe shimmer placeholders for loading states. |

All four mounted at the redesign shell ([src/features/redesign/RedesignShell.tsx](../../src/features/redesign/RedesignShell.tsx)) so every surface gets them.

---

## Chat redesign deep-dive

The chat route went through the most iteration. Final feature set:

| Feature | Component | Notes |
|---|---|---|
| Pre-stream thinking indicator | [ChatThinking.tsx](../../src/features/redesign/components/ChatThinking.tsx) | Pulsing avatar + dots + cycling phases ("Routing to model… → Reading sources… → Drafting answer…"). |
| Inline tool-call cards | [ChatToolCall.tsx](../../src/features/redesign/components/ChatToolCall.tsx) | Replaces hidden trace `<details>`. 5 cards rendering with classify_query / build_context_bundle / web_search / llm_extract / assemble_response. |
| Per-message action toolbar | [MessageActions.tsx](../../src/features/redesign/components/MessageActions.tsx) | Copy / Regenerate (with tier override menu) / Pin claim / Branch / Why? / 👍 / 👎. |
| Citation `[N]` ↔ Evidence linkage | inline in [ChatSurface.tsx](../../src/features/redesign/surfaces/ChatSurface.tsx) | `[1]` chips hover-link to evidence row #1 (highlight + accent ring + scroll-into-view). |
| Streaming markdown | [StreamingMarkdown.tsx](../../src/features/redesign/components/StreamingMarkdown.tsx) | Block-level: paragraphs / h1-h3 / ul / ol / fenced code / blockquote / mermaid placeholder. Inline: bold / italic / inline-code / links / images. Typewriter caret + reduced-motion fallback. |
| Code block syntax highlighting | inside `StreamingMarkdown.tsx` | Lightweight regex tokenizer for js/ts/py/sh/json. No external dependency. |
| Inline image rendering | inside `StreamingMarkdown.tsx` | `![alt](src)` markdown → `<img>` with caption + lazy loading. |
| Composer slash menu | [UniversalComposer.tsx](../../src/features/redesign/components/UniversalComposer.tsx) | `/diligence`, `/compare`, `/check-source`, `/summarize`, `/run-on-list`, `/tear-sheet`. |
| Composer @ mention | [UniversalComposer.tsx](../../src/features/redesign/components/UniversalComposer.tsx) | Entity autocomplete. Inserts `[[Entity]]` chip on select. |
| Composer paste/drop | [UniversalComposer.tsx](../../src/features/redesign/components/UniversalComposer.tsx) | Captures images/PDFs into attachment chip strip. |
| Stop generation | [UniversalComposer.tsx](../../src/features/redesign/components/UniversalComposer.tsx) | When `streaming` is true, Run-research becomes amber Stop button. Esc also stops. |
| Empty state | [ChatEmptyState.tsx](../../src/features/redesign/components/ChatEmptyState.tsx) | 4 starter chips + "Resume thread" deep-link + keyboard hint footer. |
| Live timestamps | inline `<LiveTime />` | Re-renders on 30s interval. "just now" → "1m ago" → "5m ago" without reload. |
| Branching | `branchFromTurn` in [ChatSurface.tsx](../../src/features/redesign/surfaces/ChatSurface.tsx) | Truncates thread at selected message. Wired into per-message action row. |
| Scroll-to-bottom | inline button | Visible when user scrolls up. Auto-scrolls on new turn UNLESS user is reading higher (then increments unseen badge). |
| Reactions | inside `MessageActions` | 👍 / 👎 inline. Currently no-op handler; ready to wire to `agentRunFeedback` table (Sprint S5). |

---

## Persona-tunable focus mode

The `/redesign/reports/:reportId?focus=zen` URL param + `⌘\` keyboard shortcut activate writing-focus mode that:
- collapses the left rail (via `body[data-redesign-focus-mode="on"]`)
- rewrites the parent grid template so the editor takes full width
- hides the page-chrome addons row + property grid
- collapses claim/follow-up boxed widgets to left-border callouts (Obsidian-style)
- mutes block handle opacity
- auto-hides top toolbar at 0.18 opacity (hover to restore)

Activated by:
1. `?focus=zen` URL parameter (so persona QA agents land in zen)
2. `⌘\` keyboard toggle anywhere in the editor
3. Command palette → "Toggle writing focus mode"

This resolved a months-long persona-antagonism ceiling: Karpathy hated chrome (zen mode), founder/banker wanted full Notion affordances (default mode). The structural break was the per-persona-tunable mode toggle.

---

## Backend integration sprint

| Sprint | Status | Hook | Backing query |
|---|---|---|---|
| **S1: Reports → live brief docs** | shipped | [useReportsLive.ts](../../src/features/redesign/hooks/useReportsLive.ts) | `batchAutopilot.queries.getRecentRuns` → maps to `ReportCardData` with derived status (completed → verified, failed → review) |
| **S2: Chat → live batch monitor** | shipped | [useBatchLive.ts](../../src/features/redesign/hooks/useBatchLive.ts) | Same query, filtered to active statuses → `ActiveBatchRun` |
| **S3: Inbox aggregator** | shipped (client-side union) | [useInboxLive.ts](../../src/features/redesign/hooks/useInboxLive.ts) | `batchAutopilot.queries.getRecentRuns` ∪ `pipelines.pipelineRunsQueries.listRecentRuns` → tagged with lane / whyHere / confidence |
| **S4: Home pulse + watchlist** | partial (pulse only) | [useHomePulseLive.ts](../../src/features/redesign/hooks/useHomePulseLive.ts) | Pulse cards parsed from `batchAutopilotRuns.briefMarkdown` headlines. Watchlist gated on new `entityWatchlist` table. |
| **S5: Style profile + agent patches** | design complete | — | Schema + migration runbook at [docs/plans/REDESIGN_SPRINT_S5_SCHEMA_MIGRATION.md](../plans/REDESIGN_SPRINT_S5_SCHEMA_MIGRATION.md). |

All shipped surfaces show a **Live · N runs** pill when authenticated with data, **Demo data** pill otherwise — no broken empty states for guest visitors.

---

## QA harness

[scripts/qa/redesignAgentQa.ts](../../scripts/qa/redesignAgentQa.ts) runs 7 personas through the redesign with Gemini 3.1 Pro Preview as judge. Personas:

| Persona | Scenario | URL |
|---|---|---|
| banker_diligence | Pre-meeting diligence on a private mid-market borrower | `/redesign/reports/rep_orbital` |
| founder_pre_meeting | Quick scan of a vendor before a partnership call | `/redesign/reports/rep_orbital` |
| researcher_long_form | Long-form synthesis with backlinks and citations | `/redesign/reports/rep_orbital` |
| teacher_relocation | Research a school + district before relocation | `/redesign/reports/rep_orbital` |
| operator_pipeline | Bundle CRM + signals into a monthly memo | `/redesign/reports/rep_orbital` |
| karpathy_learner | Distill a complex topic with citations, no chrome | `/redesign/reports/rep_orbital?focus=zen` |
| obsidian_vault_keeper | Maintain a personal entity vault with `[[backlinks]]` | `/redesign/reports/rep_orbital` |

Run: `npm run qa:redesign`. Output: `.tmp/redesign-qa/<ISO>/findings.md` + `results.json`.

[scripts/qa/inferStyle.ts](../../scripts/qa/inferStyle.ts) infers the operator style from sample memos via Gemini 3.1 Pro. Output: `style.skill.md` (YAML+markdown manifest) ready to seed `styleProfiles` table.

Run: `npm run qa:infer-style`.

---

## File inventory (new in this redesign)

### Surfaces
- `src/features/redesign/surfaces/HomeSurface.tsx`
- `src/features/redesign/surfaces/ReportsSurface.tsx`
- `src/features/redesign/surfaces/ChatSurface.tsx`
- `src/features/redesign/surfaces/InboxSurface.tsx`
- `src/features/redesign/surfaces/MeSurface.tsx`
- `src/features/redesign/surfaces/WorkspaceSurface.tsx`

### Components
- `src/features/redesign/components/Rail.tsx` — left navigation
- `src/features/redesign/components/RightInspector.tsx` — chat right rail
- `src/features/redesign/components/MobileShell.tsx` — small viewport
- `src/features/redesign/components/CardStack.tsx` — entity card stacking
- `src/features/redesign/components/Pill.tsx` — design system primitive
- `src/features/redesign/components/UniversalComposer.tsx` — chat composer
- `src/features/redesign/components/ReportNotebookView.tsx` — TipTap notebook
- `src/features/redesign/components/ReportNotebookEditor.tsx` — editor wrapper
- `src/features/redesign/components/notebookExtensions.ts` — TipTap custom blocks
- `src/features/redesign/components/SlashMenu.tsx` — block insert palette
- `src/features/redesign/components/BlockHandle.tsx` — block hover handle
- `src/features/redesign/components/StyleGalleryCard.tsx` — style preview
- `src/features/redesign/components/StreamingMarkdown.tsx` — markdown renderer
- `src/features/redesign/components/ChatThinking.tsx` — pre-stream indicator
- `src/features/redesign/components/ChatToolCall.tsx` — inline tool-call card
- `src/features/redesign/components/ChatEmptyState.tsx` — fresh-thread starters
- `src/features/redesign/components/MessageActions.tsx` — per-message toolbar
- `src/features/redesign/components/CommandPalette.tsx` — ⌘K spotlight
- `src/features/redesign/components/ShortcutsOverlay.tsx` — ? help overlay
- `src/features/redesign/components/Toast.tsx` — notification system
- `src/features/redesign/components/Skeleton.tsx` — loading placeholders
- `src/features/redesign/components/WhatChangedStrip.tsx` — Home delta hero

### Hooks
- `src/features/redesign/hooks/useReportsLive.ts`
- `src/features/redesign/hooks/useBatchLive.ts`
- `src/features/redesign/hooks/useInboxLive.ts`
- `src/features/redesign/hooks/useHomePulseLive.ts`

### Tokens & primitives
- `src/features/redesign/tokens.css` — color + typography + spacing
- `src/features/redesign/primitives.css` — `.rd-*` utility classes
- `src/features/redesign/fixtures.ts` — fallback data + types
- `src/features/redesign/RedesignShell.tsx` — route shell

### Scripts
- `scripts/qa/redesignAgentQa.ts` — multi-persona Gemini QA
- `scripts/qa/personas.ts` — 7 personas + 30+ rubric dimensions
- `scripts/qa/inferStyle.ts` — Gemini-powered style inference

### Plans
- `docs/architecture/REDESIGN_ROADMAP.md` — design vision
- `docs/architecture/REDESIGN_CHANGES.md` — this document
- `docs/plans/REDESIGN_BACKEND_INTEGRATION_SPRINT.md` — Sprints S1-S5
- `docs/plans/REDESIGN_SPRINT_S5_SCHEMA_MIGRATION.md` — S5 schema runbook

---

## Verification log

- `npx tsc --noEmit --pretty false` — clean
- `npm run build` — clean
- Multi-persona QA harness — avg 78-81 over 13 passes; final P1 = 3, P0 = 0
- Per-persona all-time highs: banker 90 · operator 88 · obsidian 90 · karpathy 82
- Live preview verification at `localhost:5200/redesign/*` for all 6 surfaces

---

## Where this fits in the live cockpit

The redesign is intentionally additive. The main 5-surface cockpit at `/?surface=ask` etc. is unchanged. The redesign loads only when the path begins with `/redesign`.

When promoting from showcase to production:
1. Promote individual surfaces one at a time via feature flag (e.g. `redesignReports = true` in `useFeatureFlags`).
2. Each surface keeps its existing fixture fallback so guest / unauth users always see something.
3. Live data flows in via the `useXxxLive` hooks the moment auth + tables exist.
