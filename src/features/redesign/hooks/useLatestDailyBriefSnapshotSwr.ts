/**
 * useLatestDailyBriefSnapshotSwr — IndexedDB stale-while-revalidate
 * wrapper around `useLatestDailyBriefSnapshot`.  Powers §4 + §5 of
 * the editorial home.  The snapshot is the largest payload; capping
 * value bytes at 100KB in `idbSwrCache.ts` keeps disk bounded.
 */

import {
  useLatestDailyBriefSnapshot,
  type LatestSnapshot,
} from "./useLatestDailyBriefSnapshot";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface LatestSnapshotSwr {
  data: LatestSnapshot | null | undefined;
  swr: Omit<SwrResult<LatestSnapshot | null>, "data">;
}

export function useLatestDailyBriefSnapshotSwr(): LatestSnapshotSwr {
  const live = useLatestDailyBriefSnapshot();
  const swr = useStaleWhileRevalidate<LatestSnapshot | null>(
    "editorial.latestDailyBriefSnapshot",
    {},
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
