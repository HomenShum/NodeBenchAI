/**
 * OpenClaw Workflow Manager — Workflow CRUD
 *
 * Create, read, update, delete OpenClaw workflow definitions.
 * Each workflow defines a sequence of typed steps.
 */

import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";

const stepValidator = v.object({
  id: v.string(),
  type: v.union(
    v.literal("navigate"),
    v.literal("click"),
    v.literal("fill"),
    v.literal("extract"),
    v.literal("wait"),
    v.literal("branch")
  ),
  config: v.any(),
});

/**
 * Create a workflow definition
 */
export const create = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    steps: v.array(stepValidator),
    timeoutMs: v.number(),
    maxRetries: v.optional(v.number()),
  },
  returns: v.id("openclawWorkflows"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("openclawWorkflows", {
      userId: args.userId,
      name: args.name,
      description: args.description,
      steps: args.steps,
      timeoutMs: args.timeoutMs,
      maxRetries: args.maxRetries,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Get workflow by ID
 */
export const get = internalQuery({
  args: {
    userId: v.id("users"),
    workflowId: v.id("openclawWorkflows"),
  },
  handler: async (ctx, args) => {
    const wf = await ctx.db.get(args.workflowId);
    if (!wf || wf.userId !== args.userId) return null;
    return wf;
  },
});

/**
 * List workflows for user
 */
export const list = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("openclawWorkflows")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

/**
 * Delete a workflow
 */
export const remove = internalMutation({
  args: {
    userId: v.id("users"),
    workflowId: v.id("openclawWorkflows"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const wf = await ctx.db.get(args.workflowId);
    if (!wf || wf.userId !== args.userId) return false;
    await ctx.db.delete(args.workflowId);
    return true;
  },
});
