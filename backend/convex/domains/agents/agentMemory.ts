/**
 * Agent Memory - Backend functions for persistent agent memory
 *
 * This module provides mutations and queries for the Deep Agents memory system.
 * Memory entries are key-value pairs stored per user with optional metadata.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTIC CONTEXT ENGINEERING - PRINCIPLE 9: EVOLVING STRATEGIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module implements meta-learning capabilities that allow the agent to:
 * 1. Track success/failure patterns from episodic logs
 * 2. Refine behavior based on feedback analysis
 * 3. Self-modify prompts and strategies over time
 * 4. Maintain a learning curve that improves with experience
 *
 * KEY COMPONENTS:
 * - Episodic Memory: Logs of agent runs with outcome tagging
 * - Pattern Analysis: Identifies recurring success/failure patterns
 * - Strategy Refinement: Updates agent behavior based on patterns
 * - Feedback Loop: Continuous improvement cycle
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { v } from "convex/values";
import {
  mutation as mutationBase,
  query as queryBase,
  internalMutation as internalMutationBase,
  internalQuery as internalQueryBase,
} from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  projectAgentEpisodicSummary,
  projectAgentMemorySummary,
} from "./agentMemorySummary";

// Avoid TS2589 "excessively deep" instantiations in large-schema projects.
const mutation = mutationBase as any;
const query = queryBase as any;
const internalMutation = internalMutationBase as any;
const internalQuery = internalQueryBase as any;

/**
 * Write data to agent memory
 */
export const writeMemory = mutation({
    args: {
        key: v.string(),
        content: v.string(),
        metadata: v.optional(v.any()),
    },
    returns: v.id("agentMemory"),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            throw new Error("Authentication required");
        }

        const now = Date.now();

        // Check if entry already exists
        const existing: Doc<"agentMemory"> | null = await ctx.db
            .query("agentMemory")
            .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", args.key))
            .first();

        if (existing) {
            // Update existing entry
            await ctx.db.patch(existing._id, {
                content: args.content,
                metadata: args.metadata,
                updatedAt: now,
            });
            return existing._id;
        } else {
            // Create new entry
            const memoryId = await ctx.db.insert("agentMemory", {
                userId,
                key: args.key,
                content: args.content,
                metadata: args.metadata,
                createdAt: now,
                updatedAt: now,
            });
            return memoryId;
        }
    },
});

/**
 * Read data from agent memory
 */
export const readMemory = query({
    args: {
        key: v.string(),
    },
    returns: v.union(
        v.object({
            _id: v.id("agentMemory"),
            userId: v.id("users"),
            key: v.string(),
            content: v.string(),
            metadata: v.optional(v.any()),
            createdAt: v.number(),
            updatedAt: v.number(),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            return null;
        }

        const memory = await ctx.db
            .query("agentMemory")
            .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", args.key))
            .first();

        return memory ? projectAgentMemorySummary(memory) : null;
    },
});

/**
 * List all memory entries for the current user
 */
export const listMemory = query({
    args: {
        limit: v.optional(v.number()),
    },
    returns: v.array(v.object({
        _id: v.id("agentMemory"),
        userId: v.id("users"),
        key: v.string(),
        content: v.string(),
        metadata: v.optional(v.any()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            return [];
        }

        const query = ctx.db
            .query("agentMemory")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .order("desc");

        const memories = args.limit
            ? await query.take(args.limit)
            : await query.take(50);

        return memories.map(projectAgentMemorySummary);
    },
});

/**
 * Delete a memory entry
 */
export const deleteMemory = mutation({
    args: {
        key: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            throw new Error("Authentication required");
        }

        const memory: Doc<"agentMemory"> | null = await ctx.db
            .query("agentMemory")
            .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", args.key))
            .first();

        if (!memory) {
            throw new Error("Memory entry not found");
        }

        if (memory.userId !== userId) {
            throw new Error("Access denied");
        }

        await ctx.db.delete(memory._id);
        return null;
    },
});

/**
 * Service: Write memory (called by MCP server)
 */
export const writeMemoryAsService = mutation({
    args: {
        userId: v.id("users"),
        key: v.string(),
        content: v.string(),
        metadata: v.optional(v.any()),
        secret: v.string(),
    },
    returns: v.id("agentMemory"),
    handler: async (ctx, args) => {
        if (args.secret !== "nodebench_dev_secret") {
            throw new Error("Unauthorized: Invalid MCP secret");
        }

        const now = Date.now();
        const existing: Doc<"agentMemory"> | null = await ctx.db
            .query("agentMemory")
            .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                content: args.content,
                metadata: args.metadata,
                updatedAt: now,
            });
            return existing._id;
        } else {
            return await ctx.db.insert("agentMemory", {
                userId: args.userId,
                key: args.key,
                content: args.content,
                metadata: args.metadata,
                createdAt: now,
                updatedAt: now,
            });
        }
    },
});

/**
 * Service: Read memory (called by MCP server)
 */
export const readMemoryAsService = query({
    args: {
        userId: v.id("users"),
        key: v.string(),
        secret: v.string(),
    },
    returns: v.union(v.any(), v.null()),
    handler: async (ctx, args) => {
        if (args.secret !== "nodebench_dev_secret") {
            throw new Error("Unauthorized: Invalid MCP secret");
        }
        const memory = await ctx.db
            .query("agentMemory")
            .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
            .first();
        return memory;
    },
});

/**
 * Service: List memory (called by MCP server)
 */
export const listMemoryAsService = query({
    args: {
        userId: v.id("users"),
        limit: v.optional(v.number()),
        secret: v.string(),
    },
    returns: v.array(v.any()),
    handler: async (ctx, args) => {
        if (args.secret !== "nodebench_dev_secret") {
            throw new Error("Unauthorized: Invalid MCP secret");
        }
        const query = ctx.db
            .query("agentMemory")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .order("desc");

        return args.limit ? await query.take(args.limit) : await query.take(50);
    },
});

/**
 * Service: Delete memory (called by MCP server)
 */
export const deleteMemoryAsService = mutation({
    args: {
        userId: v.id("users"),
        key: v.string(),
        secret: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        if (args.secret !== "nodebench_dev_secret") {
            throw new Error("Unauthorized: Invalid MCP secret");
        }
        const memory: Doc<"agentMemory"> | null = await ctx.db
            .query("agentMemory")
            .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("key", args.key))
            .first();

        if (memory) {
            await ctx.db.delete(memory._id);
        }
        return null;
    },
});

/**
 * Query episodic memory entries for a given run/thread
 */
export const getEpisodicByRunId = query({
    args: {
        runId: v.string(),
        limit: v.optional(v.number()),
    },
    returns: v.array(v.object({
        _id: v.id("agentEpisodicMemory"),
        runId: v.string(),
        userId: v.id("users"),
        ts: v.number(),
        tags: v.optional(v.array(v.string())),
        data: v.any(),
    })),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return [];

        const limit = args.limit ?? 50;
        const items = await ctx.db
            .query("agentEpisodicMemory")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .order("desc")
            .take(limit);

        return items
            .filter((e) => e.userId === userId)
            .map(projectAgentEpisodicSummary);
    },
});

/**
 * Append an episodic memory entry for a run/thread
 */
export const logEpisodic = mutation({
    args: {
        runId: v.string(),
        tags: v.optional(v.array(v.string())),
        data: v.any(),
    },
    returns: v.id("agentEpisodicMemory"),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");

        const now = Date.now();
        const id = await ctx.db.insert("agentEpisodicMemory", {
            runId: args.runId,
            userId,
            ts: now,
            tags: args.tags,
            data: args.data,
        });
        return id;
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// EVOLVING STRATEGIES - META-LEARNING SYSTEM
// Principle 9: Allow the agent to refine its behavior over time
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Outcome types for episodic entries
 */
export type OutcomeType = "success" | "partial" | "failure" | "timeout" | "error";

/**
 * Log an agent run outcome for meta-learning analysis
 * Tags the episodic entry with outcome metrics for pattern detection
 */
export const logAgentOutcome = mutation({
    args: {
        runId: v.string(),
        outcome: v.union(
            v.literal("success"),
            v.literal("partial"),
            v.literal("failure"),
            v.literal("timeout"),
            v.literal("error")
        ),
        toolsUsed: v.array(v.string()),
        stepCount: v.number(),
        durationMs: v.number(),
        userFeedback: v.optional(v.union(
            v.literal("positive"),
            v.literal("negative"),
            v.literal("neutral")
        )),
        errorMessage: v.optional(v.string()),
        queryType: v.optional(v.string()),
        metadata: v.optional(v.any()),
    },
    returns: v.id("agentEpisodicMemory"),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");

        const now = Date.now();
        return await ctx.db.insert("agentEpisodicMemory", {
            runId: args.runId,
            userId,
            ts: now,
            tags: ["outcome", args.outcome, ...(args.queryType ? [`query:${args.queryType}`] : [])],
            data: {
                type: "outcome",
                outcome: args.outcome,
                toolsUsed: args.toolsUsed,
                stepCount: args.stepCount,
                durationMs: args.durationMs,
                userFeedback: args.userFeedback,
                errorMessage: args.errorMessage,
                queryType: args.queryType,
                metadata: args.metadata,
            },
        });
    },
});

/**
 * Analyze episodic logs to detect success/failure patterns
 * Returns aggregated statistics for meta-learning
 */
export const analyzeOutcomePatterns = query({
    args: {
        lookbackDays: v.optional(v.number()),
        minSamples: v.optional(v.number()),
    },
    returns: v.object({
        totalRuns: v.number(),
        successRate: v.number(),
        avgDuration: v.number(),
        avgStepCount: v.number(),
        toolSuccessRates: v.array(v.object({
            tool: v.string(),
            successRate: v.number(),
            usageCount: v.number(),
        })),
        queryTypePatterns: v.array(v.object({
            queryType: v.string(),
            successRate: v.number(),
            avgDuration: v.number(),
            count: v.number(),
        })),
        failurePatterns: v.array(v.object({
            pattern: v.string(),
            count: v.number(),
            lastSeen: v.number(),
        })),
        recommendations: v.array(v.string()),
    }),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            return {
                totalRuns: 0,
                successRate: 0,
                avgDuration: 0,
                avgStepCount: 0,
                toolSuccessRates: [],
                queryTypePatterns: [],
                failurePatterns: [],
                recommendations: [],
            };
        }

        const lookbackMs = (args.lookbackDays ?? 30) * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - lookbackMs;

        // Get outcome entries
        const entries = await ctx.db
            .query("agentEpisodicMemory")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .filter((q) => q.gte(q.field("ts"), cutoff))
            .collect();

        const outcomes = entries.filter(e => e.data?.type === "outcome");

        if (outcomes.length === 0) {
            return {
                totalRuns: 0,
                successRate: 0,
                avgDuration: 0,
                avgStepCount: 0,
                toolSuccessRates: [],
                queryTypePatterns: [],
                failurePatterns: [],
                recommendations: ["Not enough data for pattern analysis"],
            };
        }

        // Calculate basic metrics
        const successCount = outcomes.filter(o => o.data.outcome === "success").length;
        const totalDuration = outcomes.reduce((sum, o) => sum + (o.data.durationMs ?? 0), 0);
        const totalSteps = outcomes.reduce((sum, o) => sum + (o.data.stepCount ?? 0), 0);

        // Tool success rates
        const toolStats = new Map<string, { success: number; total: number }>();
        for (const o of outcomes) {
            const tools = o.data.toolsUsed ?? [];
            const isSuccess = o.data.outcome === "success";
            for (const tool of tools) {
                const stat = toolStats.get(tool) ?? { success: 0, total: 0 };
                stat.total++;
                if (isSuccess) stat.success++;
                toolStats.set(tool, stat);
            }
        }

        // Query type patterns
        const queryStats = new Map<string, { success: number; total: number; duration: number }>();
        for (const o of outcomes) {
            const qt = o.data.queryType ?? "unknown";
            const stat = queryStats.get(qt) ?? { success: 0, total: 0, duration: 0 };
            stat.total++;
            stat.duration += o.data.durationMs ?? 0;
            if (o.data.outcome === "success") stat.success++;
            queryStats.set(qt, stat);
        }

        // Failure patterns
        const failurePatterns = new Map<string, { count: number; lastSeen: number }>();
        for (const o of outcomes) {
            if (o.data.outcome !== "success" && o.data.errorMessage) {
                const pattern = o.data.errorMessage.slice(0, 100);
                const existing = failurePatterns.get(pattern) ?? { count: 0, lastSeen: 0 };
                existing.count++;
                existing.lastSeen = Math.max(existing.lastSeen, o.ts);
                failurePatterns.set(pattern, existing);
            }
        }

        // Generate recommendations
        const recommendations: string[] = [];
        const successRate = successCount / outcomes.length;

        if (successRate < 0.7) {
            recommendations.push("Success rate is below 70% - consider reviewing common failure patterns");
        }

        // Find problematic tools
        for (const [tool, stat] of toolStats) {
            const toolSuccessRate = stat.success / stat.total;
            if (stat.total >= (args.minSamples ?? 5) && toolSuccessRate < 0.5) {
                recommendations.push(`Tool "${tool}" has low success rate (${(toolSuccessRate * 100).toFixed(0)}%) - may need improvement`);
            }
        }

        // Find slow query types
        for (const [qt, stat] of queryStats) {
            const avgDur = stat.duration / stat.total;
            if (stat.total >= (args.minSamples ?? 5) && avgDur > 30000) {
                recommendations.push(`Query type "${qt}" is slow (avg ${(avgDur / 1000).toFixed(1)}s) - consider optimization`);
            }
        }

        return {
            totalRuns: outcomes.length,
            successRate,
            avgDuration: totalDuration / outcomes.length,
            avgStepCount: totalSteps / outcomes.length,
            toolSuccessRates: Array.from(toolStats.entries()).map(([tool, stat]) => ({
                tool,
                successRate: stat.success / stat.total,
                usageCount: stat.total,
            })).sort((a, b) => b.usageCount - a.usageCount),
            queryTypePatterns: Array.from(queryStats.entries()).map(([queryType, stat]) => ({
                queryType,
                successRate: stat.success / stat.total,
                avgDuration: stat.duration / stat.total,
                count: stat.total,
            })).sort((a, b) => b.count - a.count),
            failurePatterns: Array.from(failurePatterns.entries()).map(([pattern, stat]) => ({
                pattern,
                count: stat.count,
                lastSeen: stat.lastSeen,
            })).sort((a, b) => b.count - a.count).slice(0, 10),
            recommendations,
        };
    },
});

/**
 * Store a learned strategy refinement
 * Used to persist improvements discovered through meta-learning
 */
export const storeStrategyRefinement = mutation({
    args: {
        refinementType: v.union(
            v.literal("tool_preference"),
            v.literal("query_routing"),
            v.literal("prompt_adjustment"),
            v.literal("timeout_tuning"),
            v.literal("fallback_strategy")
        ),
        key: v.string(),
        oldValue: v.optional(v.string()),
        newValue: v.string(),
        reason: v.string(),
        confidence: v.number(),
        basedOnSamples: v.number(),
    },
    returns: v.id("agentMemory"),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");

        const now = Date.now();
        const key = `strategy:${args.refinementType}:${args.key}`;

        const existing: Doc<"agentMemory"> | null = await ctx.db
            .query("agentMemory")
            .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", key))
            .first();

        const content = JSON.stringify({
            value: args.newValue,
            reason: args.reason,
            confidence: args.confidence,
            basedOnSamples: args.basedOnSamples,
            previousValue: args.oldValue,
        });

        if (existing) {
            await ctx.db.patch(existing._id, {
                content,
                metadata: {
                    refinementType: args.refinementType,
                    confidence: args.confidence,
                    updatedAt: now,
                },
                updatedAt: now,
            });
            return existing._id;
        } else {
            return await ctx.db.insert("agentMemory", {
                userId,
                key,
                content,
                metadata: {
                    refinementType: args.refinementType,
                    confidence: args.confidence,
                    createdAt: now,
                },
                createdAt: now,
                updatedAt: now,
            });
        }
    },
});

/**
 * Get learned strategy refinements for applying to agent behavior
 */
export const getStrategyRefinements = query({
    args: {
        refinementType: v.optional(v.union(
            v.literal("tool_preference"),
            v.literal("query_routing"),
            v.literal("prompt_adjustment"),
            v.literal("timeout_tuning"),
            v.literal("fallback_strategy")
        )),
        minConfidence: v.optional(v.number()),
    },
    returns: v.array(v.object({
        key: v.string(),
        refinementType: v.string(),
        value: v.string(),
        confidence: v.number(),
        reason: v.string(),
    })),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return [];

        const memories = await ctx.db
            .query("agentMemory")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect();

        const refinements = memories
            .filter(m => m.key.startsWith("strategy:"))
            .map(m => {
                try {
                    const parsed = JSON.parse(m.content);
                    const parts = m.key.split(":");
                    return {
                        key: parts.slice(2).join(":"),
                        refinementType: parts[1],
                        value: parsed.value,
                        confidence: parsed.confidence ?? 0,
                        reason: parsed.reason ?? "",
                    };
                } catch {
                    return null;
                }
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .filter(r => {
                if (args.refinementType && r.refinementType !== args.refinementType) return false;
                if (args.minConfidence && r.confidence < args.minConfidence) return false;
                return true;
            });

        return refinements;
    },
});
