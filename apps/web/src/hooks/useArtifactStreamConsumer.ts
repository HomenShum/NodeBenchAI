// src/hooks/useArtifactStreamConsumer.ts
// Pure consumer hook - hydrates from DB queries, no writes
// This is the client-side component of the artifact streaming architecture

import { useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useArtifactStore } from "./useArtifactStore";
import type { ArtifactCard } from "../../shared/artifacts";

interface UseArtifactStreamConsumerOptions {
  /** Agent thread ID (runId) - stable for entire dossier */
  runId: string | null;
  
  /** Enable debug logging */
  debug?: boolean;
}

interface UseArtifactStreamConsumerResult {
  /** All artifacts for this run */
  artifacts: ArtifactCard[];
  
  /** Number of artifacts */
  count: number;
  
  /** Loading state */
  isLoading: boolean;
  
  /** Error if query failed */
  error?: Error;
}

/**
 * Pure consumer hook for artifact streaming
 * 
 * This hook:
 * 1. Subscribes to getArtifactsByRun query (reactive)
 * 2. Updates local store from query results
 * 3. Does NOT write to DB (server handles persistence)
 * 4. Does NOT parse tool results (server extracts artifacts)
 * 
 * Artifacts appear "live" because:
 * - Server persists artifacts as each tool returns
 * - Convex query subscription pushes updates reactively
 * - Local store dedupes by artifactId
 */
export function useArtifactStreamConsumer({
  runId,
  debug = false,
}: UseArtifactStreamConsumerOptions): UseArtifactStreamConsumerResult {
  const { setRunId, upsertFromQuery, state } = useArtifactStore();
  
  // Query artifacts for this run (reactive - updates as new artifacts are persisted)
  const queryResult = useQuery(
    api.lib.artifactQueries.getArtifactsByRun,
    runId ? { runId } : "skip"
  );
  
  // SET_RUN on runId change (atomic reset)
  useEffect(() => {
    if (runId && runId !== state.runId) {
      setRunId(runId);
    }
  }, [runId, state.runId, setRunId]);
  
  // Sync query results to local store via UPSERT_FROM_QUERY
  // This action includes runId and will be ignored if it doesn't match current state
  useEffect(() => {
    if (!queryResult || !runId) return;
    
    // Map DB records to ArtifactCard format
    const cards: ArtifactCard[] = queryResult.map((record: any) => ({
      id: record.artifactId,
      runId: record.runId,
      canonicalUrl: record.canonicalUrl,
      originalUrl: record.canonicalUrl, // DB doesn't store original, use canonical
      title: record.title,
      snippet: record.snippet,
      thumbnail: record.thumbnail,
      host: record.host || "",
      kind: record.kind,
      provider: record.provider || "web",
      rev: record.rev,
      discoveredAt: record.discoveredAt,
      flags: {
        isPinned: record.flags?.isPinned ?? false,
        isCited: record.flags?.isCited ?? false,
        isHidden: false,
      },
    }));
    
    if (debug) {
    }
    
    // CRITICAL: Pass runId so reducer can ignore stale results from previous runs
    upsertFromQuery(runId, cards);
  }, [queryResult, runId, upsertFromQuery, debug]);
  
  // Return artifacts from local store (already dedupe'd)
  const artifacts = useMemo(() => {
    return state.order
      .map(id => state.byId[id])
      .filter((a): a is ArtifactCard => !!a);
  }, [state.order, state.byId]);
  
  return {
    artifacts,
    count: artifacts.length,
    isLoading: queryResult === undefined,
  };
}

/**
 * Hook to get artifact count (lightweight)
 */
export function useArtifactCount(runId: string | null): number {
  const { state } = useArtifactStore();
  return runId === state.runId ? state.order.length : 0;
}

export default useArtifactStreamConsumer;
