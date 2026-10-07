import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeepDiveAccordion } from "./DeepDiveAccordion";

describe("DeepDiveAccordion", () => {
  it("uses an accessible collapsed disclosure and reveals its content", () => {
    render(
      <DeepDiveAccordion
        title="Why this matters"
        content="The underlying sources disagree on timing."
      />,
    );

    const trigger = screen.getByRole("button", { name: "Why this matters" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("The underlying sources disagree on timing."),
    ).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("The underlying sources disagree on timing."),
    ).toBeInTheDocument();
  });
});
