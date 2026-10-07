/**
 * EditionTOC — desktop-only sticky table-of-contents rail for the
 * editorial home (Phase 7b).  Shown to the right of the 720px center
 * column on viewports >= 1440px; hidden entirely on mobile and
 * medium desktop widths so the single-column reading flow is preserved.
 *
 * Behavior:
 *   - Lists every visible section in document order.
 *   - The currently-in-view section gets `aria-current="true"` and
 *     the terracotta active style (per `.claude/rules/reexamine_a11y.md`).
 *   - Click → smooth-scroll to the target section.  Honors
 *     `prefers-reduced-motion` (instant snap when reduce is set).
 *   - Position is `fixed` at the right edge of the viewport so it
 *     never displaces the center column.
 *
 * Source spec: docs/architecture/HOME_EDITORIAL_REDESIGN.md Phase 7b
 * Rules: reexamine_a11y, reexamine_keyboard (Tab/Enter activation),
 *        agentic_reliability (BOUND — sections list is bounded).
 */

import { useEffect, useState } from "react";
import { useScrollSpy } from "../../hooks/useScrollSpy";

export interface EditionTOCEntry {
  id: string;
  /** Two-digit number ("01"). */
  number: string;
  /** Short label for the rail (e.g. "Pulse", "Forecasts"). */
  label: string;
}

interface Props {
  entries: ReadonlyArray<EditionTOCEntry>;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function EditionTOC({ entries }: Props) {
  // Watch viewport — only render at >= 1440px.  We mount the
  // observer hook unconditionally so React's hook order stays
  // stable; the rail JSX itself is gated on the `isDesktop` flag.
  const ids = entries.map((e) => e.id);
  const active = useScrollSpy(ids);

  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia("(min-width: 1440px)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1440px)");
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  if (!isDesktop || entries.length === 0) return null;

  return (
    <nav
      className="rd-edition-toc"
      aria-label="Edition contents"
      role="navigation"
      data-edition-toc
    >
      <p className="rd-edition-toc__eyebrow" aria-hidden="true">
        Contents
      </p>
      <ol className="rd-edition-toc__list">
        {entries.map((e) => {
          const isActive = active === e.id;
          return (
            <li key={e.id} className="rd-edition-toc__item">
              <a
                href={`#section-${e.id}`}
                className={
                  isActive
                    ? "rd-edition-toc__link rd-edition-toc__link--active"
                    : "rd-edition-toc__link"
                }
                aria-current={isActive ? "true" : undefined}
                aria-label={`Jump to section ${e.number}: ${e.label}`}
                data-toc-id={e.id}
                onClick={(ev) => {
                  ev.preventDefault();
                  const target = document.querySelector<HTMLElement>(
                    `[data-section="${CSS.escape(e.id)}"]`,
                  );
                  if (!target) return;
                  const reduce = prefersReducedMotion();
                  target.scrollIntoView({
                    behavior: reduce ? "auto" : "smooth",
                    block: "start",
                  });
                  // Move focus to the section header for screen
                  // readers; section element gets a tabindex when
                  // focused programmatically.
                  target.setAttribute("tabindex", "-1");
                  target.focus({ preventScroll: true });
                }}
              >
                <span className="rd-edition-toc__num" aria-hidden="true">
                  {e.number}
                </span>
                <span className="rd-edition-toc__label">{e.label}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
