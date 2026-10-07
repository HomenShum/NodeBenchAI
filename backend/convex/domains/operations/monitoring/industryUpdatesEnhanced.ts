/**
 * Industry Updates Enhanced - X Search & Real-time Integration
 * Phase 5 Implementation
 *
 * Features:
 * - Real-time X/Twitter search for trending topics
 * - Web search for breaking news
 * - Automated PR suggestions
 * - Discord/Slack notifications
 */

import { v } from "convex/values";
import { internalAction, internalMutation, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// X SEARCH INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search X/Twitter for trending AI topics
 */
export const searchXForTrends = internalAction({
  args: {
    keywords: v.array(v.string()),
  },
  handler: async (ctx, { keywords }) => {
    const xaiKey = process.env.XAI_API_KEY;
    if (!xaiKey) {
      console.warn("[industryUpdatesEnhanced] XAI_API_KEY not set, skipping X search");
      return [];
    }

    const results: Array<{ keyword: string; summary: string; timestamp: number }> = [];

    for (const keyword of keywords) {
      try {
        // Use Grok with X search tool
        const response = await ctx.runAction(internal.lib.xaiClient.callGrokWithXSearch, {
          model: "grok-3-mini",
          query: `Find trending discussions about ${keyword} on X. What are developers saying?`,
          maxTokens: 500,
        });

        results.push({
          keyword,
          summary: response.content,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error(`[industryUpdatesEnhanced] X search failed for ${keyword}:`, error);
      }
    }

    return results;
  },
});

/**
 * Search web for breaking AI news
 */
export const searchWebForBreakingNews = internalAction({
  args: {
    topics: v.array(v.string()),
  },
  handler: async (ctx, { topics }) => {
    const xaiKey = process.env.XAI_API_KEY;
    if (!xaiKey) {
      console.warn("[industryUpdatesEnhanced] XAI_API_KEY not set, skipping web search");
      return [];
    }

    const results: Array<{ topic: string; summary: string; timestamp: number }> = [];

    for (const topic of topics) {
      try {
        // Use Grok with web search tool
        const response = await ctx.runAction(internal.lib.xaiClient.callGrokWithWebSearch, {
          model: "grok-4-1-fast-reasoning",
          query: `What are the latest developments in ${topic} today? Find recent announcements and releases.`,
          maxTokens: 800,
        });

        results.push({
          topic,
          summary: response.content,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error(`[industryUpdatesEnhanced] Web search failed for ${topic}:`, error);
      }
    }

    return results;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATED PR SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate automated PR suggestions based on industry updates
 */
export const generatePRSuggestions = internalAction({
  args: {
    updateId: v.id("industryUpdates"),
  },
  handler: async (ctx, { updateId }) => {
    const update = await ctx.runQuery(internal.domains.monitoring.industryUpdates.getUpdateById, {
      id: updateId,
    });

    if (!update || update.relevance < 85) {
      return null; // Only generate PRs for high-priority updates
    }

    // Use free Grok model for PR generation
    const prompt = `Based on this industry update, generate a pull request suggestion:

Update: ${update.title}
Summary: ${update.summary}
Implementation Suggestions: ${update.implementationSuggestions.join("; ")}

Generate a concise PR plan:
1. Title (short, action-oriented)
2. Description (2-3 sentences)
3. Key changes (3-5 bullet points)
4. Testing checklist (3-4 items)

Format as JSON:
{
  "title": "...",
  "description": "...",
  "changes": ["...", "..."],
  "testing": ["...", "..."]
}`;

    try {
      const response = await ctx.runAction(
        internal.domains.models.autonomousModelResolver.executeWithFallback,
        {
          taskType: "synthesis",
          messages: [
            { role: "system", content: "You are a PR automation assistant." },
            { role: "user", content: prompt },
          ],
          maxTokens: 600,
          temperature: 0.4,
        }
      );

      const prSuggestion = JSON.parse(response.content);

      // Save PR suggestion
      await ctx.runMutation(internal.domains.monitoring.industryUpdatesEnhanced.savePRSuggestion, {
        updateId,
        title: prSuggestion.title,
        description: prSuggestion.description,
        changes: prSuggestion.changes,
        testing: prSuggestion.testing,
      });

      return prSuggestion;
    } catch (error) {
      console.error("[industryUpdatesEnhanced] PR generation failed:", error);
      return null;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED SCANNING WITH X/WEB SEARCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enhanced industry scan with X and web search
 */
export const enhancedIndustryScan = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[industryUpdatesEnhanced] Starting enhanced scan");

    // Define trending topics to track
    const trendingTopics = [
      "LLM prompt caching",
      "Anthropic Claude",
      "OpenAI GPT",
      "Gemini AI",
      "xAI Grok",
      "agent frameworks",
      "RAG improvements",
      "batch API",
    ];

    // Search X for trending discussions (async parallel)
    const xResults = await ctx.runAction(
      internal.domains.monitoring.industryUpdatesEnhanced.searchXForTrends,
      { keywords: trendingTopics.slice(0, 3) } // Limit to 3 to avoid rate limits
    );

    // Search web for breaking news
    const webResults = await ctx.runAction(
      internal.domains.monitoring.industryUpdatesEnhanced.searchWebForBreakingNews,
      { topics: trendingTopics.slice(0, 3) }
    );

    // NOTE: Skipping standard industry scan for now - can be enabled once that module is fixed
    // await ctx.runAction(internal.domains.monitoring.industryUpdates.scanIndustryUpdates, {});

    console.log(
      `[industryUpdatesEnhanced] Found ${xResults.length} X trends and ${webResults.length} web news`
    );

    // NOTE: Skipping PR generation for now - can be enabled once industry scan is fixed
    // Get high-priority updates for PR suggestions
    // const highPriorityUpdates = await ctx.runQuery(
    //   internal.domains.monitoring.industryUpdates.getHighPriorityUpdates,
    //   {}
    // );

    // Generate PR suggestions for top 3 updates
    // for (const update of highPriorityUpdates.slice(0, 3)) {
    //   await ctx.runAction(
    //     internal.domains.monitoring.industryUpdatesEnhanced.generatePRSuggestions,
    //     { updateId: update._id }
    //   );
    // }

    return {
      xTrends: xResults.length,
      webNews: webResults.length,
      prSuggestions: 0, // Disabled for now
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save PR suggestion
 */
export const savePRSuggestion = internalMutation({
  args: {
    updateId: v.id("industryUpdates"),
    title: v.string(),
    description: v.string(),
    changes: v.array(v.string()),
    testing: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("prSuggestions", {
      updateId: args.updateId,
      title: args.title,
      description: args.description,
      changes: args.changes,
      testing: args.testing,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get PR suggestions (public query)
 */
export const getPRSuggestions = query({
  args: {
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("implemented"),
      v.literal("rejected")
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, limit = 20 }) => {
    let query = ctx.db
      .query("prSuggestions")
      .order("desc");

    if (status) {
      query = query.filter((q) => q.eq(q.field("status"), status)) as any;
    }

    return await query.take(limit);
  },
});
