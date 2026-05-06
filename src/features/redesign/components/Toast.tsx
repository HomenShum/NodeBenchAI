/**
 * Toast — minimalist transient notification system.
 *
 * Use:  showToast({ tone: "success", message: "Saved to report" });
 * Or:   showToast({ tone: "info", message: "Brief refresh started", action: { label: "Open", onClick: ... } });
 *
 * Mounts <ToastViewport /> once at the redesign layout level. Listens to a global event so
 * any component can trigger toasts without prop drilling.
 */

import { useEffect, useState } from "react";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastEvent {
  id: string;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

const TOAST_EVENT = "rd:toast:show";

export function showToast(input: Omit<ToastEvent, "id">): void {
  const detail: ToastEvent = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    durationMs: 3500,
    ...input,
  };
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const ce = e as CustomEvent<ToastEvent>;
      setToasts((prev) => [...prev, ce.detail].slice(-4));
      const id = ce.detail.id;
      const dur = ce.detail.durationMs ?? 3500;
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, dur);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="rd-toast-viewport" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`rd-toast rd-toast--${t.tone}`} role="status">
          <span className="rd-toast__glyph" aria-hidden="true">
            {t.tone === "success" ? "✓" : t.tone === "warning" || t.tone === "error" ? "⚠" : "·"}
          </span>
          <span className="rd-toast__message">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="rd-toast__action"
              onClick={() => { t.action?.onClick(); setToasts((prev) => prev.filter((x) => x.id !== t.id)); }}
            >{t.action.label}</button>
          )}
          <button
            type="button"
            className="rd-toast__close"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            aria-label="Dismiss"
          >×</button>
        </div>
      ))}
    </div>
  );
}
