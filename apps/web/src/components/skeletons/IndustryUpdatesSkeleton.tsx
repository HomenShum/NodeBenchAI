/**
 * IndustryUpdatesSkeleton - Shimmer placeholder for industry updates panel
 * Matches the layout of IndustryUpdatesPanel for smooth loading transitions
 */

import React from 'react';
import { Skeleton, SkeletonBadge } from './Skeleton';

export function IndustryUpdatesSkeleton() {
  return (
    <div className="p-6 space-y-6 motion-safe:animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="w-6 h-6" rounded="md" />
            <Skeleton className="h-7 w-40" rounded="lg" />
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary rounded-lg">
          <Skeleton className="w-2 h-2" rounded="full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      {/* Provider Filter */}
      <div className="flex items-center gap-2">
        <Skeleton className="w-4 h-4" rounded="md" />
        <div className="flex gap-2 flex-wrap">
          <Skeleton className="h-8 w-12" rounded="md" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24" rounded="md" />
          ))}
        </div>
      </div>

      {/* Update Cards */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <UpdateCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function UpdateCardSkeleton() {
  return (
    <div className="rounded-lg border border-edge bg-surface p-5 space-y-4">
      {/* Card Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10" rounded="lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <div className="flex items-center gap-2">
              <SkeletonBadge width={60} />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        </div>
        <Skeleton className="h-8 w-8" rounded="md" />
      </div>

      {/* Content */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-edge">
        <div className="flex gap-2">
          <SkeletonBadge width={70} />
          <SkeletonBadge width={50} />
        </div>
        <Skeleton className="h-8 w-28" rounded="md" />
      </div>
    </div>
  );
}

export default IndustryUpdatesSkeleton;
