/**
 * Convex-native search session API.
 *
 * This file stays runtime-agnostic so it can expose mutations and queries.
 * The long-running harness execution lives in `searchPipelineNode.ts`.
 */

import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

export const startSearch = mutation({
  args: {
    query: v.string(),
    lens: v.string(),
  },
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert("searchSessions", {
      query: args.query,
      lens: args.lens,
      status: "pending",
      trace: [],
      startedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.domains.search.searchPipelineNode.executeSearch, {
      sessionId,
      query: args.query,
      lens: args.lens,
    });

    return sessionId;
  },
});

/**
 * Start a deep diligence search — 6 parallel branch chains, banker-grade depth.
 */
export const startDeepSearch = mutation({
  args: {
    query: v.string(),
    lens: v.string(),
  },
  handler: async (ctx, args) => {
    // ── Public entity cache: check for fresh cached result first ──
    const cacheKey = `${args.query.toLowerCase().trim()}::${args.lens}`;
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    const cached = await ctx.db
      .query("searchSessions")
      .withIndex("by_status", (q) => q.eq("status", "complete"))
      .order("desc")
      .filter((q) =>
        q.and(
          q.eq(q.field("query"), args.query.trim()),
          q.eq(q.field("lens"), args.lens),
          q.gt(q.field("completedAt"), Date.now() - CACHE_TTL_MS),
        ),
      )
      .first();

    if (cached) {
      // Return the cached session — no new search needed
      return cached._id;
    }

    const sessionId = await ctx.db.insert("searchSessions", {
      query: args.query,
      lens: args.lens,
      status: "pending",
      trace: [],
      startedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.domains.search.deepDiligence.executeDeepDiligence, {
      sessionId,
      query: args.query,
      lens: args.lens,
    });

    return sessionId;
  },
});

export const getSearchSession = query({
  args: { sessionId: v.id("searchSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const listRecentSearches = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 10, 25);
    return await ctx.db.query("searchSessions").order("desc").take(take);
  },
});

export const updateSearchStatus = internalMutation({
  args: {
    sessionId: v.id("searchSessions"),
    status: v.string(),
    trace: v.optional(v.array(v.object({
      step: v.string(),
      tool: v.optional(v.string()),
      status: v.string(),
      detail: v.optional(v.string()),
      durationMs: v.optional(v.number()),
      startedAt: v.number(),
    }))),
    classification: v.optional(v.object({
      type: v.string(),
      entity: v.optional(v.string()),
      entities: v.optional(v.array(v.string())),
      lens: v.string(),
    })),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    const patch: Record<string, unknown> = {
      status: args.status,
    };
    if (args.trace) patch.trace = args.trace;
    if (args.classification) patch.classification = args.classification;
    if (args.result !== undefined) patch.result = args.result;
    if (args.error !== undefined) patch.error = args.error;
    if (args.completedAt !== undefined) patch.completedAt = args.completedAt;

    await ctx.db.patch(args.sessionId, patch);
  },
});

// ── Shared span validator ────────────────────────────────────────────────

const spanValidator = v.object({
  stage: v.union(v.literal("before"), v.literal("during"), v.literal("after")),
  type: v.string(),
  status: v.union(v.literal("ok"), v.literal("running"), v.literal("error")),
  label: v.string(),
  detail: v.optional(v.string()),
  timestamp: v.string(),
  metrics: v.optional(v.any()),
});

// ── Founder Episode Mutations ────────────────────────────────────────────

export const createFounderEpisode = internalMutation({
  args: {
    episodeType: v.string(),
    query: v.optional(v.string()),
    lens: v.optional(v.string()),
    searchSessionId: v.optional(v.id("searchSessions")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const episodeId = await ctx.db.insert("founderEpisodes", {
      episodeType: args.episodeType,
      status: "active",
      query: args.query,
      lens: args.lens,
      searchSessionId: args.searchSessionId,
      spans: [{
        stage: "before" as const,
        type: "search_submitted",
        status: "ok" as const,
        label: "Founder query captured",
        detail: args.query,
        timestamp: new Date(now).toISOString(),
      }],
      toolsInvoked: [],
      artifactsProduced: [],
      startedAt: now,
    });

    if (args.searchSessionId) {
      await ctx.db.patch(args.searchSessionId, { episodeId });
    }

    return episodeId;
  },
});

export const appendEpisodeSpan = internalMutation({
  args: {
    episodeId: v.id("founderEpisodes"),
    span: spanValidator,
    toolsInvoked: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId);
    if (!episode) return;

    const spans = [...episode.spans, args.span];
    const tools = args.toolsInvoked
      ? [...new Set([...episode.toolsInvoked, ...args.toolsInvoked])]
      : episode.toolsInvoked;

    await ctx.db.patch(args.episodeId, {
      spans,
      toolsInvoked: tools,
      traceStepCount: spans.filter(s => s.stage === "during").length,
    });
  },
});

export const finalizeEpisode = internalMutation({
  args: {
    episodeId: v.id("founderEpisodes"),
    status: v.union(v.literal("completed"), v.literal("error"), v.literal("aborted")),
    entityName: v.optional(v.string()),
    packetType: v.optional(v.string()),
    summary: v.optional(v.string()),
    artifactsProduced: v.optional(v.array(v.string())),
    finalSpan: spanValidator,
  },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId);
    if (!episode) return;

    await ctx.db.patch(args.episodeId, {
      status: args.status,
      entityName: args.entityName,
      packetType: args.packetType,
      summary: args.summary,
      artifactsProduced: args.artifactsProduced
        ? [...new Set([...episode.artifactsProduced, ...args.artifactsProduced])]
        : episode.artifactsProduced,
      spans: [...episode.spans, args.finalSpan],
      completedAt: Date.now(),
    });
  },
});

// ── Founder Episode Queries ──────────────────────────────────────────────

export const getFounderEpisode = query({
  args: { episodeId: v.id("founderEpisodes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.episodeId);
  },
});

export const listRecentEpisodes = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("founderEpisodes")
      .order("desc")
      .take(Math.min(args.limit ?? 10, 25));
  },
});
