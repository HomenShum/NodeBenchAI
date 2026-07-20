/**
 * useConvexSearch — Convex-native search with HTTP polling fallback.
 *
 * The main app still mounts ConvexReactClient for the wider workspace, but the
 * public ask surface should not depend on websocket sync to become usable.
 * This hook drives search via ConvexHttpClient and polls the session record
 * until the long-running action settles.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../convex/_generated/dataModel";
import { getApi } from "@/lib/convexApi";

export interface ConvexSearchState {
  sessionId: Id<"searchSessions"> | null;
  isSearching: boolean;
  status: string | null;
  trace: Array<{
    step: string;
    tool?: string;
    status: string;
    detail?: string;
    durationMs?: number;
    startedAt: number;
  }>;
  result: Record<string, unknown> | null;
  error: string | null;
}

type SearchApi = {
  startSearch: any;
  getSearchSession: any;
};

const POLL_INTERVAL_MS = 1200;

function selectSearchApi(api: Awaited<ReturnType<typeof getApi>> | null): SearchApi | null {
  const startSearch = api?.domains?.search?.searchPipeline?.startDeepSearch ?? api?.domains?.search?.searchPipeline?.startSearch;
  const getSearchSession = api?.domains?.search?.searchPipeline?.getSearchSession;
  if (startSearch && getSearchSession) {
    return { startSearch, getSearchSession };
  }
  return null;
}

export function useConvexSearch() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
  const [searchApi, setSearchApi] = useState<SearchApi | null>(null);
  const client = useMemo(
    () => (convexUrl ? new ConvexHttpClient(convexUrl) : null),
    [convexUrl],
  );

  const [state, setState] = useState<ConvexSearchState>({
    sessionId: null,
    isSearching: false,
    status: null,
    trace: [],
    result: null,
    error: null,
  });
  const pollGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void getApi()
      .then((api) => {
        if (!cancelled) {
          setSearchApi(selectSearchApi(api));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSearchApi(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAvailable = !!convexUrl;

  useEffect(() => {
    if (!client || !searchApi || !state.sessionId) {
      return undefined;
    }

    const generation = pollGenerationRef.current;
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled || generation !== pollGenerationRef.current) return;

      try {
        const session = await client.query(searchApi.getSearchSession, {
          sessionId: state.sessionId,
        });
        if (cancelled || generation !== pollGenerationRef.current || !session) return;

        const nextStatus = session.status ?? null;
        const nextError = session.error ?? null;
        setState({
          sessionId: state.sessionId,
          isSearching: !["complete", "error"].includes(nextStatus ?? ""),
          status: nextStatus,
          trace: Array.isArray(session.trace) ? session.trace : [],
          result: session.result ? (session.result as Record<string, unknown>) : null,
          error: nextError,
        });

        if (!["complete", "error"].includes(nextStatus ?? "")) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (cancelled || generation !== pollGenerationRef.current) return;
        setState((prev) => ({
          ...prev,
          isSearching: false,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [client, searchApi, state.sessionId]);

  const startSearch = useCallback(
    async (query: string, lens: string) => {
      const resolvedApi = searchApi ?? selectSearchApi(await getApi().catch(() => null));
      if (!resolvedApi) return null;
      const resolvedClient = client ?? (convexUrl ? new ConvexHttpClient(convexUrl) : null);
      if (!resolvedClient) return null;
      pollGenerationRef.current += 1;
      try {
        const sessionId = await resolvedClient.mutation(resolvedApi.startSearch, { query, lens });
        setSearchApi(resolvedApi);
        setState({
          sessionId,
          isSearching: true,
          status: "pending",
          trace: [],
          result: null,
          error: null,
        });
        return sessionId as Id<"searchSessions">;
      } catch (error) {
        console.error("[useConvexSearch] Failed to start:", error);
        setState({
          sessionId: null,
          isSearching: false,
          status: "error",
          trace: [],
          result: null,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [client, convexUrl, searchApi],
  );

  const reset = useCallback(() => {
    pollGenerationRef.current += 1;
    setState({
      sessionId: null,
      isSearching: false,
      status: null,
      trace: [],
      result: null,
      error: null,
    });
  }, []);

  return {
    isAvailable,
    startSearch,
    reset,
    state,
    session: state.sessionId
      ? {
          _id: state.sessionId,
          status: state.status,
          trace: state.trace,
          result: state.result,
          error: state.error,
        }
      : null,
  };
}
