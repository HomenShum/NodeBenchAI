/**
 * Redesign Sprint S5 — Agent run feedback (👍 / 👎).
 *
 * Powers the per-message reaction toolbar in ChatSurface. Feeds the eval flywheel
 * (.claude/rules/eval_flywheel.md) by capturing user-grounded judgment on agent runs.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const recordReaction = mutation({
  args: {
    runId: v.string(),
    runSource: v.string(),
    turnId: v.optional(v.string()),
    reaction: v.union(v.literal("up"), v.literal("down")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const id = await ctx.db.insert("agentRunFeedback", {
      userId,
      runId: args.runId,
      runSource: args.runSource,
      turnId: args.turnId,
      reaction: args.reaction,
      note: args.note?.slice(0, 500),
      createdAt: Date.now(),
    });
    return id;
  },
});

export const listForRun = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentRunFeedback")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .order("desc")
      .take(50);
  },
});

export const summary = query({
  args: { sinceMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { up: 0, down: 0, total: 0 };
    const since = args.sinceMs ?? (Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await ctx.db
      .query("agentRunFeedback")
      .withIndex("by_user_created", (q) => q.eq("userId", userId).gt("createdAt", since))
      .take(500);
    const up = rows.filter((r) => r.reaction === "up").length;
    const down = rows.filter((r) => r.reaction === "down").length;
    return { up, down, total: rows.length };
  },
});
