import { useCallback, useMemo } from "react";
import { useMutation } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import type { CaptureRoute } from "@/features/product/lib/captureRouter";
import {
  buildLiveCaptureArgs,
  resolveEventWorkspaceIdFromContext,
  shouldPersistRouteToEventWorkspace,
} from "@/features/workspace/lib/eventWorkspacePersistence";

const eventWorkspaceApi = (api as any).domains.product.eventWorkspace;

export type EventCaptureRecordInput = {
  text: string;
  route: CaptureRoute;
  activeContextLabel?: string | null;
  workspaceId?: string;
  kind?: "text" | "voice" | "image" | "screenshot" | "file";
};

export function useEventCaptureRecorder(): {
  anonymousSessionId: string;
  recordIfEventCapture: (input: EventCaptureRecordInput) => Promise<boolean>;
} {
  const anonymousSessionId = useMemo(() => getAnonymousProductSessionId(), []);
  const recordCaptureMutation = useMutation(eventWorkspaceApi.recordCapture);

  const recordIfEventCapture = useCallback(
    async (input: EventCaptureRecordInput) => {
      const trimmed = input.text.trim();
      if (!trimmed || !shouldPersistRouteToEventWorkspace(input.route)) return false;

      const workspaceId =
        input.workspaceId?.trim() ||
        resolveEventWorkspaceIdFromContext(input.activeContextLabel);

      await recordCaptureMutation({
        anonymousSessionId,
        ...buildLiveCaptureArgs({
          workspaceId,
          input: trimmed,
          route: input.route,
          kind: input.kind,
        }),
      });
      return true;
    },
    [anonymousSessionId, recordCaptureMutation],
  );

  return { anonymousSessionId, recordIfEventCapture };
}
