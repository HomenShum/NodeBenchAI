# `public/proto/home-v5.html`

Append-only lane for the ScratchNode live-event prototype and production static surface.

## 2026-06-02 — Add ScratchNode motion polish
Centralized lightweight motion tokens and added a visual polish pass across the ScratchNode room: ambient backdrop, composer focus/private-mode cues, chat and answer reveals, Live Assist card choreography, and tactile Memory Wall note transitions. The change keeps the existing public/private behavior contract intact while making the demo feel more premium on desktop and mobile.

**Commit**: `this commit`. **Author**: Homen Shum + Augment Agent.

## 2026-06-01 — Follow-up: handoff cascade + room-code copy flash
Additive layer on top of the motion polish pass. Two micro-interactions that the prior pass did not cover: (1) the room-code chip now flashes a green "✓ Copied" confirmation on copy (paired with the existing toast — text + colour, not colour alone), and (2) the NodeBench handoff overlay sections cascade up after the panel slides in, so the "Now in NodeBench" moment feels composed rather than a hard cut. Both reuse the existing `--motion-*`/`--ease-out` tokens, ship `prefers-reduced-motion` guards, and leave the public/private behavior contract untouched. Verified: 7/7 e2e (output-contract + live-route-honesty), reduced-motion suppression, no mobile overflow.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.
