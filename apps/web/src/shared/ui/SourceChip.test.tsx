import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceChip } from "./SourceChip";

describe("SourceChip", () => {
  it("renders a linked chip with a badge", () => {
    render(<SourceChip label="techcrunch.com" href="https://techcrunch.com" badge={2} />);

    const link = screen.getByRole("link", { name: /techcrunch\.com/i });
    expect(link).toHaveAttribute("href", "https://techcrunch.com");
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders a non-linked chip when no href is provided", () => {
    render(<SourceChip label="internal memo" />);
    expect(screen.getByText("internal memo")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
