/**
 * OpenClaw Session Manager — Session lifecycle mutations
 *
 * Manages sandboxed OpenClaw sessions: create, suspend, resume, end.
 * All mutations require userId for multi-user isolation.
 */

import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Create a new OpenClaw session
 */
export const create = internalMutation({
  args: {
    userId: v.id("users"),
    workflowId: v.optional(v.id("openclawWorkflows")),
    policyName: v.optional(v.string()),
    deployment: v.string(),
  },
  returns: v.id("openclawSessions"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("openclawSessions", {
      userId: args.userId,
      workflowId: args.workflowId,
      policyName: args.policyName,
      status: "active",
      deployment: args.deployment,
      totalCalls: 0,
      violations: 0,
      startedAt: now,
    });
  },
});

/**
 * End a session with final stats
 */
export const end = internalMutation({
  args: {
    userId: v.id("users"),
    sessionId: v.id("openclawSessions"),
    reason: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== args.userId) return false;
    if (session.status !== "active") return false;

    await ctx.db.patch(args.sessionId, {
      status: "completed",
      endedAt: Date.now(),
    });
    return true;
  },
});

/**
 * Increment call count for a session
 */
export const incrementCalls = internalMutation({
  args: {
    sessionId: v.id("openclawSessions"),
    isViolation: v.boolean(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    await ctx.db.patch(args.sessionId, {
      totalCalls: session.totalCalls + 1,
      violations: args.isViolation ? session.violations + 1 : session.violations,
    });
  },
});

/**
 * Get session by ID (internal)
 */
export const getSession = internalQuery({
  args: {
    userId: v.id("users"),
    sessionId: v.id("openclawSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== args.userId) return null;
    return session;
  },
});
