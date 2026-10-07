import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

function hashPayload(payload: unknown): string {
  return JSON.stringify(payload ?? null);
}

async function findEpisodeByEpisodeId(
  ctx: any,
  episodeId: string,
) {
  return ctx.db
    .query("founderHarnessEpisodes")
    .filter((q) => q.eq(q.field("episodeId"), episodeId))
    .first();
}

export const startEpisode = mutation({
  args: {
    episodeId: v.string(),
    correlationId: v.string(),
    sessionKey: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    companyKey: v.optional(v.string()),
    surface: v.union(
      v.literal("web"),
      v.literal("api"),
      v.literal("browser"),
      v.literal("claude_code"),
      v.literal("openclaw"),
      v.literal("local_runtime"),
    ),
    episodeType: v.string(),
    query: v.optional(v.string()),
    lens: v.optional(v.string()),
    entityName: v.optional(v.string()),
    stateBefore: v.optional(v.any()),
    stateBeforeHash: v.optional(v.string()),
    metadata: v.optional(v.any()),
    initialSpan: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await findEpisodeByEpisodeId(ctx, args.episodeId);

    const nextStateBeforeHash = args.stateBeforeHash ?? hashPayload(args.stateBefore ?? null);
    const initialSpans = args.initialSpan ? [args.initialSpan] : [];

    if (existing) {
      await ctx.db.patch(existing._id, {
        correlationId: args.correlationId,
        sessionKey: args.sessionKey ?? existing.sessionKey,
        workspaceId: args.workspaceId ?? existing.workspaceId,
        companyKey: args.companyKey ?? existing.companyKey,
        surface: args.surface,
        episodeType: args.episodeType,
        query: args.query ?? existing.query,
        lens: args.lens ?? existing.lens,
        entityName: args.entityName ?? existing.entityName,
        stateBefore: args.stateBefore ?? existing.stateBefore,
        stateBeforeHash: nextStateBeforeHash,
        metadata: args.metadata ?? existing.metadata,
        spans: existing.spans.length > 0 ? existing.spans : initialSpans,
        updatedAt: now,
        status: existing.status === "completed" ? "completed" : "active",
      });
      return findEpisodeByEpisodeId(ctx, args.episodeId);
    }

    const id = await ctx.db.insert("founderHarnessEpisodes", {
      episodeId: args.episodeId,
      correlationId: args.correlationId,
      sessionKey: args.sessionKey,
      workspaceId: args.workspaceId,
      companyKey: args.companyKey,
      surface: args.surface,
      episodeType: args.episodeType,
      status: "active",
      query: args.query,
      lens: args.lens,
      entityName: args.entityName,
      stateBefore: args.stateBefore,
      stateBeforeHash: nextStateBeforeHash,
      spans: initialSpans,
      toolsInvoked: [],
      artifactsProduced: [],
      metadata: args.metadata,
      startedAt: now,
      updatedAt: now,
    });

    return ctx.db.get(id);
  },
});

export const appendEpisodeSpan = mutation({
  args: {
    episodeId: v.string(),
    span: v.any(),
    contextId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    entityName: v.optional(v.string()),
    packetId: v.optional(v.string()),
    packetType: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    companyKey: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await findEpisodeByEpisodeId(ctx, args.episodeId);
    if (!existing) {
      throw new Error(`Founder harness episode not found: ${args.episodeId}`);
    }

    const spans = [...existing.spans, args.span];
    const nextMetadata = args.metadata
      ? { ...(existing.metadata ?? {}), ...args.metadata }
      : existing.metadata;

    await ctx.db.patch(existing._id, {
      spans,
      contextId: args.contextId ?? existing.contextId,
      taskId: args.taskId ?? existing.taskId,
      entityName: args.entityName ?? existing.entityName,
      packetId: args.packetId ?? existing.packetId,
      packetType: args.packetType ?? existing.packetType,
      workspaceId: args.workspaceId ?? existing.workspaceId,
      companyKey: args.companyKey ?? existing.companyKey,
      metadata: nextMetadata,
      updatedAt: now,
    });

    return findEpisodeByEpisodeId(ctx, args.episodeId);
  },
});

export const finalizeEpisode = mutation({
  args: {
    episodeId: v.string(),
    status: v.optional(
      v.union(
        v.literal("completed"),
        v.literal("error"),
        v.literal("aborted"),
      ),
    ),
    stateAfter: v.optional(v.any()),
    stateAfterHash: v.optional(v.string()),
    summary: v.optional(v.string()),
    toolsInvoked: v.optional(v.array(v.string())),
    artifactsProduced: v.optional(v.array(v.string())),
    traceStepCount: v.optional(v.number()),
    importantChangesDetected: v.optional(v.number()),
    contradictionsDetected: v.optional(v.number()),
    contextId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    entityName: v.optional(v.string()),
    packetId: v.optional(v.string()),
    packetType: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    companyKey: v.optional(v.string()),
    finalSpan: v.optional(v.any()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await findEpisodeByEpisodeId(ctx, args.episodeId);
    if (!existing) {
      throw new Error(`Founder harness episode not found: ${args.episodeId}`);
    }

    const spans = args.finalSpan ? [...existing.spans, args.finalSpan] : existing.spans;
    const nextTools = args.toolsInvoked
      ? Array.from(new Set([...(existing.toolsInvoked ?? []), ...args.toolsInvoked]))
      : existing.toolsInvoked;
    const nextArtifacts = args.artifactsProduced
      ? Array.from(new Set([...(existing.artifactsProduced ?? []), ...args.artifactsProduced]))
      : existing.artifactsProduced;
    const nextMetadata = args.metadata
      ? { ...(existing.metadata ?? {}), ...args.metadata }
      : existing.metadata;

    await ctx.db.patch(existing._id, {
      status: args.status ?? "completed",
      stateAfter: args.stateAfter ?? existing.stateAfter,
      stateAfterHash: args.stateAfterHash ?? hashPayload(args.stateAfter ?? existing.stateAfter ?? null),
      summary: args.summary ?? existing.summary,
      toolsInvoked: nextTools ?? [],
      artifactsProduced: nextArtifacts ?? [],
      traceStepCount: args.traceStepCount ?? existing.traceStepCount,
      importantChangesDetected: args.importantChangesDetected ?? existing.importantChangesDetected,
      contradictionsDetected: args.contradictionsDetected ?? existing.contradictionsDetected,
      contextId: args.contextId ?? existing.contextId,
      taskId: args.taskId ?? existing.taskId,
      entityName: args.entityName ?? existing.entityName,
      packetId: args.packetId ?? existing.packetId,
      packetType: args.packetType ?? existing.packetType,
      workspaceId: args.workspaceId ?? existing.workspaceId,
      companyKey: args.companyKey ?? existing.companyKey,
      spans,
      metadata: nextMetadata,
      updatedAt: now,
      completedAt: now,
    });

    return findEpisodeByEpisodeId(ctx, args.episodeId);
  },
});

export const getEpisode = query({
  args: { episodeId: v.string() },
  handler: async (ctx, args) => {
    return findEpisodeByEpisodeId(ctx, args.episodeId);
  },
});

export const listEpisodes = query({
  args: {
    sessionKey: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("completed"),
        v.literal("error"),
        v.literal("aborted"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 10, 50);
    // Founder episodes are still a relatively small table. Favor the most robust
    // query path over optional-index lookups here so public control-plane reads
    // do not fail when optional index values drift across deployments.
    const baseRows = args.status
      ? await ctx.db
          .query("founderHarnessEpisodes")
          .withIndex("by_status_started", (q) => q.eq("status", args.status!))
          .order("desc")
          .take(take * 6)
      : await ctx.db
          .query("founderHarnessEpisodes")
          .order("desc")
          .take(take * 6);

    return baseRows
      .filter((row) => {
        if (args.sessionKey && row.sessionKey !== args.sessionKey) return false;
        if (args.workspaceId && row.workspaceId !== args.workspaceId) return false;
        return true;
      })
      .slice(0, take);
  },
});
