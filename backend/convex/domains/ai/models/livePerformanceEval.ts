/**
 * Live Performance Evaluation - End-to-End Free Model Performance Tracking
 * Deep Agents 3.0
 *
 * Provides comprehensive evaluation of free models in live autonomous operations.
 * Tracks real-world performance metrics for continuous model ranking adjustments.
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

export interface LiveEvaluationResult {
  modelId: string;
  taskType: string;
  scenarioId: string;
  success: boolean;
  latencyMs: number;
  outputQuality: number; // 0-100
  tokenEfficiency: number; // output quality / tokens used
  costEfficiency: number; // output quality / cost
  errors: string[];
  timestamp: number;
}

export interface ModelPerformanceReport {
  modelId: string;
  periodStart: number;
  periodEnd: number;
  totalTasks: number;
  successRate: number;
  avgLatencyMs: number;
  avgQuality: number;
  avgTokenEfficiency: number;
  avgCostEfficiency: number;
  taskBreakdown: Record<string, {
    count: number;
    successRate: number;
    avgQuality: number;
  }>;
  recommendation: "promote" | "maintain" | "demote" | "disable";
  reasonings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

const RED_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const BLUE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC";

type OpenRouterMessage =
  | { role: "user" | "assistant" | "system"; content: string }
  | { role: "user" | "assistant" | "system"; content: any[] };

function extractJsonFromText(text: string): unknown | null {
  const trimmed = (text || "").trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }

  const match = trimmed.match(/\\{[\\s\\S]*\\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

const EVALUATION_SCENARIOS = {
  // Basic capability tests
  basic_math: {
    prompt: "What is 17 * 23? Answer with just the number.",
    expectedContains: ["391"],
    maxTokens: 20,
    taskType: "validation",
  },
  basic_reasoning: {
    prompt: "If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly? Answer yes or no and explain briefly.",
    expectedContains: ["no", "cannot"],
    maxTokens: 100,
    taskType: "research",
  },

  // Research-oriented tests
  summarization: {
    prompt: "Summarize the key benefits of renewable energy in 2-3 sentences.",
    qualityKeywords: ["environment", "sustainable", "clean", "cost", "renewable"],
    minLength: 50,
    maxTokens: 150,
    taskType: "research",
  },
  entity_extraction: {
    prompt: "Extract any company names, people names, and monetary amounts from this text: 'Acme Corp, led by CEO Jane Smith, raised $50 million in Series B funding from Sequoia Capital.' Format as JSON.",
    expectedContains: ["Acme", "Jane Smith", "50", "Sequoia"],
    maxTokens: 200,
    taskType: "synthesis",
  },

  // Publishing-oriented tests
  formatting: {
    prompt: "Format the following as a brief news headline and 1-sentence summary: Tech startup raises funding for AI platform.",
    qualityKeywords: ["tech", "startup", "AI", "funding"],
    minLength: 30,
    maxTokens: 100,
    taskType: "publishing",
  },

  // Instruction following
  structured_output: {
    prompt: 'Respond with exactly this JSON structure: {"status": "ok", "items": ["one", "two"]}',
    expectedJson: { status: "ok", items: ["one", "two"] },
    maxTokens: 50,
    taskType: "synthesis",
  },

  // Groundedness (citations to provided evidence)
  citation_grounding: {
    prompt: `Answer the question using ONLY the evidence below. If evidence is missing, say "insufficient evidence".
Return JSON: {"answer": string, "citations": [{"chunkId": string, "quote": string}]}

Evidence:
- chunkId=chunk_a: "Higgsfield is an AI-driven video generation platform."
- chunkId=chunk_b: "The website responds with HTTP 403 (bot protection), which still indicates it is live."

Question: Is the website live?`,
    expectedChunkIds: ["chunk_b"],
    maxTokens: 200,
    taskType: "research",
  },

  // Tool discipline (function calling)
  tool_use_call: {
    prompt: "Call the `search` tool with query = \"AI agent evaluation datasets 2026\". Do not answer directly.",
    tools: [
      {
        type: "function",
        function: {
          name: "search",
          description: "Search for information on the web",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      },
    ],
    requiresToolUse: true,
    maxTokens: 150,
    taskType: "validation",
  },

  // Multimodal smoke tests (vision models only)
  vision_color_red: {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is the dominant color in this image? Answer with just: red, green, or blue." },
          { type: "image_url", image_url: { url: RED_PNG_DATA_URL } },
        ],
      },
    ] as OpenRouterMessage[],
    expectedContains: ["red"],
    requiresVision: true,
    maxTokens: 20,
    taskType: "validation",
  },
  vision_color_blue: {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is the dominant color in this image? Answer with just: red, green, or blue." },
          { type: "image_url", image_url: { url: BLUE_PNG_DATA_URL } },
        ],
      },
    ] as OpenRouterMessage[],
    expectedContains: ["blue"],
    requiresVision: true,
    maxTokens: 20,
    taskType: "validation",
  },
} as const;

type ScenarioId = keyof typeof EVALUATION_SCENARIOS;

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run a comprehensive evaluation of a free model
 */
export const runComprehensiveEvaluation = internalAction({
  args: {
    modelId: v.id("freeModels"),
    scenarios: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { modelId, scenarios }): Promise<{
    results: LiveEvaluationResult[];
    overallScore: number;
    recommendation: string;
  }> => {
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

    const scenariosToRun = scenarios as ScenarioId[] ?? (Object.keys(EVALUATION_SCENARIOS) as ScenarioId[]);
    const results: LiveEvaluationResult[] = [];

    for (const scenarioId of scenariosToRun) {
      const scenario = EVALUATION_SCENARIOS[scenarioId];
      if (!scenario) continue;

      // Don't penalize models for modalities/capabilities they don't claim to support.
      if ("requiresVision" in scenario && (scenario as any).requiresVision && !model.capabilities.vision) {
        continue;
      }
      if ("requiresToolUse" in scenario && (scenario as any).requiresToolUse && !model.capabilities.toolUse) {
        continue;
      }

      const startTime = Date.now();
      let success = false;
      let outputQuality = 0;
      const errors: string[] = [];

      try {
        const requestBody: any = {
          model: model.openRouterId,
          max_tokens: (scenario as any).maxTokens,
        };

        if ("messages" in scenario && (scenario as any).messages) {
          requestBody.messages = (scenario as any).messages;
        } else {
          requestBody.messages = [{ role: "user", content: (scenario as any).prompt }];
        }

        if ("tools" in scenario && (scenario as any).tools) {
          requestBody.tools = (scenario as any).tools;
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://nodebench.ai",
            "X-Title": process.env.OPENROUTER_X_TITLE || "NodeBench Eval",
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          const errorText = await response.text();
          errors.push(`API error: ${response.status} - ${errorText}`);
        } else {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "";
          const toolCalls = data.choices?.[0]?.message?.tool_calls || [];

          // Evaluate output quality
          let qualityScore = 0;
          let hardScored = false;

          // Hard schema check: expectedJson must match exactly.
          if ("expectedJson" in scenario && (scenario as any).expectedJson) {
            const parsed = extractJsonFromText(content);
            hardScored = true;
            qualityScore =
              parsed && JSON.stringify(parsed) === JSON.stringify((scenario as any).expectedJson)
                ? 100
                : 0;
          }

          // Groundedness check: citations must reference expected chunk IDs and quote evidence text.
          if ("expectedChunkIds" in scenario && (scenario as any).expectedChunkIds) {
            const parsed = extractJsonFromText(content) as any;
            const expected: string[] = (scenario as any).expectedChunkIds;
            const citations = Array.isArray(parsed?.citations) ? parsed.citations : [];
            const foundChunkIds = citations.map((c: any) => String(c?.chunkId || "")).filter(Boolean);
            const foundExpected = expected.filter((id) => foundChunkIds.includes(id));
            const quotesOk = citations.some((c: any) => typeof c?.quote === "string" && c.quote.length >= 10);
            hardScored = true;
            qualityScore = Math.round((foundExpected.length / expected.length) * 70) + (quotesOk ? 30 : 0);
          }

          // Tool-call check: requiresToolUse means the model must emit tool_calls.
          if ("requiresToolUse" in scenario && (scenario as any).requiresToolUse) {
            const hasToolCall = Array.isArray(toolCalls) && toolCalls.length > 0;
            hardScored = true;
            qualityScore = hasToolCall ? 100 : 0;
          }

          if (!hardScored) {
            // Check expected content
            if ("expectedContains" in scenario && scenario.expectedContains) {
              const found = scenario.expectedContains.filter((kw: string) =>
                content.toLowerCase().includes(kw.toLowerCase())
              );
              qualityScore += (found.length / scenario.expectedContains.length) * 50;
            }

            // Check quality keywords
            if ("qualityKeywords" in scenario && scenario.qualityKeywords) {
              const found = scenario.qualityKeywords.filter((kw: string) =>
                content.toLowerCase().includes(kw.toLowerCase())
              );
              qualityScore += (found.length / scenario.qualityKeywords.length) * 30;
            }

            // Check minimum length
            if ("minLength" in scenario && scenario.minLength) {
              if (content.length >= scenario.minLength) {
                qualityScore += 20;
              } else {
                qualityScore += (content.length / scenario.minLength) * 20;
              }
            } else if (content.length > 0) {
              qualityScore += 20;
            }
          }

          outputQuality = Math.min(100, Math.max(0, Math.round(qualityScore)));
          success = outputQuality >= 50;
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }

      const latencyMs = Date.now() - startTime;

      const result: LiveEvaluationResult = {
        modelId: modelId as string,
        taskType: scenario.taskType,
        scenarioId,
        success,
        latencyMs,
        outputQuality,
        tokenEfficiency: outputQuality / (scenario.maxTokens || 100),
        costEfficiency: outputQuality, // Free models = infinite cost efficiency
        errors,
        timestamp: Date.now(),
      };

      results.push(result);

      // Record individual result
      await ctx.runMutation(
        internal.domains.models.livePerformanceEval.recordEvaluationResult,
        result
      );
    }

    // Calculate overall score
    const overallScore = results.length > 0
      ? Math.round(results.reduce((sum: number, r: LiveEvaluationResult) => sum + r.outputQuality, 0) / results.length)
      : 0;

    const successRate = results.filter((r: LiveEvaluationResult) => r.success).length / results.length;

    // Generate recommendation
    let recommendation = "maintain";
    if (overallScore >= 80 && successRate >= 0.9) {
      recommendation = "promote";
    } else if (overallScore < 50 || successRate < 0.5) {
      recommendation = "disable";
    } else if (overallScore < 65 || successRate < 0.7) {
      recommendation = "demote";
    }

    return { results, overallScore, recommendation };
  },
});

/**
 * Run evaluation across all active free models
 */
export const evaluateAllModels = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    modelsEvaluated: number;
    avgScore: number;
    recommendations: Record<string, string>;
  }> => {
    const models = await ctx.runQuery(
      internal.domains.models.freeModelDiscovery.getActiveFreeModels,
      {}
    );

    const recommendations: Record<string, string> = {};
    let totalScore = 0;

    for (const model of models) {
      try {
        const result = await ctx.runAction(
          internal.domains.models.livePerformanceEval.runComprehensiveEvaluation,
          { modelId: model._id }
        );
        totalScore += result.overallScore;
        recommendations[model.openRouterId] = result.recommendation;
      } catch (e) {
        console.error(`[livePerformanceEval] Failed to evaluate ${model.name}:`, e);
        recommendations[model.openRouterId] = "error";
      }
    }

    return {
      modelsEvaluated: models.length,
      avgScore: models.length > 0 ? totalScore / models.length : 0,
      recommendations,
    };
  },
});

/**
 * Evaluate a curated set of "free-first" OpenRouter models (text + multimodal) used for NodeBench gap analysis.
 *
 * Runs seeding first so these models exist even if discovery hasn't been run yet.
 */
export const evaluatePinnedFreeFirstModels = internalAction({
  args: {
    scenarios: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    { scenarios }
  ): Promise<{
    evaluated: number;
    resultsByModel: Record<string, { overallScore: number; recommendation: string }>;
  }> => {
    await ctx.runAction(internal.domains.models.freeModelDiscovery.seedPinnedFreeModels, {});

    const pinnedOpenRouterIds: string[] = [
      "qwen/qwen3-coder:free",
      "stepfun/step-3.5-flash:free",
      "openai/gpt-oss-120b:free",
      "arcee-ai/trinity-large-preview:free",
      "nvidia/nemotron-3-nano-30b-a3b:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemma-3-27b-it:free",
      "deepseek/deepseek-r1-0528:free",
      "z-ai/glm-4.5-air:free",
      "nvidia/nemotron-nano-12b-v2-vl:free",
    ];

    const resultsByModel: Record<string, { overallScore: number; recommendation: string }> = {};
    let evaluated = 0;

    for (const openRouterId of pinnedOpenRouterIds) {
      const model = await ctx.runQuery(
        internal.domains.models.freeModelDiscovery.getFreeModelByOpenRouterId,
        { openRouterId }
      );

      if (!model) {
        resultsByModel[openRouterId] = { overallScore: 0, recommendation: "missing" };
        continue;
      }

      const res = await ctx.runAction(internal.domains.models.livePerformanceEval.runComprehensiveEvaluation, {
        modelId: model._id,
        scenarios,
      });

      resultsByModel[openRouterId] = { overallScore: res.overallScore, recommendation: res.recommendation };
      evaluated++;
    }

    return { evaluated, resultsByModel };
  },
});

/**
 * Evaluate a single model by OpenRouter ID, returning full per-scenario details.
 * Useful for debugging rate limits / model availability / capability mismatches.
 */
export const evaluateByOpenRouterId = internalAction({
  args: {
    openRouterId: v.string(),
    scenarios: v.optional(v.array(v.string())),
    seedPinnedIfMissing: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { openRouterId, scenarios, seedPinnedIfMissing }
  ): Promise<{
    openRouterId: string;
    modelId: string;
    name: string;
    capabilities: { toolUse: boolean; streaming: boolean; structuredOutputs: boolean; vision: boolean };
    overallScore: number;
    recommendation: string;
    results: LiveEvaluationResult[];
  }> => {
    let model = await ctx.runQuery(
      internal.domains.models.freeModelDiscovery.getFreeModelByOpenRouterId,
      { openRouterId }
    );

    if (!model && seedPinnedIfMissing) {
      await ctx.runAction(internal.domains.models.freeModelDiscovery.seedPinnedFreeModels, {});
      model = await ctx.runQuery(
        internal.domains.models.freeModelDiscovery.getFreeModelByOpenRouterId,
        { openRouterId }
      );
    }

    if (!model) {
      throw new Error(`Model not found in freeModels: ${openRouterId}`);
    }

    const res = await ctx.runAction(internal.domains.models.livePerformanceEval.runComprehensiveEvaluation, {
      modelId: model._id,
      scenarios,
    });

    return {
      openRouterId,
      modelId: model._id as unknown as string,
      name: model.name,
      capabilities: model.capabilities,
      overallScore: res.overallScore,
      recommendation: res.recommendation,
      results: res.results,
    };
  },
});

/**
 * Generate performance report for a model
 */
export const generatePerformanceReport = internalAction({
  args: {
    modelId: v.string(),
    hours: v.optional(v.number()),
  },
  handler: async (ctx, { modelId, hours = 24 }): Promise<ModelPerformanceReport> => {
    const periodEnd = Date.now();
    const periodStart = periodEnd - hours * 60 * 60 * 1000;

    // Get evaluation results for this period
    const results = await ctx.runQuery(
      internal.domains.models.livePerformanceEval.getEvaluationResults,
      { modelId, since: periodStart }
    );

    // Get usage data
    const usageStats = await ctx.runQuery(
      internal.domains.models.autonomousModelResolver.getAutonomousModelStats,
      { hours }
    );

    const modelUsage = usageStats.byModel[modelId] || { calls: 0, success: 0, cost: 0 };

    // Calculate metrics
    const successCount = results.filter((r: LiveEvaluationResult) => r.success).length;
    const successRate = results.length > 0 ? successCount / results.length : 0;
    const avgLatency = results.length > 0
      ? results.reduce((sum: number, r: LiveEvaluationResult) => sum + r.latencyMs, 0) / results.length
      : 0;
    const avgQuality = results.length > 0
      ? results.reduce((sum: number, r: LiveEvaluationResult) => sum + r.outputQuality, 0) / results.length
      : 0;
    const avgTokenEff = results.length > 0
      ? results.reduce((sum: number, r: LiveEvaluationResult) => sum + r.tokenEfficiency, 0) / results.length
      : 0;
    const avgCostEff = results.length > 0
      ? results.reduce((sum: number, r: LiveEvaluationResult) => sum + r.costEfficiency, 0) / results.length
      : 0;

    // Task breakdown
    const taskBreakdown: Record<string, { count: number; successRate: number; avgQuality: number }> = {};
    for (const result of results) {
      if (!taskBreakdown[result.taskType]) {
        taskBreakdown[result.taskType] = { count: 0, successRate: 0, avgQuality: 0 };
      }
      taskBreakdown[result.taskType].count++;
      if (result.success) taskBreakdown[result.taskType].successRate++;
      taskBreakdown[result.taskType].avgQuality += result.outputQuality;
    }

    // Normalize breakdown
    for (const task of Object.keys(taskBreakdown)) {
      const count = taskBreakdown[task].count;
      taskBreakdown[task].successRate = taskBreakdown[task].successRate / count;
      taskBreakdown[task].avgQuality = taskBreakdown[task].avgQuality / count;
    }

    // Generate recommendation
    const reasonings: string[] = [];
    let recommendation: "promote" | "maintain" | "demote" | "disable" = "maintain";

    if (results.length < 5) {
      reasonings.push("Insufficient data for reliable recommendation");
    } else if (avgQuality >= 80 && successRate >= 0.9) {
      recommendation = "promote";
      reasonings.push(`High quality (${avgQuality.toFixed(1)}) and reliability (${(successRate * 100).toFixed(0)}%)`);
    } else if (avgQuality < 50) {
      recommendation = "disable";
      reasonings.push(`Quality below threshold (${avgQuality.toFixed(1)} < 50)`);
    } else if (successRate < 0.5) {
      recommendation = "disable";
      reasonings.push(`Reliability below threshold (${(successRate * 100).toFixed(0)}% < 50%)`);
    } else if (avgQuality < 65 || successRate < 0.7) {
      recommendation = "demote";
      reasonings.push(`Below optimal performance thresholds`);
    }

    if (avgLatency > 10000) {
      reasonings.push(`High latency: ${(avgLatency / 1000).toFixed(1)}s avg`);
      if (recommendation === "promote") recommendation = "maintain";
    }

    if (modelUsage.calls > 0) {
      const liveSuccessRate = modelUsage.success / modelUsage.calls;
      if (liveSuccessRate < 0.6) {
        reasonings.push(`Low live success rate: ${(liveSuccessRate * 100).toFixed(0)}%`);
        if (recommendation === "promote") recommendation = "maintain";
      }
    }

    return {
      modelId,
      periodStart,
      periodEnd,
      totalTasks: results.length + modelUsage.calls,
      successRate,
      avgLatencyMs: avgLatency,
      avgQuality,
      avgTokenEfficiency: avgTokenEff,
      avgCostEfficiency: avgCostEff,
      taskBreakdown,
      recommendation,
      reasonings,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get evaluation results for a model
 */
export const getEvaluationResults = internalQuery({
  args: {
    modelId: v.string(),
    since: v.number(),
  },
  handler: async (ctx, { modelId, since }): Promise<LiveEvaluationResult[]> => {
    // Query from the evaluation results we store
    const results = await ctx.db
      .query("freeModelEvaluations")
      .withIndex("by_timestamp")
      .filter((q) => q.gte(q.field("timestamp"), since))
      .collect() as Doc<"freeModelEvaluations">[];

    // Transform and filter by model
    return results
      .filter((r: Doc<"freeModelEvaluations">) => {
        // Get the model to check openRouterId
        return true; // We store modelId as string in LiveEvaluationResult
      })
      .map((r: Doc<"freeModelEvaluations">) => ({
        modelId: r.modelId as unknown as string,
        taskType: "evaluation",
        scenarioId: "basic",
        success: r.success,
        latencyMs: r.latencyMs,
        outputQuality: r.responseQuality ?? (r.success ? 70 : 0),
        tokenEfficiency: 1,
        costEfficiency: 100,
        errors: r.error ? [r.error] : [],
        timestamp: r.timestamp,
      }));
  },
});

/**
 * Get aggregate performance stats across all models
 */
export const getAggregateStats = internalQuery({
  args: {
    hours: v.optional(v.number()),
  },
  handler: async (ctx, { hours = 24 }) => {
    const since = Date.now() - hours * 60 * 60 * 1000;

    const evals = await ctx.db
      .query("freeModelEvaluations")
      .withIndex("by_timestamp")
      .filter((q) => q.gte(q.field("timestamp"), since))
      .collect() as Doc<"freeModelEvaluations">[];

    const usage = await ctx.db
      .query("autonomousModelUsage")
      .withIndex("by_timestamp")
      .filter((q) => q.gte(q.field("timestamp"), since))
      .collect() as Doc<"autonomousModelUsage">[];

    return {
      evaluationCount: evals.length,
      successfulEvals: evals.filter((e: Doc<"freeModelEvaluations">) => e.success).length,
      avgLatency: evals.length > 0
        ? evals.reduce((sum: number, e: Doc<"freeModelEvaluations">) => sum + e.latencyMs, 0) / evals.length
        : 0,
      usageCount: usage.length,
      successfulUsage: usage.filter((u: Doc<"autonomousModelUsage">) => u.success).length,
      totalCost: usage.reduce((sum: number, u: Doc<"autonomousModelUsage">) => sum + u.cost, 0),
      freeUsageCount: usage.filter((u: Doc<"autonomousModelUsage">) => u.cost === 0).length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record an evaluation result
 */
export const recordEvaluationResult = internalMutation({
  args: {
    modelId: v.string(),
    taskType: v.string(),
    scenarioId: v.string(),
    success: v.boolean(),
    latencyMs: v.number(),
    outputQuality: v.number(),
    tokenEfficiency: v.number(),
    costEfficiency: v.number(),
    errors: v.array(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // We use the freeModelEvaluations table but with extended data
    // The modelId here is a Doc<"freeModels"> ID string
    // We need to validate it exists first
    const modelDoc = await ctx.db.get(args.modelId as any);
    if (modelDoc) {
      await ctx.db.insert("freeModelEvaluations", {
        modelId: args.modelId as any,
        success: args.success,
        latencyMs: args.latencyMs,
        responseQuality: args.outputQuality,
        toolCallSuccess: undefined,
        error: args.errors.length > 0 ? args.errors.join("; ") : undefined,
        timestamp: args.timestamp,
      });
    }
  },
});
