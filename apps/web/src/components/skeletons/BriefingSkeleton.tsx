/**
 * BriefingSkeleton - Shimmer placeholder for the briefing/acts section
 * Matches the scrollytelling layout for smooth loading
 */

import React from 'react';

export function ActSectionSkeleton() {
  return (
    <div className="p-6 rounded-lg border border-border/60 bg-card">
      {/* Act header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-muted/50 rounded-full" />
        <div className="space-y-1">
          <div className="h-4 bg-muted/50 rounded w-40" />
          <div className="h-3 bg-muted/40 rounded w-24" />
        </div>
      </div>

      {/* Content paragraphs */}
      <div className="space-y-3 mb-6">
        <div className="h-3 bg-muted/40 rounded w-full" />
        <div className="h-3 bg-muted/40 rounded w-full" />
        <div className="h-3 bg-muted/40 rounded w-5/6" />
        <div className="h-3 bg-muted/40 rounded w-4/5" />
      </div>

      {/* Stats row */}
      <div className="flex gap-4 mb-4">
        <div className="flex-1 p-3 bg-muted/30 rounded-lg">
          <div className="h-2.5 bg-muted/50 rounded w-16 mb-2" />
          <div className="h-5 bg-muted/50 rounded w-12" />
        </div>
        <div className="flex-1 p-3 bg-muted/30 rounded-lg">
          <div className="h-2.5 bg-muted/50 rounded w-20 mb-2" />
          <div className="h-5 bg-muted/50 rounded w-16" />
        </div>
        <div className="flex-1 p-3 bg-muted/30 rounded-lg">
          <div className="h-2.5 bg-muted/50 rounded w-14 mb-2" />
          <div className="h-5 bg-muted/50 rounded w-10" />
        </div>
      </div>

      {/* Deep dive section */}
      <div className="p-4 bg-muted/30 rounded-lg">
        <div className="h-3.5 bg-muted/50 rounded w-32 mb-3" />
        <div className="space-y-2">
          <div className="h-3 bg-muted/40 rounded w-full" />
          <div className="h-3 bg-muted/40 rounded w-5/6" />
          <div className="h-3 bg-muted/40 rounded w-4/6" />
        </div>
      </div>
    </div>
  );
}

export function BriefingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 bg-muted/50 rounded w-48" />
          <div className="h-4 bg-muted/40 rounded w-32" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 bg-muted/40 rounded-lg w-20" />
          <div className="h-8 bg-muted/40 rounded-lg w-24" />
        </div>
      </div>

      {/* Timeline indicator */}
      <div className="flex items-center gap-2 px-4">
        <div className="h-2 w-2 bg-muted/60 rounded-full" />
        <div className="h-0.5 flex-1 bg-muted/50 rounded" />
        <div className="h-2 w-2 bg-muted/50 rounded-full" />
        <div className="h-0.5 flex-1 bg-muted/50 rounded" />
        <div className="h-2 w-2 bg-muted/50 rounded-full" />
      </div>

      {/* Act sections */}
      <ActSectionSkeleton />
    </div>
  );
}

export function DashboardSkeleton() {
  const barHeights = [24, 38, 52, 44, 60, 34, 48, 28, 56, 40, 50, 32];
  return (
    <div className="p-4 rounded-lg border border-border/60 bg-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 bg-muted/50 rounded w-28" />
        <div className="h-6 bg-muted/40 rounded w-16" />
      </div>

      {/* Chart placeholder */}
      <div className="h-48 bg-muted/30 rounded-lg mb-4 relative overflow-hidden">
        {/* Fake chart bars */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-around p-4 gap-2">
          {barHeights.map((h, i) => (
            <div
              key={i}
              className="bg-muted/60 rounded-t w-full"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-2 bg-muted/30 rounded-lg">
            <div className="h-2.5 bg-muted/50 rounded w-12 mb-1.5" />
            <div className="h-4 bg-muted/50 rounded w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default BriefingSkeleton;
