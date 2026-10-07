/**
 * agentFeedTraversal.ts
 *
 * Unified feed traversal API for AI agents (Moltbook pattern).
 *
 * Provides a single query that delegates to existing optimized tables —
 * no new DB scans. Agents traverse research, signals, funding, agents,
 * activity, and documents via consistent sort/filter/paginate interface.
 *
 * Sort modes:
 *   hot    — engagement-weighted recency (score × recency decay)
 *   new    — chronological (newest first)
 *   top    — highest score / phoenix score
 *   rising — fastest growing (recent + high engagement)
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";

// ---------------------------------------------------------------------------
// Normalized feed item — common shape across all feed types
// ---------------------------------------------------------------------------

const feedItemValidator = v.object({
  id: v.string(),
  title: v.string(),
  snippet: v.optional(v.string()),
  timestamp: v.number(),
  source: v.string(),
  score: v.optional(v.number()),
  url: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  feedType: v.string(),
  metadata: v.optional(v.any()),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Recency decay: items lose 10% score per day of age. */
function hotScore(baseScore: number, timestampMs: number): number {
  const ageHours = (Date.now() - timestampMs) / (1000 * 60 * 60);
  const decay = Math.exp(-0.1 * (ageHours / 24));
  return baseScore * decay;
}

type NormalizedItem = {
  id: string;
  title: string;
  snippet?: string;
  timestamp: number;
  source: string;
  score?: number;
  url?: string;
  tags?: string[];
  feedType: string;
  metadata?: any;
};

function sortItems(
  items: NormalizedItem[],
  sort: "hot" | "new" | "top" | "rising",
): NormalizedItem[] {
  switch (sort) {
    case "new":
      return items.sort((a, b) => b.timestamp - a.timestamp);
    case "top":
      return items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    case "rising":
      // Recent items (last 48h) sorted by score
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      return items
        .filter((i) => i.timestamp > cutoff)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    case "hot":
    default:
      return items.sort(
        (a, b) => hotScore(b.score ?? 1, b.timestamp) - hotScore(a.score ?? 1, a.timestamp),
      );
  }
}

// ---------------------------------------------------------------------------
// Main query
// ---------------------------------------------------------------------------

export const traverseFeed = query({
  args: {
    feedType: v.union(
      v.literal("research"),
      v.literal("signals"),
      v.literal("documents"),
      v.literal("agents"),
      v.literal("funding"),
      v.literal("activity"),
    ),
    sort: v.optional(
      v.union(
        v.literal("hot"),
        v.literal("new"),
        v.literal("top"),
        v.literal("rising"),
      ),
    ),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    filter: v.optional(
      v.object({
        tags: v.optional(v.array(v.string())),
        category: v.optional(v.string()),
        minScore: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({
    items: v.array(feedItemValidator),
    total: v.number(),
    hasMore: v.boolean(),
    feedType: v.string(),
    sort: v.string(),
  }),
  handler: async (ctx, args) => {
    const limit = clamp(args.limit ?? 10, 1, 50);
    const offset = clamp(args.offset ?? 0, 0, 10000);
    const sort = args.sort ?? "hot";

    let items: NormalizedItem[] = [];

    switch (args.feedType) {
      // -------------------------------------------------------------------
      // Research — feedItems table (central newsstand)
      // -------------------------------------------------------------------
      case "research": {
        const raw = await ctx.db
          .query("feedItems")
          .withIndex("by_score")
          .order("desc")
          .take(200);

        items = raw.map((r) => ({
          id: r._id,
          title: r.title,
          snippet: r.summary,
          timestamp: r.createdAt ?? r._creationTime,
          source: r.source,
          score: r.score,
          url: r.url,
          tags: r.tags,
          feedType: "research",
          metadata: {
            type: r.type,
            category: r.category,
            metrics: r.metrics,
          },
        }));
        break;
      }

      // -------------------------------------------------------------------
      // Signals — landingPageLog table
      // -------------------------------------------------------------------
      case "signals": {
        const raw = await ctx.db
          .query("landingPageLog")
          .order("desc")
          .take(200);

        items = raw.map((r) => ({
          id: r._id,
          title: r.title,
          snippet: r.markdown.slice(0, 200),
          timestamp: r._creationTime,
          source: `signal:${r.kind}`,
          score: r.kind === "signal" ? 10 : r.kind === "funding" ? 8 : 5,
          tags: [r.kind, r.day],
          feedType: "signals",
          metadata: { kind: r.kind, day: r.day },
        }));
        break;
      }

      // -------------------------------------------------------------------
      // Funding — dealFlowCache (most recent snapshot)
      // -------------------------------------------------------------------
      case "funding": {
        const snapshot = await ctx.db
          .query("dealFlowCache")
          .withIndex("by_fetched_at")
          .order("desc")
          .first();

        if (snapshot) {
          items = snapshot.deals.map((d) => ({
            id: d.id,
            title: `${d.company} — ${d.stage} ${d.amount}`,
            snippet: d.summary,
            timestamp: new Date(d.date).getTime() || snapshot.fetchedAt,
            source: "funding",
            score: d.sentiment === "hot" ? 10 : d.sentiment === "watch" ? 7 : 5,
            tags: [d.sector, d.stage, d.location],
            feedType: "funding",
            metadata: {
              company: d.company,
              sector: d.sector,
              stage: d.stage,
              amount: d.amount,
              leads: d.leads,
            },
          }));
        }
        break;
      }

      // -------------------------------------------------------------------
      // Agents — agentRankings table
      // -------------------------------------------------------------------
      case "agents": {
        const raw = await ctx.db
          .query("agentRankings")
          .order("desc")
          .take(100);

        items = raw.map((r) => ({
          id: r._id,
          title: `${r.agentType} — ${r.agentId}`,
          snippet: `Score: ${r.phoenixScore.toFixed(1)}, Usage: ${r.usageCount}, Success: ${(r.successRate * 100).toFixed(0)}%`,
          timestamp: r.lastRankedAt,
          source: "agent-marketplace",
          score: r.phoenixScore,
          tags: [r.agentType],
          feedType: "agents",
          metadata: {
            agentType: r.agentType,
            agentId: r.agentId,
            usageCount: r.usageCount,
            successRate: r.successRate,
            avgLatencyMs: r.avgLatencyMs,
          },
        }));
        break;
      }

      // -------------------------------------------------------------------
      // Activity — feedItems filtered to recent + landingPageLog recent
      // -------------------------------------------------------------------
      case "activity": {
        // Combine recent feed items + recent signals for an activity view
        const recentFeed = await ctx.db
          .query("feedItems")
          .order("desc")
          .take(100);

        const recentSignals = await ctx.db
          .query("landingPageLog")
          .order("desc")
          .take(50);

        const feedNorm: NormalizedItem[] = recentFeed.map((r) => ({
          id: r._id,
          title: r.title,
          snippet: r.summary,
          timestamp: r.createdAt ?? r._creationTime,
          source: r.source,
          score: r.score,
          url: r.url,
          tags: r.tags,
          feedType: "activity",
        }));

        const signalNorm: NormalizedItem[] = recentSignals.map((r) => ({
          id: r._id,
          title: r.title,
          snippet: r.markdown.slice(0, 200),
          timestamp: r._creationTime,
          source: `signal:${r.kind}`,
          score: 5,
          tags: [r.kind],
          feedType: "activity",
        }));

        items = [...feedNorm, ...signalNorm];
        break;
      }

      // -------------------------------------------------------------------
      // Documents — requires auth
      // -------------------------------------------------------------------
      case "documents": {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
          return {
            items: [],
            total: 0,
            hasMore: false,
            feedType: "documents",
            sort,
          };
        }

        const raw = await ctx.db
          .query("documents")
          .order("desc")
          .take(200);

        items = raw
          .filter((d) => !d.isArchived)
          .map((d) => ({
            id: d._id,
            title: d.title || "Untitled",
            snippet: d.summary ?? d.content?.slice(0, 200),
            timestamp: d._creationTime,
            source: "documents",
            score: d.isFavorite ? 10 : 5,
            tags: [d.documentType ?? "document"],
            feedType: "documents",
            metadata: {
              documentType: d.documentType,
              isFavorite: d.isFavorite,
              isPublic: d.isPublic,
            },
          }));
        break;
      }
    }

    // Apply filters
    if (args.filter) {
      const f = args.filter;
      if (f.tags && f.tags.length > 0) {
        const tagSet = new Set(f.tags.map((t) => t.toLowerCase()));
        items = items.filter((i) =>
          i.tags?.some((t) => tagSet.has(t.toLowerCase())),
        );
      }
      if (f.category) {
        const cat = f.category.toLowerCase();
        items = items.filter(
          (i) =>
            i.tags?.some((t) => t.toLowerCase() === cat) ||
            (i.metadata?.category ?? "").toLowerCase() === cat,
        );
      }
      if (f.minScore !== undefined) {
        items = items.filter((i) => (i.score ?? 0) >= f.minScore!);
      }
    }

    // Sort
    items = sortItems(items, sort);

    // Paginate
    const total = items.length;
    const paged = items.slice(offset, offset + limit);

    return {
      items: paged,
      total,
      hasMore: offset + limit < total,
      feedType: args.feedType,
      sort,
    };
  },
});
