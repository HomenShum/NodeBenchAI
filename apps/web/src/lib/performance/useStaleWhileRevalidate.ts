/**
 * useStaleWhileRevalidate — React hook that hydrates from the IDB
 * cache on mount, then swaps to live Convex data when it resolves.
 *
 * Caller pattern:
 *   const live = useQuery(api.foo.bar, args);
 *   const swr  = useStaleWhileRevalidate("foo.bar", args, live);
 *   // swr.data is cached value first paint, live value after revalidate
 *
 * Per `.claude/rules/agentic_reliability.md`:
 *  - HONEST_STATUS — exposes `isStale`, `hydratedFromCache`, `isLive`,
 *                    `ageMs` so the UI never silently shows old data
 *  - ERROR_BOUNDARY — cache failures fall through; the hook always
 *                    returns the live value once it resolves
 *
 * Per `.claude/rules/reexamine_performance.md`:
 *  - Hydration runs once per (queryId, argsKey).  Stable args via
 *    deterministic JSON ensure the key never thrashes.
 */

import { useEffect, useRef, useState } from "react";
import {
  getFromCache,
  makeCacheKey,
  setInCache,
  stableStringify,
} from "./idbSwrCache";

export interface SwrResult<T> {
  /**
   * The data to render.  Cached value first paint, live value once
   * Convex resolves.  `undefined` only on cold first visit before
   * either cache hydrate or live query completes.
   */
  data: T | undefined;
  /** True when the displayed value came from disk, not Convex. */
  hydratedFromCache: boolean;
  /** True after the Convex query has resolved this session. */
  isLive: boolean;
  /**
   * True when the displayed value is from cache AND older than the
   * `staleThresholdMs` budget (default 12h).
   */
  isStale: boolean;
  /** ms since the cache was written, or null when no cache hit. */
  ageMs: number | null;
}

export interface SwrOptions {
  /**
   * Age above which a cache hit is flagged as stale.  Default: 12h.
   * The hook does NOT refuse to serve stale data — it just flags it
   * so the UI can render an honest "may be stale" notice.
   */
  staleThresholdMs?: number;
}

const DEFAULT_STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export function useStaleWhileRevalidate<T>(
  queryId: string,
  args: unknown,
  liveData: T | undefined,
  opts: SwrOptions = {},
): SwrResult<T> {
  const staleThresholdMs =
    opts.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

  // Stable key for this hook instance.  Recomputed only when the
  // stringified args change (sorted-key serialization).
  const argsKey = stableStringify(args ?? null);
  const cacheKey = `${queryId}::${argsKey}`;
  // Memoized via ref so we don't redo the work on every render.
  const lastKeyRef = useRef<string | null>(null);

  const [cached, setCached] = useState<{
    data: T;
    cachedAt: number;
  } | null>(null);
  const [hydrationDone, setHydrationDone] = useState(false);

  // Track whether we've already written this resolution to the cache
  // (avoid noisy re-writes on every reactive re-render).
  const writtenForKeyRef = useRef<string | null>(null);

  // Hydration effect — runs once per (queryId, argsKey).
  useEffect(() => {
    if (lastKeyRef.current === cacheKey) return;
    lastKeyRef.current = cacheKey;
    setCached(null);
    setHydrationDone(false);
    writtenForKeyRef.current = null;

    let cancelled = false;
    getFromCache<T>(cacheKey)
      .then((hit) => {
        if (cancelled) return;
        if (hit) {
          setCached({ data: hit.data, cachedAt: hit.cachedAt });
        }
      })
      .catch(() => {
        /* swallow */
      })
      .finally(() => {
        if (!cancelled) setHydrationDone(true);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  // Revalidation write effect — when live data arrives, persist it.
  // Per `agentic_reliability.md`, this is a side-effect that must not
  // affect the rendered output even if it fails.
  useEffect(() => {
    if (liveData === undefined) return;
    if (writtenForKeyRef.current === cacheKey) return;
    writtenForKeyRef.current = cacheKey;
    void setInCache(cacheKey, liveData).catch(() => {
      /* swallow — agentic_reliability.md ERROR_BOUNDARY */
    });
  }, [liveData, cacheKey]);

  // Resolve the public shape.
  if (liveData !== undefined) {
    return {
      data: liveData,
      hydratedFromCache: false,
      isLive: true,
      isStale: false,
      ageMs: 0,
    };
  }

  if (cached) {
    const ageMs = Date.now() - cached.cachedAt;
    return {
      data: cached.data,
      hydratedFromCache: true,
      isLive: false,
      isStale: ageMs > staleThresholdMs,
      ageMs,
    };
  }

  // Cold path — neither cache nor live data yet.
  // `hydrationDone` is referenced to ensure React tracks the state
  // change; callers rely on `data === undefined` for the skeleton.
  void hydrationDone;
  return {
    data: undefined,
    hydratedFromCache: false,
    isLive: false,
    isStale: false,
    ageMs: null,
  };
}

/** Re-export so call sites don't need to import the cache module directly. */
export { makeCacheKey };
