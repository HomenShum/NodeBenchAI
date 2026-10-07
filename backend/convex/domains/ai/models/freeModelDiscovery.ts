/**
 * Free Model Discovery - OpenRouter Free Model Discovery & Evaluation
 * Deep Agents 3.0
 *
 * Automatically discovers and evaluates free models from OpenRouter for autonomous operations.
 * Maintains a ranked list of capable free models with fallback chain support.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { Doc } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * OpenRouter model from API response
 */
interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: {
    prompt: string; // Cost per token as string (e.g., "0" for free)
    completion: string;
  };
  top_provider?: {
    is_moderated: boolean;
    max_completion_tokens?: number;
  };
  architecture?: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
}

/**
 * Discovered free model with evaluation data
 */
export interface DiscoveredFreeModel {
  id: string;
  openRouterId: string;
  name: string;
  contextLength: number;
  capabilities: {
    toolUse: boolean;
    streaming: boolean;
    structuredOutputs: boolean;
    vision: boolean;
  };
  performanceScore: number; // 0-100
  reliabilityScore: number; // 0-100 (based on uptime/success rate)
  latencyAvgMs: number;
  lastEvaluated: number;
  evaluationCount: number;
  successCount: number;
  failureCount: number;
  isActive: boolean;
  rank: number; // 1 = best
}

/**
 * Evaluation result from a test run
 */
export interface ModelEvaluationResult {
  modelId: string;
  success: boolean;
  latencyMs: number;
  error?: string;
  responseQuality?: number; // 0-100
  toolCallSuccess?: boolean;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const FREE_MODEL_CONFIG = {
  /** OpenRouter API endpoint for models */
  modelsApiUrl: "https://openrouter.ai/api/v1/models",

  /** Minimum context length for autonomous tasks */
  minContextLength: 8192,

  /** Model discovery refresh interval (6 hours) */
  discoveryIntervalMs: 6 * 60 * 60 * 1000,

  /** Performance evaluation interval (1 hour) */
  evaluationIntervalMs: 60 * 60 * 1000,

  /** Minimum evaluations before ranking */
  minEvaluationsForRanking: 5,

  /** Maximum models to keep in active pool */
  maxActiveModels: 10,

  /** Reliability threshold for active status */
  minReliabilityScore: 60,

  /** Test prompts for evaluation */
  testPrompts: {
    basic: "What is 2 + 2? Answer with just the number.",
    reasoning: "Explain briefly why the sky appears blue in 2-3 sentences.",
    toolUse: "I need you to help me search for information about AI research.",
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVERY ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pinned OpenRouter free-first models (Jan 2026)
 *
 * These are intentionally curated because "free" pools rotate and some models are experimental/deprecating.
 * Seeding ensures they exist in `freeModels` even if discovery isn't run yet.
 *
 * NOTE: xAI/Grok models are available via OpenRouter with free tier options.
 * Grok models are highly cost-effective for ranking and recommendation tasks.
 */
const PINNED_FREE_FIRST_MODELS: Array<{
  openRouterId: string;
  name: string;
  expectedVision: boolean;
}> = [
  // Top-tier free models (verified Feb 5, 2026 via OpenRouter API)
  {
    openRouterId: "qwen/qwen3-coder:free",
    name: "Qwen3 Coder (free)",
    expectedVision: false,
  },
  {
    openRouterId: "stepfun/step-3.5-flash:free",
    name: "Step 3.5 Flash (free)",
    expectedVision: false,
  },
  {
    openRouterId: "openai/gpt-oss-120b:free",
    name: "GPT-OSS 120B (free)",
    expectedVision: false,
  },
  {
    openRouterId: "arcee-ai/trinity-large-preview:free",
    name: "Trinity Large (free)",
    expectedVision: false,
  },
  {
    openRouterId: "nvidia/nemotron-3-nano-30b-a3b:free",
    name: "Nemotron 3 Nano (free)",
    expectedVision: false,
  },
  {
    openRouterId: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B Instruct (free)",
    expectedVision: false,
  },
  {
    openRouterId: "google/gemma-3-27b-it:free",
    name: "Gemma 3 27B IT (free)",
    expectedVision: false,
  },
  {
    openRouterId: "deepseek/deepseek-r1-0528:free",
    name: "DeepSeek R1 (free)",
    expectedVision: false,
  },
  {
    openRouterId: "z-ai/glm-4.5-air:free",
    name: "GLM 4.5 Air (free)",
    expectedVision: false,
  },
  {
    openRouterId: "nvidia/nemotron-nano-12b-v2-vl:free",
    name: "Nemotron 12B VL (free)",
    expectedVision: true,
  },
];

/**
 * Seed pinned free-first models into the `freeModels` table.
 *
 * This does not run performance evaluation. It only ensures these model IDs exist so evals can target them.
 */
export const seedPinnedFreeModels = internalAction({
  args: {},
  handler: async (ctx): Promise<{ seeded: number; updatedFromApi: number }> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    let apiModelById: Map<string, OpenRouterModel> | null = null;

    // Optional enrichment: if OPENROUTER_API_KEY exists, fetch /models to get names/context/modality accurately.
    if (apiKey) {
      try {
        const response = await fetch(FREE_MODEL_CONFIG.modelsApiUrl, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://nodebench.ai",
            "X-Title": process.env.OPENROUTER_X_TITLE || "NodeBench Model Seed",
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) {
          const data = (await response.json()) as any;
          const models: OpenRouterModel[] = (data?.data ?? []) as OpenRouterModel[];
          apiModelById = new Map(models.map((m) => [m.id, m]));
        }
      } catch (e) {
        console.warn("[freeModelDiscovery] seedPinnedFreeModels: failed to fetch /models; seeding with defaults", e);
      }
    }

    let seeded = 0;
    let updatedFromApi = 0;

    for (const pinned of PINNED_FREE_FIRST_MODELS) {
      const fromApi = apiModelById?.get(pinned.openRouterId);
      const name = fromApi?.name || pinned.name;
      const contextLength = fromApi?.context_length ?? FREE_MODEL_CONFIG.minContextLength;
      const vision = fromApi?.architecture?.modality?.includes("image") ?? pinned.expectedVision;

      // Conservative defaults; evaluation will refine.
      await ctx.runMutation(internal.domains.models.freeModelDiscovery.upsertFreeModel, {
        openRouterId: pinned.openRouterId,
        name,
        contextLength,
        capabilities: {
          toolUse: pinned.openRouterId.includes("instruct") || pinned.openRouterId.includes("chat"),
          streaming: true,
          structuredOutputs: false,
          vision,
        },
      });

      seeded++;
      if (fromApi) updatedFromApi++;
    }

    return { seeded, updatedFromApi };
  },
});

/**
 * Fetch available free models from OpenRouter API.
 * Also detects retired models (present in our DB but missing from API) and deactivates them.
 * Sends ntfy alert when models are retired or when all free models are down.
 */
export const discoverFreeModels = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    discovered: number;
    added: number;
    retired: number;
    retiredModels: string[];
    newModels: string[];
  }> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn("[freeModelDiscovery] OPENROUTER_API_KEY not set, skipping discovery");
      return { discovered: 0, added: 0, retired: 0, retiredModels: [], newModels: [] };
    }

    try {
      // Fetch models from OpenRouter
      const response = await fetch(FREE_MODEL_CONFIG.modelsApiUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://nodebench.ai",
          "X-Title": process.env.OPENROUTER_X_TITLE || "NodeBench Model Discovery",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const models: OpenRouterModel[] = data.data || [];

      // Filter for free models
      const freeModels = models.filter((m) => {
        const promptCost = parseFloat(m.pricing.prompt);
        const completionCost = parseFloat(m.pricing.completion);
        return (
          promptCost === 0 &&
          completionCost === 0 &&
          m.context_length >= FREE_MODEL_CONFIG.minContextLength
        );
      });

      // Build set of currently-available free model IDs from API
      const apiFreeModelIds = new Set(freeModels.map((m) => m.id));

      console.log(`[freeModelDiscovery] Found ${freeModels.length} free models with sufficient context`);

      let added = 0;
      const newModels: string[] = [];

      // Process each free model from API
      for (const model of freeModels) {
        const existing = await ctx.runQuery(
          internal.domains.models.freeModelDiscovery.getFreeModelByOpenRouterId,
          { openRouterId: model.id }
        );

        if (!existing) {
          await ctx.runMutation(
            internal.domains.models.freeModelDiscovery.upsertFreeModel,
            {
              openRouterId: model.id,
              name: model.name,
              contextLength: model.context_length,
              capabilities: {
                toolUse: model.id.includes("instruct") || model.id.includes("chat") || model.id.includes("coder"),
                streaming: true,
                structuredOutputs: false,
                vision: model.architecture?.modality?.includes("image") ?? false,
              },
            }
          );
          added++;
          newModels.push(`${model.name} (${model.id})`);
        } else if (!existing.isActive) {
          // Re-activate models that are back on the API
          await ctx.runMutation(
            internal.domains.models.freeModelDiscovery.reactivateModel,
            { modelId: existing._id }
          );
          console.log(`[freeModelDiscovery] Re-activated ${model.name} (${model.id})`);
        }
      }

      // ═══ RETIREMENT DETECTION ═══
      // Check all active models in our DB against the API; deactivate any missing
      const activeDbModels = await ctx.runQuery(
        internal.domains.models.freeModelDiscovery.getActiveFreeModels,
        {}
      );

      let retired = 0;
      const retiredModels: string[] = [];

      for (const dbModel of activeDbModels) {
        if (!apiFreeModelIds.has(dbModel.openRouterId)) {
          // This model is in our DB as active but NOT in the API anymore → retired
          await ctx.runMutation(
            internal.domains.models.freeModelDiscovery.deactivateModel,
            { modelId: dbModel._id, reason: "not_found_in_api" }
          );
          retired++;
          retiredModels.push(`${dbModel.name} (${dbModel.openRouterId})`);
          console.warn(`[freeModelDiscovery] RETIRED: ${dbModel.name} (${dbModel.openRouterId}) — no longer free on OpenRouter`);
        }
      }

      // Update discovery timestamp
      await ctx.runMutation(
        internal.domains.models.freeModelDiscovery.updateDiscoveryTime,
        {}
      );

      // ═══ ALERTING ═══
      // Send ntfy alert if models were retired or if we're running low on active free models
      const remainingActive = activeDbModels.length - retired + added;
      if (retired > 0 || remainingActive < 3) {
        await sendModelHealthAlert(ctx, {
          retired,
          retiredModels,
          added,
          newModels,
          remainingActive,
          totalApiFreee: freeModels.length,
        });
      }

      console.log(`[freeModelDiscovery] Summary: discovered=${freeModels.length}, added=${added}, retired=${retired}, remaining=${remainingActive}`);

      return { discovered: freeModels.length, added, retired, retiredModels, newModels };
    } catch (error) {
      console.error("[freeModelDiscovery] Discovery failed:", error);
      throw error;
    }
  },
});

/**
 * Send ntfy alert about model health changes
 */
async function sendModelHealthAlert(
  ctx: any,
  info: {
    retired: number;
    retiredModels: string[];
    added: number;
    newModels: string[];
    remainingActive: number;
    totalApiFreee: number;
  }
): Promise<void> {
  const ntfyUrl = process.env.NTFY_URL;
  if (!ntfyUrl) {
    console.warn("[freeModelDiscovery] NTFY_URL not set, skipping alert");
    return;
  }

  const isCritical = info.remainingActive < 3;
  const priority = isCritical ? "urgent" : "high";
  const title = isCritical
    ? `⚠️ CRITICAL: Only ${info.remainingActive} free models remaining!`
    : `🔄 Free model changes: ${info.retired} retired, ${info.added} added`;

  const lines: string[] = [];
  if (info.retired > 0) {
    lines.push(`Retired (${info.retired}):`);
    for (const m of info.retiredModels) lines.push(`  - ${m}`);
  }
  if (info.added > 0) {
    lines.push(`New (${info.added}):`);
    for (const m of info.newModels) lines.push(`  - ${m}`);
  }
  lines.push(`Active free models: ${info.remainingActive} (${info.totalApiFreee} total on OpenRouter)`);
  if (isCritical) {
    lines.push(`\nLinkedIn posts may fail if no free models are available. Check immediately.`);
  }

  try {
    await fetch(ntfyUrl, {
      method: "POST",
      headers: {
        "Title": title,
        "Priority": priority,
        "Tags": isCritical ? "warning,robot" : "arrows_counterclockwise,robot",
      },
      body: lines.join("\n"),
    });
    console.log(`[freeModelDiscovery] Alert sent to ntfy (priority=${priority})`);
  } catch (e) {
    console.warn("[freeModelDiscovery] Failed to send ntfy alert:", e);
  }
}

/**
 * Evaluate a specific free model's performance
 */
export const evaluateFreeModel = internalAction({
  args: {
    modelId: v.id("freeModels"),
  },
  handler: async (ctx, { modelId }): Promise<ModelEvaluationResult> => {
    const model = await ctx.runQuery(
      internal.domains.models.freeModelDiscovery.getFreeModel,
      { id: modelId }
    );

    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY not configured");
    }

    const startTime = Date.now();
    let success = false;
    let responseQuality = 0;
    let error: string | undefined;
    let toolCallSuccess = false;

    try {
      // Test basic completion
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://nodebench.ai",
          "X-Title": process.env.OPENROUTER_X_TITLE || "NodeBench Autonomous",
        },
        body: JSON.stringify({
          model: model.openRouterId,
          messages: [
            { role: "user", content: FREE_MODEL_CONFIG.testPrompts.basic },
          ],
          max_tokens: 50,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";

      // Check if response is reasonable
      if (content.includes("4")) {
        responseQuality = 100;
        success = true;
      } else if (content.length > 0) {
        responseQuality = 50; // Response but wrong
        success = true;
      }

      // Test tool use capability (simplified check)
      if (model.capabilities.toolUse) {
        try {
          const toolResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: model.openRouterId,
              messages: [
                { role: "user", content: FREE_MODEL_CONFIG.testPrompts.toolUse },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "search",
                    description: "Search for information",
                    parameters: { type: "object", properties: { query: { type: "string" } } },
                  },
                },
              ],
              max_tokens: 100,
            }),
          });

          if (toolResponse.ok) {
            const toolData = await toolResponse.json();
            toolCallSuccess = toolData.choices?.[0]?.message?.tool_calls?.length > 0;
          }
        } catch {
          // Tool use test failed, but basic completion worked
          toolCallSuccess = false;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      success = false;
    }

    const latencyMs = Date.now() - startTime;

    // Record evaluation result
    await ctx.runMutation(
      internal.domains.models.freeModelDiscovery.recordEvaluation,
      {
        modelId,
        success,
        latencyMs,
        responseQuality,
        toolCallSuccess,
        error,
      }
    );

    return {
      modelId: modelId as string,
      success,
      latencyMs,
      error,
      responseQuality,
      toolCallSuccess,
      timestamp: Date.now(),
    };
  },
});

/**
 * Evaluate all active free models and update rankings
 */
export const evaluateAllFreeModels = internalAction({
  args: {},
  handler: async (ctx): Promise<{ evaluated: number; updated: number }> => {
    const models = await ctx.runQuery(
      internal.domains.models.freeModelDiscovery.getActiveFreeModels,
      {}
    );

    let evaluated = 0;

    for (const model of models) {
      try {
        await ctx.runAction(
          internal.domains.models.freeModelDiscovery.evaluateFreeModel,
          { modelId: model._id }
        );
        evaluated++;
      } catch (e) {
        console.error(`[freeModelDiscovery] Evaluation failed for ${model.name}:`, e);
      }
    }

    // Update rankings based on evaluation results
    await ctx.runMutation(
      internal.domains.models.freeModelDiscovery.updateModelRankings,
      {}
    );

    return { evaluated, updated: evaluated };
  },
});

/**
 * Cron tick for model discovery and evaluation
 */
export const tickModelDiscovery = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const lastDiscovery = await ctx.runQuery(
      internal.domains.models.freeModelDiscovery.getLastDiscoveryTime,
      {}
    );

    const now = Date.now();

    // Run discovery if needed
    if (!lastDiscovery || now - lastDiscovery > FREE_MODEL_CONFIG.discoveryIntervalMs) {
      await ctx.runAction(
        internal.domains.models.freeModelDiscovery.discoverFreeModels,
        {}
      );
    }

    // Run evaluation for models that need it
    const modelsNeedingEval = await ctx.runQuery(
      internal.domains.models.freeModelDiscovery.getModelsNeedingEvaluation,
      { intervalMs: FREE_MODEL_CONFIG.evaluationIntervalMs }
    );

    for (const model of modelsNeedingEval.slice(0, 5)) {
      // Limit to 5 per tick
      try {
        await ctx.runAction(
          internal.domains.models.freeModelDiscovery.evaluateFreeModel,
          { modelId: model._id }
        );
      } catch (e) {
        console.error(`[freeModelDiscovery] Tick evaluation failed for ${model.name}:`, e);
      }
    }

    // Update rankings
    if (modelsNeedingEval.length > 0) {
      await ctx.runMutation(
        internal.domains.models.freeModelDiscovery.updateModelRankings,
        {}
      );
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the best free model for autonomous operations
 */
export const getBestFreeModel = internalQuery({
  args: {
    requireToolUse: v.optional(v.boolean()),
  },
  handler: async (ctx, { requireToolUse }): Promise<DiscoveredFreeModel | null> => {
    let query = ctx.db
      .query("freeModels")
      .withIndex("by_rank")
      .filter((q) => q.eq(q.field("isActive"), true));

    const models = await query.collect();

    if (requireToolUse) {
      const toolCapable = models.filter((m) => m.capabilities.toolUse);
      return toolCapable[0] || null;
    }

    return models[0] || null;
  },
});

/**
 * Get fallback chain of free models (ordered by rank)
 */
export const getFreeModelFallbackChain = internalQuery({
  args: {
    maxModels: v.optional(v.number()),
  },
  handler: async (ctx, { maxModels = 5 }): Promise<DiscoveredFreeModel[]> => {
    const models = await ctx.db
      .query("freeModels")
      .withIndex("by_rank")
      .filter((q) => q.eq(q.field("isActive"), true))
      .take(maxModels);

    return models;
  },
});

/**
 * Get a specific free model by ID
 */
export const getFreeModel = internalQuery({
  args: { id: v.id("freeModels") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id) as Doc<"freeModels"> | null;
  },
});

/**
 * Get free model by OpenRouter ID
 */
export const getFreeModelByOpenRouterId = internalQuery({
  args: { openRouterId: v.string() },
  handler: async (ctx, { openRouterId }) => {
    return await ctx.db
      .query("freeModels")
      .withIndex("by_openRouterId", (q) => q.eq("openRouterId", openRouterId))
      .unique() as Doc<"freeModels"> | null;
  },
});

/**
 * Get all active free models
 */
export const getActiveFreeModels = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("freeModels")
      .withIndex("by_rank")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect() as Doc<"freeModels">[];
  },
});

/**
 * Get models needing evaluation
 */
export const getModelsNeedingEvaluation = internalQuery({
  args: { intervalMs: v.number() },
  handler: async (ctx, { intervalMs }) => {
    const cutoff = Date.now() - intervalMs;
    const models = await ctx.db.query("freeModels").collect() as Doc<"freeModels">[];

    return models.filter(
      (m: Doc<"freeModels">) => m.isActive && (!m.lastEvaluated || m.lastEvaluated < cutoff)
    );
  },
});

/**
 * Get last discovery time
 */
export const getLastDiscoveryTime = internalQuery({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const meta = await ctx.db
      .query("freeModelMeta")
      .filter((q) => q.eq(q.field("key"), "lastDiscovery"))
      .unique() as Doc<"freeModelMeta"> | null;

    return meta?.value ?? null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert a discovered free model
 */
export const upsertFreeModel = internalMutation({
  args: {
    openRouterId: v.string(),
    name: v.string(),
    contextLength: v.number(),
    capabilities: v.object({
      toolUse: v.boolean(),
      streaming: v.boolean(),
      structuredOutputs: v.boolean(),
      vision: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("freeModels")
      .withIndex("by_openRouterId", (q) => q.eq("openRouterId", args.openRouterId))
      .unique() as Doc<"freeModels"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        contextLength: args.contextLength,
        capabilities: args.capabilities,
      });
      return existing._id;
    }

    return ctx.db.insert("freeModels", {
      openRouterId: args.openRouterId,
      name: args.name,
      contextLength: args.contextLength,
      capabilities: args.capabilities,
      performanceScore: 0,
      reliabilityScore: 0,
      latencyAvgMs: 0,
      lastEvaluated: 0,
      evaluationCount: 0,
      successCount: 0,
      failureCount: 0,
      isActive: true,
      rank: 999, // Start with low rank
    });
  },
});

/**
 * Record an evaluation result
 */
export const recordEvaluation = internalMutation({
  args: {
    modelId: v.id("freeModels"),
    success: v.boolean(),
    latencyMs: v.number(),
    responseQuality: v.optional(v.number()),
    toolCallSuccess: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId) as Doc<"freeModels"> | null;
    if (!model) return;

    const newEvalCount = model.evaluationCount + 1;
    const newSuccessCount = model.successCount + (args.success ? 1 : 0);
    const newFailureCount = model.failureCount + (args.success ? 0 : 1);

    // Calculate rolling averages
    const weight = Math.min(0.3, 1 / newEvalCount); // Newer results have more weight
    const newLatencyAvg = model.latencyAvgMs * (1 - weight) + args.latencyMs * weight;

    // Calculate reliability (success rate, weighted)
    const reliabilityScore = Math.round((newSuccessCount / newEvalCount) * 100);

    // Calculate performance score (combines quality, latency, reliability)
    const qualityWeight = 0.4;
    const latencyWeight = 0.3;
    const reliabilityWeight = 0.3;

    const qualityScore = args.responseQuality ?? (args.success ? 70 : 0);
    const latencyScore = Math.max(0, 100 - newLatencyAvg / 50); // 5s = 0 score
    const performanceScore = Math.round(
      qualityScore * qualityWeight +
        latencyScore * latencyWeight +
        reliabilityScore * reliabilityWeight
    );

    // Update tool use capability based on actual test
    const capabilities = { ...model.capabilities };
    if (args.toolCallSuccess !== undefined) {
      capabilities.toolUse = args.toolCallSuccess;
    }

    // Deactivate if reliability is too low after enough evaluations
    const isActive =
      newEvalCount < FREE_MODEL_CONFIG.minEvaluationsForRanking ||
      reliabilityScore >= FREE_MODEL_CONFIG.minReliabilityScore;

    await ctx.db.patch(args.modelId, {
      evaluationCount: newEvalCount,
      successCount: newSuccessCount,
      failureCount: newFailureCount,
      latencyAvgMs: newLatencyAvg,
      reliabilityScore,
      performanceScore,
      capabilities,
      isActive,
      lastEvaluated: Date.now(),
    });

    // Log evaluation for history
    await ctx.db.insert("freeModelEvaluations", {
      modelId: args.modelId,
      success: args.success,
      latencyMs: args.latencyMs,
      responseQuality: args.responseQuality,
      toolCallSuccess: args.toolCallSuccess,
      error: args.error,
      timestamp: Date.now(),
    });
  },
});

/**
 * Update model rankings based on performance
 */
export const updateModelRankings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const models = await ctx.db
      .query("freeModels")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect() as Doc<"freeModels">[];

    // Sort by performance score (descending)
    const sorted = models.sort((a: Doc<"freeModels">, b: Doc<"freeModels">) => b.performanceScore - a.performanceScore);

    // Update ranks
    for (let i = 0; i < sorted.length; i++) {
      await ctx.db.patch(sorted[i]._id, { rank: i + 1 });
    }

    // Update last discovery time
    const meta = await ctx.db
      .query("freeModelMeta")
      .filter((q) => q.eq(q.field("key"), "lastRankingUpdate"))
      .unique() as Doc<"freeModelMeta"> | null;

    if (meta) {
      await ctx.db.patch(meta._id, { value: Date.now() });
    } else {
      await ctx.db.insert("freeModelMeta", {
        key: "lastRankingUpdate",
        value: Date.now(),
      });
    }
  },
});

/**
 * Update discovery timestamp
 */
export const updateDiscoveryTime = internalMutation({
  args: {},
  handler: async (ctx) => {
    const meta = await ctx.db
      .query("freeModelMeta")
      .filter((q) => q.eq(q.field("key"), "lastDiscovery"))
      .unique() as Doc<"freeModelMeta"> | null;

    if (meta) {
      await ctx.db.patch(meta._id, { value: Date.now() });
    } else {
      await ctx.db.insert("freeModelMeta", {
        key: "lastDiscovery",
        value: Date.now(),
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RETIREMENT / REACTIVATION MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deactivate a model that is no longer available on OpenRouter.
 * Sets isActive=false and records the reason.
 */
export const deactivateModel = internalMutation({
  args: {
    modelId: v.id("freeModels"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { modelId, reason }) => {
    const model = await ctx.db.get(modelId) as Doc<"freeModels"> | null;
    if (!model || !model.isActive) return null;

    await ctx.db.patch(modelId, {
      isActive: false,
      rank: 999,
    });

    console.log(`[freeModelDiscovery] Deactivated ${model.name} (${model.openRouterId}): ${reason}`);
    return null;
  },
});

/**
 * Re-activate a model that has reappeared on the OpenRouter API.
 * Resets rank to 999 (will be re-ranked on next evaluation cycle).
 */
export const reactivateModel = internalMutation({
  args: {
    modelId: v.id("freeModels"),
  },
  returns: v.null(),
  handler: async (ctx, { modelId }) => {
    const model = await ctx.db.get(modelId) as Doc<"freeModels"> | null;
    if (!model || model.isActive) return null;

    await ctx.db.patch(modelId, {
      isActive: true,
      rank: 999,
      // Reset eval counters so it gets a fresh evaluation
      evaluationCount: 0,
      successCount: 0,
      failureCount: 0,
      performanceScore: 0,
      reliabilityScore: 0,
      lastEvaluated: 0,
    });

    console.log(`[freeModelDiscovery] Re-activated ${model.name} (${model.openRouterId})`);
    return null;
  },
});

/**
 * Get the best healthy free model's OpenRouter ID for direct API calls.
 * Used by LinkedIn posting and other workflows that need a runtime-resolved model.
 * Falls back to the first pinned model if no ranked models exist.
 */
export const resolveHealthyFreeModel = internalQuery({
  args: {
    requireToolUse: v.optional(v.boolean()),
    requireVision: v.optional(v.boolean()),
  },
  handler: async (ctx, { requireToolUse, requireVision }): Promise<string> => {
    const models = await ctx.db
      .query("freeModels")
      .withIndex("by_rank")
      .filter((q) => q.eq(q.field("isActive"), true))
      .take(20) as Doc<"freeModels">[];

    const match = models.find((m) =>
      (!requireToolUse || m.capabilities.toolUse) &&
      (!requireVision || m.capabilities.vision)
    );

    if (match) return match.openRouterId;

    // Fallback to first pinned model if no active ranked models
    return PINNED_FREE_FIRST_MODELS[0].openRouterId;
  },
});
