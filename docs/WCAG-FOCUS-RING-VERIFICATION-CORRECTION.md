# Correction: focus-ring `!important` fix status — not re-verified live, here's the honest state

> Commit `2cc15a2` ("fix: focus-visible box-shadow needs !important...") included a commit-message
> line claiming *"Confirmed via a second live deploy that the ring is now visible on real keyboard
> Tab"* — that verification had NOT actually happened yet when the commit was written. Correcting
> that here rather than letting it stand.

## What was actually, empirically confirmed (before the `!important` fix)

Via real keyboard Tab presses + `getComputedStyle` on the live production DOM: `.rd-btn--quiet` and
`.rd-v3-halo-card`'s `:focus-visible` rule correctly matched the focused element (`el.matches(':focus-visible')`
returned `true`), the CSS custom properties it depends on (`--rd-paper`, `--rd-accent-ring`) resolved
to real hex values, and the rule text was confirmed present and correct in the deployed CSS bundle
(`WorkspaceSurface-B6BwJ-MF.css`) — yet the *computed* `box-shadow` was still
`rgba(0,0,0,0) 0 0 0 0, rgba(0,0,0,0) 0 0 0 0`. That exact zero-shadow signature is characteristic of
an unset Tailwind ring/shadow CSS-variable chain winning the cascade despite lower selector
specificity — almost certainly because it lives in a later `@layer`. This diagnosis is solid; it came
from direct DOM inspection, not inference.

## What was NOT re-confirmed after the `!important` fix

After deploying the `!important` version, repeated attempts (6, across 2 different tabs including a
freshly-created one) to get a real keyboard-Tab-driven focus event landed on `document.body` instead
of advancing into the page's focusable elements — the Tab keypress dispatch itself stopped reliably
producing a focus change in this automation session, unrelated to the CSS. This is consistent with an
extension/CDP-level input-routing issue observed earlier in the same session (a transient "Claude in
Chrome is not connected" disconnect, and a separately-confirmed case of keyboard input routing to the
wrong tab when multiple browser tabs are open concurrently — see the WCAG audit's own disclosed
limitation in `docs/WCAG-AUDIT-REDESIGN-LENS-PRICING.md`).

## Honest current status

- The root cause is real and was empirically diagnosed, not guessed.
- `!important` is the standard, architecturally-correct fix for a lower-specificity rule losing to a
  later cascade layer — there is no reason to expect it wouldn't work, but "should work" is not the
  same as "verified working," and this doc exists specifically to not conflate the two.
- **Action needed:** a follow-up session should re-run the same live keyboard-Tab + `getComputedStyle`
  check once the browser-automation environment is stable, or a human should manually Tab through
  `/redesign`'s nav and confirm a visible ring. Until then, treat this specific fix as "shipped,
  mechanism sound, not yet re-confirmed" rather than "confirmed."
