import React, { Suspense, useCallback, useMemo, useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

interface LazyViewProps {
  children: React.ReactNode;
  /** ErrorBoundary title shown when this view crashes */
  title?: string;
  /** Optional wrapper className (e.g. "h-full overflow-auto bg-background") */
  className?: string;
  /** Suspense fallback for lazy-loaded children */
  fallback?: React.ReactNode;
  /** Optional reset key to re-mount the view on navigation changes */
  resetKey?: React.Key;
  /** Optional hook for retry (e.g. refetch) */
  onRetry?: () => void;
}

/**
 * LazyView — Per-view error isolation for lazy-loaded routes.
 *
 * Wraps each view in its own ErrorBoundary so a crash in one view
 * doesn't take down the entire content area. The parent Suspense
 * handles the loading state; this handles the error state.
 *
 * Instant swap between views (no exit animation) — matches Linear/Vercel.
 */
export function LazyView({ children, title, className, fallback, resetKey, onRetry }: LazyViewProps) {
  const [retry, setRetry] = useState(0);

  const boundaryKey = useMemo(() => `${String(resetKey ?? "view")}::${retry}`, [resetKey, retry]);

  const handleRetry = useCallback(() => {
    setRetry((v) => v + 1);
    onRetry?.();
  }, [onRetry]);

  const innerClass = className ? className : "h-full bg-surface";

  return (
    <ErrorBoundary key={boundaryKey} title={title || "Something went wrong"} onRetry={handleRetry}>
      <Suspense fallback={fallback ?? null}>
        <div className={`${innerClass} nb-lazy-view`}>{children}</div>
      </Suspense>
    </ErrorBoundary>
  );
}
