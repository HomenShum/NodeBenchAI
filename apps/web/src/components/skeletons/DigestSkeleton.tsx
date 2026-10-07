/**
 * DigestSkeleton - Shimmer placeholder for MorningDigest component
 * Matches the layout for smooth loading transitions
 */

import React from 'react';

export function DigestSkeleton() {
  return (
    <div className="motion-safe:animate-pulse rounded-lg border border-edge bg-surface ">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-surface-secondary" />
          <div className="space-y-1.5">
            <div className="h-2.5 bg-surface-secondary rounded w-20" />
            <div className="h-3.5 bg-surface-secondary rounded w-48" />
            <div className="h-2 bg-surface-secondary dark:bg-white/[0.05] rounded w-24" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1">
            <div className="h-6 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-20" />
            <div className="h-6 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-16" />
            <div className="h-6 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-18" />
          </div>
          <div className="h-8 w-8 bg-surface-secondary dark:bg-white/[0.05] rounded-lg" />
          <div className="h-8 w-8 bg-surface-secondary dark:bg-white/[0.05] rounded-lg" />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 space-y-3 pt-3">
        {/* Summary box */}
        <div className="rounded-lg border border-edge bg-surface-secondary p-3">
          <div className="flex items-start gap-2">
            <div className="mt-1 h-2 w-2 rounded-full bg-gray-300 dark:bg-white/[0.12]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-surface-secondary rounded w-full" />
              <div className="h-3 bg-surface-secondary rounded w-5/6" />
              <div className="h-3 bg-surface-secondary rounded w-4/6" />
            </div>
          </div>
        </div>

        {/* Section cards */}
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-edge bg-surface">
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 bg-surface-secondary dark:bg-white/[0.05] rounded-md" />
                  <div className="space-y-1">
                    <div className="h-3.5 bg-surface-secondary rounded w-28" />
                    <div className="h-2.5 bg-surface-secondary dark:bg-white/[0.05] rounded w-16" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-16" />
                  <div className="h-6 w-6 bg-surface-secondary dark:bg-white/[0.05] rounded-md" />
                </div>
              </div>
              {/* Items */}
              <div className="border-t border-edge">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="px-3 py-2.5 flex items-start gap-2 border-b border-gray-50 dark:border-white/[0.02] last:border-0">
                    <div className="mt-2 h-1.5 w-1.5 rounded-full bg-surface-secondary" />
                    <div className="flex-1 h-3 bg-surface-secondary dark:bg-white/[0.05] rounded w-full" />
                    <div className="h-5 bg-surface-secondary dark:bg-white/[0.05] rounded-full w-14 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="h-9 bg-surface-secondary dark:bg-white/[0.05] rounded-lg" />
          <div className="h-9 bg-surface-secondary border border-edge rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default DigestSkeleton;
