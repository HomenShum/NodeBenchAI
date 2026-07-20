import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotebookScratchpadTracePanel } from "./NotebookScratchpadTracePanel";

describe("NotebookScratchpadTracePanel", () => {
  it("renders checkpoint trace entries and the scratchpad viewer together", () => {
    render(
      <NotebookScratchpadTracePanel
        markdownSource="# Scratchpad\n\nWorking through funding first."
        runLabel="Loop overlay run"
        version={3}
        updatedAt={Date.now()}
        checkpoints={[
          {
            checkpointId: "cp-1",
            checkpointNumber: 1,
            currentStep: "checkpoint:funding",
            status: "active",
            progress: 25,
            createdAt: Date.now() - 1_000,
          },
        ]}
      />,
    );

    expect(screen.getByText(/checkpoint trace/i)).toBeInTheDocument();
    expect(screen.getByText(/#1 checkpoint:funding/i)).toBeInTheDocument();
    expect(screen.getByText(/scratchpad/i)).toBeInTheDocument();
  });

  it("shows an honest empty trace state when no checkpoints exist", () => {
    render(<NotebookScratchpadTracePanel markdownSource={null} checkpoints={[]} />);
    expect(screen.getByText(/no checkpoints yet for this entity/i)).toBeInTheDocument();
  });
});
