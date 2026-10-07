import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { modelForTier } from "@convex/domains/redesign/chatRuns";
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

  // The preflight names a provider and model before a paid submit, but DEFAULT_TIERS
  // is a hand-maintained mirror of the runtime's modelForTier. Drift between them
  // makes the disclosure advertise a model the runtime never runs — and never prices.
  it("discloses the exact model the chat runtime resolves for every offered tier", () => {
    expect(DEFAULT_TIERS.length).toBeGreaterThan(0);

    for (const tier of DEFAULT_TIERS) {
      expect({ id: tier.id, model: tier.model }).toEqual({
        id: tier.id,
        model: modelForTier(tier.id),
      });
    }
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

    // The parent flips streaming after accepting the first click. The submit
    // button STAYS at the same coordinates — disabled, so the second click of
    // a double-click is structurally a no-op at any double-click interval.
    // Stop lives in its own reserved slot and is also arm-delayed.
    rerender(<UniversalComposer {...props} streaming />);
    const submit = screen.getByRole("button", { name: "Run research" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();

    const stop = screen.getByRole("button", { name: "Cancel active run" });
    expect(stop).toBeDisabled();
    fireEvent.click(stop);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(CANCEL_ARM_DELAY_MS));
    expect(stop).toBeEnabled();
    // Even armed, the submit slot stays inert — the double-click landing zone
    // never becomes a cancel control (issue #568's structural requirement).
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();

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
      "Paid · google-gemini · gemini-3.5-flash",
    );

    fireEvent.click(screen.getByRole("button", { name: /Auto/ }));
    expect(screen.getByRole("option", { name: /Quick answer/ })).toHaveTextContent(
      "google-gemini / gemini-3.5-flash",
    );
    fireEvent.click(screen.getByRole("option", { name: /Deep dive/ }));
    expect(screen.getByRole("status", { name: "Paid runtime preflight" })).toHaveTextContent(
      "Paid · google-gemini · gemini-3.1-pro-preview",
    );
  });
});
