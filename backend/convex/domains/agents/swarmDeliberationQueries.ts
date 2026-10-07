/**
 * Swarm Deliberation Queries & Mutations
 *
 * Separated from swarmDeliberation.ts because Convex requires that
 * "use node" files only export actions.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

// ============================================================================
// Convex Mutations (State Persistence)
// ============================================================================

/**
 * Create a new deliberation session in agentTaskSessions.
 * Returns the session ID for subsequent state updates.
 */
export const createDeliberationSession = internalMutation({
  args: {
    topic: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"agentTaskSessions">> => {
    return await ctx.db.insert("agentTaskSessions", {
      title: `Swarm Deliberation: ${args.topic.slice(0, 80)}`,
      description: args.context || `Multi-agent deliberation on: ${args.topic}`,
      type: "swarm",
      visibility: "public",
      status: "running",
      startedAt: Date.now(),
    });
  },
});

/**
 * Update deliberation session with round results and phase progression.
 */
export const updateDeliberationState = internalMutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.status) patch.status = args.status;
    if (args.description) patch.description = args.description;
    if (args.status === "completed" || args.status === "failed") {
      patch.completedAt = Date.now();
      const session = await ctx.db.get(args.sessionId);
      if (session) {
        patch.totalDurationMs = Date.now() - session.startedAt;
      }
    }
    await ctx.db.patch(args.sessionId, patch);
  },
});

// ============================================================================
// Convex Queries
// ============================================================================

/**
 * Get the current status and metadata of a deliberation session.
 *
 * @param sessionId - The agentTaskSessions document ID
 * @returns Session document with status, timing, and description
 */
export const getDeliberationStatus = internalQuery({
  args: { sessionId: v.id("agentTaskSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    return {
      id: session._id,
      title: session.title,
      status: session.status,
      description: session.description,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      totalDurationMs: session.totalDurationMs,
    };
  },
});
