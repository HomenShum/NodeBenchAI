/**
 * useCorrelations Hook
 *
 * Provides correlation data for narrative threads.
 * Used by NarrativeRoadmap to render cross-thread relationships.
 *
 * @module features/narrative/hooks
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type CorrelationType = "causal" | "temporal" | "entity_overlap" | "topic_similarity";

export interface Correlation {
  _id: Id<"narrativeCorrelations">;
  correlationId: string;
  primaryEventId: Id<"narrativeEvents">;
  primaryThreadId: Id<"narrativeThreads">;
  relatedEventIds: Id<"narrativeEvents">[];
  relatedThreadIds: Id<"narrativeThreads">[];
  correlationType: CorrelationType;
  strength: number;
  description: string;
  weekNumber: string;
}

export interface UseCorrelationsOptions {
  threadId?: Id<"narrativeThreads">;
  threadIds?: Id<"narrativeThreads">[];
  minStrength?: number;
  correlationTypes?: CorrelationType[];
}

export interface UseCorrelationsResult {
  correlations: Correlation[];
  isLoading: boolean;
  byThread: Map<string, Correlation[]>;
  byType: Map<CorrelationType, Correlation[]>;
  getCorrelationsForEvent: (eventId: string) => Correlation[];
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook for fetching and filtering correlation data.
 *
 * Note: This hook uses a placeholder until the query is implemented.
 * The actual query would be: api.domains.narrative.queries.correlations.getCorrelationsForThread
 */
export function useCorrelations(
  options: UseCorrelationsOptions = {}
): UseCorrelationsResult {
  const { threadId, threadIds, minStrength = 0, correlationTypes } = options;

  // For now, we'll return empty results as the query endpoints need to be exposed
  // In production, this would call the Convex query
  const rawCorrelations: Correlation[] = [];

  // Filter by thread(s)
  const filteredByThread = useMemo(() => {
    if (!threadId && !threadIds?.length) return rawCorrelations;

    const targetIds = new Set([
      ...(threadId ? [threadId] : []),
      ...(threadIds || []),
    ].map(String));

    return rawCorrelations.filter(
      (c) =>
        targetIds.has(String(c.primaryThreadId)) ||
        c.relatedThreadIds.some((id) => targetIds.has(String(id)))
    );
  }, [rawCorrelations, threadId, threadIds]);

  // Filter by strength
  const filteredByStrength = useMemo(() => {
    return filteredByThread.filter((c) => c.strength >= minStrength);
  }, [filteredByThread, minStrength]);

  // Filter by correlation type
  const correlations = useMemo(() => {
    if (!correlationTypes?.length) return filteredByStrength;
    const typeSet = new Set(correlationTypes);
    return filteredByStrength.filter((c) => typeSet.has(c.correlationType));
  }, [filteredByStrength, correlationTypes]);

  // Group by thread
  const byThread = useMemo(() => {
    const map = new Map<string, Correlation[]>();

    for (const corr of correlations) {
      // Add to primary thread
      const primaryKey = String(corr.primaryThreadId);
      if (!map.has(primaryKey)) map.set(primaryKey, []);
      map.get(primaryKey)!.push(corr);

      // Add to related threads
      for (const relatedId of corr.relatedThreadIds) {
        const relatedKey = String(relatedId);
        if (!map.has(relatedKey)) map.set(relatedKey, []);
        if (relatedKey !== primaryKey) {
          map.get(relatedKey)!.push(corr);
        }
      }
    }

    return map;
  }, [correlations]);

  // Group by type
  const byType = useMemo(() => {
    const map = new Map<CorrelationType, Correlation[]>();

    for (const corr of correlations) {
      if (!map.has(corr.correlationType)) {
        map.set(corr.correlationType, []);
      }
      map.get(corr.correlationType)!.push(corr);
    }

    return map;
  }, [correlations]);

  // Helper to get correlations for a specific event
  const getCorrelationsForEvent = (eventId: string): Correlation[] => {
    return correlations.filter(
      (c) =>
        String(c.primaryEventId) === eventId ||
        c.relatedEventIds.some((id) => String(id) === eventId)
    );
  };

  return {
    correlations,
    isLoading: false, // Would be true while query is loading
    byThread,
    byType,
    getCorrelationsForEvent,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPORAL FACTS HOOK
// ═══════════════════════════════════════════════════════════════════════════

export interface TemporalFact {
  _id: Id<"temporalFacts">;
  factId: string;
  threadId: Id<"narrativeThreads">;
  claimText: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom: number;
  validTo?: number;
  confidence: number;
  isCurrent: boolean;
}

export interface UseTemporalFactsOptions {
  subject?: string;
  predicate?: string;
  threadId?: Id<"narrativeThreads">;
  includeHistory?: boolean;
}

export interface UseTemporalFactsResult {
  facts: TemporalFact[];
  currentFacts: TemporalFact[];
  history: TemporalFact[];
  isLoading: boolean;
  getFactHistory: (subject: string, predicate: string) => TemporalFact[];
}

/**
 * Hook for fetching temporal facts.
 *
 * Note: This is a placeholder until queries are exposed.
 */
export function useTemporalFacts(
  options: UseTemporalFactsOptions = {}
): UseTemporalFactsResult {
  const facts: TemporalFact[] = [];

  const currentFacts = facts.filter((f) => f.isCurrent);
  const history = facts.filter((f) => !f.isCurrent);

  const getFactHistory = (subject: string, predicate: string): TemporalFact[] => {
    return facts
      .filter((f) => f.subject === subject && f.predicate === predicate)
      .sort((a, b) => a.validFrom - b.validFrom);
  };

  return {
    facts,
    currentFacts,
    history,
    isLoading: false,
    getFactHistory,
  };
}

export default useCorrelations;
