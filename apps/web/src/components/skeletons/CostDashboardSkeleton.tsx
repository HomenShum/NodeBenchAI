/**
 * CostDashboardSkeleton - Shimmer placeholder for cost dashboard
 * Matches the layout of CostDashboard for smooth loading transitions
 */

import React from 'react';
import { Skeleton, SkeletonText, SkeletonBadge } from './Skeleton';

export function CostDashboardSkeleton() {
  return (
    <div className="p-6 space-y-6 motion-safe:animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" rounded="lg" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2 bg-surface-secondary rounded-lg p-1">
          <Skeleton className="h-9 w-20" rounded="md" />
          <Skeleton className="h-9 w-16" rounded="md" />
          <Skeleton className="h-9 w-18" rounded="md" />
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartSkeleton title="Cost by Model" />
        <ChartSkeleton title="Cost by User" />
      </div>

      {/* Cache Stats */}
      <div className="rounded-lg border border-edge bg-surface p-5">
        <div className="flex items-center gap-2 mb-4">
          <Skeleton className="w-5 h-5" rounded="md" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="text-center space-y-2">
              <Skeleton className="h-8 w-20 mx-auto" rounded="lg" />
              <Skeleton className="h-3 w-16 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10" rounded="lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" rounded="lg" />
        </div>
      </div>
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-16" />
      </div>
      {/* Chart bars */}
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-24 shrink-0" />
            <Skeleton 
              className="h-6 rounded-r-md" 
              width={`${Math.max(20, 100 - i * 15)}%`} 
            />
            <Skeleton className="h-4 w-12 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default CostDashboardSkeleton;
