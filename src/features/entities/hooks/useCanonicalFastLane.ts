import { useCallback, useState } from "react";
import { useAction } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";

export type FastLaneState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; answer: string; modelId?: string; latencyMs: number }
  | { status: "error"; error: string };

/**
 * useCanonicalFastLane — frontend hook for the OpenRouter fast lane.
 *
 * On-the-go flow:
 *   const { send, state } = useCanonicalFastLane();
 *   send({ entitySlug: "acme", userMessage: "what's the latest?" });
 *
 * Fast lane answers from cached entity state in 1–3s.
 * Slow lane returns a runId for background subscription.
 */
export function useCanonicalFastLane() {
  const api = useConvexApi();
  const runFastLane = useAction(
    api?.domains.agents.canonicalPlanner.runFastLane ?? ("skip" as any),
  );
  const anonymousSessionId = getAnonymousProductSessionId();

  const [state, setState] = useState<FastLaneState>({ status: "idle" });

  const send = useCallback(
    async (args: {
      entitySlug: string;
      userMessage: string;
      threadId?: string;
      forceMode?: "fast" | "slow";
    }) => {
      if (!api?.domains.agents.canonicalPlanner.runFastLane) {
        setState({ status: "error", error: "Fast lane not available" });
        return;
      }

      setState({ status: "loading" });
      try {
        const result = await runFastLane({
          anonymousSessionId,
          entitySlug: args.entitySlug,
          userMessage: args.userMessage,
          threadId: args.threadId,
          forceMode: args.forceMode,
        });

        if (result.mode === "fast" && result.answer) {
          setState({
            status: "success",
            answer: result.answer,
            modelId: result.modelId,
            latencyMs: result.latencyMs,
          });
        } else if (result.mode === "slow" && result.runId) {
          setState({
            status: "success",
            answer: `Deep analysis started (run ${result.runId}). Results will appear in the notebook.`,
            latencyMs: result.latencyMs,
          });
        } else {
          setState({
            status: "success",
            answer: "No answer returned.",
            latencyMs: result.latencyMs,
          });
        }
      } catch (err) {
        setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [runFastLane, anonymousSessionId, api],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { send, reset, state };
}
