import {
  useLongHorizonRetrospective,
  type LongHorizonRetrospectiveResult,
} from "./useTemporalEdition";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface LongHorizonRetrospectiveSwr {
  data: LongHorizonRetrospectiveResult | undefined;
  swr: Omit<SwrResult<LongHorizonRetrospectiveResult>, "data">;
}

export function useLongHorizonRetrospectiveSwr(
  kind: "quarter" | "year" | null,
  periodKey: string | null,
): LongHorizonRetrospectiveSwr {
  const live = useLongHorizonRetrospective(kind, periodKey);
  const swr = useStaleWhileRevalidate<LongHorizonRetrospectiveResult>(
    "editorial.longHorizonRetrospective",
    { kind, periodKey },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
