import { v } from "convex/values";
import { internalMutation, mutation } from "../../_generated/server";

/**
 * Canonical Runtime Mutations — CRUD for runs, scratchpads, projections, messages
 *
 * These mutations map to the EXISTING inline schema in convex/schema.ts.
 */

export const createRunRecord = mutation({
  args: {
    ownerKey: v.string(),
    entitySlug: v.string(),
    goal: v.string(),
    status: v.string(),
    currentCheckpoint: v.number(),
    totalCheckpoints: v.number(),
    thinkingBudgetTokens: v.number(),
    thinkingTokensUsed: v.number(),
    modelName: v.string(),
    startedAt: v.number(),
    lastActivityAt: v.number(),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    researchComplete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("extendedThinkingRuns", args);
  },
});

export const updateRunStatus = mutation({
  args: {
    runId: v.id("extendedThinkingRuns"),
    status: v.string(),
    completedAt: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    thinkingTokensUsed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: any = { status: args.status };
    if (args.completedAt !== undefined) updates.completedAt = args.completedAt;
    if (args.lastActivityAt !== undefined)
      updates.lastActivityAt = args.lastActivityAt;
    if (args.errorMessage !== undefined)
      updates.errorMessage = args.errorMessage;
    if (args.thinkingTokensUsed !== undefined)
      updates.thinkingTokensUsed = args.thinkingTokensUsed;
    await ctx.db.patch(args.runId, updates);
  },
});

export const createScratchpad = internalMutation({
  args: {
    agentThreadId: v.string(),
    userId: v.id("users"),
    scratchpad: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
    entitySlug: v.optional(v.string()),
    entityVersionAtStart: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("streaming"),
        v.literal("structuring"),
        v.literal("merged"),
        v.literal("drifted"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    mode: v.optional(v.union(v.literal("live"), v.literal("background"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentScratchpads", args);
  },
});

export const updateScratchpad = internalMutation({
  args: {
    scratchpadId: v.id("agentScratchpads"),
    scratchpad: v.optional(v.any()),
    status: v.optional(
      v.union(
        v.literal("streaming"),
        v.literal("structuring"),
        v.literal("merged"),
        v.literal("drifted"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    updatedAt: v.number(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: any = { updatedAt: args.updatedAt };
    if (args.scratchpad !== undefined) updates.scratchpad = args.scratchpad;
    if (args.status !== undefined) updates.status = args.status;
    if (args.failureReason !== undefined)
      updates.failureReason = args.failureReason;
    await ctx.db.patch(args.scratchpadId, updates);
  },
});

export const insertCheckpoint = mutation({
  args: {
    runId: v.id("extendedThinkingRuns"),
    index: v.number(),
    status: v.string(),
    promptHash: v.string(),
    modelName: v.string(),
    headline: v.optional(v.string()),
    findingsJson: v.optional(v.string()),
    nextFocus: v.optional(v.string()),
    reasoning: v.optional(v.string()),
    researchComplete: v.optional(v.boolean()),
    focus: v.optional(v.string()),
    latencyMs: v.number(),
    thinkingTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    judgedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("extendedThinkingCheckpoints", args);
  },
});

export const insertProjection = internalMutation({
  args: {
    ownerKey: v.string(),
    entityId: v.id("productEntities"),
    entitySlug: v.string(),
    blockType: v.union(
      v.literal("projection"),
      v.literal("founder"),
      v.literal("product"),
      v.literal("funding"),
      v.literal("news"),
      v.literal("hiring"),
      v.literal("patent"),
      v.literal("publicOpinion"),
      v.literal("competitor"),
      v.literal("regulatory"),
      v.literal("financial"),
    ),
    scratchpadRunId: v.string(),
    version: v.number(),
    overallTier: v.union(
      v.literal("verified"),
      v.literal("corroborated"),
      v.literal("single-source"),
      v.literal("unverified"),
    ),
    headerText: v.string(),
    bodyProse: v.optional(v.string()),
    sourceRefIds: v.optional(v.array(v.string())),
    sourceCount: v.optional(v.number()),
    sourceLabel: v.optional(v.string()),
    sourceTokens: v.optional(v.array(v.string())),
    payload: v.optional(v.any()),
    sourceSectionId: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (
      !entity ||
      entity.ownerKey !== args.ownerKey ||
      entity.slug !== args.entitySlug
    ) {
      throw new Error("insertProjection: invalid owner/entity context");
    }
    return await ctx.db.insert("diligenceProjections", {
      ...args,
      producerAssurance: "internal_canonical_v1",
    });
  },
});

export const insertAgentMessage = mutation({
  args: {
    ownerKey: v.string(),
    userId: v.optional(v.id("users")),
    threadId: v.string(),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    content: v.string(),
    surfaceOrigin: v.union(
      v.literal("inline"),
      v.literal("drawer"),
      v.literal("chat"),
    ),
    tokensUsed: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    model: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentMessages", args);
  },
});

export const upsertNotebookPage = internalMutation({
  args: {
    ownerKey: v.string(),
    entitySlug: v.string(),
    pageType: v.union(v.literal("entity"), v.literal("pulse")),
    title: v.string(),
    dateKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("productNotebookPages")
      .withIndex("by_owner_entity_date", (q) =>
        q
          .eq("ownerKey", args.ownerKey)
          .eq("entitySlug", args.entitySlug)
          .eq("dateKey", args.dateKey ?? ""),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        updatedAt: args.updatedAt,
        title: args.title,
      });
      return existing._id;
    }
    return await ctx.db.insert("productNotebookPages", args);
  },
});

export const upsertPulseReport = internalMutation({
  args: {
    ownerKey: v.string(),
    userId: v.optional(v.id("users")),
    entitySlug: v.string(),
    dateKey: v.string(),
    status: v.union(
      v.literal("generating"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    summaryMarkdown: v.optional(v.string()),
    changeCount: v.number(),
    materialChangeCount: v.number(),
    generatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pulseReports")
      .withIndex("by_owner_entity_date", (q) =>
        q
          .eq("ownerKey", args.ownerKey)
          .eq("entitySlug", args.entitySlug)
          .eq("dateKey", args.dateKey),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        generatedAt: args.generatedAt,
        summaryMarkdown: args.summaryMarkdown,
        changeCount: args.changeCount,
        materialChangeCount: args.materialChangeCount,
      });
      return existing._id;
    }
    return await ctx.db.insert("pulseReports", args);
  },
});

export const logAgentAction = mutation({
  args: {
    ownerKey: v.string(),
    userId: v.optional(v.id("users")),
    surfaceOrigin: v.union(
      v.literal("inline"),
      v.literal("drawer"),
      v.literal("chat"),
    ),
    threadId: v.optional(v.string()),
    entitySlug: v.optional(v.string()),
    blockId: v.optional(v.string()),
    scratchpadRunId: v.optional(v.string()),
    kind: v.union(
      v.literal("decoration_accepted"),
      v.literal("decoration_dismissed"),
      v.literal("decoration_refreshed"),
      v.literal("decoration_asked_about"),
      v.literal("block_added"),
      v.literal("block_edited"),
      v.literal("message_sent"),
    ),
    summary: v.string(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentActions", args);
  },
});

export const createPublicShare = mutation({
  args: {
    token: v.string(),
    resourceType: v.string(),
    resourceSlug: v.string(),
    ownerKey: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("publicShares", {
      ...args,
      createdAt: Date.now(),
      viewCount: 0,
    });
  },
});

export const revokePublicShare = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const share = await ctx.db
      .query("publicShares")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!share) return;
    await ctx.db.patch(share._id, { revokedAt: Date.now() });
  },
});
