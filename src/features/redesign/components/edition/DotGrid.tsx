/**
 * DotGrid — N-of-total dot strip rendering, the visual signature of
 * the editorial home (mirrors ai-2027.com's "Currently Exists /
 * Emerging / Science Fiction" indicator).
 *
 * Filled = terracotta `#d97757` (rd-accent). Empty = subtle line.
 * `aria-label` REQUIRED — screen readers should hear something like
 * "5 of 6 evidence checks pass" instead of decorative dots.
 *
 * Reduced motion: no animation here, so nothing to gate.
 */

interface DotGridProps {
  /** Number of dots that should render as "filled". Clamped to [0, total]. */
  filled: number;
  /** Total dots to render. Default 6 (matches evidenceChecklist length). */
  total?: number;
  /** Optional caption shown after the strip (e.g. "5/6"). */
  caption?: string;
  /** Required descriptive label for screen readers. */
  ariaLabel: string;
}

export function DotGrid({ filled, total = 6, caption, ariaLabel }: DotGridProps) {
  const safeTotal = Math.max(1, Math.floor(total));
  const safeFilled = Math.max(0, Math.min(safeTotal, Math.floor(filled)));
  const dots = Array.from({ length: safeTotal }, (_, i) => i < safeFilled);
  return (
    <span
      className="rd-dot-grid"
      role="img"
      aria-label={ariaLabel}
      data-dot-grid
      data-filled={safeFilled}
      data-total={safeTotal}
    >
      <span className="rd-dot-grid__strip" aria-hidden="true">
        {dots.map((isFilled, i) => (
          <span
            key={i}
            className={
              "rd-dot-grid__dot" + (isFilled ? " rd-dot-grid__dot--filled" : "")
            }
          />
        ))}
      </span>
      {caption && (
        <span className="rd-dot-grid__caption" aria-hidden="true">
          {caption}
        </span>
      )}
    </span>
  );
}
