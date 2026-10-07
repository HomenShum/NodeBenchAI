import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PublicEntityShareView from "./PublicEntityShareView";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const navigateMock = vi.fn();
const recordViewMock = vi.fn().mockResolvedValue(undefined);

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("PublicEntityShareView", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    navigateMock.mockReset();
    recordViewMock.mockClear();
    useMutationMock.mockReturnValue(recordViewMock);
    window.history.replaceState({}, "", "/share/share_tok_123");
  });

  it("redirects active public tokens into canonical entity read mode", async () => {
    useQueryMock.mockReturnValue({
      status: "active",
      resourceType: "entity",
      resourceSlug: "acme-ai",
      label: "Acme AI",
      createdAt: Date.now(),
    });

    render(<PublicEntityShareView />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/entity/acme-ai?share=share_tok_123&view=read", {
        replace: true,
      }),
    );
    expect(recordViewMock).toHaveBeenCalledWith({ token: "share_tok_123" });
    expect(screen.getByText("Opening Acme AI")).toBeInTheDocument();
  });

  it("does not redirect unsupported public resource types into entity routes", async () => {
    useQueryMock.mockReturnValue({
      status: "active",
      resourceType: "memo",
      resourceSlug: "memo-123",
      label: "Investor memo",
      createdAt: Date.now(),
    });

    render(<PublicEntityShareView />);

    await waitFor(() => expect(screen.getByText("Opening Investor memo")).toBeInTheDocument());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(recordViewMock).not.toHaveBeenCalled();
  });

  it("renders honest status messaging for revoked links", () => {
    useQueryMock.mockReturnValue({
      status: "revoked",
    });

    render(<PublicEntityShareView />);

    expect(screen.getByText("Link revoked")).toBeInTheDocument();
    expect(
      screen.getByText("The owner revoked access to this link. Request a new one from them."),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders invalid-link messaging when no token is present", () => {
    window.history.replaceState({}, "", "/share/");
    render(<PublicEntityShareView />);

    expect(screen.getByText("No share token")).toBeInTheDocument();
    expect(
      screen.getByText("This URL is missing a token. Ask the sender for a fresh link."),
    ).toBeInTheDocument();
    expect(useQueryMock.mock.calls).toHaveLength(1);
    expect(useQueryMock.mock.calls[0]?.[1]).toBe("skip");
  });
});
