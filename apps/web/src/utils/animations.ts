/**
 * Animation utilities and presets for consistent micro-interactions
 * Uses Framer Motion variants and spring configurations
 *
 * NOTE: All variant objects are module-level constants, so they cannot use React hooks.
 * Components consuming these variants should use `useMotionConfig()` from `@/lib/motion`
 * to conditionally apply them (e.g., `variants={instant ? undefined : fadeVariants}`).
 * The static `prefersReducedMotion()` helper is available for non-component contexts.
 */

import type { Variants, Transition } from 'framer-motion';
import { prefersReducedMotion } from '@/lib/motion';

// Spring configurations for different interaction types
export const springs = {
  // Snappy for buttons and quick interactions
  snappy: { type: 'spring', stiffness: 400, damping: 30 } as Transition,
  // Bouncy for playful elements
  bouncy: { type: 'spring', stiffness: 300, damping: 20 } as Transition,
  // Smooth for panels and modals
  smooth: { type: 'spring', stiffness: 200, damping: 25 } as Transition,
  // Gentle for subtle animations
  gentle: { type: 'spring', stiffness: 100, damping: 20 } as Transition,
};

// Fade variants
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// Scale fade variants (for modals, cards)
export const scaleFadeVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: springs.smooth },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } },
};

// Slide up variants (for toasts, notifications)
export const slideUpVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: springs.snappy },
  exit: { opacity: 0, y: -10, transition: { duration: 0.15 } },
};

// Slide down variants (for dropdowns)
export const slideDownVariants: Variants = {
  hidden: { opacity: 0, y: -10, height: 0 },
  visible: { opacity: 1, y: 0, height: 'auto', transition: springs.snappy },
  exit: { opacity: 0, y: -10, height: 0, transition: { duration: 0.15 } },
};

// Slide in from right (for panels, sidebars)
export const slideRightVariants: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: springs.smooth },
  exit: { opacity: 0, x: 20, transition: { duration: 0.2 } },
};

// Slide in from left
export const slideLeftVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: springs.smooth },
  exit: { opacity: 0, x: -20, transition: { duration: 0.2 } },
};

// Stagger children variants
export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: springs.snappy },
};

// Button press variants
export const buttonPressVariants: Variants = {
  idle: { scale: 1 },
  hover: { scale: 1.02 },
  tap: { scale: 0.98 },
};

// Card hover variants
export const cardHoverVariants: Variants = {
  idle: { scale: 1, y: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  hover: { scale: 1.02, y: -2, boxShadow: '0 10px 30px rgba(0,0,0,0.15)' },
};

// Pulse animation for loading states
export const pulseVariants: Variants = {
  pulse: {
    scale: [1, 1.05, 1],
    opacity: [1, 0.8, 1],
    transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' },
  },
};

// Skeleton loading animation
export const skeletonVariants: Variants = {
  loading: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: { duration: 1.5, repeat: Infinity, ease: 'linear' },
  },
};

// Success checkmark animation
export const checkmarkVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: { duration: 0.4, ease: 'easeOut' },
  },
};

// Shake animation for errors
export const shakeVariants: Variants = {
  shake: {
    x: [0, -10, 10, -10, 10, 0],
    transition: { duration: 0.5 },
  },
};

// Rotate animation for loading spinners
export const spinVariants: Variants = {
  spin: {
    rotate: 360,
    transition: { duration: 1, repeat: Infinity, ease: 'linear' },
  },
};

// Expand/collapse variants
export const expandVariants: Variants = {
  collapsed: { height: 0, opacity: 0, overflow: 'hidden' },
  expanded: {
    height: 'auto',
    opacity: 1,
    overflow: 'visible',
    transition: springs.smooth,
  },
};

// Tooltip variants
export const tooltipVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 5 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.15 } },
};

// Page transition variants
export const pageTransitionVariants: Variants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0, transition: springs.smooth },
  exit: { opacity: 0, x: -20, transition: { duration: 0.2 } },
};

// Utility function to create stagger delay
export function staggerDelay(index: number, baseDelay = 0.05): number {
  if (prefersReducedMotion()) return 0;
  return index * baseDelay;
}

// Utility to create custom spring
export function createSpring(stiffness: number, damping: number): Transition {
  if (prefersReducedMotion()) return { duration: 0 };
  return { type: 'spring', stiffness, damping };
}

/** Re-export for convenience */
export { prefersReducedMotion } from '@/lib/motion';

// ═══════════════════════════════════════════════════════════════════
// HUD / Jarvis-style animation variants
// ═══════════════════════════════════════════════════════════════════

/** Clip-path reveal from center outward — for HUD panels */
export const hudRevealVariants: Variants = {
  hidden: {
    clipPath: 'inset(50% 50% 50% 50%)',
    opacity: 0,
  },
  visible: {
    clipPath: 'inset(0% 0% 0% 0%)',
    opacity: 1,
    transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] },
  },
  exit: {
    clipPath: 'inset(50% 50% 50% 50%)',
    opacity: 0,
    transition: { duration: 0.25 },
  },
};

/** Data stream / number ticker — for live data displays */
export const dataStreamVariants: Variants = {
  hidden: { opacity: 0, y: 8, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.3, ease: 'easeOut' },
  },
  update: {
    opacity: [1, 0.6, 1],
    scale: [1, 1.02, 1],
    transition: { duration: 0.2 },
  },
};

/** Hologram flicker — subtle opacity flicker on mount for holographic feel */
export const hologramFlickerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: [0, 0.8, 0.4, 1, 0.9, 1],
    transition: { duration: 0.5, times: [0, 0.1, 0.2, 0.4, 0.6, 1] },
  },
};

/** HUD border glow pulse — for active/selected elements */
export const hudGlowPulseVariants: Variants = {
  idle: {
    boxShadow: '0 0 0px rgba(99, 102, 241, 0)',
  },
  active: {
    boxShadow: [
      '0 0 8px rgba(99, 102, 241, 0.3)',
      '0 0 20px rgba(99, 102, 241, 0.15)',
      '0 0 8px rgba(99, 102, 241, 0.3)',
    ],
    transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
  },
};

/** HUD slide-in with blur — cinematic panel entrance */
export const hudSlideInVariants: Variants = {
  hidden: {
    opacity: 0,
    x: 40,
    filter: 'blur(8px)',
  },
  visible: {
    opacity: 1,
    x: 0,
    filter: 'blur(0px)',
    transition: springs.smooth,
  },
  exit: {
    opacity: 0,
    x: -20,
    filter: 'blur(4px)',
    transition: { duration: 0.2 },
  },
};


