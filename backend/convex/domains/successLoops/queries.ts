import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { buildSuccessLoopsDashboardSnapshot } from "./projection";

async function getSafeUserId(ctx: any): Promise<Id<"users"> | null> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) return null;
  const normalizedUserId = String(rawUserId).replace(/^users\|/, "");
  try {
    const user = await ctx.db.get(normalizedUserId as Id<"users">);
    return user ? (normalizedUserId as Id<"users">) : null;
  } catch {
    return null;
  }
}

export const getSuccessLoopsDashboardSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getSafeUserId(ctx);
    return buildSuccessLoopsDashboardSnapshot(ctx, userId);
  },
});

export const listSuccessLoops = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getSafeUserId(ctx);
    const snapshot = await buildSuccessLoopsDashboardSnapshot(ctx, userId);
    return snapshot.loops;
  },
});

export const listFrozenDecisions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const snapshot = await buildSuccessLoopsDashboardSnapshot(ctx, userId);
    return snapshot.frozenDecisions.slice(0, Math.max(1, Math.min(args.limit ?? 10, 25)));
  },
});

export const getProofGraphSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getSafeUserId(ctx);
    const snapshot = await buildSuccessLoopsDashboardSnapshot(ctx, userId);
    return snapshot.proofGraph;
  },
});

export const getAccountValueGraphSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getSafeUserId(ctx);
    const snapshot = await buildSuccessLoopsDashboardSnapshot(ctx, userId);
    return snapshot.accountValueGraph;
  },
});
