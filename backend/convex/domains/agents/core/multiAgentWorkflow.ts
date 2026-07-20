import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id, Doc } from "../../../_generated/dataModel";

/**
 * Workflow metrics type for tracking sources, tools, and agents
 */
export interface WorkflowMetrics {
    sourcesExplored: number;
    toolsUsed: string[];
    agentsCalled: string[];
    totalDurationMs: number;
    startedAt: number;
}

/**
 * Entry point for the multi-agent workflow.
 * Called by fastAgentPanelStreaming.ts when "complex" mode is selected.
 */
export const startMultiAgentWorkflowInternal = internalAction({
    args: {
        prompt: v.string(),
        threadId: v.id("chatThreadsStream"),
        includeMedia: v.optional(v.boolean()),
        includeFilings: v.optional(v.boolean()),
        userId: v.string(),
    },
    returns: v.object({ workflowId: v.id("chatThreadsStream") }),
    handler: async (ctx, args): Promise<{ workflowId: Id<"chatThreadsStream"> }> => {
        console.log(`[multiAgentWorkflow] 🚀 Starting workflow for thread ${args.threadId}`);

        // Schedule the workflow via mutation to ensure we can write the initial status message
        // and schedule the long-running action safely.
        const workflowId = await ctx.runMutation(internal.domains.agents.core.multiAgentWorkflow.scheduleWorkflow, {
            prompt: args.prompt,
            threadId: args.threadId,
            includeMedia: args.includeMedia,
            includeFilings: args.includeFilings,
            userId: args.userId,
        }) as Id<"chatThreadsStream">;

        return { workflowId };
    },
});

/**
 * Schedules the long-running workflow action and creates the initial status message.
 */
export const scheduleWorkflow = internalMutation({
    args: {
        prompt: v.string(),
        threadId: v.id("chatThreadsStream"),
        userId: v.string(),
        includeMedia: v.optional(v.boolean()),
        includeFilings: v.optional(v.boolean()),
    },
    handler: async (ctx, args): Promise<Id<"chatThreadsStream">> => {
        const startTime = Date.now();
        
        // Create the initial progress state with metrics
        const initialProgress = {
            type: "deep_agent_progress",
            steps: [
                { label: "Analyzing Request", status: "in_progress" },
                { label: "Orchestrating Agents", status: "pending" },
                { label: "Synthesizing Intelligence", status: "pending" }
            ],
            metrics: {
                sourcesExplored: 0,
                toolsUsed: [],
                agentsCalled: [],
                totalDurationMs: 0,
                startedAt: startTime,
            }
        };

        // Update the thread with the progress state
        await ctx.db.patch(args.threadId, {
            workflowProgress: initialProgress,
            updatedAt: startTime
        });

        console.log(`[multiAgentWorkflow] 📅 Scheduling runWorkflow for ${args.threadId}`);

        await ctx.scheduler.runAfter(0, internal.domains.agents.core.multiAgentWorkflow.runWorkflow, {
            prompt: args.prompt,
            threadId: args.threadId,
            userId: args.userId,
            includeMedia: args.includeMedia,
            includeFilings: args.includeFilings,
        });

        return args.threadId;
    },
});

/**
 * The worker action that runs the Coordinator Agent.
 */
export const runWorkflow = internalAction({
    args: {
        prompt: v.string(),
        threadId: v.id("chatThreadsStream"),
        userId: v.string(),
        includeMedia: v.optional(v.boolean()),
        includeFilings: v.optional(v.boolean()),
    },
    returns: v.null(),
    handler: async (ctx, args): Promise<null> => {
        console.log(`[multiAgentWorkflow] 🏃 Running Coordinator Agent for ${args.threadId}`);

        // Helper to update progress
        const updateProgress = async (steps: any[]) => {
            await ctx.runMutation(internal.domains.agents.core.multiAgentWorkflow.updateWorkflowProgress, {
                threadId: args.threadId,
                steps,
            });
        };

        try {
            // 1. Update: Analyzing Done, Orchestrating Started
            await updateProgress([
                { label: "Analyzing Request", status: "completed" },
                { label: "Orchestrating Agents", status: "in_progress", details: "Identifying required specialists..." },
                { label: "Synthesizing Intelligence", status: "pending" }
            ]);

            // Use model catalog for consistent model selection
            const { getLlmModel } = await import("../../../../shared/llm/modelCatalog");
            const coordinatorModel = getLlmModel("agent", "openai");
            const { createCoordinatorAgent } = await import("./coordinatorAgent");
            const coordinator = createCoordinatorAgent(coordinatorModel);

            // Get agent thread ID
            const threadInfo = await ctx.runQuery(internal.domains.agents.core.multiAgentWorkflow.getAgentThreadId, {
                threadId: args.threadId
            });

            if (!threadInfo) {
                throw new Error(`Thread not found: ${args.threadId}`);
            }

            // Run the agent
            // Use generateText to run the coordinator and persist output to the agent thread
            const result = await coordinator.generateText(
                ctx,
                { threadId: threadInfo.agentThreadId, userId: args.userId },
                { prompt: args.prompt }
            );

            // 2. Update: Orchestrating Done, Synthesizing Started
            await updateProgress([
                { label: "Analyzing Request", status: "completed" },
                { label: "Orchestrating Agents", status: "completed" },
                { label: "Synthesizing Intelligence", status: "in_progress", details: "Compiling final dossier..." }
            ]);

            // 3. Finalize: All Done
            await updateProgress([
                { label: "Analyzing Request", status: "completed" },
                { label: "Orchestrating Agents", status: "completed" },
                { label: "Synthesizing Intelligence", status: "completed" }
            ]);

            console.log(`[multiAgentWorkflow] ✅ Coordinator finished`);

        } catch (error: any) {
            console.error(`[multiAgentWorkflow] 💥 Coordinator failed`, error);

            // Mark as error
            await updateProgress([
                { label: "Analyzing Request", status: "completed" },
                { label: "Orchestrating Agents", status: "error", details: error.message },
                { label: "Synthesizing Intelligence", status: "pending" }
            ]);
        }

        return null;
    },
});

// Helper query to get agentThreadId since actions can't read DB directly
export const getAgentThreadId = internalQuery({
    args: { threadId: v.id("chatThreadsStream") },
    handler: async (ctx, args) => {
        const thread = await ctx.db.get(args.threadId) as Doc<"chatThreadsStream"> | null;
        return thread ? { agentThreadId: thread.agentThreadId } : null;
    }
});

// Helper mutation to update progress in thread
export const updateWorkflowProgress = internalMutation({
    args: {
        threadId: v.id("chatThreadsStream"),
        steps: v.any(),
        metrics: v.optional(v.object({
            sourcesExplored: v.optional(v.number()),
            toolsUsed: v.optional(v.array(v.string())),
            agentsCalled: v.optional(v.array(v.string())),
            totalDurationMs: v.optional(v.number()),
        })),
    },
    handler: async (ctx, args) => {
        // Get existing progress to merge metrics
        const thread = await ctx.db.get(args.threadId) as Doc<"chatThreadsStream"> | null;
        const existingProgress = (thread?.workflowProgress) || {};
        const existingMetrics = existingProgress.metrics || {
            sourcesExplored: 0,
            toolsUsed: [],
            agentsCalled: [],
            totalDurationMs: 0,
            startedAt: Date.now(),
        };

        // Merge new metrics with existing
        const updatedMetrics = args.metrics ? {
            sourcesExplored: (args.metrics.sourcesExplored ?? 0) + existingMetrics.sourcesExplored,
            toolsUsed: [...new Set([...existingMetrics.toolsUsed, ...(args.metrics.toolsUsed || [])])],
            agentsCalled: [...new Set([...existingMetrics.agentsCalled, ...(args.metrics.agentsCalled || [])])],
            totalDurationMs: args.metrics.totalDurationMs ?? (Date.now() - existingMetrics.startedAt),
            startedAt: existingMetrics.startedAt,
        } : existingMetrics;

        const workflowProgress = {
            type: "deep_agent_progress",
            steps: args.steps,
            metrics: updatedMetrics,
        };
        await ctx.db.patch(args.threadId, {
            workflowProgress,
            updatedAt: Date.now()
        });
    }
});

// Helper mutation to increment metrics (for tool calls, sources, etc.)
export const incrementWorkflowMetrics = internalMutation({
    args: {
        threadId: v.id("chatThreadsStream"),
        sourcesExplored: v.optional(v.number()),
        toolName: v.optional(v.string()),
        agentName: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const thread = await ctx.db.get(args.threadId) as Doc<"chatThreadsStream"> | null;
        if (!thread) return;

        const existingProgress = (thread.workflowProgress) || {};
        const existingMetrics = existingProgress.metrics || {
            sourcesExplored: 0,
            toolsUsed: [],
            agentsCalled: [],
            totalDurationMs: 0,
            startedAt: Date.now(),
        };

        // Increment metrics
        const updatedMetrics = {
            ...existingMetrics,
            sourcesExplored: existingMetrics.sourcesExplored + (args.sourcesExplored || 0),
            toolsUsed: args.toolName 
                ? [...new Set([...existingMetrics.toolsUsed, args.toolName])]
                : existingMetrics.toolsUsed,
            agentsCalled: args.agentName
                ? [...new Set([...existingMetrics.agentsCalled, args.agentName])]
                : existingMetrics.agentsCalled,
            totalDurationMs: Date.now() - existingMetrics.startedAt,
        };

        await ctx.db.patch(args.threadId, {
            workflowProgress: {
                ...existingProgress,
                metrics: updatedMetrics,
            },
            updatedAt: Date.now()
        });
    }
});
