/**
 * ViewSkeleton - Generic view skeleton for MainLayout loading states
 * Route-aware skeleton that matches common view layouts
 */

import React from 'react';
import { Skeleton, SkeletonText, SkeletonCircle, SkeletonCard, SkeletonBadge } from './Skeleton';

type ViewType = 'default' | 'documents' | 'calendar' | 'agents' | 'settings' | 'dashboard' | 'cost-dashboard' | 'industry-updates' | 'ask' | 'research' | 'telemetry' | 'memo' | 'trace';

interface ViewSkeletonProps {
  variant?: ViewType;
}

export function ViewSkeleton({ variant = 'default' }: ViewSkeletonProps) {
  let content: React.ReactNode;
  switch (variant) {
    case 'documents':
      content = <DocumentsViewSkeleton />;
      break;
    case 'calendar':
      content = <CalendarViewSkeleton />;
      break;
    case 'agents':
      content = <AgentsViewSkeleton />;
      break;
    case 'settings':
      content = <SettingsViewSkeleton />;
      break;
    case 'dashboard':
      content = <DashboardViewSkeleton />;
      break;
    case 'cost-dashboard':
      content = <CostDashboardViewSkeleton />;
      break;
    case 'industry-updates':
      content = <IndustryUpdatesViewSkeleton />;
      break;
    case 'ask':
      content = <AskSurfaceSkeleton />;
      break;
    case 'research':
      content = <ResearchSurfaceSkeleton />;
      break;
    case 'telemetry':
      content = <TelemetrySurfaceSkeleton />;
      break;
    case 'memo':
      content = <MemoSurfaceSkeleton />;
      break;
    case 'trace':
      content = <TraceSurfaceSkeleton />;
      break;
    default:
      content = <DefaultViewSkeleton />;
  }

  // Route navigation can briefly show these skeletons; keep them visually stable (no large-area pulsing).
  // skeleton-stagger: 100ms waterfall reveal per child card (see hud.css)
  return <div className="no-skeleton-animation skeleton-stagger">{content}</div>;
}

function DefaultViewSkeleton() {
  // No SignatureOrb — a spinning orb on a blank shell reads as a
  // "web-app loading screen" (Gemini 3.1 Pro QA P0). Use the ask-surface
  // skeleton shape as the universal neutral boot state.
  return <AskSurfaceSkeleton />;
}

function DocumentsViewSkeleton() {
  return (
    <div className="nb-page-shell"><div className="nb-page-inner"><div className="nb-page-frame space-y-6">
      {/* Header with tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-24" rounded="lg" />
          ))}
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9" rounded="md" />
          <Skeleton className="h-9 w-28" rounded="md" />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBadge key={i} width={70} />
        ))}
      </div>

      {/* Document grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <DocumentCardSkeleton key={i} />
        ))}
      </div>
    </div></div></div>
  );
}

function DocumentCardSkeleton() {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Skeleton className="w-10 h-10 shrink-0" rounded="lg" />
        <div className="flex-1 space-y-2 min-w-0">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <SkeletonText lines={2} />
      <div className="flex gap-2">
        <SkeletonBadge width={50} />
        <SkeletonBadge width={40} />
      </div>
    </div>
  );
}

function CalendarViewSkeleton() {
  return (
    <div className="nb-page-shell"><div className="nb-page-inner"><div className="nb-page-frame space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-8" rounded="md" />
          <Skeleton className="h-7 w-40" rounded="lg" />
          <Skeleton className="h-8 w-8" rounded="md" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" rounded="md" />
          <Skeleton className="h-9 w-20" rounded="md" />
          <Skeleton className="h-9 w-20" rounded="md" />
        </div>
      </div>

      {/* Week header */}
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" rounded="md" />
        ))}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" rounded="lg" />
        ))}
      </div>
    </div></div></div>
  );
}

function AgentsViewSkeleton() {
  return (
    <div className="nb-page-shell"><div className="nb-page-inner"><div className="nb-page-frame space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="w-6 h-6" rounded="md" />
            <Skeleton className="h-7 w-32" rounded="lg" />
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-edge dark:border-border/60 bg-surface dark:bg-card p-4 space-y-2">
            <Skeleton className="h-8 w-12" rounded="lg" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-32" rounded="lg" />
        ))}
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <AgentCardSkeleton key={i} />
        ))}
      </div>
    </div></div></div>
  );
}

function AgentCardSkeleton() {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SkeletonCircle size={40} />
          <div className="space-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <SkeletonBadge width={50} />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 flex-1" rounded="md" />
        <Skeleton className="h-8 w-8" rounded="md" />
        <Skeleton className="h-8 w-8" rounded="md" />
      </div>
    </div>
  );
}

function SettingsViewSkeleton() {
  return (
    <div className="nb-page-shell"><div className="nb-page-inner"><div className="nb-page-frame-narrow space-y-6">
      {/* Header */}
      <Skeleton className="h-7 w-32" rounded="lg" />

      {/* Settings sections */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border/60 bg-card p-5 space-y-4">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-6 w-12" rounded="full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div></div></div>
  );
}

function DashboardViewSkeleton() {
  return (
    <div className="nb-page-shell"><div className="nb-page-inner"><div className="nb-page-frame space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" rounded="lg" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28" rounded="md" />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10" rounded="lg" />
              <div className="space-y-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-16" rounded="lg" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Chart placeholder */}
      <div className="rounded-lg border border-border/60 bg-card p-5">
        <Skeleton className="h-5 w-32 mb-4" />
        <Skeleton className="h-64 w-full" rounded="lg" />
      </div>
    </div></div></div>
  );
}

function CostDashboardViewSkeleton() {
  return (
    <div className="nb-page-shell"><div className="nb-page-inner"><div className="nb-page-frame space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" rounded="lg" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2 bg-muted/30 rounded-lg p-1">
          <Skeleton className="h-9 w-20" rounded="md" />
          <Skeleton className="h-9 w-16" rounded="md" />
          <Skeleton className="h-9 w-18" rounded="md" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10" rounded="lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" rounded="lg" />
              </div>
            </div>
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {['Cost by Model', 'Cost by User'].map((title) => (
          <div key={title} className="rounded-lg border border-border/60 bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-24 shrink-0" />
                  <Skeleton className="h-6 rounded-r-md" width={`${Math.max(20, 100 - i * 15)}%`} />
                  <Skeleton className="h-4 w-12 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div></div></div>
  );
}

function IndustryUpdatesViewSkeleton() {
  return (
    <div className="nb-page-shell"><div className="nb-page-inner"><div className="nb-page-frame space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="w-6 h-6" rounded="md" />
            <Skeleton className="h-7 w-40" rounded="lg" />
          </div>
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/30 rounded-lg">
          <Skeleton className="w-2 h-2" rounded="full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="w-4 h-4" rounded="md" />
        <div className="flex gap-2 flex-wrap">
          <Skeleton className="h-8 w-12" rounded="md" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24" rounded="md" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-card p-5 space-y-4">
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
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-4/6" />
            </div>
          </div>
        ))}
      </div>
    </div></div></div>
  );
}

/** Ask surface: centered hero shape + 3 card placeholders */
function AskSurfaceSkeleton() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 pb-24 pt-8">
      {/* Hero block */}
      <div className="w-full max-w-xl space-y-4 text-center">
        <Skeleton className="mx-auto h-10 w-64" rounded="xl" />
        <Skeleton className="mx-auto h-4 w-80" />
      </div>
      {/* CTA cards */}
      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} className="space-y-3 p-5">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}

/** Research surface: tab bar shape + 2-column card grid */
function ResearchSurfaceSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-4 pb-24 pt-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/[0.06] pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" rounded="md" />
        ))}
      </div>
      {/* 2-column cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} className="space-y-3 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}

/** Telemetry surface: hero metric card + tab bar + panel */
function TelemetrySurfaceSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-4 pb-24 pt-4">
      {/* Hero metric */}
      <SkeletonCard className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-20" rounded="lg" />
          </div>
          <div className="flex gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-10" rounded="lg" />
              </div>
            ))}
          </div>
        </div>
      </SkeletonCard>
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/[0.06] pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" rounded="md" />
        ))}
      </div>
      {/* Content panel */}
      <SkeletonCard className="min-h-[200px] p-5">
        <Skeleton className="h-4 w-32 mb-4" />
        <Skeleton className="h-40 w-full" rounded="lg" />
      </SkeletonCard>
    </div>
  );
}

/** Memo (Decision Workbench) surface: header + 3 card rows */
function MemoSurfaceSkeleton() {
  return (
    <div className="nb-page-shell"><div className="nb-page-inner"><div className="nb-page-frame space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" rounded="lg" />
        <Skeleton className="h-4 w-72" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonCard key={i} className="space-y-3 p-5">
          <div className="flex items-center gap-3">
            <SkeletonCircle size={32} />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <SkeletonBadge width={60} />
          </div>
          <SkeletonText lines={2} />
        </SkeletonCard>
      ))}
    </div></div></div>
  );
}

/** Trace surface: header + stacked sections */
function TraceSurfaceSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-4 pb-24 pt-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <SkeletonCard key={i} className="space-y-3 p-5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </SkeletonCard>
      ))}
    </div>
  );
}

export default ViewSkeleton;
