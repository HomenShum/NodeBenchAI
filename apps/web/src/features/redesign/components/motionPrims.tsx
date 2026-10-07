/**
 * motionPrims — the redesign surface's sole motion.dev import boundary.
 *
 * Rules encoded here (mirrors the noderoom motion pass):
 *   - transform/opacity only; never layout properties
 *   - every entrance is one-shot (mount or first scroll into view); nothing loops
 *   - MotionRoot honors the OS reduced-motion preference for everything below it
 */

import { MotionConfig, motion } from "motion/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** Wrap once near the app root; all descendants respect prefers-reduced-motion. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Expo-out: fast arrival, long settle. */
const EXPO_OUT = [0.16, 1, 0.3, 1] as const;

type RiseProps = ComponentPropsWithoutRef<typeof motion.div> & {
  /** Stagger offset in ms (hero rhythm: 0 / 60 / 140 / 220 / 300). */
  delay?: number;
  /** false = animate on mount (above the fold); true = on first scroll into view. */
  inView?: boolean;
};

/** Fade + rise entrance. One-shot. */
export function Rise({ delay = 0, inView = false, ...props }: RiseProps) {
  const visible = { opacity: 1, y: 0 };
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      {...(inView
        ? { whileInView: visible, viewport: { once: true, amount: 0.3 } }
        : { animate: visible })}
      transition={{ duration: 0.5, ease: EXPO_OUT, delay: delay / 1000 }}
      {...props}
    />
  );
}

/** Primary-action button: spring scale 1.03 on hover, 0.96 on press. */
export function PressButton(props: ComponentPropsWithoutRef<typeof motion.button>) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      {...props}
    />
  );
}
