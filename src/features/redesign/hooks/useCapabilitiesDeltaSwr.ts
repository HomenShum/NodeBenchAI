/**
 * useCapabilitiesDeltaSwr — IndexedDB stale-while-revalidate wrapper
 * around `useCapabilitiesDelta`.  Powers the §5 Capabilities map
 * delta badges (+N/-N/→) on the editorial home.
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - HONEST_STATUS — exposes `swr` metadata so EditorialHomeSurface
 *                    can aggregate the cache-notice chip honestly.
 *  - ERROR_BOUNDARY — IDB failure falls through to live query.
 *
 * Pattern: mirrors the wrappers introduced in PR #333 (useTodayPulseSwr,
 * useActiveHypothesesSwr, useTopForecastsSwr, useLatestDailyBriefSnapshotSwr).
 */

import {
  useCapabilitiesDelta,
  type CapabilitiesDelta,
} from "./useCapabilitiesDelta";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface CapabilitiesDeltaSwr {
  data: CapabilitiesDelta | undefined;
  swr: Omit<SwrResult<CapabilitiesDelta>, "data">;
}

export function useCapabilitiesDeltaSwr(
  windowDays: number = 1,
): CapabilitiesDeltaSwr {
  const live = useCapabilitiesDelta(windowDays);
  const swr = useStaleWhileRevalidate<CapabilitiesDelta>(
    "editorial.capabilitiesDelta",
    { windowDays },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
