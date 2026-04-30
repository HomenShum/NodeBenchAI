import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseConvexAuth = vi.fn();
const mockUseQuery = vi.fn();
const mockUseConvex = vi.fn();
const mockSignIn = vi.fn();
const mockConvexMutation = vi.fn();

vi.mock("convex/react", () => ({
  useConvexAuth: () => mockUseConvexAuth(),
  useConvex: () => mockUseConvex(),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn }),
}));

import { AgentPresenceRail } from "./AgentPresenceRail";
import { WorkspaceRail } from "./WorkspaceRail";

describe("cockpit rails", () => {
  beforeEach(() => {
    mockUseConvexAuth.mockReset();
    mockUseConvex.mockReset();
    mockUseQuery.mockReset();
    mockSignIn.mockReset();
    mockConvexMutation.mockReset();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    mockUseConvexAuth.mockReturnValue({ isAuthenticated: true });
    mockConvexMutation.mockResolvedValue(undefined);
    mockUseConvex.mockReturnValue({ mutation: mockConvexMutation });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the agent rail toggle visible when collapsed", () => {
    mockUseQuery
      .mockReturnValueOnce({ successRate: 87, activeNow: 2, totalAgents: 6 })
      .mockReturnValueOnce([{ _id: "approval-1" }])
      .mockReturnValueOnce([{ _id: "receipt-1" }, { _id: "receipt-2" }]);

    render(
      <AgentPresenceRail
        currentSurface="ask"
        currentView="control-plane"
        currentObjective="Mission control"
        isCollapsed={true}
        onToggleCollapse={vi.fn()}
      />,
    );

    const rail = screen.getByRole("complementary", { name: "Agent presence rail" });
    expect(rail.className).toContain("w-0");
    expect(rail.className).toContain("overflow-visible");
    expect(screen.getByRole("button", { name: "Expand agent rail" })).toBeTruthy();
  });

  it("renders live runtime metrics from query data", () => {
    mockUseQuery
      .mockReturnValueOnce({ successRate: 87, activeNow: 2, totalAgents: 6 })
      .mockReturnValueOnce([{ _id: "approval-1" }])
      .mockReturnValueOnce([{ _id: "receipt-1" }, { _id: "receipt-2" }]);

    render(
      <AgentPresenceRail
        currentSurface="trace"
        currentView="agents"
        currentObjective="Trace review"
      />,
    );

    expect(screen.getByText("87%")).toBeTruthy();
    expect(screen.getByText("2 receipts")).toBeTruthy();
    expect(screen.getByText("2/6")).toBeTruthy();
    expect(
      screen
        .getByRole("complementary", { name: "Agent presence rail" })
        .textContent?.replace(/\s+/g, " ")
        .trim(),
    ).toContain("1 action waiting");
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
});
