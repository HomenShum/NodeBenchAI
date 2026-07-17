import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgendaMiniRow } from "./AgendaMiniRow";

describe("AgendaMiniRow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves row keyboard selection and keeps checkbox changes isolated", () => {
    const onSelect = vi.fn();
    const onToggleComplete = vi.fn();

    const { container } = render(
      <AgendaMiniRow
        item={{ _id: "task-1", title: "Review brief", status: "todo" }}
        kind="task"
        onSelect={onSelect}
        showCheckbox
        onToggleComplete={onToggleComplete}
      />,
    );

    const row = container.querySelector<HTMLElement>("[data-agenda-mini-row]");
    expect(row).not.toBeNull();

    fireEvent.keyDown(row!, { key: "Enter" });
    fireEvent.keyDown(row!, { key: " " });
    expect(onSelect).toHaveBeenNthCalledWith(1, "task-1");
    expect(onSelect).toHaveBeenNthCalledWith(2, "task-1");

    onSelect.mockClear();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mark task as done" }),
    );
    expect(onToggleComplete).toHaveBeenCalledWith("task-1", true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the Radix hover card from pointer and focus while preserving proposed actions", () => {
    vi.useFakeTimers();
    const onAcceptProposed = vi.fn();
    const onDeclineProposed = vi.fn();

    const { container } = render(
      <AgendaMiniRow
        item={{
          _id: "event-1",
          title: "Candidate interview",
          status: "tentative",
          proposed: true,
          description: "Interview proposed from the candidate email.",
        }}
        kind="event"
        onSelect={vi.fn()}
        onAcceptProposed={onAcceptProposed}
        onDeclineProposed={onDeclineProposed}
      />,
    );

    const row = container.querySelector<HTMLElement>("[data-agenda-mini-row]");
    expect(row).not.toBeNull();

    fireEvent.pointerEnter(row!, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(100));

    expect(
      screen.getByText("Interview proposed from the candidate email."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onAcceptProposed).toHaveBeenCalledWith("event-1");
    expect(onDeclineProposed).toHaveBeenCalledWith("event-1");

    fireEvent.pointerLeave(row!, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(130));
    fireEvent.focus(row!);
    act(() => vi.advanceTimersByTime(100));
    expect(
      screen.getByText("Interview proposed from the candidate email."),
    ).toBeVisible();
  });
});
