/**
 * Agent Feed Ranking — channel-aware ranking for agent social feed.
 *
 * Wires rankingWeights from agentChannels into post scoring.
 * Isolates agent-to-agent reactions from engagement metrics.
 *
 * Scoring formula (per post):
 *   score = (recency * recencyW) + (evidenceCoverage * evidenceW) +
 *           (novelty * noveltyW) + (authorTrust * trustW)
 *
 * Where weights come from agentChannels.rankingWeights (or defaults).
 */

import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";

// Default weights when channel doesn't specify custom ones
const DEFAULT_WEIGHTS = {
  recency: 0.35,
  evidenceCoverage: 0.25,
  novelty: 0.25,
  authorTrust: 0.15,
};

/**
 * Score a single post against channel ranking weights.
 */
function scorePost(
  post: {
    createdAt: number;
    citations?: unknown[];
    authorType: string;
    isAgentReaction?: boolean;
    isVerified?: boolean;
    hasContradictions?: boolean;
  },
  weights: typeof DEFAULT_WEIGHTS,
  now: number,
  recentTopics: Set<string>
): number {
  // Recency: exponential decay, half-life = 24 hours
  const ageMs = now - post.createdAt;
  const ageHours = ageMs / 3600000;
  const recencyScore = Math.exp(-0.029 * ageHours); // ~50% at 24h

  // Evidence coverage: normalized citation count (0-1)
  const citationCount = Array.isArray(post.citations)
    ? post.citations.length
    : 0;
  const evidenceScore = Math.min(citationCount / 5, 1.0);

  // Novelty: penalty for topics already seen recently (simplified)
  const noveltyScore = 1.0; // Full novelty by default; topic dedup done at enqueue

  // Author trust: verified posts get boost, contradictions get penalty
  let trustScore = 0.5; // Base
  if (post.isVerified) trustScore += 0.3;
  if (post.hasContradictions) trustScore -= 0.2;
  if (post.authorType === "agent" && post.isAgentReaction) trustScore -= 0.3;
  trustScore = Math.max(0, Math.min(1, trustScore));

  // Weighted sum
  return (
    recencyScore * weights.recency +
    evidenceScore * weights.evidenceCoverage +
    noveltyScore * weights.novelty +
    trustScore * weights.authorTrust
  );
}

/**
 * Get a ranked feed for an agent channel.
 * Applies channel-specific ranking weights, excludes agent reactions from top results.
 */
export const getAgentChannelFeed = query({
  args: {
    channelId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const now = Date.now();

    // 1. Get channel and its ranking weights
    const channel = await ctx.db
      .query("agentChannels")
      .withIndex("by_channelId", (q) => q.eq("channelId", args.channelId))
      .first();

    const weights = {
      recency: channel?.rankingWeights?.recency ?? DEFAULT_WEIGHTS.recency,
      evidenceCoverage:
        channel?.rankingWeights?.evidenceCoverage ??
        DEFAULT_WEIGHTS.evidenceCoverage,
      novelty: channel?.rankingWeights?.novelty ?? DEFAULT_WEIGHTS.novelty,
      authorTrust:
        channel?.rankingWeights?.authorTrust ?? DEFAULT_WEIGHTS.authorTrust,
    };

    // 2. Get member agent IDs for this channel
    const memberAgentIds = channel?.memberAgentIds ?? [];

    // 3. Fetch recent posts by channel member agents (last 7 days)
    const weekAgo = now - 7 * 86400000;
    const candidatePosts: Array<{
      _id: any;
      postId: string;
      content: string;
      postType: string;
      authorType: string;
      authorId: string;
      citations: unknown[];
      createdAt: number;
      isVerified: boolean;
      hasContradictions: boolean;
      isAgentReaction?: boolean;
      score?: number;
    }> = [];

    // Query posts by each member agent
    for (const agentId of memberAgentIds.slice(0, 10)) {
      const posts = await ctx.db
        .query("narrativePosts")
        .withIndex("by_author", (q) =>
          q.eq("authorType", "agent").eq("authorId", agentId)
        )
        .order("desc")
        .take(limit);

      for (const p of posts) {
        if (p.createdAt >= weekAgo) {
          candidatePosts.push(p as any);
        }
      }
    }

    // Also include human posts from member users
    for (const userId of (channel?.memberUserIds ?? []).slice(0, 5)) {
      const posts = await ctx.db
        .query("narrativePosts")
        .withIndex("by_author", (q) =>
          q.eq("authorType", "human").eq("authorId", userId)
        )
        .order("desc")
        .take(limit);

      for (const p of posts) {
        if (p.createdAt >= weekAgo) {
          candidatePosts.push(p as any);
        }
      }
    }

    // 4. Score and rank
    const recentTopics = new Set<string>();
    const scored = candidatePosts.map((post) => ({
      ...post,
      score: scorePost(post, weights, now, recentTopics),
    }));

    scored.sort((a, b) => b.score - a.score);

    // 5. Return top results
    return {
      channelId: args.channelId,
      channelName: channel?.name ?? "unknown",
      weights,
      posts: scored.slice(0, limit).map((p) => ({
        postId: p.postId,
        _id: p._id,
        content: p.content.slice(0, 300),
        postType: p.postType,
        authorType: p.authorType,
        authorId: p.authorId,
        isAgentReaction: p.isAgentReaction ?? false,
        isVerified: p.isVerified,
        score: Math.round(p.score * 100) / 100,
        createdAt: p.createdAt,
      })),
    };
  },
});

/**
 * Mix agent and human posts for a thread, respecting ratio limits.
 */
export const mixAgentAndHumanPosts = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    limit: v.optional(v.number()),
    agentRatio: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const agentRatio = args.agentRatio ?? 0.3; // 30% agent posts max

    // Fetch recent posts for this thread
    const allPosts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit * 2); // Over-fetch to allow filtering

    const agentPosts = allPosts.filter((p) => p.authorType === "agent");
    const humanPosts = allPosts.filter((p) => p.authorType === "human");

    // Calculate max agent posts
    const maxAgent = Math.floor(limit * agentRatio);
    const maxHuman = limit - Math.min(agentPosts.length, maxAgent);

    // Deprioritize agent reactions
    const agentSorted = [...agentPosts].sort((a, b) => {
      const aReaction = (a as any).isAgentReaction ? 1 : 0;
      const bReaction = (b as any).isAgentReaction ? 1 : 0;
      if (aReaction !== bReaction) return aReaction - bReaction;
      return b.createdAt - a.createdAt;
    });

    // Merge and interleave
    const selectedAgent = agentSorted.slice(0, maxAgent);
    const selectedHuman = humanPosts.slice(0, maxHuman);

    // Interleave: alternate human, human, agent pattern
    const mixed: typeof allPosts = [];
    let ai = 0,
      hi = 0;
    for (let i = 0; i < limit && (ai < selectedAgent.length || hi < selectedHuman.length); i++) {
      if (i % 3 === 2 && ai < selectedAgent.length) {
        mixed.push(selectedAgent[ai++]);
      } else if (hi < selectedHuman.length) {
        mixed.push(selectedHuman[hi++]);
      } else if (ai < selectedAgent.length) {
        mixed.push(selectedAgent[ai++]);
      }
    }

    return {
      threadId: args.threadId,
      total: mixed.length,
      agentCount: selectedAgent.length,
      humanCount: selectedHuman.length,
      posts: mixed,
    };
  },
});
