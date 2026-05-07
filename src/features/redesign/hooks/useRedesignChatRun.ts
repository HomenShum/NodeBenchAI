/**
 * Phase 1 hook for the production-fidelity chat.
 *
 * Calls the new Convex action `convex/domains/redesign/chatRuns.runChat`
 * which runs Gemini 3.1 Flash with web-search grounding and returns an
 * AnswerPacket-shaped response with REAL source URLs.
 *
 * Authenticated users get the real run; unauthenticated users (and
 * `?fresh=1` showcase mode) keep the existing fixture path. The
 * authentication state is owned by the caller (ChatSurface) and passed
 * through `enabled`.
 *
 * Phase 2 will swap this for an SSE/streaming variant. Phase 3 adds the
 * /r/{hash} reproducibility URL route.
 */
import { useState, useCallback } from "react";
import { useAction, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { ChatAnswer } from "../fixtures";
import type { RouterTier } from "../components/UniversalComposer";

export interface RealChatRun {
  runId: string;
  hash: string;
  packet: ChatAnswer;
  totalLatencyMs: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ChatRunState {
  status: "idle" | "thinking" | "ok" | "error";
  run: RealChatRun | null;
  error: string | null;
  /** Whether the current user can run real chat (authenticated). */
  available: boolean;
}

export function useRedesignChatRun() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const runChatAction = useAction(api.domains.redesign.chatRuns.runChat);
  const [status, setStatus] = useState<ChatRunState["status"]>("idle");
  const [run, setRun] = useState<RealChatRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (prompt: string, tier: RouterTier, contextRef?: string): Promise<RealChatRun | null> => {
      if (!isAuthenticated) {
        setError("Sign in to run a real chat with grounded sources.");
        setStatus("error");
        return null;
      }
      setStatus("thinking");
      setError(null);
      try {
        const result = await runChatAction({
          prompt,
          tier,
          contextRef,
        });
        const real: RealChatRun = {
          runId: result.runId,
          hash: result.hash,
          packet: {
            shortAnswer: result.shortAnswer,
            whyItMatters: result.whyItMatters,
            evidence: result.evidence,
            risks: result.risks,
            nextAction: result.nextAction,
            sourceCount: result.sourceCount,
            paidCalls: result.paidCalls,
            fromMemory: result.fromMemory,
            trace: result.trace,
          } as ChatAnswer,
          totalLatencyMs: result.totalLatencyMs,
          totalTokens: result.totalTokens,
          estimatedCostUsd: result.estimatedCostUsd,
        };
        setRun(real);
        setStatus("ok");
        return real;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        setError(msg.slice(0, 280));
        setStatus("error");
        return null;
      }
    },
    [isAuthenticated, runChatAction],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setRun(null);
    setError(null);
  }, []);

  return {
    state: { status, run, error, available: !authLoading && isAuthenticated } as ChatRunState,
    submit,
    reset,
  };
}
