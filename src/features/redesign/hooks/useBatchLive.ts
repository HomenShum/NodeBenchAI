/**
 * useBatchLive — bridge live `batchAutopilotRuns` into the redesign's `ActiveBatchRun` shape.
 *
 * Backend Sprint Step 2. Wire path:
 *   convex/domains/operations/batchAutopilot/queries.ts:getRecentRuns
 *     → filter to active statuses (anything not "completed" / "failed")
 *     → derive ActiveBatchRun for the BatchMonitorCell
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { activeBatchRun as fixtureBatch, type ActiveBatchRun } from "../fixtures";

interface BatchAutopilotRun {
  _id: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  feedItemsCount: number;
  signalsCount: number;
  narrativeEventsCount: number;
  briefMarkdown?: string;
  totalCostUsd?: number;
  modelCallCount?: number;
}

const ACTIVE = new Set([
  "collecting",
  "summarizing",
  "planning",
  "generating_brief",
  "delivering",
]);

function runToBatch(run: BatchAutopilotRun): ActiveBatchRun {
  const total = Math.max(50, run.feedItemsCount + run.signalsCount + run.narrativeEventsCount);
  // Approximate progress from elapsed wall-time vs typical 4-min run, capped at 95% until completion
  const elapsed = Date.now() - run.startedAt;
  const guessPct = Math.min(0.95, elapsed / (4 * 60_000));
  const done = Math.round(total * guessPct);
  return {
    id: run._id,
    universeId: "live",
    universeName: "Operator briefing",
    styleName: "Founder / banker lens · v3",
    rubric: "Banker target screen",
    totalEntities: total,
    doneCount: done,
    reviewCount: 0,
    etaSeconds: Math.max(0, Math.round((4 * 60) - elapsed / 1000)),
    spentUsd: run.totalCostUsd ?? 0,
    recentSteps: [
      { entity: run.status, status: run.status === "delivering" ? "running" : "running", durationMs: 0 },
    ],
  };
}

export interface UseBatchLiveResult {
  batch: ActiveBatchRun | null;
  isLive: boolean;
  isLoading: boolean;
}

export function useBatchLive(): UseBatchLiveResult {
  const liveRuns = useQuery(
    (api as unknown as { domains: { operations: { batchAutopilot: { queries: { getRecentRuns: unknown } } } } })
      .domains.operations.batchAutopilot.queries.getRecentRuns as Parameters<typeof useQuery>[0],
    { limit: 5 } as Parameters<typeof useQuery>[1],
  ) as BatchAutopilotRun[] | undefined;

  if (liveRuns === undefined) return { batch: fixtureBatch, isLive: false, isLoading: true };
  const active = liveRuns.find((r) => ACTIVE.has(r.status));
  if (!active) return { batch: null, isLive: false, isLoading: false };
  return { batch: runToBatch(active), isLive: true, isLoading: false };
}
