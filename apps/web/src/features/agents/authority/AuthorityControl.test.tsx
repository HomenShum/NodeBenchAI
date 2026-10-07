import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthorityControl } from "./AuthorityControl";

const baseProps = {
  mode: "review" as const,
  grantStatus: "inactive" as const,
  isAuthenticated: true,
  onModeChange: vi.fn(),
};

describe("AuthorityControl", () => {
  it("starts from the review-safe contract and discloses the exact capability boundary", () => {
    render(<AuthorityControl {...baseProps} />);

    expect(
      screen.getByRole("radio", { name: /Review every change/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Autonomous this run/i }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Autonomous workspace/i }),
    ).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Review required");
    expect(screen.getByText("notebook.update_block")).toBeInTheDocument();
    expect(screen.getByText(/Publish · Share · Export · Delete/)).toBeInTheDocument();
    expect(screen.getByText(/Network egress · File access/)).toBeInTheDocument();
  });

  it("keeps unauthenticated sessions review-only", () => {
    const onModeChange = vi.fn();
    render(
      <AuthorityControl
        {...baseProps}
        mode="workspace"
        grantStatus="active"
        isAuthenticated={false}
        onModeChange={onModeChange}
        onPause={vi.fn()}
      />,
    );

    const runMode = screen.getByRole("radio", {
      name: /Autonomous this run/i,
    });
    const workspaceMode = screen.getByRole("radio", {
      name: /Autonomous workspace/i,
    });

    expect(runMode).toBeDisabled();
    expect(workspaceMode).toBeDisabled();
    expect(
      screen.getByRole("radio", { name: /Review every change/i }),
    ).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Review required");
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    fireEvent.click(workspaceMode);
    expect(onModeChange).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Shared, member, and guest sessions stay in Review every change/i),
    ).toBeInTheDocument();
  });

  it("keeps run authority disabled until a concrete live run exists", () => {
    render(
      <AuthorityControl
        {...baseProps}
        runAuthorityAvailable={false}
      />,
    );

    expect(
      screen.getByRole("radio", { name: /Autonomous this run/i }),
    ).toBeDisabled();
    expect(screen.getAllByText("No live run available")).toHaveLength(2);
    expect(
      screen.getByRole("radio", { name: /Autonomous workspace/i }),
    ).toBeEnabled();
  });

  it("requests an authenticated mode change without manufacturing local grant state", () => {
    const onModeChange = vi.fn();
    render(<AuthorityControl {...baseProps} onModeChange={onModeChange} />);

    fireEvent.click(
      screen.getByRole("radio", { name: /Autonomous this run/i }),
    );

    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith("run");
    expect(screen.getByRole("status")).toHaveTextContent("Review required");
  });

  it("requires a separate confirmation before owner-wide workspace authority", () => {
    const onModeChange = vi.fn();
    render(<AuthorityControl {...baseProps} onModeChange={onModeChange} />);

    fireEvent.click(
      screen.getByRole("radio", { name: /Autonomous workspace/i }),
    );

    expect(onModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /existing blocks in all your NodeBench notebooks/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Network egress, file access, spend, publishing/i,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Grant workspace authority" }),
    );
    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith("workspace");
  });

  it("shows only the valid active-grant controls and durable metadata", () => {
    const onPause = vi.fn();
    const onRevoke = vi.fn();
    render(
      <AuthorityControl
        {...baseProps}
        mode="workspace"
        grantStatus="active"
        onPause={onPause}
        onRevoke={onRevoke}
        agentLabel="Research agent"
        grantReference="grant_4f2"
        expiresAtLabel="in 45 minutes"
        remainingOperations={8}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Delegated · active");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(onPause).toHaveBeenCalledOnce();
    expect(onRevoke).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.getByText("grant_4f2")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("bounds long grant references while preserving the full server id", () => {
    const grantReference = `grant_${"a".repeat(80)}`;
    render(
      <AuthorityControl
        {...baseProps}
        mode="workspace"
        grantStatus="active"
        grantReference={grantReference}
      />,
    );

    const reference = screen.getByTitle(grantReference);
    expect(reference).toHaveClass("truncate", "min-w-0");
    expect(reference).toHaveAccessibleName(`Grant ${grantReference}`);
  });

  it("supports resume or revoke while paused", () => {
    const onResume = vi.fn();
    const onRevoke = vi.fn();
    render(
      <AuthorityControl
        {...baseProps}
        mode="run"
        grantStatus="paused"
        onResume={onResume}
        onRevoke={onRevoke}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Delegated · paused");
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onRevoke).toHaveBeenCalledOnce();
  });

  it.each([
    ["revoked", "Grant revoked", "This grant was revoked"],
    ["expired", "Grant expired", "This grant expired"],
    ["consumed", "Operation cap reached", "This grant reached its operation cap"],
  ] as const)(
    "renders %s as ended rather than autonomous",
    (grantStatus, statusLabel, summary) => {
      render(
        <AuthorityControl
          {...baseProps}
          mode="workspace"
          grantStatus={grantStatus}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onRevoke={vi.fn()}
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent(statusLabel);
      expect(
        screen.getByRole("radio", { name: /Review every change/i }),
      ).toBeChecked();
      expect(screen.getByText(new RegExp(summary))).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    },
  );
});
