import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NotebookDiligenceOverlayHost } from "./NotebookDiligenceOverlayHost";

describe("NotebookDiligenceOverlayHost", () => {
  it("renders diligence decorations at the notebook surface and wires actions", async () => {
    const onAcceptDecoration = vi.fn();
    const onDismissDecoration = vi.fn();
    const onRefreshDecoration = vi.fn();

    render(
      <NotebookDiligenceOverlayHost
        decorations={[
          {
            blockType: "projection",
            overallTier: "single-source",
            headerText: "Why it matters",
            bodyProse: "Projected from the latest report.",
            scratchpadRunId: "projection:entity:1:why-it-matters",
            version: 1,
            updatedAt: Date.now(),
            sourceTokens: ["[s1]"],
            sourceCount: 1,
          },
        ]}
        onAcceptDecoration={onAcceptDecoration}
        onDismissDecoration={onDismissDecoration}
        onRefreshDecoration={onRefreshDecoration}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("notebook-diligence-overlay-host")).toBeInTheDocument(),
    );

    expect(screen.getByText("Why it matters")).toBeInTheDocument();
    expect(screen.getByText("[s1]")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onAcceptDecoration).toHaveBeenCalledWith(
      "projection:entity:1:why-it-matters",
      "projection",
    );
    expect(onRefreshDecoration).toHaveBeenCalledWith(
      "projection:entity:1:why-it-matters",
      "projection",
    );
    expect(onDismissDecoration).toHaveBeenCalledWith(
      "projection:entity:1:why-it-matters",
      "projection",
    );
  });

  it("renders nothing when there are no decorations", () => {
    const { container } = render(<NotebookDiligenceOverlayHost decorations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

