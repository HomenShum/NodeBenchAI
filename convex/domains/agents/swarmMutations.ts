/**
 * swarmMutations.ts
 *
 * Database mutations for swarm state management.
 * Separated from swarmOrchestrator to avoid "use node" conflicts.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";

/**
 * Create a new swarm record
 */
export const createSwarmRecord = internalMutation({
  args: {
    swarmId: v.string(),
    userId: v.id("users"),
    threadId: v.string(),
    name: v.optional(v.string()),
    query: v.string(),
    pattern: v.union(
      v.literal("fan_out_gather"),
      v.literal("pipeline"),
      v.literal("swarm")
    ),
    agentConfigs: v.array(
      v.object({
        agentName: v.string(),
        role: v.string(),
        query: v.string(),
        stateKeyPrefix: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const swarmDoc = await ctx.db.insert("agentSwarms", {
      swarmId: args.swarmId,
      userId: args.userId,
      threadId: args.threadId,
      name: args.name,
      query: args.query,
      pattern: args.pattern,
      status: "pending",
      agentConfigs: args.agentConfigs,
      createdAt: Date.now(),
    });
    return swarmDoc;
  },
});

/**
 * Create agent task records for a swarm
 */
export const createSwarmTasks = internalMutation({
  args: {
    swarmId: v.string(),
    tasks: v.array(
      v.object({
        taskId: v.string(),
        agentName: v.string(),
        query: v.string(),
        role: v.string(),
        stateKeyPrefix: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const taskIds: string[] = [];
    for (const task of args.tasks) {
      await ctx.db.insert("swarmAgentTasks", {
        swarmId: args.swarmId,
        taskId: task.taskId,
        agentName: task.agentName,
        query: task.query,
        role: task.role,
        stateKeyPrefix: task.stateKeyPrefix,
        status: "pending",
        createdAt: Date.now(),
      });
      taskIds.push(task.taskId);
    }
    return taskIds;
  },
});

/**
 * Update swarm status
 */
export const updateSwarmStatus = internalMutation({
  args: {
    swarmId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("spawning"),
      v.literal("executing"),
      v.literal("gathering"),
      v.literal("synthesizing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const swarm = await ctx.db
      .query("agentSwarms")
      .withIndex("by_swarm", (q) => q.eq("swarmId", args.swarmId))
      .first() as Doc<"agentSwarms"> | null;

    if (!swarm) throw new Error(`Swarm not found: ${args.swarmId}`);

    await ctx.db.patch(swarm._id, {
      status: args.status,
      ...(args.startedAt && { startedAt: args.startedAt }),
      ...(args.completedAt && { completedAt: args.completedAt }),
      ...(args.elapsedMs && { elapsedMs: args.elapsedMs }),
    });
  },
});

/**
 * Update task status
 */
export const updateTaskStatus = internalMutation({
  args: {
    taskId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    delegationId: v.optional(v.string()),
    result: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("swarmAgentTasks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .first() as Doc<"swarmAgentTasks"> | null;

    if (!task) throw new Error(`Task not found: ${args.taskId}`);

    await ctx.db.patch(task._id, {
      status: args.status,
      ...(args.delegationId && { delegationId: args.delegationId }),
      ...(args.result && { result: args.result }),
      ...(args.resultSummary && { resultSummary: args.resultSummary }),
      ...(args.startedAt && { startedAt: args.startedAt }),
      ...(args.completedAt && { completedAt: args.completedAt }),
      ...(args.elapsedMs && { elapsedMs: args.elapsedMs }),
      ...(args.errorMessage && { errorMessage: args.errorMessage }),
    });
  },
});

/**
 * Set swarm merged result
 */
export const setSwarmResult = internalMutation({
  args: {
    swarmId: v.string(),
    mergedResult: v.string(),
    confidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const swarm = await ctx.db
      .query("agentSwarms")
      .withIndex("by_swarm", (q) => q.eq("swarmId", args.swarmId))
      .first() as Doc<"agentSwarms"> | null;

    if (!swarm) throw new Error(`Swarm not found: ${args.swarmId}`);

    await ctx.db.patch(swarm._id, {
      mergedResult: args.mergedResult,
      confidence: args.confidence,
      status: "completed",
      completedAt: Date.now(),
      elapsedMs: Date.now() - swarm.createdAt,
    });
  },
});

/**
 * Link thread to swarm
 */
export const linkThreadToSwarm = internalMutation({
  args: {
    threadId: v.id("chatThreadsStream"),
    swarmId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, {
      swarmId: args.swarmId,
    });
  },
});
