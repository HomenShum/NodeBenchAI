/**
 * useTopForecastsSwr — IndexedDB stale-while-revalidate wrapper
 * around `useTopForecasts`.  Powers §3 of the editorial home.
 */

import { useTopForecasts, type EditionForecast } from "./useTopForecasts";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface TopForecastsSwr {
  data: EditionForecast[] | undefined;
  swr: Omit<SwrResult<EditionForecast[]>, "data">;
}

export function useTopForecastsSwr(limit = 5): TopForecastsSwr {
  const live = useTopForecasts(limit);
  const swr = useStaleWhileRevalidate<EditionForecast[]>(
    "editorial.topForecasts",
    { limit },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
