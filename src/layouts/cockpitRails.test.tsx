import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseConvexAuth = vi.fn();
const mockUseQuery = vi.fn();
const mockUseConvex = vi.fn();
const mockSignIn = vi.fn();
const mockConvexMutation = vi.fn();
const mockUseConvexApi = vi.fn();
const mockUseOnlineStatus = vi.fn();

vi.mock("convex/react", () => ({
  useConvexAuth: () => mockUseConvexAuth(),
  useConvex: () => mockUseConvex(),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn }),
}));

vi.mock("@/lib/convexApi", () => ({
  useConvexApi: () => mockUseConvexApi(),
}));

vi.mock("@/lib/performance/useOnlineStatus", () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

import { StatusStrip } from "./StatusStrip";
import { WorkspaceRail } from "./WorkspaceRail";
import { CommandPalette } from "./chrome/CommandPalette";

describe("cockpit rails", () => {
  beforeEach(() => {
    mockUseConvexAuth.mockReset();
    mockUseConvex.mockReset();
    mockUseQuery.mockReset();
    mockSignIn.mockReset();
    mockConvexMutation.mockReset();
    mockUseConvexApi.mockReset();
    mockUseOnlineStatus.mockReset();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockConvexMutation.mockResolvedValue(undefined);
    mockUseConvex.mockReturnValue({ mutation: mockConvexMutation });
    mockUseConvexApi.mockReturnValue(null);
    mockUseOnlineStatus.mockReturnValue({ online: true, convexConnected: true });
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("wires the workspace settings button to the provided handler", () => {
    const onOpenSettings = vi.fn();

    mockUseQuery
      .mockReturnValueOnce({ sessions: [] })
      .mockReturnValueOnce([])
      .mockReturnValueOnce({ watchlists: [] });

    render(
      <MemoryRouter>
        <WorkspaceRail
          activeSurface="ask"
          onSurfaceChange={vi.fn()}
          isCollapsed={false}
          onToggleCollapse={vi.fn()}
          onOpenSettings={onOpenSettings}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the Chat header to a truthful title, connection state, and wired search", () => {
    const onOpenPalette = vi.fn();

    render(
      <StatusStrip
        currentView="chat-home"
        entityName="Acme"
        chatHasSession
        onOpenPalette={onOpenPalette}
      />,
    );

    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.queryByText(/NodeBench Max|NodeBench Fast/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("distinguishes authenticated, guest, loading, degraded, and offline connection states", () => {
    const renderStatus = () => render(<StatusStrip currentView="agents" />);

    mockUseConvexAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    const guest = renderStatus();
    expect(screen.getByText("Guest session")).toBeTruthy();
    guest.unmount();

    mockUseConvexAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });
    const loading = renderStatus();
    expect(screen.getByText("Checking session")).toBeTruthy();
    loading.unmount();

    vi.useFakeTimers();
    const degraded = renderStatus();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Session connection delayed")).toBeTruthy();
    degraded.unmount();
    vi.useRealTimers();

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mockUseOnlineStatus.mockReturnValue({ online: false, convexConnected: false });
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    const offline = renderStatus();
    expect(screen.getByText("You are offline")).toBeTruthy();
    offline.unmount();

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    mockUseOnlineStatus.mockReturnValue({ online: true, convexConnected: true });
    const authenticated = renderStatus();
    expect(screen.getByText("Connected")).toBeTruthy();
    authenticated.unmount();

    mockUseOnlineStatus.mockReturnValue({ online: true, convexConnected: false });
    const backendDisconnected = renderStatus();
    expect(screen.getByText("Session connection delayed")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
    backendDisconnected.unmount();
  });

  it("starts the canonical Home focus handoff without requiring a pre-mounted input", () => {
    mockUseQuery.mockReturnValue([]);
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={onClose} />
      </MemoryRouter>,
    );

    const quickSearch = document.querySelector<HTMLButtonElement>(
      '[data-agent-id="cmd:quick-search"]',
    );
    expect(quickSearch).not.toBeNull();
    fireEvent.click(quickSearch!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens recent documents through the canonical shell event", () => {
    mockUseConvexApi.mockReturnValue({
      domains: { documents: { documents: { getSidebar: "documents:getSidebar" } } },
    });
    mockUseQuery.mockReturnValue([{ _id: "doc-1", title: "Runtime document" }]);
    const onClose = vi.fn();
    const onOpenDocument = vi.fn();
    window.addEventListener("nodebench:openDocument", onOpenDocument);

    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={onClose} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Runtime document").closest("button")!);

    expect(onOpenDocument).toHaveBeenCalledTimes(1);
    expect((onOpenDocument.mock.calls[0][0] as CustomEvent).detail).toEqual({
      documentId: "doc-1",
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    window.removeEventListener("nodebench:openDocument", onOpenDocument);
  });
});
