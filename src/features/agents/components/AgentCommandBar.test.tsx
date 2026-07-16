import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCommandBar } from "./AgentCommandBar";

describe("AgentCommandBar", () => {
  afterEach(cleanup);

  it("submits a plain question through the single-agent path", () => {
    const onSubmit = vi.fn();
    render(<AgentCommandBar onSubmit={onSubmit} />);

    expect(screen.queryByText(/Swarm:/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Suggestions").closest("details"),
    ).not.toHaveAttribute("open");

    fireEvent.change(screen.getByRole("textbox", { name: "Message input" }), {
      target: { value: "What changed in the latest filing?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]?.[0]).toBe(
      "What changed in the latest filing?",
    );
    expect(onSubmit.mock.calls[0]?.[1].agents).toBeUndefined();
  });

  it("keeps swarm suggestions secondary and exposes controls only for /spawn", () => {
    const onSubmit = vi.fn();
    render(<AgentCommandBar onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("Suggestions"));
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Message input" }), {
      target: { value: '/spawn "Compare chips" --agents=doc,media,sec' },
    });

    expect(screen.getByText("Swarm: 3 agents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Compare chips",
      expect.objectContaining({
        agents: ["DocumentAgent", "MediaAgent", "SECAgent"],
      }),
    );
  });

  it("does not submit an empty question", () => {
    const onSubmit = vi.fn();
    render(<AgentCommandBar onSubmit={onSubmit} />);

    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("offers only real single-agent suggestions when swarm auth is unavailable", () => {
    const onSubmit = vi.fn();
    render(<AgentCommandBar onSubmit={onSubmit} allowSpawn={false} />);

    fireEvent.click(screen.getByText("Suggestions"));
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    const input = screen.getByRole("textbox", { name: "Message input" });
    expect(input).toHaveValue("Research a company using current sources.");
    expect((input as HTMLTextAreaElement).value).not.toContain("/spawn");
    expect(screen.queryByText(/Swarm:/i)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "/" } });
    expect(screen.queryByText("Spawn Command")).not.toBeInTheDocument();
  });
});
