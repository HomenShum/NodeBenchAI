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
| D1 | Critical | J1–J4, product half of J5 | Clone clean, `npm install`, start Vite, open `/redesign/chat` (any width). The app renders the "Convex backend not configured" card, never the chat surface. There is no offline, fixture, or local-backend mode for the product routes: the gate is `convexUrl ? new ConvexReactClient(convexUrl) : null` in `apps/web/src/main.tsx`, and the on-screen remedy (`npx convex dev`) requires a Convex cloud account. A stranger following the README cannot reach a single canonical journey. | Open — baseline, not fixed in Wave 1 |
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

