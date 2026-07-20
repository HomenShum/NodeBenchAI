/**
 * blipIngestion.ts - News item ingestion from feed sources
 *
 * Populates newsItems table from the 7 feed ingestors.
 * Leverages existing feed.ts patterns.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { NewsSource, NewsCategory } from "./types";

// ============================================================================
// Ingest Actions
// ============================================================================

/**
 * Ingest from Hacker News
 */
export const ingestHackerNews = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 30;
    const results: any[] = [];

    try {
      // Fetch top stories
      const topStoriesRes = await fetch(
        "https://hacker-news.firebaseio.com/v0/topstories.json"
      );
      const topStoryIds: number[] = await topStoriesRes.json();

      // Fetch story details
      const stories = await Promise.all(
        topStoryIds.slice(0, limit).map(async (id) => {
          const res = await fetch(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`
          );
          return res.json();
        })
      );

      // Process each story
      for (const story of stories) {
        if (!story || !story.title) continue;

        const sourceId = `hn-${story.id}`;
        const contentHash = await hashContent(story.title + (story.url || ""));

        const result = await ctx.runMutation(
          internal.domains.blips.blipMutations.upsertNewsItem,
          {
            sourceId,
            contentHash,
            source: "hacker_news",
            sourceUrl: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
            title: story.title,
            summary: story.text?.slice(0, 500),
            category: categorizeHN(story),
            tags: extractTags(story.title),
            engagementScore: normalizeScore(story.score || 0, 500),
            rawMetrics: {
              upvotes: story.score,
              comments: story.descendants || 0,
            },
            publishedAt: (story.time || Date.now() / 1000) * 1000,
          }
        );

        results.push(result);
      }
    } catch (error) {
      console.error("[BlipIngestion] HN error:", error);
    }

    return {
      source: "hacker_news",
      ingested: results.filter((r) => r.isNew).length,
      updated: results.filter((r) => !r.isNew).length,
    };
  },
});

/**
 * Ingest from Reddit
 */
export const ingestReddit = internalAction({
  args: {
    subreddits: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const subreddits = args.subreddits ?? [
      "technology",
      "programming",
      "machinelearning",
      "artificial",
      "startups",
      "biotech",
    ];
    const limit = args.limit ?? 10;
    const results: any[] = [];

    for (const subreddit of subreddits) {
      try {
        const res = await fetch(
          `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`,
          {
            headers: { "User-Agent": "NodeBench/1.0" },
          }
        );
        const data = await res.json();

        for (const post of data?.data?.children || []) {
          const p = post.data;
          if (!p.title) continue;

          const sourceId = `reddit-${p.id}`;
          const contentHash = await hashContent(p.title + p.selftext);

          const result = await ctx.runMutation(
            internal.domains.blips.blipMutations.upsertNewsItem,
            {
              sourceId,
              contentHash,
              source: "reddit",
              sourceUrl: `https://reddit.com${p.permalink}`,
              title: p.title,
              summary: p.selftext?.slice(0, 500),
              category: categorizeSubreddit(subreddit),
              tags: [subreddit, ...extractTags(p.title)],
              engagementScore: normalizeScore(p.score || 0, 1000),
              rawMetrics: {
                upvotes: p.score,
                comments: p.num_comments || 0,
              },
              publishedAt: (p.created_utc || Date.now() / 1000) * 1000,
            }
          );

          results.push(result);
        }
      } catch (error) {
        console.error(`[BlipIngestion] Reddit r/${subreddit} error:`, error);
      }
    }

    return {
      source: "reddit",
      ingested: results.filter((r) => r.isNew).length,
      updated: results.filter((r) => !r.isNew).length,
    };
  },
});

/**
 * Ingest from GitHub trending
 */
export const ingestGitHub = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 15;
    const results: any[] = [];

    try {
      // Use GitHub API for trending-like repos (most starred in last week)
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const res = await fetch(
        `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=${limit}`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "NodeBench/1.0",
          },
        }
      );
      const data = await res.json();

      for (const repo of data?.items || []) {
        const sourceId = `gh-${repo.id}`;
        const contentHash = await hashContent(repo.full_name + repo.description);

        const result = await ctx.runMutation(
          internal.domains.blips.blipMutations.upsertNewsItem,
          {
            sourceId,
            contentHash,
            source: "github",
            sourceUrl: repo.html_url,
            title: `${repo.full_name}: ${repo.description || "No description"}`,
            summary: repo.description,
            category: categorizeGitHub(repo),
            tags: [repo.language, ...(repo.topics || [])].filter(Boolean).slice(0, 5),
            engagementScore: normalizeScore(repo.stargazers_count || 0, 10000),
            rawMetrics: {
              stars: repo.stargazers_count,
            },
            publishedAt: new Date(repo.created_at).getTime(),
          }
        );

        results.push(result);
      }
    } catch (error) {
      console.error("[BlipIngestion] GitHub error:", error);
    }

    return {
      source: "github",
      ingested: results.filter((r) => r.isNew).length,
      updated: results.filter((r) => !r.isNew).length,
    };
  },
});

/**
 * Run all ingestors
 */
export const runAllIngestors = internalAction({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();

    // Run ingestors in parallel
    const [hn, reddit, github] = await Promise.all([
      ctx.runAction(internal.domains.blips.blipIngestion.ingestHackerNews, {}),
      ctx.runAction(internal.domains.blips.blipIngestion.ingestReddit, {}),
      ctx.runAction(internal.domains.blips.blipIngestion.ingestGitHub, {}),
    ]);

    const elapsedMs = Date.now() - startTime;

    return {
      results: { hn, reddit, github },
      totalIngested: (hn?.ingested || 0) + (reddit?.ingested || 0) + (github?.ingested || 0),
      totalUpdated: (hn?.updated || 0) + (reddit?.updated || 0) + (github?.updated || 0),
      elapsedMs,
    };
  },
});

// ============================================================================
// Helpers
// ============================================================================

async function hashContent(content: string): Promise<string> {
  // Use a simple hash function for content deduplication
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function normalizeScore(score: number, maxExpected: number): number {
  return Math.min(100, Math.round((score / maxExpected) * 100));
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();

  const tagKeywords = [
    "ai",
    "ml",
    "llm",
    "gpt",
    "openai",
    "anthropic",
    "google",
    "meta",
    "microsoft",
    "startup",
    "funding",
    "ipo",
    "security",
    "crypto",
    "blockchain",
    "rust",
    "python",
    "javascript",
    "typescript",
  ];

  for (const keyword of tagKeywords) {
    if (lower.includes(keyword)) {
      tags.push(keyword);
    }
  }

  return tags.slice(0, 5);
}

function categorizeHN(story: any): NewsCategory {
  const title = (story.title || "").toLowerCase();

  if (title.includes("ai") || title.includes("ml") || title.includes("llm")) {
    return "ai_ml";
  }
  if (title.includes("security") || title.includes("hack") || title.includes("cve")) {
    return "security";
  }
  if (title.includes("funding") || title.includes("raise") || title.includes("series")) {
    return "funding";
  }
  if (title.includes("startup") || title.includes("launch")) {
    return "startup";
  }
  if (title.includes("research") || title.includes("paper") || title.includes("study")) {
    return "research";
  }

  return "tech";
}

function categorizeSubreddit(subreddit: string): NewsCategory {
  const mapping: Record<string, NewsCategory> = {
    machinelearning: "ai_ml",
    artificial: "ai_ml",
    programming: "tech",
    technology: "tech",
    startups: "startup",
    biotech: "research",
    investing: "markets",
    cryptocurrency: "markets",
    netsec: "security",
  };

  return mapping[subreddit.toLowerCase()] || "general";
}

function categorizeGitHub(repo: any): NewsCategory {
  const topics = (repo.topics || []).join(" ").toLowerCase();
  const desc = (repo.description || "").toLowerCase();
  const lang = (repo.language || "").toLowerCase();

  if (topics.includes("ai") || topics.includes("machine-learning") || desc.includes("ai")) {
    return "ai_ml";
  }
  if (topics.includes("security") || topics.includes("hacking")) {
    return "security";
  }

  return "tech";
}
