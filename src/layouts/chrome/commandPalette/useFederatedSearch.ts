/**
 * useFederatedSearch — debounced consumer of the Convex federatedSearch action.
 *
 * Pattern: AbortController-style cancellation via stale-request rejection.
 * The hook tracks an internal request id; only the latest in-flight request
 * is allowed to update state. This avoids tearing when the user types quickly.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND: only one in-flight request mutates state at a time
 *   - HONEST_STATUS: errors return { error } — never silently rendered as 0
 *   - TIMEOUT: client-side abort at CLIENT_TIMEOUT_MS (server is 3 s, buffer 0.5 s)
 *   - DETERMINISTIC: same query + same data → same response order (server side)
 *
 * Returns:
 *   - data: FederatedSearchResponse | null
 *   - isLoading: boolean (true while a request is in flight for the current query)
 *   - error: Error | null (set when the latest request fails)
 *
 * Empty / whitespace queries short-circuit to { data: null, isLoading: false }.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import {
  CLIENT_TIMEOUT_MS,
  SEARCH_DEBOUNCE_MS,
  type FederatedSearchResponse,
} from "./types";

interface UseFederatedSearchResult {
  data: FederatedSearchResponse | null;
  isLoading: boolean;
  error: Error | null;
}

export function useFederatedSearch(query: string): UseFederatedSearchResult {
  // Type the action loosely — the codegen path may not exist on first build,
  // but the runtime resolves once federatedSearch.ts is deployed. The shape
  // is asserted by the explicit return type cast below.
  const federatedSearch = useAction(
    (api as any).domains.search.federatedSearch.federatedSearch,
  );

  const [data, setData] = useState<FederatedSearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Monotonic request id — every fire bumps it. Only the latest may write state.
  const requestIdRef = useRef(0);

  const fire = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      const myId = ++requestIdRef.current;

      // Empty query — clear state and return early. Don't make a network round-trip.
      if (!trimmed) {
        setData(null);
        setIsLoading(false);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      // Client-side timeout race. The server has its own 3 s budget; this is
      // belt-and-suspenders for hung connections.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("client_timeout"));
        }, CLIENT_TIMEOUT_MS);
      });

      try {
        const response = (await Promise.race([
          federatedSearch({
            q: trimmed,
            anonymousSessionId: getAnonymousProductSessionId(),
          }),
          timeoutPromise,
        ])) as FederatedSearchResponse;

        // Stale check — newer request started after this one. Drop the result.
        if (myId !== requestIdRef.current) return;
        setData(response);
        setIsLoading(false);
      } catch (err) {
        if (myId !== requestIdRef.current) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setIsLoading(false);
        // Keep stale data visible alongside the error so users see "the
        // last good result" rather than a blank pane during transient failures.
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    [federatedSearch],
  );

  // Debounce — wait SEARCH_DEBOUNCE_MS after the latest keystroke before firing.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // Cancel pending request and clear state immediately.
      requestIdRef.current += 1;
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const handle = setTimeout(() => {
      void fire(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query, fire]);

  return { data, isLoading, error };
}
