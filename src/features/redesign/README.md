# `src/features/redesign/`

> Current NodeBench redesign surface mounted at `/redesign`. It is route-distinct from the ExactKit cockpit at `/?surface=...` and from ScratchNode's event room at `scratchnode.live`.
>
> Read [docs/architecture/REDESIGN_ROADMAP.md](../../../docs/architecture/REDESIGN_ROADMAP.md) for the full architecture and journey. This README is the developer-facing inventory + extension cookbook.
>
> Route ownership and runtime boundaries are documented in [docs/architecture/PRODUCT_SURFACE_RUNTIME_OWNERSHIP.md](../../../docs/architecture/PRODUCT_SURFACE_RUNTIME_OWNERSHIP.md). Read it before claiming a PR changed "the chat runtime" or "the proto" because several routes have chat-like UIs.

---

## TL;DR

```bash
npm run dev
# Open http://localhost:5200/redesign
# Toggle the floating "Phone" FAB (bottom-right) to preview the mobile shell
# Toggle the "◐" FAB next to it to switch light/dark mode
```

All redesign code is scoped to `[data-redesign]`. It shares live Convex runtime primitives with the product, but route ownership is explicit: `/redesign/*` is the current redesign, `/?surface=*` is the ExactKit cockpit, and `scratchnode.live/e/:slug` is the ScratchNode event room.

---

## File map

```
src/features/redesign/
├── README.md                              this file
├── tokens.css                             CSS custom properties (light + dark + reduced-motion)
├── primitives.css                         .rd-card, .rd-btn, .rd-pill, layout, tabs, shimmer
├── fixtures.ts                            demo data — replace with Convex queries to ship
├── RedesignShell.tsx                      top-level container · URL → surface · theme · phone preview
│
├── components/
│   ├── Rail.tsx                           left rail · 5-tab nav · Workspace launcher · live stats
│   ├── UniversalComposer.tsx              Claude/ChatGPT-style composer · tier dropdown · + menu · send circle
│   ├── Pill.tsx                           tone-mapped status pill (accent / green / blue / amber / red)
│   ├── CardStack.tsx                      3-column max graph traversal · breadcrumb + Back · drill / promote
│   ├── RightInspector.tsx                 chat right rail · Report status · Active entity · Graph · Sources · Threads
│   └── MobileShell.tsx                    capture-first phone shell · bottom 5-tab nav · bottom sheets
│
└── surfaces/
    ├── HomeSurface.tsx                    Pulse — composer + memory pulse + today's intel + active event
    ├── ReportsSurface.tsx                 reusable memory library — sticky filter + density toggle
    ├── ChatSurface.tsx                    conversation as memory — answer packets with trace
    ├── InboxSurface.tsx                   attention queue — captures + ambiguity + approvals + watchlist
    ├── MeSurface.tsx                      Personal Context Notebook — TipTap + permissions + patch inbox + hooks
    └── WorkspaceSurface.tsx               6 tabs (Brief / Cards / Notebook / Sources / Chat / Map)
```

---

## Routes

| Path | Renders |
|---|---|
| `/redesign` | HomeSurface |
| `/redesign/reports` | ReportsSurface |
| `/redesign/chat` | ChatSurface (with `RightInspector` Agent Runtime Inspector on desktop) |
| `/redesign/inbox` | InboxSurface |
| `/redesign/me` | MeSurface |
| `/redesign/workspace` | WorkspaceSurface (6-tab — Brief default) |

Wired in [src/App.tsx](../../App.tsx) as a standalone route check before `/memo` — bypasses the cockpit entirely.

Important route split:

| Route | Do not confuse with |
|---|---|
| `/redesign/chat` | `/?surface=chat` ExactKit cockpit |
| `/redesign/reports` | `/?surface=reports` ExactKit cockpit |
| `scratchnode.live/e/:slug` | NodeBench redesign or cockpit routes |

---

## Token system

All tokens are CSS custom properties scoped to `[data-redesign]`. To override locally, nest a child and redefine.

### Surface

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rd-paper` | `#faf9f7` | `#0f1011` | Page canvas |
| `--rd-paper-warm` | `#f4f2ed` | `#141516` | Subtle alt-row tint |
| `--rd-panel` | `#ffffff` | `#191a1b` | Card / popover surface |
| `--rd-muted` | `#ece9e2` | `rgba(255,255,255,0.04)` | Hover wash |

### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rd-ink` | `#1a1916` | `#f7f8f8` | Primary text |
| `--rd-ink-strong` | `#0d0c0a` | `#ffffff` | Display headings |
| `--rd-ink-mute` | `#74716b` | `#d0d6e0` | Body de-emphasized |
| `--rd-ink-soft` | `#989590` | `#8a8f98` | Metadata / placeholder |
| `--rd-ink-faint` | `#b3b0a8` | `#62666d` | Disabled |

### Accent (NodeBench terracotta)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--rd-accent` | `#d97757` | `#e88f6e` | Primary accent |
| `--rd-accent-strong` | `#c76648` | `#f2a583` | Hover / active |
| `--rd-accent-soft` | `rgba(217,119,87,0.10)` | `rgba(232,143,110,0.16)` | Wash |
| `--rd-accent-tint` | `rgba(217,119,87,0.06)` | `rgba(232,143,110,0.08)` | Subtle wash |
| `--rd-accent-ring` | `rgba(217,119,87,0.30)` | `rgba(232,143,110,0.40)` | Focus ring |

### Borders

`--rd-line-faint` · `--rd-line` · `--rd-line-strong` · `--rd-line-soft` (warm cream alternative for hard edges)

### Status

`--rd-green` / `--rd-green-bg` / `--rd-green-border`, plus blue / amber / red / purple variants.

### Radii

`--rd-r-xs: 4px` · `--rd-r-sm: 6px` · `--rd-r: 10px` · `--rd-r-md: 12px` · `--rd-r-lg: 16px` · `--rd-r-hero: 22px` · `--rd-r-pill: 999px`

### Type

```
--rd-font-sans: 'Inter', 'Manrope', system-ui, -apple-system, sans-serif
--rd-font-display: 'Inter', 'Manrope', system-ui, -apple-system, sans-serif
--rd-font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace
--rd-font-serif: 'Source Serif 4', 'Iowan Old Style', Georgia, serif
font-feature-settings: 'cv01', 'ss03'  (Linear's signature OpenType activation)
```

---

## Primitive classes

| Class | Purpose |
|---|---|
| `.rd-display` | 40 px display heading (weight 510, -0.96 px tracking) |
| `.rd-h1` / `.rd-h2` / `.rd-h3` | Section / card / sub-card headings |
| `.rd-eyebrow` | 11 px uppercase 0.12 em tracking — section eyebrows |
| `.rd-body` | 13.5 px / 1.55 — primary body |
| `.rd-mono` / `.rd-meta` | Mono metadata |
| `.rd-faint` | Muted text helper |
| `.rd-card` / `.rd-card--hero` / `.rd-card--ghost` / `.rd-card--interactive` | Card variants |
| `.rd-card__pad` / `.rd-card__pad-tight` / `.rd-card__hero` | Padding modifiers |
| `.rd-btn` / `.rd-btn--primary` / `.rd-btn--ghost` / `.rd-btn--quiet` / `.rd-btn--sm` | Button variants |
| `.rd-pill` / `.rd-pill--accent / --green / --blue / --amber / --red` | Status pills |
| `.rd-dot` / `.rd-dot--live / --watch / --review` | Status dots |
| `.rd-input` | Text input with focus ring |
| `.rd-tabs` / `.rd-tab` | Segmented tab bar |
| `.rd-stack` / `.rd-row` / `.rd-row--between` / `.rd-grow` | Layout primitives |
| `.rd-shell` / `.rd-shell--single` / `.rd-shell__main` / `.rd-pane` / `.rd-pane--right` | Layout grid |
| `.rd-composer-dock` | Sticky bottom dock with paper-fade gradient |
| `.rd-shimmer` | Loading shimmer |

---

## `UniversalComposer` API

```typescript
import {
  UniversalComposer,
  DEFAULT_TIERS,
  type RouterTier,
  type RouterTierOption,
} from "@/features/redesign/components/UniversalComposer";

<UniversalComposer
  contextLabel="Asking about: Orbital Labs"   // top-left chip
  onContextChange={() => {/* open picker */}}  // chip click
  onSubmit={(text, tier) => {/* dispatch */}}  // Enter or send-button click
  tier="auto"                                  // controlled tier (omit for uncontrolled)
  onTierChange={setTier}
  tiers={DEFAULT_TIERS}                        // override / extend
  placeholder="Ask, capture, paste..."         // optional override
  hideAttachments={false}                      // pass true to hide + and mic
/>
```

**`DEFAULT_TIERS`**:

```
auto      Auto                    Memory-first · NodeBench picks the right engine    ~1.8s
answer    Quick answer            Fast pass · cached sources only                    ~800ms
deep      Deep dive [$]           Refresh sources · paid call may be required        ~7.5s
compare   Compare across list [$] Run on every entity in this view                   ~12s
```

`[$]` denotes paid-call tiers — UI shows an amber `$` badge on the pill.

### Submit semantics

- **Enter** → submit
- **Shift + Enter** → newline
- **⌘ + Enter** → submit (Mac)
- **Esc** → close any open popover (tier dropdown / `+` menu)

---

## `CardStack` rules

- Max 3 active columns visible
- Breadcrumb shows the full drill path; `+N hops` chip when collapsed
- ← Back goes one hop up
- ← Root resets to the original entity
- "Promote" makes any card the new root
- Older columns dim (opacity 0.92) so the active one stands out

```typescript
<CardStack rootId="ship_demo" />
```

`rootId` must exist in `fixtures.cardStackEntities`. To wire to live data, replace the fixture lookup with a Convex query of the entity graph keyed on `id`.

---

## Mobile responsive

```typescript
// RedesignShell.tsx
const isMobile = useViewportMobile();   // (max-width: 760px)

if (isMobile && surface !== "workspace") {
  return <MobileShell active={surface} onChange={goSurface} />;
}
```

- Workspace stays desktop-only — the 3-column CardStack and Map don't compress
- A floating **Phone** FAB lets you preview MobileShell on a desktop browser without resizing
- Bottom 5-tab nav is mounted at the screen bottom, never collapsed
- Composer dock uses the same `<UniversalComposer />` as desktop (single source of truth)

---

## Adding a new surface

1. Create `src/features/redesign/surfaces/AnalyticsSurface.tsx`
2. Add to `RedesignShell.tsx`:

   ```typescript
   const PATH_TO_SURFACE = { ..., "analytics": "analytics" };

   // inside the render:
   {surface === "analytics" && <AnalyticsSurface />}
   ```

3. Add nav entry to `Rail.tsx`:

   ```typescript
   const NAV: Array<{ id: SurfaceId; ... }> = [
     ..., { id: "analytics", label: "Analytics", hint: "Charts + funnels", icon: "" },
   ];
   ```

4. Add `SurfaceId` literal to `fixtures.ts`
5. Add a sitemap entry to `public/sitemap.xml`

---

## Promoting to production

See [§9 of REDESIGN_ROADMAP.md](../../../docs/architecture/REDESIGN_ROADMAP.md#9--promotion-path-when-ready) — three-phase rollout: discoverability banner → opt-in default with feature flag → full migration with Convex wiring.

The redesign is intentionally a parallel surface so all three phases can be validated independently.

---

## Testing matrix

| Check | How |
|---|---|
| `npx tsc --noEmit --pretty false` | Must exit 0 |
| Surfaces render | Visit `/redesign`, `/redesign/reports`, `/redesign/chat`, `/redesign/inbox`, `/redesign/me`, `/redesign/workspace` |
| Composer popovers | Tier dropdown opens upward; `+` menu opens upward; both dismiss on Esc + click-outside |
| CardStack 3-column max | On Workspace `Cards` tab, drill 3 hops — confirms 3 columns rendered + breadcrumb |
| Mobile shell | Resize to 375 px or click Phone FAB — bottom-tab nav appears, capture-ack visible on Chat |
| Dark mode | Click ◐ FAB — accent shifts, all surfaces remain readable |
| Sitemap | `grep redesign public/sitemap.xml` lists 6 routes |

---

## Cross-refs

- [docs/architecture/REDESIGN_ROADMAP.md](../../../docs/architecture/REDESIGN_ROADMAP.md) — full architecture + journey
- [.tmp/parity-nodebench-locked-memo/.../proposed-design-views.html](../../../.tmp/parity-nodebench-locked-memo/ui_kits/nodebench-locked-memo-layer/proposed-design-views.html) — static HTML mirror of this React route
- [src/App.tsx](../../App.tsx) — `/redesign` route wiring (look for `RedesignShell` lazy import)
- [public/sitemap.xml](../../../public/sitemap.xml) — search-indexable redesign URLs
