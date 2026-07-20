/**
 * useActiveHypothesesSwr — IndexedDB stale-while-revalidate wrapper
 * around `useActiveHypotheses`.  Powers §2 of the editorial home.
 */

import {
  useActiveHypotheses,
  type EditionHypothesis,
} from "./useActiveHypotheses";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface ActiveHypothesesSwr {
  data: EditionHypothesis[] | undefined;
  swr: Omit<SwrResult<EditionHypothesis[]>, "data">;
}

export function useActiveHypothesesSwr(limit = 5): ActiveHypothesesSwr {
  const live = useActiveHypotheses(limit);
  const swr = useStaleWhileRevalidate<EditionHypothesis[]>(
    "editorial.activeHypotheses",
    { limit },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
