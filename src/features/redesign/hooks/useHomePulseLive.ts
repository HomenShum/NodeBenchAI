/**
 * useHomePulseLive — Sprint Step 4 partial (pulse cards only).
 *
 * Derives Home cover-hero pulse cards from `batchAutopilotRuns` briefMarkdown headlines.
 * Watchlist live wiring is gated on a new `watchlist`/`entityWatchlist` Convex table
 * (see docs/plans/REDESIGN_BACKEND_INTEGRATION_SPRINT.md gap #3).
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { PulseCard } from "../fixtures";

interface BatchAutopilotRun {
  _id: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  briefMarkdown?: string;
  signalsCount: number;
  feedItemsCount: number;
  briefDocumentId?: string;
}

const HEADING_RE = /^#+\s+(.+)$/gm;

function timeAgo(at: number): string {
  const m = Math.floor((Date.now() - at) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function pulseFromRun(run: BatchAutopilotRun, idx: number): PulseCard | null {
  const md = run.briefMarkdown ?? "";
  const matches = [...md.matchAll(HEADING_RE)];
  if (matches.length === 0) return null;
  const heading = matches[idx % matches.length][1].trim();
  const kinds: Array<PulseCard["kind"]> = ["memory_win", "report_update", "follow_up", "event"];
  return {
    kind: kinds[idx % kinds.length],
    title: heading.slice(0, 80),
    body: md.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 140) ?? "Latest brief from autopilot run.",
    meta: `${timeAgo(run.completedAt ?? run.startedAt)} · ${run.feedItemsCount + run.signalsCount} signals`,
    cta: run.briefDocumentId ? "Open brief" : undefined,
  };
}

export interface UseHomePulseLiveResult {
  pulse: PulseCard[];
  isLive: boolean;
  isLoading: boolean;
}

export function useHomePulseLive(): UseHomePulseLiveResult {
  const liveRuns = useQuery(
    (api as unknown as { domains: { operations: { batchAutopilot: { queries: { getRecentRuns: unknown } } } } })
      .domains.operations.batchAutopilot.queries.getRecentRuns as Parameters<typeof useQuery>[0],
    { limit: 10 } as Parameters<typeof useQuery>[1],
  ) as BatchAutopilotRun[] | undefined;

  if (liveRuns === undefined) return { pulse: [], isLive: false, isLoading: true };
  const completed = (liveRuns ?? []).filter((r) => r.status === "completed" && r.briefMarkdown);
  if (completed.length === 0) return { pulse: [], isLive: false, isLoading: false };

  const cards = completed
    .flatMap((r, i) => [pulseFromRun(r, i), pulseFromRun(r, i + 1)])
    .filter((c): c is PulseCard => c !== null)
    .slice(0, 5);

  if (cards.length === 0) return { pulse: [], isLive: false, isLoading: false };
  return { pulse: cards, isLive: true, isLoading: false };
}
