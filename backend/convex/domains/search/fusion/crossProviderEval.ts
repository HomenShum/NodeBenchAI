/**
 * Cross-Provider Search Evaluation Harness
 *
 * Establishes baseline metrics for search consistency across providers:
 * - Brave, Serper, Tavily, Linkup
 *
 * Metrics tracked:
 * - Relevance: Query-result alignment (LLM-judged)
 * - Consistency: Same query across providers returns overlapping results
 * - Score Normalization: Provider scores are comparable (0-1 scale)
 * - Deduplication Effectiveness: Duplicate detection across providers
 * - Ranking Agreement: Top results overlap across providers
 *
 * This establishes a BASELINE before refinements, enabling A/B comparison.
 *
 * @module search/fusion/crossProviderEval
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "../../../_generated/server";
import { internal, api } from "../../../_generated/api";
import { Doc } from "../../../_generated/dataModel";
import type { SearchResult, SearchSource, SearchMode } from "./types";
import {
  normalizeModelInput,
  getModelSpec,
  APPROVED_MODELS,
  DEFAULT_MODEL,
  type ApprovedModel
} from "../../agents/mcp_tools/models/modelResolver";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Evaluation version for tracking refinements */
const EVAL_VERSION = "1.0.0-baseline";

/** LinkedIn-relevant benchmark queries for funding/startup intelligence */
const LINKEDIN_BENCHMARK_QUERIES = [
  // Funding-focused (most relevant for LinkedIn posts)
  { query: "startup funding announcements today", category: "funding", expectedSources: ["news", "web"] },
  { query: "Series A funding rounds 2024", category: "funding", expectedSources: ["news", "web"] },
  { query: "AI startup raised money this week", category: "funding", expectedSources: ["news", "web"] },
  { query: "venture capital deals healthcare", category: "funding", expectedSources: ["news", "web"] },
  { query: "seed round fintech startup", category: "funding", expectedSources: ["news", "web"] },

  // Tech news (for daily digest)
  { query: "latest AI developments news", category: "tech_news", expectedSources: ["news", "web"] },
  { query: "OpenAI announcements today", category: "tech_news", expectedSources: ["news", "web"] },
  { query: "tech layoffs 2024", category: "tech_news", expectedSources: ["news", "web"] },

  // Company research (for entity enrichment)
  { query: "Stripe company valuation funding", category: "company", expectedSources: ["web", "news"] },
  { query: "Anthropic Claude AI company", category: "company", expectedSources: ["web", "news"] },
];

/** Providers to evaluate */
const PROVIDERS_TO_EVAL: SearchSource[] = ["brave", "serper", "tavily", "linkup"];

/**
 * Cross-provider evaluation result
 */
interface CrossProviderEvalResult {
  evalId: string;
  evalVersion: string;
  query: string;
  category: string;
  timestamp: number;

  // Per-provider results
  providerResults: {
    [provider: string]: {
      resultCount: number;
      topResults: Array<{
        title: string;
        url?: string;
        score: number;
        rank: number;
      }>;
      latencyMs: number;
      error?: string;
    };
  };

  // Cross-provider metrics
  metrics: {
    // URL overlap between providers (Jaccard similarity)
    urlOverlap: { [pair: string]: number };
    // Title similarity between providers
    titleOverlap: { [pair: string]: number };
    // Score distribution per provider (min, max, mean, stddev)
    scoreDistribution: {
      [provider: string]: {
        min: number;
        max: number;
        mean: number;
        stddev: number;
      };
    };
    // Ranking agreement (Kendall's tau or simple overlap@K)
    rankingAgreement: {
      topKOverlap: { [pair: string]: number };  // K=5
      consensusUrls: string[];  // URLs appearing in 3+ providers
    };
    // Deduplication potential (how many duplicates across providers)
    deduplicationPotential: {
      totalUniqueUrls: number;
      totalResults: number;
      duplicateRate: number;
    };
  };

  // LLM-judged relevance (optional, expensive)
  llmRelevance?: {
    perProvider: { [provider: string]: number };  // 0-1 score
    fusedResult: number;  // 0-1 score for fused results
    reasoning: string;
  };
}

/**
 * Baseline snapshot for comparison
 */
interface BaselineSnapshot {
  snapshotId: string;
  snapshotVersion: string;
  createdAt: number;
  queryCount: number;

  // Aggregate metrics across all queries
  aggregateMetrics: {
    avgUrlOverlap: number;
    avgTitleOverlap: number;
    avgRankingAgreement: number;
    avgDuplicateRate: number;
    avgRelevanceScore: number;

    // Per-provider stats
    perProvider: {
      [provider: string]: {
        avgLatencyMs: number;
        avgResultCount: number;
        avgScore: number;
        errorRate: number;
      };
    };
  };

  // Raw evaluation IDs for drill-down
  evaluationIds: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

/**
 * Normalize URL for comparison (remove protocol, www, trailing slash)
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") + parsed.pathname.replace(/\/$/, "");
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Normalize title for comparison (lowercase, remove punctuation)
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate standard deviation
 */
function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Generate all pairs from an array
 */
function getAllPairs<T>(arr: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      pairs.push([arr[i], arr[j]]);
    }
  }
  return pairs;
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE QUERY EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a single query across all providers.
 * This is the core evaluation function.
 */
export const evaluateSingleQuery = action({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    providers: v.optional(v.array(v.string())),
    maxResultsPerProvider: v.optional(v.number()),
    includeLlmRelevance: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<CrossProviderEvalResult> => {
    const evalId = `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const providers = (args.providers as SearchSource[]) || PROVIDERS_TO_EVAL;
    const maxResults = args.maxResultsPerProvider || 10;
    const category = args.category || "general";

    console.log(`[crossProviderEval] Starting evaluation ${evalId}`);
    console.log(`[crossProviderEval] Query: "${args.query}", providers: ${providers.join(",")}`);

    // Fetch results from each provider individually
    const providerResults: CrossProviderEvalResult["providerResults"] = {};
    const allUrls: Map<string, string[]> = new Map(); // normalized URL -> providers
    const allTitles: Map<string, string[]> = new Map(); // normalized title -> providers

    for (const provider of providers) {
      const startTime = Date.now();
      try {
        // Use fast mode with single source
        const response = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
          query: args.query,
          mode: "fast",
          sources: [provider],
          maxTotal: maxResults,
          skipCache: true,
        });

        const results = response.payload.results;
        const latencyMs = Date.now() - startTime;

        // Extract top results
        const topResults = results.slice(0, 10).map((r: SearchResult, i: number) => ({
          title: r.title,
          url: r.url,
          score: r.score,
          rank: i + 1,
        }));

        providerResults[provider] = {
          resultCount: results.length,
          topResults,
          latencyMs,
        };

        // Track URLs and titles for overlap calculation
        for (const r of results) {
          if (r.url) {
            const normalizedUrl = normalizeUrl(r.url);
            if (!allUrls.has(normalizedUrl)) {
              allUrls.set(normalizedUrl, []);
            }
            allUrls.get(normalizedUrl)!.push(provider);
          }

          const normalizedTitle = normalizeTitle(r.title);
          if (!allTitles.has(normalizedTitle)) {
            allTitles.set(normalizedTitle, []);
          }
          allTitles.get(normalizedTitle)!.push(provider);
        }

        console.log(`[crossProviderEval] ${provider}: ${results.length} results in ${latencyMs}ms`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        providerResults[provider] = {
          resultCount: 0,
          topResults: [],
          latencyMs: Date.now() - startTime,
          error: errorMsg,
        };
        console.error(`[crossProviderEval] ${provider} failed: ${errorMsg}`);
      }
    }

    // Calculate cross-provider metrics
    const providerPairs = getAllPairs(providers.filter(p => !providerResults[p]?.error));

    // URL overlap between pairs
    const urlOverlap: { [pair: string]: number } = {};
    for (const [p1, p2] of providerPairs) {
      const urls1 = new Set(
        providerResults[p1]?.topResults
          .filter(r => r.url)
          .map(r => normalizeUrl(r.url!)) || []
      );
      const urls2 = new Set(
        providerResults[p2]?.topResults
          .filter(r => r.url)
          .map(r => normalizeUrl(r.url!)) || []
      );
      urlOverlap[`${p1}_${p2}`] = jaccardSimilarity(urls1, urls2);
    }

    // Title overlap between pairs
    const titleOverlap: { [pair: string]: number } = {};
    for (const [p1, p2] of providerPairs) {
      const titles1 = new Set(
        providerResults[p1]?.topResults.map(r => normalizeTitle(r.title)) || []
      );
      const titles2 = new Set(
        providerResults[p2]?.topResults.map(r => normalizeTitle(r.title)) || []
      );
      titleOverlap[`${p1}_${p2}`] = jaccardSimilarity(titles1, titles2);
    }

    // Score distribution per provider
    const scoreDistribution: CrossProviderEvalResult["metrics"]["scoreDistribution"] = {};
    for (const provider of providers) {
      const scores = providerResults[provider]?.topResults.map(r => r.score) || [];
      if (scores.length > 0) {
        scoreDistribution[provider] = {
          min: Math.min(...scores),
          max: Math.max(...scores),
          mean: scores.reduce((a, b) => a + b, 0) / scores.length,
          stddev: stddev(scores),
        };
      }
    }

    // Top-K ranking agreement (K=5)
    const topKOverlap: { [pair: string]: number } = {};
    const K = 5;
    for (const [p1, p2] of providerPairs) {
      const top1 = new Set(
        providerResults[p1]?.topResults
          .slice(0, K)
          .filter(r => r.url)
          .map(r => normalizeUrl(r.url!)) || []
      );
      const top2 = new Set(
        providerResults[p2]?.topResults
          .slice(0, K)
          .filter(r => r.url)
          .map(r => normalizeUrl(r.url!)) || []
      );
      topKOverlap[`${p1}_${p2}`] = jaccardSimilarity(top1, top2);
    }

    // Consensus URLs (appearing in 3+ providers)
    const consensusUrls = [...allUrls.entries()]
      .filter(([_, providers]) => providers.length >= 3)
      .map(([url, _]) => url);

    // Deduplication potential
    const totalResults = Object.values(providerResults)
      .reduce((sum, pr) => sum + pr.resultCount, 0);
    const totalUniqueUrls = allUrls.size;
    const duplicateRate = totalResults > 0
      ? 1 - (totalUniqueUrls / totalResults)
      : 0;

    const result: CrossProviderEvalResult = {
      evalId,
      evalVersion: EVAL_VERSION,
      query: args.query,
      category,
      timestamp: Date.now(),
      providerResults,
      metrics: {
        urlOverlap,
        titleOverlap,
        scoreDistribution,
        rankingAgreement: {
          topKOverlap,
          consensusUrls,
        },
        deduplicationPotential: {
          totalUniqueUrls,
          totalResults,
          duplicateRate,
        },
      },
    };

    // Save evaluation to database
    await ctx.runMutation(internal.domains.search.fusion.crossProviderEval.saveEvaluation, {
      evaluation: result,
    });

    console.log(`[crossProviderEval] Completed ${evalId}`);
    console.log(`[crossProviderEval] Metrics: urlOverlap=${JSON.stringify(urlOverlap)}`);
    console.log(`[crossProviderEval] Duplicate rate: ${(duplicateRate * 100).toFixed(1)}%`);

    return result;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BASELINE GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run full baseline evaluation across all benchmark queries.
 * This establishes the baseline for comparison after refinements.
 */
export const runBaselineEvaluation = action({
  args: {
    queries: v.optional(v.array(v.object({
      query: v.string(),
      category: v.string(),
    }))),
    providers: v.optional(v.array(v.string())),
    delayBetweenQueriesMs: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<BaselineSnapshot> => {
    const snapshotId = `baseline_${Date.now()}`;
    const queries = args.queries || LINKEDIN_BENCHMARK_QUERIES;
    const providers = args.providers || PROVIDERS_TO_EVAL;
    const delayMs = args.delayBetweenQueriesMs || 2000; // 2s between queries to avoid rate limits

    console.log(`[crossProviderEval] Starting baseline evaluation ${snapshotId}`);
    console.log(`[crossProviderEval] ${queries.length} queries, ${providers.length} providers`);

    const evaluationIds: string[] = [];
    const allResults: CrossProviderEvalResult[] = [];

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      console.log(`[crossProviderEval] Query ${i + 1}/${queries.length}: "${q.query}"`);

      try {
        const result = await ctx.runAction(
          api.domains.search.fusion.crossProviderEval.evaluateSingleQuery,
          {
            query: q.query,
            category: q.category,
            providers,
          }
        );

        evaluationIds.push(result.evalId);
        allResults.push(result);
      } catch (error) {
        console.error(`[crossProviderEval] Query failed: ${error}`);
      }

      // Delay between queries to avoid rate limits
      if (i < queries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Calculate aggregate metrics
    const validResults = allResults.filter(r => Object.keys(r.providerResults).length > 0);

    // Average URL overlap across all pairs
    const allUrlOverlaps = validResults.flatMap(r => Object.values(r.metrics.urlOverlap));
    const avgUrlOverlap = allUrlOverlaps.length > 0
      ? allUrlOverlaps.reduce((a, b) => a + b, 0) / allUrlOverlaps.length
      : 0;

    // Average title overlap
    const allTitleOverlaps = validResults.flatMap(r => Object.values(r.metrics.titleOverlap));
    const avgTitleOverlap = allTitleOverlaps.length > 0
      ? allTitleOverlaps.reduce((a, b) => a + b, 0) / allTitleOverlaps.length
      : 0;

    // Average ranking agreement (top-K)
    const allRankingOverlaps = validResults.flatMap(r => Object.values(r.metrics.rankingAgreement.topKOverlap));
    const avgRankingAgreement = allRankingOverlaps.length > 0
      ? allRankingOverlaps.reduce((a, b) => a + b, 0) / allRankingOverlaps.length
      : 0;

    // Average duplicate rate
    const allDuplicateRates = validResults.map(r => r.metrics.deduplicationPotential.duplicateRate);
    const avgDuplicateRate = allDuplicateRates.length > 0
      ? allDuplicateRates.reduce((a, b) => a + b, 0) / allDuplicateRates.length
      : 0;

    // Per-provider stats
    const perProvider: BaselineSnapshot["aggregateMetrics"]["perProvider"] = {};
    for (const provider of providers) {
      const providerData = validResults
        .filter(r => r.providerResults[provider] && !r.providerResults[provider].error)
        .map(r => r.providerResults[provider]);

      if (providerData.length > 0) {
        perProvider[provider] = {
          avgLatencyMs: providerData.reduce((sum, d) => sum + d.latencyMs, 0) / providerData.length,
          avgResultCount: providerData.reduce((sum, d) => sum + d.resultCount, 0) / providerData.length,
          avgScore: providerData
            .flatMap(d => d.topResults.map(r => r.score))
            .reduce((sum, s, _, arr) => sum + s / arr.length, 0),
          errorRate: 1 - (providerData.length / validResults.length),
        };
      }
    }

    const snapshot: BaselineSnapshot = {
      snapshotId,
      snapshotVersion: EVAL_VERSION,
      createdAt: Date.now(),
      queryCount: queries.length,
      aggregateMetrics: {
        avgUrlOverlap,
        avgTitleOverlap,
        avgRankingAgreement,
        avgDuplicateRate,
        avgRelevanceScore: 0, // Would need LLM judging
        perProvider,
      },
      evaluationIds,
    };

    // Save baseline snapshot
    await ctx.runMutation(internal.domains.search.fusion.crossProviderEval.saveBaseline, {
      baseline: snapshot,
    });

    console.log(`[crossProviderEval] Baseline complete: ${snapshotId}`);
    console.log(`[crossProviderEval] Aggregate metrics:`);
    console.log(`  - URL overlap: ${(avgUrlOverlap * 100).toFixed(1)}%`);
    console.log(`  - Title overlap: ${(avgTitleOverlap * 100).toFixed(1)}%`);
    console.log(`  - Ranking agreement: ${(avgRankingAgreement * 100).toFixed(1)}%`);
    console.log(`  - Duplicate rate: ${(avgDuplicateRate * 100).toFixed(1)}%`);

    return snapshot;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPARISON EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare current results against a baseline snapshot.
 * Returns delta metrics showing improvement or regression.
 */
export const compareToBaseline = action({
  args: {
    baselineSnapshotId: v.string(),
    queries: v.optional(v.array(v.object({
      query: v.string(),
      category: v.string(),
    }))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Get baseline
    const baseline = await ctx.runQuery(
      internal.domains.search.fusion.crossProviderEval.getBaseline,
      { snapshotId: args.baselineSnapshotId }
    );

    if (!baseline) {
      throw new Error(`Baseline ${args.baselineSnapshotId} not found`);
    }

    // Run new evaluation with same queries
    const queries = args.queries || LINKEDIN_BENCHMARK_QUERIES;
    const newSnapshot = await ctx.runAction(
      api.domains.search.fusion.crossProviderEval.runBaselineEvaluation,
      { queries }
    );

    // Calculate deltas
    const deltas = {
      urlOverlap: newSnapshot.aggregateMetrics.avgUrlOverlap - baseline.aggregateMetrics.avgUrlOverlap,
      titleOverlap: newSnapshot.aggregateMetrics.avgTitleOverlap - baseline.aggregateMetrics.avgTitleOverlap,
      rankingAgreement: newSnapshot.aggregateMetrics.avgRankingAgreement - baseline.aggregateMetrics.avgRankingAgreement,
      duplicateRate: newSnapshot.aggregateMetrics.avgDuplicateRate - baseline.aggregateMetrics.avgDuplicateRate,
    };

    // Determine if improvement or regression
    const improved = deltas.urlOverlap > 0 || deltas.rankingAgreement > 0;
    const regressed = deltas.urlOverlap < -0.1 || deltas.rankingAgreement < -0.1;

    console.log(`[crossProviderEval] Comparison complete`);
    console.log(`  - URL overlap: ${baseline.aggregateMetrics.avgUrlOverlap.toFixed(3)} -> ${newSnapshot.aggregateMetrics.avgUrlOverlap.toFixed(3)} (${deltas.urlOverlap > 0 ? '+' : ''}${deltas.urlOverlap.toFixed(3)})`);
    console.log(`  - Ranking agreement: ${baseline.aggregateMetrics.avgRankingAgreement.toFixed(3)} -> ${newSnapshot.aggregateMetrics.avgRankingAgreement.toFixed(3)} (${deltas.rankingAgreement > 0 ? '+' : ''}${deltas.rankingAgreement.toFixed(3)})`);
    console.log(`  - Status: ${improved ? 'IMPROVED' : regressed ? 'REGRESSED' : 'STABLE'}`);

    return {
      baselineSnapshotId: args.baselineSnapshotId,
      newSnapshotId: newSnapshot.snapshotId,
      baseline: baseline.aggregateMetrics,
      current: newSnapshot.aggregateMetrics,
      deltas,
      status: improved ? 'improved' : regressed ? 'regressed' : 'stable',
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save evaluation result to database
 */
export const saveEvaluation = internalMutation({
  args: {
    evaluation: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("searchCrossProviderEvals", {
      evalId: args.evaluation.evalId,
      evalVersion: args.evaluation.evalVersion,
      query: args.evaluation.query,
      category: args.evaluation.category,
      timestamp: args.evaluation.timestamp,
      providerResults: JSON.stringify(args.evaluation.providerResults),
      metrics: JSON.stringify(args.evaluation.metrics),
    });
  },
});

/**
 * Save baseline snapshot to database
 */
export const saveBaseline = internalMutation({
  args: {
    baseline: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("searchBaselineSnapshots", {
      snapshotId: args.baseline.snapshotId,
      snapshotVersion: args.baseline.snapshotVersion,
      createdAt: args.baseline.createdAt,
      queryCount: args.baseline.queryCount,
      aggregateMetrics: JSON.stringify(args.baseline.aggregateMetrics),
      evaluationIds: args.baseline.evaluationIds,
    });
  },
});

/**
 * Get baseline snapshot by ID
 */
export const getBaseline = internalQuery({
  args: {
    snapshotId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("searchBaselineSnapshots")
      .filter(q => q.eq(q.field("snapshotId"), args.snapshotId))
      .first() as Doc<"searchBaselineSnapshots"> | null;

    if (!snapshot) return null;

    return {
      ...snapshot,
      aggregateMetrics: JSON.parse(snapshot.aggregateMetrics),
    };
  },
});

/**
 * Get all baseline snapshots
 */
export const listBaselines = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const snapshots = await ctx.db
      .query("searchBaselineSnapshots")
      .order("desc")
      .take(20);

    return snapshots.map((s: Doc<"searchBaselineSnapshots">) => ({
      snapshotId: s.snapshotId,
      snapshotVersion: s.snapshotVersion,
      createdAt: s.createdAt,
      queryCount: s.queryCount,
    }));
  },
});

/**
 * Get evaluation by ID
 */
export const getEvaluation = internalQuery({
  args: {
    evalId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const evaluation = await ctx.db
      .query("searchCrossProviderEvals")
      .filter(q => q.eq(q.field("evalId"), args.evalId))
      .first() as Doc<"searchCrossProviderEvals"> | null;

    if (!evaluation) return null;

    return {
      ...evaluation,
      providerResults: JSON.parse(evaluation.providerResults),
      metrics: JSON.parse(evaluation.metrics),
    };
  },
});

/**
 * Get recent evaluations
 */
export const getRecentEvaluations = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    const evaluations = await ctx.db
      .query("searchCrossProviderEvals")
      .order("desc")
      .take(limit);

    return evaluations.map((e: Doc<"searchCrossProviderEvals">) => ({
      evalId: e.evalId,
      query: e.query,
      category: e.category,
      timestamp: e.timestamp,
      metrics: JSON.parse(e.metrics),
    }));
  },
});
