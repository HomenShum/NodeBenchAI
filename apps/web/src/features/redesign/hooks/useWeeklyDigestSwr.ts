/**
 * useWeeklyDigestSwr — IndexedDB stale-while-revalidate wrapper
 * around `useWeeklyDigest`.  Powers the weekly-digest branch of the
 * editorial home (P0 #3, temporal browsing).
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - HONEST_STATUS — exposes `swr` metadata so EditorialHomeSurface
 *                    can aggregate the cache-notice chip honestly.
 *  - ERROR_BOUNDARY — IDB failure falls through to live query.
 *
 * Pattern: mirrors the wrappers introduced in PR #333.
 */

import {
  useWeeklyDigest,
  type WeeklyDigestResult,
} from "./useTemporalEdition";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface WeeklyDigestSwr {
  data: WeeklyDigestResult | undefined;
  swr: Omit<SwrResult<WeeklyDigestResult>, "data">;
}

export function useWeeklyDigestSwr(weekKey: string | null): WeeklyDigestSwr {
  const live = useWeeklyDigest(weekKey);
  const swr = useStaleWhileRevalidate<WeeklyDigestResult>(
    "editorial.weeklyDigest",
    { weekKey },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
