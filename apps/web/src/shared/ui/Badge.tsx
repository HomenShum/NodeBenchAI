import React from "react";

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type BadgeTone = "default" | "success" | "warning" | "info" | "error" | "brand" | "neutral" | "premium";

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    default:
      "border-edge bg-surface text-content-secondary",
    success: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    error: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
    brand: "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] dark:text-[var(--accent-primary)]",
    neutral: "border-gray-300/40 dark:border-white/10 bg-surface-secondary text-content-secondary",
    premium: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400",
  };
  return (
    <span
      className={joinClasses(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        tones[tone] ?? tones.default,
        className
      )}
    >
      {children}
    </span>
  );
}


