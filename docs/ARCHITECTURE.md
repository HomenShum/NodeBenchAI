# NodeBench AI — Architecture Map

> One page. Updated whenever a route or canonical component changes.
> If your change makes this doc wrong, update it in the same PR.

This is the navigation map a new engineer should read on Day 1. It answers
the question every new engineer asks: **"Given this URL, what code runs?"**
That's the ground truth for shipping changes safely.

If something here is stale, file an issue with the label `docs:architecture`
or open a PR — this doc is owned by everyone.

---

## TL;DR — what NodeBench is

NodeBench is the **operating-memory and entity-context layer for agent-native
businesses.** The product has five locked web surfaces: Home / Reports / Chat /
Inbox / Me. Desktop root traffic currently promotes into the modern
`/redesign` shell, while mobile and compatibility routes still preserve the
five-surface cockpit contracts. Backend state lives in Convex. Frontend runs on
Vite + React and deploys via Vercel.

**The one-flow invariant** the entire product is gated against:

```
Chat → entity report → notebook → graph/cards → sources → export
```

Every PR's Tier B preview test runs this flow against the Vercel preview URL.
If your change breaks it, CI blocks the merge.

---

## Hard constraints (lifted from sprint-spec, non-negotiable)

These are project commitments, not preferences:

1. **Kit alignment is canonical.** When a design kit packet drops, implement
   the delta against the current prod-parity shell. `/redesign` is the active
   modern shell; `ExactKit` remains a compatibility/cockpit surface and should
   not receive unrelated new forks.
2. **Convex is canonical for backend state.** No SQL dual-store, no Postgres,
   no custom session DB. If a surface needs persisted data, it's a Convex
   table.
3. **Pi-mono is canonical for multi-LLM.** All LLM calls flow through
   `@mariozechner/pi-ai` + `@mariozechner/pi-agent-core`. Do not import
   provider SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`) directly
   in app code.
4. **One canonical version of every surface.** Components named
   `*Premium`, `*Enhanced`, `*Legacy`, or `*V2` are migration intent — not
   permanent forks. Every duplicate either becomes canonical, donor, or
   `@deprecated`.
5. **Live data is canonical for authenticated users; seed is canonical for
   anonymous demo.** Components must gate `useQuery` results with the
   correct shape: `useQuery(api?.X ?? "skip", args)` — never
   `useQuery(api?.X ?? { args })`. This prevents legacy/demo components from
   accidentally shadowing live Convex-backed paths.
6. **PRs ≤ 400 LOC of substantive change.** Larger PRs split or
   pre-discuss. The auto-merge gate doesn't enforce this; reviewer (you)
   does.
7. **Branch protection enforces CI.** `Typecheck`, `Runtime smoke`, `Build`,
   `Tier B vs preview URL` are required. `enforce_admins: true`. Use
   `gh pr merge --auto --squash --delete-branch`, never `--admin`.
8. **No new feature work during stabilization sprints.** `@deprecated`,
   delete, merge, fix — yes. New surfaces or net-new features — no.

---

## Tech stack (one place, definitive)

| Layer | Choice | Lock |
|---|---|---|
| Package manager | npm | Lockfile is `package-lock.json` (committed) |
| Runtime | Node 22 LTS | Pinned by `.nvmrc` and `engines` |
| Build | Vite 8 + esbuild | `npm run build` |
| Type-check | TypeScript strict | `npx tsc --noEmit` |
| Linter | Biome (some surfaces); legacy ESLint elsewhere | Migration in progress |
| Frontend framework | React 19 | Keep compatibility with current Vite/React toolchain |
| Routing | Custom dispatcher: `src/lib/registry/viewRegistry.ts` + `src/layouts/ActiveSurfaceHost.tsx` | Not React Router |
| State | Convex live queries (no Redux/Recoil/MobX/Zustand for product data) | App-local UI state uses `useState`/`useReducer` |
| Styling | Tailwind v3 + CSS variables; kit-specific CSS in `exactKit.css` | No CSS-in-JS |
| Component primitives | Radix + shadcn-style | In `src/shared/ui/` |
| Icons | `lucide-react` | Single source |
| Backend | Convex (serverless) | Deploy: `npx convex deploy` |
| LLMs | `@mariozechner/pi-ai` + `pi-agent-core` (multi-provider via OpenRouter, Anthropic, OpenAI, etc.) | No direct provider SDKs |
| Hosting | Vercel (frontend) + Convex (backend) | Decoupled deploys |
| Testing | Vitest (unit), Playwright (e2e) | `npm run test:run` (unit), `npx playwright test` (e2e) |
| CI | GitHub Actions | `.github/workflows/ci.yml` + `tier-b-preview.yml` + `convex-deploy.yml` + `vercel-deploy-hook-backup.yml` |
| Commits | Conventional Commits | `feat:`, `fix:`, `chore:`, etc. |

---

## Repository layout

```text
src/
  features/
    redesign/                  # Active modern shell mounted at /redesign
                               # Home / Reports / Chat / Inbox / Me + Workspace
    designKit/exact/           # Compatibility cockpit surfaces
                               # ExactKit.tsx + exactKit.css
    chat/                      # Shared chat lane/components, not the primary shell
    reports/                   # ReportNotebookDetail (notebook tab, legacy direct-link)
                               # PublicReportView (public /report/:id route)
    research/                  # ReportDetailPage (legacy /reports/:id/graph route)
                               # ResearchHub (the /research surface)
    notebook/components/       # RichNotebookEditor (canonical TipTap editor)
    entities/                  # EntityPage (the /entity/:name route)
                               # EntityNotebookSurface + EntityNotebookView (lazy-load pair)
    agents/                    # FastAgentPanel (Ask NodeBench right-rail)
                               # primitives/AgentComposer (future composer canonical)
    home/views/                # HomeLanding (mobile/root compatibility)
    me/views/                  # MeHome (cockpit)
  layouts/
    ActiveSurfaceHost.tsx      # ★ ROUTING DISPATCHER — read this first
    settings/SettingsModal.tsx
  lib/
    registry/viewRegistry.ts   # ★ Routes ↔ component map — read this second
  shared/ui/                   # Atomic UI primitives (Button, Card, etc.)
  styles/                      # Global stylesheets

convex/
  schema.ts                    # ★ Canonical schema — every Convex table
  domains/
    product/                   # entities, reports, activity ledger, event workspace
    agents/                    # adapters/openai/openaiAgentsAdapter.ts (pi-agent-core wrapper)
                               # spiral/spiralDetector.ts (anti-loop heuristic)
                               # lessons/captureLesson.ts (semantic memory)
    integrations/              # gmail, gcal, sms
    auth/                      # apiKeys, userPreferences, usage
    analytics/                 # ossStats
  _generated/                  # ★ DO NOT EDIT — regenerated by `npx convex codegen`

packages/
  mcp-local/                   # 304-tool MCP server (separate publish)
  mcp-client/                  # Typed client SDK
  convex-mcp-nodebench/        # Convex auditor

server/                        # Voice WebSocket server (Express)
  index.ts                     # Voice transcription gateway
  mcpGateway.ts                # WebSocket MCP gateway
  routes/search.ts             # Search route with 4-layer grounding pipeline

scripts/
  vercel-build.sh              # ★ Vercel build entry (frontend only since decouple)
  preflight-deploy.mjs         # Pre-deploy checks (CI gate input)
  post-deploy-verify.mjs       # Post-deploy live-DOM verification

tests/e2e/                     # Playwright suites
  exact-kit-parity-prod.spec.ts # Tier B regression (per-surface kit selectors)
  one-flow-regression.spec.ts   # ★ The canonical user-journey test

docs/
  ARCHITECTURE.md              # ★ This file
  runbooks/                    # PROD_PARITY_UI_KIT_WORKFLOW, etc.

.github/workflows/
  ci.yml                       # Required: Typecheck + Runtime smoke + Build
  tier-b-preview.yml           # Required: Playwright vs Vercel preview URL
  convex-deploy.yml            # Decoupled Convex deploy on push to main
  vercel-deploy-hook-backup.yml # Belt-and-suspenders for Vercel webhook drops
```

---

## The 5-surface cockpit (canonical user routes)

The product is a 5-surface cockpit. **Every surface URL routes through
`ActiveSurfaceHost.tsx` to a kit-aligned `Exact*Surface` component.** The
older feature-folder components (`ChatHome`, `ReportsHome`, etc.) are either
`@deprecated` or only reachable via direct deep-links.

| URL | Surface key | Renders | Convex queries | Test coverage |
|---|---|---|---|---|
| `/?surface=home` or `/` | `ask` | `ExactHomeSurface` | `getProductPulseMetrics`, `listEntitiesWatchedByUser` | `one-flow-regression` (Step 1) + `exact-kit-parity-prod` PR A1 |
| `/?surface=chat` | `workspace` | `ExactChatSurface` | (seed only currently — chat backend writes `productActivityLedger`, `productEventWorkspaces`) | `one-flow-regression` (Step 2) + `exact-kit-parity-prod` PR A5 |
| `/?surface=reports` | `packets` | `ExactReportsSurface` (grid) → `ExactReportDetailSurface` (when `&report=X`) | `listProductReports`, `getProductReportById` | `one-flow-regression` (Step 3) + `exact-kit-parity-prod` PR A2 |
| `/?surface=inbox` | `history` | `ExactInboxSurface` | `listInboxItems` (seed fallback for anon) | `one-flow-regression` (Step 4) + `exact-kit-parity-prod` PR A4 |
| `/?surface=me` | `connect` | `ExactMeSurface` | `getProductPulseMetrics` (Today's pulse) | `one-flow-regression` (Step 5) + `exact-kit-parity-prod` PR A3 |
| Avatar HS button (any surface) | n/a — opens panel | Inline `ExactAvatarMenu` | Same as `/?surface=me` + `getProductPulseMetrics`, `listEntitiesWatchedByUser`, `listRecentSessions` | `one-flow-regression` (Step 6) + `exact-kit-parity-prod` PR A9 |

### Routing dispatch detail

Every cockpit URL flows through `src/layouts/ActiveSurfaceHost.tsx::renderSurface()`:

```ts
switch (surfaceId) {
  case "ask":       return <ExactHomeSurface />;
  case "workspace": return <ExactChatSurface />;
  case "packets":   return <ExactReportsSurface />;
  case "history":   return <ExactInboxSurface />;
  case "connect":   return <ExactMeSurface />;
}
```

`viewRegistry.ts` maps the URL paths and surface IDs. The deep-link branch
(`directRouteComponent`) resolves view IDs whose `component` field is set in
the registry. Cockpit views (`chat-home`, `reports-home`, `me-home`) have
`component: null` because they're handled by the switch above.

---

## Deep-link routes (legacy direct URLs, kept for share/embed)

Not all routes go through the cockpit. These bypass `ActiveSurfaceHost` and
render directly in `src/App.tsx`:

| URL | Renders | Auth | Notes |
|---|---|---|---|
| `/report/:id` | `PublicReportView` | Public | Anonymous read-only report. Different visual style (dark glass). |
| `/reports/:reportId/graph` | `ReportDetailPage` | Yes | Authenticated workspace view |
| `/reports/:reportId/notebook` | `ReportNotebookDetail` | Yes | Notebook editor — separate component (consolidation deferred to multi-PR migration) |
| `/share/:token` | `PublicEntityShareView` | Token | Token-gated anonymous diligence brief |
| `/memo/:id` | `ShareableMemoView` | Public | Anonymous shareable Decision Memo |
| `/company/:slug` | `PublicCompanyProfileView` | Public | Company intelligence |
| `/embed/:type/:id` | `EmbedView` | Public | Iframe-friendly widget |
| `/entity/:name` | `EntityPage` | No | Entity detail (notes + sources) |
| `/research` (+ tab paths) | `ResearchHub` | No | Research hub with tabs |
| `/workspace` (host=workspace) | `UniversalWorkspacePage` | Yes | Standalone workspace surface (separate Vercel deploy) |

> ⚠️ **Reports detail is not yet consolidated.** The kit canonical for the
> authenticated cockpit reports view is `ExactReportDetailSurface`
> (rendered inline by `ExactReportsSurface` when `?report=X` is set).
> The 3 legacy routes above all render older components. Migration is a
> deferred multi-PR effort tracked in the stabilization-sprint backlog.

---

## Build & deploy chain

```
git push origin main
  ↓ (GitHub webhook)
  ├──> Vercel auto-deploy
  │       ↓
  │     scripts/vercel-build.sh   # frontend only (decoupled)
  │       ↓
  │     npm run build → .vercel/output → CDN
  │
  ├──> .github/workflows/vercel-deploy-hook-backup.yml  # belt-and-suspenders if webhook drops
  │
  └──> .github/workflows/convex-deploy.yml  # Convex push (decoupled)
          ↓
        npx convex deploy → agile-caribou-964.convex.cloud
```

**Decoupled invariant:** A Convex push failure does NOT block the frontend
deploy, and vice versa. Race window for "new frontend calls a not-yet-deployed
Convex function" is ~30-60s. Acceptable trade-off for the velocity gain.

If a deploy is stuck, prefer **`vercel build --prod && vercel deploy --prebuilt --prod`** over `vercel --prod`. The latter uses your CWD's package-lock and can break on the linux-x64 sharp binary if you're on Windows. `vercel redeploy <existing-url>` rebuilds the SAME commit, not current main — useless for getting recent merges live.

---

## Test layers

| Layer | What | When | Location |
|---|---|---|---|
| Unit | Pure-function logic (parsers, helpers, schema validators) | `npm run test:run` and on every PR via `Runtime smoke` job | `src/**/*.test.ts`, `convex/**/*.test.ts` |
| Component | React components in isolation | Vitest with `@testing-library/react` | `src/**/*.test.tsx` |
| Integration | Convex actions + mutations against the dev backend | Vitest | `convex/**/*.test.ts` |
| E2E | Playwright against a built app | Locally and on every PR via `Tier B vs preview URL` | `tests/e2e/*.spec.ts` |
| **One-flow regression** | The canonical user-journey: Home → Chat → Reports → Inbox → Me → Avatar panel + interactive chip behavior | On every PR (CI required) | `tests/e2e/one-flow-regression.spec.ts` |
| **Tier B kit parity** | Per-surface kit selectors render correctly | On every PR (CI required) | `tests/e2e/exact-kit-parity-prod.spec.ts` |

---

## Where to make a change — first-PR cheat sheet

You want to change something. Here's the deterministic answer:

| Goal | Edit this | DON'T edit this |
|---|---|---|
| Change how the modern chat surface looks/behaves | `src/features/redesign/surfaces/ChatSurface.tsx` + `src/features/redesign/primitives.css` | Reintroducing deleted `ChatHome`/parallel premium surfaces |
| Add a new field to entity reports | `convex/schema.ts` (productReports table) → mutation in `convex/domains/product/entities.ts` → render in `ExactReportDetailSurface` | A separate "EnhancedReportDetail" component |
| Add a new MCP tool | `packages/mcp-local/src/tools/<your-tool>.ts` + register in `toolRegistry.ts` | A new tool file outside `packages/mcp-local/` |
| Change a Convex backend handler | The relevant `convex/domains/<domain>/<file>.ts` | Don't import provider SDKs directly — go through `pi-agent-core` |
| Add a route | `src/lib/registry/viewRegistry.ts` (add view ID + path) → handler in `ActiveSurfaceHost.tsx` switch | Don't add direct routes in `App.tsx` unless you specifically need to bypass the cockpit dispatcher (e.g. anonymous public share URLs) |
| Change a compatibility cockpit stat | `src/features/designKit/exact/ExactKit.tsx` | The shape of the underlying Convex query has fallback semantics — read `Hard constraints #5` first |

### The 4-axis canonical determination rule

If you find two components that look like they do the same thing, **don't
guess which is canonical.** Run all 4:

1. **Kit alignment** — does it implement the kit's design contract? (Class
   names prefixed `nb-*` are kit-canonical.)
2. **Production DOM** — `curl https://www.nodebenchai.com/?surface=X` and
   grep for class names. The actually-rendered selectors win.
3. **Routing code** — trace `viewRegistry.ts` + `ActiveSurfaceHost.tsx`.
   `component: null` means the switch in ActiveSurfaceHost owns it.
4. **Git recency** — `git log -1 --format='%ar | %s' -- <file>`. Recent
   meaningful edits = active development = likely canonical.

If 4-axis says one is canonical and the other isn't, **stamp the
non-canonical with `@deprecated` JSDoc + redirect comment** (see
the existing deprecation patterns). Don't delete immediately if a route still
imports the file; stamp first, then delete after route/test confirmation.

---

## How to add a feature without breaking the flow

Per the sprint spec, every PR must answer:

> **Does this strengthen the core flow? Chat → report → notebook → graph → export.**

Concrete checklist:

1. Identify which surface(s) the change touches.
2. Trace the routing dispatcher (above) — confirm you're editing the
   actually-rendered component, not a `@deprecated` legacy.
3. If your change touches Convex, run `npx convex codegen` locally; CI
   does this too but local-first catches it earlier.
4. Add or update a test in `tests/e2e/one-flow-regression.spec.ts` if your
   change modifies a step in the canonical flow.
5. Update this doc if you've added/removed a route or changed a canonical
   component.
6. Open the PR. Use `gh pr merge --auto --squash --delete-branch` (NOT
   `--admin --squash`).
7. Required CI checks: `Typecheck`, `Runtime smoke`, `Build`,
   `Tier B vs preview URL`. Auto-merge fires when all green.

---

## Open known issues (carry-forward backlog)

These are real issues, called out so future sessions don't re-discover them:

- **Reports detail consolidation** — kit canonical is
  `ExactReportDetailSurface`, but `/reports/:id/graph`, `/reports/:id/notebook`,
  and `/report/:id` still render legacy components. Multi-PR migration
  needed.
- **Notebook routing duplication** — `/reports/:id/notebook` renders
  `ReportNotebookDetail`, a separate file from the cockpit's notebook view.
  Should consolidate into the same shell with tab navigation.
- **EvidencePanel → SourceCard** — `EvidencePanel` (7 weeks stale) is
  rendered by `ActAwareDashboard` but visually duplicates `SourceCard`.
  Merge with `layout` prop.
- **HomeLandingEnhanced** is in-flight WIP — not yet wired through any
  route. Either complete the wiring or remove.
- **9 zombie Vercel projects** — `mom_rover_campaign`, `landing_page`,
  `perficient_interview`, `next-app`, `dist`, `nodebench-ai-ship`,
  `frontend`, `prod-deploy`, `pawpaw-pet-care` (`pawpaw-pet-care` may be
  intentional). Triage when convenient.
- **2 write-only Convex schema fields** — `productReports.notebookUpdatedAt`,
  `productEventWorkspaces.activeEventSessionId`. Need investigation before
  delete.
- **CRLF / autocrlf** — fixed in this checkout (`core.autocrlf=input`),
  but new clones default to Windows behavior. New engineers on Windows
  should run `git config core.autocrlf input` after clone.

---

## Glossary

| Term | Meaning |
|---|---|
| **Kit** | The design system. Lives in `src/features/designKit/exact/`. Every cockpit surface routes here. |
| **Cockpit** | The 5-surface main app shell (`/?surface=X`). Internal label — user-facing copy uses each surface's name. |
| **Surface** | One of the 5 top-level views (`ask`, `workspace`, `packets`, `history`, `connect`). User-facing labels: Home, Chat, Reports, Inbox, Me. |
| **Direct route / deep link** | A URL that bypasses the cockpit dispatcher (e.g. `/report/:id` for public share). |
| **Exact*Surface** | The kit-canonical implementation of a surface (e.g. `ExactChatSurface`). |
| **Anonymous fallback / seed** | Demo data shown to unauthenticated visitors. Live data only renders for authenticated users. |
| **4-axis canonical determination** | The rule for resolving which component is canonical when grep finds 2+ candidates: kit + production DOM + routing code + git recency. |
| **MCP** | Model Context Protocol. The 304-tool server in `packages/mcp-local/` exposes NodeBench capabilities to other agents. |
| **Tier B regression** | The Playwright suite that runs against the Vercel preview URL on every PR. Required check. |
| **One-flow regression** | The canonical user-journey test (Home → Chat → Reports → Inbox → Me → avatar panel). Required check. |
| **`@deprecated` stamp** | A JSDoc tag at the top of a file that warns: "this file is not rendered in production; edits here are phantom maintenance." Pattern from PR #187 (ChatHome). |
| **Phantom maintenance** | The pattern of editing a `@deprecated` file thinking it's canonical. Caused 4-PR loops earlier. The deprecation stamps prevent recurrence. |

---

## When this doc is wrong

If a route or canonical changes and this doc doesn't get updated, file an
issue with label `docs:architecture` or open a PR. **This doc is owned by
the team; nobody approves "I'll update it later."**
