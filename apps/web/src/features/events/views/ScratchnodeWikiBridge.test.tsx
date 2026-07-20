/**
 * Scenario tests for the ScratchNode -> NodeBench bridge receiving surface.
 * Persona: a guest who clicked "Continue in NodeBench" from a ScratchNode wiki.
 * Verifies the route renders the public recap, frames the conversion, stays
 * honest on unpublished/loading, and SANITIZES the wiki body (XSS defense).
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

import { ScratchnodeWikiBridge } from "./ScratchnodeWikiBridge";

const WIKI = {
  eventName: "Rooftop Launch Party",
  eventSlug: "rooftop-launch",
  roomCode: "ROOFTOP",
  eventStatus: "ended",
  title: "Rooftop Launch Party Wiki",
  bodyHtml: "<h1>Rooftop Launch</h1><p>PUBLIC_RECAP_BODY</p>",
  version: 2,
  publishedAt: 1770000000000,
};

afterEach(() => {
  cleanup();
  useQueryMock.mockReset();
});

describe("ScratchnodeWikiBridge", () => {
  it("renders a published wiki with a NodeBench conversion CTA", () => {
    useQueryMock.mockReturnValue(WIKI);
    render(<ScratchnodeWikiBridge slug="rooftop-launch" source="scratchnode" roomCode="ROOFTOP" />);

    expect(screen.getByTestId("scratchnode-wiki-bridge-body")).toHaveTextContent("PUBLIC_RECAP_BODY");
    // Conversion CTA points into the NodeBench app (a real, working route).
    const cta = screen.getByTestId("scratchnode-wiki-bridge-cta-nodebench");
    expect(cta).toHaveAttribute("href", "/");
    // Reverse paths back to ScratchNode are present and well-formed.
    expect(screen.getByText("View the public wiki")).toHaveAttribute(
      "href",
      "https://scratchnode.live/wiki/rooftop-launch",
    );
    expect(screen.getByText("Open in ScratchNode →")).toHaveAttribute(
      "href",
      "https://scratchnode.live/e/rooftop",
    );
  });

  it("shows an honest empty state for an unpublished/unknown room (never a fake recap)", () => {
    useQueryMock.mockReturnValue(null);
    render(<ScratchnodeWikiBridge slug="not-published" />);

    expect(screen.getByTestId("scratchnode-wiki-bridge-empty")).toHaveTextContent(
      "hasn’t published its wiki yet",
    );
    // No recap body is fabricated.
    expect(screen.queryByTestId("scratchnode-wiki-bridge-body")).toBeNull();
  });

  it("shows a loading state while the query resolves (no premature empty/error)", () => {
    useQueryMock.mockReturnValue(undefined);
    render(<ScratchnodeWikiBridge slug="rooftop-launch" />);

    expect(screen.getByTestId("scratchnode-wiki-bridge-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("scratchnode-wiki-bridge-empty")).toBeNull();
  });

  it("SANITIZES the wiki body — script/handlers are stripped before render (XSS defense)", () => {
    useQueryMock.mockReturnValue({
      ...WIKI,
      bodyHtml:
        "<p>KEEP_THIS</p><script>window.__xss=1</script><img src=x onerror=\"window.__xss=1\">",
    });
    const { container } = render(<ScratchnodeWikiBridge slug="rooftop-launch" />);

    const body = screen.getByTestId("scratchnode-wiki-bridge-body");
    expect(body).toHaveTextContent("KEEP_THIS");
    // The dangerous bits never reach the DOM.
    expect(container.querySelector("script")).toBeNull();
    expect(body.innerHTML).not.toContain("onerror");
    expect(body.innerHTML).not.toContain("window.__xss");
  });
});
