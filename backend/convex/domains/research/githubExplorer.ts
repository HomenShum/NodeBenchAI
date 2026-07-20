/**
 * GitHub Explorer - Repository Discovery with X Algorithm Patterns
 * Phase 6 Implementation
 *
 * Features:
 * - Trending repository analysis
 * - Language/topic filtering
 * - Star growth tracking
 * - Phoenix ML scoring for relevance
 * - Related repo suggestions
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const GITHUB_CONFIG = {
  trendingLanguages: ["TypeScript", "Python", "Rust", "Go", "JavaScript"],
  trendingTopics: [
    "ai",
    "llm",
    "machine-learning",
    "agents",
    "rag",
    "embeddings",
    "langchain",
    "openai",
  ],
  minStars: 100,
  refreshIntervalMs: 60 * 60 * 1000, // 1 hour
  discoveryLimit: 50,
} as const;

export interface GitHubRepo {
  fullName: string;
  name: string;
  description: string;
  language: string;
  stars: number;
  starGrowth7d: number;
  topics: string[];
  url: string;
  lastUpdated: number;
}

export interface ScoredRepo extends GitHubRepo {
  phoenixScore: number;
  relevanceReason: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// GITHUB API INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch trending repositories from GitHub API
 */
export const fetchTrendingRepos = internalAction({
  args: {
    language: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, { language, topic }): Promise<GitHubRepo[]> => {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      console.warn("[githubExplorer] GITHUB_TOKEN not set, using unauthenticated requests");
    }

    // Build search query
    const queries: string[] = [];
    if (language) queries.push(`language:${language}`);
    if (topic) queries.push(`topic:${topic}`);
    queries.push("stars:>100");
    queries.push("pushed:>2025-12-01"); // Recent activity

    const searchQuery = queries.join(" ");
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc&per_page=${GITHUB_CONFIG.discoveryLimit}`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          ...(githubToken && { Authorization: `Bearer ${githubToken}` }),
          "User-Agent": "NodeBench-AI-Explorer",
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();
      const repos: GitHubRepo[] = data.items.map((item: any) => ({
        fullName: item.full_name,
        name: item.name,
        description: item.description || "No description",
        language: item.language || "Unknown",
        stars: item.stargazers_count,
        starGrowth7d: 0, // TODO: Calculate from history API
        topics: item.topics || [],
        url: item.html_url,
        lastUpdated: new Date(item.pushed_at).getTime(),
      }));

      return repos;
    } catch (error) {
      console.error("[githubExplorer] Failed to fetch trending repos:", error);
      return [];
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHOENIX ML SCORING FOR REPOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Score repositories using Phoenix ML (Grok)
 */
export const scoreReposWithPhoenix = internalAction({
  args: {
    repos: v.array(v.any()),
    userInterests: v.array(v.string()),
  },
  handler: async (ctx, { repos, userInterests }): Promise<ScoredRepo[]> => {
    if (repos.length === 0) {
      return [];
    }

    const prompt = `You are Phoenix ML, X's ranking algorithm for GitHub repository discovery.

User Interests: ${userInterests.join(", ")}

Repositories to rank (${repos.length}):
${repos
  .map(
    (r: GitHubRepo, idx: number) => `
${idx + 1}. ${r.fullName}
   Language: ${r.language}
   Stars: ${r.stars.toLocaleString()}
   Topics: ${r.topics.join(", ")}
   Description: ${r.description}
`
  )
  .join("\n")}

Task: Rank these repositories by relevance to the user's interests.

For each repository, provide:
1. phoenixScore (0-100): Overall relevance
2. relevanceReason (15-20 words): Why relevant

Return JSON array sorted by phoenixScore (highest first):
[
  {
    "idx": 1,
    "phoenixScore": 95,
    "relevanceReason": "..."
  },
  ...
]`;

    try {
      const response = await ctx.runAction(
        internal.domains.models.autonomousModelResolver.executeWithFallback,
        {
          taskType: "research",
          messages: [
            { role: "system", content: "You are Phoenix ML, X's GitHub ranking algorithm." },
            { role: "user", content: prompt },
          ],
          maxTokens: 2000,
          temperature: 0.3,
        }
      );

      const scores = JSON.parse(response.content) as Array<{
        idx: number;
        phoenixScore: number;
        relevanceReason: string;
      }>;

      const scored: ScoredRepo[] = scores.map((s) => {
        const repo = repos[s.idx - 1];
        return {
          ...repo,
          phoenixScore: s.phoenixScore,
          relevanceReason: s.relevanceReason,
        };
      });

      return scored;
    } catch (error) {
      console.error("[githubExplorer] Phoenix scoring failed:", error);
      // Fallback: star-based ranking
      return repos.map((r: GitHubRepo, idx: number) => ({
        ...r,
        phoenixScore: 100 - idx,
        relevanceReason: "Ranked by popularity (scoring unavailable)",
      }));
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVERY PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discover trending repositories
 */
export const discoverTrendingRepos = internalAction({
  args: {
    language: v.optional(v.string()),
    topic: v.optional(v.string()),
    userInterests: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { language, topic, userInterests = ["ai", "llm"] }) => {
    console.log("[githubExplorer] Discovering trending repos");

    // STEP 1: Fetch from GitHub API
    const repos = await ctx.runAction(internal.domains.research.githubExplorer.fetchTrendingRepos, {
      language,
      topic,
    });

    console.log(`[githubExplorer] Fetched ${repos.length} repos`);

    if (repos.length === 0) {
      return [];
    }

    // STEP 2: Phoenix ML Scoring
    const scored = await ctx.runAction(
      internal.domains.research.githubExplorer.scoreReposWithPhoenix,
      { repos, userInterests }
    );

    console.log(`[githubExplorer] Scored ${scored.length} repos`);

    // STEP 3: Save to database
    await ctx.runMutation(internal.domains.research.githubExplorer.saveDiscoveredRepos, {
      repos: scored,
    });

    return scored;
  },
});

/**
 * Get trending repositories (public query)
 */
export const getTrendingRepos = query({
  args: {
    language: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { language, limit = 20 }) => {
    let query = ctx.db
      .query("githubRepositories")
      .withIndex("by_phoenix_score");

    if (language) {
      query = query.filter((q) => q.eq(q.field("language"), language)) as any;
    }

    return await query.order("desc").take(limit);
  },
});

/**
 * Get repositories by star growth
 */
export const getFastestGrowingRepos = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 10 }) => {
    return await ctx.db
      .query("githubRepositories")
      .withIndex("by_star_growth")
      .order("desc")
      .take(limit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save discovered repositories
 */
export const saveDiscoveredRepos = internalMutation({
  args: {
    repos: v.array(v.any()),
  },
  handler: async (ctx, { repos }) => {
    for (const repo of repos) {
      // Check if exists
      const existing = await ctx.db
        .query("githubRepositories")
        .filter((q) => q.eq(q.field("fullName"), repo.fullName))
        .unique();

      if (existing) {
        // Update if Phoenix score changed significantly
        if (Math.abs(existing.phoenixScore - repo.phoenixScore) > 5) {
          await ctx.db.patch(existing._id, {
            phoenixScore: repo.phoenixScore,
            relevanceReason: repo.relevanceReason,
            stars: repo.stars,
            starGrowth7d: repo.starGrowth7d,
            lastUpdated: Date.now(),
          });
        }
      } else {
        // Insert new repo
        await ctx.db.insert("githubRepositories", {
          fullName: repo.fullName,
          name: repo.name,
          description: repo.description,
          language: repo.language,
          stars: repo.stars,
          starGrowth7d: repo.starGrowth7d,
          phoenixScore: repo.phoenixScore,
          relevanceReason: repo.relevanceReason,
          topics: repo.topics,
          url: repo.url,
          lastUpdated: repo.lastUpdated,
          discoveredAt: Date.now(),
        });
      }
    }
  },
});
