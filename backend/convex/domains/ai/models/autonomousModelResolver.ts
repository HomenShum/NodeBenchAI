/**
 * Autonomous Model Resolver - Free Model Selection for Autonomous Operations
 * Deep Agents 3.0
 *
 * Provides model selection and fallback chain specifically for autonomous agents.
 * Uses free models by default with intelligent fallback to paid models if needed.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  internalMutation,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { Doc } from "../../../_generated/dataModel";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Autonomous model selection configuration
 */
export const AUTONOMOUS_MODEL_CONFIG = {
  /** Use free models for autonomous operations by default */
  preferFreeModels: true,

  /** Maximum retries before falling back to paid model */
  maxFreeModelRetries: 3,

  /** Known good baseline OpenRouter models (verified Feb 5, 2026).
   * Uses actual ":free" slugs so $0 cost. Updated by freeModelDiscovery scanner. */
  knownFreeModels: [
    "qwen/qwen3-coder:free",                          // 480B MoE, agentic coding, 262K
    "stepfun/step-3.5-flash:free",                     // 196B MoE, reasoning + tools
    "openai/gpt-oss-120b:free",                        // OpenAI open-source 120B
    "arcee-ai/trinity-large-preview:free",             // 400B MoE, agentic
    "nvidia/nemotron-3-nano-30b-a3b:free",             // 30B A3B, 256K
    "meta-llama/llama-3.3-70b-instruct:free",          // Meta 70B, proven
  ] as const,

  /** Paid model fallback chain (used only if all free models fail) */
  paidFallbackChain: [
    "gemini-3-flash-preview", // Cheapest current Google lane
    "deepseek-v3.2",          // Very cheap
    "qwen3-235b",             // Cheap
    "gpt-5.4-mini",           // Efficient OpenAI fallback
      "claude-haiku-4.5",       // Slightly more expensive but reliable
  ] as const,

  /** Task type to model requirements mapping */
  taskRequirements: {
    research: { minContext: 16000, toolUse: false },
    synthesis: { minContext: 32000, toolUse: false },
    publishing: { minContext: 8000, toolUse: false },
    validation: { minContext: 16000, toolUse: false },
    agentLoop: { minContext: 32000, toolUse: true },
  },

  /** Timeout for model calls (ms) */
  modelTimeoutMs: 60_000,

  /** Rate limit tracking window (ms) */
  rateLimitWindowMs: 60_000,

  /** Max requests per minute for free models */
  freeModelRateLimit: 20,

  /** Retry configuration for transient errors (429/503) */
  retry: {
    /** Max retries per model for 429/503 errors */
    maxRetries: 3,
    /** Base delay in ms (will be multiplied by attempt number + jitter) */
    baseDelayMs: 1000,
    /** Max jitter in ms to add randomness */
    maxJitterMs: 500,
    /** HTTP status codes that trigger retry */
    retryableStatuses: [429, 503, 502, 504] as const,
  },
} as const;

export type AutonomousTaskType = keyof typeof AUTONOMOUS_MODEL_CONFIG.taskRequirements;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelSelectionResult {
  modelId: string;
  provider: "openrouter" | "native";
  isFree: boolean;
  fallbackLevel: number; // 0 = primary, 1+ = fallback
}

export interface AutonomousModelUsage {
  modelId: string;
  taskType: AutonomousTaskType;
  success: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cost: number;
  error?: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL SELECTION QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the best model for an autonomous task
 */
export const selectModelForTask = internalQuery({
  args: {
    taskType: v.string(),
    requireToolUse: v.optional(v.boolean()),
    requireVision: v.optional(v.boolean()),
  },
  handler: async (ctx, { taskType, requireToolUse, requireVision }): Promise<ModelSelectionResult> => {
    const requirements = AUTONOMOUS_MODEL_CONFIG.taskRequirements[
      taskType as AutonomousTaskType
    ] ?? { minContext: 8000, toolUse: false };

    const needsToolUse = requireToolUse ?? requirements.toolUse;
    const needsVision = Boolean(requireVision);

    // Try to get best free model from discovery system
    if (AUTONOMOUS_MODEL_CONFIG.preferFreeModels) {
      const rankedFree = await ctx.db
        .query("freeModels")
        .withIndex("by_rank")
        .filter((q) => q.eq(q.field("isActive"), true))
        .take(20) as Doc<"freeModels">[];

      const matchesRequirements = (m: Doc<"freeModels">) =>
        m.contextLength >= requirements.minContext &&
        (!needsToolUse || m.capabilities.toolUse) &&
        (!needsVision || m.capabilities.vision);

      // Prefer non-vision models for text-only tasks to avoid vision-first models dominating rank.
      const bestFree =
        (!needsVision ? rankedFree.find((m) => matchesRequirements(m) && !m.capabilities.vision) : null) ??
        rankedFree.find((m) => matchesRequirements(m)) ??
        null;

      if (bestFree) {
        return {
          modelId: bestFree.openRouterId,
          provider: "openrouter",
          isFree: true,
          fallbackLevel: 0,
        };
      }

      // If vision is required and no free vision model is available, fall back to a native paid model.
      if (needsVision) {
        return {
          modelId: AUTONOMOUS_MODEL_CONFIG.paidFallbackChain[0],
          provider: "native",
          isFree: false,
          fallbackLevel: 0,
        };
      }

      // Fall back to known free models (text-only chain)
      return {
        modelId: AUTONOMOUS_MODEL_CONFIG.knownFreeModels[0],
        provider: "openrouter",
        isFree: true,
        fallbackLevel: 1,
      };
    }

    // Default to paid fallback
    return {
      modelId: AUTONOMOUS_MODEL_CONFIG.paidFallbackChain[0],
      provider: "native",
      isFree: false,
      fallbackLevel: 0,
    };
  },
});

/**
 * Get the full fallback chain for autonomous operations
 */
export const getAutonomousFallbackChain = internalQuery({
  args: {
    taskType: v.string(),
    requireVision: v.optional(v.boolean()),
  },
  handler: async (ctx, { taskType, requireVision }): Promise<ModelSelectionResult[]> => {
    const chain: ModelSelectionResult[] = [];
    const needsVision = Boolean(requireVision);

    // For text-only tasks, start with known good free models (PROVEN) before "discovered" models.
    // Discovered models can be mis-ranked and degrade output quality for publishing/validation.
    if (!needsVision) {
      for (const knownFree of AUTONOMOUS_MODEL_CONFIG.knownFreeModels) {
        chain.push({
          modelId: knownFree,
          provider: "openrouter",
          isFree: true,
          fallbackLevel: chain.length,
        });
      }
    }

    // Add discovered free models next
    const freeModels = await ctx.db
      .query("freeModels")
      .withIndex("by_rank")
      .filter((q) => q.eq(q.field("isActive"), true))
      .take(12) as Doc<"freeModels">[];

    const preferred: Doc<"freeModels">[] = [];
    const nonPreferred: Doc<"freeModels">[] = [];
    for (const m of freeModels) {
      if (needsVision) {
        if (!m.capabilities.vision) continue;
        preferred.push(m);
        continue;
      }
      // For text tasks, prefer non-vision models first.
      (m.capabilities.vision ? nonPreferred : preferred).push(m);
    }

    for (const m of [...preferred, ...nonPreferred]) {
      if (chain.some((c) => c.modelId === m.openRouterId)) continue;
      chain.push({
        modelId: m.openRouterId,
        provider: "openrouter",
        isFree: true,
        fallbackLevel: chain.length,
      });
    }

    // Add paid fallback chain last
    for (const paid of AUTONOMOUS_MODEL_CONFIG.paidFallbackChain) {
      chain.push({
        modelId: paid,
        provider: "native",
        isFree: false,
        fallbackLevel: chain.length,
      });
    }

    return chain;
  },
});

/**
 * Get autonomous model usage statistics
 */
export const getAutonomousModelStats = internalQuery({
  args: {
    hours: v.optional(v.number()),
  },
  handler: async (ctx, { hours = 24 }) => {
    const since = Date.now() - hours * 60 * 60 * 1000;

    const usages = await ctx.db
      .query("autonomousModelUsage")
      .withIndex("by_timestamp")
      .filter((q) => q.gte(q.field("timestamp"), since))
      .collect() as Doc<"autonomousModelUsage">[];

    const stats = {
      totalCalls: usages.length,
      successCalls: usages.filter((u) => u.success).length,
      failedCalls: usages.filter((u) => !u.success).length,
      totalCost: usages.reduce((sum, u) => sum + u.cost, 0),
      freeCalls: usages.filter((u) => u.cost === 0).length,
      paidCalls: usages.filter((u) => u.cost > 0).length,
      avgLatencyMs:
        usages.length > 0
          ? usages.reduce((sum, u) => sum + u.latencyMs, 0) / usages.length
          : 0,
      byModel: {} as Record<string, { calls: number; success: number; cost: number }>,
      byTaskType: {} as Record<string, { calls: number; success: number; cost: number }>,
    };

    // Group by model
    for (const usage of usages) {
      if (!stats.byModel[usage.modelId]) {
        stats.byModel[usage.modelId] = { calls: 0, success: 0, cost: 0 };
      }
      stats.byModel[usage.modelId].calls++;
      if (usage.success) stats.byModel[usage.modelId].success++;
      stats.byModel[usage.modelId].cost += usage.cost;

      if (!stats.byTaskType[usage.taskType]) {
        stats.byTaskType[usage.taskType] = { calls: 0, success: 0, cost: 0 };
      }
      stats.byTaskType[usage.taskType].calls++;
      if (usage.success) stats.byTaskType[usage.taskType].success++;
      stats.byTaskType[usage.taskType].cost += usage.cost;
    }

    return stats;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MODEL EXECUTION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a model call with automatic fallback
 */
export const executeWithFallback = internalAction({
  args: {
    taskType: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
        content: v.string(),
      })
    ),
    maxTokens: v.optional(v.number()),
    temperature: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { taskType, messages, maxTokens = 2000, temperature = 0.7 }
  ): Promise<{
    content: string;
    modelUsed: string;
    isFree: boolean;
    latencyMs: number;
    fallbackLevel: number;
  }> => {
    const fallbackChain = await ctx.runQuery(
      internal.domains.models.autonomousModelResolver.getAutonomousFallbackChain,
      { taskType }
    );

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY not configured for autonomous operations");
    }

    let lastError: Error | null = null;

    for (const model of fallbackChain) {
      const startTime = Date.now();

      try {
        let content: string;

        if (model.provider === "openrouter") {
          // Use OpenRouter API with retry-with-jitter for transient errors
          const { maxRetries, baseDelayMs, maxJitterMs, retryableStatuses } =
            AUTONOMOUS_MODEL_CONFIG.retry;

          let lastRetryError: Error | null = null;
          let response: Response | null = null;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://nodebench.ai",
                  "X-Title": process.env.OPENROUTER_X_TITLE || "NodeBench Autonomous",
                },
                body: JSON.stringify({
                  model: model.modelId,
                  messages: messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
                  max_tokens: maxTokens,
                  temperature,
                  // B-PR1: OpenRouter native routing — let OpenRouter transparently
                  // failover to alternate hosting providers when the primary returns
                  // 429/5xx. Sort by throughput so we prefer the fastest available
                  // provider, falling back through the rest before we have to bail
                  // and try the next model in our chain. This is the cheapest
                  // meaningful guard against rate-limit spirals on free models.
                  provider: {
                    allow_fallbacks: true,
                    sort: "throughput",
                  },
                }),
                signal: AbortSignal.timeout(AUTONOMOUS_MODEL_CONFIG.modelTimeoutMs),
              });

              // Check if this is a retryable error
              if (!response.ok && (retryableStatuses as readonly number[]).includes(response.status)) {
                const errorText = await response.text();
                lastRetryError = new Error(`OpenRouter API error: ${response.status} - ${errorText}`);

                // If we have retries left, wait with exponential backoff + jitter
                if (attempt < maxRetries) {
                  const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * maxJitterMs;
                  console.log(
                    `[autonomousModelResolver] ${model.modelId} got ${response.status}, retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`
                  );
                  await new Promise((resolve) => setTimeout(resolve, delay));
                  continue;
                }
                // No more retries, throw the error
                throw lastRetryError;
              }

              // Non-retryable error or success - break out of retry loop
              break;
            } catch (fetchError) {
              // Network errors or timeouts - check if retryable
              if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * maxJitterMs;
                console.log(
                  `[autonomousModelResolver] ${model.modelId} fetch error, retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms:`,
                  fetchError instanceof Error ? fetchError.message : String(fetchError)
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
              }
              throw fetchError;
            }
          }

          // Process response after retry loop
          if (!response) {
            throw lastRetryError || new Error("No response after retries");
          }

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json();
          content = data.choices?.[0]?.message?.content || "";

          if (!content) {
            throw new Error("Empty response from model");
          }
        } else {
          // Use native provider via AI SDK
          // This would require importing the model resolver, but for autonomous
          // operations we prefer OpenRouter for cost tracking
          throw new Error("Native provider fallback not implemented for autonomous");
        }

        const latencyMs = Date.now() - startTime;

        // Record successful usage
        await ctx.runMutation(
          internal.domains.models.autonomousModelResolver.recordModelUsage,
          {
            modelId: model.modelId,
            taskType: taskType as AutonomousTaskType,
            success: true,
            latencyMs,
            cost: model.isFree ? 0 : 0.001, // Estimate for paid models
          }
        );

        return {
          content,
          modelUsed: model.modelId,
          isFree: model.isFree,
          latencyMs,
          fallbackLevel: model.fallbackLevel,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const latencyMs = Date.now() - startTime;

        console.warn(
          `[autonomousModelResolver] Model ${model.modelId} failed:`,
          lastError.message
        );

        // Record failed usage
        await ctx.runMutation(
          internal.domains.models.autonomousModelResolver.recordModelUsage,
          {
            modelId: model.modelId,
            taskType: taskType as AutonomousTaskType,
            success: false,
            latencyMs,
            cost: 0,
            error: lastError.message,
          }
        );

        // Continue to next model in fallback chain
        continue;
      }
    }

    throw new Error(
      `All models in fallback chain failed. Last error: ${lastError?.message}`
    );
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// USAGE TRACKING MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record model usage for analytics
 */
export const recordModelUsage = internalMutation({
  args: {
    modelId: v.string(),
    taskType: v.string(),
    success: v.boolean(),
    latencyMs: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cost: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("autonomousModelUsage", {
      modelId: args.modelId,
      taskType: args.taskType as AutonomousTaskType,
      success: args.success,
      latencyMs: args.latencyMs,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cost: args.cost,
      error: args.error,
      timestamp: Date.now(),
    });
  },
});

/**
 * Cleanup old usage records (keep 7 days)
 */
export const cleanupOldUsageRecords = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const oldRecords = await ctx.db
      .query("autonomousModelUsage")
      .withIndex("by_timestamp")
      .filter((q) => q.lt(q.field("timestamp"), cutoff))
      .take(500) as Doc<"autonomousModelUsage">[];

    for (const record of oldRecords) {
      await ctx.db.delete(record._id);
    }

    return oldRecords.length;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Create OpenRouter LanguageModel
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a LanguageModel instance for an OpenRouter model
 * Use this when you need AI SDK compatibility
 */
export function createOpenRouterModel(modelId: string): LanguageModel {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const openrouter = createOpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://nodebench.ai",
      "X-Title": process.env.OPENROUTER_X_TITLE || "NodeBench Autonomous",
    },
  });

  return openrouter.chat(modelId);
}

/**
 * Get a free model as LanguageModel (for AI SDK usage)
 */
export async function getFreeLanguageModel(
  ctx: { runQuery: typeof internalQuery.prototype.handler },
  taskType: AutonomousTaskType
): Promise<LanguageModel> {
  // This is a synchronous helper - for async selection use the query directly
  // Fall back to known good free model
  return createOpenRouterModel(AUTONOMOUS_MODEL_CONFIG.knownFreeModels[0]);
}
