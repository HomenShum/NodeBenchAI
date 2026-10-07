/**
 * useTodayPulseSwr — IndexedDB stale-while-revalidate wrapper around
 * `useTodayPulse`.  On second-and-subsequent visits, the editorial
 * §1 paints instantly from disk while Convex revalidates.
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - HONEST_STATUS — exposes `swr` metadata so EditorialHomeSurface
 *                    can render the cache-notice chip honestly.
 *  - ERROR_BOUNDARY — IDB failure falls through to live query.
 */

import { useTodayPulse, type TodayPulseResult } from "./useTodayPulse";
import { getStoredAnonymousSessionId } from "./editionSession";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface TodayPulseSwr {
  data: TodayPulseResult | undefined;
  swr: Omit<SwrResult<TodayPulseResult>, "data">;
}

export function useTodayPulseSwr(limit = 12): TodayPulseSwr {
  const live = useTodayPulse(limit);
  const sessionId = getStoredAnonymousSessionId();
  const swr = useStaleWhileRevalidate<TodayPulseResult>(
    "editorial.todayPulse",
    { limit, anonymousSessionId: sessionId },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
