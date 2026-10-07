/**
 * Reusable animated components with consistent micro-interactions
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  fadeVariants,
  scaleFadeVariants,
  slideUpVariants,
  slideDownVariants,
  buttonPressVariants,
  cardHoverVariants,
  staggerContainerVariants,
  staggerItemVariants,
  expandVariants,
  springs,
} from '@/utils/animations';
import { useMotionConfig } from '@/lib/motion';

// Animated button with press effect
interface AnimatedButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function AnimatedButton({ children, variant = 'primary', className = '', ...props }: AnimatedButtonProps) {
  const { instant } = useMotionConfig();
  const baseStyles = 'px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';
  const variantStyles = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-ring',
    secondary: 'bg-surface-secondary text-content hover:bg-surface-secondary dark:hover:bg-white/[0.1] focus:ring-ring',
    ghost: 'bg-transparent text-content-secondary hover:bg-surface-hover focus:ring-edge',
  };

  return (
    <motion.button
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      variants={instant ? undefined : buttonPressVariants}
      initial="idle"
      whileHover={!instant ? "hover" : undefined}
      whileTap={!instant ? "tap" : undefined}
      {...props}
    >
      {children}
    </motion.button>
  );
}

// Animated card with hover lift effect
interface AnimatedCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function AnimatedCard({ children, className = '', onClick }: AnimatedCardProps) {
  const { instant } = useMotionConfig();
  const interactiveProps = onClick ? {
    role: 'button' as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
  } : {};

  return (
    <motion.div
      className={`bg-surface rounded-lg border border-edge p-4 ${onClick ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : ''} ${className}`}
      variants={instant ? undefined : cardHoverVariants}
      initial="idle"
      whileHover={!instant ? "hover" : undefined}
      onClick={onClick}
      {...interactiveProps}
    >
      {children}
    </motion.div>
  );
}

// Fade in/out wrapper
interface FadeProps {
  children: React.ReactNode;
  show?: boolean;
  className?: string;
}

export function Fade({ children, show = true, className = '' }: FadeProps) {
  const { instant } = useMotionConfig();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={className}
          variants={instant ? undefined : fadeVariants}
          initial={instant ? undefined : "hidden"}
          animate={instant ? undefined : "visible"}
          exit={instant ? undefined : "exit"}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Scale fade for modals
interface ScaleFadeProps {
  children: React.ReactNode;
  show?: boolean;
  className?: string;
}

export function ScaleFade({ children, show = true, className = '' }: ScaleFadeProps) {
  const { instant } = useMotionConfig();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={className}
          variants={instant ? undefined : scaleFadeVariants}
          initial={instant ? undefined : "hidden"}
          animate={instant ? undefined : "visible"}
          exit={instant ? undefined : "exit"}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Slide up for toasts/notifications
interface SlideUpProps {
  children: React.ReactNode;
  show?: boolean;
  className?: string;
}

export function SlideUp({ children, show = true, className = '' }: SlideUpProps) {
  const { instant } = useMotionConfig();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={className}
          variants={instant ? undefined : slideUpVariants}
          initial={instant ? undefined : "hidden"}
          animate={instant ? undefined : "visible"}
          exit={instant ? undefined : "exit"}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Staggered list container
interface StaggerListProps {
  children: React.ReactNode;
  className?: string;
}

export function StaggerList({ children, className = '' }: StaggerListProps) {
  const { instant } = useMotionConfig();
  return (
    <motion.div
      className={className}
      variants={instant ? undefined : staggerContainerVariants}
      initial={instant ? undefined : "hidden"}
      animate={instant ? undefined : "visible"}
    >
      {children}
    </motion.div>
  );
}

// Staggered list item
interface StaggerItemProps {
  children: React.ReactNode;
  className?: string;
}

export function StaggerItem({ children, className = '' }: StaggerItemProps) {
  const { instant } = useMotionConfig();
  return (
    <motion.div className={className} variants={instant ? undefined : staggerItemVariants}>
      {children}
    </motion.div>
  );
}

// Collapsible section
interface CollapsibleProps {
  children: React.ReactNode;
  isOpen: boolean;
  className?: string;
}

export function Collapsible({ children, isOpen, className = '' }: CollapsibleProps) {
  const { instant } = useMotionConfig();
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={className}
          variants={instant ? undefined : expandVariants}
          initial={instant ? undefined : "collapsed"}
          animate={instant ? undefined : "expanded"}
          exit={instant ? undefined : "collapsed"}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
