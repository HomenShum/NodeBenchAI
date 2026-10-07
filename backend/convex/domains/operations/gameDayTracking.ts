// convex/domains/operations/gameDayTracking.ts
// Game Day Execution Tracking
//
// Implements quarterly drill cadence with:
// - Scheduled execution tracking
// - Exit criteria checklists
// - Action item management
// - Postmortem linkage
//
// Addresses SRE best practice: "operational proof" that drills run + outcomes close
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* GAME DAY SCHEDULING                                                 */
/* ------------------------------------------------------------------ */

/**
 * Schedule a game day drill
 */
export const scheduleGameDay = mutation({
  args: {
    scenarioName: v.string(),
    scheduledDate: v.number(),
    participants: v.array(v.object({
      userId: v.string(),
      role: v.string(),
    })),
    exitCriteria: v.array(v.object({
      criterion: v.string(),
      met: v.boolean(),
      metAt: v.optional(v.number()),
      evidence: v.optional(v.string()),
    })),
  },
  returns: v.id("gameDayExecutions"),
  handler: async (ctx, args) => {
    const executionId = `gameday_${args.scenarioName}_${args.scheduledDate}`;

    return await ctx.db.insert("gameDayExecutions", {
      executionId,
      scenarioName: args.scenarioName,
      scheduledDate: args.scheduledDate,
      actualStartTime: args.scheduledDate,
      participants: args.participants,
      timeline: [],
      exitCriteria: args.exitCriteria,
      status: "scheduled",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get upcoming game days (next 90 days)
 */
export const getUpcomingGameDays = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const now = Date.now();
    const ninetyDaysOut = now + 90 * 24 * 60 * 60 * 1000;

    return await ctx.db
      .query("gameDayExecutions")
      .withIndex("by_scheduled", (q) =>
        q.gte("scheduledDate", now).lte("scheduledDate", ninetyDaysOut)
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "scheduled"),
          q.eq(q.field("status"), "in_progress")
        )
      )
      .collect();
  },
});

/* ------------------------------------------------------------------ */
/* EXECUTION TRACKING                                                  */
/* ------------------------------------------------------------------ */

/**
 * Start game day execution
 */
export const startGameDayExecution = mutation({
  args: {
    executionId: v.id("gameDayExecutions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.executionId, {
      status: "in_progress",
      actualStartTime: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Log timeline event
 */
export const logGameDayEvent = mutation({
  args: {
    executionId: v.id("gameDayExecutions"),
    event: v.string(),
    actionTaken: v.string(),
    correct: v.boolean(),
    evidence: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) {
      throw new Error("Game day execution not found");
    }

    const timeline = execution.timeline ?? [];
    timeline.push({
      time: Date.now(),
      event: args.event,
      actionTaken: args.actionTaken,
      correct: args.correct,
      evidence: args.evidence,
    });

    await ctx.db.patch(args.executionId, {
      timeline,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Update exit criterion
 */
export const updateExitCriterion = mutation({
  args: {
    executionId: v.id("gameDayExecutions"),
    criterionIndex: v.number(),
    met: v.boolean(),
    evidence: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) {
      throw new Error("Game day execution not found");
    }

    const exitCriteria = [...execution.exitCriteria];
    if (args.criterionIndex < 0 || args.criterionIndex >= exitCriteria.length) {
      throw new Error("Invalid criterion index");
    }

    exitCriteria[args.criterionIndex] = {
      ...exitCriteria[args.criterionIndex],
      met: args.met,
      metAt: args.met ? Date.now() : undefined,
      evidence: args.evidence,
    };

    await ctx.db.patch(args.executionId, {
      exitCriteria,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Complete game day execution
 */
export const completeGameDayExecution = mutation({
  args: {
    executionId: v.id("gameDayExecutions"),
    actionItems: v.optional(v.array(v.object({
      item: v.string(),
      owner: v.string(),
      dueDate: v.number(),
      status: v.union(v.literal("open"), v.literal("closed")),
      closedAt: v.optional(v.number()),
    }))),
    postmortemDocumentId: v.optional(v.id("documents")),
  },
  returns: v.object({
    allCriteriaMet: v.boolean(),
    unmetCriteria: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) {
      throw new Error("Game day execution not found");
    }

    // Check all exit criteria
    const allCriteriaMet = execution.exitCriteria.every((c) => c.met);
    const unmetCriteria = execution.exitCriteria
      .filter((c) => !c.met)
      .map((c) => c.criterion);

    await ctx.db.patch(args.executionId, {
      status: "completed",
      actualEndTime: Date.now(),
      allCriteriaMet,
      actionItems: args.actionItems,
      postmortemDocumentId: args.postmortemDocumentId,
      updatedAt: Date.now(),
    });

    return {
      allCriteriaMet,
      unmetCriteria,
    };
  },
});

/* ------------------------------------------------------------------ */
/* ACTION ITEM MANAGEMENT                                              */
/* ------------------------------------------------------------------ */

/**
 * Update action item status
 */
export const updateActionItem = mutation({
  args: {
    executionId: v.id("gameDayExecutions"),
    actionItemIndex: v.number(),
    status: v.union(v.literal("open"), v.literal("closed")),
    closedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution || !execution.actionItems) {
      throw new Error("Game day execution or action items not found");
    }

    const actionItems = [...execution.actionItems];
    if (args.actionItemIndex < 0 || args.actionItemIndex >= actionItems.length) {
      throw new Error("Invalid action item index");
    }

    actionItems[args.actionItemIndex] = {
      ...actionItems[args.actionItemIndex],
      status: args.status,
      closedAt: args.status === "closed" ? args.closedAt ?? Date.now() : undefined,
    };

    await ctx.db.patch(args.executionId, {
      actionItems,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Get open action items across all game days
 */
export const getOpenActionItems = query({
  args: {},
  returns: v.array(v.object({
    executionId: v.id("gameDayExecutions"),
    scenarioName: v.string(),
    scheduledDate: v.number(),
    actionItem: v.object({
      item: v.string(),
      owner: v.string(),
      dueDate: v.number(),
      status: v.union(v.literal("open"), v.literal("closed")),
      closedAt: v.optional(v.number()),
    }),
    daysOverdue: v.number(),
  })),
  handler: async (ctx) => {
    const executions = await ctx.db
      .query("gameDayExecutions")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    const openItems: Array<{
      executionId: Id<"gameDayExecutions">;
      scenarioName: string;
      scheduledDate: number;
      actionItem: {
        item: string;
        owner: string;
        dueDate: number;
        status: "open" | "closed";
        closedAt?: number;
      };
      daysOverdue: number;
    }> = [];

    const now = Date.now();

    for (const execution of executions) {
      if (execution.actionItems) {
        for (const item of execution.actionItems) {
          if (item.status === "open") {
            const daysOverdue = Math.max(
              0,
              Math.floor((now - item.dueDate) / (24 * 60 * 60 * 1000))
            );

            openItems.push({
              executionId: execution._id,
              scenarioName: execution.scenarioName,
              scheduledDate: execution.scheduledDate,
              actionItem: item,
              daysOverdue,
            });
          }
        }
      }
    }

    // Sort by days overdue descending
    return openItems.sort((a, b) => b.daysOverdue - a.daysOverdue);
  },
});

/* ------------------------------------------------------------------ */
/* REPORTING & COMPLIANCE                                              */
/* ------------------------------------------------------------------ */

/**
 * Get game day execution history
 */
export const getGameDayHistory = query({
  args: {
    scenarioName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db.query("gameDayExecutions");

    if (args.scenarioName) {
      query = query.withIndex("by_scenario", (q) => q.eq("scenarioName", args.scenarioName));
    } else {
      query = query.withIndex("by_scheduled");
    }

    return await query.order("desc").take(args.limit ?? 100);
  },
});

/**
 * Get game day compliance report (quarterly cadence)
 */
export const getGameDayComplianceReport = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.object({
    period: v.string(),
    scheduledCount: v.number(),
    completedCount: v.number(),
    cancelledCount: v.number(),
    avgAllCriteriaMet: v.number(),
    openActionItems: v.number(),
    scenarios: v.array(v.object({
      scenarioName: v.string(),
      executionCount: v.number(),
      avgCriteriaMetPercent: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    const executions = await ctx.db
      .query("gameDayExecutions")
      .withIndex("by_scheduled", (q) =>
        q.gte("scheduledDate", args.startDate).lte("scheduledDate", args.endDate)
      )
      .collect();

    const scheduledCount = executions.filter((e) => e.status === "scheduled").length;
    const completedCount = executions.filter((e) => e.status === "completed").length;
    const cancelledCount = executions.filter((e) => e.status === "cancelled").length;

    const completedExecutions = executions.filter((e) => e.status === "completed");
    const allCriteriaMetCount = completedExecutions.filter((e) => e.allCriteriaMet).length;
    const avgAllCriteriaMet =
      completedExecutions.length > 0
        ? (allCriteriaMetCount / completedExecutions.length) * 100
        : 0;

    // Count open action items
    let openActionItems = 0;
    for (const execution of completedExecutions) {
      if (execution.actionItems) {
        openActionItems += execution.actionItems.filter((item) => item.status === "open").length;
      }
    }

    // Group by scenario
    const scenarioMap = new Map<
      string,
      { executionCount: number; totalCriteriaMet: number; totalCriteria: number }
    >();

    for (const execution of completedExecutions) {
      if (!scenarioMap.has(execution.scenarioName)) {
        scenarioMap.set(execution.scenarioName, {
          executionCount: 0,
          totalCriteriaMet: 0,
          totalCriteria: 0,
        });
      }

      const stats = scenarioMap.get(execution.scenarioName)!;
      stats.executionCount++;
      stats.totalCriteria += execution.exitCriteria.length;
      stats.totalCriteriaMet += execution.exitCriteria.filter((c) => c.met).length;
    }

    const scenarios = Array.from(scenarioMap.entries()).map(([scenarioName, stats]) => ({
      scenarioName,
      executionCount: stats.executionCount,
      avgCriteriaMetPercent:
        stats.totalCriteria > 0 ? (stats.totalCriteriaMet / stats.totalCriteria) * 100 : 0,
    }));

    return {
      period: `${new Date(args.startDate).toISOString().split("T")[0]} to ${new Date(args.endDate).toISOString().split("T")[0]}`,
      scheduledCount,
      completedCount,
      cancelledCount,
      avgAllCriteriaMet,
      openActionItems,
      scenarios,
    };
  },
});

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

// All functions exported inline
