import { toast } from "sonner";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastEvent {
  id: string;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

/** Preserve the redesign call API while using the app's canonical Sonner queue. */
export function showToast(input: Omit<ToastEvent, "id">): void {
  toast[input.tone](input.message, {
    duration: input.durationMs ?? 3500,
    action: input.action,
  });
}
