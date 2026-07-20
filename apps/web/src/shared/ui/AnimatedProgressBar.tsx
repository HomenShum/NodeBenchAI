/**
 * AnimatedProgressBar — Viewport-triggered width animation.
 *
 * Animates from 0% to target width on viewport entry.
 * Uses CSS transitions for GPU-composited performance.
 */

import React from "react";
import { useRevealOnMount } from "@/hooks/useRevealOnMount";
import { cn } from "@/lib/utils";

interface AnimatedProgressBarProps {
  /** Progress value 0-100 */
  value: number;
  /** Bar color class (default: bg-[var(--accent-primary)]) */
  colorClass?: string;
  /** Height class (default: h-2) */
  heightClass?: string;
  className?: string;
  /** Optional label shown at the end */
  label?: string;
}

export function AnimatedProgressBar({
  value,
  colorClass = "bg-[var(--accent-primary)]",
  heightClass = "h-2",
  className,
  label,
}: AnimatedProgressBarProps) {
  const { ref, isVisible, instant } = useRevealOnMount();
  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div ref={ref} className={cn("flex items-center gap-2", className)}>
      <div className={cn("flex-1 rounded-full bg-surface-secondary overflow-hidden", heightClass)}>
        <div
          className={cn(
            "h-full rounded-full",
            !instant && "transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]",
            colorClass,
          )}
          style={{ width: isVisible ? `${clampedValue}%` : "0%" }}
        />
      </div>
      {label && <span className="text-xs text-content-muted tabular-nums">{label}</span>}
    </div>
  );
}
