/**
 * OpenClaw Monitoring — Health metrics and session queries
 *
 * Provides read-only views into OpenClaw sessions, executions, and compliance.
 * Exposed to MCP gateway for dashboard and audit visibility.
 */

import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

/**
 * List sessions for a user
 */
export const listSessions = internalQuery({
  args: {
    userId: v.id("users"),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("suspended"),
        v.literal("completed"),
        v.literal("error")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("openclawSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId));

    const sessions = await query.order("desc").take(args.limit ?? 20);

    if (args.status) {
      return sessions.filter((s) => s.status === args.status);
    }
    return sessions;
  },
});

/**
 * Get metrics summary for a user
 */
export const getMetrics = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("openclawSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const active = sessions.filter((s) => s.status === "active").length;
    const completed = sessions.filter((s) => s.status === "completed").length;
    const errored = sessions.filter((s) => s.status === "error").length;
    const totalCalls = sessions.reduce((sum, s) => sum + s.totalCalls, 0);
    const totalViolations = sessions.reduce((sum, s) => sum + s.violations, 0);

    return {
      totalSessions: sessions.length,
      activeSessions: active,
      completedSessions: completed,
      erroredSessions: errored,
      totalCalls,
      totalViolations,
      complianceRate:
        totalCalls > 0
          ? Math.round(((totalCalls - totalViolations) / totalCalls) * 100)
          : 100,
    };
  },
});

/**
 * Get execution stats for a specific session
 */
export const getSessionStats = internalQuery({
  args: {
    sessionId: v.id("openclawSessions"),
  },
  handler: async (ctx, args) => {
    const executions = await ctx.db
      .query("openclawExecutions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const skills = new Set(executions.map((e) => e.skillName));
    const violations = executions.filter((e) => e.violationType);
    const avgDuration =
      executions.length > 0
        ? executions.reduce((sum, e) => sum + (e.durationMs ?? 0), 0) /
          executions.length
        : 0;

    return {
      totalExecutions: executions.length,
      uniqueSkills: skills.size,
      violations: violations.length,
      avgDurationMs: Math.round(avgDuration),
      violationTypes: violations.reduce(
        (acc, e) => {
          const type = e.violationType ?? "unknown";
          acc[type] = (acc[type] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
    };
  },
});
