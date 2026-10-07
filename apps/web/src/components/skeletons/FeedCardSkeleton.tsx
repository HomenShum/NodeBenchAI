/**
 * FeedCardSkeleton - Shimmer placeholder for feed cards
 * Matches the layout of FeedCard for smooth loading transitions
 */

import React from 'react';

interface FeedCardSkeletonProps {
  variant?: 'default' | 'compact' | 'large';
}

export function FeedCardSkeleton({ variant = 'default' }: FeedCardSkeletonProps) {
  if (variant === 'compact') {
    return (
      <div className="motion-safe:animate-pulse p-3 border border-edge rounded-lg bg-surface">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-surface-secondary rounded-lg shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="h-3.5 bg-surface-secondary rounded w-3/4 mb-1" />
            <div className="h-2.5 bg-surface-secondary dark:bg-white/[0.05] rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'large') {
    return (
      <div className="motion-safe:animate-pulse p-5 border border-edge rounded-lg bg-surface">
        <div className="flex gap-4">
          <div className="w-12 h-12 bg-surface-secondary rounded-lg shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-5 bg-surface-secondary rounded w-4/5" />
            <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-2/3" />
            <div className="space-y-2 mt-4">
              <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-full" />
              <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-5/6" />
              <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-4/6" />
            </div>
            <div className="flex gap-2 mt-4">
              <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-16" />
              <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-12" />
              <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-14" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div className="motion-safe:animate-pulse p-4 border border-edge rounded-lg bg-surface">
      <div className="flex gap-3">
        <div className="w-10 h-10 bg-surface-secondary rounded-lg shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-4 bg-surface-secondary rounded w-3/4" />
          <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-1/2" />
        </div>
        <div className="w-16 h-6 bg-surface-secondary dark:bg-white/[0.05] rounded-full shrink-0" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-full" />
        <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-5/6" />
      </div>
      <div className="flex gap-2 mt-3">
        <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-14" />
        <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-10" />
      </div>
    </div>
  );
}

export function FeedGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <FeedCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default FeedCardSkeleton;
