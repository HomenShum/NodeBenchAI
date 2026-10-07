import { v } from "convex/values";
import { internalMutation, query } from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";

const CIRCUIT_OPEN_FAILURES = 5;

function nowMs() {
  return Date.now();
}

export const recordToolSuccess = internalMutation({
  args: {
    toolName: v.string(),
    latencyMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("toolHealth")
      .withIndex("by_toolName", (q) => q.eq("toolName", args.toolName))
      .first() as Doc<"toolHealth"> | null;

    const now = nowMs();
    if (!existing) {
      await ctx.db.insert("toolHealth", {
        toolName: args.toolName,
        successCount: 1,
        failureCount: 0,
        avgLatencyMs: Math.max(0, args.latencyMs),
        lastSuccessAt: now,
        lastFailureAt: undefined,
        lastError: undefined,
        consecutiveFailures: 0,
        circuitOpen: false,
        circuitOpenedAt: undefined,
      });
      return null;
    }

    const successCount = (existing.successCount ?? 0) + 1;
    const avgLatencyMs =
      successCount <= 1
        ? Math.max(0, args.latencyMs)
        : Math.round(((existing.avgLatencyMs ?? 0) * (successCount - 1) + Math.max(0, args.latencyMs)) / successCount);

    await ctx.db.patch(existing._id, {
      successCount,
      avgLatencyMs,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      circuitOpen: false,
      circuitOpenedAt: undefined,
    });

    return null;
  },
});

export const recordToolFailure = internalMutation({
  args: {
    toolName: v.string(),
    latencyMs: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.object({ circuitOpen: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("toolHealth")
      .withIndex("by_toolName", (q) => q.eq("toolName", args.toolName))
      .first() as Doc<"toolHealth"> | null;

    const now = nowMs();
    if (!existing) {
      await ctx.db.insert("toolHealth", {
        toolName: args.toolName,
        successCount: 0,
        failureCount: 1,
        avgLatencyMs: Math.max(0, args.latencyMs ?? 0),
        lastSuccessAt: undefined,
        lastFailureAt: now,
        lastError: args.error ?? "Unknown error",
        consecutiveFailures: 1,
        circuitOpen: true,
        circuitOpenedAt: now,
      });
      return { circuitOpen: true };
    }

    const failureCount = (existing.failureCount ?? 0) + 1;
    const consecutiveFailures = (existing.consecutiveFailures ?? 0) + 1;
    const shouldOpen = consecutiveFailures >= CIRCUIT_OPEN_FAILURES;

    await ctx.db.patch(existing._id, {
      failureCount,
      lastFailureAt: now,
      lastError: args.error ?? existing.lastError,
      consecutiveFailures,
      circuitOpen: shouldOpen ? true : existing.circuitOpen,
      circuitOpenedAt: shouldOpen ? now : existing.circuitOpenedAt,
    });

    return { circuitOpen: shouldOpen ? true : existing.circuitOpen };
  },
});

export const getToolHealth = query({
  args: {
    toolName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("toolHealth")
      .withIndex("by_toolName", (q) => q.eq("toolName", args.toolName))
      .first();
  },
});

/**
 * Get health snapshot for all tools.
 * Useful for operational monitoring dashboards.
 */
export const getToolHealthSnapshot = query({
  args: {},
  returns: v.array(v.object({
    toolName: v.string(),
    successCount: v.number(),
    failureCount: v.number(),
    avgLatencyMs: v.number(),
    lastSuccessAt: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    consecutiveFailures: v.number(),
    circuitOpen: v.boolean(),
    failureRate: v.number(),
  })),
  handler: async (ctx) => {
    const allHealth = await ctx.db.query("toolHealth").collect();

    return allHealth.map(h => {
      const total = (h.successCount ?? 0) + (h.failureCount ?? 0);
      const failureRate = total > 0 ? (h.failureCount ?? 0) / total : 0;

      return {
        toolName: h.toolName,
        successCount: h.successCount ?? 0,
        failureCount: h.failureCount ?? 0,
        avgLatencyMs: h.avgLatencyMs ?? 0,
        lastSuccessAt: h.lastSuccessAt,
        lastFailureAt: h.lastFailureAt,
        consecutiveFailures: h.consecutiveFailures ?? 0,
        circuitOpen: h.circuitOpen ?? false,
        failureRate: Math.round(failureRate * 100) / 100,
      };
    });
  },
});

/**
 * Reset circuit breaker for a specific tool.
 * Use after fixing underlying issues.
 */
export const resetCircuitBreaker = internalMutation({
  args: {
    toolName: v.string(),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("toolHealth")
      .withIndex("by_toolName", (q) => q.eq("toolName", args.toolName))
      .first() as Doc<"toolHealth"> | null;

    if (!existing) {
      return { success: false };
    }

    await ctx.db.patch(existing._id, {
      circuitOpen: false,
      circuitOpenedAt: undefined,
      consecutiveFailures: 0,
    });

    return { success: true };
  },
});
