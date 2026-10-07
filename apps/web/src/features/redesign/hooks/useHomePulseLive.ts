/**
 * useHomePulseLive - optional Home pulse supplement.
 *
 * Home now gets its durable pulse from `useLiveArtifacts`. This hook remains
 * as a compatibility slot for future non-critical supplements, but it must
 * not call unstable operations queries from the public shell.
 */

import type { PulseCard } from "../fixtures";

export interface UseHomePulseLiveResult {
  pulse: PulseCard[];
  isLive: boolean;
  isLoading: boolean;
}

export function useHomePulseLive(): UseHomePulseLiveResult {
  return { pulse: [], isLive: false, isLoading: false };
}
