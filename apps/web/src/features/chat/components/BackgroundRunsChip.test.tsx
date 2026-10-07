/**
 * Tests for BackgroundRunsChip — top-bar indicator for background-mode runs.
 *
 * Scenario: A user kicks off a background-mode diligence run (the 202 path)
 *           and navigates to a different surface. The chip reminds them that
 *           work is happening and gives them one click to open the drawer.
 *
 * Invariants under test:
 *   - Hidden when both counts are zero (don't advertise nothing)
 *   - Singular/plural grammar correct (Ive rule)
 *   - Accessibility: clear aria-label with both counts
 *   - Attention state (no running, some failed) still renders
 *   - Click handler wired correctly
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackgroundRunsChip } from "./BackgroundRunsChip";

describe("BackgroundRunsChip", () => {
  it("does NOT render when both counts are zero", () => {
    const { container } = render(<BackgroundRunsChip runningCount={0} attentionCount={0} />);
    // The outer <button> should not exist
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders singular '1 running' for exactly one running run", () => {
    render(<BackgroundRunsChip runningCount={1} />);
    expect(screen.getByText("1 running")).toBeInTheDocument();
  });

  it("renders plural 'N running' for two or more running runs", () => {
    render(<BackgroundRunsChip runningCount={3} />);
    expect(screen.getByText("3 running")).toBeInTheDocument();
  });

  it("renders only attention state when runningCount is 0 but attentionCount > 0", () => {
    render(<BackgroundRunsChip runningCount={0} attentionCount={2} />);
    expect(screen.getByText("2 need attention")).toBeInTheDocument();
    expect(screen.queryByText(/running/)).not.toBeInTheDocument();
  });

  it("renders both running and attention when both > 0", () => {
    render(<BackgroundRunsChip runningCount={2} attentionCount={1} />);
    expect(screen.getByText("2 running")).toBeInTheDocument();
    expect(screen.getByText("1 needs attention")).toBeInTheDocument();
  });

  it("exposes an aria-label that names both counts for screen readers", () => {
    render(<BackgroundRunsChip runningCount={2} attentionCount={1} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute(
      "aria-label",
      expect.stringContaining("2 running"),
    );
    expect(btn.getAttribute("aria-label") ?? "").toMatch(/1 needs attention/);
  });

  it("calls onClick when the chip is clicked", () => {
    const onClick = vi.fn();
    render(<BackgroundRunsChip runningCount={1} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has a visible pulse dot while running, but no animation class for attention-only state", () => {
    const { container, rerender } = render(<BackgroundRunsChip runningCount={1} />);
    // The running state includes an animate-ping span (purely cosmetic; animation honored by motion-reduce)
    expect(container.querySelector("span.animate-ping")).not.toBeNull();

    rerender(<BackgroundRunsChip runningCount={0} attentionCount={1} />);
    expect(container.querySelector("span.animate-ping")).toBeNull();
  });

  it("hides the animation from reduced-motion users via motion-reduce:hidden", () => {
    const { container } = render(<BackgroundRunsChip runningCount={1} />);
    const pulse = container.querySelector("span.animate-ping");
    expect(pulse?.className ?? "").toContain("motion-reduce:hidden");
  });

  it("announces state changes to screen readers via aria-live polite (silent when unchanged)", () => {
    render(<BackgroundRunsChip runningCount={1} />);
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });
});
