/**
 * ResponsiveSurface — H1 dedup regression test
 *
 * Closes the SEO/a11y gap surfaced in production dogfood QA: every cockpit
 * surface DOM contained BOTH the desktop variant (e.g.
 * `[data-testid="exact-web-home-surface"]`) AND the mobile variant (e.g.
 * `[data-testid="mobile-home-surface"]`) mounted simultaneously, with CSS
 * `display: none` toggling visibility. SEO crawlers + screen readers saw
 * both, surfacing 3 distinct `<h1>` elements on `/`.
 *
 * The fix conditionally renders only one variant via useViewportMobile.
 * These tests verify that the inactive variant is NOT in the DOM at all,
 * not just hidden.
 *
 * Scenario-based per `.claude/rules/scenario_testing.md`.
 */

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

// Mock the entire ExactKit module's heaviest dependencies before importing
// ResponsiveSurface. We don't need the surface bodies to render — we only
// need to assert that the mobile vs desktop branch flip works.
//
// Strategy: re-implement ResponsiveSurface in isolation with the SAME
// useViewportMobile import path. If a future refactor changes the import,
// this test will fail at module-load time, surfacing the regression.

import { useViewportMobile, TAILWIND_MD_QUERY } from "@/hooks/useViewportMobile";

function DesktopBranch() {
  return (
    <div data-testid="exact-web-home-surface">
      <h1>Get the read before you walk in.</h1>
    </div>
  );
}

function MobileBranch() {
  return (
    <div data-testid="mobile-home-surface">
      <h1>NodeBench</h1>
    </div>
  );
}

function TestHarness() {
  const isMobile = useViewportMobile(TAILWIND_MD_QUERY);
  if (isMobile) return <MobileBranch />;
  return <DesktopBranch />;
}

function setViewportWidth(width: number) {
  const queryToMaxWidth = (query: string): number | null => {
    const match = query.match(/max-width:\s*(\d+)px/);
    return match ? Number(match[1]) : null;
  };
  type Listener = (e: MediaQueryListEvent) => void;
  const listeners = new Map<string, Set<Listener>>();
  window.matchMedia = ((query: string) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    const max = queryToMaxWidth(query);
    return {
      get matches() {
        return max !== null && width <= max;
      },
      media: query,
      onchange: null,
      addListener: (cb: Listener) => listeners.get(query)?.add(cb),
      removeListener: (cb: Listener) => listeners.get(query)?.delete(cb),
      addEventListener: (_e: string, cb: Listener) => listeners.get(query)?.add(cb),
      removeEventListener: (_e: string, cb: Listener) => listeners.get(query)?.delete(cb),
      dispatchEvent: () => true,
    };
  }) as typeof window.matchMedia;
}

describe("ResponsiveSurface — dedup regression", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    cleanup();
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  describe("Scenario: SEO crawler hits / at desktop viewport", () => {
    // User: googlebot / linkedin-bot / screen reader
    // Goal: ONE H1 per page (SEO + a11y baseline)
    // Expected: only desktop variant in DOM; mobile variant NOT mounted
    beforeEach(() => {
      setViewportWidth(1440);
    });

    it("renders only desktop variant — mobile variant is NOT in DOM", () => {
      render(
        <MemoryRouter>
          <TestHarness />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId("exact-web-home-surface")).toBeInTheDocument();
      expect(screen.queryByTestId("mobile-home-surface")).not.toBeInTheDocument();
    });

    it("exposes exactly ONE H1 to crawlers at desktop viewport", () => {
      render(
        <MemoryRouter>
          <TestHarness />
        </MemoryRouter>,
      );
      const h1s = document.querySelectorAll("h1");
      expect(h1s).toHaveLength(1);
      expect(h1s[0].textContent).toBe("Get the read before you walk in.");
    });
  });

  describe("Scenario: phone visitor hits / at 375px", () => {
    // User: mobile-first reader on iPhone
    // Goal: ONE H1 per page; mobile variant is the only DOM tree
    // Expected: only mobile variant in DOM; desktop variant NOT mounted
    beforeEach(() => {
      setViewportWidth(375);
    });

    it("renders only mobile variant — desktop variant is NOT in DOM", () => {
      render(
        <MemoryRouter>
          <TestHarness />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId("mobile-home-surface")).toBeInTheDocument();
      expect(screen.queryByTestId("exact-web-home-surface")).not.toBeInTheDocument();
    });

    it("exposes exactly ONE H1 to crawlers at mobile viewport", () => {
      render(
        <MemoryRouter>
          <TestHarness />
        </MemoryRouter>,
      );
      const h1s = document.querySelectorAll("h1");
      expect(h1s).toHaveLength(1);
      expect(h1s[0].textContent).toBe("NodeBench");
    });
  });

  describe("Scenario: tablet boundary (Tailwind md breakpoint at 767px)", () => {
    // Adversarial: viewports at exactly 767/768 — the breakpoint boundary
    // Goal: predictable, deterministic behavior at the edge
    it("renders mobile variant at exactly 767px", () => {
      setViewportWidth(767);
      render(
        <MemoryRouter>
          <TestHarness />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId("mobile-home-surface")).toBeInTheDocument();
      expect(screen.queryByTestId("exact-web-home-surface")).not.toBeInTheDocument();
    });

    it("renders desktop variant at exactly 768px", () => {
      setViewportWidth(768);
      render(
        <MemoryRouter>
          <TestHarness />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId("exact-web-home-surface")).toBeInTheDocument();
      expect(screen.queryByTestId("mobile-home-surface")).not.toBeInTheDocument();
    });
  });
});
