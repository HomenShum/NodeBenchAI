/**
 * useDailyEditionSwr — IndexedDB stale-while-revalidate wrapper
 * around `useDailyEdition`.  Powers the archived-day branch of the
 * editorial home (P0 #3, temporal browsing).
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - HONEST_STATUS — exposes `swr` metadata so EditorialHomeSurface
 *                    can aggregate the cache-notice chip honestly.
 *  - ERROR_BOUNDARY — IDB failure falls through to live query.
 *
 * When `dateKey` is null, the underlying `useDailyEdition` skips its
 * Convex query.  The SWR wrapper still runs but the cache key includes
 * `dateKey: null` so we don't collide with real keys.
 *
 * Pattern: mirrors the wrappers introduced in PR #333.
 */

import {
  useDailyEdition,
  type DailyEditionResult,
} from "./useTemporalEdition";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface DailyEditionSwr {
  data: DailyEditionResult | undefined;
  swr: Omit<SwrResult<DailyEditionResult>, "data">;
}

export function useDailyEditionSwr(dateKey: string | null): DailyEditionSwr {
  const live = useDailyEdition(dateKey);
  const swr = useStaleWhileRevalidate<DailyEditionResult>(
    "editorial.dailyEdition",
    { dateKey },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
