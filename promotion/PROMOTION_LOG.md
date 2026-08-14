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
| D1 | Critical | J1–J4, product half of J5 | Clone clean, `npm install`, start Vite, open `/redesign/chat` (any width). The app renders the "Convex backend not configured" card, never the chat surface. There is no offline, fixture, or local-backend mode for the product routes: the gate is `convexUrl ? new ConvexReactClient(convexUrl) : null` in `apps/web/src/main.tsx`, and the on-screen remedy (`npx convex dev`) requires a Convex cloud account. A stranger following the README cannot reach a single canonical journey. | **Closed as a blocker** — iteration 2. With a deployment provisioned, J1/J2/J4 run end to end at 1280 and 375 (`promotion/evidence/live-journey/report.json`, exit 0). Two real defects sat behind the door and were fixed (undeclared `@convex-dev/crons`; a module-analysis-time throw for an unconfigured OpenRouter key that failed the whole push). What is *not* fixed and is not a defect: the product still requires a Convex deployment, which is the architecture. The setup path is now written down — `docs/START_HERE.md` "Before Step 1" and `docs/codebase/CONCERNS.md` C7b. |
| D1b | Critical | J1–J4 | Discovered while reproducing D1, and strictly worse than it. The README's own "Local development" section says `cp .env.example .env.local`, and `.env.example` line 11 ships `VITE_CONVEX_URL=https://your-project.convex.cloud`. That string is non-empty, so `convexUrl ? … : null` accepted it, `MissingConvexUrlScreen` was skipped, and the product mounted: `/redesign/chat` rendered the real shell (`[data-agent-runtime-surface="redesign-chat"]`, `data-empty="true"`, header, starters, composer) against a host Convex refuses to route. `*.convex.cloud` is a wildcard, so the socket connected and the server answered `FatalError: Couldn't parse deployment name your-project`, which `convex/dist/esm/browser/sync/client.js` rethrows out of its message handler before terminating the socket. Measured at both 1280×900 and 375×812: `h1` absent, 3 console/page errors including that uncaught throw, backend permanently dead, remedy card never shown. **So the documented first-run path was the one branch nobody designed.** | **Fixed** — iteration 1. Gated by `node scripts/capture-convex-setup-gate.mjs`; pre-fix run retained at `promotion/evidence/convex-setup-gate/before/report.json`. |
| D5 | Major | J1 error path | Sign in, type a 2-character prompt (`ab`), submit. `startChat` correctly rejects it at the trust boundary — but the **reason never reaches the screen**. The turn reads only "Live chat is not running / The live chat run could not be started."; the actual message, `Prompt too short — write at least a 3-character question.`, appears **only in the browser console**. Measured 2026-08-14, captured in `promotion/evidence/live-journey/report.json` (check "Condition 5…", compare `detail.turn` with `detail.consoleErrors[0]`) and `09-validation-error-desktop.png`. The user is told something failed and given no way to know what to change. | Open — found by iteration 2, not fixed in it |
| D6 | Major | conditions 7 and 10 | Two independent measurements of the same root cause, both on the production build under `vite preview`, signed out, at `/redesign/chat`. (a) Lighthouse 13.4.1 default (mobile emulation, throttled): **performance 56**, **LCP 10 827 ms**, FCP 6 883 ms — TBT 193 ms and CLS 0.0028 are fine, so the problem is bytes on the wire, not main-thread work. The build reports a PWA precache of **338 entries / 22 518 KiB**. (b) The Web Interface Guidelines review found four major deviations: no `<h1>` and no skip link on the only route the product has, three sub-44px touch targets at 375 including the 44×36 submit button, and a 14.5px composer font that triggers iOS Safari auto-zoom. Artifacts: `promotion/evidence/web-quality/summary.json`, `promotion/evidence/wig-review/REVIEW.md`. | Open — found by iteration 2, not fixed in it |
| D7 | Major | J1 | Ask the same freshness-intent question ("What has changed at Anthropic in the last year?") repeatedly on the same deployment, signed in. The number of grounded sources attached to the answer was **3, 2, 1, 0, 1 and 0** across six consecutive runs on 2026-08-14 with the same model, tier and settings. Not a width effect — re-asking a 0-source question at 1280 in a fresh session returned 0 again. On the zero runs `fallback_source_search` fires and reports status `warning`, `bind_evidence` warns, and the packet correctly shows "Source needed: no supported URL is available, so source-strength and claim-strength comparisons are unverified." So the app **degrades honestly**, which is why this is Major and not Critical — but the product's whole promise is "an answer with its sources counted and attached", and a third of runs deliver none, with no retry offered and nothing telling the user that re-asking might work. Reproduce with `node scripts/capture-live-journey.mjs` a few times and diff `report.json` → `results[2].detail.sourceCount`. | Open — found by iteration 2, not fixed in it |
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

### Iteration 2 — 2026-08-14 — the backend was stood up, and nine conditions stopped being hypothetical

- **Journey exercised:** J1, J2 and J4, end to end, at 1280×900 and 375×812,
  against a live Convex deployment provisioned for this run.

- **Observed — the other half of D1, and what was actually behind it.**
  Wave 1 and iteration 1 both stopped at the same sentence: "creating a backend
  is out of scope." With that scope opened, the door turned out to have **three**
  locks, and two of them were defects rather than architecture.

  1. `npx convex dev --once --configure new` provisioned fine, then the first
     push died: `Could not resolve "@convex-dev/crons/convex.config"`.
     `@erquhart/convex-oss-stats@0.8.2` imports that module and declares it in
     neither `dependencies` nor `peerDependencies`; with `package-lock.json`
     gitignored (CONCERNS C5b) a fresh install simply may not have it.
  2. With that fixed the push died again, differently:
     `InvalidModules: Failed to analyze domains/agents/digestAgent.js:
     Uncaught Error: OpenRouter model "kimi-k2.6" requested but
     OPENROUTER_API_KEY not configured`. **Root cause**, traced rather than
     guessed: Convex analyses every backend module on every push;
     `domains/agents/core/coordinatorAgent.ts:1390` calls
     `createCoordinatorAgent(DEFAULT_MODEL).asTextAction(...)` at module scope
     because a Convex function must be a module-level export; `DEFAULT_MODEL` is
     `kimi-k2.6`, an OpenRouter model; and `buildLanguageModel` threw *at
     construction* for an unconfigured provider. So a key for a provider that
     `/redesign/chat` never calls made the **entire backend undeployable** —
     no chat, no auth, no persistence — for anyone without an OpenRouter
     account. That is the mechanism by which "the whole system below the trust
     boundary is unrunnable" was true.
  3. Sign-in then failed with `Missing environment variable 'JWT_PRIVATE_KEY'`.
     Convex Auth needs its own keys, and nothing in the repo's setup text said
     so. Not skippable: live research rejects anonymous accounts
     (`requirePaidChatUserId`, `chatRuns.ts:159`).

- **Fixed.** Two changes, both at the seam every caller routes through.
  - `package.json`: `@convex-dev/crons` declared as a direct dependency, because
    the package that needs it does not.
  - `backend/convex/domains/agents/mcp_tools/models/modelResolver.ts`:
    `buildLanguageModel` no longer throws when a provider key is missing. It
    returns a `LanguageModel` whose `doGenerate`/`doStream` throw the same
    sentence, so **the error is moved, not removed** — an unconfigured provider
    now fails the call that needs the key instead of the deploy that does not.
    Applied to the `google` branch as well, which had the identical shape.
    Gated by a new case in `modelResolver.test.ts` that deletes
    `OPENROUTER_API_KEY`, constructs `DEFAULT_MODEL`, and asserts both that
    construction succeeds and that calling it still rejects.
  - The three setup commands are now written down in `docs/START_HERE.md`
    ("Before Step 1") and `docs/codebase/CONCERNS.md` (C7b), including both
    traps above, so the next cold reader does not rediscover them.

- **Re-proved in the rendered app.** `node scripts/capture-live-journey.mjs
  --port 4902` → **exit 0**, 9 of 9 checks ok. Report and eight screenshots at
  `promotion/evidence/live-journey/`. What it asserts, none of it inferred:
  - the surface mounts with `data-empty="true"` on a live backend;
  - after submit the transcript holds two turns, the assistant turn carries a
    `data-chat-run-id`, and the live-research checklist is on screen;
  - the sealed turn agrees with itself: this capture landed `Auto · 0 sources`,
    so it carries the honest "Source needed: no supported URL is available…"
    notice and **no** evidence rows; five tool rows are present (including
    `fallback_source_search` and `bind_evidence` at status `warning`); and it is
    **not** the unavailable fallback. The gate asserts the invariant in both
    directions — see D7 on why it cannot assert `sources >= 1`;
  - the run row reaches `status: "complete"` with **30** durable event rows in
    `redesignChatStreamEvents`, `idx` strictly increasing, including `tool_call`
    and `packet_complete` — read back out of Convex, so "it streamed" and "it
    persisted" are proven separately;
  - `/redesign/chat/r/1znqpv1wpmh0` opened in a **cold context** reaches
    `data-state="ready"` with matching text, and `getLatestOwnedRun().runId` is
    unchanged across it — the link replays, it does not re-run;
  - Stop produces "Cancellation recorded…" and a turn that says the run was
    cancelled, with **no** sealed packet, and the session takes the next
    question (4 turns → 6);
  - zero console errors and zero failed requests across the whole journey;
  - at 375: mounts, answers, `scrollWidth === clientWidth === 375`, zero
    console errors.

- **Three gate bugs found in this gate, worth recording because each one would
  have produced a false result.** (a) Waiting for "SOURCES … evidence rows"
  *hangs* on an answer with 0 sources instead of failing it; (b) relaxing that
  to the packet header matched the RuntimeBoard **mid-stream**, so every later
  check read a half-finished run and reported `status: "running"` as a product
  defect; (c) asserting a cancelled turn contains no "evidence rows" failed a
  perfectly correct cancellation, because `liveChatUnavailableMarkdown`'s own
  copy contains the phrase "stream tool events, evidence rows". The gate now
  asks the **run row** whether the run is terminal and matches the sealed
  packet's cost header, not prose.

- **Audits, finally runnable because there is finally a surface.**
  - `node scripts/audit-web-quality.mjs` (Lighthouse 13.4.1 + @axe-core/cli
    4.13.0 against the **production build** under `vite preview`, signed out):
    performance **56**, accessibility **96**, best-practices **100**, SEO
    **100**; LCP **10 827 ms**, FCP **6 883 ms**, TBT **193 ms**, CLS **0.0028**.
    axe: **2 violations, both moderate, 0 serious/critical**
    (`landmark-one-main`, `page-has-heading-one`).
    Artifacts: `promotion/evidence/web-quality/{lighthouse.json,axe.json,summary.json}`.
  - `node scripts/review-web-interface-guidelines.mjs` + the written review at
    `promotion/evidence/wig-review/REVIEW.md`: **4 major findings** — no `<h1>`
    on the primary surface, no skip link, three sub-44px touch targets at 375
    including the submit button (44×36), and a 14.5px composer font that will
    trigger iOS Safari auto-zoom. This is a review, not a Lighthouse score; the
    two measure different things and both are committed separately.

- **Tests:** `npx vitest run backend/convex/domains/agents/mcp_tools/models/modelResolver.test.ts`
  → exit 0, 4 passed (3 pre-existing + 1 new). `node node_modules/vite/bin/vite.js build`
  → exit 0, PWA precache 338 entries / 22 518 KiB. `npm run build` still fails
  on this machine before Vite runs — its first step shells out to
  `npx esbuild` for a Vercel serverless bundle and the shim is not resolvable
  here; that is unrelated to the rendered page and unchanged by this iteration.
  The full `npm run test:run` was **not** re-run this iteration, so condition 11
  keeps iteration 1's measurement rather than a fresh one.

- **A measurement that changed what this gate can assert, recorded so nobody
  re-derives it.** The first version asserted `sources >= 1` on the answer. The
  same prompt, model and settings produced **3, 2, 1, 0, 1 and 0** grounded sources
  across five consecutive runs — Gemini decides how many `groundingChunks` come
  back, and a 0-source answer is a *designed* state that says so
  ("Source needed: no supported URL is available…", `chatRuns.ts:843`). Verified
  it is not a width effect by re-asking the 0-source question at 1280 in a fresh
  session: 0 sources again. So the gate now asserts the invariant that actually
  holds — count and evidence agree, and a zero count is *stated* — in both
  branches. A gate that fails a third of the time for reasons outside the repo
  teaches people to ignore it.

- **Found but not fixed** (added to the ledger, not silently carried): **D5**,
  the server's validation reason never reaches the screen; **D6**, LCP 10.8 s on
  the production build plus four major Web Interface Guidelines deviations.

- **Conditions newly PASS:** 1, 3, 4, 5, 6, 9. **7/12.**

