/**
 * useNarrativeThreads Hook
 *
 * Fetches and manages narrative threads for the current user.
 *
 * @module features/narrative/hooks/useNarrativeThreads
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { NarrativeThread } from "../types";

export interface UseNarrativeThreadsOptions {
  /** Filter by entity key */
  entityKey?: string;
  /** Include public threads */
  includePublic?: boolean;
  /** Limit number of threads */
  limit?: number;
}

export interface UseNarrativeThreadsResult {
  threads: NarrativeThread[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch user's narrative threads
 */
export function useNarrativeThreads(
  options: UseNarrativeThreadsOptions = {}
): UseNarrativeThreadsResult {
  const { entityKey, includePublic = false, limit = 20 } = options;

  // Fetch user's threads
  const myThreads = useQuery(
    api.domains.narrative.queries.threads.getMyThreads,
    { limit }
  );

  // Optionally fetch public threads
  const publicThreads = useQuery(
    api.domains.narrative.queries.threads.getPublicThreads,
    includePublic ? { limit } : "skip"
  );

  // Fetch threads by entity if specified
  const entityThreads = useQuery(
    api.domains.narrative.queries.threads.getThreadsByEntity,
    entityKey ? { entityKey } : "skip"
  );

  // Determine loading state
  const isLoading =
    myThreads === undefined ||
    (includePublic && publicThreads === undefined) ||
    (entityKey && entityThreads === undefined);

  // Combine and deduplicate threads
  let threads: NarrativeThread[] = [];

  if (entityKey && entityThreads) {
    threads = entityThreads as NarrativeThread[];
  } else {
    const myList = (myThreads || []) as NarrativeThread[];
    const publicList = includePublic ? ((publicThreads || []) as NarrativeThread[]) : [];

    // Deduplicate by _id
    const seen = new Set<string>();
    for (const thread of [...myList, ...publicList]) {
      if (!seen.has(thread._id)) {
        seen.add(thread._id);
        threads.push(thread);
      }
    }
  }

  // Sort by latest activity
  threads.sort((a, b) => b.latestEventAt - a.latestEventAt);

  return {
    threads: threads.slice(0, limit),
    isLoading,
    error: null,
  };
}

/**
 * Hook to fetch a single thread by ID or slug
 */
export function useNarrativeThread(
  idOrSlug: string | undefined
): { thread: NarrativeThread | null; isLoading: boolean } {
  // Try fetching by slug first (more common for URLs)
  const bySlug = useQuery(
    api.domains.narrative.queries.threads.getThreadBySlug,
    idOrSlug ? { slug: idOrSlug } : "skip"
  );

  const isLoading = idOrSlug !== undefined && bySlug === undefined;

  return {
    thread: bySlug as NarrativeThread | null,
    isLoading,
  };
}

export default useNarrativeThreads;
