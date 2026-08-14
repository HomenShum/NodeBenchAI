# Web Interface Guidelines review — `/redesign/chat`

**Condition 7.** Reviewed 2026-08-14 against
<https://vercel.com/design/guidelines>, on the rendered surface running against
a live Convex deployment, signed out (the state a stranger arrives in), at
1280×900 and 375×812.

**This is a review, not a score.** Lighthouse ran too — its numbers are in
`promotion/evidence/web-quality/summary.json` and answer condition **8**. They
are not this. Lighthouse never measures hit-target size, `transition: all`,
Enter-in-textarea semantics, placeholder punctuation, or whether a focus ring is
visibly different from the resting state. Every finding below has a DOM
measurement in `measurements.json` or a screenshot beside it.

Producer: `node scripts/review-web-interface-guidelines.mjs --port 4902`
Measurements: `measurements.json` · Focus-state captures: `focus-desktop.png`,
`focus-mobile.png`

**Verdict: FAIL — 4 major findings open.**

## Major

| # | Guideline | Measured | Where |
|---|-----------|----------|-------|
| W1 | "Implement hierarchical heading structure with skip link" | `h1Count: 0` at **both** widths. The one canonical surface has no level-one heading at all. Independently corroborated by axe rule `page-has-heading-one` (`promotion/evidence/web-quality/axe.json`). | `measurements.json` → `desktop.h1Count`, `mobile.h1Count` |
| W2 | "Implement hierarchical heading structure with **skip link**" | `skipLink: false`. There is no in-page skip target, so a keyboard user tabs the header on every arrival, on the only route the product has. | `measurements.json` → `desktop.skipLink` |
| W3 | "Ensure touch targets are at least 44px minimum" (mobile) | At 375: **Run research** (the primary submit) 44×**36**, **Sign in** 59×**32**, the example link 284×**18**. Three of ten visible interactive elements are under the minimum, and one of them is the button the whole product depends on. | `measurements.json` → `mobile.smallTargets` |
| W4 | "Input font size is ≥16px on mobile to prevent iOS Safari auto-zoom" | Composer `<textarea>` computes to **14.5px** at 375. iOS Safari will zoom the viewport on focus, which is the single most common mobile-chat annoyance. | `measurements.json` → `mobile.fields[0].fontSizePx` |

## Minor

| # | Guideline | Measured |
|---|-----------|----------|
| W5 | "Expand hit targets under 24px to at least 24px" (desktop) | At 1280 the example link is 284×**18** and the wordmark link 79×**23**. |
| W6 | "Never use `transition: all`; list only intended properties" | One rule still declares `transition: all` (`css.transitionAllCount: 1`). |
| W7 | "End placeholder text with ellipsis" | Placeholder is `Ask anything · type / for commands` — no ellipsis. |
| W8 | "Set page titles reflecting current context" | `document.title` stays the static marketing string on `/redesign/chat`. The receipt route *does* set a contextual title (`ReproducibleChatPage.tsx`), so the pattern exists and the primary surface simply does not use it. |
| W9 | "Use `<link rel=\"preconnect\">` for asset/CDN domains" | The hint exists but points at a **hardcoded** deployment — `apps/web/index.html:26-27` preconnects to `aware-clam-410.convex.cloud`, not to whatever `VITE_CONVEX_URL` the build was given. Lighthouse shows the origin in the network report for a build configured against a different deployment (`promotion/evidence/web-quality/lighthouse.json`). For every deployment but one, this opens a connection that is never used and skips the one that is. |
| W10 | "In textarea, ⌘/⌃+Enter submits; Enter creates new line" | Plain Enter submits the composer `<textarea>`; there is no newline affordance. Recorded as minor rather than major because this is the near-universal chat convention and the guideline's rationale (accidental submission of long-form text) is weaker for a one-line prompt box — but it is a deviation, so it is written down. |

## Measured and clean — no finding

- **Focus rings are real.** Tab from the resting state changes the focused
  element's outline at both widths (`focusRing.changed: true`, `none 3px` →
  `solid 1px` desktop / `solid 3px` mobile), and the stylesheet carries **148**
  `:focus-visible` rules — the guideline's preferred selector, not `:focus`.
- **Reduced motion is honoured**: 64 `@media (prefers-reduced-motion)` blocks.
- **Zoom is not disabled**: `viewport-fit=cover` with no `user-scalable=no` and
  no `maximum-scale=1`.
- **No unnamed icon-only buttons** at either width.
- **`theme-color` is set** (`#09090B`), and one polite `aria-live` region exists
  for toasts.
- **No horizontal overflow**: `scrollWidth === clientWidth` at 1280 and 375.
- **`touch-action: manipulation`** is declared in 4 rules.

## Discrepancy worth knowing

axe reports `landmark-one-main` violated; this script measures
`mainLandmarks: 1`. They ran against different builds — axe against
`vite preview` (production `dist/`), this script against the dev server — and
axe evaluates earlier in the page's life. Treat the landmark as **unconfirmed in
both directions** until one run measures both; do not quote either number as
settled.

## Not measured, therefore not claimed

Real-device testing, screen-reader narration, optical alignment, iOS Low Power
Mode, and locale formatting. They are listed in `measurements.json` →
`notMeasured` so the coverage of this review is auditable rather than implied.
