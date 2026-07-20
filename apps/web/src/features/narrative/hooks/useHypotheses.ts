/**
 * Hypothesis Hooks (Phase 7)
 *
 * React hooks for querying narrativeHypotheses data.
 *
 * @module features/narrative/hooks/useHypotheses
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Hypothesis status type
 */
export type HypothesisStatus = "active" | "supported" | "weakened" | "inconclusive" | "retired";

/**
 * Hypothesis scorecard shape returned by the query
 */
export interface HypothesisScorecard {
  threadId: Id<"narrativeThreads">;
  threadName: string;
  thesis: string;
  counterThesis?: string;
  totalHypotheses: number;
  byStatus: Record<HypothesisStatus, number>;
  byRisk: Record<"grounded" | "mixed" | "speculative", number>;
  hypotheses: Array<{
    _id: Id<"narrativeHypotheses">;
    label: string;
    title: string;
    status: HypothesisStatus;
    confidence: number;
    speculativeRisk: "grounded" | "mixed" | "speculative";
    supportingEvidenceCount: number;
    contradictingEvidenceCount: number;
    falsificationCriteria?: string;
  }>;
}

/**
 * Get all hypotheses for a thread
 */
export function useHypotheses(
  threadId: Id<"narrativeThreads"> | undefined,
  status?: HypothesisStatus
) {
  return useQuery(
    api.domains.narrative.queries.hypotheses.getByThread,
    threadId ? { threadId, status } : "skip"
  );
}

/**
 * Get a single hypothesis by doc ID
 */
export function useHypothesis(hypothesisDocId: Id<"narrativeHypotheses"> | undefined) {
  return useQuery(
    api.domains.narrative.queries.hypotheses.getById,
    hypothesisDocId ? { hypothesisDocId } : "skip"
  );
}

/**
 * Get hypothesis scorecard (summary view) for a thread
 */
export function useHypothesisScorecard(threadId: Id<"narrativeThreads"> | undefined) {
  return useQuery(
    api.domains.narrative.queries.hypotheses.getThreadScorecard,
    threadId ? { threadId } : "skip"
  );
}
