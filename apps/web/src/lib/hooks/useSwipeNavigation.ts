/**
 * useSwipeNavigation — Horizontal swipe gesture to navigate between surfaces on mobile.
 *
 * Attaches touchstart/touchend listeners to a ref'd element.
 * Fires onSwipeLeft / onSwipeRight when horizontal delta exceeds threshold.
 * Ignores vertical-dominant gestures (scrolling).
 */

import { useEffect, useRef, useCallback, type RefObject } from "react";
import { haptic } from "@/lib/haptics";

interface SwipeNavigationOptions {
  /** Element ref to attach listeners to */
  ref: RefObject<HTMLElement | null>;
  /** Ordered list of route paths for swipe navigation */
  surfaces: string[];
  /** Current active surface route (pathname or full pathname+search) */
  currentPath: string;
  /** Called with the next surface path when a valid swipe is detected */
  onNavigate: (path: string) => void;
  /** Minimum horizontal delta in px to trigger navigation (default: 80) */
  threshold?: number;
  /** Whether swipe is enabled (disable on desktop) */
  enabled?: boolean;
}

export function useSwipeNavigation({
  ref,
  surfaces,
  currentPath,
  onNavigate,
  threshold = 80,
  enabled = true,
}: SwipeNavigationOptions) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
  }, []);

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (e.changedTouches.length !== 1) return;

      const deltaX = e.changedTouches[0].clientX - touchStartX.current;
      const deltaY = e.changedTouches[0].clientY - touchStartY.current;
      const elapsed = Date.now() - touchStartTime.current;

      // Ignore if: too slow (>600ms), vertical-dominant, or below threshold
      if (elapsed > 600) return;
      if (Math.abs(deltaY) > Math.abs(deltaX) * 0.8) return;
      if (Math.abs(deltaX) < threshold) return;

      // Find current index in surfaces array
      const currentIndex = surfaces.findIndex((s) => {
        if (s.includes("?")) {
          return currentPath === s;
        }
        // Match by exact path or by startsWith for nested routes
        if (currentPath === s) return true;
        if (s !== "/" && currentPath.startsWith(s)) return true;
        return false;
      });

      if (currentIndex === -1) return;

      let nextIndex: number;
      if (deltaX < 0) {
        // Swipe left → next surface
        nextIndex = currentIndex + 1;
      } else {
        // Swipe right → previous surface
        nextIndex = currentIndex - 1;
      }

      if (nextIndex < 0 || nextIndex >= surfaces.length) return;

      haptic("light");
      onNavigate(surfaces[nextIndex]);
    },
    [surfaces, currentPath, onNavigate, threshold],
  );

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [ref, enabled, handleTouchStart, handleTouchEnd]);
}
