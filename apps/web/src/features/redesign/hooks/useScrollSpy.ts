/**
 * useScrollSpy — observes a list of section IDs (matched against
 * `[data-section="..."]` in the DOM) and returns the id that is
 * currently most-visible in the viewport.  Used by `EditionTOC` to
 * highlight the active chapter as the user scrolls.
 *
 * Implementation notes:
 *   - Uses IntersectionObserver with a `rootMargin` that biases the
 *     active section to the one whose top is near the upper third of
 *     the viewport — same pattern as ai-2027.com's scroll-spy.
 *   - Re-binds when `ids` changes (sections can mount/unmount based
 *     on data presence, so the watch list isn't static).
 *   - SSR safe — returns the first id immediately when window is
 *     undefined.  Hydration replaces with the live observer state.
 *   - Honors `prefers-reduced-motion`: the observer still runs, but
 *     callers should snap-scroll instead of smooth-scrolling.
 *
 * Source spec: docs/architecture/HOME_EDITORIAL_REDESIGN.md Phase 7b
 * Rules: .claude/rules/reexamine_a11y.md (reduced motion),
 *        .claude/rules/agentic_reliability.md (BOUND — observer
 *        targets are bounded by `ids.length`).
 */

import { useEffect, useState } from "react";

export function useScrollSpy(ids: ReadonlyArray<string>): string | null {
  const [active, setActive] = useState<string | null>(
    ids.length > 0 ? ids[0] : null,
  );

  useEffect(() => {
    if (ids.length === 0) {
      setActive(null);
      return;
    }
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }

    // Track every observed section's intersection ratio so we can
    // pick the most-visible one (instead of "first to cross
    // threshold" which thrashes mid-scroll).
    const ratios = new Map<string, number>();
    for (const id of ids) ratios.set(id, 0);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section;
          if (!id) continue;
          ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        // Pick the highest-ratio id; tie-broken by document order
        // (which `ids` already preserves).
        let bestId: string | null = null;
        let bestRatio = -1;
        for (const id of ids) {
          const r = ratios.get(id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        }
        // Only update when we actually have a section in view; if
        // the user scrolls above the first section, keep the
        // previous active id.
        if (bestRatio > 0 && bestId) {
          setActive(bestId);
        }
      },
      {
        // Bias toward the upper-third of the viewport — mirrors
        // ai-2027's scroll-spy where the rail highlights the
        // section the eye is reading, not the one bottom-flushed.
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    const targets: HTMLElement[] = [];
    for (const id of ids) {
      const el = document.querySelector<HTMLElement>(
        `[data-section="${CSS.escape(id)}"]`,
      );
      if (el) {
        observer.observe(el);
        targets.push(el);
      }
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}
