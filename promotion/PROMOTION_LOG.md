# Promotion log — NodeBenchAI

Loop state lives here, in git, so any agent can resume cold. One entry per
iteration. Append; never rewrite history, because the list of things that turned
out to be wrong is more useful to the next reader than the current values alone.

Iteration cap: **10** (default). On reaching the cap without a gate pass, stop
and leave the remaining defect ledger below — a documented stop is a valid
outcome; a silent one is not.

## Entry shape

```
### Iteration N — YYYY-MM-DD
- Journey exercised: J<k> <name>
- Observed: <the defect, with its reproduction — inputs, width, state>
- Fixed: <the change, using existing components; file paths>
- Re-proved: <evidence path showing the defect gone in the rendered app>
- Tests: <command and result>
- Conditions newly PASS: <numbers, or "none">
```

---

## Baseline — 2026-08-13

Measured on a fresh `git clone --depth 50` of `main` at
`07a55afea176254e07eebd28ab36701e9f9068da`, Windows 11, Node from the repo's
`.nvmrc`. This is Wave 1: nothing was fixed. Every number below came from a
command run today against that clone.

**App started: partially.** `npx vite --port 5399 --strictPort --host 127.0.0.1`
came up (`ready in 614 ms`) and served the real NodeBench document
(`<title>NodeBench AI — Entity Intelligence…</title>`). But every product route,
including `/redesign/chat`, renders the **"Convex backend not configured"** setup
card instead of the app: `apps/web/src/main.tsx` creates the Convex client as
`convexUrl ? new ConvexReactClient(convexUrl) : null` and renders
`MissingConvexUrlScreen` when it is null. Observed in the browser at
`http://127.0.0.1:5399/redesign/chat` — `document.querySelector('h1').textContent`
=== `"Convex backend not configured"`, and
`[data-agent-runtime-surface="redesign-chat"]` is absent from the DOM.

The documented remedy on that screen is `npx convex dev`, which provisions a
Convex **cloud** deployment against a Convex account. Wave 1 is explicitly
forbidden from creating cloud deployments or setting up secrets, so J1–J4 and
the product half of J5 were not driven. They are UNVERIFIED with that reason,
not FAIL: nothing observed says they are broken, only that they were unreachable
from a clean clone without an account.

**Journeys drivable: 1 of 5, partially.** Only J5's Convex-free equivalent —
`demo/graph-rail/index.html` — reached a working result, and it was driven twice:
once by the repo's own capture gate and once by hand in a browser.

**Commands run, with real exit codes**

| Command | Exit | What it showed |
|---|---|---|
| `git clone --depth 50 …/NodeBenchAI.git` | 0 | 6778 files at `07a55af` |
| `npm install --no-audit --no-fund` | 0 | ~10 min; many deprecation warnings, no failures |
| `npx tsc -p tsconfig.app.json --noEmit --pretty false` | **2** | **5383 errors**; 4641 are `TS2339`, and 4365 error lines mention `never` — the known `api`→`never` cascade |
| `npm run build` | 0 | `✓ built in 15.54s`, PWA precache 339 entries / 22.4 MB |
| `npx vite --port 5399 --strictPort` | (server) | `ready in 614 ms`, serves the NodeBench index |
| `node scripts/capture-graph-rail.mjs` | 0 | `rail: 34 entities, 28 edges (all traversal)` · `labels verified against fixture: 34` · `PASS: zero console errors, non-empty rail, every label traced to the fixture` |
| `npm run test:run` | **1** | 4 segments: app-vitest **failed** (21 failed / 1422 passed / 20 skipped), mcp-local-vitest **failed** (11 failed / 874 passed / 38 skipped), convex-mcp-vitest **failed** (4 failed / 59 passed), openclaw-mcp-vitest passed (30). **36 failing tests total.** |

**Browser observations (the only kind that can move conditions 1–10)**

- `http://127.0.0.1:5399/redesign/chat` at 1280 wide: setup card, `h1` =
  "Convex backend not configured", `scrollWidth === clientWidth === 1280`
  (no horizontal overflow), console had **zero** errors — only Vite's
  `connected` debug line and the React DevTools info notice.
- Same URL at 375×812: `scrollWidth === clientWidth === 375`, no overflow, same
  card. So the one screen a stranger can reach is deliberate at both widths —
  but it is a setup screen, not a journey.
- `demo/graph-rail/index.html` served statically at 1280×900 and again at
  375×812 (fresh mount each time): status line reached
  `34 entities · 28 edges · replay complete`, no horizontal overflow at either
  width.

**Why almost everything is UNVERIFIED.** Conditions 1–10 and 12 are judged on
the rendered application. Four of five journeys never rendered, so there is
nothing to score them on. Marking them PASS because the code looks right is
exactly the failure this vocabulary exists to prevent; marking them FAIL would
claim a defect nobody observed. UNVERIFIED, with the reason written down, is the
true answer.

This repo was flagged in the Wave 1 brief as carrying a **known blocker**: the
`tsconfig.app.json` typecheck is red at HEAD. That was reproduced here (exit 2,
5383 errors) and deliberately **not** fixed — Wave 1 measures, Wave 2 repairs.

## Defect ledger

Open defects, most-impactful first. A defect is only listed once it has a
reproduction; a hunch is not a defect.

| # | Severity | Journey | Reproduction | Status |
|---|----------|---------|--------------|--------|
| D1 | Critical | J1–J4, product half of J5 | Clone clean, `npm install`, start Vite, open `/redesign/chat` (any width). The app renders the "Convex backend not configured" card, never the chat surface. There is no offline, fixture, or local-backend mode for the product routes: the gate is `convexUrl ? new ConvexReactClient(convexUrl) : null` in `apps/web/src/main.tsx`, and the on-screen remedy (`npx convex dev`) requires a Convex cloud account. A stranger following the README cannot reach a single canonical journey. | **Narrowed** (iteration 1). The gate now tests validity, not presence, so D1b below is fixed and gated. The half that remains open is unchanged and needs a backend: with no deployment URL there is still no product surface, and creating one is out of scope. |
| D1b | Critical | J1–J4 | Discovered while reproducing D1, and strictly worse than it. The README's own "Local development" section says `cp .env.example .env.local`, and `.env.example` line 11 ships `VITE_CONVEX_URL=https://your-project.convex.cloud`. That string is non-empty, so `convexUrl ? … : null` accepted it, `MissingConvexUrlScreen` was skipped, and the product mounted: `/redesign/chat` rendered the real shell (`[data-agent-runtime-surface="redesign-chat"]`, `data-empty="true"`, header, starters, composer) against a host Convex refuses to route. `*.convex.cloud` is a wildcard, so the socket connected and the server answered `FatalError: Couldn't parse deployment name your-project`, which `convex/dist/esm/browser/sync/client.js` rethrows out of its message handler before terminating the socket. Measured at both 1280×900 and 375×812: `h1` absent, 3 console/page errors including that uncaught throw, backend permanently dead, remedy card never shown. **So the documented first-run path was the one branch nobody designed.** | **Fixed** — iteration 1. Gated by `node scripts/capture-convex-setup-gate.mjs`; pre-fix run retained at `promotion/evidence/convex-setup-gate/before/report.json`. |
| D2 | Major | build/CI hygiene (blocks condition 11) | `npx tsc -p tsconfig.app.json --noEmit --pretty false` → exit 2 with 5383 errors. 4641 are `TS2339` ("property does not exist") and 4365 error lines mention `never`, i.e. one upstream `api` type collapsing to `never` and cascading. First error is `apps/web/src/App.tsx(88,20): TS2367 … types 'MainView' and '"home"' have no overlap`. `npm run build` still exits 0, so the red typecheck is invisible to anyone who only builds. | Open — known blocker, out of scope for Wave 1 by instruction |
| D3 | Major | J5 (graph rail) | Load `demo/graph-rail/index.html` in a tab whose viewport is 0 wide (hidden pane, collapsed panel, `display:none` ancestor at mount). Sigma throws an uncaught `Error: Sigma: Container has no width`; the rail renders nothing and `#stats` stays at `0 entities · 0 edges · replaying…` even though `window.__graphRail.done === true`. Then resize the viewport to 375×812 and wait 3 s: `#stats` is **still** `0 entities · 0 edges · replaying…` — it never recovers without a full reload. Reproduced twice, in two separate tabs. The repo's own gate (`scripts/capture-graph-rail.mjs`) cannot catch this because it always mounts at a fixed non-zero viewport. **Caveat, stated so nobody over-reads it:** 0 wide is not itself a supported width, and at 375 and 1280 the surface mounts clean with zero console errors. What makes this Major rather than cosmetic is the *no-recovery* half — mounting inside a collapsed drawer, a `display:none` tab, or a not-yet-laid-out panel is an ordinary product situation, and the rail stays dead afterwards. | Open — baseline, not fixed in Wave 1 |
| D4 | Minor | first-run onboarding | `npm run dev` is `npm-run-all --parallel dev:frontend dev:backend dev:voice`. `dev:backend` is `convex dev`, which blocks on an interactive Convex login, and `dev:voice` requires `.env.local` to exist. A stranger running the documented start command gets an interactive prompt rather than a running app; the frontend-only path (`npx vite`) is not documented anywhere in the README. | Open — baseline |

## Iterations

### Iteration 0 — 2026-08-13 (baseline only; nothing fixed)

- Journey exercised: J5, Convex-free half only (`demo/graph-rail/index.html`).
- Observed: D1, D2, D3, D4 above.
- Fixed: **nothing.** Wave 1 produces a starting line, not a repair. A baseline
  that quietly fixes things is a baseline nobody can compare against.
- Re-proved: n/a.
- Tests: `npm run test:run` → exit 1, 36 failing tests across 3 of 4 segments;
  `npx tsc -p tsconfig.app.json --noEmit` → exit 2, 5383 errors;
  `npm run build` → exit 0.
- Conditions newly PASS: none. **0/12.**

### Iteration 1 — 2026-08-13 — the setup door tested presence, not validity

- **Journey exercised:** J1, first step only (`/redesign/chat` from a clean
  clone), at 1280×900 and 375×812, in two env states.

- **Observed.** Wave 1 recorded half of this defect. Driving it produced the
  other half, which is worse.

  Wave 1's half reproduced exactly: with no `VITE_CONVEX_URL`, every product
  route renders the "Convex backend not configured" card. Then the README's own
  path was driven — "Local development" says `cp .env.example .env.local`, and
  `.env.example` line 11 ships
  `VITE_CONVEX_URL=https://your-project.convex.cloud`. That string is non-empty,
  so `convexUrl ? new ConvexReactClient(convexUrl) : null` accepted it, the
  designed card was skipped, and `/redesign/chat` rendered the **real product
  shell** — `[data-agent-runtime-surface="redesign-chat"]`, `data-empty="true"`,
  header, starters, composer, model pill. `*.convex.cloud` is a wildcard domain,
  so the WebSocket connected and Convex's edge replied
  `FatalError: Couldn't parse deployment name your-project`, which
  `convex/dist/esm/browser/sync/client.js:251-254` rethrows out of its message
  handler before terminating the socket. Three console/page errors, one of them
  an uncaught throw; backend permanently dead; no remedy on screen. A stranger
  following the README lands there, not on the card.

  **Root cause** (`apps/web/src/main.tsx:152`, pre-fix): the gate tested the env
  var for *presence*, never *validity*, so it was wrong in both directions — it
  removed the whole application when the string was empty, and removed the
  *remedy* when the string was wrong. The same
  `convexUrl ? new Client(convexUrl) : null` shape was copied into three more
  web callers (`hooks/useConvexSearch.ts`, `features/notebook/hooks/
  useEntityExpansion.ts`, `features/workspace/lib/useEventWorkspacePersistence.ts`),
  so each one built a client from the same unvalidated string.

- **Fixed.** One guard, at the seam all four callers route through.
  `apps/web/src/lib/convexUrl.ts` exports `resolveConvexUrl()`, which returns
  the URL or `null`. The rule mirrors Convex's own rather than inventing a
  heuristic: a `*.convex.cloud` host must carry a deployment name matching the
  regex in `convex/dist/esm/cli/lib/extractDeploymentNameForWorkOS.js`
  (`[a-z]+-[a-z]+-[0-9]+`), and any other host is left alone because that is the
  self-hosted / local-backend case Convex does not name-parse. All four callers
  now go through it. No new dependency, no new UI — the existing
  `MissingConvexUrlScreen` is what a stranger now reaches on the README path.
  `.env.example` was deliberately **not** edited, so the evidence shows the
  documented path landing on the designed card without moving the landmine.

- **Re-proved** in the rendered app, not inferred.
  `node scripts/capture-convex-setup-gate.mjs` boots Vite twice (env unset, then
  the placeholder read live out of `.env.example`), loads `/redesign/chat` at
  both widths, and asserts the card, the absence of a mounted product surface,
  zero console/page errors, and no horizontal overflow.
  - Pre-fix (fix stashed, same script): **exit 1**, 2 of 4 cases FAIL —
    `promotion/evidence/convex-setup-gate/before/report.json` plus its four PNGs.
  - Post-fix: **exit 0**, 4 of 4 ok —
    `promotion/evidence/convex-setup-gate/report.json` plus its four PNGs.

- **What is NOT fixed, stated plainly.** The other half of D1 stands: with no
  Convex deployment there is still no product surface, and every canonical
  journey still needs a backend. Provisioning one means a Convex account or a
  downloaded local backend, both out of scope for this wave, so J1–J4 stay
  UNVERIFIED for the same reason Wave 1 gave. This iteration removed the failure
  mode that was reachable without a backend; it did not manufacture a product
  that has none.

- **Tests:** `npx vitest run apps/web/src/lib/convexUrl.test.ts` → exit 0,
  5 passed. `npm run build` → exit 0, PWA precache 338 entries / 22.5 MB.
  `npm run test:run` → exit 1 (app-vitest 22 failed / 1426 passed / 20 skipped,
  mcp-local timed out at 300 s, convex-mcp 5 failed / 58 passed, openclaw-mcp
  30 passed). **No failure was added.** The app segment was re-run on the
  pre-fix tree on the same machine with the new test file moved out — 22 failed
  / 1421 passed / 20 skipped — and the 22 failing test names `diff` identical to
  the post-fix run. The whole delta is the +5 passing tests this change brings.
  Wave 1 reported 21/1422 for the same segment, so these suites are flaky by ±1
  run to run; that is a fact about the suite, not about this change.

- **Conditions newly PASS:** 12. **1/12.**

