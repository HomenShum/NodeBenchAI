import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANCEL_ARM_DELAY_MS,
  DEFAULT_TIERS,
  UniversalComposer,
} from "./UniversalComposer";

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    error: null,
    isListening: false,
    isSupported: false,
    isTranscribing: false,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

describe("UniversalComposer runtime controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not let the second click of submit immediately cancel the new run", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    const props = {
      contextLabel: "Market review",
      onStop,
      onSubmit,
    };
    const { rerender } = render(<UniversalComposer {...props} streaming={false} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Review the market" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run research" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // The parent flips streaming after accepting the first click. The control at
    // the same coordinates is now Stop, but it stays inert through dblclick #2.
    rerender(<UniversalComposer {...props} streaming />);
    const stop = screen.getByRole("button", { name: "Cancel active run" });
    expect(stop).toBeDisabled();
    fireEvent.click(stop);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(CANCEL_ARM_DELAY_MS));
    expect(stop).toBeEnabled();

    // Escape remains usable even when focus is no longer in the textarea.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("shows the exact paid provider and model before submission", () => {
    render(
      <UniversalComposer
        contextLabel="Market review"
        onSubmit={vi.fn()}
      />,
    );

    expect(DEFAULT_TIERS.find((tier) => tier.id === "auto")).toMatchObject({
      model: "gemini-3.5-flash",
      provider: "google-gemini",
    });
    expect(DEFAULT_TIERS.find((tier) => tier.id === "answer")).toMatchObject({
      model: "gemini-3.5-flash",
      provider: "google-gemini",
    });
    expect(screen.getByRole("status", { name: "Paid runtime preflight" })).toHaveTextContent(
      "Paid live run · provider google-gemini · model gemini-3.5-flash",
    );

    fireEvent.click(screen.getByRole("button", { name: /Auto/ }));
    expect(screen.getByRole("option", { name: /Quick answer/ })).toHaveTextContent(
      "google-gemini / gemini-3.5-flash",
    );
    fireEvent.click(screen.getByRole("option", { name: /Deep dive/ }));
    expect(screen.getByRole("status", { name: "Paid runtime preflight" })).toHaveTextContent(
      "Paid live run · provider google-gemini · model gemini-3.1-pro-preview",
    );
  });
});
