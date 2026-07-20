import { useCallback, useEffect, useMemo, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { useConvex } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { inferCaptureRoute } from "@/features/product/lib/captureRouter";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import {
  buildLiveCaptureArgs,
  emptyMemorySnapshot,
  mapLiveSnapshotToMemory,
  type EventWorkspaceMemorySnapshot,
} from "@/features/workspace/lib/eventWorkspacePersistence";

const eventWorkspaceApi = (api as any).domains.product.eventWorkspace;

export function useEventWorkspacePersistence(workspaceId: string): {
  anonymousSessionId: string;
  memory: EventWorkspaceMemorySnapshot;
  recordCapture: (input: string) => Promise<void>;
} {
  const anonymousSessionId = useMemo(() => getAnonymousProductSessionId(), []);
  const convex = useConvex();
  const httpClient = useMemo(() => {
    const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
    return convexUrl ? new ConvexHttpClient(convexUrl) : null;
  }, []);
  const [snapshotState, setSnapshotState] = useState<
    | { liveAvailable: true; snapshot: any | null }
    | { liveAvailable: false; snapshot: null }
    | null
    | undefined
  >(undefined);
  const fetchSnapshot = useCallback(
    async () => {
      const args = {
        anonymousSessionId,
        workspaceId,
      };
      if (httpClient) {
        return httpClient.query(eventWorkspaceApi.getSnapshot, args);
      }
      return convex.query(eventWorkspaceApi.getSnapshot, args);
    },
    [anonymousSessionId, convex, httpClient, workspaceId],
  );

  useEffect(() => {
    let active = true;
    setSnapshotState(undefined);
    void fetchSnapshot()
      .then((result) => {
        if (active) setSnapshotState({ liveAvailable: true, snapshot: result });
      })
      .catch((error) => {
        if (active) setSnapshotState({ liveAvailable: false, snapshot: null });
        console.warn("[workspace] live event workspace snapshot unavailable", error);
      });

    return () => {
      active = false;
    };
  }, [fetchSnapshot]);

  const recordCapture = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      const captureArgs = {
        anonymousSessionId,
        ...buildLiveCaptureArgs({
          workspaceId,
          input: trimmed,
          route: inferCaptureRoute({
            text: trimmed,
            files: [],
            mode: "ask",
            activeContextLabel: "Ship Demo Day",
          }),
        }),
      };
      if (httpClient) {
        await httpClient.mutation(eventWorkspaceApi.recordCapture, captureArgs);
      } else {
        await convex.mutation(eventWorkspaceApi.recordCapture, captureArgs);
      }
      const nextSnapshot = await fetchSnapshot();
      setSnapshotState({ liveAvailable: true, snapshot: nextSnapshot });
    },
    [anonymousSessionId, convex, fetchSnapshot, httpClient, workspaceId],
  );

  return {
    anonymousSessionId,
    memory:
      !snapshotState
        ? emptyMemorySnapshot()
        : mapLiveSnapshotToMemory(snapshotState.snapshot),
    recordCapture,
  };
}
