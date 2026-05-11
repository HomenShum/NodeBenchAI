/**
 * useMonthlyRetrospectiveSwr — IndexedDB stale-while-revalidate
 * wrapper around `useMonthlyRetrospective`.  Powers the monthly
 * retrospective branch of the editorial home (P0 #3, temporal
 * browsing).
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - HONEST_STATUS — exposes `swr` metadata so EditorialHomeSurface
 *                    can aggregate the cache-notice chip honestly.
 *  - ERROR_BOUNDARY — IDB failure falls through to live query.
 *
 * Pattern: mirrors the wrappers introduced in PR #333.
 */

import {
  useMonthlyRetrospective,
  type MonthlyRetrospectiveResult,
} from "./useTemporalEdition";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface MonthlyRetrospectiveSwr {
  data: MonthlyRetrospectiveResult | undefined;
  swr: Omit<SwrResult<MonthlyRetrospectiveResult>, "data">;
}

export function useMonthlyRetrospectiveSwr(
  monthKey: string | null,
): MonthlyRetrospectiveSwr {
  const live = useMonthlyRetrospective(monthKey);
  const swr = useStaleWhileRevalidate<MonthlyRetrospectiveResult>(
    "editorial.monthlyRetrospective",
    { monthKey },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
