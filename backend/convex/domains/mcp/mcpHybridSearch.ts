/**
 * MCP Hybrid Search - Fan-Out/Centralize Pattern
 *
 * Implements industry-standard hybrid search with multiple parallel search strategies,
 * aggregation, deduplication, and intelligent ranking.
 *
 * Architecture:
 * 1. Fan-Out: Run 6 parallel search strategies
 * 2. Aggregate: Collect and deduplicate results
 * 3. Centralize: Normalize and combine scores
 * 4. Rank: Final weighted scoring with diversity
 */

import { v } from "convex/values";
import { action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface SearchStrategy {
  name: string;
  weight: number; // How much to weight this strategy in final score
  results: Array<{
    toolId: Id<"mcpTools">;
    score: number; // 0-1 normalized score from this strategy
    reason: string; // Why this tool matched
  }>;
}

interface ToolCandidate {
  toolId: Id<"mcpTools">;
  serverId: Id<"mcpServers">;
  name: string;
  shortDescription: string;
  category: string;
  keywords: string[];
  schemaHash: string | null;
  accessTier: "public" | "user" | "restricted";
  usageCount: number;
  lastUsed: number | null;

  // Aggregated scores from multiple strategies
  scores: {
    exactMatch: number;     // 0-1
    fuzzyMatch: number;     // 0-1
    keywordMatch: number;   // 0-1
    categoryMatch: number;  // 0-1
    descriptionMatch: number; // 0-1
    popularityScore: number;  // 0-1
  };

  // Combined final score
  finalScore: number;
  matchReasons: string[]; // Why this tool was selected
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH STRATEGIES (Fan-Out)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strategy 1: Exact Name Match
 * Finds tools where name exactly matches query
 */
async function exactNameMatchStrategy(
  ctx: any,
  query: string,
  tools: any[]
): Promise<SearchStrategy> {
  const queryLower = query.toLowerCase().trim();

  const results = tools
    .filter(t => t.name.toLowerCase() === queryLower)
    .map(t => ({
      toolId: t._id as Id<"mcpTools">,
      score: 1.0, // Perfect match
      reason: "Exact name match",
    }));

  return {
    name: "exact_name",
    weight: 0.30, // 30% of final score
    results,
  };
}

/**
 * Strategy 2: Fuzzy Name Match
 * Finds tools where name contains query or query contains name
 */
async function fuzzyNameMatchStrategy(
  ctx: any,
  query: string,
  tools: any[]
): Promise<SearchStrategy> {
  const queryLower = query.toLowerCase().trim();

  const results = tools
    .map(t => {
      const nameLower = t.name.toLowerCase();

      // Calculate fuzzy score based on containment
      let score = 0;

      if (nameLower.includes(queryLower)) {
        // Query is substring of name
        score = queryLower.length / nameLower.length; // Longer match = higher score
      } else if (queryLower.includes(nameLower)) {
        // Name is substring of query
        score = nameLower.length / queryLower.length;
      } else {
        // Check word overlap
        const nameWords = nameLower.split(/[_\-\s]+/);
        const queryWords = queryLower.split(/[_\-\s]+/);
        const overlap = nameWords.filter(w => queryWords.includes(w)).length;
        score = overlap / Math.max(nameWords.length, queryWords.length);
      }

      return {
        toolId: t._id as Id<"mcpTools">,
        score,
        reason: `Fuzzy name match (${(score * 100).toFixed(0)}%)`,
      };
    })
    .filter(r => r.score > 0.2) // Only keep reasonable matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 20); // Top 20 fuzzy matches

  return {
    name: "fuzzy_name",
    weight: 0.20, // 20% of final score
    results,
  };
}

/**
 * Strategy 3: Keyword Match
 * Finds tools based on keyword overlap
 */
async function keywordMatchStrategy(
  ctx: any,
  query: string,
  tools: any[]
): Promise<SearchStrategy> {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  const results = tools
    .map(t => {
      const keywords = (t.keywords || []).map((k: string) => k.toLowerCase());

      // Count matching keywords
      const matchCount = queryTerms.filter(term =>
        keywords.some(kw => kw.includes(term) || term.includes(kw))
      ).length;

      const score = matchCount / Math.max(queryTerms.length, 1);

      return {
        toolId: t._id as Id<"mcpTools">,
        score,
        reason: `${matchCount}/${queryTerms.length} keywords matched`,
      };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    name: "keyword",
    weight: 0.15, // 15% of final score
    results,
  };
}

/**
 * Strategy 4: Category Match
 * Finds tools in relevant categories
 */
async function categoryMatchStrategy(
  ctx: any,
  query: string,
  tools: any[]
): Promise<SearchStrategy> {
  const queryLower = query.toLowerCase();

  // Map query to likely categories
  const categoryMappings: Record<string, string[]> = {
    "filesystem": ["file", "read", "write", "directory", "path", "fs"],
    "database": ["database", "sql", "query", "table", "db", "postgres", "mongo"],
    "api": ["http", "api", "fetch", "request", "rest", "graphql"],
    "search": ["search", "find", "lookup", "query", "grep"],
    "vcs": ["git", "github", "commit", "branch", "repo"],
    "communication": ["slack", "discord", "email", "message", "notify"],
    "devops": ["docker", "container", "kubernetes", "k8s", "deploy"],
    "ai": ["llm", "ai", "model", "embed", "generate", "openai"],
    "browser": ["browser", "chromium", "puppeteer", "playwright", "web"],
  };

  // Find matching categories
  const matchedCategories = Object.entries(categoryMappings)
    .filter(([_, keywords]) => keywords.some(kw => queryLower.includes(kw)))
    .map(([category, _]) => category);

  const results = tools
    .map(t => {
      const toolCategory = (t.category || "general").toLowerCase();

      let score = 0;
      if (matchedCategories.includes(toolCategory)) {
        score = 1.0; // Perfect category match
      } else if (matchedCategories.length === 0 && toolCategory === "general") {
        score = 0.3; // Fallback to general
      }

      return {
        toolId: t._id as Id<"mcpTools">,
        score,
        reason: score > 0 ? `Category: ${toolCategory}` : "",
      };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    name: "category",
    weight: 0.15, // 15% of final score
    results,
  };
}

/**
 * Strategy 5: Description Semantic Match
 * Finds tools based on description content
 */
async function descriptionMatchStrategy(
  ctx: any,
  query: string,
  tools: any[]
): Promise<SearchStrategy> {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  const results = tools
    .map(t => {
      const desc = (t.shortDescription || t.description || "").toLowerCase();

      // Count term overlap in description
      const matchCount = queryTerms.filter(term => desc.includes(term)).length;
      const score = matchCount / Math.max(queryTerms.length, 1);

      return {
        toolId: t._id as Id<"mcpTools">,
        score,
        reason: `Description contains ${matchCount}/${queryTerms.length} terms`,
      };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    name: "description",
    weight: 0.10, // 10% of final score
    results,
  };
}

/**
 * Strategy 6: Popularity & Recency
 * Finds frequently and recently used tools
 */
async function popularityStrategy(
  ctx: any,
  query: string,
  tools: any[]
): Promise<SearchStrategy> {
  const now = Date.now();
  const ONE_DAY = 86400000;
  const MAX_AGE = 30 * ONE_DAY; // 30 days

  const results = tools
    .map(t => {
      let score = 0;

      // Usage count component (0-0.5)
      const usageScore = Math.min((t.usageCount || 0) * 0.01, 0.5);

      // Recency component (0-0.5)
      let recencyScore = 0;
      if (t.lastUsed) {
        const age = now - t.lastUsed;
        recencyScore = Math.max(0, 0.5 * (1 - age / MAX_AGE));
      }

      score = usageScore + recencyScore;

      return {
        toolId: t._id as Id<"mcpTools">,
        score,
        reason: `Popular (${t.usageCount || 0} uses, ${t.lastUsed ? `${Math.floor((now - t.lastUsed) / ONE_DAY)}d ago` : "never"})`,
      };
    })
    .filter(r => r.score > 0.1) // Only reasonably popular tools
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    name: "popularity",
    weight: 0.10, // 10% of final score
    results,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATION & CENTRALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate results from all strategies
 * Deduplicates by toolId and combines scores
 */
function aggregateResults(
  strategies: SearchStrategy[],
  toolsMap: Map<string, any>
): ToolCandidate[] {
  // Group results by toolId
  const candidatesMap = new Map<string, ToolCandidate>();

  for (const strategy of strategies) {
    for (const result of strategy.results) {
      const toolIdStr = result.toolId;
      const tool = toolsMap.get(toolIdStr);

      if (!tool) continue;

      if (!candidatesMap.has(toolIdStr)) {
        // Initialize candidate
        candidatesMap.set(toolIdStr, {
          toolId: result.toolId,
          serverId: tool.serverId,
          name: tool.name,
          shortDescription: tool.shortDescription || tool.description || "",
          category: tool.category || "general",
          keywords: tool.keywords || [],
          schemaHash: tool.schemaHash || null,
          accessTier: (tool.accessTier || "public") as "public" | "user" | "restricted",
          usageCount: tool.usageCount || 0,
          lastUsed: tool.lastUsed || null,
          scores: {
            exactMatch: 0,
            fuzzyMatch: 0,
            keywordMatch: 0,
            categoryMatch: 0,
            descriptionMatch: 0,
            popularityScore: 0,
          },
          finalScore: 0,
          matchReasons: [],
        });
      }

      const candidate = candidatesMap.get(toolIdStr)!;

      // Add score from this strategy
      switch (strategy.name) {
        case "exact_name":
          candidate.scores.exactMatch = result.score;
          break;
        case "fuzzy_name":
          candidate.scores.fuzzyMatch = result.score;
          break;
        case "keyword":
          candidate.scores.keywordMatch = result.score;
          break;
        case "category":
          candidate.scores.categoryMatch = result.score;
          break;
        case "description":
          candidate.scores.descriptionMatch = result.score;
          break;
        case "popularity":
          candidate.scores.popularityScore = result.score;
          break;
      }

      candidate.matchReasons.push(result.reason);
    }
  }

  return Array.from(candidatesMap.values());
}

/**
 * Calculate final weighted score
 */
function calculateFinalScores(
  candidates: ToolCandidate[],
  strategies: SearchStrategy[]
): ToolCandidate[] {
  const strategyWeights = new Map(strategies.map(s => [s.name, s.weight]));

  for (const candidate of candidates) {
    let finalScore = 0;

    // Weighted combination of all scores
    finalScore += candidate.scores.exactMatch * (strategyWeights.get("exact_name") || 0);
    finalScore += candidate.scores.fuzzyMatch * (strategyWeights.get("fuzzy_name") || 0);
    finalScore += candidate.scores.keywordMatch * (strategyWeights.get("keyword") || 0);
    finalScore += candidate.scores.categoryMatch * (strategyWeights.get("category") || 0);
    finalScore += candidate.scores.descriptionMatch * (strategyWeights.get("description") || 0);
    finalScore += candidate.scores.popularityScore * (strategyWeights.get("popularity") || 0);

    candidate.finalScore = finalScore;
  }

  return candidates;
}

/**
 * Apply diversity constraint
 * Ensure we don't return all tools from same category
 */
function applyDiversityConstraint(
  candidates: ToolCandidate[],
  maxPerCategory: number = 5
): ToolCandidate[] {
  const categoryCounts = new Map<string, number>();
  const diverseCandidates: ToolCandidate[] = [];

  // Sort by final score descending
  const sorted = [...candidates].sort((a, b) => b.finalScore - a.finalScore);

  for (const candidate of sorted) {
    const count = categoryCounts.get(candidate.category) || 0;

    if (count < maxPerCategory) {
      diverseCandidates.push(candidate);
      categoryCounts.set(candidate.category, count + 1);
    }
  }

  return diverseCandidates;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hybrid search for MCP tools using fan-out/centralize pattern
 *
 * Runs 6 parallel search strategies, aggregates, deduplicates, and ranks results.
 */
export const hybridSearchMCPTools = action({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
    diversityConstraint: v.optional(v.boolean()), // Apply diversity (default: true)
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const applyDiversity = args.diversityConstraint !== false;

    // Get all available tools
    const tools = await ctx.runQuery(internal.domains.mcp.mcpToolRegistry.getAllAvailableTools, {});

    if (tools.length === 0) {
      return [];
    }

    // Create lookup map
    const toolsMap: Map<string, any> = new Map(tools.map(t => [t._id as string, t]));

    // PHASE 1: FAN-OUT - Run all search strategies in parallel
    console.log(`[HybridSearch] Fan-out: Running 6 search strategies for "${args.query}"`);

    const [
      exactStrategy,
      fuzzyStrategy,
      keywordStrategy,
      categoryStrategy,
      descriptionStrategy,
      popularityResult,
    ] = await Promise.all([
      exactNameMatchStrategy(ctx, args.query, tools),
      fuzzyNameMatchStrategy(ctx, args.query, tools),
      keywordMatchStrategy(ctx, args.query, tools),
      categoryMatchStrategy(ctx, args.query, tools),
      descriptionMatchStrategy(ctx, args.query, tools),
      popularityStrategy(ctx, args.query, tools),
    ]);

    const strategies = [
      exactStrategy,
      fuzzyStrategy,
      keywordStrategy,
      categoryStrategy,
      descriptionStrategy,
      popularityResult,
    ];

    console.log(`[HybridSearch] Strategy results: ${strategies.map(s => `${s.name}=${s.results.length}`).join(", ")}`);

    // PHASE 2: CENTRALIZE - Aggregate and deduplicate
    console.log(`[HybridSearch] Centralize: Aggregating and deduplicating`);
    let candidates = aggregateResults(strategies, toolsMap);

    console.log(`[HybridSearch] Found ${candidates.length} unique candidates`);

    // PHASE 3: SCORING - Calculate final weighted scores
    candidates = calculateFinalScores(candidates, strategies);

    // PHASE 4: DIVERSITY - Apply diversity constraint
    if (applyDiversity) {
      candidates = applyDiversityConstraint(candidates, 5);
    }

    // PHASE 5: RANK - Sort by final score and apply limit
    candidates.sort((a, b) => b.finalScore - a.finalScore);
    const topCandidates = candidates.slice(0, limit);

    console.log(`[HybridSearch] Returning top ${topCandidates.length} results`);

    // Format response
    return topCandidates.map(c => ({
      toolId: c.toolId,
      serverId: c.serverId,
      name: c.name,
      shortDescription: c.shortDescription,
      category: c.category,
      keywords: c.keywords,
      schemaHash: c.schemaHash,
      accessTier: c.accessTier,
      usageCount: c.usageCount,
      lastUsed: c.lastUsed,
      isAvailable: true,
      matchScore: c.finalScore,
      matchReasons: c.matchReasons,
      scoreBreakdown: c.scores, // For debugging/transparency
    }));
  },
});
