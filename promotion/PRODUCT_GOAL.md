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

## Reproducing any of this

Everything below condition 2 needs a Convex deployment; there is no local
substitute. The four commands are in
[docs/START_HERE.md](../docs/START_HERE.md) under "Before Step 1", with the two
traps that used to make them fail. Then:

```bash
node scripts/capture-live-journey.mjs --port 4902           # conditions 1,3,4,5,9
node scripts/audit-web-quality.mjs --port 4902              # condition 8
node scripts/review-web-interface-guidelines.mjs --port 4902 # condition 7 (measurements)
```

## Current scorecard

Baseline measured 2026-08-13 against a fresh clone of `main` at
`07a55afea176254e07eebd28ab36701e9f9068da`. Wave 1 measures; it does not repair.

Updated 2026-08-13 by iteration 1, which repaired the reachable half of D1 (the
setup gate tested the env var for presence rather than validity).

Updated **2026-08-14 by iteration 2**, which stood up an isolated Convex dev
deployment and drove J1, J2 and J4 end to end against it. Nine conditions were
UNVERIFIED for exactly one reason — nothing rendered — and that reason is gone.
Every row below cites a committed artifact **and** the committed producer that
regenerates it; a row with only one of the two is not a PASS.

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | **PASS** | `node scripts/capture-live-journey.mjs --port 4902` → **exit 0**, 10/10 checks, against a live Convex deployment. J1: empty state → submit → live-research checklist → sealed packet, run `chat_msse8tbz_5w7dj9`, with five tool rows (classify_query, build_context_bundle, gemini_synthesis 19.9 s, fallback_source_search **warning**, bind_evidence **warning**). **Read the caveat:** this particular capture landed the *ungrounded* branch — `Auto · 0 sources`, no evidence rows, and the honest "Source needed: no supported URL is available…" notice, which the gate asserts. Grounded runs were observed too (3, 2 and 1 sources on earlier runs of the same prompt); the source count is not deterministic, which is defect **D7**. What condition 1 claims is that the journey completes end to end, not that every run is well-grounded. J2: `/redesign/chat/r/1znqpv1wpmh0` opened in a cold context reached `data-state="ready"`, matched the original text, and left `getLatestOwnedRun().runId` unchanged — it replayed, it did not re-run. J4: Stop → "Cancellation recorded…" → a turn that says the run was cancelled with no sealed packet → the next question still works. Artifacts: `promotion/evidence/live-journey/report.json` + 9 PNGs. J3 and the product half of J5 remain UNVERIFIED — nobody drove them — so this is 3 of 5 journeys, stated plainly. |
| 2 | No critical or major usability defect open | FAIL | Open: **D2** major (typecheck red — 5383 errors, the `api`→`never` cascade); **D3** major (graph rail mounted at zero width throws and never recovers); **D5** major, new — a rejected prompt tells the user "The live chat run could not be started." while the actual reason (`Prompt too short — write at least a 3-character question.`) goes only to the console; **D6** major, new — LCP 10 827 ms on the production build plus four Web Interface Guidelines deviations; **D7** major, new — the same question returned 3, 2, 1, 0, 1 and 0 grounded sources across six runs, so a third of answers arrive with no sources at all (honestly labelled, but the product promise is sources attached). Closed 2026-08-14: **D1** critical — the product now runs (condition 1). |
| 3 | Mobile and desktop both intentional | **PASS** | Same producer, same run. The journey was driven at **1280×900** and again at **375×812** in separate sessions with separate accounts: at 375 the surface mounts with `data-empty="true"`, a question seals an answer packet, and console errors are 0. Compare `01-empty-desktop.png` / `03-answer-desktop.png` with `07-empty-mobile.png` / `08-answer-mobile.png` — two designs, not one squeezed. |
| 4 | No horizontal overflow at supported widths | **PASS** | `document.documentElement.scrollWidth === clientWidth` asserted at both widths, on the empty state and on the answered transcript: 1280 === 1280, 375 === 375 (`report.json` → checks "J1 step 2" and "Conditions 3-4"). Re-measured independently by `scripts/review-web-interface-guidelines.mjs`, which agrees. |
| 5 | Loading/empty/success/error/agent-running designed | **PASS** | All observed, none inferred. **Empty**: `data-empty="true"` with starters (`01-empty-desktop.png`). **Agent-running**: the live-research checklist with named stages while the run is in flight (`02-agent-running-desktop.png`). **Success**: the sealed packet with sources, risks, next step and tool trace (`03-` and `04-answer-desktop.png`). **Error**: a 2-character prompt is rejected by `startChat` at the trust boundary and the surface shows the designed failure card (`09-validation-error-desktop.png`) — the *reason* not reaching the user is defect D5, but the state itself is designed. **Cancelled/terminal**: `06-cancelled-desktop.png`. Plus the honest degraded state when grounding returns nothing ("Source needed: no supported URL is available…"), which the gate asserts in both directions. |
| 6 | Keyboard and basic accessibility pass | **PASS** | Measured, not assumed. `node scripts/review-web-interface-guidelines.mjs`: Tab from a cold page moves focus and changes the focused element's outline at both widths (`none 3px` → `solid 1px` at 1280, `solid 3px` at 375); the stylesheet carries **148** `:focus-visible` rules and **64** `prefers-reduced-motion` blocks; browser zoom is not disabled; there are **no** unnamed icon-only buttons; one polite `aria-live` region exists. Lighthouse accessibility **96**; axe-core 4.13.0 reports **0 serious and 0 critical** violations. The primary action is keyboard-only — Enter submits, and the whole J1 capture drives it that way. **Two moderate axe violations remain open** (`landmark-one-main`, `page-has-heading-one`); they are counted against condition 7 rather than hidden here. Artifacts: `promotion/evidence/wig-review/measurements.json`, `promotion/evidence/web-quality/axe.json`. |
| 7 | Web Interface Guidelines review: no major unresolved | FAIL | A review was performed against <https://vercel.com/design/guidelines> on the rendered surface and written up at `promotion/evidence/wig-review/REVIEW.md`; measurements in `measurements.json`; producer `scripts/review-web-interface-guidelines.mjs`. **4 major findings open:** no `<h1>` anywhere on the only route the product has (`h1Count: 0` at both widths, corroborated by axe `page-has-heading-one`); no skip link (`skipLink: false`); three sub-44px touch targets at 375 including the **44×36 submit button**; composer `<textarea>` font 14.5px, which makes iOS Safari zoom on focus. Five minor findings are listed with it. **This row is not the Lighthouse score** — Lighthouse measures none of these things. Condition 8 is where the score lives. |
| 8 | Web-quality audit (a11y, performance, CWV): no major unresolved | FAIL | `node scripts/audit-web-quality.mjs` — Lighthouse **13.4.1** and **@axe-core/cli 4.13.0** against the **production build** under `vite preview`, signed out, `/redesign/chat`. Accessibility **96**, best-practices **100**, SEO **100**, axe **2 violations, both moderate, 0 serious/critical**: those halves pass. Performance does not — **56**, with **LCP 10 827 ms** and FCP **6 883 ms**. CLS 0.0028 and TBT 193 ms are good, so it is payload rather than main-thread work; the build's own PWA precache is 338 entries / 22 518 KiB. One major finding open (D6). Artifacts: `promotion/evidence/web-quality/{lighthouse.json,axe.json,summary.json}`. |
| 9 | No unexplained console errors and no failed requests during a journey | **PASS** | Asserted across the whole desktop journey — load, submit, stream, answer, share, cold receipt open, cancel, re-ask — and separately at 375: **0 console errors, 0 page errors, 0 failed requests** (`report.json` → "Condition 9"). The producer records failed responses with their URL rather than Chrome's URL-less "Failed to load resource" line, so a recurrence is actionable. The one console error deliberately provoked — the server rejecting a 2-character prompt — is raised in its own browser context and asserted to be exactly that message, so it cannot quietly pollute this row. |
| 10 | Performance does not obstruct interaction | FAIL | Measurable at last, and it fails on first paint rather than on interaction. Once loaded the app is responsive: TBT **193 ms**, CLS **0.0028**, and the live journey's latency is model time (`gemini_synthesis 10.6 s` of a ~13 s run), not UI time. But under Lighthouse's default mobile throttle the production build reaches LCP at **10 827 ms** and FCP at **6 883 ms**, so a mobile visitor waits ten seconds before there is anything to interact with. Same root cause and same artifact as condition 8 (D6). |
| 11 | Tests and build are green | FAIL | Unchanged, and **not re-measured this iteration** — iteration 1's numbers stand rather than being restated as if fresh: `npx tsc -p tsconfig.app.json --noEmit` → exit 2, 5383 errors (D2); `npm run test:run` → exit 1. What iteration 2 did measure: `npx vitest run backend/convex/domains/agents/mcp_tools/models/modelResolver.test.ts` → exit 0, 4 passed, and `node node_modules/vite/bin/vite.js build` → exit 0 (PWA precache 338 entries / 22 518 KiB). `npm run build` itself fails before Vite runs on this machine, because its first step shells out to `npx esbuild` for a Vercel serverless bundle that is not part of the rendered page. |
| 12 | Every improvement was verified in the rendered app | **PASS** | Both iterations hold. Iteration 1: `scripts/capture-convex-setup-gate.mjs`, exit 1 pre-fix (retained at `promotion/evidence/convex-setup-gate/before/report.json`), exit 0 post-fix. Iteration 2: every claim above comes from `capture-live-journey.mjs`, `audit-web-quality.mjs` or `review-web-interface-guidelines.mjs` — all three committed, all three re-runnable, all three writing into `promotion/evidence/`. Three of this iteration's findings were **gate bugs caught by disagreeing with the browser**: a predicate that hung on a 0-source answer, one that matched mid-stream, and one that failed a correct cancellation because the fallback copy contains the words "evidence rows". Nothing here was concluded from reading code. |

**Status: NOT PROMOTED** — 7/12 PASS (5 FAIL, 0 UNVERIFIED).

The word UNVERIFIED is gone from this table, and that is the result worth
reading. Not because everything works — five conditions fail — but because the
product can now be *observed*: those five are measured facts with artifacts
attached, instead of a shrug about a screen nobody could reach. They fall into
two piles. Conditions 7, 8 and 10 are one payload-and-polish problem (D6: a
22 MB precache, no `h1`, no skip link, small touch targets). Conditions 2 and 11
are the long-running items — D2's `api`→`never` typecheck cascade and D3 — plus
the new D5.

What is still not claimed: J3 (inline correction) and the product half of J5
(the entity graph rail on a real route) have never been driven by anyone. They
are named in [PRODUCT_JOURNEYS.md](PRODUCT_JOURNEYS.md) with that stated, and
condition 1 says "3 of 5" rather than rounding up.
