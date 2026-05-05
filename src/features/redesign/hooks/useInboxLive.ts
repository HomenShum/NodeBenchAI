/**
 * useInboxLive — Sprint Step 3 (client-side aggregator).
 *
 * Unions live data from two existing Convex endpoints into the redesign's `InboxItem` shape:
 *   - convex/domains/operations/batchAutopilot/queries.ts:getRecentRuns
 *       → lane = "batch_review" when status === "completed"
 *   - convex/domains/pipelines/pipelineRunsQueries.ts:listRecentRuns
 *       → lane = "agent_suggestions" when verdict in {needs_review}
 *
 * For lanes without backend data yet (`captures`, `watchlist`, `approvals`), the hook
 * falls back to fixtures so the UI still renders. The proper fix is a server-side aggregator
 * (`convex/domains/inbox/queries.ts:listItems`) — see docs/plans/REDESIGN_BACKEND_INTEGRATION_SPRINT.md.
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { inboxItems as fixtureInbox, type InboxItem } from "../fixtures";

interface BatchAutopilotRun {
  _id: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  feedItemsCount: number;
  signalsCount: number;
  narrativeEventsCount: number;
  briefMarkdown?: string;
  briefDocumentId?: string;
}

interface PipelineRun {
  _id: string;
  runId: string;
  pipelineKind: string;
  status: string;
  verdict?: string;
  title: string;
  modelId: string;
  createdAt: number;
  errorMessage?: string;
}

function timeAgo(at: number): string {
  const delta = Math.max(0, Date.now() - at);
  const m = Math.floor(delta / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function batchToInbox(run: BatchAutopilotRun): InboxItem {
  const total = run.feedItemsCount + run.signalsCount + run.narrativeEventsCount;
  const heading = (run.briefMarkdown ?? "").match(/^#+\s+(.+)$/m)?.[1]?.slice(0, 64);
  return {
    id: `bar_${run._id}`,
    lane: "batch_review",
    category: "automation",
    whyHere: "BATCH COMPLETE",
    whyTone: "amber",
    title: heading ?? "Operator brief ready",
    body: (run.briefMarkdown ?? "Batch run completed. Review the brief and accept to publish.").slice(0, 280),
    meta: `${timeAgo(run.completedAt ?? run.startedAt)} · ${total} signals collected`,
    confidence: total > 50 ? 0.8 : total > 20 ? 0.65 : 0.5,
  };
}

function pipelineToInbox(run: PipelineRun): InboxItem {
  const verdictMap: Record<string, { tone: InboxItem["whyTone"]; label: string; confidence: number }> = {
    needs_review: { tone: "amber", label: "NEEDS REVIEW", confidence: 0.55 },
    provisionally_verified: { tone: "blue", label: "PROVISIONAL", confidence: 0.75 },
    failed: { tone: "amber", label: "FAILED", confidence: 0.3 },
    verified: { tone: "green", label: "VERIFIED", confidence: 0.92 },
  };
  const v = verdictMap[run.verdict ?? "needs_review"] ?? verdictMap.needs_review;
  return {
    id: `pr_${run._id}`,
    lane: "agent_suggestions",
    category: "automation",
    whyHere: v.label,
    whyTone: v.tone,
    title: run.title,
    body: run.errorMessage ?? `Pipeline run · ${run.pipelineKind} · model ${run.modelId}.`,
    meta: `${timeAgo(run.createdAt)} · pipeline run #${run.runId.slice(-6)}`,
    confidence: v.confidence,
  };
}

export interface UseInboxLiveResult {
  items: InboxItem[];
  isLive: boolean;
  isLoading: boolean;
  liveCount: number;
}

export function useInboxLive(): UseInboxLiveResult {
  const liveBatch = useQuery(
    (api as unknown as { domains: { operations: { batchAutopilot: { queries: { getRecentRuns: unknown } } } } })
      .domains.operations.batchAutopilot.queries.getRecentRuns as Parameters<typeof useQuery>[0],
    { limit: 20 } as Parameters<typeof useQuery>[1],
  ) as BatchAutopilotRun[] | undefined;

  const livePipeline = useQuery(
    (api as unknown as { domains: { pipelines: { pipelineRunsQueries: { listRecentRuns: unknown } } } })
      .domains.pipelines.pipelineRunsQueries.listRecentRuns as Parameters<typeof useQuery>[0],
    { limit: 20 } as Parameters<typeof useQuery>[1],
  ) as PipelineRun[] | undefined;

  const isLoading = liveBatch === undefined || livePipeline === undefined;
  if (isLoading) return { items: fixtureInbox, isLive: false, isLoading: true, liveCount: 0 };

  const liveItems: InboxItem[] = [
    ...(liveBatch ?? []).filter((r) => r.status === "completed").map(batchToInbox),
    ...(livePipeline ?? []).filter((r) => r.verdict === "needs_review" || r.verdict === "failed").map(pipelineToInbox),
  ];

  if (liveItems.length === 0) {
    return { items: fixtureInbox, isLive: false, isLoading: false, liveCount: 0 };
  }

  // Mix live items (batch_review + agent_suggestions) with fixture items (captures/watchlist/approvals/etc.)
  const fixtureKeepLanes = new Set(["captures", "watchlist", "approvals"]);
  const mixed: InboxItem[] = [
    ...liveItems,
    ...fixtureInbox.filter((i) => fixtureKeepLanes.has((i.lane ?? "captures") as string)),
  ];

  return { items: mixed, isLive: true, isLoading: false, liveCount: liveItems.length };
}
