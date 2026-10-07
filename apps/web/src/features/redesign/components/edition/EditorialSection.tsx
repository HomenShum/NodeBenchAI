/**
 * EditorialSection — wraps a chapter with a `data-section` testid,
 * an eyebrow + H2, and a hairline rule.  Each section is a landmark
 * region for screen readers (per `.claude/rules/reexamine_a11y.md`).
 *
 * The section number (01, 02, ...) is DYNAMIC — passed in by the
 * parent surface based on which sections are visible in the current
 * render.  This ensures readers see consecutive 01 → 02 → 03 even
 * when conditional sections (e.g. competing-explanations) hide.
 *
 * The kicker is split into:
 *   - `number`  — formatted "01" / "02" (computed by parent)
 *   - `kicker`  — STABLE labeled subtitle ("Today's edition" /
 *                 "Hypotheses under test").  Never use a raw date
 *                 here — date strings drift between sessions and
 *                 break the editorial rhythm.
 *
 * Both are rendered as `{number} · {kicker}` so existing eyebrow
 * styles still apply.  The full eyebrow text is also persisted as a
 * `data-eyebrow` attribute on the section root for e2e assertions
 * (Scenario D verifies consecutive numbering).
 */

import type { HTMLAttributes, ReactNode } from "react";

/**
 * Accept any `data-*` attribute via index signature so callers can
 * attach extra testids (e.g. `data-provenance` for the §1 trending
 * fallback added in P0 #2).  We do NOT widen to arbitrary HTML props
 * — only `data-*` is forwarded.
 */
type DataAttributes = {
  [K in `data-${string}`]?: HTMLAttributes<HTMLElement>[K];
};

interface Props extends DataAttributes {
  /** The data-section testid; used by Playwright + the live-smoke. */
  id: string;
  /** Plain-language ARIA label for the region. */
  ariaLabel: string;
  /** Two-digit zero-padded section number ("01", "02", ...). */
  number: string;
  /** Stable labeled subtitle — NEVER a raw date string. */
  kicker: string;
  /** Section heading. */
  heading: string;
  children: ReactNode;
}

export function EditorialSection({
  id,
  ariaLabel,
  number,
  kicker,
  heading,
  children,
  ...dataAttrs
}: Props) {
  const eyebrow = `${number} · ${kicker}`;
  return (
    <section
      role="region"
      aria-label={ariaLabel}
      className="rd-edition-section"
      data-section={id}
      data-section-number={number}
      data-section-kicker={kicker}
      data-eyebrow={eyebrow}
      {...dataAttrs}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p className="rd-edition-section__eyebrow">{eyebrow}</p>
        <h2 className="rd-edition-section__h2">{heading}</h2>
      </header>
      {children}
    </section>
  );
}
