# `public/proto/home-v5.html`

Append-only lane for the ScratchNode live-event prototype and production static surface.

## 2026-06-02 — Rewrite the landing headline for a viral hook
Replaced the feature-describing hero line "A disposable sidecar room for live event
memory" (jargon: "disposable", "sidecar"; no emotional/temporal hook — nobody screenshots
it) with an outcome-first, say-it-out-loud headline: **"The room remembers everything."**
Lineage: Linear ("the issue tracker you'll enjoy using" — emotional outcome), Slido
("audience interaction made easy" — the closest live-event-Q&A comp), Luma ("delightful
events start here"). The features (`/ask`, wiki handoff, no-account) move into the
sub-headline where they belong: "Drop a code, chat live, hit /ask for sourced answers —
and walk away with a wiki of everything that happened. No account, no app." Updated `<title>`,
meta description, and all OG/Twitter card tags to match so shared links carry the new hook.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Live "big number" room counter on the landing
Added an animated, reactive hero stat to the apex landing: a large room-count that
**ticks up the instant anyone, anywhere, creates a room** — driven by a new reactive
Convex query `events:getLandingStats` (bounded scan, returns `{ roomsCreated, liveNow,
capped }`), not a client timer. A pulsing "● N live right now" sub-line shows open rooms.

The counter gently floats with a soft accent glow; the number animates up via a cubic
ease when the reactive value changes. Motion-safe: subtle translate + small status-dot
ring (no flashing), all gated under `prefers-reduced-motion`. Mobile scales the digits down.

Honesty (`agentic_reliability` HONEST_SCORES): every figure is a real row count — no
fabricated marketing number. The stat is **hidden entirely** until the backend reports
≥1 room (so an empty or offline backend never flashes a fake "0"), enforced by both the
`render()` guard and a `.landing-pulse[hidden]{display:none}` rule (a class selector
otherwise beats the UA `[hidden]` rule). The landing subscription is read-only and never
sets `data-sn-live`, so the apex stays honestly "not live". Bulletproof: any config/client
failure leaves the stat hidden and never throws to the page.

Covered by 3 new cases in `scratchnode-live-route-honesty.spec.ts` (real value renders
`1,342`, scan-cap renders `5,000+`, zero rooms stays hidden). 13/13 honesty suite green.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Add a self-serve "Create a room" front-door to the landing
The apex landing only offered a "Join with a code" form — a first-time visitor had
no way to actually create a room. `events:createEvent` existed in the backend and a
create flow lived in the in-room host console, but the live-backend module bails early
on the apex (`if (!slugMatch) return`), so creation was never wired on the landing.

Added a `.landing-create` form (event name + optional custom room code) beside Join,
plus a self-contained `_landingCreate()` handler that lazily bootstraps a Convex client
(same `/api/scratchnode-config` + esm.sh paths the room module uses), calls
`events:createEvent`, persists the issued host token (`sn_host_owner_key_v2`), and
navigates the new host into `/e/<slug>`. Join stays the single primary accent CTA;
Create is outline-accent (secondary in the hierarchy).

Honesty contract preserved: every failure (config down, client load fail, taken code,
rate limit) surfaces a real inline error and re-enables the button — never a fake
success, and `data-sn-live` stays untouched so the apex reads honestly "not live" until
the host lands in their room. Covered by 4 new cases in
`tests/e2e/scratchnode-live-route-honesty.spec.ts` (happy path, auto-code, short-name
rejection, honest config-failure). 10/10 honesty suite green.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Add ScratchNode motion polish
Centralized lightweight motion tokens and added a visual polish pass across the ScratchNode room: ambient backdrop, composer focus/private-mode cues, chat and answer reveals, Live Assist card choreography, and tactile Memory Wall note transitions. The change keeps the existing public/private behavior contract intact while making the demo feel more premium on desktop and mobile.

**Commit**: `this commit`. **Author**: Homen Shum + Augment Agent.

## 2026-06-02 — a11y: explicit type="button" on 3 buttons (loop C002)
Self-improvement loop cycle C002 added `type="button"` to the Memory Wall sticky-delete button and the two onboarding-tour buttons (Next/Skip) — they had onclick handlers but no explicit type (implicit-submit footgun). Validated as not inside a <form>; no behavior change. e2e honesty + output-contract green.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.
