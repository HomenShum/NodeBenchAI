import { describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

import { useToast } from "./Toast";
import { showToast } from "@/features/redesign/components/Toast";

describe("canonical toast adapters", () => {
  it("routes the shared hook through Sonner while preserving title and detail", () => {
    useToast().error("Notebook command failed", "Try again after reconnecting.");

    expect(toastMocks.error).toHaveBeenCalledWith("Notebook command failed", {
      description: "Try again after reconnecting.",
      duration: 6000,
    });
  });

  it("preserves the redesign action and duration contract", () => {
    const onClick = vi.fn();

    showToast({
      tone: "success",
      message: "Saved",
      durationMs: 1200,
      action: { label: "Open", onClick },
    });

    expect(toastMocks.success).toHaveBeenCalledWith("Saved", {
      duration: 1200,
      action: { label: "Open", onClick },
    });
  });
});
