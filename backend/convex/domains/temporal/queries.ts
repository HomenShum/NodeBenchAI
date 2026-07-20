/**
 * Temporal Domain Queries
 * Read operations for all 5 temporal tables with filtering + aggregation
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";

/* ================================================================== */
/* TIME SERIES OBSERVATIONS                                            */
/* ================================================================== */

export const getObservationsByStream = query({
  args: {
    streamKey: v.string(),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { streamKey, startAt, endAt, limit }) => {
    let q = ctx.db
      .query("timeSeriesObservations")
      .withIndex("by_stream_time", (q) => {
        let chain = q.eq("streamKey", streamKey);
        if (startAt !== undefined) chain = chain.gte("observedAt", startAt);
        if (endAt !== undefined) chain = chain.lte("observedAt", endAt);
        return chain;
      })
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getObservationsByEntity = query({
  args: {
    entityKey: v.string(),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityKey, startAt, endAt, limit }) => {
    let q = ctx.db
      .query("timeSeriesObservations")
      .withIndex("by_entity_time", (q) => {
        let chain = q.eq("entityKey", entityKey);
        if (startAt !== undefined) chain = chain.gte("observedAt", startAt);
        if (endAt !== undefined) chain = chain.lte("observedAt", endAt);
        return chain;
      })
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getObservationsBySourceType = query({
  args: {
    sourceType: v.union(
      v.literal("slack"),
      v.literal("github"),
      v.literal("jira"),
      v.literal("web"),
      v.literal("document"),
      v.literal("manual"),
      v.literal("system"),
    ),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { sourceType, startAt, endAt, limit }) => {
    let q = ctx.db
      .query("timeSeriesObservations")
      .withIndex("by_source_type_time", (q) => {
        let chain = q.eq("sourceType", sourceType);
        if (startAt !== undefined) chain = chain.gte("observedAt", startAt);
        if (endAt !== undefined) chain = chain.lte("observedAt", endAt);
        return chain;
      })
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getNumericTimeSeries = query({
  args: {
    streamKey: v.string(),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
  },
  handler: async (ctx, { streamKey, startAt, endAt }) => {
    const obs = await ctx.db
      .query("timeSeriesObservations")
      .withIndex("by_stream_time", (q) => {
        let chain = q.eq("streamKey", streamKey);
        if (startAt !== undefined) chain = chain.gte("observedAt", startAt);
        if (endAt !== undefined) chain = chain.lte("observedAt", endAt);
        return chain;
      })
      .order("asc")
      .collect();

    // Filter to numeric observations only and return as [timestamp, value] pairs
    return obs
      .filter((o) => o.observationType === "numeric" && o.valueNumber !== undefined)
      .map((o) => ({
        t: o.observedAt,
        v: o.valueNumber!,
        units: o.units,
        headline: o.headline,
      }));
  },
});

/* ================================================================== */
/* TIME SERIES SIGNALS                                                 */
/* ================================================================== */

export const getSignalsByEntity = query({
  args: {
    entityKey: v.string(),
    status: v.optional(v.union(
      v.literal("open"),
      v.literal("watch"),
      v.literal("resolved"),
      v.literal("dismissed"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityKey, status, limit }) => {
    if (status) {
      let q = ctx.db
        .query("timeSeriesSignals")
        .withIndex("by_status_detected", (q) => q.eq("status", status))
        .order("desc");
      const all = limit ? await q.take(limit * 3) : await q.collect();
      return all.filter((s) => s.entityKey === entityKey).slice(0, limit ?? Infinity);
    }
    let q = ctx.db
      .query("timeSeriesSignals")
      .withIndex("by_entity_detected", (q) => q.eq("entityKey", entityKey))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getSignalsByStream = query({
  args: {
    streamKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { streamKey, limit }) => {
    let q = ctx.db
      .query("timeSeriesSignals")
      .withIndex("by_stream_detected", (q) => q.eq("streamKey", streamKey))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getOpenSignals = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    let q = ctx.db
      .query("timeSeriesSignals")
      .withIndex("by_status_detected", (q) => q.eq("status", "open"))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getSignalByKey = query({
  args: { signalKey: v.string() },
  handler: async (ctx, { signalKey }) => {
    return await ctx.db
      .query("timeSeriesSignals")
      .withIndex("by_signal_key", (q) => q.eq("signalKey", signalKey))
      .first();
  },
});

/* ================================================================== */
/* CAUSAL CHAINS                                                       */
/* ================================================================== */

export const getCausalChainByKey = query({
  args: { chainKey: v.string() },
  handler: async (ctx, { chainKey }) => {
    return await ctx.db
      .query("causalChains")
      .withIndex("by_chain_key", (q) => q.eq("chainKey", chainKey))
      .first();
  },
});

export const getCausalChainsByEntity = query({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityKey, limit }) => {
    let q = ctx.db
      .query("causalChains")
      .withIndex("by_entity_created", (q) => q.eq("entityKey", entityKey))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getRecentCausalChains = query({
  args: {
    status: v.optional(v.union(
      v.literal("draft"),
      v.literal("validated"),
      v.literal("contested"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, limit }) => {
    if (status) {
      let q = ctx.db
        .query("causalChains")
        .withIndex("by_status_created", (q) => q.eq("status", status))
        .order("desc");
      const r = limit ? await q.take(limit) : await q.collect();
      return r;
    }
    let q = ctx.db.query("causalChains").order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

/* ================================================================== */
/* ZERO-DRAFT ARTIFACTS                                                */
/* ================================================================== */

export const getZeroDraftsByStatus = query({
  args: {
    status: v.union(
      v.literal("draft"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("sent"),
      v.literal("archived"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, limit }) => {
    let q = ctx.db
      .query("zeroDraftArtifacts")
      .withIndex("by_status_created", (q) => q.eq("status", status))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getZeroDraftsByType = query({
  args: {
    artifactType: v.union(
      v.literal("slack_message"),
      v.literal("email"),
      v.literal("spec_doc"),
      v.literal("pr_draft"),
      v.literal("architecture_note"),
      v.literal("career_plan"),
      v.literal("content_brief"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { artifactType, limit }) => {
    let q = ctx.db
      .query("zeroDraftArtifacts")
      .withIndex("by_type_created", (q) => q.eq("artifactType", artifactType))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getPendingApprovals = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    let q = ctx.db
      .query("zeroDraftArtifacts")
      .withIndex("by_status_created", (q) => q.eq("status", "pending_approval"))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

/* ================================================================== */
/* PROOF PACKS                                                         */
/* ================================================================== */

export const getProofPackByKey = query({
  args: { packKey: v.string() },
  handler: async (ctx, { packKey }) => {
    return await ctx.db
      .query("proofPacks")
      .withIndex("by_pack_key", (q) => q.eq("packKey", packKey))
      .first();
  },
});

export const getProofPacksBySubject = query({
  args: {
    subjectType: v.union(
      v.literal("deployment"),
      v.literal("career_move"),
      v.literal("content_release"),
      v.literal("research_run"),
      v.literal("agent_loop"),
    ),
    subjectId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { subjectType, subjectId, limit }) => {
    if (subjectId) {
      let q = ctx.db
        .query("proofPacks")
        .withIndex("by_subject", (q) => q.eq("subjectType", subjectType).eq("subjectId", subjectId))
        .order("desc");
      const r = limit ? await q.take(limit) : await q.collect();
      return r;
    }
    let q = ctx.db
      .query("proofPacks")
      .withIndex("by_subject", (q) => q.eq("subjectType", subjectType))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

export const getProofPacksByStatus = query({
  args: {
    status: v.union(
      v.literal("draft"),
      v.literal("ready"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, limit }) => {
    let q = ctx.db
      .query("proofPacks")
      .withIndex("by_status_created", (q) => q.eq("status", status))
      .order("desc");
    const results = limit ? await q.take(limit) : await q.collect();
    return results;
  },
});

/* ================================================================== */
/* AGGREGATION QUERIES                                                 */
/* ================================================================== */

export const getTemporalDashboard = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneDayAgo = now - 86400000;
    const oneWeekAgo = now - 604800000;

    // Count observations in last 24h
    const recentObs = await ctx.db
      .query("timeSeriesObservations")
      .order("desc")
      .take(1000);
    const obs24h = recentObs.filter((o) => o.createdAt >= oneDayAgo).length;

    // Open signals
    const openSignals = await ctx.db
      .query("timeSeriesSignals")
      .withIndex("by_status_detected", (q) => q.eq("status", "open"))
      .collect();

    // Watch signals
    const watchSignals = await ctx.db
      .query("timeSeriesSignals")
      .withIndex("by_status_detected", (q) => q.eq("status", "watch"))
      .collect();

    // Pending approvals
    const pendingDrafts = await ctx.db
      .query("zeroDraftArtifacts")
      .withIndex("by_status_created", (q) => q.eq("status", "pending_approval"))
      .collect();

    // Active causal chains
    const draftChains = await ctx.db
      .query("causalChains")
      .withIndex("by_status_created", (q) => q.eq("status", "draft"))
      .collect();

    // Ready proof packs
    const readyPacks = await ctx.db
      .query("proofPacks")
      .withIndex("by_status_created", (q) => q.eq("status", "ready"))
      .collect();

    return {
      observations: {
        last24h: obs24h,
        total: recentObs.length,
      },
      signals: {
        open: openSignals.length,
        watch: watchSignals.length,
        highSeverityOpen: openSignals.filter((s) => s.severity === "high").length,
      },
      causalChains: {
        draft: draftChains.length,
      },
      zeroDrafts: {
        pendingApproval: pendingDrafts.length,
      },
      proofPacks: {
        ready: readyPacks.length,
      },
    };
  },
});
