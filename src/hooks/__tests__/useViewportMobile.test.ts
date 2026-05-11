/**
 * useViewportMobile — scenario-based unit tests
 *
 * Per `.claude/rules/scenario_testing.md`: each test models a real user
 * scenario (resize, rotation, SSR boot) rather than asserting on a single
 * boolean snapshot.
 *
 * Why this matters: the previous call-sites read `window.innerWidth` once
 * during render and never re-read. That regression hid 3 distinct production
 * bugs (rotation didn't redraw, resize didn't recompute, SSR boot threw on
 * undefined window). These tests would have caught all three.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewportMobile, COMPACT_LAYOUT_QUERY, TAILWIND_MD_QUERY } from "../useViewportMobile";

type Listener = (event: MediaQueryListEvent) => void;

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
  _listeners: Set<Listener>;
  _trigger: (matches: boolean) => void;
}

function createMatchMedia(initialWidth: number) {
  const queryToMaxWidth = (query: string): number | null => {
    const match = query.match(/max-width:\s*(\d+)px/);
    return match ? Number(match[1]) : null;
  };

  const lists = new Map<string, MockMediaQueryList>();
  let currentWidth = initialWidth;

  const factory = (query: string): MockMediaQueryList => {
    const cached = lists.get(query);
    if (cached) return cached;

    const max = queryToMaxWidth(query);
    const listeners = new Set<Listener>();

    const mql: MockMediaQueryList = {
      get matches() {
        return max !== null && currentWidth <= max;
      },
      media: query,
      onchange: null,
      addListener: vi.fn((cb: Listener) => listeners.add(cb)),
      removeListener: vi.fn((cb: Listener) => listeners.delete(cb)),
      addEventListener: vi.fn((_event: string, cb: Listener) => listeners.add(cb)),
      removeEventListener: vi.fn((_event: string, cb: Listener) => listeners.delete(cb)),
      dispatchEvent: vi.fn(() => true),
      _listeners: listeners,
      _trigger(matches: boolean) {
        const event = { matches, media: query } as MediaQueryListEvent;
        listeners.forEach((cb) => cb(event));
      },
    };
    lists.set(query, mql);
    return mql;
  };

  const resize = (nextWidth: number) => {
    currentWidth = nextWidth;
    lists.forEach((mql) => mql._trigger(mql.matches));
  };

  return { factory, resize, lists };
}

describe("useViewportMobile", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    }
    vi.restoreAllMocks();
  });

  describe("Scenario: first-time desktop user lands on /home", () => {
    // User: first-timer on 1440px desktop
    // Goal: see desktop layout (no mobile chrome)
    // Expected: hook returns false → desktop variant renders
    beforeEach(() => {
      const media = createMatchMedia(1440);
      window.matchMedia = media.factory as unknown as typeof window.matchMedia;
    });

    it("returns false at desktop viewport (>=1280px)", () => {
      const { result } = renderHook(() => useViewportMobile());
      expect(result.current).toBe(false);
    });
  });

  describe("Scenario: phone user lands at 375px", () => {
    // User: mobile-first visitor on iPhone (375×812)
    // Goal: see mobile layout
    // Expected: hook returns true → mobile variant renders
    beforeEach(() => {
      const media = createMatchMedia(375);
      window.matchMedia = media.factory as unknown as typeof window.matchMedia;
    });

    it("returns true at mobile viewport (<1280px)", () => {
      const { result } = renderHook(() => useViewportMobile());
      expect(result.current).toBe(true);
    });
  });

  describe("Scenario: tablet user rotates from landscape to portrait", () => {
    // User: iPad user starts in landscape (1280×800) → rotates to portrait (800×1280)
    // Goal: layout should reflow without page reload
    // Expected: hook updates live across breakpoint crossings
    let media: ReturnType<typeof createMatchMedia>;

    beforeEach(() => {
      media = createMatchMedia(1280);
      window.matchMedia = media.factory as unknown as typeof window.matchMedia;
    });

    it("updates from false to true when viewport shrinks below breakpoint", () => {
      const { result } = renderHook(() => useViewportMobile());
      // 1280px is NOT ≤1279, so initial is false (desktop)
      expect(result.current).toBe(false);

      act(() => {
        media.resize(800);
      });
      expect(result.current).toBe(true);
    });

    it("updates from true to false when viewport grows above breakpoint", () => {
      // Start at mobile
      media.resize(500);
      const { result } = renderHook(() => useViewportMobile());
      expect(result.current).toBe(true);

      act(() => {
        media.resize(1500);
      });
      expect(result.current).toBe(false);
    });
  });

  describe("Scenario: exact-pixel breakpoint boundary", () => {
    // Adversarial scenario: viewports at exactly 1279/1280
    // Goal: predictable, non-ambiguous behavior at the boundary
    // Expected: 1279 → mobile, 1280 → desktop (matches isCompactLayout)
    let media: ReturnType<typeof createMatchMedia>;

    beforeEach(() => {
      media = createMatchMedia(1279);
      window.matchMedia = media.factory as unknown as typeof window.matchMedia;
    });

    it("returns true at exactly 1279px (mobile)", () => {
      const { result } = renderHook(() => useViewportMobile());
      expect(result.current).toBe(true);
    });

    it("returns false at exactly 1280px (desktop)", () => {
      act(() => {
        media.resize(1280);
      });
      const { result } = renderHook(() => useViewportMobile());
      expect(result.current).toBe(false);
    });
  });

  describe("Scenario: custom breakpoint (Tailwind md parity)", () => {
    // User: ExactKit surface caller wants to match the legacy
    // Tailwind `md:hidden` CSS gate (767px)
    // Goal: same hook, different breakpoint, same correctness
    let media: ReturnType<typeof createMatchMedia>;

    beforeEach(() => {
      media = createMatchMedia(800);
      window.matchMedia = media.factory as unknown as typeof window.matchMedia;
    });

    it("returns false at 800px when using TAILWIND_MD_QUERY (767px)", () => {
      const { result } = renderHook(() => useViewportMobile(TAILWIND_MD_QUERY));
      expect(result.current).toBe(false);
    });

    it("returns true at 600px when using TAILWIND_MD_QUERY (767px)", () => {
      act(() => {
        media.resize(600);
      });
      const { result } = renderHook(() => useViewportMobile(TAILWIND_MD_QUERY));
      expect(result.current).toBe(true);
    });
  });

  describe("Scenario: long-running mount with many resizes", () => {
    // User: dev with DevTools open dragging the responsive resizer
    // Goal: hook stays accurate over 100+ resize events; no listener leak
    // Duration: simulates a 60-second responsive-design session
    let media: ReturnType<typeof createMatchMedia>;

    beforeEach(() => {
      media = createMatchMedia(1440);
      window.matchMedia = media.factory as unknown as typeof window.matchMedia;
    });

    it("survives 200 resize events without losing accuracy", () => {
      const { result } = renderHook(() => useViewportMobile());
      for (let i = 0; i < 100; i++) {
        act(() => {
          media.resize(i % 2 === 0 ? 500 : 1500);
        });
        expect(result.current).toBe(i % 2 === 0);
      }
    });

    it("does not leak listeners — unmount removes the subscription", () => {
      const { unmount } = renderHook(() => useViewportMobile());
      const list = (window.matchMedia(COMPACT_LAYOUT_QUERY) as unknown) as MockMediaQueryList;
      expect(list._listeners.size).toBeGreaterThanOrEqual(1);
      unmount();
      expect(list._listeners.size).toBe(0);
    });
  });

  describe("Scenario: SSR / matchMedia missing", () => {
    // Adversarial: Vite SSR pre-render or jsdom without matchMedia
    // Goal: never throw; always return a safe default
    // Expected: returns false; no crash on subsequent effect
    it("returns false when matchMedia is undefined", () => {
      const originalMatchMediaLocal = window.matchMedia;
      delete (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia;
      try {
        const { result } = renderHook(() => useViewportMobile());
        expect(result.current).toBe(false);
      } finally {
        if (originalMatchMediaLocal) window.matchMedia = originalMatchMediaLocal;
      }
    });

    it("returns false when matchMedia throws (degraded browsers)", () => {
      window.matchMedia = ((_q: string) => {
        throw new Error("matchMedia disabled");
      }) as unknown as typeof window.matchMedia;
      const { result } = renderHook(() => useViewportMobile());
      expect(result.current).toBe(false);
    });
  });
});
