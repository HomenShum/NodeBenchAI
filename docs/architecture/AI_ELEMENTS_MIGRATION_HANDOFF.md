# AI Elements Migration — Codex Handoff

**Owner of record:** Claude (batch 1 + governance). **Next owner:** Codex agent
(`gpt-5.6-sol`, deepswe #1 — this is the multi-file, live-Convex-seam work it's for).
**Date:** 2026-07-14. **Branch to base on:** `origin/main` (batch 1 merged as of this handoff).

> Goal in one line: **retire the ~56 hand-rolled FastAgentPanel AI components by
> making them thin adapters over Vercel AI Elements primitives — WITHOUT breaking a
> single live Convex stream or changing any export contract.**

## Read these first (do not skip)

1. [`docs/design/UI_CONTRACT.md`](../design/UI_CONTRACT.md) — the visual + behavior contract, DNA tokens, migration rule.
2. [`docs/architecture/AI_ELEMENTS_MIGRATION.md`](AI_ELEMENTS_MIGRATION.md) — the full 56-file matrix (8 migrate / 18 wrap / 30 keep_custom), the phased plan, and the `convexToUIParts` adapter design.
3. [`src/design/designSystem.ts`](../../src/design/designSystem.ts) — machine-readable per-primitive `must`/`avoid`. `npm run test:design` must stay green.
4. `.claude/rules/scratchpad_first.md` + the honesty contract below.

## Non-negotiable safety contract

These are the invariants that make this migration safe. **Every PR must uphold all of them.**

1. **Honesty contract — no primitive drives a stream.** The live Convex hooks
   (`useUIMessages(stream:true)`, `useSmoothText`, `useStream` persistent-text-streaming)
   remain the data source. Primitives are the presentation layer fed by hook output.
   **Never** feed a primitive a static string where a live stream belonged, and never
   replace a live part with a fixture. This breaks the `message-live-data` /
   `MessageBubble.streaming` test invariants and the ScratchNode honesty contract.
2. **Export API is byte-for-byte preserved.** A migration rewrites a component's
   *internals only*; its exported signature, prop interface, and barrel re-exports do
   not change. Call sites and `index.ts` / `index.enhanced.ts` stay untouched.
3. **Domain cards pass through, never flatten.** Selection cards, arbitrage reports,
   media galleries, memory cards, GoalCard, verification receipts stay custom and render
   unchanged inside `MessageContent` via the `renderCustomPart` passthrough. The adapter
   *routes* domain parts; it does not transform them into a primitive.
4. **Reduced motion.** motion/react-driven primitives (`Shimmer`, `Reasoning`) bypass the
   CSS `prefers-reduced-motion` override — add an explicit `useReducedMotion()` guard.
5. **Shiki bundle guard (already in `vite.config.ts` — do not regress).** Never
   force-group `@shikijs/*` into one `manualChunk` (collapses ~200 grammars into a 10 MB
   blob → PWA precache overflow → build fails). Grammar chunks route to `assets/shiki/`
   and are `globIgnore`d from precache. If you touch `vite.config.ts`, re-run `npm run build`.
6. **Terracotta, not default Tailwind.** Primitives resolve to the shadcn token bridge.
   `npm run lint:design` reports no NEW high-severity drift on the AI surface.

## Verification floor (every PR, in order)

```
npx tsc --noEmit --pretty false                 # 0 errors
npx vitest run src/features/agents/components/FastAgentPanel/__tests__/   # 89 baseline, 0 fail
npx vitest run src/design/designSystem.test.ts  # 11 pass
npm run lint:design                             # no NEW high-severity on AI surface
npm run build                                   # exit 0, no "Assets exceeding" precache error
# For any LIVE-path change, also run the streaming guard explicitly:
npx vitest run src/features/agents/components/FastAgentPanel/__tests__/MessageBubble.streaming.test.tsx
# Before claiming "live": vite preview + drive the Chat surface, 0 console errors (live_dom_verification).
```

## Done so far (do not redo)

Batch 1 — 6 leaf components migrated, verified, shipped (this branch):
TypingIndicator→`shimmer`, ThoughtBubble→`reasoning`, QuickCommandChips→`suggestion`,
LazySyntaxHighlighter→`code-block`, AgentHierarchy→`task`, SourceCard→`sources`+`inline-citation`.
Plus the design dir + UI-contract dir + the Shiki build fix.

## The remaining work — sequenced by risk (LOW → HIGH)

### Step 1 — CollapsibleAgentProgress (DEAD-safe, do first)
- **File:** `src/features/agents/components/FastAgentPanel/CollapsibleAgentProgress.tsx` (137 lines).
- **Consumer:** only `index.enhanced.ts` (a barrel re-export) — **dead**, cannot break a live flow.
- **Target:** `task` / `chain-of-thought` + `reasoning` + `tool` shell.
- **Preserve:** the `toolParts: ToolUIPart[]` prop feed + the collapsible answer/process shell shape.
- **Risk:** low. This is the batch-1 pattern — internals-only, export preserved.

### Step 2 — ToolCallTransparency + LiveEventCard (LIVE, guard each)
- **ToolCallTransparency** (`ToolCallTransparency.tsx`, 250 lines) → `tool`.
  **Consumer: the LIVE `FastAgentPanel.UIMessageBubble.tsx`.** Map the status enum
  running/success/error → `input-available`/`output-available`/`output-error`. Preserve
  the MCP tool-call timeline semantics exactly. Guard with `MessageBubble.streaming.test`
  and a live Chat-surface render check.
- **LiveEventCard** (`LiveEventCard.tsx`, 255 lines) → `tool` + task connector.
  Consumer: `FastAgentPanel.tsx` (matrix says orphaned — FAP inlines its own; **confirm
  render reachability first**). Feed from the `liveEvents` `useMemo`, never fixtures.
- **Risk:** medium. Both are single-component, self-contained. Preserve exports + behavior.

### Step 3 — Crown jewels (HIGH — build the adapter first)
- **Build the shared adapter** `src/features/agents/components/FastAgentPanel/adapters/convexToUIParts.ts`
  per the matrix spec (§ "Shared adapter"). It funnels message-render migrations through
  one parts-parser. `domainParts` is a **pass-through, not a transform**. Do NOT make it
  emit persistent-text-streaming bodies — `useStream` stays a live subscription.
- **UIMessageBubble.tsx (140 KB, THE live bubble)** → wrap with `message`+`reasoning`+`tool`+`sources`;
  keep selection/arbitrage/media/GoalCard custom. Preserve `useUIMessages(stream:true)`,
  `useSmoothText` gated on status, `useMessageHandlers()`, all `on{Company,Person,Event,News,Doc,Regen,Delete,Edit,Feedback}`
  callbacks, and StreamingStatus. **Guard: `MessageBubble.streaming.test` + full FastAgentPanel suite + live render.**
- **InputBar.tsx** → wrap with `prompt-input` + `context` + `model-selector`. `PromptInput.onSubmit`
  MUST delegate to `onSend`/`onStop`/`onSpawn`/`onVoiceIntent` — never swallow. Preserve
  `useAction(enhancePrompt)`; slash / @mentions / voice / drag-drop stay custom.
- **Risk:** high — live Convex seams + the largest files. One component per PR. Cut over
  only after e2e content assertions pass and the change is live-verified.

## Keep-custom boundary (do NOT migrate — the matrix says keep)
VirtualizedMessageList (perf), StreamingStatus, VisualCitation, ParallelTaskTimeline,
SwarmLanesView, HumanRequestCard (Confirmation lacks textarea/multi-option), FusedSearchResults,
ResourceLinkCard, MermaidDiagram (XSS-hardened), MediaGallery, and all domain selection cards.
See the matrix for the full 30-file keep_custom list + rationale.

## Definition of done (per step)
1. Verification floor green (above).
2. Export APIs unchanged; no barrel/call-site edits.
3. Domain cards + live streams intact (honesty contract).
4. `docs/architecture/AI_ELEMENTS_MIGRATION.md` adoption status updated (scaffolded→migrated/live).
5. For live-path steps: before/after proof captured under `docs/design/ui-contract/YYYYMMDD-<slice>/`
   (`npm run dogfood:full:local`) + live-verified per `live_dom_verification`.
6. `docs/design/UI_CONTRACT.md` "Migration Status" appended with the shipped slice + commit.

## Tracked follow-ups (not blockers)
- The `.mjs` design linter has drifted extra inlined patterns vs. canonical `defaultSpec.ts`
  (only 1 high pattern: `uppercase tracking-widest`). Reconcile so `lint:design` and
  `auditAiSurfaceDesign` agree.
- Curating Shiki to a language allowlist is blocked (shiki 4.x `exports` has no `./langs/*`
  wildcard). Revisit if shiki adds fine-grained subpath exports.
