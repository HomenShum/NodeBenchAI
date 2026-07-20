/**
 * Pipeline Integration Queries
 *
 * Internal queries that fetch data from existing content pipelines
 * in formats compatible with the narrative adapters.
 *
 * @module domains/narrative/adapters/pipelineQueries
 */

import { v } from "convex/values";
import { internalQuery } from "../../../../_generated/server";
import type { BriefFeature, LinkedInFundingPost, FeedRankedCandidate } from "./types";
import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// DAILY BRIEF FEATURES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent brief features from dailyBriefMemories.
 * Returns data matching the BriefFeature type defined in types.ts.
 */
export const getRecentBriefFeatures = internalQuery({
  args: {
    lookbackDays: v.optional(v.number()),
    minPriority: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      type: v.string(),
      name: v.string(),
      status: v.union(v.literal("pending"), v.literal("failing"), v.literal("passing")),
      priority: v.optional(v.number()),
      testCriteria: v.string(),
      sourceRefs: v.optional(
        v.object({
          urls: v.optional(v.array(v.string())),
          feedItemIds: v.optional(v.array(v.string())),
        })
      ),
      notes: v.optional(v.string()),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args): Promise<BriefFeature[]> => {
    const lookbackMs = (args.lookbackDays ?? 7) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;
    const minPriority = args.minPriority ?? 1;

    // Get recent brief memories
    const memories = await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_generated_at")
      .filter((q) => q.gte(q.field("generatedAt"), cutoffTime))
      .order("desc")
      .take(14); // Up to 2 weeks of briefs

    const features: BriefFeature[] = [];

    for (const memory of memories) {
      for (const feature of memory.features) {
        const priority = feature.priority ?? 5;
        if (priority < minPriority) continue;

        // Extract source URLs from sourceRefs
        let sourceRefs: BriefFeature["sourceRefs"] | undefined;
        if (feature.sourceRefs) {
          const urls: string[] = [];
          const feedItemIds: string[] = [];

          if (Array.isArray(feature.sourceRefs)) {
            for (const ref of feature.sourceRefs) {
              if (typeof ref === "string") {
                urls.push(ref);
              } else if (ref && typeof ref === "object") {
                if ("url" in ref && typeof ref.url === "string") {
                  urls.push(ref.url);
                }
                if ("id" in ref && typeof ref.id === "string") {
                  feedItemIds.push(ref.id);
                }
              }
            }
          }

          if (urls.length > 0 || feedItemIds.length > 0) {
            sourceRefs = {
              urls: urls.length > 0 ? urls : undefined,
              feedItemIds: feedItemIds.length > 0 ? feedItemIds : undefined,
            };
          }
        }

        features.push({
          id: feature.id,
          type: feature.type,
          name: feature.name,
          status: feature.status as "pending" | "failing" | "passing",
          priority,
          testCriteria: feature.testCriteria,
          sourceRefs,
          notes: feature.notes,
          updatedAt: feature.updatedAt,
        });
      }
    }

    return features;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN FUNDING POSTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent LinkedIn funding posts.
 * Returns data matching the LinkedInFundingPost type defined in types.ts.
 */
export const getRecentFundingPosts = internalQuery({
  args: {
    lookbackDays: v.optional(v.number()),
    minAmountUsd: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("linkedinFundingPosts"),
      companyName: v.string(),
      companyNameNormalized: v.string(),
      roundType: v.string(),
      amountRaw: v.string(),
      amountUsd: v.optional(v.number()),
      sector: v.optional(v.string()),
      sectorCategory: v.optional(v.string()),
      postUrl: v.string(),
      postedAt: v.number(),
      progressionType: v.optional(
        v.union(v.literal("new"), v.literal("update"), v.literal("next-round"))
      ),
      fundingEventId: v.optional(v.id("fundingEvents")),
    })
  ),
  handler: async (ctx, args): Promise<LinkedInFundingPost[]> => {
    const lookbackMs = (args.lookbackDays ?? 7) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;
    const minAmountUsd = args.minAmountUsd ?? 0;

    const posts = await ctx.db
      .query("linkedinFundingPosts")
      .withIndex("by_postedAt")
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("desc")
      .take(50);

    const results: LinkedInFundingPost[] = [];

    for (const post of posts) {
      // Filter by minimum amount if specified
      if (minAmountUsd > 0 && post.amountUsd && post.amountUsd < minAmountUsd) {
        continue;
      }

      results.push({
        _id: post._id,
        companyName: post.companyName,
        companyNameNormalized: post.companyNameNormalized,
        roundType: post.roundType,
        amountRaw: post.amountRaw,
        amountUsd: post.amountUsd,
        sector: post.sector,
        sectorCategory: post.sectorCategory,
        postUrl: post.postUrl,
        postedAt: post.postedAt,
        progressionType: post.progressionType as "new" | "update" | "next-round" | undefined,
        fundingEventId: post.fundingEventId,
      });
    }

    return results;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FORYOUFEED CANDIDATES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent ForYouFeed candidates with high phoenix scores.
 * Returns data matching the FeedRankedCandidate type defined in types.ts.
 */
export const getRecentFeedCandidates = internalQuery({
  args: {
    lookbackDays: v.optional(v.number()),
    minPhoenixScore: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      itemId: v.string(),
      itemType: v.union(
        v.literal("document"),
        v.literal("agent"),
        v.literal("repository"),
        v.literal("update"),
        v.literal("feed_item")
      ),
      source: v.union(
        v.literal("in_network"),
        v.literal("out_of_network"),
        v.literal("trending")
      ),
      title: v.string(),
      snippet: v.string(),
      metadata: v.any(),
      timestamp: v.number(),
      dateString: v.optional(v.string()),
      phoenixScore: v.number(),
      relevanceReason: v.string(),
      engagementPrediction: v.optional(
        v.object({
          view: v.number(),
          click: v.number(),
          save: v.number(),
          share: v.number(),
        })
      ),
    })
  ),
  handler: async (ctx, args): Promise<FeedRankedCandidate[]> => {
    const lookbackMs = (args.lookbackDays ?? 7) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;
    const minScore = args.minPhoenixScore ?? 60;

    // Query researchItems as the source of feed candidates
    const items = await ctx.db
      .query("researchItems")
      .withIndex("by_created_at")
      .filter((q) => q.gte(q.field("createdAt"), cutoffTime))
      .order("desc")
      .take(100);

    const candidates: FeedRankedCandidate[] = [];

    for (const item of items) {
      // Use metadata phoenixScore if available, otherwise estimate
      const phoenixScore = (item.metadata as Record<string, unknown>)?.phoenixScore as number ?? 50;
      if (phoenixScore < minScore) continue;

      // Map item type to feed candidate type
      let itemType: FeedRankedCandidate["itemType"] = "document";
      if (item.contentType === "repository") {
        itemType = "repository";
      } else if (item.contentType === "feed") {
        itemType = "feed_item";
      }

      candidates.push({
        itemId: item._id,
        itemType,
        source: "out_of_network", // Research items are typically out-of-network
        title: item.title || "",
        snippet: item.snippet || item.summary || "",
        metadata: item.metadata as Record<string, unknown> || {},
        timestamp: item.createdAt,
        dateString: new Date(item.createdAt).toISOString().split("T")[0],
        phoenixScore,
        relevanceReason: "High-scoring research item",
      });
    }

    return candidates;
  },
});
