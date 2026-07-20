/**
 * AnimatedNumber — Animated counter with viewport-entry trigger.
 * Uses requestAnimationFrame for smooth counting with expo ease-out.
 * Respects reduced-motion preference.
 */

import { useEffect, useRef, useState } from "react";
import { useMotionConfig } from "@/lib/motion";

interface AnimatedNumberProps {
  value: number;
  className?: string;
  /** Optional prefix (e.g. "$") */
  prefix?: string;
  /** Optional suffix (e.g. "%", "k") */
  suffix?: string;
  /** Duration in ms (default 1200) */
  duration?: number;
}

export function AnimatedNumber({
  value,
  className = "",
  prefix = "",
  suffix = "",
  duration = 1200,
}: AnimatedNumberProps) {
  const { instant } = useMotionConfig();
  const ref = useRef<HTMLSpanElement>(null);
  const [displayed, setDisplayed] = useState(instant ? value : 0);
  const [visible, setVisible] = useState(false);

  // Viewport entry detection
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

  // Animate on visibility
  useEffect(() => {
    if (!visible) return;
    if (instant) {
      setDisplayed(value);
      return;
    }

    const start = performance.now();
    let frame: number;

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Expo ease-out: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(value * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, visible, instant, duration]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}{displayed.toLocaleString()}{suffix}
    </span>
  );
}

export default AnimatedNumber;
