# Product goal — NodeBenchAI

## Who opens this, and what they are trying to finish

Someone has been asked a question about a company or a market that they cannot
answer from memory, and they have an hour before they have to defend the answer
to a partner, a committee, or a customer. Today it is "what has actually changed
at this company since we passed on them last year?" The failure they are trying
to avoid is the ordinary one: they paste the question into a chatbot, get a
confident paragraph, cannot tell which sentence came from a real source, and end
up doing the reading themselves anyway — and if anyone asks the next morning
where a number came from, re-running the same prompt gives a different paragraph
and the trail is gone. NodeBench is one text box where they type that question
and get back a written answer with its sources counted and attached, a permanent
link that replays that exact answer rather than generating a new one, and a way
to correct a wrong sentence in place so the next run is better. They walk away
holding a link they can paste into an email, not a screenshot of a chat. Behind
that single box the app keeps saved reports, watched entities, and a graph of
who is connected to whom; none of them is a separate page to learn, because
every URL in the web app resolves to the same conversation surface
(`/redesign/chat`).

## The gate

This repo is judged by the twelve-condition PROMOTION gate, which lives in one
place and is not restated here:

**https://github.com/HomenShum/NodeKit/blob/main/templates/promotion/GATE.md**

Gate variant: `full` — NodeBench ships a hosted web application with five
user-facing journeys, not a library with a quickstart.

Scoring vocabulary is PASS / FAIL / **UNVERIFIED**, and UNVERIFIED is never PASS.

## Canonical journeys

The work queue lives in [PRODUCT_JOURNEYS.md](PRODUCT_JOURNEYS.md). A journey
without browser evidence is unfinished, however green the tests are.

## Loop state

Every iteration is recorded in [PROMOTION_LOG.md](PROMOTION_LOG.md) — journey
exercised, defect fixed, evidence path, conditions newly passing. Loop state
lives in git, never in an agent's memory, so any agent can resume the loop cold.

## Current scorecard

Baseline measured 2026-08-13 against a fresh clone of `main` at
`07a55afea176254e07eebd28ab36701e9f9068da`. Wave 1 measures; it does not repair.
Every row below is either something observed today or a stated reason it could
not be observed.

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | UNVERIFIED | Not drivable from a clean clone. Vite came up on `127.0.0.1:5399`, but `/redesign/chat` renders the "Convex backend not configured" card (`h1` observed in the DOM), and `[data-agent-runtime-surface="redesign-chat"]` is absent. Reaching J1–J4 needs a Convex cloud deployment, which Wave 1 may not create. J5's Convex-free half **did** run (`node scripts/capture-graph-rail.mjs` → exit 0, 34 entities / 28 edges), but its product route `/#entity/<name>` is behind the same gate, so no journey is verified end-to-end. See defect D1. |
| 2 | No critical or major usability defect open | FAIL | Three defects with reproductions are open in [PROMOTION_LOG.md](PROMOTION_LOG.md): **D1** critical (no product surface reachable without a Convex cloud account), **D2** major (typecheck red — 5383 errors), **D3** major (graph rail mounted at zero width throws an uncaught `Sigma: Container has no width` and never recovers, even after the container is given a real width). |
| 3 | Mobile and desktop both intentional | UNVERIFIED | Only two surfaces could be rendered, and neither is a product surface. Setup card: clean at 1280 and at 375×812. `demo/graph-rail/index.html`: clean at 1280×900 and at 375×812. The five journey surfaces were never on screen at any width. |
| 4 | No horizontal overflow at supported widths | UNVERIFIED | Measured `document.documentElement.scrollWidth === clientWidth` (no overflow) on the setup card at 1280 and 375, and on the graph-rail demo at 1280×900 and 375×812. That is 2 of the 6 surfaces in scope; the chat workspace, receipt view, correction panel, and entity profile were never rendered. |
| 5 | Loading/empty/success/error/agent-running designed | UNVERIFIED | Exactly one designed state was observed: the missing-Convex setup card (`MissingConvexUrlScreen` in `apps/web/src/main.tsx`) — a real card with a heading, remedy, and quickstart, not a framework default. The empty transcript, streaming/agent-running turn, cancelled turn, and continuation-loading aside all exist in `ChatSurface.tsx` but none rendered. |
| 6 | Keyboard and basic accessibility pass | UNVERIFIED | Audit not run. There was no interactive product surface to tab through — the only reachable screen is a static setup card. |
| 7 | Web Interface Guidelines review: no major unresolved | UNVERIFIED | Review not run: reviewing the interface requires the interface, and it never rendered. |
| 8 | Web-quality audit (a11y, performance, CWV): no major unresolved | UNVERIFIED | Audit not run. `npm run perf:lighthouse` targets `localhost:5173/#analytics/hitl`, which is behind the same Convex gate. |
| 9 | No unexplained console errors and no failed network requests during a journey | UNVERIFIED | No journey ran, so the condition's subject does not exist yet. What was observed: **zero** console errors on the setup card at 1280 (only Vite's `connected` debug line and the React DevTools info notice), and zero on the graph-rail demo at 375 and 1280 — the repo's own gate re-asserts that (`PASS: zero console errors`). One uncaught error was reproduced at a 0-width mount (D3), which is not a supported width. |
| 10 | Performance does not obstruct interaction | UNVERIFIED | No interaction to obstruct. For the record, non-interaction timings today: Vite cold start 36.8 s / warm 0.6 s, `npm run build` 15.5 s, graph-rail replay completes to 34 entities within the capture gate's budget. None of these is an interaction measurement. |
| 11 | Tests and build are green | FAIL | Observed, not inferred. `npx tsc -p tsconfig.app.json --noEmit --pretty false` → **exit 2**, 5383 errors (4641 `TS2339`; 4365 error lines mention `never` — the known `api`→`never` cascade). `npm run test:run` → **exit 1**, 36 failing tests: app-vitest 21 failed / 1422 passed, mcp-local 11 failed / 874 passed, convex-mcp 4 failed / 59 passed, openclaw-mcp 30 passed. `npm run build` → exit 0 (`✓ built in 15.54s`), so the red typecheck is invisible to anyone who only builds. |
| 12 | Every improvement was verified in the rendered app | UNVERIFIED | No improvement was made. Wave 1 is a baseline; a scorecard that PASSes this row on an empty change set would be scoring nothing. |

**Status: NOT PROMOTED** — 0/12 PASS (2 FAIL, 10 UNVERIFIED).

The shape of this baseline is the finding: this repo's gate is blocked at the
door, not at the details. Until a canonical journey can render, conditions 1 and
3–10 cannot honestly move, because all eight are judged on what the browser
shows.
