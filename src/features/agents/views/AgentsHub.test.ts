import { describe, expect, it, vi } from "vitest";

import { routeAgentCommand } from "./AgentsHub";

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
});
