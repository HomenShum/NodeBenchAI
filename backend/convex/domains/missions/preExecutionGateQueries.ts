/**
 * Pre-Execution Gate Queries & Mutations
 *
 * Separated from preExecutionGate.ts because Convex requires that
 * "use node" files only export actions.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";

// ============================================================================
// Constants
// ============================================================================

/** Rapid-fire detection window */
const MAX_RAPID_FIRE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
/** BOUND: Max recent gate records to scan for rapid-fire detection */
const MAX_RECENT_GATES = 100;

// ============================================================================
// Queries
// ============================================================================

/**
 * Check whether the same prompt hash was evaluated in the last 5 minutes.
 * BOUND: Takes at most MAX_RECENT_GATES records to scan.
 */
export const checkRapidFire = internalQuery({
  args: {
    promptHash: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - MAX_RAPID_FIRE_WINDOW_MS;

    const recentGates = await ctx.db
      .query("preExecutionGates")
      .withIndex("by_prompt_hash", (q) =>
        q.eq("promptHash", args.promptHash).gte("createdAt", cutoff),
      )
      .order("desc")
      .take(MAX_RECENT_GATES);

    return recentGates.length > 0;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Persist gate evaluation result to the preExecutionGates table.
 */
export const recordGateResult = internalMutation({
  args: {
    missionId: v.optional(v.id("missions")),
    promptHash: v.string(),
    prompt: v.string(),
    gates: v.object({
      opportunity_identified: v.boolean(),
      unique_value: v.boolean(),
      actionable_outcome: v.boolean(),
      right_audience: v.boolean(),
      information_not_lost: v.boolean(),
    }),
    disqualifiers: v.object({
      already_resolved: v.boolean(),
      social_only: v.boolean(),
      bot_already_replied: v.boolean(),
      sensitive_topic: v.boolean(),
      rapid_fire: v.boolean(),
      command_word: v.boolean(),
    }),
    decision: v.union(
      v.literal("proceed"),
      v.literal("skip"),
      v.literal("escalate"),
    ),
    reasoning: v.string(),
    gatesPassed: v.number(),
    disqualifiersTriggered: v.array(v.string()),
    latencyMs: v.number(),
  },
  returns: v.id("preExecutionGates"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("preExecutionGates", {
      missionId: args.missionId,
      promptHash: args.promptHash,
      prompt: args.prompt,
      gates: args.gates,
      disqualifiers: args.disqualifiers,
      decision: args.decision,
      reasoning: args.reasoning,
      gatesPassed: args.gatesPassed,
      disqualifiersTriggered: args.disqualifiersTriggered,
      latencyMs: args.latencyMs,
      createdAt: Date.now(),
    });
  },
});
