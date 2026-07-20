/**
 * Skeleton - Generic skeleton loader component
 * Base building block for all skeleton loaders with shimmer animation
 */

import React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
  /** Width - can be number (px) or string (e.g., '100%', '3/4') */
  width?: number | string;
  /** Height - can be number (px) or string */
  height?: number | string;
  /** Rounded corners - 'none', 'sm', 'md', 'lg', 'full' */
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /** Disable animation */
  static?: boolean;
}

export function Skeleton({
  className,
  width,
  height,
  rounded = 'md',
  static: isStatic = false,
}: SkeletonProps) {
  const roundedClasses = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
    full: 'rounded-full',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={cn(
        'bg-surface-secondary relative overflow-hidden',
        roundedClasses[rounded],
        !isStatic && 'skeleton-shimmer',
        className
      )}
      style={style}
    >
      {/* Premium gradient shimmer overlay */}
      {!isStatic && (
        <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      )}
    </div>
  );
}

/** Text line skeleton - mimics a line of text */
export function SkeletonText({
  lines = 1,
  className,
  lastLineWidth = '60%',
}: {
  lines?: number;
  className?: string;
  lastLineWidth?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          width={i === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
        />
      ))}
    </div>
  );
}

/** Circle skeleton - for avatars, icons */
export function SkeletonCircle({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Skeleton
      className={className}
      width={size}
      height={size}
      rounded="full"
    />
  );
}

/** Card skeleton - generic card placeholder */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 bg-card p-4 space-y-3',
        className
      )}
    >
      {children || (
        <>
          <div className="flex items-center gap-3">
            <SkeletonCircle size={40} />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <SkeletonText lines={2} />
        </>
      )}
    </div>
  );
}

/** Button skeleton */
export function SkeletonButton({
  width = 80,
  className,
}: {
  width?: number | string;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn('h-9', className)}
      width={width}
      rounded="lg"
    />
  );
}

/** Badge/chip skeleton */
export function SkeletonBadge({
  width = 60,
  className,
}: {
  width?: number | string;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn('h-5', className)}
      width={width}
      rounded="full"
    />
  );
}

export default Skeleton;
