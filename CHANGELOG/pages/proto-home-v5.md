# `public/proto/home-v5.html`

Append-only lane for the ScratchNode live-event prototype and production static surface.

## 2026-06-02 — Add ScratchNode motion polish
Centralized lightweight motion tokens and added a visual polish pass across the ScratchNode room: ambient backdrop, composer focus/private-mode cues, chat and answer reveals, Live Assist card choreography, and tactile Memory Wall note transitions. The change keeps the existing public/private behavior contract intact while making the demo feel more premium on desktop and mobile.

**Commit**: `this commit`. **Author**: Homen Shum + Augment Agent.

## 2026-06-02 — a11y: explicit type="button" on 3 buttons (loop C002)
Self-improvement loop cycle C002 added `type="button"` to the Memory Wall sticky-delete button and the two onboarding-tour buttons (Next/Skip) — they had onclick handlers but no explicit type (implicit-submit footgun). Validated as not inside a <form>; no behavior change. e2e honesty + output-contract green.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.
