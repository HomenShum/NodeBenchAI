/**
 * useToast — minimal glass-card toast system.
 * Renders toasts via DOM injection (no provider needed).
 * Auto-dismiss 3s, right-side entrance animation.
 */

import { useCallback } from "react";

let containerEl: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (containerEl && document.body.contains(containerEl)) return containerEl;
  containerEl = document.createElement("div");
  containerEl.id = "nb-toast-container";
  containerEl.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
  document.body.appendChild(containerEl);
  return containerEl;
}

function showToast(message: string, variant: "info" | "success" | "error" | "warning" = "info") {
  const container = ensureContainer();
  const toast = document.createElement("div");

  const bgMap = {
    info: "rgba(255,255,255,0.04)",
    success: "rgba(16,185,129,0.08)",
    error: "rgba(244,63,94,0.08)",
    warning: "rgba(245,158,11,0.08)",
  };
  const borderMap = {
    info: "rgba(255,255,255,0.08)",
    success: "rgba(16,185,129,0.2)",
    error: "rgba(244,63,94,0.2)",
    warning: "rgba(245,158,11,0.2)",
  };
  const textMap = {
    info: "rgba(255,255,255,0.85)",
    success: "rgb(52,211,153)",
    error: "rgb(251,113,133)",
    warning: "rgb(251,191,36)",
  };

  toast.style.cssText = `
    background:${bgMap[variant]};
    border:1px solid ${borderMap[variant]};
    backdrop-filter:blur(12px);
    color:${textMap[variant]};
    font-size:13px;
    font-family:Manrope,system-ui,sans-serif;
    padding:10px 16px;
    border-radius:12px;
    pointer-events:auto;
    transform:translateX(120%);
    opacity:0;
    transition:transform 0.3s cubic-bezier(0.16,1,0.3,1),opacity 0.3s ease;
    max-width:340px;
    box-shadow:0 4px 24px rgba(0,0,0,0.3);
  `.replace(/\n\s*/g, "");

  toast.textContent = message;
  container.appendChild(toast);

  // Trigger entrance
  requestAnimationFrame(() => {
    toast.style.transform = "translateX(0)";
    toast.style.opacity = "1";
  });

  // Auto-dismiss after 3s
  setTimeout(() => {
    toast.style.transform = "translateX(120%)";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

export function useToast() {
  const toast = useCallback((message: string, variant?: "info" | "success" | "error" | "warning") => {
    showToast(message, variant);
  }, []);

  return { toast };
}

export { showToast };
