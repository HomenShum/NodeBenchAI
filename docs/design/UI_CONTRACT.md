# NodeBench UI Contract — AI Surface

Captured: 2026-07-14

This contract governs a **behavior-preserving** migration of NodeBench's agent
chat surface onto [Vercel AI Elements](https://elements.ai-sdk.dev) primitives.
Product behavior remains sourced from the live prod-parity app. AI Elements are
the component vocabulary, not a new authority over product logic: they render
generic surfaces (markdown, reasoning, tool headers, citations, code); every
domain, proof, and live-data affordance stays intact.

The machine-readable companion to this doc is
[`src/design/designSystem.ts`](../../src/design/designSystem.ts) — the same
tokens, principles, and per-primitive rules, readable by tests and agents.
Enforcement is [`src/design-governance/`](../../src/design-governance/) via
`npm run lint:design`.

## Visual Authority Order

1. **Latest prod-parity app is the behavioral source of truth.** (`origin/main`;
   clean worktree per `CLAUDE.md`.) Never restore behavior from a design artifact.
2. **`src/design/designSystem.ts` + this contract** are the token/primitive
   authority for the AI surface.
3. AI Elements' own default Tailwind palette is **reference only** — it is
   re-themed to NodeBench tokens (terracotta `#d97757`), never shipped raw.
4. CSS cascade accidents and stale snapshots are not design decisions.

## Design DNA (tokens)

Grounded in `src/index.css` (`:root` light + `.dark`). The shadcn token bridge
maps these onto every primitive automatically (`bg-primary`, `ring`, `border`).

| Token area | Contract |
|---|---|
| Accent | Terracotta selection/focus/CTA/provenance `#d97757`; hover `#c76648`; secondary `#e59579`. shadcn `--primary` = `18 62% 60%` (light) / `18 60% 55%` (dark). |
| Semantic | Success green **only** for completed/healthy — never selection. Amber for held/review. Red for error/failure. |
| Surfaces | Glass DNA: hairline `border-white/[0.06]` (`rgba(255,255,255,.10)` dark / `rgba(0,0,0,.06)` light) over faint fill `bg-white/[0.02]`. App canvas `--bg-primary` `#FFFFFF` / `#111418`. |
| Fonts | UI: Inter → Manrope fallback. Mono (code/trace): JetBrains Mono. |
| Type scale (px) | 11, 12, 13, 14, 16, 18, 20, 24, 30, 36. Eyebrows: 11px uppercase `tracking-[0.15em]`. |
| Radius (px) | 4, 6, 8, 12, 16, 24, pill. `--radius` base 8px; panels 12–16px. |
| Motion | Respect `prefers-reduced-motion`. **motion/react-driven primitives (Shimmer, Reasoning) bypass the CSS override — each needs an explicit `useReducedMotion()` guard.** |

## Honesty Contract (non-negotiable)

**No primitive drives a stream.** The live Convex hooks
(`useUIMessages(stream:true)`, `useSmoothText`, `useStream`) remain the data
source; primitives are the presentation layer fed by hook output. A migration
that replaces a live part with a fixture violates the ScratchNode honesty
contract and the `message-live-data` / `MessageBubble.streaming` test invariants.

## Migration Rule

Every changed file must be classifiable as exactly one of:

- **Presentation only** — tokens, class names, layout wrappers, visual
  primitives, focus/hover styling.
- **Adapter only** — a component wraps existing props/callbacks/state without
  changing behavior. Export API preserved **byte-for-byte**.
- **Tiny compatibility fix** — only if a compile/type error directly requires it
  (e.g. the Shiki chunking fix in `vite.config.ts`).

Any change to API calls, state shape, routing, persistence, auth/session,
Convex functions, agent runtime, or tool behavior is **outside** this migration
unless explicitly approved.

## AI Elements Adoption

`migrated` = internals rewritten onto the primitive, export API preserved, tests
green. `wrapped` = primitive wraps existing props/callbacks, domain logic
untouched. `scaffolded` = themed + render-verified, not cut into a live path.
`keep_custom` = intentionally NOT adopted (domain/proof-shaped). Full mapping:
[`docs/architecture/AI_ELEMENTS_MIGRATION.md`](../architecture/AI_ELEMENTS_MIGRATION.md)
(56 files: 8 migrate / 18 wrap / 30 keep_custom).

| Primitive | Consumer / replaced file | Status | KEEP / REFINE | Notes |
|---|---|---|---|---|
| `shimmer` | TypingIndicator | **migrated** | KEEP | `useReducedMotion()` guard added — motion/react bypasses the CSS reduced-motion rule. |
| `reasoning` | ThoughtBubble | **migrated** | KEEP | Collapsible "Thought for…" disclosure; static trigger under reduced motion. |
| `suggestion` | QuickCommandChips | **migrated** | KEEP | `cmd.navigate → window.location.assign` branch preserved via `commandsById` lookup. |
| `code-block` | LazySyntaxHighlighter | **migrated** | REFINE | Shiki, lazy; grammars routed to `assets/shiki/` + globIgnored from precache (see below). |
| `task` | AgentHierarchy | **migrated** | KEEP | `startedAt/completedAt` timing preserved. |
| `sources` + `inline-citation` | SourceCard | **migrated** | KEEP | Rich preview extras stay in wrapper. |
| `message`+`reasoning`+`tool`+`sources` | UIMessageBubble (live, 140KB) | wrapped (planned) | REFINE | **Crown jewel.** Wrap generic sub-parts only; domain cards pass through `renderCustomPart`. Guard with `MessageBubble.streaming.test`. |
| `prompt-input`+`context`+`model-selector` | InputBar (live) | wrapped (planned) | REFINE | `onSubmit` delegates to `onSend/onStop/onSpawn`; slash/mentions/voice/drag-drop stay custom. |
| `checkpoint` | (restore/version-jump) | scaffolded | KEEP | The primitive named in the original ask; maps to restore-checkpoint. |
| `plan` / `artifact` / `web-preview` / `context` | GoalCard / DocumentActionCard / FileViewer / TokenUsageBadge | scaffolded | REFINE | Evaluate per matrix; `web-preview` keeps per-fileType sandbox (security). |
| `confirmation` | HumanRequestCard | **keep_custom** | — | No textarea/multi-option; HITL approval + CAS semantics stay custom. |

### Shiki bundle guard (code-block)

`code-block` uses Shiki (~200 TextMate grammars). Two build invariants, both in
`vite.config.ts`:

1. **Never force-group `@shikijs/*` into one `manualChunk`** — that collapses
   Shiki's per-language dynamic splitting into a single ~10 MB blob that
   overflows the PWA 2 MiB precache limit and **fails the build**. Leave it
   unmatched so each grammar is its own lazy chunk.
2. **Route grammar chunks to `assets/shiki/` and `globIgnore` them from
   precache** — they lazy-load on demand (graceful plaintext fallback offline),
   keeping ~7.4 MB of rarely-used grammars out of the first-visit SW precache.

_Known follow-up:_ curating Shiki to a language allowlist would shrink dist
further, but is blocked at the package level — shiki 4.x `exports` has no
`./langs/*` wildcard, so fine-grained per-language imports are not
Vite-resolvable. The chunking + globIgnore guard above is the shipped fix.

## Proof

The `ui-contract/` sibling directory holds dated visual-contract evidence
(before/after screenshots + capture manifests + Gemini QA receipts), following
the NodeRoom pattern. See [`ui-contract/README.md`](ui-contract/README.md) for
the capture protocol and manifest schema.

Design parity for a slice is not complete until all are true:

- Each migrated region has before/after screenshots under a dated `ui-contract/` folder.
- `npx tsc --noEmit`, the touched Vitest suites, and `npm run build` pass (or
  failures are documented as pre-existing baseline).
- `npm run lint:design` reports no NEW high-severity drift on the AI surface.
- Browser verification uses normal product paths — not static screenshots alone.

## Migration Status

**2026-07-14 — Batch 1 (6 leaf components) shipped + verified:**

- Migrated: TypingIndicator→shimmer, ThoughtBubble→reasoning, QuickCommandChips→suggestion,
  LazySyntaxHighlighter→code-block, AgentHierarchy→task, SourceCard→sources+inline-citation.
- Verified: `tsc` 0 errors · FastAgentPanel suite 89 passed / 0 failed (incl. SourceCard's 15) · `npm run build` exit 0.
- Fixed a build regression the batch introduced (Shiki bundle — see guard above).
- Commit `776c4868`.

Next: the live `UIMessageBubble` + `InputBar` wraps (Phases 2–3), each guarded by
the streaming tests and cut over only after e2e content assertions + live verification.
