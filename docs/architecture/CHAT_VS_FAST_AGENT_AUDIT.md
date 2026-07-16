# Chat surface vs. FastAgentPanel — UX audit

> Historical snapshot (2026-04-20). The July 2026 runtime-grounding sweep
> removed the unreferenced MessageStream, StreamingMessage, UIMessageStream,
> DecisionTreeKanban, and ParallelTaskTimeline paths. Do not use the component
> inventory below as a current implementation plan.

**Date**: 2026-04-20 · **Scope**: `/?surface=chat` (ChatHome) vs. the floating/docked `FastAgentPanel` · **Bias**: this doc is code-grounded; every claim cites a file path.

## TL;DR

- They are **not** redundant — they serve two different jobs-to-be-done.
- They are **not** cleanly separated either — three distinct tech-debt overlaps drain maintenance velocity.
- **Recommendation: keep both, formalize the distinction, share the engines.** Retiring either loses real UX.

## What each one actually is today

| Dimension | ChatHome (`/?surface=chat`) | FastAgentPanel |
|---|---|---|
| Component count | **1 file** (`ChatHome.tsx`, ~700 lines) | **37 files** (`FastAgentPanel.tsx` 3644 lines + 36 sub-files) |
| Composer | Shared `ProductIntakeComposer` | Own `InputBar` + `PromptEnhancer` |
| Streaming engine | `useStreamingSearch` hook | Own `MessageStream` + `StreamingMessage` + `UIMessageStream` |
| Thread history | Single session in `useStreamingSearch` state | Own `ThreadList` + `MinimizedStrip` + persisted threads |
| Tool trace | None visible (streaming.sourcePreview only) | `DisclosureTrace`, `TraceAuditPanel`, `DecisionTreeKanban`, `ParallelTaskTimeline` |
| Artifacts | Renders report sections inline | `ArtifactCard` + `ExportMenu` tab |
| Memory | None | `Memory` + `MemoryPreview` + `Scratchpad` |
| Tabs | None (one pane) | `chat` / `sources` / `telemetry` / `trace` |
| Where it mounts | `/?surface=chat` cockpit surface | Floating right-rail, openable from anywhere |

## Who opens the FastAgentPanel (evidence)

**12 distinct trigger sites** call `useFastAgent().open()` or `.openWithContext()`:

- `src/features/agents/components/FloatingAgentButton.tsx` — globally visible button (guest + auth)
- `src/features/agents/components/AnalyzeSelectionButton.tsx` — analyze highlighted text
- `src/features/documents/editors/SpreadsheetMiniEditor.tsx` — spreadsheet cell context
- `src/features/documents/surfaces/spreadsheets/SpreadsheetSheetView.tsx` — whole-sheet context
- `src/features/calendar/components/CalendarDatePopover.tsx` — a day's events context
- `src/features/research/components/EntityContextDrawer.tsx` — entity drawer
- `src/features/research/components/FeedReaderModal.tsx` + `FeedReaderPanel.tsx` — feed item context
- `src/features/research/components/LiveRadarWidget.tsx` — radar widget
- `src/features/research/sections/DealListSection.tsx` — deal row
- `src/features/research/hooks/useDossierAgentHandlers.ts` — dossier flows
- `src/features/research/views/ResearchHub.tsx` — research hub CTA

**Nobody opens ChatHome from elsewhere**. It's a destination you navigate to, not something you invoke.

## The two JTBDs (job-to-be-done), honestly

### ChatHome: "I want to start a focused run and read a long-form answer."

The user goes to `/?surface=chat`, puts the company name / LinkedIn URL / pitch deck in the composer, hits Run, and reads the resulting Report. The conversation IS the destination. The streaming sections become the artifact. No sidebar, no tool-trace tabs, no thread history — full-width reading.

### FastAgentPanel: "I want to ask the agent about THIS THING I'm looking at, without leaving."

The user is in a spreadsheet cell / on an entity page / in a calendar day / in a feed reader / editing a dossier. They click a context button. The panel slides in FROM THE SIDE with the current context pre-loaded. They have a brief exchange. They close it. They never left the surface they were working on.

**These are different products.** One is a research destination; the other is an in-context assistant. A VP sending a decision memo link wants the ChatHome artifact URL. A founder analyzing a spreadsheet wants the FastAgentPanel that respects their cell selection.

## What's genuinely redundant (tech debt)

### 1. Streaming engines drift apart
- `ChatHome` uses `useStreamingSearch` (8 touchpoints)
- `FastAgentPanel` has its own `MessageStream` / `StreamingMessage` / `UIMessageStream` trio

Both call similar backend endpoints but render via different React trees with different buffer/flush semantics. **The wet-ink caret I just shipped in PR-6 only lives in ChatHome.** FastAgentPanel users don't see it.

### 2. Composers diverge
- `ChatHome` uses `ProductIntakeComposer` — already polished across PRs 1-6
- `FastAgentPanel` has `InputBar` — its own file, its own interaction vocabulary, not audited in this session

`ProductIntakeComposer` has focus ring, segmented lens, active-scale, kbd hint, submit-pending spinner. `InputBar` has none of those verified. Every polish pass forgets one side.

### 3. Thread / history models duplicate
- `ChatHome` holds one session in `streaming.session` (useStreamingSearch's internal state)
- `FastAgentPanel` has full `ThreadList` with persisted Convex threads, `MinimizedStrip` state, thread switching

If you chat via FastAgentPanel, that thread is in your history. If you chat via ChatHome, the session isn't in the same list. Users don't know this and get confused when "my conversation" vanishes.

## The three real choices

### A. Keep both, formalize the distinction, share the engines (my recommendation)

**What changes**:
- Extract one shared `useConversationEngine` hook that owns streaming + persistence. Both surfaces consume it.
- Rename `InputBar` → internally wraps `ProductIntakeComposer`. Single composer source of truth.
- Unify thread history so a conversation started in either surface appears in both lists.
- Keep ChatHome as the "destination surface" and FastAgentPanel as the "sidecar."

**What stays**:
- Both mount points
- Both trigger paths
- FastAgentPanel keeps its richer UI (tool trace, artifacts tab, memory) — because in-context assistance genuinely needs those
- ChatHome keeps its focused reading UI — because destinations genuinely want fewer tabs

**Estimated effort**: ~2 weeks, staged:
- Week 1: extract `useConversationEngine`, migrate ChatHome to it, write contract tests
- Week 2: migrate FastAgentPanel's MessageStream to the same engine; reconcile thread model

**Risk**: low. Both surfaces keep working throughout. Each migration is behind a feature flag.

### B. Retire FastAgentPanel, make Chat the only conversation surface

**What changes**: every context button (AnalyzeSelectionButton, Spreadsheet, Entity drawer, Calendar, Feed, Dossier, Deal, Research) navigates to `/?surface=chat?context=...` instead of sliding the panel in.

**What we lose**:
- The "don't navigate me away" promise. A spreadsheet user clicks "analyze cell" and is yanked off the spreadsheet. That is the worst kind of sidecar-to-full-screen switch — exactly why every modern app (Notion AI, Linear copilot, Cursor chat) has an in-context sidebar.
- The tool-trace / artifacts / memory tabs. They don't fit into the ChatHome linear-reading flow without a major redesign.

**Cost**: 3-5 weeks. High risk to existing users who rely on the sidecar model.

**Recommendation**: NO.

### C. Retire ChatHome, make FastAgentPanel the only surface (even on `/?surface=chat`)

**What changes**: `/?surface=chat` auto-opens FastAgentPanel in maximized mode.

**What we lose**:
- The full-width "read like a report" experience. ChatHome's streaming sections currently look like Perplexity answers. The FastAgentPanel's messages look like chat bubbles. Swapping the reading UX would be a regression for the "decision memo" use case.
- The shareable URL pattern. ChatHome → saveable Report → public `/memo/:id`. FastAgentPanel threads are currently private.

**Cost**: 2-3 weeks. Medium risk; the public artifact story suffers.

**Recommendation**: NO.

## What to do first (if recommendation A is chosen)

Three concrete steps, each reversible:

1. **Map the contract drift** (1 day). Write `docs/architecture/CONVERSATION_ENGINE_CONTRACT.md` that diffs `useStreamingSearch` vs. the three FastAgentPanel stream components. Identify every divergence (buffering, stop conditions, error handling, tool-event shape). This is the spec for the shared engine.

2. **Back-port the polish wins** (2 days). Apply the six-PR interaction vocabulary from this session to `FastAgentPanel/InputBar.tsx`, `MessageStream.tsx`, `StreamingMessage.tsx`. Zero architectural change — just matches the aesthetic. Immediate UX parity.

3. **Introduce `ProductIntakeComposer` into FastAgentPanel** (1 day). Replace `InputBar` with the shared composer. Thread `submitPending={streaming.isStreaming}` through. Drop the now-unused InputBar file.

After those three, the engines can be merged in the background without user-visible change. The full "unify threads" work is its own sprint.

## Honest risks if we do nothing

1. **Every polish pass misses one surface** (already happened with PR-6's caret — ChatHome has it, FastAgentPanel doesn't).
2. **New conversational features fork** — teammates will add streaming improvements to one side and forget the other.
3. **Users find the inconsistency** — "why does my message have a spinner here but not there?"
4. **The thread-history confusion becomes a support ticket**.

Those are cumulative drag, not crisis. The recommendation-A path stops the drag without breaking either surface.

## Conclusion

**Both surfaces should exist. The polish should flow through both. The streaming and composer should be shared primitives.**

This audit replaces the implicit "maybe we'll retire one of them eventually" with an explicit product decision: **they serve distinct JTBDs; the tech debt is the duplicated infrastructure underneath.**

Next step: if you agree, I can do the 1-day contract drift map or the 2-day polish back-port immediately. Pick one.
