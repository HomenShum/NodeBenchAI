/**
 * Card - Industry-standard card with HUD micro-interactions
 * 
 * Features:
 * - Hover elevation (y-translate + shadow increase)
 * - Mouse-proximity tilt (perspective + rotateX/Y) on interactive cards
 * - Dynamic border glow that follows cursor proximity
 * - Click feedback for interactive cards
 * - Consistent border radius and spacing
 * - All effects respect reduced-motion preference
 */

import React, { useRef, useCallback } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../../lib/utils';
import { useMouseProximity } from '../../hooks/useMouseProximity';
import { useMotionConfig } from '@/lib/motion';

interface CardProps extends HTMLMotionProps<'div'> {
  /** Make the card interactive with hover/click effects */
  interactive?: boolean;
  /** Add a subtle border */
  bordered?: boolean;
  /** Padding size */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Enable HUD-style tilt on hover. Default true for interactive cards. */
  tilt?: boolean;
  /** Max tilt angle in degrees. Default 3. */
  tiltMax?: number;
  children: React.ReactNode;
}

const paddingStyles = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      interactive = false,
      bordered = true,
      padding = 'md',
      tilt,
      tiltMax = 3,
      className,
      children,
      onClick,
      ...props
    },
    ref
  ) => {
    const isClickable = interactive || !!onClick;
    const enableTilt = tilt ?? isClickable;
    const { instant, transition: motionTransition } = useMotionConfig();
    const internalRef = useRef<HTMLDivElement>(null);
    const cardRef = (ref as React.RefObject<HTMLDivElement>) || internalRef;
    const { isNear, normalizedDistance, relativeX, relativeY } = useMouseProximity(cardRef, { radius: 250 });

    const shouldTilt = enableTilt && isNear && !instant;
    const glowStrength = isNear && !instant ? Math.round((1 - normalizedDistance) * 25) : 0;

    // Tilt transform based on relative mouse position
    const tiltStyle: React.CSSProperties = shouldTilt
      ? {
        transform: `perspective(800px) rotateX(${-relativeY * tiltMax}deg) rotateY(${relativeX * tiltMax}deg)`,
        transition: 'transform 0.1s ease-out, box-shadow 0.15s ease-out',
      }
      : {
        transform: 'perspective(800px) rotateX(0deg) rotateY(0deg)',
        transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out',
      };

    const glowShadow = glowStrength > 0
      ? `0 0 ${glowStrength}px rgba(99, 102, 241, ${glowStrength / 80})`
      : undefined;

    return (
      <motion.div
        ref={cardRef}
        whileHover={isClickable && !shouldTilt && !instant ? { y: -2, boxShadow: '0 0 0 1px rgba(0,0,0,0.03), 0 4px 8px rgba(0,0,0,0.04), 0 24px 48px rgba(0,0,0,0.08)' } : undefined}
        whileTap={isClickable && !instant ? { scale: 0.995 } : undefined}
        transition={motionTransition({ type: 'tween', duration: 0.15 })}
        className={cn(
          'bg-card rounded-lg',
          bordered && 'border border-edge/60',
          paddingStyles[padding],
          isClickable && 'cursor-pointer will-change-transform',
          'shadow-sm',
          className
        )}
        style={{
          ...tiltStyle,
          ...(glowShadow ? { boxShadow: glowShadow } : {}),
        }}
        onClick={onClick}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = 'Card';

/** Card header section */
export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between mb-3', className)}>
      {children}
    </div>
  );
}

/** Card title */
export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <h3 className={cn('text-base font-semibold text-content tracking-tight', className)}>
      {children}
    </h3>
  );
}

/** Card description */
export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn('text-sm text-content-secondary', className)}>
      {children}
    </p>
  );
}

/** Card content section */
export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('', className)}>
      {children}
    </div>
  );
}

/** Card footer section */
export function CardFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-center gap-2 mt-4 pt-3 border-t border-edge', className)}>
      {children}
    </div>
  );
}

export default Card;
