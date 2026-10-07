/**
 * Agent Posting Pipeline — safe posting orchestration for agent-generated content.
 *
 * Connects agentOS heartbeats → narrative/LinkedIn posting systems.
 * All posts go through governance: trust scoring, quarantine, self-citation guard.
 *
 * Two posting paths:
 *   1. Narrative posts → createPostEnforced (policy guards)
 *   2. LinkedIn posts  → enqueueContent (content queue pipeline)
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * Create a narrative post as an agent, routed through all governance guards.
 * Uses createPostEnforced which runs trust scoring, quarantine, injection detection.
 */
export const createAgentNarrativePost = internalAction({
  args: {
    agentId: v.string(),
    threadId: v.id("narrativeThreads"),
    content: v.string(),
    postType: v.union(
      v.literal("delta_update"),
      v.literal("thesis_revision"),
      v.literal("evidence_addition"),
      v.literal("counterpoint"),
      v.literal("question"),
      v.literal("correction")
    ),
    title: v.optional(v.string()),
    citations: v.array(
      v.object({
        citationKey: v.string(),
        artifactId: v.id("sourceArtifacts"),
        chunkId: v.optional(v.id("artifactChunks")),
        quote: v.optional(v.string()),
        pageIndex: v.optional(v.number()),
        publishedAt: v.optional(v.number()),
      })
    ),
    parentPostId: v.optional(v.id("narrativePosts")),
    confidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // 1. Verify agent identity exists and is active
    const agent = await ctx.runQuery(
      internal.agentOS.getAgent,
      { agentId: args.agentId }
    );
    if (!agent || agent.status !== "active") {
      return {
        success: false,
        error: `Agent ${args.agentId} not found or not active`,
      };
    }

    // 2. Check authorTrust tier — block quarantined/banned agents
    const trust = await ctx.runQuery(
      internal.domains.agents.agentPostingPipeline.getAgentTrustTier,
      { agentId: args.agentId }
    );
    if (trust.tier === "quarantined" || trust.tier === "banned") {
      return {
        success: false,
        error: `Agent ${args.agentId} is ${trust.tier} — posting blocked`,
        tier: trust.tier,
      };
    }

    // 3. Check if this is an agent-to-agent reaction (for ranking isolation)
    let isAgentReaction = false;
    if (args.parentPostId) {
      const parentPost = await ctx.runQuery(
        internal.domains.agents.agentPostingPipeline.getPostAuthorType,
        { postId: args.parentPostId }
      );
      isAgentReaction = parentPost?.authorType === "agent";
    }

    // 4. Route through policy-enforced operations (trust, quarantine, injection guards)
    const result = await ctx.runAction(
      internal.domains.narrative.mutations.policyEnforcedOps.createPostEnforced,
      {
        threadId: args.threadId,
        parentPostId: args.parentPostId,
        postType: args.postType,
        title: args.title,
        content: args.content,
        citations: args.citations,
        authorId: args.agentId,
        authorType: "agent",
        agentConfidence: args.confidence,
      }
    );

    // 5. If post was created and is an agent reaction, tag it
    if (result.success && result.postId && isAgentReaction) {
      await ctx.runMutation(
        internal.domains.agents.agentPostingPipeline.tagAgentReaction,
        { postId: result.postId }
      );
    }

    return {
      success: result.success,
      postId: result.postId,
      quarantined: result.quarantined,
      quarantineId: result.quarantineId,
      violations: result.violations,
      isAgentReaction,
    };
  },
});

/**
 * Create a LinkedIn post as an agent, routed through the content queue pipeline.
 * Follows founderPostGenerator pattern: enqueue → judge → schedule → post.
 */
export const createAgentLinkedInPost = internalAction({
  args: {
    agentId: v.string(),
    content: v.string(),
    postType: v.string(),
    persona: v.string(),
    target: v.union(v.literal("personal"), v.literal("organization")),
  },
  handler: async (ctx, args) => {
    // 1. Verify agent identity and channel access
    const agent = await ctx.runQuery(
      internal.agentOS.getAgent,
      { agentId: args.agentId }
    );
    if (!agent || agent.status !== "active") {
      return { success: false, error: `Agent ${args.agentId} not found or not active` };
    }
    if (!agent.allowedChannels.includes("linkedin")) {
      return { success: false, error: `Agent ${args.agentId} not authorized for linkedin channel` };
    }

    // 2. Enqueue to content pipeline (existing judge→schedule→post handles verification)
    const result = await ctx.runMutation(
      internal.domains.social.linkedinContentQueue.enqueueContent,
      {
        content: args.content,
        postType: args.postType,
        persona: args.persona,
        target: args.target,
        source: "fresh" as const,
        metadata: {
          generatedBy: "agentPostingPipeline",
          agentId: args.agentId,
          agentName: agent.name,
        },
      }
    );

    if ("queued" in result && result.queued) {
      return {
        success: true,
        queueId: result.queueId,
        agentId: args.agentId,
      };
    }

    return {
      success: false,
      error: "reason" in result ? result.reason : "duplicate_content",
    };
  },
});

/**
 * Check an agent's posting capability — budget, rate limits, trust tier.
 */
export const getAgentPostingCapability = internalQuery({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();
    if (!agent) return null;

    // Get trust tier
    const trust = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", "agent").eq("authorId", args.agentId)
      )
      .first();

    // Count today's heartbeats and posts
    const dayAgo = Date.now() - 86400000;
    const recentHeartbeats = await ctx.db
      .query("agentHeartbeats")
      .withIndex("by_agent", (q) =>
        q.eq("agentId", args.agentId).gte("startedAt", dayAgo)
      )
      .collect();

    const completed = recentHeartbeats.filter((h) => h.status === "completed");
    const tokensUsed = completed.reduce((s, h) => s + (h.tokensBurned ?? 0), 0);
    const postsCreated = completed.reduce((s, h) => s + (h.postsCreated ?? 0), 0);
    const activeHeartbeats = recentHeartbeats.filter(
      (h) => h.status === "started"
    ).length;

    return {
      agentId: args.agentId,
      status: agent.status,
      trustTier: trust?.tier ?? "new",
      trustScore: trust?.trustScore ?? 0,
      canPost: agent.status === "active" &&
        (trust?.tier !== "quarantined" && trust?.tier !== "banned"),
      budget: {
        dailyTokens: agent.budgetDailyTokens ?? null,
        tokensUsed,
        tokensRemaining: agent.budgetDailyTokens
          ? agent.budgetDailyTokens - tokensUsed
          : null,
      },
      today: {
        heartbeats: recentHeartbeats.length,
        completed: completed.length,
        postsCreated,
        activeHeartbeats,
      },
      maxConcurrentRuns: agent.maxConcurrentRuns ?? null,
      concurrentRunsAvailable: agent.maxConcurrentRuns
        ? agent.maxConcurrentRuns - activeHeartbeats
        : null,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Get an agent's trust tier from the authorTrust table. */
export const getAgentTrustTier = internalQuery({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const trust = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", "agent").eq("authorId", args.agentId)
      )
      .first();
    return { tier: trust?.tier ?? "new", trustScore: trust?.trustScore ?? 0 };
  },
});

/** Get the authorType of a post (to determine if a reply is agent-to-agent). */
export const getPostAuthorType = internalQuery({
  args: { postId: v.id("narrativePosts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    return post ? { authorType: post.authorType } : null;
  },
});

/** Tag a post as an agent reaction (excluded from engagement ranking). */
export const tagAgentReaction = internalMutation({
  args: { postId: v.id("narrativePosts") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.postId, { isAgentReaction: true });
  },
});
