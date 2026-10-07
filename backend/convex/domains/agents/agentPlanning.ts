/**
 * Agent Planning - Backend functions for task planning
 * 
 * This module provides mutations and queries for the Deep Agents planning system.
 * Plans are stored in the agentPlans table and can be created, updated, and retrieved.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { projectAgentPlanSummary } from "./agentPlanSummary";

// Step type for type inference
type PlanStep = {
    description: string;
    status?: "pending" | "in_progress" | "completed";
};


/**
 * Create a new agent plan
 */
export const createPlan = mutation({
    args: {
        goal: v.string(),
        steps: v.array(v.object({
            description: v.string(),
            status: v.optional(v.union(
                v.literal("pending"),
                v.literal("in_progress"),
                v.literal("completed")
            )),
        })),
    },
    returns: v.id("agentPlans"),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            throw new Error("Authentication required");
        }

        const now = Date.now();

        // Normalize steps to ensure all have a status
        const normalizedSteps = args.steps.map((step: PlanStep) => ({
            description: step.description,
            status: step.status || "pending" as const,
        }));

        const planId = await ctx.db.insert("agentPlans", {
            userId,
            goal: args.goal,
            steps: normalizedSteps,
            createdAt: now,
            updatedAt: now,
        });

        return planId;
    },
});

/**
 * Update a step in an existing plan
 */
export const updatePlanStep = mutation({
    args: {
        planId: v.id("agentPlans"),
        stepIndex: v.number(),
        status: v.union(
            v.literal("pending"),
            v.literal("in_progress"),
            v.literal("completed")
        ),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            throw new Error("Authentication required");
        }

        const plan = await ctx.db.get(args.planId) as Doc<"agentPlans"> | null;
        if (!plan) {
            throw new Error("Plan not found");
        }

        if (plan.userId !== userId) {
            throw new Error("Access denied");
        }

        if (args.stepIndex < 0 || args.stepIndex >= plan.steps.length) {
            throw new Error(`Invalid step index: ${args.stepIndex}`);
        }

        // Update the specific step
        const updatedSteps = [...plan.steps];
        updatedSteps[args.stepIndex] = {
            ...updatedSteps[args.stepIndex],
            status: args.status,
        };

        await ctx.db.patch(args.planId, {
            steps: updatedSteps,
            updatedAt: Date.now(),
        });

        return null;
    },
});

/**
 * Get a plan by ID
 */
export const getPlan = query({
    args: {
        planId: v.id("agentPlans"),
    },
    returns: v.union(
        v.object({
            _id: v.id("agentPlans"),
            userId: v.id("users"),
            goal: v.string(),
            steps: v.array(v.object({
                description: v.string(),
                status: v.union(
                    v.literal("pending"),
                    v.literal("in_progress"),
                    v.literal("completed")
                ),
            })),
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

        const plan = await ctx.db.get(args.planId) as Doc<"agentPlans"> | null;
        if (!plan || plan.userId !== userId) {
            return null;
        }

        return projectAgentPlanSummary(plan);
    },
});

/**
 * List all plans for the current user
 */
export const listPlans = query({
    args: {
        limit: v.optional(v.number()),
    },
    returns: v.array(v.object({
        _id: v.id("agentPlans"),
        userId: v.id("users"),
        goal: v.string(),
        steps: v.array(v.object({
            description: v.string(),
            status: v.union(
                v.literal("pending"),
                v.literal("in_progress"),
                v.literal("completed")
            ),
        })),
        createdAt: v.number(),
        updatedAt: v.number(),
    })),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            return [];
        }

        const query = ctx.db
            .query("agentPlans")
            .withIndex("by_user_updated", (q) => q.eq("userId", userId))
            .order("desc");

        const plans = args.limit
            ? await query.take(args.limit)
            : await query.take(20);

        return plans.map(projectAgentPlanSummary);
    },
});

/**
 * Delete a plan
 */
export const deletePlan = mutation({
    args: {
        planId: v.id("agentPlans"),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) {
            throw new Error("Authentication required");
        }

        const plan = await ctx.db.get(args.planId) as Doc<"agentPlans"> | null;
        if (!plan) {
            throw new Error("Plan not found");
        }

        if (plan.userId !== userId) {
            throw new Error("Access denied");
        }

        await ctx.db.delete(args.planId);
        return null;
    },
});

/**
 * Service: Create a new agent plan (called by MCP server)
 */
export const createPlanAsService = mutation({
    args: {
        userId: v.id("users"),
        goal: v.string(),
        steps: v.array(v.object({
            description: v.string(),
            status: v.optional(v.union(
                v.literal("pending"),
                v.literal("in_progress"),
                v.literal("completed")
            )),
        })),
        secret: v.string(),
    },
    returns: v.id("agentPlans"),
    handler: async (ctx, args) => {
        if (args.secret !== "nodebench_dev_secret") {
            throw new Error("Unauthorized: Invalid MCP secret");
        }

        const now = Date.now();
        const normalizedSteps = args.steps.map((step: PlanStep) => ({
            description: step.description,
            status: step.status || "pending" as const,
        }));

        const planId = await ctx.db.insert("agentPlans", {
            userId: args.userId,
            goal: args.goal,
            steps: normalizedSteps,
            createdAt: now,
            updatedAt: now,
        });

        return planId;
    },
});

/**
 * Service: Update a step (called by MCP server)
 */
export const updatePlanStepAsService = mutation({
    args: {
        userId: v.id("users"),
        planId: v.id("agentPlans"),
        stepIndex: v.number(),
        status: v.union(
            v.literal("pending"),
            v.literal("in_progress"),
            v.literal("completed")
        ),
        secret: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        if (args.secret !== "nodebench_dev_secret") {
            throw new Error("Unauthorized: Invalid MCP secret");
        }

        const plan = await ctx.db.get(args.planId) as Doc<"agentPlans"> | null;
        if (!plan) throw new Error("Plan not found");
        if (plan.userId !== args.userId) throw new Error("Access denied");

        const updatedSteps = [...plan.steps];
        if (args.stepIndex < 0 || args.stepIndex >= updatedSteps.length) {
            throw new Error("Invalid step index");
        }

        updatedSteps[args.stepIndex] = {
            ...updatedSteps[args.stepIndex],
            status: args.status,
        };

        await ctx.db.patch(args.planId, {
            steps: updatedSteps,
            updatedAt: Date.now(),
        });

        return null;
    },
});

/**
 * Service: Get a plan (called by MCP server)
 */
export const getPlanAsService = query({
    args: {
        userId: v.id("users"),
        planId: v.id("agentPlans"),
        secret: v.string(),
    },
    returns: v.union(v.any(), v.null()),
    handler: async (ctx, args) => {
        if (args.secret !== "nodebench_dev_secret") {
            throw new Error("Unauthorized: Invalid MCP secret");
        }
        const plan = await ctx.db.get(args.planId) as Doc<"agentPlans"> | null;
        if (!plan || plan.userId !== args.userId) return null;
        return plan;
    },
});
