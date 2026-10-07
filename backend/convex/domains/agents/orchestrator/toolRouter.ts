/**
 * Tool Router with Health-Aware Routing
 * 
 * Wraps tool execution with:
 * - Circuit breaker checks (via toolHealth table)
 * - Automatic telemetry recording (success/failure)
 * - Retry with exponential backoff
 * - Graceful fallback when circuit is open
 */

import { v } from "convex/values";
import { internalAction, internalMutation, action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Doc } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolResult<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
    fallback?: boolean;
    latencyMs?: number;
}

interface RetryConfig {
    maxAttempts: number;
    initialBackoffMs: number;
    backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: 3,
    initialBackoffMs: 1000,
    backoffMultiplier: 2,
};

// ═══════════════════════════════════════════════════════════════════════════
// Core Router Logic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a tool's circuit breaker is open (blocking calls)
 */
export const isCircuitOpen = internalAction({
    args: { toolName: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args): Promise<boolean> => {
        const health = await ctx.runQuery(internal.domains.agents.orchestrator.toolHealth.getToolHealth, {
            toolName: args.toolName,
        });
        return health?.circuitOpen ?? false;
    },
});

/**
 * Execute a tool with health-aware routing.
 * 
 * This is the main entry point for routed tool execution.
 * It checks circuit breaker state, executes the tool, and records telemetry.
 */
export const executeWithRouting = internalAction({
    args: {
        toolName: v.string(),
        toolArgs: v.any(),
        agentId: v.optional(v.string()),
        missionId: v.optional(v.id("missions")),
        spendLimitUsd: v.optional(v.number()),
        gatePrompt: v.optional(v.string()),
        gateContext: v.optional(v.string()),
        gateMissionType: v.optional(v.string()),
        retryConfig: v.optional(v.object({
            maxAttempts: v.number(),
            initialBackoffMs: v.number(),
            backoffMultiplier: v.number(),
        })),
    },
    returns: v.object({
        ok: v.boolean(),
        data: v.optional(v.any()),
        error: v.optional(v.string()),
        fallback: v.optional(v.boolean()),
        latencyMs: v.optional(v.number()),
    }),
    handler: async (ctx, args): Promise<ToolResult> => {
        const config = args.retryConfig ?? DEFAULT_RETRY_CONFIG;

        // Pre-execution judgment gate (optional)
        if (args.gatePrompt) {
            try {
                const gate = await ctx.runAction(
                    internal.domains.missions.preExecutionGate.evaluatePreExecutionGate,
                    {
                        prompt: args.gatePrompt,
                        missionId: args.missionId,
                        missionType: args.gateMissionType,
                        context: args.gateContext,
                    }
                );

                if (gate.decision === "skip" || gate.decision === "escalate") {
                    return {
                        ok: false,
                        error: `Pre-execution gate ${gate.decision}: ${gate.reasoning}`,
                    };
                }
            } catch (err) {
                return {
                    ok: false,
                    error: `Pre-execution gate error: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
        }

        // Passport enforcement (if agentId provided)
        if (args.agentId) {
            try {
                const passport = await ctx.runAction(
                    internal.domains.agents.orchestrator.passportEnforcement.enforcePassport,
                    {
                        agentId: args.agentId,
                        toolName: args.toolName,
                        missionId: args.missionId,
                        spendLimitUsd: args.spendLimitUsd,
                    }
                );
                if (passport.decision === "denied" || passport.decision === "escalated") {
                    return {
                        ok: false,
                        error: `Passport ${passport.decision}: ${passport.reason}`,
                    };
                }
            } catch (err) {
                // Fail-closed: deny on passport check failure
                return {
                    ok: false,
                    error: `Passport enforcement error: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
        }

        // Check circuit breaker
        const circuitOpen = await ctx.runAction(internal.domains.agents.orchestrator.toolRouter.isCircuitOpen, {
            toolName: args.toolName,
        });

        if (circuitOpen) {
            return {
                ok: false,
                error: `Tool "${args.toolName}" circuit is open - service temporarily unavailable`,
                fallback: true,
            };
        }

        // Execute with retry logic
        let lastError: string | undefined;
        let attempt = 0;

        while (attempt < config.maxAttempts) {
            const startTime = Date.now();

            try {
                // Dispatch to actual tool implementation
                const result = await dispatchTool(ctx, args.toolName, args.toolArgs);
                const latencyMs = Date.now() - startTime;

                // Record success
                await ctx.runMutation(internal.domains.agents.orchestrator.toolHealth.recordToolSuccess, {
                    toolName: args.toolName,
                    latencyMs,
                });

                return {
                    ok: true,
                    data: result,
                    latencyMs,
                };
            } catch (err) {
                const latencyMs = Date.now() - startTime;
                lastError = err instanceof Error ? err.message : String(err);

                // Record failure
                const { circuitOpen: nowOpen } = await ctx.runMutation(
                    internal.domains.agents.orchestrator.toolHealth.recordToolFailure,
                    {
                        toolName: args.toolName,
                        latencyMs,
                        error: lastError,
                    }
                );

                // If circuit just opened, stop retrying
                if (nowOpen) {
                    return {
                        ok: false,
                        error: `Tool "${args.toolName}" failed and circuit breaker opened: ${lastError}`,
                        fallback: true,
                        latencyMs,
                    };
                }

                attempt++;

                // Exponential backoff before retry
                if (attempt < config.maxAttempts) {
                    const backoffMs = config.initialBackoffMs * Math.pow(config.backoffMultiplier, attempt - 1);
                    await sleep(backoffMs);
                }
            }
        }

        return {
            ok: false,
            error: `Tool "${args.toolName}" failed after ${config.maxAttempts} attempts: ${lastError}`,
        };
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Tool Dispatcher
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dispatch to the actual tool implementation based on tool name.
 * Add new tools here as they are integrated.
 */
async function dispatchTool(ctx: any, toolName: string, args: any): Promise<unknown> {
    // Tool registry - maps tool names to their internal action references
    const toolRegistry: Record<string, { action: any; transform?: (args: any) => any }> = {
        // SEC EDGAR Tools
        "secFilings": { action: internal.domains.agents.orchestrator.secEdgarWrapper.searchFilings },
        "secCompanyInfo": { action: internal.domains.agents.orchestrator.secEdgarWrapper.getCompanyInfo },

        // Gemini Video Transcription
        "geminiTranscribe": { action: internal.domains.agents.orchestrator.geminiVideoWrapper.transcribeVideo },

        // Add more tools as they are integrated:
        // "fusionSearch": { action: internal.tools.fusionSearch.search },
        // "linkupSearch": { action: internal.tools.linkup.linkupSearch },
    };

    const tool = toolRegistry[toolName];

    if (!tool) {
        throw new Error(`Unknown tool: ${toolName}. Register it in toolRouter.ts dispatchTool()`);
    }

    const transformedArgs = tool.transform ? tool.transform(args) : args;
    return await ctx.runAction(tool.action, transformedArgs);
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get health status for all tools (for monitoring dashboard)
 */
export const getAllToolHealth = internalAction({
    args: {},
    returns: v.array(v.any()),
    handler: async (ctx): Promise<unknown[]> => {
        // Query all tool health records
        const health = await ctx.runQuery(internal.domains.agents.orchestrator.toolRouter.queryAllHealth, {});
        return health;
    },
});

export const queryAllHealth = internalMutation({
    args: {},
    returns: v.array(v.any()),
    handler: async (ctx): Promise<unknown[]> => {
        return await ctx.db.query("toolHealth").collect();
    },
});

/**
 * Manually reset a tool's circuit breaker (for admin use)
 */
export const resetCircuitBreaker = internalMutation({
    args: { toolName: v.string() },
    returns: v.boolean(),
    handler: async (ctx, args): Promise<boolean> => {
        const existing = await ctx.db
            .query("toolHealth")
            .withIndex("by_toolName", (q) => q.eq("toolName", args.toolName))
            .first() as Doc<"toolHealth"> | null;

        if (!existing) {
            return false;
        }

        await ctx.db.patch(existing._id, {
            circuitOpen: false,
            circuitOpenedAt: undefined,
            consecutiveFailures: 0,
        });

        return true;
    },
});
