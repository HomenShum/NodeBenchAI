/**
 * Search Fusion Benchmark Harness
 *
 * Provides:
 * - Standard output schema for search runs (JudgeInput)
 * - LLM-as-judge evaluation for search quality
 * - Pass/fail scoring based on relevance criteria
 * - Saved artifacts for iterative improvement
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * JUDGE MODEL POLICY (SERVER-SIDE ENFORCEMENT)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The judge model is SERVER-CONTROLLED and NOT user-configurable.
 * Configuration hierarchy:
 * 1. Environment variable: SEARCH_JUDGE_MODEL (must be approved model alias)
 * 2. Default fallback: "kimi-k2.6" when OpenRouter is configured, else DEFAULT_MODEL
 *
 * This prevents users from selecting expensive/slow models for evaluation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETERMINISM REQUIREMENTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * For reproducible evaluations:
 * - Temperature is pinned to 0 (deterministic output)
 * - judgePromptVersion is stored with each evaluation
 * - Raw LLM response is stored for replay/debugging
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RETENTION POLICY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - Evaluations are retained for 90 days
 * - Cleanup via `cleanupOldEvaluations` mutation (scheduled or manual)
 * - Uses `by_created` index for efficient deletion
 * - No PII is stored in evaluations (only query text and model outputs)
 *
 * @module search/fusion/benchmark
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../../../_generated/server";
import { internal, api } from "../../../_generated/api";
import type { SearchResponse, SearchSource, FusionSearchPayload } from "./types";
import {
  normalizeModelInput,
  getModelSpec,
  APPROVED_MODELS,
  DEFAULT_MODEL,
  type ApprovedModel
} from "../../agents/mcp_tools/models/modelResolver";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Current version of the judge prompt for tracking */
const JUDGE_PROMPT_VERSION = "1.0.0";

/** Pinned temperature for deterministic LLM output */
const JUDGE_TEMPERATURE = 0;

/** Retention period in milliseconds (90 days) */
const RETENTION_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Get the server-controlled judge model.
 * User cannot override this - it's determined by environment variable or default.
 */
function getServerJudgeModel(): ApprovedModel {
  const envModel = process.env.SEARCH_JUDGE_MODEL;
  if (envModel) {
    const normalized = normalizeModelInput(envModel);
    // Verify it's actually an approved model
    if (APPROVED_MODELS.includes(normalized)) {
      console.log(`[benchmark] Using env SEARCH_JUDGE_MODEL: ${normalized}`);
      return normalized;
    }
    console.warn(`[benchmark] Invalid SEARCH_JUDGE_MODEL: ${envModel}, falling back to default`);
  }
  if (process.env.OPENROUTER_API_KEY) {
    return normalizeModelInput("kimi-k2.6");
  }
  return DEFAULT_MODEL;
}

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Standard output schema for search runs - input to LLM judge.
 *
 * This schema is designed to be consumed by LLM-as-judge evaluation.
 * All fields are serializable and can be stored as JSON artifacts.
 */
export interface JudgeInput {
  /** Unique identifier for this evaluation */
  evaluationId: string;
  /** Original search query */
  query: string;
  /** Search mode used */
  mode: "fast" | "balanced" | "comprehensive";
  /** Sources that were queried */
  sourcesQueried: SearchSource[];
  /** Top N results for evaluation */
  results: JudgeResultItem[];
  /** Expected behavior description (optional, for ground truth) */
  expectedBehavior?: string;
  /** Ground truth URLs or titles (optional) */
  groundTruth?: string[];
  /**
   * Expected key facts that should appear in results.
   * Used for precision scoring - judge checks if these facts are present.
   * Example: ["Founded in 2020", "Series A funding", "CEO is John Doe"]
   */
  expectedKeyFacts?: string[];
  /**
   * Constraints that results must satisfy.
   * Used for filtering validation - judge checks if results meet criteria.
   * Example: ["Must be from 2023 or later", "Must mention revenue", "No paywalled sources"]
   */
  constraints?: string[];
  /** Timing metadata */
  timing: {
    totalMs: number;
    perSource: Record<string, number>;
  };
  /** Error summary */
  errors: Array<{ source: string; error: string }>;
}

/**
 * Timestamp source type for freshness scoring.
 * Helps judge understand reliability of timestamp.
 */
export type TimestampSource = "published" | "modified" | "crawled" | "unknown";

/**
 * Simplified result item for judge evaluation.
 * Includes structured timestamp for freshness scoring.
 */
export interface JudgeResultItem {
  rank: number;
  source: SearchSource;
  title: string;
  snippet: string;
  url?: string;
  contentType: string;
  /**
   * Timestamp in milliseconds since epoch (for freshness scoring).
   * Parsed from publishedAt string for reliable comparison.
   */
  timestampMs?: number;
  /**
   * Source of the timestamp for reliability assessment.
   * - "published": Original publication date (most reliable)
   * - "modified": Last modification date
   * - "crawled": When we fetched it (least reliable for freshness)
   * - "unknown": No timestamp available
   */
  timestampSource: TimestampSource;
  /** @deprecated Use timestampMs + timestampSource instead */
  publishedAt?: string;
}

/**
 * Judge rubric - criteria for evaluation
 */
export interface JudgeRubric {
  /** Query-result relevance (0-1) */
  relevance: {
    weight: number;
    description: string;
  };
  /** Source diversity (0-1) */
  diversity: {
    weight: number;
    description: string;
  };
  /** Result freshness (0-1) */
  freshness: {
    weight: number;
    description: string;
  };
  /** Coverage of key topics (0-1) */
  coverage: {
    weight: number;
    description: string;
  };
  /** Ranking quality (0-1) */
  ranking: {
    weight: number;
    description: string;
  };
}

/**
 * Judge evaluation result with determinism metadata.
 */
export interface JudgeResult {
  /** Overall pass/fail */
  pass: boolean;
  /** Overall score (0-1) */
  overallScore: number;
  /** Per-criterion scores */
  scores: {
    relevance: number;
    diversity: number;
    freshness: number;
    coverage: number;
    ranking: number;
  };
  /** LLM reasoning */
  reasoning: string;
  /** Specific issues found */
  issues: string[];
  /** Improvement suggestions */
  suggestions: string[];
  /** Timestamp */
  evaluatedAt: number;
  /** Version of the judge prompt used (for reproducibility) */
  judgePromptVersion: string;
  /** Raw LLM response for replay/debugging */
  rawResponse?: string;
  /** Model used for evaluation */
  judgeModel: ApprovedModel;
  /** Temperature used (should always be 0 for determinism) */
  temperature: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT RUBRIC
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_RUBRIC: JudgeRubric = {
  relevance: {
    weight: 0.35,
    description: "How well do the results answer the query? Are they on-topic and useful?",
  },
  diversity: {
    weight: 0.15,
    description: "Do results come from multiple sources? Is there variety in perspectives?",
  },
  freshness: {
    weight: 0.15,
    description: "Are results recent and up-to-date for time-sensitive queries?",
  },
  coverage: {
    weight: 0.20,
    description: "Do results cover the key aspects of the topic comprehensively?",
  },
  ranking: {
    weight: 0.15,
    description: "Are the most relevant results ranked highest? Is the ordering sensible?",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert SearchResponse to JudgeInput format.
 *
 * Extracts publishedAt from results for freshness scoring.
 * Supports expectedKeyFacts and constraints for precision validation.
 */
export function toJudgeInput(
  query: string,
  response: SearchResponse,
  options: {
    evaluationId?: string;
    expectedBehavior?: string;
    groundTruth?: string[];
    expectedKeyFacts?: string[];
    constraints?: string[];
    maxResults?: number;
  } = {}
): JudgeInput {
  const maxResults = options.maxResults || 10;

  return {
    evaluationId: options.evaluationId || `eval-${Date.now()}`,
    query,
    mode: response.mode,
    sourcesQueried: response.sourcesQueried,
    results: response.results.slice(0, maxResults).map((r, idx) => ({
      rank: idx + 1,
      source: r.source,
      title: r.title,
      snippet: r.snippet.slice(0, 300),
      url: r.url,
      contentType: r.contentType,
      // Include publishedAt for freshness scoring
      publishedAt: r.publishedAt,
      // Parse timestamp for reliable comparison
      timestampMs: r.publishedAt ? new Date(r.publishedAt).getTime() : undefined,
      // Infer timestamp source from metadata or default to "unknown"
      timestampSource: (r.metadata?.timestampSource as TimestampSource) ||
        (r.publishedAt ? "published" : "unknown") as TimestampSource,
    })),
    expectedBehavior: options.expectedBehavior,
    groundTruth: options.groundTruth,
    expectedKeyFacts: options.expectedKeyFacts,
    constraints: options.constraints,
    timing: {
      totalMs: response.totalTimeMs,
      perSource: response.timing,
    },
    errors: response.errors || [],
  };
}

/**
 * Build the LLM judge prompt.
 *
 * Includes all ground truth fields for comprehensive evaluation:
 * - groundTruth: Expected URLs/titles
 * - expectedKeyFacts: Facts that should appear in results
 * - constraints: Requirements results must satisfy
 * - publishedAt: For freshness scoring
 */
function buildJudgePrompt(input: JudgeInput, rubric: JudgeRubric): string {
  const criteriaList = Object.entries(rubric)
    .map(([key, value]) => `- **${key}** (weight: ${value.weight}): ${value.description}`)
    .join("\n");

  // Include publishedAt in results for freshness evaluation
  const resultsFormatted = input.results
    .map(r => {
      const parts = [`${r.rank}. [${r.source}] "${r.title}"`];
      if (r.publishedAt) parts.push(`(${r.publishedAt})`);
      parts.push(`- ${r.snippet}`);
      if (r.url) parts.push(`(${r.url})`);
      return parts.join(" ");
    })
    .join("\n");

  // Build optional sections
  const groundTruthSection = input.groundTruth?.length
    ? `\n## Ground Truth\nExpected to find: ${input.groundTruth.join(", ")}`
    : "";

  const keyFactsSection = input.expectedKeyFacts?.length
    ? `\n## Expected Key Facts\nResults should contain these facts:\n${input.expectedKeyFacts.map(f => `- ${f}`).join("\n")}`
    : "";

  const constraintsSection = input.constraints?.length
    ? `\n## Constraints\nResults must satisfy:\n${input.constraints.map(c => `- ${c}`).join("\n")}`
    : "";

  return `You are an expert search quality evaluator. Evaluate the following search results.

## Query
"${input.query}"

## Search Mode
${input.mode}

## Sources Queried
${input.sourcesQueried.join(", ")}
${groundTruthSection}${keyFactsSection}${constraintsSection}
${input.expectedBehavior ? `\n## Expected Behavior\n${input.expectedBehavior}` : ""}

## Results (Top ${input.results.length})
${resultsFormatted}

## Errors
${input.errors.length > 0 ? input.errors.map(e => `- ${e.source}: ${e.error}`).join("\n") : "None"}

## Evaluation Criteria
${criteriaList}

## Instructions
Evaluate the search results against each criterion. For each criterion, provide a score from 0.0 to 1.0.

For **freshness**: Check the publishedAt dates. Recent results (within 30 days) score higher for time-sensitive queries.
For **relevance**: Check if expectedKeyFacts are present in the results.
For **coverage**: Verify constraints are satisfied.

Then determine if the overall search PASSES or FAILS based on:
- PASS: Overall weighted score >= 0.7 AND no critical issues AND all constraints satisfied
- FAIL: Overall weighted score < 0.7 OR critical issues present OR constraints violated

Respond in JSON format:
{
  "pass": true/false,
  "scores": {
    "relevance": 0.0-1.0,
    "diversity": 0.0-1.0,
    "freshness": 0.0-1.0,
    "coverage": 0.0-1.0,
    "ranking": 0.0-1.0
  },
  "reasoning": "Brief explanation of your evaluation",
  "issues": ["List of specific issues found"],
  "suggestions": ["List of improvement suggestions"],
  "keyFactsFound": ["List of expected key facts that were found"],
  "constraintsViolated": ["List of constraints that were violated"]
}`;
}

/**
 * Parse LLM judge response
 */
function parseJudgeResponse(
  response: string,
  rubric: JudgeRubric,
  metadata: { judgeModel: ApprovedModel; rawResponse: string }
): JudgeResult {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Calculate overall score
    const scores = parsed.scores || {};
    let overallScore = 0;
    for (const [key, value] of Object.entries(rubric)) {
      const score = scores[key] || 0;
      overallScore += score * value.weight;
    }

    return {
      pass: parsed.pass === true && overallScore >= 0.7,
      overallScore,
      scores: {
        relevance: scores.relevance || 0,
        diversity: scores.diversity || 0,
        freshness: scores.freshness || 0,
        coverage: scores.coverage || 0,
        ranking: scores.ranking || 0,
      },
      reasoning: parsed.reasoning || "No reasoning provided",
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      evaluatedAt: Date.now(),
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      judgeModel: metadata.judgeModel,
      temperature: JUDGE_TEMPERATURE,
      rawResponse: metadata.rawResponse,
    };
  } catch (error) {
    console.error("[parseJudgeResponse] Failed to parse:", error);
    return {
      pass: false,
      overallScore: 0,
      scores: { relevance: 0, diversity: 0, freshness: 0, coverage: 0, ranking: 0 },
      reasoning: `Failed to parse LLM response: ${error}`,
      issues: ["Evaluation failed to complete"],
      suggestions: [],
      evaluatedAt: Date.now(),
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      judgeModel: metadata.judgeModel,
      temperature: JUDGE_TEMPERATURE,
      rawResponse: metadata.rawResponse,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVEX FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate search quality using LLM-as-judge.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SECURITY: Judge model is SERVER-CONTROLLED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The judge model is NOT user-configurable. It is determined by:
 * 1. Environment variable: SEARCH_JUDGE_MODEL
 * 2. Default fallback: gpt-5.2
 *
 * This prevents users from selecting expensive/slow models for evaluation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETERMINISM: Temperature pinned to 0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * For reproducible evaluations:
 * - Temperature is pinned to 0 (deterministic output)
 * - judgePromptVersion is stored with each evaluation
 * - Raw LLM response is stored for replay/debugging
 */
export const evaluateSearch = action({
  args: {
    query: v.string(),
    mode: v.optional(v.union(v.literal("fast"), v.literal("balanced"), v.literal("comprehensive"))),
    expectedBehavior: v.optional(v.string()),
    groundTruth: v.optional(v.array(v.string())),
    /** Expected key facts that should appear in results */
    expectedKeyFacts: v.optional(v.array(v.string())),
    /** Constraints that results must satisfy */
    constraints: v.optional(v.array(v.string())),
    maxResults: v.optional(v.number()),
    // NOTE: No 'model' arg - judge model is server-controlled
  },
  returns: v.object({
    judgeInput: v.any(),
    judgeResult: v.any(),
    searchResponse: v.any(),
    /** The resolved model alias used for evaluation */
    judgeModel: v.string(),
    /** Version of the judge prompt used */
    judgePromptVersion: v.string(),
    /** Temperature used (always 0 for determinism) */
    temperature: v.number(),
  }),
  handler: async (ctx, args) => {
    const mode = args.mode || "balanced";

    // SERVER-CONTROLLED judge model (not user-configurable)
    const judgeModel = getServerJudgeModel();
    const modelSpec = getModelSpec(judgeModel);

    console.log(`[evaluateSearch] Evaluating query: "${args.query}" in ${mode} mode`);
    console.log(`[evaluateSearch] Judge model: ${judgeModel} (sdkId: ${modelSpec.sdkId})`);

    // 1. Execute the search
    const searchPayload: FusionSearchPayload = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: args.query,
      mode,
      skipRateLimit: true,
      skipCache: true,
    });

    // Extract SearchResponse from versioned payload
    const searchResponse: SearchResponse = searchPayload.payload;

    // 2. Convert to JudgeInput with all ground truth fields
    const judgeInput = toJudgeInput(args.query, searchResponse, {
      expectedBehavior: args.expectedBehavior,
      groundTruth: args.groundTruth,
      expectedKeyFacts: args.expectedKeyFacts,
      constraints: args.constraints,
      maxResults: args.maxResults || 10,
    });

    // 3. Build prompt and call LLM
    const prompt = buildJudgePrompt(judgeInput, DEFAULT_RUBRIC);

    // Determine API endpoint and headers based on provider
    // DETERMINISM: Temperature pinned to 0 for reproducible evaluations
    let llmResponse: string;

    if (modelSpec.provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelSpec.sdkId,
          messages: [
            { role: "system", content: "You are an expert search quality evaluator. Respond only with valid JSON." },
            { role: "user", content: prompt },
          ],
          temperature: JUDGE_TEMPERATURE, // Pinned to 0 for determinism
          max_tokens: 1500,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      llmResponse = data.choices?.[0]?.message?.content || "";
    } else if (modelSpec.provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY || "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelSpec.sdkId,
          max_tokens: 1500,
          temperature: JUDGE_TEMPERATURE, // Pinned to 0 for determinism
          messages: [
            { role: "user", content: `You are an expert search quality evaluator. Respond only with valid JSON.\n\n${prompt}` },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      llmResponse = data.content?.[0]?.text || "";
    } else if (modelSpec.provider === "google") {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelSpec.sdkId}:generateContent?key=${process.env.GOOGLE_GENERATIVE_AI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are an expert search quality evaluator. Respond only with valid JSON.\n\n${prompt}` }] }],
            generationConfig: { temperature: JUDGE_TEMPERATURE, maxOutputTokens: 1500 }, // Pinned to 0 for determinism
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      llmResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      throw new Error(`Unsupported provider: ${modelSpec.provider}`);
    }

    // 4. Parse judge result with determinism metadata
    const judgeResult = parseJudgeResponse(llmResponse, DEFAULT_RUBRIC, {
      judgeModel,
      rawResponse: llmResponse,
    });

    // 5. Save evaluation artifact with determinism metadata
    await ctx.runMutation(internal.domains.search.fusion.benchmark.saveEvaluation, {
      evaluationId: judgeInput.evaluationId,
      query: args.query,
      mode,
      judgeModel,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      rawResponse: llmResponse,
      judgeInput: JSON.stringify(judgeInput),
      judgeResult: JSON.stringify(judgeResult),
      pass: judgeResult.pass,
      overallScore: judgeResult.overallScore,
    });

    console.log(`[evaluateSearch] Result: ${judgeResult.pass ? "PASS" : "FAIL"} (score: ${judgeResult.overallScore.toFixed(2)})`);
    console.log(`[evaluateSearch] Determinism: model=${judgeModel}, promptVersion=${JUDGE_PROMPT_VERSION}, temp=${JUDGE_TEMPERATURE}`);

    return {
      judgeInput,
      judgeResult,
      searchResponse,
      judgeModel,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      temperature: JUDGE_TEMPERATURE,
    };
  },
});

/**
 * Save evaluation artifact to database.
 *
 * Stores complete evaluation data for analysis and iteration.
 * Includes determinism metadata for reproducibility.
 */
export const saveEvaluation = internalMutation({
  args: {
    evaluationId: v.string(),
    query: v.string(),
    mode: v.string(),
    /** The approved model alias used for evaluation */
    judgeModel: v.string(),
    /** Version of the judge prompt used */
    judgePromptVersion: v.string(),
    /** Raw LLM response for replay/debugging */
    rawResponse: v.string(),
    judgeInput: v.string(),
    judgeResult: v.string(),
    pass: v.boolean(),
    overallScore: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("searchEvaluations", {
      evaluationId: args.evaluationId,
      query: args.query,
      mode: args.mode,
      judgeModel: args.judgeModel,
      judgePromptVersion: args.judgePromptVersion,
      rawResponse: args.rawResponse,
      judgeInput: args.judgeInput,
      judgeResult: args.judgeResult,
      pass: args.pass,
      overallScore: args.overallScore,
      createdAt: Date.now(),
    });
  },
});

/**
 * Cleanup old evaluations based on retention policy.
 *
 * Deletes evaluations older than RETENTION_PERIOD_MS (90 days).
 * Uses by_created index for efficient deletion.
 *
 * Can be called manually or scheduled via cron.
 */
export const cleanupOldEvaluations = internalMutation({
  args: {},
  returns: v.object({
    deleted: v.number(),
    cutoffDate: v.string(),
  }),
  handler: async (ctx) => {
    const cutoffMs = Date.now() - RETENTION_PERIOD_MS;
    const cutoffDate = new Date(cutoffMs).toISOString();

    console.log(`[cleanupOldEvaluations] Deleting evaluations older than ${cutoffDate}`);

    // Query old evaluations using the by_created index
    const oldEvaluations = await ctx.db
      .query("searchEvaluations")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoffMs))
      .collect();

    // Delete each old evaluation
    for (const evaluation of oldEvaluations) {
      await ctx.db.delete(evaluation._id);
    }

    console.log(`[cleanupOldEvaluations] Deleted ${oldEvaluations.length} evaluations`);

    return {
      deleted: oldEvaluations.length,
      cutoffDate,
    };
  },
});

/**
 * Get recent evaluations
 */
export const getRecentEvaluations = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    return await ctx.db
      .query("searchEvaluations")
      .order("desc")
      .take(limit);
  },
});

/**
 * Get evaluation statistics
 */
export const getEvaluationStats = internalQuery({
  args: {},
  returns: v.object({
    total: v.number(),
    passed: v.number(),
    failed: v.number(),
    passRate: v.number(),
    avgScore: v.number(),
  }),
  handler: async (ctx) => {
    const evals = await ctx.db.query("searchEvaluations").collect();

    const total = evals.length;
    const passed = evals.filter(e => e.pass).length;
    const failed = total - passed;
    const passRate = total > 0 ? passed / total : 0;
    const avgScore = total > 0 ? evals.reduce((sum, e) => sum + e.overallScore, 0) / total : 0;

    return { total, passed, failed, passRate, avgScore };
  },
});
