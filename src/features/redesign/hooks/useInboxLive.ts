/**
 * useInboxLive - client-side live Inbox aggregator.
 *
 * The public Inbox should survive supporting operations outages. Keep the
 * stable pipeline-run feed live, and do not call batch-autopilot telemetry
 * from the web shell until the deployed auth-safe query is available.
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { InboxItem } from "../fixtures";
import { getAnonymousProductSessionId } from "../../product/lib/productIdentity";

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

interface ProductNudge {
  _id: string;
  type: string;
  title: string;
  summary: string;
  priority: "low" | "medium" | "high";
  bucket?: "action_required" | "update";
  actionLabel?: string;
  actionTargetSurface?: string;
  actionTargetId?: string;
  linkedReportTitle?: string;
  updatedAt: number;
}

interface ProductNudgeSnapshot {
  nudges: ProductNudge[];
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

function nudgeToInbox(nudge: ProductNudge): InboxItem {
  const toneMap: Record<ProductNudge["priority"], NonNullable<InboxItem["whyTone"]>> = {
    high: "amber",
    medium: "accent",
    low: "blue",
  };
  const lane =
    nudge.bucket === "action_required" ||
    nudge.type === "follow_up_due" ||
    nudge.type === "refresh_recommended"
      ? "agent_suggestions"
      : "watchlist";
  const title = nudge.linkedReportTitle
    ? `${nudge.title} - ${nudge.linkedReportTitle}`
    : nudge.title;
  return {
    id: `nudge_${nudge._id}`,
    lane,
    category: lane === "watchlist" ? "watchlist" : "automation",
    whyHere:
      nudge.type === "follow_up_due"
        ? "FOLLOW-UP"
        : nudge.type === "refresh_recommended"
          ? "REFRESH"
          : "NUDGE",
    whyTone: toneMap[nudge.priority] ?? "accent",
    title,
    body: nudge.summary,
    meta: `${timeAgo(nudge.updatedAt)} - ${nudge.actionLabel ?? "Open"}`,
    confidence: undefined,
  };
}

function pipelineToInbox(run: PipelineRun): InboxItem {
  const verdictMap: Record<string, { tone: InboxItem["whyTone"]; label: string }> = {
    needs_review: { tone: "amber", label: "NEEDS REVIEW" },
    provisionally_verified: { tone: "blue", label: "PROVISIONAL" },
    failed: { tone: "amber", label: "FAILED" },
    verified: { tone: "green", label: "VERIFIED" },
  };
  const verdict = verdictMap[run.verdict ?? "needs_review"] ?? verdictMap.needs_review;
  return {
    id: `pr_${run._id}`,
    lane: "agent_suggestions",
    category: "automation",
    whyHere: verdict.label,
    whyTone: verdict.tone,
    title: run.title,
    body: run.errorMessage ?? `Pipeline run - ${run.pipelineKind} - model ${run.modelId}.`,
    meta: `${timeAgo(run.createdAt)} - pipeline run #${run.runId.slice(-6)}`,
  };
}

export interface UseInboxLiveResult {
  items: InboxItem[];
  isLive: boolean;
  isLoading: boolean;
  liveCount: number;
}

export function useInboxLive(): UseInboxLiveResult {
  const anonymousSessionId = getAnonymousProductSessionId();
  const livePipeline = useQuery(
    (api as unknown as { domains: { pipelines: { pipelineRunsQueries: { listRecentRuns: unknown } } } })
      .domains.pipelines.pipelineRunsQueries.listRecentRuns as Parameters<typeof useQuery>[0],
    { limit: 20 } as Parameters<typeof useQuery>[1],
  ) as PipelineRun[] | undefined;
  const nudgeSnapshot = useQuery(
    (api as unknown as { domains: { product: { nudges: { getNudgesSnapshot: unknown } } } })
      .domains.product.nudges.getNudgesSnapshot as Parameters<typeof useQuery>[0],
    { anonymousSessionId } as Parameters<typeof useQuery>[1],
  ) as ProductNudgeSnapshot | undefined;

  if (livePipeline === undefined && nudgeSnapshot === undefined) {
    return { items: [], isLive: false, isLoading: true, liveCount: 0 };
  }

  const liveItems = (livePipeline ?? [])
    .filter((run) => run.verdict === "needs_review" || run.verdict === "failed")
    .map(pipelineToInbox);
  const nudgeItems = (nudgeSnapshot?.nudges ?? []).map(nudgeToInbox);
  const items = [...nudgeItems, ...liveItems];

  if (items.length === 0) {
    return { items: [], isLive: false, isLoading: false, liveCount: 0 };
  }

  return { items, isLive: true, isLoading: false, liveCount: items.length };
}
