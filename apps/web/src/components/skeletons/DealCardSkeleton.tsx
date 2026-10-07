/**
 * DealCardSkeleton - Shimmer placeholder for deal list items
 * Matches the layout of DealListPanel cards for smooth loading
 */

import React from 'react';

export function DealCardSkeleton() {
  return (
    <div className="motion-safe:animate-pulse p-4 border border-edge rounded-lg bg-surface">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-surface-secondary rounded-lg" />
          <div className="space-y-1.5">
            <div className="h-4 bg-surface-secondary rounded w-32" />
            <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-24" />
          </div>
        </div>
        <div className="h-6 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-16" />
      </div>

      {/* Amount and date */}
      <div className="flex items-center gap-4 mb-3">
        <div className="h-6 bg-surface-secondary rounded w-20" />
        <div className="h-4 bg-surface-secondary dark:bg-white/[0.05] rounded w-16" />
      </div>

      {/* Summary */}
      <div className="space-y-2 mb-3">
        <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-full" />
        <div className="h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-4/5" />
      </div>

      {/* Tags */}
      <div className="flex gap-2">
        <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-16" />
        <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-20" />
        <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-14" />
      </div>
    </div>
  );
}

export function DealListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <DealCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default DealCardSkeleton;
