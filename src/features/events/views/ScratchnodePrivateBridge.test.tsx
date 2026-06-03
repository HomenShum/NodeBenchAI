/**
 * Scenario tests for the ScratchNode → NodeBench PRIVATE-NOTES bridge surface.
 * Persona: a guest who tapped "Continue in NodeBench" from a ScratchNode room and
 * landed on /events/<slug>/private?token=<token>.
 *
 * Verifies the surface redeems the token EXACTLY once, renders the bound notes
 * read-only, frames the sign-in conversion, and stays HONEST + FAIL-CLOSED on
 * every denial (invalid / expired / used / missing token) — never a fabricated
 * note, never the token or session id in the DOM.
 */
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const consumeMock = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: () => consumeMock,
}));

import { ScratchnodePrivateBridge } from "./ScratchnodePrivateBridge";

const RESULT = {
  eventName: "Rooftop Launch Party",
  eventSlug: "rooftop-launch",
  roomCode: "ROOFTOP",
  scope: "private_notes_read" as const,
  noteCount: 1,
  notes: [
    {
      noteId: "userNotes:1",
      title: "My takeaways",
      bodyHtml: "<p>PRIVATE_NOTE_BODY</p>",
      tags: ["mcp"],
      pinned: true,
      isAsk: false,
      createdAt: 1770000000000,
      updatedAt: 1770000000000,
    },
  ],
  _truncated: false,
};

function convexError(code: string) {
  const err = new Error(code) as Error & { data?: { code: string } };
  err.data = { code };
  return err;
}

afterEach(() => {
  cleanup();
  consumeMock.mockReset();
});

describe("ScratchnodePrivateBridge", () => {
  it("redeems the token once and renders the bound private notes read-only", async () => {
    consumeMock.mockResolvedValue(RESULT);
    render(<ScratchnodePrivateBridge slug="rooftop-launch" token="opaque-token-abcdefghijklmno" roomCode="ROOFTOP" />);

    await waitFor(() =>
      expect(screen.getByTestId("scratchnode-private-bridge-note-body")).toHaveTextContent(
        "PRIVATE_NOTE_BODY",
      ),
    );
    // Conversion affordance points at sign-in (keep these notes).
    const cta = screen.getByTestId("scratchnode-private-bridge-cta-signin");
    expect(cta).toHaveAttribute("href", "/sign-in?intent=save-private-notes");

    // Consume called EXACTLY once with ONLY the token (no owner key).
    expect(consumeMock).toHaveBeenCalledTimes(1);
    expect(consumeMock).toHaveBeenCalledWith({ token: "opaque-token-abcdefghijklmno" });

    // The token must NEVER appear in the rendered DOM.
    expect(document.body.innerHTML).not.toContain("opaque-token-abcdefghijklmno");
  });

  it("prefers the redeemed room code over a stale query room when building the ScratchNode return link", async () => {
    consumeMock.mockResolvedValue(RESULT);
    render(
      <ScratchnodePrivateBridge
        slug="rooftop-launch"
        token="opaque-token-abcdefghijklmno"
        roomCode="WRONGROOM"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("scratchnode-private-bridge-note-body")).toHaveTextContent(
        "PRIVATE_NOTE_BODY",
      ),
    );

    expect(screen.getByText(/Back to ScratchNode/i)).toHaveAttribute(
      "href",
      "https://scratchnode.live/e/rooftop",
    );
  });

  it("shows a loading state while redeeming (no premature empty/error)", () => {
    // Never resolves — stays in the redeeming phase.
    consumeMock.mockReturnValue(new Promise(() => {}));
    render(<ScratchnodePrivateBridge slug="rooftop-launch" token="opaque-token-abcdefghijklmno" />);

    expect(screen.getByTestId("scratchnode-private-bridge-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("scratchnode-private-bridge-error")).toBeNull();
    expect(screen.queryByTestId("scratchnode-private-bridge-note")).toBeNull();
  });

  it("FAIL-CLOSED: an expired token shows an honest expired state, never a note", async () => {
    consumeMock.mockRejectedValue(convexError("token_expired"));
    render(<ScratchnodePrivateBridge slug="rooftop-launch" token="opaque-token-abcdefghijklmno" />);

    await waitFor(() => {
      const err = screen.getByTestId("scratchnode-private-bridge-error");
      expect(err).toHaveAttribute("data-error-code", "token_expired");
      expect(err).toHaveTextContent(/expired/i);
    });
    expect(screen.queryByTestId("scratchnode-private-bridge-note")).toBeNull();
  });

  it("FAIL-CLOSED: an invalid/tampered token shows the invalid state (no fabricated notes)", async () => {
    consumeMock.mockRejectedValue(convexError("invalid_token"));
    render(<ScratchnodePrivateBridge slug="rooftop-launch" token="tampered-token-abcdefghijklmno" />);

    await waitFor(() => {
      const err = screen.getByTestId("scratchnode-private-bridge-error");
      expect(err).toHaveAttribute("data-error-code", "invalid_token");
    });
    expect(screen.queryByTestId("scratchnode-private-bridge-note-body")).toBeNull();
  });

  it("FAIL-CLOSED: a used-up token shows the used state", async () => {
    consumeMock.mockRejectedValue(convexError("token_used"));
    render(<ScratchnodePrivateBridge slug="rooftop-launch" token="opaque-token-abcdefghijklmno" />);

    await waitFor(() =>
      expect(screen.getByTestId("scratchnode-private-bridge-error")).toHaveAttribute(
        "data-error-code",
        "token_used",
      ),
    );
  });

  it("shows a 'missing token' state and NEVER calls consume when no token is present", () => {
    render(<ScratchnodePrivateBridge slug="rooftop-launch" token={null} roomCode="ROOFTOP" />);

    expect(screen.getByTestId("scratchnode-private-bridge-no-token")).toBeInTheDocument();
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it("renders an honest empty state when the room has zero private notes (not an error)", async () => {
    consumeMock.mockResolvedValue({ ...RESULT, noteCount: 0, notes: [] });
    render(<ScratchnodePrivateBridge slug="rooftop-launch" token="opaque-token-abcdefghijklmno" />);

    await waitFor(() =>
      expect(screen.getByTestId("scratchnode-private-bridge-empty")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("scratchnode-private-bridge-error")).toBeNull();
  });

  it("SANITIZES note bodyHtml — a script/onerror payload never reaches the DOM", async () => {
    consumeMock.mockResolvedValue({
      ...RESULT,
      notes: [
        {
          ...RESULT.notes[0],
          bodyHtml: '<p>safe</p><script>window.__xss=1</script><img src=x onerror="window.__xss=2">',
        },
      ],
    });
    render(<ScratchnodePrivateBridge slug="rooftop-launch" token="opaque-token-abcdefghijklmno" />);

    await waitFor(() => screen.getByTestId("scratchnode-private-bridge-note-body"));
    const body = screen.getByTestId("scratchnode-private-bridge-note-body");
    expect(body.querySelector("script")).toBeNull();
    expect(body.innerHTML).not.toContain("onerror");
    expect(body).toHaveTextContent("safe");
  });
});
