import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TAILWIND_MD_QUERY, useViewportMobile } from "@/hooks/useViewportMobile";

function CanonicalRuntimeBranch() {
  return (
    <div data-testid="exact-web-home-surface">
      <h1>Get the read before you walk in.</h1>
    </div>
  );
}

function TestHarness() {
  const isMobile = useViewportMobile(TAILWIND_MD_QUERY);
  return (
    <div
      data-testid={isMobile ? "mobile-home-surface" : undefined}
      data-responsive-surface={isMobile ? "mobile" : "desktop"}
    >
      <CanonicalRuntimeBranch />
    </div>
  );
}

function setViewportWidth(width: number) {
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();
  window.matchMedia = vi.fn((query: string) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    const maxWidth = Number(query.match(/max-width:\s*(\d+)px/)?.[1] ?? Number.NaN);
    return {
      matches: Number.isFinite(maxWidth) && width <= maxWidth,
      media: query,
      onchange: null,
      addListener: (listener) => listeners.get(query)?.add(listener),
      removeListener: (listener) => listeners.get(query)?.delete(listener),
      addEventListener: (_event, listener) => listeners.get(query)?.add(listener),
      removeEventListener: (_event, listener) => listeners.get(query)?.delete(listener),
      dispatchEvent: () => true,
    } as MediaQueryList;
  });
}

describe("ResponsiveSurface runtime parity", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the canonical runtime tree without a mobile wrapper on desktop", () => {
    setViewportWidth(1440);
    render(<TestHarness />);
    expect(screen.getByTestId("exact-web-home-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-home-surface")).not.toBeInTheDocument();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("wraps the same canonical runtime tree on mobile", () => {
    setViewportWidth(375);
    render(<TestHarness />);
    expect(screen.getByTestId("mobile-home-surface")).toContainElement(
      screen.getByTestId("exact-web-home-surface"),
    );
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("uses the mobile wrapper at 767px and desktop at 768px", () => {
    setViewportWidth(767);
    const rendered = render(<TestHarness />);
    expect(screen.getByTestId("mobile-home-surface")).toBeInTheDocument();
    rendered.unmount();

    setViewportWidth(768);
    render(<TestHarness />);
    expect(screen.queryByTestId("mobile-home-surface")).not.toBeInTheDocument();
  });
});
