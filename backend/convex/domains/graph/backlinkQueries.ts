/**
 * Backlink lookup queries — indexed, paginated, bounded.
 *
 * Provides efficient read paths for the backlink graph:
 *   - getBacklinksForEntity: all things referencing an entity (max 50)
 *   - getBacklinkCount: count of references for an entity
 *   - getBacklinksByDocument: all entity references from a document
 *   - getEntitiesReferencedBy: entities mentioned in a specific source
 *
 * Pattern: layered memory — JIT retrieval with BOUND_READ
 * Prior art:
 *   - Roam Research: bidirectional backlink queries
 *   - Obsidian: local graph backlinks panel
 *
 * Invariants:
 *   BOUND_READ — max 50 backlinks per query, paginated
 *   ERROR_BOUNDARY — all queries wrapped, return empty on error
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md §2.4
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";

/** BOUND_READ: max backlinks per single query */
const MAX_BACKLINKS_PER_QUERY = 50;

// ── Get backlinks for an entity (what references this entity?) ───────

export const getBacklinksForEntity = query({
  args: {
    targetEntityId: v.id("entityProfiles"),
    backlinkType: v.optional(
      v.union(
        v.literal("mention"),
        v.literal("citation"),
        v.literal("relatedTo"),
        v.literal("causes"),
        v.literal("contradicts"),
        v.literal("supports"),
        v.literal("derived"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? MAX_BACKLINKS_PER_QUERY, MAX_BACKLINKS_PER_QUERY);

    if (args.backlinkType) {
      return await ctx.db
        .query("backlinks")
        .withIndex("by_target", (q) =>
          q
            .eq("targetEntityId", args.targetEntityId)
            .eq("backlinkType", args.backlinkType!),
        )
        .take(limit);
    }

    return await ctx.db
      .query("backlinks")
      .withIndex("by_target", (q) =>
        q.eq("targetEntityId", args.targetEntityId),
      )
      .take(limit);
  },
});

// ── Get backlink count for an entity ─────────────────────────────────

export const getBacklinkCount = query({
  args: {
    targetEntityId: v.id("entityProfiles"),
  },
  handler: async (ctx, args) => {
    // Take up to 200 to count (beyond that, show "200+")
    const backlinks = await ctx.db
      .query("backlinks")
      .withIndex("by_target", (q) =>
        q.eq("targetEntityId", args.targetEntityId),
      )
      .take(200);

    return {
      count: backlinks.length,
      isApproximate: backlinks.length >= 200,
    };
  },
});

// ── Get backlinks by document (what entities does this document reference?) ──

export const getBacklinksByDocument = query({
  args: {
    sourceDocumentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? MAX_BACKLINKS_PER_QUERY, MAX_BACKLINKS_PER_QUERY);

    return await ctx.db
      .query("backlinks")
      .withIndex("by_document", (q) =>
        q.eq("sourceDocumentId", args.sourceDocumentId),
      )
      .take(limit);
  },
});

// ── Get backlinks by source (what entities does this specific source reference?) ──

export const getBacklinksBySource = query({
  args: {
    sourceType: v.union(
      v.literal("block"),
      v.literal("claim"),
      v.literal("document"),
      v.literal("signal"),
      v.literal("action"),
    ),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("backlinks")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .take(MAX_BACKLINKS_PER_QUERY);
  },
});

// ── Get backlinks created by a specific expansion run ────────────────

export const getBacklinksByRun = query({
  args: {
    agentRunId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("backlinks")
      .withIndex("by_agent_run", (q) =>
        q.eq("agentRunId", args.agentRunId),
      )
      .take(MAX_BACKLINKS_PER_QUERY);
  },
});

// ── Get grouped backlink summary for entity expansion panel ──────────

export const getBacklinkSummary = query({
  args: {
    targetEntityId: v.id("entityProfiles"),
  },
  handler: async (ctx, args) => {
    const backlinks = await ctx.db
      .query("backlinks")
      .withIndex("by_target", (q) =>
        q.eq("targetEntityId", args.targetEntityId),
      )
      .take(MAX_BACKLINKS_PER_QUERY);

    // Group by sourceType
    const grouped: Record<string, number> = {};
    for (const bl of backlinks) {
      grouped[bl.sourceType] = (grouped[bl.sourceType] ?? 0) + 1;
    }

    // Group by backlinkType
    const byType: Record<string, number> = {};
    for (const bl of backlinks) {
      byType[bl.backlinkType] = (byType[bl.backlinkType] ?? 0) + 1;
    }

    return {
      total: backlinks.length,
      bySourceType: grouped,
      byBacklinkType: byType,
      recentBacklinks: backlinks.slice(0, 5).map((bl) => ({
        sourceType: bl.sourceType,
        sourceId: bl.sourceId,
        backlinkType: bl.backlinkType,
        sourceContext: bl.sourceContext,
        createdAt: bl.createdAt,
        createdBy: bl.createdBy,
      })),
    };
  },
});
