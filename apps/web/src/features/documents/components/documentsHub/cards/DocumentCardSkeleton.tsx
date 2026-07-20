/**
 * DocumentCardSkeleton Component
 *
 * Lightweight loading skeleton for document cards while data is fetching.
 */

export function DocumentCardSkeleton() {
  return (
    <div className="group relative">
      <div className="document-card--hybrid motion-safe:animate-pulse">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface" />

            <div className="w-24 h-5 rounded bg-surface" />
          </div>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-surface" />

            <div className="w-7 h-7 rounded-md bg-surface" />
          </div>
        </div>

        <div className="flex-1 min-h-0 mb-2">
          <div className="h-4 bg-surface rounded w-3/4 mb-2" />

          <div className="h-4 bg-surface rounded w-2/3" />
        </div>

        <div className="flex-shrink-0 pt-2 border-t border-edge">
          <div className="h-3 bg-surface rounded w-1/3" />
        </div>
      </div>
    </div>
  );
}
