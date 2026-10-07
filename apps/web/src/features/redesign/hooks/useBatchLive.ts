/**
 * useBatchLive - optional bridge for live batch monitor telemetry.
 *
 * The batch-autopilot feed is a supporting operations signal, not the
 * primary research surface. Until the live deployment has the auth-safe
 * `getRecentRuns` query, do not call that query from public redesign
 * surfaces. Manual "run on list" batches still render from local state.
 */

import type { ActiveBatchRun } from "../fixtures";

export interface UseBatchLiveResult {
  batch: ActiveBatchRun | null;
  isLive: boolean;
  isLoading: boolean;
}

export function useBatchLive(): UseBatchLiveResult {
  return { batch: null, isLive: false, isLoading: false };
}
