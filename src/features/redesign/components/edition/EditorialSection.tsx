/**
 * EditorialSection — wraps a chapter with a `data-section` testid,
 * an eyebrow + H2, and a hairline rule.  Each section is a landmark
 * region for screen readers (per `.claude/rules/reexamine_a11y.md`).
 */

import type { ReactNode } from "react";

interface Props {
  /** The data-section testid; used by Playwright + the live-smoke. */
  id: string;
  /** Plain-language ARIA label for the region. */
  ariaLabel: string;
  /** Small uppercase eyebrow above the H2 ("01 · today" etc). */
  eyebrow: string;
  /** Section heading. */
  heading: string;
  children: ReactNode;
}

export function EditorialSection({
  id,
  ariaLabel,
  eyebrow,
  heading,
  children,
}: Props) {
  return (
    <section
      role="region"
      aria-label={ariaLabel}
      className="rd-edition-section"
      data-section={id}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p className="rd-edition-section__eyebrow">{eyebrow}</p>
        <h2 className="rd-edition-section__h2">{heading}</h2>
      </header>
      {children}
    </section>
  );
}
