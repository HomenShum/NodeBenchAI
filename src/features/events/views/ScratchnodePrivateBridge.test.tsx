/**
 * Tests for the NodeBench private-notes receiving surface (#4). Persona: a guest
 * who clicked "Continue in NodeBench" from a ScratchNode room. Verifies honest
 * states (valid token → notes; expired/invalid → real error, no fabricated note),
 * that the wiki body is sanitized, and that the opaque token is NEVER rendered.
 */
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const consumeMock = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: () => consumeMock,
}));

import { ScratchnodePrivateBridge } from "./ScratchnodePrivateBridge";

const TOKEN = "opaque-token-AbC123-xyz_-deadbeefcafef00d000111";

afterEach(() => {
  cleanup();
  consumeMock.mockReset();
});

describe("ScratchnodePrivateBridge", () => {
  it("renders the read-only notes for a valid token, with a sign-in CTA", async () => {
    consumeMock.mockResolvedValue({
      ok: true,
      eventName: "Rooftop Launch",
      eventSlug: "rooftop",
      noteCount: 1,
      notes: [{ title: "My private note", bodyHtml: "<p>PRIVATE_BODY_TEXT</p>", pinned: true, updatedAt: 1770000000000 }],
    });
    render(<ScratchnodePrivateBridge slug="rooftop" token={TOKEN} />);

    await waitFor(() => expect(screen.getByTestId("scratchnode-private-list")).toBeInTheDocument());
    expect(screen.getByTestId("scratchnode-private-list")).toHaveTextContent("PRIVATE_BODY_TEXT");
    expect(screen.getByTestId("scratchnode-private-cta")).toHaveAttribute("href", "/");
    // SECURITY: the opaque token must never be rendered anywhere on the page.
    expect(document.body.innerHTML).not.toContain(TOKEN);
    // consume was called with exactly the token (once).
    expect(consumeMock).toHaveBeenCalledWith({ token: TOKEN });
  });

  it("shows an honest expired state (never a fabricated note) for an expired token", async () => {
    consumeMock.mockResolvedValue({ ok: false, reason: "expired" });
    render(<ScratchnodePrivateBridge slug="rooftop" token={TOKEN} />);
    await waitFor(() => expect(screen.getByTestId("scratchnode-private-error")).toBeInTheDocument());
    expect(screen.getByTestId("scratchnode-private-error")).toHaveTextContent("expired");
    expect(screen.queryByTestId("scratchnode-private-list")).toBeNull();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("treats a missing token as invalid without calling the backend", async () => {
    render(<ScratchnodePrivateBridge slug="rooftop" token={null} />);
    await waitFor(() => expect(screen.getByTestId("scratchnode-private-error")).toBeInTheDocument());
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("shows an honest empty state when the snapshot has no notes", async () => {
    consumeMock.mockResolvedValue({ ok: true, eventName: "Rooftop", eventSlug: "rooftop", noteCount: 0, notes: [] });
    render(<ScratchnodePrivateBridge slug="rooftop" token={TOKEN} />);
    await waitFor(() => expect(screen.getByTestId("scratchnode-private-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("scratchnode-private-list")).toBeNull();
  });

  it("SANITIZES note bodies — script/handlers never reach the DOM (XSS defense)", async () => {
    consumeMock.mockResolvedValue({
      ok: true, eventName: "Rooftop", eventSlug: "rooftop", noteCount: 1,
      notes: [{ title: "x", bodyHtml: "<p>KEEP</p><script>window.__x=1</script><img src=x onerror=\"window.__x=1\">", pinned: false, updatedAt: 1 }],
    });
    const { container } = render(<ScratchnodePrivateBridge slug="rooftop" token={TOKEN} />);
    await waitFor(() => expect(screen.getByTestId("scratchnode-private-list")).toHaveTextContent("KEEP"));
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("scratchnode-private-list").innerHTML).not.toContain("onerror");
  });
});
