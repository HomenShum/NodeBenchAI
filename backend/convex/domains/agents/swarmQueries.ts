/**
 * swarmQueries.ts
 *
 * Query functions for swarm state management.
 * Provides real-time subscriptions for UI updates.
 */

import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

type SwarmQueryContext = {
  db: any;
};

async function findSwarmById(ctx: SwarmQueryContext, swarmId: string) {
  return await ctx.db
    .query("agentSwarms")
    .withIndex("by_swarm", (q: any) => q.eq("swarmId", swarmId))
    .first() as Doc<"agentSwarms"> | null;
}

async function findOwnedSwarm(
  ctx: SwarmQueryContext,
  swarmId: string,
  userId: Id<"users">,
) {
  const swarm = await findSwarmById(ctx, swarmId);
  return swarm?.userId === userId ? swarm : null;
}

async function listOwnedSwarmTasks(
  ctx: SwarmQueryContext,
  swarmId: string,
  userId: Id<"users">,
) {
  const swarm = await findOwnedSwarm(ctx, swarmId, userId);
  if (!swarm) return [];
  return await ctx.db
    .query("swarmAgentTasks")
    .withIndex("by_swarm", (q: any) => q.eq("swarmId", swarmId))
    .collect() as Doc<"swarmAgentTasks">[];
}

function boundedLimit(limit: number | undefined, fallback: number, maximum: number) {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(maximum, Math.trunc(limit!)));
}

/**
 * Get swarm status by swarmId
 */
export const getSwarmStatus = query({
  args: {
    swarmId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await findOwnedSwarm(ctx, args.swarmId, userId);
  },
});

/**
 * Get swarm by thread ID - checks if a thread has an active swarm
 */
export const getSwarmByThread = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const swarm = await ctx.db
      .query("agentSwarms")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first() as Doc<"agentSwarms"> | null;

    return swarm?.userId === userId ? swarm : null;
  },
});

/**
 * Get all tasks for a swarm
 */
export const getSwarmTasks = query({
  args: {
    swarmId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await listOwnedSwarmTasks(ctx, args.swarmId, userId);
  },
});

/**
 * Subscribe to swarm tasks - returns tasks with real-time status updates
 */
export const subscribeToSwarmTasks = query({
  args: {
    swarmId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const swarm = await findOwnedSwarm(ctx, args.swarmId, userId);

    if (!swarm) return null;

    const tasks = await listOwnedSwarmTasks(ctx, args.swarmId, userId);

    // Calculate progress
    const total = tasks.length;
    const completed = tasks.filter(
      (t) => t.status === "completed" || t.status === "failed"
    ).length;
    const running = tasks.filter((t) => t.status === "running").length;

    return {
      swarm,
      tasks,
      progress: {
        total,
        completed,
        running,
        pending: total - completed - running,
        percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
    };
  },
});

/** Owner-checked internal read used by trusted orchestrators. */
export const getSwarmStatusInternal = internalQuery({
  args: {
    swarmId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await findOwnedSwarm(ctx, args.swarmId, args.userId);
  },
});

/** Owner-checked internal task read used by trusted orchestrators. */
export const getSwarmTasksInternal = internalQuery({
  args: {
    swarmId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await listOwnedSwarmTasks(ctx, args.swarmId, args.userId);
  },
});

/**
 * List active swarms for a user
 */
export const listActiveSwarms = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const swarms = await ctx.db
      .query("agentSwarms")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(boundedLimit(args.limit, 10, 100));

    return swarms;
  },
});

/**
 * List user swarms with status filter
 */
export const listUserSwarms = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("spawning"),
        v.literal("executing"),
        v.literal("gathering"),
        v.literal("synthesizing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let swarmsQuery = ctx.db
      .query("agentSwarms")
      .withIndex("by_user", (q) => q.eq("userId", userId));

    const swarms = await swarmsQuery.order("desc").take(boundedLimit(args.limit, 20, 100));

    // Filter by status if provided
    if (args.status) {
      return swarms.filter((s) => s.status === args.status);
    }

    return swarms;
  },
});

/**
 * Get swarm with full context (swarm + tasks + thread info)
 */
export const getSwarmWithContext = query({
  args: {
    swarmId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const swarm = await findOwnedSwarm(ctx, args.swarmId, userId);

    if (!swarm) return null;

    const tasks = await listOwnedSwarmTasks(ctx, args.swarmId, userId);

    // Get thread info
    const candidateThread = swarm.threadId
      ? await ctx.db.get(swarm.threadId as Id<"chatThreadsStream">)
      : null;
    const thread = candidateThread?.userId === userId ? candidateThread : null;

    // Get write events for each task's delegation
    const taskEvents: Record<string, any[]> = {};
    for (const task of tasks) {
      if (task.delegationId) {
        const delegation = await ctx.db
          .query("agentDelegations")
          .withIndex("by_delegation", (q) => q.eq("delegationId", task.delegationId!))
          .first() as Doc<"agentDelegations"> | null;
        if (
          !delegation ||
          delegation.userId !== userId ||
          delegation.runId !== swarm.swarmId
        ) {
          continue;
        }
        const events = await ctx.db
          .query("agentWriteEvents")
          .withIndex("by_delegation", (q) =>
            q.eq("delegationId", task.delegationId!)
          )
          .order("asc")
          .take(500);
        taskEvents[task.taskId] = events;
      }
    }

    return {
      swarm,
      tasks,
      thread,
      taskEvents,
    };
  },
});

/**
 * Check if thread has running swarm
 */
export const isThreadSwarmActive = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { hasSwarm: false, isActive: false };
    const swarm = await ctx.db
      .query("agentSwarms")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first() as Doc<"agentSwarms"> | null;

    if (!swarm || swarm.userId !== userId) return { hasSwarm: false, isActive: false };

    const isActive = ["pending", "spawning", "executing", "gathering", "synthesizing"].includes(
      swarm.status
    );

    return {
      hasSwarm: true,
      isActive,
      swarmId: swarm.swarmId,
      status: swarm.status,
    };
  },
});

/**
 * Get threads with swarm info for tab bar display
 */
export const getThreadsWithSwarmInfo = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get recent threads
    const threads = await ctx.db
      .query("chatThreadsStream")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(boundedLimit(args.limit, 20, 100));

    // Enrich with swarm status
    const enrichedThreads = await Promise.all(
      threads.map(async (thread) => {
        let swarmInfo: any = null;
        if (thread.swarmId) {
          const swarm = await ctx.db
            .query("agentSwarms")
            .withIndex("by_swarm", (q) => q.eq("swarmId", thread.swarmId!))
            .first() as Doc<"agentSwarms"> | null;

          if (swarm?.userId === userId) {
            const tasks = await ctx.db
              .query("swarmAgentTasks")
              .withIndex("by_swarm", (q) => q.eq("swarmId", thread.swarmId!))
              .collect();

            const completed = tasks.filter(
              (t) => t.status === "completed" || t.status === "failed"
            ).length;

            swarmInfo = {
              swarmId: swarm.swarmId,
              status: swarm.status,
              agentCount: tasks.length,
              completedCount: completed,
              isActive: ["pending", "spawning", "executing", "gathering", "synthesizing"].includes(
                swarm.status
              ),
            };
          }
        }

        return {
          ...thread,
          swarmInfo,
        };
      })
    );

    return enrichedThreads;
  },
});

/**
 * Internal-only helper for smoke tests and ops tooling.
 */
export const getAnyUserIdInternal = internalQuery({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => {
    const user = await ctx.db.query("users").first() as Doc<"users"> | null;
    return user?._id ?? null;
  },
});
