/**
 * useViewportMobile — Shared mobile-viewport detection hook.
 *
 * Subscribes to `window.matchMedia(query)` and returns a boolean that updates
 * live on resize/orientation change. SSR-safe (returns `false` when
 * `window` is undefined) and BOUND-clean (removes the change listener on
 * unmount — see .claude/rules/agentic_reliability.md, item 1 BOUND).
 *
 * Used as the single source of truth for surface-variant rendering so the
 * DOM contains only ONE variant at a time (fixes the duplicate-H1 SEO/a11y
 * gap where mobile + desktop trees both mounted via CSS `display: none`).
 *
 * The default breakpoint is `(max-width: 1279px)` which mirrors the existing
 * `isCompactLayout = window.innerWidth < 1280` runtime check in
 * `src/layouts/CockpitLayout.tsx`. Callers can pass any matchMedia query
 * string to opt into a different breakpoint (e.g. Tailwind `md` parity).
 *
 * Example:
 *   const isCompact = useViewportMobile();              // < 1280px
 *   const isPhone   = useViewportMobile("(max-width: 767px)"); // Tailwind md
 *
 * Why live-update matters: prior call-sites read `window.innerWidth` once
 * during render and never re-read on resize, so layout went stale when the
 * user rotated a tablet or resized a window. matchMedia + addEventListener
 * solves this without a manual resize listener.
 */

import { useEffect, useState } from "react";

/** Default breakpoint — matches `isCompactLayout` (window.innerWidth < 1280). */
export const COMPACT_LAYOUT_QUERY = "(max-width: 1279px)";

/** Tailwind `md` breakpoint — matches `md:hidden` / `hidden md:block`. */
export const TAILWIND_MD_QUERY = "(max-width: 767px)";

function readMatch(query: string): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function useViewportMobile(query: string = COMPACT_LAYOUT_QUERY): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => readMatch(query));

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }

    // Sync once on mount (in case the query string changed between renders
    // and the previous useState lazy-init captured a stale value).
    setIsMobile(mql.matches);

    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    // Modern browsers ship addEventListener on MediaQueryList. Older WebKit
    // (and our jsdom test setup with `addListener` fallback) needs the
    // deprecated method. Try modern first, fall back gracefully.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => {
        mql.removeEventListener("change", onChange);
      };
    }
    if (typeof (mql as MediaQueryList & { addListener?: (cb: (e: MediaQueryListEvent) => void) => void }).addListener === "function") {
      (mql as MediaQueryList & { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(onChange);
      return () => {
        (mql as MediaQueryList & { removeListener: (cb: (e: MediaQueryListEvent) => void) => void }).removeListener(onChange);
      };
    }
    return;
  }, [query]);

  return isMobile;
}

export default useViewportMobile;
