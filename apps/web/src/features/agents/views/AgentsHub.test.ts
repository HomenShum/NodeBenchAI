import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => vi.fn(),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

import { AgentGrid, routeAgentCommand } from "./AgentsHub";

beforeEach(() => useQueryMock.mockReset());
afterEach(cleanup);

describe("AgentGrid", () => {
  it("renders an honest empty state instead of configured idle agents", () => {
    useQueryMock.mockReturnValue([]);

    render(React.createElement(AgentGrid));

    expect(
      screen.getByText("No agent runtime activity has been recorded."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Coordinator Agent")).not.toBeInTheDocument();
  });
});

describe("routeAgentCommand", () => {
  it("opens the canonical chat panel for a plain question", async () => {
    const spawnSwarm = vi.fn();
    const openWithContext = vi.fn();

    await routeAgentCommand(
      "Summarize today's signals",
      { model: "gemini-2.5-flash" },
      { spawnSwarm, openWithContext },
    );

    expect(spawnSwarm).not.toHaveBeenCalled();
    expect(openWithContext).toHaveBeenCalledTimes(1);
    expect(openWithContext).toHaveBeenCalledWith({
      initialMessage: "Summarize today's signals",
      initialTab: "chat",
    });
  });

  it("keeps explicit swarm commands on the swarm path", async () => {
    const spawnSwarm = vi.fn().mockResolvedValue(undefined);
    const openWithContext = vi.fn();

    await routeAgentCommand(
      "Compare filings",
      { model: "gemini-2.5-flash", agents: ["doc", "sec"] },
      { spawnSwarm, openWithContext },
    );

    expect(openWithContext).not.toHaveBeenCalled();
    expect(spawnSwarm).toHaveBeenCalledTimes(1);
    expect(spawnSwarm).toHaveBeenCalledWith({
      query: "Compare filings",
      agents: ["doc", "sec"],
      pattern: "fan_out_gather",
      model: "gemini-2.5-flash",
    });
  });

  it("fails closed to the real guest chat path when swarm auth is unavailable", async () => {
    const spawnSwarm = vi.fn();
    const openWithContext = vi.fn();

    await routeAgentCommand(
      "Compare filings",
      { model: "gemini-2.5-flash", agents: ["doc", "sec"] },
      { canSpawn: false, spawnSwarm, openWithContext },
    );

    expect(spawnSwarm).not.toHaveBeenCalled();
    expect(openWithContext).toHaveBeenCalledWith({
      initialMessage: "Compare filings",
      initialTab: "chat",
    });
  });
});
