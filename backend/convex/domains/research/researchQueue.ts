/**
 * Research Queue - Priority Queue Management for Autonomous Research
 * Deep Agents 3.0 - Manages research task prioritization and scheduling
 *
 * Implements:
 * - Priority-based task queuing (0-100 scale)
 * - Status lifecycle management
 * - Dequeue operations for workers
 * - Statistics and monitoring
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { RESEARCH_CONFIG } from "../../config/autonomousConfig";
import type { Doc, Id } from "../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export type ResearchTaskStatus =
  | "queued"
  | "researching"
  | "validating"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

export interface QueueStats {
  queued: number;
  researching: number;
  validating: number;
  publishing: number;
  completed: number;
  failed: number;
  total: number;
  avgPriority: number;
  oldestQueuedAge: number | null;
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get a research task by ID
 */
export const getTask = internalQuery({
  args: { taskId: v.id("researchTasks") },
  handler: async (ctx, { taskId }): Promise<Doc<"researchTasks"> | null> => {
    return await ctx.db.get(taskId) as Doc<"researchTasks"> | null;
  },
});

/**
 * Get the next task to process (highest priority queued)
 */
export const dequeueNext = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"researchTasks"> | null> => {
    // Get all queued tasks and sort by priority descending
    const queuedTasks = await ctx.db
      .query("researchTasks")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect() as Doc<"researchTasks">[];

    if (queuedTasks.length === 0) {
      return null;
    }

    // Sort by priority (descending) and created time (ascending for tie-break)
    queuedTasks.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt - b.createdAt;
    });

    return queuedTasks[0];
  },
});

/**
 * Get queued tasks by persona
 */
export const getQueuedByPersona = internalQuery({
  args: {
    personaId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { personaId, limit = 50 }): Promise<Doc<"researchTasks">[]> => {
    return await ctx.db
      .query("researchTasks")
      .withIndex("by_persona", (q) =>
        q.eq("primaryPersona", personaId).eq("status", "queued")
      )
      .take(limit) as Doc<"researchTasks">[];
  },
});

/**
 * Get tasks for a specific entity
 */
export const getTasksByEntity = internalQuery({
  args: {
    entityId: v.string(),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("researching"),
        v.literal("validating"),
        v.literal("publishing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
  },
  handler: async (ctx, { entityId, status }): Promise<Doc<"researchTasks">[]> => {
    let query = ctx.db
      .query("researchTasks")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId));

    if (status) {
      query = query.filter((q) => q.eq(q.field("status"), status));
    }

    return await query.collect() as Doc<"researchTasks">[];
  },
});

/**
 * Get currently active tasks (researching, validating, or publishing)
 */
export const getActiveTasks = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 100 }): Promise<Doc<"researchTasks">[]> => {
    const tasks = await ctx.db
      .query("researchTasks")
      .order("desc")
      .collect() as Doc<"researchTasks">[];

    return tasks
      .filter(
        (t: Doc<"researchTasks">) =>
          t.status === "researching" ||
          t.status === "validating" ||
          t.status === "publishing"
      )
      .slice(0, limit);
  },
});

/**
 * Get failed tasks that can be retried
 */
export const getRetryableTasks = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 20 }): Promise<Doc<"researchTasks">[]> => {
    const failedTasks = await ctx.db
      .query("researchTasks")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .take(limit * 2) as Doc<"researchTasks">[];

    return failedTasks
      .filter((t: Doc<"researchTasks">) => t.retryCount < (t.maxRetries || RESEARCH_CONFIG.maxRetries))
      .slice(0, limit);
  },
});

/**
 * Get queue statistics
 */
export const getQueueStats = internalQuery({
  args: {},
  handler: async (ctx): Promise<QueueStats> => {
    const allTasks = await ctx.db.query("researchTasks").collect() as Doc<"researchTasks">[];

    const stats: QueueStats = {
      queued: 0,
      researching: 0,
      validating: 0,
      publishing: 0,
      completed: 0,
      failed: 0,
      total: allTasks.length,
      avgPriority: 0,
      oldestQueuedAge: null,
    };

    let totalPriority = 0;
    let oldestQueued = Infinity;
    const now = Date.now();

    for (const task of allTasks) {
      switch (task.status) {
        case "queued":
          stats.queued++;
          totalPriority += task.priority;
          if (task.createdAt < oldestQueued) {
            oldestQueued = task.createdAt;
          }
          break;
        case "researching":
          stats.researching++;
          break;
        case "validating":
          stats.validating++;
          break;
        case "publishing":
          stats.publishing++;
          break;
        case "completed":
          stats.completed++;
          break;
        case "failed":
          stats.failed++;
          break;
      }
    }

    stats.avgPriority = stats.queued > 0 ? Math.round(totalPriority / stats.queued) : 0;
    stats.oldestQueuedAge = oldestQueued < Infinity ? now - oldestQueued : null;

    return stats;
  },
});

/**
 * Public query for queue stats (for UI dashboard)
 */
export const getPublicQueueStats = query({
  args: {},
  handler: async (ctx): Promise<QueueStats> => {
    const allTasks = await ctx.db.query("researchTasks").collect() as Doc<"researchTasks">[];

    const stats: QueueStats = {
      queued: 0,
      researching: 0,
      validating: 0,
      publishing: 0,
      completed: 0,
      failed: 0,
      total: allTasks.length,
      avgPriority: 0,
      oldestQueuedAge: null,
    };

    let totalPriority = 0;
    let oldestQueued = Infinity;
    const now = Date.now();

    for (const task of allTasks) {
      switch (task.status) {
        case "queued":
          stats.queued++;
          totalPriority += task.priority;
          if (task.createdAt < oldestQueued) {
            oldestQueued = task.createdAt;
          }
          break;
        case "researching":
          stats.researching++;
          break;
        case "validating":
          stats.validating++;
          break;
        case "publishing":
          stats.publishing++;
          break;
        case "completed":
          stats.completed++;
          break;
        case "failed":
          stats.failed++;
          break;
      }
    }

    stats.avgPriority = stats.queued > 0 ? Math.round(totalPriority / stats.queued) : 0;
    stats.oldestQueuedAge = oldestQueued < Infinity ? now - oldestQueued : null;

    return stats;
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Enqueue a new research task
 */
export const enqueue = internalMutation({
  args: {
    entityId: v.string(),
    entityType: v.optional(v.string()),
    entityName: v.optional(v.string()),
    personas: v.array(v.string()),
    primaryPersona: v.optional(v.string()),
    priority: v.number(),
    priorityFactors: v.optional(
      v.object({
        urgencyBoost: v.optional(v.number()),
        stalenessBoost: v.optional(v.number()),
        watchlistBoost: v.optional(v.number()),
        trendingBoost: v.optional(v.number()),
      })
    ),
    signalId: v.optional(v.id("signals")),
    triggeredBy: v.optional(
      v.union(
        v.literal("signal"),
        v.literal("decay"),
        v.literal("watchlist"),
        v.literal("enrichment"),
        v.literal("manual")
      )
    ),
  },
  handler: async (ctx, args): Promise<Id<"researchTasks">> => {
    return await ctx.db.insert("researchTasks", {
      entityId: args.entityId,
      entityType: args.entityType,
      entityName: args.entityName,
      personas: args.personas,
      primaryPersona: args.primaryPersona || args.personas[0],
      priority: Math.min(Math.max(args.priority, 0), 100), // Clamp to 0-100
      priorityFactors: args.priorityFactors,
      status: "queued",
      signalId: args.signalId,
      triggeredBy: args.triggeredBy || "manual",
      retryCount: 0,
      maxRetries: RESEARCH_CONFIG.maxRetries,
      createdAt: Date.now(),
    });
  },
});

/**
 * Update task status
 */
export const updateStatus = internalMutation({
  args: {
    taskId: v.id("researchTasks"),
    status: v.union(
      v.literal("queued"),
      v.literal("researching"),
      v.literal("validating"),
      v.literal("publishing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    swarmId: v.optional(v.string()),
    qualityScore: v.optional(v.number()),
    validationPassed: v.optional(v.boolean()),
    validationIssues: v.optional(
      v.array(
        v.object({
          type: v.string(),
          severity: v.string(),
          description: v.string(),
        })
      )
    ),
    error: v.optional(v.string()),
    tokensUsed: v.optional(v.number()),
    costUsd: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { taskId, status, ...updates } = args;
    const task = await ctx.db.get(taskId) as Doc<"researchTasks"> | null;
    if (!task) return;

    const patchData: Partial<Doc<"researchTasks">> = {
      status,
    };

    // Set timestamps based on status
    const now = Date.now();
    if (status === "researching" && !task.startedAt) {
      patchData.startedAt = now;
    }
    if (status === "completed" || status === "failed" || status === "cancelled") {
      patchData.completedAt = now;
      if (task.startedAt) {
        patchData.elapsedMs = now - task.startedAt;
      }
    }

    // Apply optional updates
    if (updates.swarmId !== undefined) patchData.swarmId = updates.swarmId;
    if (updates.qualityScore !== undefined) patchData.qualityScore = updates.qualityScore;
    if (updates.validationPassed !== undefined) patchData.validationPassed = updates.validationPassed;
    if (updates.validationIssues !== undefined) patchData.validationIssues = updates.validationIssues;
    if (updates.error !== undefined) patchData.lastError = updates.error;
    if (updates.tokensUsed !== undefined) patchData.tokensUsed = updates.tokensUsed;
    if (updates.costUsd !== undefined) patchData.costUsd = updates.costUsd;

    await ctx.db.patch(taskId, patchData);
  },
});

/**
 * Mark a task for retry
 */
export const markForRetry = internalMutation({
  args: {
    taskId: v.id("researchTasks"),
    error: v.string(),
  },
  handler: async (ctx, { taskId, error }): Promise<boolean> => {
    const task = await ctx.db.get(taskId) as Doc<"researchTasks"> | null;
    if (!task) return false;

    const maxRetries = task.maxRetries || RESEARCH_CONFIG.maxRetries;
    const newRetryCount = task.retryCount + 1;

    if (newRetryCount >= maxRetries) {
      // Max retries exceeded
      await ctx.db.patch(taskId, {
        status: "failed",
        lastError: `Max retries exceeded. Last error: ${error}`,
        retryCount: newRetryCount,
        completedAt: Date.now(),
      });
      return false;
    }

    // Schedule for retry
    await ctx.db.patch(taskId, {
      status: "queued",
      lastError: error,
      retryCount: newRetryCount,
      // Reduce priority slightly on retry
      priority: Math.max(task.priority - 5, 0),
    });

    return true;
  },
});

/**
 * Update task priority
 */
export const updatePriority = internalMutation({
  args: {
    taskId: v.id("researchTasks"),
    priority: v.number(),
    priorityFactors: v.optional(
      v.object({
        urgencyBoost: v.optional(v.number()),
        stalenessBoost: v.optional(v.number()),
        watchlistBoost: v.optional(v.number()),
        trendingBoost: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, { taskId, priority, priorityFactors }): Promise<void> => {
    const updates: Partial<Doc<"researchTasks">> = {
      priority: Math.min(Math.max(priority, 0), 100),
    };
    if (priorityFactors) {
      updates.priorityFactors = priorityFactors;
    }
    await ctx.db.patch(taskId, updates);
  },
});

/**
 * Cancel a task
 */
export const cancelTask = internalMutation({
  args: { taskId: v.id("researchTasks") },
  handler: async (ctx, { taskId }): Promise<void> => {
    const task = await ctx.db.get(taskId) as Doc<"researchTasks"> | null;
    if (!task) return;

    // Only cancel if not already completed
    if (task.status !== "completed" && task.status !== "failed") {
      await ctx.db.patch(taskId, {
        status: "cancelled",
        completedAt: Date.now(),
      });
    }
  },
});

/**
 * Clean up old completed/failed tasks
 */
export const cleanupOldTasks = internalMutation({
  args: {
    maxAgeDays: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { maxAgeDays = 7, limit = 100 }): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    // Get old completed/failed tasks
    const oldTasks = await ctx.db
      .query("researchTasks")
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field("status"), "completed"),
            q.eq(q.field("status"), "failed"),
            q.eq(q.field("status"), "cancelled")
          ),
          q.lt(q.field("completedAt"), cutoff)
        )
      )
      .take(limit) as Doc<"researchTasks">[];

    for (const task of oldTasks) {
      await ctx.db.delete(task._id);
    }

    return { deleted: oldTasks.length };
  },
});

/**
 * Bulk update priorities for stale entities
 */
export const boostStalePriorities = internalMutation({
  args: {
    entityIds: v.array(v.string()),
    boost: v.number(),
  },
  handler: async (ctx, { entityIds, boost }): Promise<number> => {
    let updated = 0;

    for (const entityId of entityIds) {
      const tasks = await ctx.db
        .query("researchTasks")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .filter((q) => q.eq(q.field("status"), "queued"))
        .collect() as Doc<"researchTasks">[];

      for (const task of tasks) {
        const newPriority = Math.min(task.priority + boost, 100);
        await ctx.db.patch(task._id, {
          priority: newPriority,
          priorityFactors: {
            ...task.priorityFactors,
            stalenessBoost: (task.priorityFactors?.stalenessBoost || 0) + boost,
          },
        });
        updated++;
      }
    }

    return updated;
  },
});
