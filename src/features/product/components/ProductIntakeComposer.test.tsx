import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/chat/hooks/useRollbackInterceptor", () => ({
  useRollbackInterceptor: () => ({
    pending: false,
    tryIntercept: vi.fn(async () => false),
    detect: vi.fn(() => null),
  }),
}));

import { ProductIntakeComposer } from "./ProductIntakeComposer";

describe("ProductIntakeComposer", () => {
  const baseProps = {
    value: "Tell me about Stripe",
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onFilesSelected: vi.fn(),
    files: [],
    lens: "founder" as const,
    onLensChange: vi.fn(),
  };

  it("renders the provided context hint text instead of a hard-coded helper", () => {
    render(
      <ProductIntakeComposer
        {...baseProps}
        operatorContextLabel="founder | concise"
        operatorContextHint="Anchored on your saved founder context."
      />,
    );

    expect(screen.getByText("Anchored on your saved founder context.")).toBeInTheDocument();
    expect(screen.queryByText(/Saved context from `Me`/)).not.toBeInTheDocument();
  });

  it("can hide the context chip and hint when the parent surface already renders them", () => {
    render(
      <ProductIntakeComposer
        {...baseProps}
        operatorContextLabel="founder | concise"
        operatorContextHint="Anchored on your saved founder context."
        showOperatorContextChip={false}
        showOperatorContextHint={false}
      />,
    );

    expect(screen.queryByText("Using your context")).not.toBeInTheDocument();
    expect(screen.queryByText("Anchored on your saved founder context.")).not.toBeInTheDocument();
  });

  it("can hide the lens selector for compact drawer surfaces", () => {
    render(
      <ProductIntakeComposer
        {...baseProps}
        showLensSelector={false}
      />,
    );

    expect(screen.queryByRole("tablist", { name: "Lens" })).not.toBeInTheDocument();
  });

  it("submits on ctrl+enter", () => {
    const onSubmit = vi.fn();
    render(
      <ProductIntakeComposer
        {...baseProps}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Paste notes, links, or your ask"), {
      key: "Enter",
      ctrlKey: true,
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("can switch between ask, note, and task modes from the same composer", () => {
    const onModeChange = vi.fn();
    render(
      <ProductIntakeComposer
        {...baseProps}
        mode="ask"
        onModeChange={onModeChange}
        showCaptureModes
        onSaveCapture={vi.fn()}
      />,
    );

    expect(screen.getByRole("tablist", { name: "Composer mode" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Note" }));
    expect(onModeChange).toHaveBeenCalledWith("note");

    fireEvent.click(screen.getByRole("tab", { name: "Task" }));
    expect(onModeChange).toHaveBeenCalledWith("task");
  });

  it("renders a clear active state for the selected composer mode", () => {
    const { rerender } = render(
      <ProductIntakeComposer
        {...baseProps}
        mode="ask"
        onModeChange={vi.fn()}
        showCaptureModes
        onSaveCapture={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Note" })).toHaveAttribute("data-state", "inactive");

    rerender(
      <ProductIntakeComposer
        {...baseProps}
        mode="note"
        onModeChange={vi.fn()}
        showCaptureModes
        onSaveCapture={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute("data-state", "inactive");
    expect(screen.getByRole("tab", { name: "Note" })).toHaveAttribute("data-state", "active");
  });

  it("reframes the composer for quick note capture without showing run controls", () => {
    render(
      <ProductIntakeComposer
        {...baseProps}
        value="Remember this"
        mode="note"
        onModeChange={vi.fn()}
        showCaptureModes
        onSaveCapture={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Write your note")).toHaveAttribute("placeholder", "Capture a thought worth keeping...");
    expect(screen.getByRole("button", { name: "Save note" })).toHaveAttribute("data-nb-composer-primary-action", "save_note");
    expect(screen.queryByRole("tablist", { name: "Lens" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Attach files/i })).not.toBeInTheDocument();
  });

  it("shows the Manus-style utility pill in compact chat mode", () => {
    render(
      <ProductIntakeComposer
        {...baseProps}
        variant="chat"
        compact
      />,
    );

    expect(screen.getByLabelText("Composer utility M+1")).toBeInTheDocument();
  });
});
