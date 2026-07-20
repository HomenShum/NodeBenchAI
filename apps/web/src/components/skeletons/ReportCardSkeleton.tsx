/**
 * ReportCardSkeleton — placeholder for the Home "Recent Reports" grid
 * while `savedReports` is loading. Matches the real card's slot sizes
 * so the grid doesn't reflow on hydration.
 *
 * Usage:
 *   {savedReports === undefined
 *     ? Array.from({ length: 3 }).map((_, i) => <ReportCardSkeleton key={i} />)
 *     : cards.map(...)}
 */

import { Skeleton } from "./Skeleton";

export function ReportCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.1] dark:bg-[#171b20]"
    >
      <Skeleton className="mb-3 aspect-[16/9]" rounded="lg" />
      <Skeleton height={16} width="75%" />
      <div className="mt-2 space-y-1">
        <Skeleton height={12} width="100%" />
        <Skeleton height={12} width="83%" />
      </div>
      <Skeleton className="mt-4" height={12} width="33%" />
    </div>
  );
}

export default ReportCardSkeleton;
