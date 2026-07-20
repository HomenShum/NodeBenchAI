/**
 * motion.ts — Reduced-motion-safe animation utilities.
 *
 * Instead of importing `motion` from framer-motion directly,
 * components can use `useMotionConfig()` to get transition overrides
 * that respect the user's reduced-motion preference.
 *
 * Pattern A (simplest — override transition):
 *   const { transition } = useMotionConfig();
 *   <motion.div animate={{ opacity: 1 }} transition={transition(0.3)} />
 *
 * Pattern B (conditional variants):
 *   const { instant } = useMotionConfig();
 *   <motion.div variants={instant ? instantVariants : defaultVariants} />
 *
 * Pattern C (skip animation entirely):
 *   const { shouldAnimate } = useMotionConfig();
 *   if (!shouldAnimate) return <div>{children}</div>;
 *   return <motion.div animate={...}>{children}</motion.div>;
 */

import { useReducedMotion } from "../hooks/useReducedMotion";
import type { Transition } from "framer-motion";

interface MotionConfig {
  /** True when animations should play; false when reduced-motion is active */
  shouldAnimate: boolean;
  /** True when motion should be instant (reduced-motion active) */
  instant: boolean;
  /**
   * Wraps a transition — returns instant (duration: 0) when reduced-motion is active,
   * or the specified duration/config when animations are allowed.
   */
  transition: (durationOrConfig?: number | Transition) => Transition;
  /** Returns 0 when reduced-motion, otherwise the given duration in seconds */
  duration: (seconds: number) => number;
}

export function useMotionConfig(): MotionConfig {
  const reduced = useReducedMotion();

  return {
    shouldAnimate: !reduced,
    instant: reduced,
    transition: (durationOrConfig?: number | Transition): Transition => {
      if (reduced) return { duration: 0 };
      if (typeof durationOrConfig === "number") return { duration: durationOrConfig };
      return durationOrConfig ?? {};
    },
    duration: (seconds: number) => (reduced ? 0 : seconds),
  };
}

/**
 * Static (non-hook) check for reduced motion.
 * Use in non-component contexts (e.g., animation variant objects defined outside components).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
