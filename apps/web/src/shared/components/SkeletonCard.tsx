/**
 * SkeletonCard — Glass DNA skeleton loading card with stagger animation.
 * Used as placeholder while founder dashboard cards load.
 */
import { memo } from "react";

interface SkeletonCardProps {
  lines?: number;
  index?: number;
  className?: string;
}

export const SkeletonCard = memo(function SkeletonCard({
  lines = 3,
  index = 0,
  className = "",
}: SkeletonCardProps) {
  return (
    <div
      className={`rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 skeleton-stagger ${className}`}
      style={{
        animationDelay: `${index * 100}ms`,
        animationFillMode: "both",
      }}
      aria-hidden="true"
    >
      {/* Header skeleton */}
      <div className="motion-safe:animate-pulse">
        <div className="h-3 w-32 rounded bg-white/[0.08]" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: lines }, (_, i) => (
            <div
              key={i}
              className="h-2.5 rounded bg-white/[0.06]"
              style={{ width: `${85 - i * 15}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

interface SkeletonDashboardProps {
  cards?: number;
  className?: string;
}

export const SkeletonDashboard = memo(function SkeletonDashboard({
  cards = 6,
  className = "",
}: SkeletonDashboardProps) {
  return (
    <div className={`flex flex-col gap-4 px-4 pt-4 ${className}`}>
      {/* Header skeleton */}
      <div className="motion-safe:animate-pulse">
        <div className="h-4 w-48 rounded bg-white/[0.08]" />
        <div className="mt-2 flex gap-2">
          <div className="h-8 w-24 rounded-lg bg-white/[0.06]" />
          <div className="h-8 w-24 rounded-lg bg-white/[0.06]" />
          <div className="h-8 w-24 rounded-lg bg-white/[0.06]" />
        </div>
      </div>
      {/* Card skeletons with stagger */}
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} index={i} lines={i === 0 ? 4 : 3} />
      ))}
    </div>
  );
});
