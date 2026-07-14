# AI Elements Migration — Codex Handoff

**Date:** 2026-07-14. **Canonical source:** `origin/main` through PR #527,
commit `28d704b2`. **Program state:** **11/26 component decisions complete**;
the broader 56-file migrate/wrap/keep-custom migration remains ongoing.

> Goal: retire hand-rolled generic AI UI behind thin Vercel AI Elements
> adapters without changing a live Convex stream, product callback, export
> contract, navigation contract, or NodeBench-specific proof surface.

## Release-train ledger

These are squash commits on `origin/main`, not pre-merge branch SHAs.

| PR | Canonical main SHA | Slice |
|---|---|---|
| #516 | `c83a41c8` | AI Elements scaffold, six leaf cutovers, design governance, Shiki chunk routing |
| #517 | `988a3f56` | Full-source code-token cache key |
| #519 | `00e5594d` | Fail-closed post-deploy verification |
| #520 | `35a7b85d` | Workspace live-smoke parity |
| #521 | `30688119` | Identity-preserving `convexToUIParts` adapter |
| #522 | `ad2b26c6` | Protected Tier B preview authentication |
| #523 | `a4fe5ee3` | `CollapsibleAgentProgress` source migration; **not a live-render claim** |
| #524 | `64203ded` | `ToolCallTransparency` migration |
| #525 | `165ecec2` | Live `UIMessageBubble` wrapper |
| #526 | `3cc7cd06` | Live `InputBar` / send-contract wrapper |
| #527 | `28d704b2` | `LiveEventCard` migration plus shared live-event derivation and panel header extraction |

## Read first

1. [`docs/design/UI_CONTRACT.md`](../design/UI_CONTRACT.md) — behavior,
   visual DNA, evidence states, navigation, and keep-custom boundary.
2. [`docs/architecture/AI_ELEMENTS_MIGRATION.md`](AI_ELEMENTS_MIGRATION.md) —
   the complete 56-file decision matrix and remaining sequence.
3. [`src/design/designSystem.ts`](../../src/design/designSystem.ts) —
   machine-readable primitive rules and 11/26 scoreboard.
4. [`docs/design/ui-contract/README.md`](../design/ui-contract/README.md) —
   proof protocol. It forbids placeholder screenshots and unsupported QA scores.

## Non-negotiable safety contract

1. **No primitive drives a stream.** `useUIMessages(stream:true)`,
   `useSmoothText`, and persistent `useStream` subscriptions remain the data
   source. Primitives only present their output. Never replace a live part with
   fixture data.
2. **Preserve exports and callbacks.** Migration work changes internals only.
   Existing public props, barrel exports, send/stop/spawn/voice callbacks, edit
   and feedback handlers, and model semantics remain load-bearing.
3. **Domain cards pass through.** Selection cards, arbitrage reports, media,
   memory, GoalCard, human requests, verification receipts, and document/edit
   workflows remain custom. The adapter routes them without flattening them.
4. **Keep the web navigation contract:** `Home - Reports - Chat - Inbox - Me`.
   Workspace remains a separate deployed surface, never a sixth web tab.
5. **Reduced motion is explicit.** Motion-driven primitives use an explicit
   reduced-motion guard; the global CSS rule is insufficient.
6. **Keep the Shiki bundle guard.** Never force-group `@shikijs/*` into one
   manual chunk. Grammar/theme chunks stay under `assets/shiki/` and outside
   the service-worker precache.
7. **Terracotta, not default Tailwind.** Selection/focus/provenance uses the
   NodeBench token bridge. Success green remains reserved for completed state.

## Evidence vocabulary

These states are independent and must never be collapsed:

- **Source merged:** the canonical SHA is on `origin/main`.
- **Checks verified:** named commands were run for that exact source state.
- **Visual proof complete:** real before/after files and a valid manifest exist.
- **Preview verified:** a normal product path was browser-driven on a preview.
- **Production live verified:** the production deployment and rendered bundle
  were checked directly after the merge.

A green build does not prove preview or production state. A screenshot does not
prove production state. This handoff creates no screenshot, Agentic UI Bar
score, Gemini receipt, or production-live claim.

## Verification floor

Run from a clean worktree based on current `origin/main`:

```powershell
npx tsc --noEmit --pretty false
npx vitest run src/features/agents/components/FastAgentPanel
npx vitest run src/design/designSystem.test.ts
npm run lint:design
npm run build
npx vitest run src/features/agents/components/FastAgentPanel/__tests__/MessageBubble.streaming.test.tsx
git diff --check
```

For a live-path change, add browser assertions against the normal Chat path.
Only create a proof folder when the referenced images and receipts actually
exist. Only claim production live after post-merge production verification.

## Completed component decisions — 11/26

- Six leaf components in #516: TypingIndicator, ThoughtBubble,
  QuickCommandChips, LazySyntaxHighlighter, AgentHierarchy, and SourceCard.
- Shared `convexToUIParts` adapter in #521 is required foundation and is tracked
  separately from the 11/26 component numerator.
- `CollapsibleAgentProgress` in #523. This is source-complete but must not be
  presented as a proven live production surface.
- `ToolCallTransparency` in #524.
- `UIMessageBubble` in #525.
- `InputBar` and its explicit send-contract seam in #526.
- `LiveEventCard` plus the shared live-event derivation in #527.

The 11/26 number counts completed component decisions in the 56-file matrix.
The denominator is the original 26 candidate rows: 8 migrate, 17 wrap, and the
HumanRequestCard wrap-to-keep re-evaluation row. HumanRequestCard remains inside
the operational keep-custom boundary. The broader matrix is not complete.

## Remaining sequence

1. Capture final visual/browser proof for reachable changed surfaces. Do not
   invent proof for dead or unreachable exports.
2. Continue the medium-risk generic shells: MessageBubble, MessageStream,
   UIMessageStream, StreamingMessage, FileUpload, LiveThinking,
   ToolResultPopover, StepTimeline, AgentTasksTab, FileViewer, GoalCard,
   TokenUsageBadge, DocumentActionCard, and EditProgressCard. Reconfirm
   reachability before each slice.
3. Keep HumanRequestCard custom unless a future primitive preserves its
   textarea, multi-option, cancel, and decision-recording semantics.

## Keep-custom boundary

Do not migrate VirtualizedMessageList, StreamingStatus, VisualCitation,
ParallelTaskTimeline, SwarmLanesView, HumanRequestCard, FusedSearchResults,
ResourceLinkCard, MermaidDiagram, MediaGallery, domain selection cards, memory
cards, or verification reports merely to increase adoption count. See the full
matrix for every rationale and live seam.

## Definition of done for the next slice

1. The verification floor passes for the exact candidate revision.
2. Exports, callbacks, live hooks, domain cards, nav, and Workspace separation
   remain intact.
3. The 56-file matrix and machine-readable manifest are updated together.
4. Changelog entries use canonical main SHAs. A pending marker is allowed only
   before merge and must be replaced before the final release commit.
5. Visual and live claims cite artifacts or direct checks that actually exist.
