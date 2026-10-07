# NodeBench UI Contract — AI Surface

Captured: 2026-07-14. Canonical source: `origin/main` through PR #527
(`28d704b2`).

This contract governs a behavior-preserving migration of NodeBench's agent chat
surface onto [Vercel AI Elements](https://elements.ai-sdk.dev) primitives.
Product behavior remains sourced from the prod-parity app. AI Elements provide
generic presentation vocabulary; NodeBench domain, proof, navigation, and
live-data behavior remain authoritative.

The machine-readable companion is
[`src/design/designSystem.ts`](../../src/design/designSystem.ts). Enforcement is
[`src/design-governance/`](../../src/design-governance/) via
`npm run lint:design`.

## Visual authority order

1. `origin/main` in a clean prod-parity worktree is the behavioral source of
   truth. Never restore behavior from a design packet or stale screenshot.
2. `src/design/designSystem.ts` and this contract are the token and primitive
   authority for the AI surface.
3. The latest UI kit packet is a design target, not an implementation branch.
4. AI Elements' default palette is reference only and must resolve through the
   NodeBench token bridge.
5. CSS accidents, fixtures, and stale screenshots are not product decisions.

## Product invariants

- Web navigation remains exactly `Home - Reports - Chat - Inbox - Me`.
- Workspace remains a separate deployed surface, not a sixth web tab.
- Live Convex-backed flows never silently fall back to fixtures.
- Export signatures, send/stop/spawn/voice callbacks, model behavior, and
  message action handlers remain load-bearing.
- Domain and proof cards pass through unchanged unless their own contract is
  explicitly approved for migration.

## Design DNA

Grounded in `src/index.css` (`:root` light and `.dark`). The shadcn token bridge
maps these values onto the vendored primitives.

| Token area | Contract |
|---|---|
| Accent | Terracotta selection/focus/CTA/provenance `#d97757`; hover `#c76648`; secondary `#e59579`. |
| Semantic | Success green only for completed/healthy. Amber for held/review. Red for error/failure. |
| Surfaces | Warm canvas plus glass hairline/faint fill; avoid saturated cards. |
| Fonts | UI: Inter with Manrope fallback. Code/trace: JetBrains Mono. |
| Type scale | 11, 12, 13, 14, 16, 18, 20, 24, 30, 36px. Eyebrows: 11px uppercase with controlled tracking. |
| Radius | 4, 6, 8, 12, 16, 24px and pill. Base `--radius` is 8px. |
| Motion | Respect `prefers-reduced-motion`; motion-driven primitives need explicit `useReducedMotion()` handling. |

## Honesty contract

**No primitive drives a stream.** `useUIMessages(stream:true)`, `useSmoothText`,
and persistent `useStream` subscriptions remain the data sources. Primitives
present hook output. Replacing a live part with a static string or fixture
violates the message-live-data and streaming invariants.

## Migration rule

Every change must be one of:

- **Presentation only:** tokens, classes, layout, focus/hover, or primitive
  composition.
- **Adapter only:** wraps existing props, callbacks, and state without changing
  product behavior or exports.
- **Tiny compatibility fix:** the minimum compile/build correction directly
  required by the migration.

API calls, state shape, routing, navigation, persistence, auth/session, Convex
functions, agent runtime, and tool behavior are out of scope unless separately
approved.

## Program status

The delivery scoreboard is **11/26 complete**. The broader **56-file migration
is ongoing**. The denominator is the original 26 candidate rows: 8 migrate, 17
wrap, and the HumanRequestCard wrap-to-keep re-evaluation row. HumanRequestCard
remains operationally keep-custom. The shared `convexToUIParts` adapter is
required foundation but tracked separately; the number is not a claim that all
11 components are production-live.

`migrated` means internals use the primitive. `wrapped` means the primitive
wraps existing behavior. `scaffolded` means available and themed but not cut
into the target. `keep_custom` is an intentional boundary.

| Primitive | Consumer | Adoption | Canonical source | Evidence boundary |
|---|---|---|---|---|
| `shimmer` | TypingIndicator | migrated | #516 · `c83a41c8` | source merged |
| `reasoning` | ThoughtBubble | migrated | #516 · `c83a41c8` | source merged |
| `suggestion` | QuickCommandChips | migrated | #516 · `c83a41c8` | source merged |
| `code-block` | LazySyntaxHighlighter | migrated | #516 · `c83a41c8`; cache fix #517 · `988a3f56` | source merged; Shiki build guard applies |
| `task` | AgentHierarchy | wrapped | #516 · `c83a41c8` | source merged |
| `sources` + `inline-citation` | SourceCard | wrapped | #516 · `c83a41c8` | source merged |
| adapter | `convexToUIParts` | merged | #521 · `30688119` | identity-preserving data seam; not a visual surface |
| `task` + `chain-of-thought` + `reasoning` + `tool` | CollapsibleAgentProgress | wrapped | #523 · `a4fe5ee3` | source migration only; **no live-render claim** |
| `tool` | ToolCallTransparency | migrated | #524 · `64203ded` | source merged |
| `message` + `reasoning` + `tool` + `sources` | UIMessageBubble | wrapped | #525 · `165ecec2` | source merged; production-live proof tracked separately |
| `prompt-input` + `context` + `model-selector` | InputBar | wrapped | #526 · `3cc7cd06` | source merged; production-live proof tracked separately |
| `tool` + task connector | LiveEventCard | migrated | #527 · `28d704b2` | source merged; visual and production-live proof tracked separately |
| `checkpoint` | restore/version jump | scaffolded | #516 · `c83a41c8` | not cut into a target |
| `plan` / `artifact` / `web-preview` / `context` | GoalCard / DocumentActionCard / FileViewer / TokenUsageBadge | scaffolded | #516 · `c83a41c8` | evaluate per 56-file matrix |
| `confirmation` | HumanRequestCard | keep_custom | n/a | textarea, multi-option, cancel, and decision semantics remain custom |

Full mapping and remaining sequence:
[`docs/architecture/AI_ELEMENTS_MIGRATION.md`](../architecture/AI_ELEMENTS_MIGRATION.md).

## Keep-custom boundary

Keep VirtualizedMessageList, StreamingStatus, VisualCitation,
ParallelTaskTimeline, SwarmLanesView, HumanRequestCard, FusedSearchResults,
ResourceLinkCard, MermaidDiagram, MediaGallery, all domain selection cards,
memory cards, and verification reports custom. A generic primitive may frame a
surface only when every domain callback, proof affordance, security rule, and
live subscription survives unchanged.

## Shiki bundle guard

`code-block` uses Shiki's lazy grammar/theme chunks. Two invariants live in
`vite.config.ts`:

1. Never force-group `@shikijs/*` into one `manualChunk`; doing so destroys
   per-language splitting and can exceed the PWA precache limit.
2. Route grammar/theme chunks to `assets/shiki/` and exclude that directory
   from precache. They remain runtime-lazy with plaintext fallback behavior.

Measure the exact candidate build. Historical chunk sizes are context, not
evidence for the current revision.

## Evidence states

Use the following labels literally:

- **source merged** — canonical SHA is on `origin/main`;
- **checks verified** — named commands passed on that exact SHA;
- **visual proof complete** — real files plus a schema-valid manifest exist;
- **preview verified** — a normal product path was browser-driven on preview;
- **production live verified** — the post-merge production deployment and
  rendered bundle were checked directly.

Do not infer one state from another. Never create placeholder PNGs, QA receipts,
findings, Agentic UI Bar scores, or live claims. As of this source revision,
[`docs/design/ui-contract/`](ui-contract/) contains the protocol and schema but
no dated proof folder, so visual-proof-complete is not claimed here.

## Migration ledger

- #516 `c83a41c8`: scaffold, six leaf cutovers, governance, and Vite Shiki guard.
- #517 `988a3f56`: prevent equal-length code-token cache collisions by keying on
  the full source.
- #521 `30688119`: add the shared identity-preserving message-parts adapter.
- #523 `a4fe5ee3`: wrap CollapsibleAgentProgress; source state only.
- #524 `64203ded`: migrate ToolCallTransparency.
- #525 `165ecec2`: wrap UIMessageBubble while retaining live hooks and domain
  passthrough.
- #526 `3cc7cd06`: wrap InputBar and make send-contract forwarding explicit.
- #527 `28d704b2`: migrate LiveEventCard, centralize live-event derivation, and
  extract the panel header without changing the 11/26 keep-custom boundary.

Release guard support also landed in #519 (`00e5594d`), #520 (`35a7b85d`), and
#522 (`ad2b26c6`). Final visual and production evidence must be recorded against
the exact revision it verifies; this governance update makes no such claim.
