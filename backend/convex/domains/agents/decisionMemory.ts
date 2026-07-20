"use node";
/**
 * Decision Memory — Fingerprinting and surfacing of prior decisions
 *
 * Every judge verdict is fingerprinted by (entityRef, actionType, domain).
 * Future deliberations and evolution cycles can query for "we saw this before"
 * to ground judgment in institutional memory.
 *
 * Fingerprint: SHA-256 of sorted-key JSON, truncated to 16 hex chars.
 */

import { createHash } from "crypto";
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ============================================================================
// Constants — BOUND limits for all queries
// ============================================================================

/** BOUND_READ: Max chars for formatted context injected into LLM prompts */
const MAX_CONTEXT_CHARS = 2000;
/** Hex chars from SHA-256 digest */
const FINGERPRINT_LENGTH = 16;

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Create a deterministic fingerprint from decision coordinates.
 *
 * Keys are sorted alphabetically (actionType, domain, entityRef) in the
 * object literal to guarantee identical JSON serialization regardless of
 * call-site property order.
 */
export function createDecisionFingerprint({
  entityRef,
  actionType,
  domain,
}: {
  entityRef?: string;
  actionType: string;
  domain: string;
}): string {
  // DETERMINISTIC: keys pre-sorted alphabetically in the object literal
  const payload = JSON.stringify({
    actionType,
    domain,
    entityRef: entityRef ?? "",
  });
  return createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/**
 * Format prior decisions into an LLM-injectable context block.
 *
 * Output is hard-capped at MAX_CONTEXT_CHARS (BOUND_READ) to prevent
 * context window pollution.
 */
export function formatPriorDecisionsContext(
  decisions: Array<{
    verdict: string;
    confidence: number;
    reasoning: string;
    createdAt: number;
  }>,
): string {
  if (decisions.length === 0) {
    return "No prior decisions found for this scenario.";
  }

  const header = "## Prior Decisions on Similar Scenarios\n";
  const lines: string[] = [];

  for (const d of decisions) {
    const date = new Date(d.createdAt).toISOString().slice(0, 10);
    const truncatedReasoning = d.reasoning.length > 200
      ? d.reasoning.slice(0, 200) + "..."
      : d.reasoning;
    lines.push(
      `[${date}] Verdict: ${d.verdict} (confidence: ${d.confidence}) — ${truncatedReasoning}`,
    );
  }

  const full = header + lines.join("\n");
  if (full.length > MAX_CONTEXT_CHARS) {
    return full.slice(0, MAX_CONTEXT_CHARS - 3) + "...";
  }
  return full;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Record a decision fingerprint from an existing judge review.
 *
 * Pulls the judgeReview, its taskPlan, and the mission to extract
 * decision coordinates, then computes and stores the fingerprint.
 *
 * ERROR_BOUNDARY: Wrapped in try/catch — failures are logged but never
 * block the judge flow. Decision memory is advisory, not critical path.
 */
export const recordFromJudgeReview = internalAction({
  args: {
    judgeReviewId: v.id("judgeReviews"),
    missionId: v.id("missions"),
  },
  handler: async (ctx, args) => {
    try {
      // Fetch the judge review
      const judgeReview = await ctx.runQuery(
        internal.domains.agents.decisionMemoryQueries.getJudgeReview,
        { judgeReviewId: args.judgeReviewId },
      );
      if (!judgeReview) {
        console.warn(
          `[decisionMemory] judgeReview ${args.judgeReviewId} not found, skipping`,
        );
        return;
      }

      // Fetch the task plan
      const taskPlan = await ctx.runQuery(
        internal.domains.agents.decisionMemoryQueries.getTaskPlan,
        { taskId: judgeReview.taskId },
      );

      // Fetch the mission
      const mission = await ctx.runQuery(
        internal.domains.agents.decisionMemoryQueries.getMission,
        { missionId: args.missionId },
      );

      // Extract decision coordinates
      const entityRef = mission?.entityKey ?? undefined;
      const actionType = taskPlan?.taskKey ?? mission?.missionType ?? "unknown";
      const domain = mission?.missionType ?? "unknown";

      // Compute fingerprint
      const fingerprint = createDecisionFingerprint({
        entityRef,
        actionType,
        domain,
      });

      // Store the decision
      await ctx.runMutation(
        internal.domains.agents.decisionMemoryQueries.recordDecisionFingerprint,
        {
          fingerprint,
          entityRef,
          actionType,
          domain,
          verdict: judgeReview.verdict,
          confidence: judgeReview.compositeConfidence,
          reasoning: judgeReview.reasoning,
          sourceJudgeReviewId: args.judgeReviewId,
          sourceMissionId: args.missionId,
        },
      );
    } catch (error) {
      // ERROR_BOUNDARY: Decision memory is advisory — never block judge flow
      console.error(
        "[decisionMemory] Failed to record from judge review:",
        error instanceof Error ? error.message : String(error),
      );
    }
  },
});

