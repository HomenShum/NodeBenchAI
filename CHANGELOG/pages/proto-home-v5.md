# `public/proto/home-v5.html`

Append-only lane for the ScratchNode live-event prototype and production static surface.

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
