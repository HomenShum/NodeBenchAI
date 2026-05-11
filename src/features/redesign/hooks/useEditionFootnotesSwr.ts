/**
 * useEditionFootnotesSwr — IndexedDB stale-while-revalidate wrapper
 * around `useEditionFootnotes`.  Powers §6 (Sources) of the editorial
 * home.
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - HONEST_STATUS — exposes `swr` metadata so EditorialHomeSurface
 *                    can aggregate the cache-notice chip honestly.
 *  - ERROR_BOUNDARY — IDB failure falls through to live query.
 *  - DETERMINISTIC — `artifactIds` is deduped + sorted in the live
 *                    hook before being sent to Convex, so the cache
 *                    key is stable across re-renders.
 *
 * Pattern: mirrors the wrappers introduced in PR #333.
 */

import {
  useEditionFootnotes,
  type EditionFootnotes,
} from "./useEditionFootnotes";
import {
  useStaleWhileRevalidate,
  type SwrResult,
} from "../../../lib/performance/useStaleWhileRevalidate";

export interface EditionFootnotesSwr {
  data: EditionFootnotes | undefined;
  swr: Omit<SwrResult<EditionFootnotes>, "data">;
}

export function useEditionFootnotesSwr(
  artifactIds: string[],
  industryLimit = 8,
  artifactLimit = 24,
): EditionFootnotesSwr {
  const live = useEditionFootnotes(artifactIds, industryLimit, artifactLimit);
  // Stable key — sorted + deduped — so the cache hit survives across
  // re-renders that produce the same logical id set in different orders.
  const sortedIds = [...new Set(artifactIds)].sort();
  const swr = useStaleWhileRevalidate<EditionFootnotes>(
    "editorial.editionFootnotes",
    { artifactIds: sortedIds, industryLimit, artifactLimit },
    live,
  );
  const { data, ...meta } = swr;
  return { data, swr: meta };
}
