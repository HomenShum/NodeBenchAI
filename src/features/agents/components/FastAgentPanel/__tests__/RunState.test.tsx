import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AgentRunErrorBanner,
  isActiveAgentRunStatus,
  isTerminalAgentRunStatus,
} from "../FastAgentPanel.RunState";

describe("FastAgentPanel run state", () => {
  it.each(["pending", "queued", "running", "scheduled"])(
    "treats %s as active before an assistant row exists",
    (status) => {
      expect(isActiveAgentRunStatus(status)).toBe(true);
      expect(isTerminalAgentRunStatus(status)).toBe(false);
    },
  );

  it.each(["completed", "error", "failed", "cancelled"])(
    "treats %s as terminal",
    (status) => {
      expect(isTerminalAgentRunStatus(status)).toBe(true);
      expect(isActiveAgentRunStatus(status)).toBe(false);
    },
  );

  it("renders a persistent owner-visible failure instead of silence", () => {
    render(
      <AgentRunErrorBanner
        errorMessage="Model is not available on the free tier"
        status="error"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Agent run stopped");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Model is not available on the free tier",
    );
  });

  it("does not render an error banner for a completed run", () => {
    render(<AgentRunErrorBanner status="completed" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
