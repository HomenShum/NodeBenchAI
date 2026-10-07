/**
 * ProgressBar — Animated width-fill bar with viewport-entry trigger.
 * Uses CSS transition for GPU-composited animation.
 * Botanical gold gradient in dark-botanical preset, accent-primary otherwise.
 */

import { useEffect, useRef, useState } from "react";
import { useMotionConfig } from "@/lib/motion";

interface ProgressBarProps {
  /** 0–100 percentage */
  value: number;
  className?: string;
  /** Height in px (default 6) */
  height?: number;
  /** Optional label shown to the right */
  label?: string;
  /** Variant: "default" uses accent, "botanical" uses warm gradient */
  variant?: "default" | "botanical";
}

export function ProgressBar({
  value,
  className = "",
  height = 6,
  label,
  variant = "default",
}: ProgressBarProps) {
  const { instant } = useMotionConfig();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (instant) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [instant]);

  const clamped = Math.max(0, Math.min(100, value));

  const fillStyle = variant === "botanical"
    ? "background: linear-gradient(90deg, #d4a574, #e8b4b8)"
    : "background: var(--accent-primary)";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        ref={ref}
        className="flex-1 rounded-full overflow-hidden"
        style={{
          height,
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
        }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: visible ? `${clamped}%` : "0%",
            transition: instant ? "none" : `width 1s var(--ease-out-expo)`,
            ...(variant === "botanical"
              ? { background: "linear-gradient(90deg, #d4a574, #e8b4b8)" }
              : { background: "var(--accent-primary)" }),
          }}
        />
      </div>
      {label && (
        <span className="text-xs font-medium tabular-nums text-content-secondary whitespace-nowrap">
          {label}
        </span>
      )}
    </div>
  );
}

export default ProgressBar;
