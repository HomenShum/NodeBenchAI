/**
 * useRevealOnMount — Viewport-triggered reveal hook.
 *
 * Wraps framer-motion's `useInView` with reduced-motion safety.
 * Returns `{ ref, isVisible, instant }` so components can apply
 * entrance animations as a one-liner:
 *
 *   const { ref, isVisible } = useRevealOnMount();
 *   <motion.div ref={ref} animate={{ opacity: isVisible ? 1 : 0 }}>
 */

import { useRef, useState, useEffect } from "react";
import { useInView } from "framer-motion";
import { useMotionConfig } from "@/lib/motion";

interface RevealOptions {
  /** Only trigger once (default: true) */
  once?: boolean;
  /** Fraction of element visible to trigger (default: 0.15) */
  amount?: number;
  /** Margin around root (default: undefined) */
  margin?: string;
  /** Fallback timeout ms — force visible if IntersectionObserver hasn't fired (default: 800) */
  fallbackMs?: number;
}

export function useRevealOnMount(options?: RevealOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const { instant } = useMotionConfig();
  const inView = useInView(ref, {
    once: options?.once ?? true,
    amount: options?.amount ?? 0.15,
    margin: options?.margin,
  });

  // Fallback: if IntersectionObserver hasn't fired (e.g. element was display:none
  // when mounted in ActiveSurfaceHost cache), force visible after timeout.
  const [fallbackVisible, setFallbackVisible] = useState(false);
  useEffect(() => {
    if (instant || inView) return;
    const timer = setTimeout(() => setFallbackVisible(true), options?.fallbackMs ?? 800);
    return () => clearTimeout(timer);
  }, [instant, inView, options?.fallbackMs]);

  return {
    ref,
    /** True when element is in viewport (or instantly if reduced-motion, or after fallback timeout) */
    isVisible: instant ? true : (inView || fallbackVisible),
    /** True when animations should be skipped */
    instant,
  };
}
