# AI Elements Migration — Codex Handoff

**Date:** 2026-07-14. **Canonical runtime source:** `origin/main` through PR #531,
commit `fa397589`. **Program state:** **11/26 component decisions complete**;
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
| #528 | `849ff3e5` | Owner-safe agent plan/memory projections and authenticated query-validator fix |
| #529 | `c4035256` | Tier-safe FastAgent routing, atomic reservation/reconciliation, queue/cancellation fences, bounded Linkup, and honest terminal state |
| #531 | `fa397589` | Exact queued-prompt validation and explicit bounded-context provider input, with safe internal-error redaction |

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
prove production state. The runtime evidence below applies only to the exact
signed-in FastAgent path; it does not create visual-proof, Agentic UI Bar,
Gemini-receipt, or reachability claims for other migration candidates.

## FastAgent P0 production evidence (#529 → #531)

- **#529 bounded failure (2026-07-14):** production run
  `j97cew6c6cd3h3ygsh861xn3s98ah7m7` selected tier-eligible
  `gemini-2.5-flash`, but the Agent SDK received an empty provider-message list
  because history was zero and only `promptMessageId` crossed the provider
  boundary. Reservation
  `fast-agent:j97cew6c6cd3h3ygsh861xn3s98ah7m7:500651aa` was released
  with zero input/output tokens and `Run ended before provider execution`.
  This is safety evidence, not a successful product-path claim.
- **#531 source and checks:** merged at `2026-07-14T16:49:41Z` as
  `fa397589fbdd1c3333a59756a04e19013c49289c` from final head
  `9a6de10493feffefcf5a5b4ba8d8cd98d4995175`. Typecheck, Runtime smoke,
  Build, and Tier B vs preview URL passed. CI-managed
  [Convex Deploy run 29351246820](https://github.com/HomenShum/NodeBenchAI/actions/runs/29351246820)
  succeeded; no manual or out-of-band Convex deployment was used.
- **Production deployment:** Vercel deployment
  `dpl_Ci4RreLinimCumhwLmrJXykiAJAK` at
  `https://nodebench-aqqg2g65l-hshum2018-gmailcoms-projects.vercel.app`
  reached READY at `2026-07-14T16:54:50.338Z`. During #531 post-deploy
  verification, the canonical aliases resolved to it;
  `https://www.nodebenchai.com/agents` returned HTTP 200 with main asset
  `/assets/index-DwH5Fcl7.js`. Post-deploy verification run `29351596286` and
  Attrition QA run `29351596158` passed.
- **Signed-in dogfood PASS (`2026-07-14T17:01:06.366Z`):** a fresh canonical
  `/agents` thread sent `Reply with exactly TIER_OK and nothing else.` once.
  One user message and one assistant response exactly `TIER_OK` rendered; busy
  state stopped; no tool/search/source cards appeared; no raw or internal error
  was shown. Thread `sd7dnv6hx0waskwyk8kps9wbjs8ahnn8`, Agent thread
  `m57ea0mvgp4cbm87hbanake4n58ah0ay`, run
  `j9742r0yg3zkfsdqvgpx9he8k98ahv8t`, prompt message
  `ks7as6sgypb77cwm8qbk04en7x8ag49j`, assistant message
  `ks7deyjjf3v7vqyj1bsqcsptk18agvn2`.
- **Accounting proof:** effective model `gemini-2.5-flash`; usage row
  `gd7sgkt10mv5ybhkjtby1x0x6h8agfy6`; reservation
  `fast-agent:j9742r0yg3zkfsdqvgpx9he8k98ahv8t:063e0069`; one attempt,
  `reservationStatus=reconciled`, terminal audit state `provider_ended`,
  `success=true`, 741 input and 4 output tokens, and no active reserved fields.
  Daily counters changed requests `0 → 1`, successes `0 → 1`, errors `0 → 0`,
  and tokens `0 → 745`; active reservations and dogfood search runs were both
  zero after reconciliation.

## Verification floor

Run from a clean worktree based on current `origin/main`:

```powershell
npx tsc --noEmit --pretty false
npx tsc -p convex/tsconfig.json --noEmit --pretty false
npx vitest run convex/__tests__/agentRuntimeTierFallback.test.ts
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
