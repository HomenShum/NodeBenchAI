# WCAG 2.1 AA audit — /redesign, /pricing, /lens (live, authenticated)

> Real DOM-computed audit (getComputedStyle contrast ratios, real keyboard Tab presses cross-checked
> against `document.activeElement`), not a lint-tool guess. `/` client-redirects authenticated
> sessions to `/redesign`, so those two are the same rendered surface for this session.

## P0 — blocks keyboard/AT users

**No visible focus indicator on primary nav + report-card carousel (`/redesign`).** `.rd-btn--quiet`
(logo, Home/Reports/Chat/Inbox/Me, search trigger, mode selector, composer icons) and
`.rd-v3-halo-card` (the report-card carousel, 7/7 sampled) both resolve `outline-style: none` with no
alternative indicator on focus. Confirmed the design system HAS a working ring pattern
(`box-shadow: rgb(255,255,255) 0 0 0 2px, rgb(217,119,87) 0 0 0 4px`, seen correctly applied to
`.rd-v2-btn-primary` and the main composer textarea) — it's just not applied to these two classes.
WCAG 2.4.7.

## P1 — real violations, workaround exists

- **Missing accessible labels**: main composer `<textarea>` and the right-panel briefing-agent
  `<input>` on `/redesign`; the entity-name `<input>` on `/lens`. All placeholder-only, no
  aria-label/aria-labelledby/id+label. WCAG 3.3.2/4.1.2.
- **Two `<h1>` elements on `/redesign`** ("Ask once...", "One useful thing surfaced...") — WCAG 1.3.1
  expects one. Also: the first heading in DOM order is an `h3`, not the h1.
- **Severe contrast failures on `/lens`**: "Watch For" label 1.62:1, "Investor"/"Investor Lens" tab
  text 1.92:1 (both need 4.5:1) — core content labels, not decoration.
- **Brand-orange controls fail 4.5:1** across `/pricing`, `/redesign`, `/lens`: "Object-first mode"
  badge (3.07:1), "Most popular" badge (3.12:1), "Pro" column header (3.12:1), "All" filter tab
  (3.12:1), search placeholder text (3.27:1), "Next Action" label (3.12:1). Same root color
  (`rgb(217,119,87)`/`rgb(217,121,89)`) across all — a single color-token fix would address most of
  these at once, but changing the brand orange is a product decision, not made here.

## P2 — minor

Skip-link contrast (3.12:1, functional workaround exists since it's off-screen until focused);
`/lens` heading skip (h1→h3, no h2); `/redesign` badge off by 0.07 (4.43 vs 4.5 needed); logo
wordmark contrast (WCAG-exempt, informational only); `/pricing` command-palette focus ring present
but low-contrast against its own background (≈1.77:1, likely fails 1.4.11 even though a ring exists).

## Checked and clean

Zero unnamed interactive elements (button/a/role=button) across all 3 surfaces. Zero images missing
`alt`. `/pricing` has correct single-h1 heading structure and zero unlabeled form inputs.

## Explicitly not verified (disclosed, not guessed)

Focus-indicator testing on `/pricing` and `/lens` became unreliable partway through — keyboard `Tab`
events stopped routing to the target tab once other concurrent agent-driven browser tabs were open in
the same profile (OS-level frontmost-tab keyboard routing, not a `tabId`-scoped issue). Got one valid
`/pricing` data point (the P2 command-palette finding) before this happened; `/pricing`'s main nav
and `/lens`'s lens-tab buttons are NOT verified for focus visibility — reported as unverified, not
claimed clean.

## Fixed in this pass (safe, mechanical — see commit)

- Added `aria-label` to the 3 unlabeled inputs (main composer, briefing-agent composer, /lens entity
  input).
- Fixed the duplicate-h1 issue on `/redesign` by demoting one to `h2`.
- Added a visible `:focus-visible` outline to `.rd-btn--quiet` and `.rd-v3-halo-card`, matching the
  existing ring pattern already used elsewhere in the design system.

## Deliberately NOT fixed here (product/design decision, not mine to make unilaterally)

The brand-orange contrast failures (P1) share one root color used consistently as a design choice
across multiple surfaces — retuning it is a visible, site-wide color decision that affects brand
identity, not a mechanical accessibility patch. Flagged for a deliberate design decision rather than
autonomously changed.
