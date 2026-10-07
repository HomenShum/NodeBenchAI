import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get scratchpad by agentThreadId (for boot-up)
 */
export const getByAgentThread = query({
  args: { agentThreadId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", args.agentThreadId))
      .first() as Doc<"agentScratchpads"> | null;

    if (!existing || existing.userId !== userId) return null;
    return existing;
  },
});

/**
 * Upsert scratchpad for a thread
 */
export const saveScratchpad = mutation({
  args: {
    agentThreadId: v.string(),
    scratchpad: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", args.agentThreadId))
      .first() as Doc<"agentScratchpads"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        scratchpad: args.scratchpad,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("agentScratchpads", {
      agentThreadId: args.agentThreadId,
      userId,
      scratchpad: args.scratchpad,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Internal read path for async runtime actions that cannot rely on request auth.
 */
export const getByAgentThreadInternal = internalQuery({
  args: { agentThreadId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", args.agentThreadId))
      .first() as Doc<"agentScratchpads"> | null;

    return existing;
  },
});

/**
 * Internal upsert path for runtime compaction/JIT persistence.
 */
export const saveScratchpadInternal = internalMutation({
  args: {
    agentThreadId: v.string(),
    userId: v.optional(v.id("users")),
    scratchpad: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", args.agentThreadId))
      .first() as Doc<"agentScratchpads"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        scratchpad: args.scratchpad,
        updatedAt: now,
        userId: args.userId ?? existing.userId,
      });
      return existing._id;
    }

    if (!args.userId) {
      throw new Error("saveScratchpadInternal requires userId when creating a new scratchpad");
    }

    return await ctx.db.insert("agentScratchpads", {
      agentThreadId: args.agentThreadId,
      userId: args.userId,
      scratchpad: args.scratchpad,
      createdAt: now,
      updatedAt: now,
    });
  },
});
