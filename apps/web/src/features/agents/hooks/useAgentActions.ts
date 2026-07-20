/**
 * useAgentActions — the seam between inline notebook AI and the
 * side-panel agent drawer.
 *
 * Every "something happened in the notebook that the agent should
 * know about" moment goes through this hook:
 *   - user accepted an inline suggestion → log action + drawer sees it
 *   - user dismissed a suggestion → persist to Convex + log action
 *   - user clicked "Ask NodeBench" on a decoration → open drawer with
 *     context + log the ask
 *
 * The hook wraps `FastAgentContext` (drawer control) + the new Convex
 * `agentActions` and `decorationPreferences` mutations so callers get
 * one clean API. Inline renderers and the notebook shell should only
 * touch these functions — NOT FastAgentContext directly — so that when
 * the unified `AgentProvider` lands, swapping the impl is one file.
 *
 * Pattern: composable hook, not a context. Context was overkill for
 * this surface because the callers (EntityNotebookLive, future drawer
 * actions) already live inside FastAgentContext's tree.
 */

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import type { DiligenceDecorationData } from "@/features/entities/components/notebook/DiligenceDecorationPlugin";

/** Metadata the drawer can display when opened from a decoration. */
export interface DecorationContext {
  entitySlug: string;
  scratchpadRunId: string;
  blockType: DiligenceDecorationData["blockType"];
  overallTier: DiligenceDecorationData["overallTier"];
  headerText: string;
  bodyProse?: string;
  sourceCount?: number;
  sourceRefIds?: string[];
}

/** Stable shape returned so callers can destructure once. */
export interface AgentActionsApi {
  /**
   * Open the drawer pre-loaded with a decoration as context. Also logs
   * a `decoration_asked_about` action so the drawer (and telemetry)
   * can see the escalation.
   */
  askAboutDecoration: (ctx: DecorationContext, anonymousSessionId?: string) => void;
  /**
   * Log that the user accepted a decoration inline. Called in addition
   * to the existing `acceptDecorationIntoNotebook` flow; this one is
   * about making the accept visible to the drawer's history.
   */
  logAcceptDecoration: (ctx: DecorationContext, anonymousSessionId?: string) => void;
  /**
   * Persist a dismissal to Convex (so it sticks across refresh) and
   * log the action.
   */
  dismissDecoration: (ctx: DecorationContext, anonymousSessionId?: string) => Promise<void>;
  /** Undo a dismissal (UI-only; no log — dismiss/undismiss are symmetric). */
  undismissDecoration: (ctx: DecorationContext, anonymousSessionId?: string) => Promise<void>;
  /** Log a refresh-requested. The actual refresh mutation is separate. */
  logRefreshDecoration: (ctx: DecorationContext, anonymousSessionId?: string) => void;
}

/**
 * Build a human-readable summary of a decoration for the action log.
 * Kept short (under 120 chars) so a row of summaries reads as a list,
 * not paragraphs.
 */
function summarizeDecoration(
  verb: "Accepted" | "Dismissed" | "Refreshed" | "Asked about",
  ctx: DecorationContext,
): string {
  const tierLabel = ctx.overallTier === "verified" ? "✓ verified" : ctx.overallTier;
  const header = ctx.headerText.length > 60 ? ctx.headerText.slice(0, 57) + "…" : ctx.headerText;
  return `${verb} ${ctx.blockType} (${tierLabel}) — ${header}`;
}

/**
 * Build the drawer's seed message when opening from a decoration.
 * Crafted as a question the agent can answer well, citing back to
 * the decoration's own evidence. Keeps the user in flow.
 */
function buildAskMessage(ctx: DecorationContext): string {
  const tierNote =
    ctx.overallTier === "verified"
      ? "This is marked verified;"
      : ctx.overallTier === "corroborated"
        ? "This is marked corroborated;"
        : "This has limited evidence;";
  const sourceNote =
    ctx.sourceCount && ctx.sourceCount > 0
      ? ` It cites ${ctx.sourceCount} source${ctx.sourceCount === 1 ? "" : "s"}.`
      : "";
  return `Tell me more about this ${ctx.blockType} finding on ${ctx.entitySlug}: "${ctx.headerText}". ${tierNote}${sourceNote} What should I know that the summary doesn't show?`;
}

export function useAgentActions(): AgentActionsApi {
  const api = useConvexApi();
  const { openWithContext } = useFastAgent();

  // Mutations — null-safe via dummy stub when api isn't ready yet.
  const logActionMutation = useMutation(
    api?.domains?.agents?.agentActions?.log ?? (("skip" as unknown) as never),
  );
  const dismissDecorationMutation = useMutation(
    api?.domains?.agents?.decorationPreferences?.dismiss ?? (("skip" as unknown) as never),
  );
  const undismissDecorationMutation = useMutation(
    api?.domains?.agents?.decorationPreferences?.undismiss ?? (("skip" as unknown) as never),
  );
  // M1-thick canonical writers. These dual-write into the agent
  // thread log so the drawer/chat page can read a unified history
  // once they switch their reads over. See `unified.ts`.
  const appendCanonicalMessage = useMutation(
    api?.domains?.agents?.unified?.appendMessage ?? (("skip" as unknown) as never),
  );

  const safeLogAction = useCallback(
    (args: {
      surfaceOrigin: "inline" | "drawer" | "chat";
      kind:
        | "decoration_accepted"
        | "decoration_dismissed"
        | "decoration_refreshed"
        | "decoration_asked_about";
      summary: string;
      entitySlug?: string;
      scratchpadRunId?: string;
      anonymousSessionId?: string;
      payload?: Record<string, unknown>;
    }) => {
      if (!api) return;
      // Fire-and-forget; a failed log should never block the UI action.
      // Per agentic_reliability HONEST_STATUS: we surface the error to
      // console but don't throw, so the accept/dismiss/refresh proceed.
      // Wrapped in Promise.resolve so test mocks that return undefined
      // (from vi.fn()) don't crash the caller — the real runtime always
      // returns a Promise from useMutation, but test stubs don't.
      void Promise.resolve(logActionMutation(args)).catch((err) => {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[useAgentActions] logAction failed:", err);
        }
      });
    },
    [api, logActionMutation],
  );

  /**
   * Build a deterministic canonical thread id from the decoration
   * identity so repeated Asks on the same decoration land in the
   * same thread — users continuing a conversation they started
   * earlier see full history. Format: `dec::{entity}::{runId}`.
   * Collision-safe because scratchpadRunId is globally unique per
   * decoration.
   */
  const threadIdForDecoration = useCallback(
    (ctx: DecorationContext) => `dec::${ctx.entitySlug}::${ctx.scratchpadRunId}`,
    [],
  );

  const askAboutDecoration = useCallback<AgentActionsApi["askAboutDecoration"]>(
    (ctx, anonymousSessionId) => {
      const threadId = threadIdForDecoration(ctx);
      // 1) Open drawer with the decoration as context.
      openWithContext({
        initialTab: "chat",
        initialMessage: buildAskMessage(ctx),
        contextTitle: `${ctx.blockType} · ${ctx.entitySlug}`,
        contextEntitySlug: ctx.entitySlug,
        // Pass source IDs through contextDocumentIds so the drawer's
        // context-bundle path can pull their bodies into the agent.
        contextDocumentIds: ctx.sourceRefIds ?? [],
      });
      // 2) Log the ask so the drawer's activity timeline shows it.
      safeLogAction({
        surfaceOrigin: "inline",
        kind: "decoration_asked_about",
        summary: summarizeDecoration("Asked about", ctx),
        entitySlug: ctx.entitySlug,
        scratchpadRunId: ctx.scratchpadRunId,
        anonymousSessionId,
        payload: { blockType: ctx.blockType, overallTier: ctx.overallTier, threadId },
      });
      // 3) Shadow-write a canonical user-role turn so the unified
      // thread view sees the inline escalation as the first message.
      // Fire-and-forget; failure must not block the UX.
      if (api) {
        void Promise.resolve(
          appendCanonicalMessage({
            anonymousSessionId,
            threadId,
            role: "user",
            content: buildAskMessage(ctx),
            surfaceOrigin: "inline",
          }),
        ).catch((err) => {
          if (typeof console !== "undefined") {
            console.warn("[useAgentActions] canonical appendMessage failed:", err);
          }
        });
      }
    },
    [api, appendCanonicalMessage, openWithContext, safeLogAction, threadIdForDecoration],
  );

  const logAcceptDecoration = useCallback<AgentActionsApi["logAcceptDecoration"]>(
    (ctx, anonymousSessionId) => {
      safeLogAction({
        surfaceOrigin: "inline",
        kind: "decoration_accepted",
        summary: summarizeDecoration("Accepted", ctx),
        entitySlug: ctx.entitySlug,
        scratchpadRunId: ctx.scratchpadRunId,
        anonymousSessionId,
        payload: { blockType: ctx.blockType, overallTier: ctx.overallTier },
      });
    },
    [safeLogAction],
  );

  const logRefreshDecoration = useCallback<AgentActionsApi["logRefreshDecoration"]>(
    (ctx, anonymousSessionId) => {
      safeLogAction({
        surfaceOrigin: "inline",
        kind: "decoration_refreshed",
        summary: summarizeDecoration("Refreshed", ctx),
        entitySlug: ctx.entitySlug,
        scratchpadRunId: ctx.scratchpadRunId,
        anonymousSessionId,
      });
    },
    [safeLogAction],
  );

  const dismissDecoration = useCallback<AgentActionsApi["dismissDecoration"]>(
    async (ctx, anonymousSessionId) => {
      if (!api) return;
      try {
        await dismissDecorationMutation({
          anonymousSessionId,
          entitySlug: ctx.entitySlug,
          scratchpadRunId: ctx.scratchpadRunId,
          blockType: ctx.blockType,
        });
        safeLogAction({
          surfaceOrigin: "inline",
          kind: "decoration_dismissed",
          summary: summarizeDecoration("Dismissed", ctx),
          entitySlug: ctx.entitySlug,
          scratchpadRunId: ctx.scratchpadRunId,
          anonymousSessionId,
        });
      } catch (err) {
        // Persistence failure is user-visible — the decoration will
        // reappear on refresh. Log loudly.
        if (typeof console !== "undefined") {
          console.error("[useAgentActions] dismissDecoration persist failed:", err);
        }
      }
    },
    [api, dismissDecorationMutation, safeLogAction],
  );

  const undismissDecoration = useCallback<AgentActionsApi["undismissDecoration"]>(
    async (ctx, anonymousSessionId) => {
      if (!api) return;
      try {
        await undismissDecorationMutation({
          anonymousSessionId,
          scratchpadRunId: ctx.scratchpadRunId,
          blockType: ctx.blockType,
        });
      } catch (err) {
        if (typeof console !== "undefined") {
          console.error("[useAgentActions] undismissDecoration failed:", err);
        }
      }
    },
    [api, undismissDecorationMutation],
  );

  return {
    askAboutDecoration,
    logAcceptDecoration,
    dismissDecoration,
    undismissDecoration,
    logRefreshDecoration,
  };
}
