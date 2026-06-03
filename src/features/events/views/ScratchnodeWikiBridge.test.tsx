/**
 * Scenario tests for the ScratchNode -> NodeBench bridge receiving surface.
 * Persona: a guest who clicked "Continue in NodeBench" from a ScratchNode wiki.
 * Verifies the route renders the public recap, frames the conversion, stays
 * honest on unpublished/loading, and sanitizes the wiki body (XSS defense).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
    const cta = screen.getByTestId("scratchnode-wiki-bridge-cta-nodebench");
    expect(cta).toHaveAttribute("href", "/");
    expect(screen.getByText("View the public wiki")).toHaveAttribute(
      "href",
      "https://scratchnode.live/wiki/rooftop-launch",
    );
    expect(screen.getByText(/Open in ScratchNode/)).toHaveAttribute(
      "href",
      "https://scratchnode.live/e/rooftop",
    );
  });

  it("prefers the published wiki room code over a stale query room when building the return link", () => {
    useQueryMock.mockReturnValue(WIKI);
    render(<ScratchnodeWikiBridge slug="rooftop-launch" roomCode="WRONGROOM" />);

    expect(screen.getAllByText(/Open in ScratchNode/)[0]).toHaveAttribute(
      "href",
      "https://scratchnode.live/e/rooftop",
    );
  });

  it("shows an honest empty state for an unpublished or unknown room", () => {
    useQueryMock.mockReturnValue(null);
    render(<ScratchnodeWikiBridge slug="not-published" />);

    expect(screen.getByTestId("scratchnode-wiki-bridge-empty")).toHaveTextContent(
      /hasn.t published its wiki yet/i,
    );
    expect(screen.queryByTestId("scratchnode-wiki-bridge-body")).toBeNull();
  });

  it("uses the explicit room code for the ScratchNode return link when no wiki is published yet", () => {
    useQueryMock.mockReturnValue(null);
    render(<ScratchnodeWikiBridge slug="not-published" roomCode="ORBITAL" />);

    expect(screen.getByText(/Open in ScratchNode/)).toHaveAttribute(
      "href",
      "https://scratchnode.live/e/orbital",
    );
  });

  it("shows a loading state while the query resolves", () => {
    useQueryMock.mockReturnValue(undefined);
    render(<ScratchnodeWikiBridge slug="rooftop-launch" />);

    expect(screen.getByTestId("scratchnode-wiki-bridge-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("scratchnode-wiki-bridge-empty")).toBeNull();
  });

  it("sanitizes the wiki body before render", () => {
    useQueryMock.mockReturnValue({
      ...WIKI,
      bodyHtml:
        "<p>KEEP_THIS</p><script>window.__xss=1</script><img src=x onerror=\"window.__xss=1\">",
    });
    const { container } = render(<ScratchnodeWikiBridge slug="rooftop-launch" />);

    const body = screen.getByTestId("scratchnode-wiki-bridge-body");
    expect(body).toHaveTextContent("KEEP_THIS");
    expect(container.querySelector("script")).toBeNull();
    expect(body.innerHTML).not.toContain("onerror");
    expect(body.innerHTML).not.toContain("window.__xss");
  });

  it("keeps public wiki bridge links visibility-safe and free of private handoff params", () => {
    useQueryMock.mockReturnValue(WIKI);
    render(
      <ScratchnodeWikiBridge
        slug="rooftop-launch"
        source="scratchnode"
        roomCode="ORBITAL"
      />,
    );

    const publicWikiHref = screen.getByText("View the public wiki").getAttribute("href");
    const roomHref = screen.getByText(/Open in ScratchNode/).getAttribute("href");

    expect(publicWikiHref).toBe("https://scratchnode.live/wiki/rooftop-launch");
    expect(roomHref).toBe("https://scratchnode.live/e/rooftop");

    for (const href of [publicWikiHref, roomHref]) {
      expect(href).not.toContain("token=");
      expect(href).not.toContain("session=");
      expect(href).not.toContain("source=");
      expect(href).not.toContain("room=");
      expect(href).not.toContain("continuation=");
      expect(href).not.toContain("publicArtifact=");
      expect(href).not.toContain("noteCount=");
    }
  });
});
