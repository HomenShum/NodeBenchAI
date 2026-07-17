import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlannerModeToggle } from "./PlannerModeToggle";

describe("PlannerModeToggle", () => {
  it("exposes the selected view as a Radix tab and preserves selection callbacks", () => {
    const onChange = vi.fn();
    render(<PlannerModeToggle mode="list" onChange={onChange} />);

    expect(screen.getByRole("tab", { name: "Tasks View" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Kanban" }), {
      button: 0,
    });

    expect(onChange).toHaveBeenCalledWith("kanban");
  });
});
