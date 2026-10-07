import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useRevealOnMount", () => ({
  useRevealOnMount: () => ({
    ref: { current: null },
    isVisible: true,
    instant: true,
  }),
}));

import PricingPage from "./PricingPage";

describe("PricingPage", () => {
  it("renders the current four-tier founder pricing layout", () => {
    render(<PricingPage />);

    expect(screen.getByRole("heading", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Enterprise" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compare plans" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Frequently asked questions" })).toBeInTheDocument();
    expect(
      screen.getByText(/Start with clarity\. Unlock the next stage only when the founder workflow is ready for it\./i),
    ).toBeInTheDocument();
  });

  it("shows the current founder FAQ content", () => {
    render(<PricingPage />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /What can I do for free\?/i,
      }),
    );

    expect(
      screen.getByText(/5 searches per day, 6 role lenses, gap remediation included/i),
    ).toBeInTheDocument();
  });
});
