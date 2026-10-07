import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastInput {
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

const notify = ({ type, title, message, duration }: ToastInput) => {
  sonnerToast[type](title, {
    description: message,
    duration,
  });
};

const toastApi = {
  addToast: (input: ToastInput) => notify(input),
  removeToast: (id: string | number) => sonnerToast.dismiss(id),
  success: (title: string, message?: string) =>
    notify({ type: "success", title, message }),
  error: (title: string, message?: string) =>
    notify({ type: "error", title, message, duration: 6000 }),
  warning: (title: string, message?: string) =>
    notify({ type: "warning", title, message }),
  info: (title: string, message?: string) =>
    notify({ type: "info", title, message }),
};

/** Compatibility provider; the application-level Sonner toaster owns rendering. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Compatibility hook for legacy call sites, backed by the canonical Sonner queue. */
export function useToast() {
  return toastApi;
}

export default ToastProvider;
