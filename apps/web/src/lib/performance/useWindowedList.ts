import { useMemo, useState } from "react";

export function clampWindowSize(total: number, requested: number) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(total, Math.max(0, Math.floor(requested)));
}

export function getWindowedItems<T>(items: readonly T[], visibleCount: number) {
  const count = clampWindowSize(items.length, visibleCount);
  return {
    visibleItems: items.slice(0, count),
    visibleCount: count,
    remainingCount: Math.max(0, items.length - count),
    hasMore: count < items.length,
  };
}

export function useWindowedList<T>({
  items,
  initialCount,
  step = initialCount,
}: {
  items: readonly T[];
  initialCount: number;
  step?: number;
}) {
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const windowed = useMemo(() => getWindowedItems(items, visibleCount), [items, visibleCount]);

  const showMore = () => {
    setVisibleCount((current) => clampWindowSize(items.length, current + step));
  };

  const resetWindow = () => {
    setVisibleCount(initialCount);
  };

  return {
    ...windowed,
    showMore,
    resetWindow,
  };
}
