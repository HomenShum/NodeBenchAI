/**
 * Signal Metrics Hooks (Phase 7)
 *
 * React hooks for querying narrativeSignalMetrics data.
 *
 * @module features/narrative/hooks/useSignalMetrics
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Signal domain type
 */
export type SignalDomain = "attention" | "policy" | "labor" | "market" | "sentiment";

/**
 * Signal summary per domain
 */
export interface DomainSignalSummary {
  latest: number | null;
  metricCount: number;
  avgConfidence: number;
}

/**
 * Thread signal summary shape
 */
export interface ThreadSignalSummary {
  threadId: Id<"narrativeThreads">;
  domains: Record<SignalDomain, DomainSignalSummary>;
}

/**
 * Get signal metrics for a specific thread and domain
 */
export function useSignalMetrics(
  threadId: Id<"narrativeThreads"> | undefined,
  domain: SignalDomain,
  limit?: number
) {
  return useQuery(
    api.domains.narrative.queries.signalMetrics.getByThreadAndDomain,
    threadId ? { threadId, domain, limit } : "skip"
  );
}

/**
 * Get all metrics for a domain (cross-thread dashboard)
 */
export function useSignalMetricsByDomain(domain: SignalDomain, limit?: number) {
  return useQuery(
    api.domains.narrative.queries.signalMetrics.getByDomain,
    { domain, limit }
  );
}

/**
 * Get signal summary across all domains for a thread
 */
export function useThreadSignalSummary(threadId: Id<"narrativeThreads"> | undefined) {
  return useQuery(
    api.domains.narrative.queries.signalMetrics.getThreadSignalSummary,
    threadId ? { threadId } : "skip"
  );
}
