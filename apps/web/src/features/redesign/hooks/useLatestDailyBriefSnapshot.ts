/**
 * useLatestDailyBriefSnapshot — wraps
 * `domains.research.editionQueries.getLatestDailyBriefSnapshot`.
 * Returns `undefined` while loading and `null` if no snapshot exists.
 */

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export interface KeyStat {
  label?: string;
  name?: string;
  value?: string | number;
  delta?: string | number;
  trend?: "up" | "down" | "flat";
}

export interface CapabilityEntry {
  name?: string;
  label?: string;
  level?: string;
  description?: string;
}

export interface DashboardMetrics {
  meta: { currentDate: string; timelineProgress: number };
  charts: { trendLine: unknown; marketShare: unknown[] };
  techReadiness: { existing: number; emerging: number; sciFi: number };
  keyStats: KeyStat[];
  capabilities: CapabilityEntry[];
  annotations?: unknown[];
  agentCount?: { count: number; label: string; speed: number };
  entityGraph?: unknown;
}

export interface LatestSnapshot {
  _id: string;
  dateString: string;
  generatedAt: number;
  version: number;
  dashboardMetrics: DashboardMetrics;
  sourceSummary: { totalItems: number; topTrending: string[] };
}

export function useLatestDailyBriefSnapshot(): LatestSnapshot | null | undefined {
  const data = useQuery(
    api.domains.research.editionQueries.getLatestDailyBriefSnapshot,
    {},
  );
  return data as LatestSnapshot | null | undefined;
}
