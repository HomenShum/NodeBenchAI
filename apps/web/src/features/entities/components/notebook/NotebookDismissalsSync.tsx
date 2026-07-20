/**
 * NotebookDismissalsSync — isolates the persisted-dismissals Convex query
 * so a server-side failure (e.g. schema drift between local code and a
 * not-yet-deployed backend) can't bring down the Live notebook.
 *
 * Why this exists:
 *   Convex's `useQuery` throws synchronously during render when the server
 *   returns an error. Any parent render tree touching the throwing hook
 *   gets unmounted by the nearest ErrorBoundary. Previously, the dismissals
 *   query lived inside `EntityNotebookLive` itself, so a single Convex
 *   server error on `decorationPreferences:listDismissedForEntity` crashed
 *   the ENTIRE notebook with "Live notebook failed to load".
 *
 *   By isolating the query into a leaf component wrapped in its own local
 *   ErrorBoundary at the call site, errors here become "no persisted
 *   dismissals" (empty set) instead of a whole-notebook crash. Agentic
 *   reliability rule ERROR_BOUNDARY: fine-grained async boundaries around
 *   every network-dependent surface.
 */

import { memo, useEffect } from "react";
import { useQuery } from "convex/react";

import { useConvexApi } from "@/lib/convexApi";

type Props = {
  entitySlug: string;
  anonymousSessionId?: string;
  /** Called with the latest dismissal keys (`${runId}::${blockType}`). */
  onKeysChange: (keys: Set<string>) => void;
};

function NotebookDismissalsSyncBase({
  entitySlug,
  anonymousSessionId,
  onKeysChange,
}: Props) {
  const api = useConvexApi();
  const queryRef = api?.domains?.agents?.decorationPreferences?.listDismissedForEntity;

  const persisted = useQuery(
    (queryRef ?? ("skip" as never)) as never,
    queryRef ? ({ entitySlug, anonymousSessionId } as never) : ("skip" as never),
  ) as ReadonlyArray<{ scratchpadRunId: string; blockType: string }> | undefined;

  useEffect(() => {
    if (!persisted) return;
    const keys = new Set<string>();
    for (const row of persisted) {
      keys.add(`${row.scratchpadRunId}::${row.blockType}`);
    }
    onKeysChange(keys);
  }, [persisted, onKeysChange]);

  return null;
}

export const NotebookDismissalsSync = memo(NotebookDismissalsSyncBase);
export default NotebookDismissalsSync;
