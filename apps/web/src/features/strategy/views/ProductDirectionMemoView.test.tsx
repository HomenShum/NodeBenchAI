import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProductDirectionMemoView } from "./ProductDirectionMemoView";

describe("ProductDirectionMemoView", () => {
  it("renders the executive answer and can switch to JSON contract", () => {
    render(<ProductDirectionMemoView />);

    expect(screen.getByText(/what should they build next/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommended direction/i)).toBeInTheDocument();
    expect(screen.getByText(/Best-fit product name/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /json contract/i }));

    expect(screen.getByText(/Typed Output/i)).toBeInTheDocument();
    expect(screen.getByText(/Schema Contract/i)).toBeInTheDocument();
  });
});
