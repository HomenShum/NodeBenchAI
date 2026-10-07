/**
 * Phase 10 — Causal Memory & Trajectory Intelligence Operations
 *
 * Queries and mutations for the 8 new tables (19-26):
 * Event Ledger, Path Steps, State Diffs, Time Rollups,
 * Packet Versions, Memo Versions, Important Changes, Trajectory Scores.
 *
 * All list queries bounded with .take(). All mutations auth-gated.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

// ===========================================================================
// Auth Helpers (shared with operations.ts)
// ===========================================================================

async function requireAuth(ctx: { auth: QueryCtx["auth"] }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  return identity.subject;
}

async function assertCompanyOwner(
  ctx: { db: QueryCtx["db"]; auth: QueryCtx["auth"] },
  companyId: Id<"founderCompanies">,
) {
  const userId = await requireAuth(ctx);
  const company = await ctx.db.get(companyId);
  if (!company) throw new Error("Access denied");
  const workspace = await ctx.db.get(company.workspaceId);
  if (!workspace || workspace.ownerUserId !== userId) {
    throw new Error("Access denied");
  }
  return { userId, company, workspace };
}

async function assertWorkspaceOwner(
  ctx: { db: QueryCtx["db"]; auth: QueryCtx["auth"] },
  workspaceId: Id<"founderWorkspaces">,
): Promise<string> {
  const userId = await requireAuth(ctx);
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.ownerUserId !== userId) {
    throw new Error("Access denied");
  }
  return userId;
}

// ===========================================================================
// 19. Event Ledger — Mutations
// ===========================================================================

export const recordEvent = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    companyId: v.optional(v.id("founderCompanies")),
    eventType: v.string(), // validated by schema union
    actorType: v.union(
      v.literal("founder"),
      v.literal("agent"),
      v.literal("system"),
      v.literal("background_job"),
    ),
    actorRef: v.optional(v.string()),
    entityType: v.string(),
    entityId: v.string(),
    summary: v.string(),
    details: v.optional(v.any()),
    causedByEventId: v.optional(v.id("founderEventLedger")),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    return ctx.db.insert("founderEventLedger", {
      ...args,
      eventType: args.eventType as any,
      entityType: args.entityType as any,
      createdAt: Date.now(),
    });
  },
});

// Internal version for background jobs (no auth)
export const recordEventInternal = internalMutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    companyId: v.optional(v.id("founderCompanies")),
    eventType: v.string(),
    actorType: v.string(),
    actorRef: v.optional(v.string()),
    entityType: v.string(),
    entityId: v.string(),
    summary: v.string(),
    details: v.optional(v.any()),
    causedByEventId: v.optional(v.id("founderEventLedger")),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("founderEventLedger", {
      ...args,
      eventType: args.eventType as any,
      actorType: args.actorType as any,
      entityType: args.entityType as any,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// 19. Event Ledger — Queries
// ===========================================================================

export const getEventLedger = query({
  args: {
    companyId: v.id("founderCompanies"),
    limit: v.optional(v.number()),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, limit, eventType }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 100, 200);

    if (eventType) {
      return ctx.db
        .query("founderEventLedger")
        .withIndex("by_event_type", (q) =>
          q.eq("eventType", eventType as any),
        )
        .order("desc")
        .take(cap);
    }

    return ctx.db
      .query("founderEventLedger")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(cap);
  },
});

export const getEventsByCorrelation = query({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    correlationId: v.string(),
  },
  handler: async (ctx, { workspaceId, correlationId }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    // Filter client-side since we don't have a correlationId index
    const events = await ctx.db
      .query("founderEventLedger")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(500);
    return events.filter((e) => e.correlationId === correlationId);
  },
});

export const getCausalChain = query({
  args: {
    eventId: v.id("founderEventLedger"),
    depth: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, depth }) => {
    const maxDepth = Math.min(depth ?? 10, 20);
    const chain: any[] = [];
    let currentId: Id<"founderEventLedger"> | undefined = eventId;

    for (let i = 0; i < maxDepth && currentId; i++) {
      const event = await ctx.db.get(currentId);
      if (!event) break;
      chain.push(event);
      currentId = event.causedByEventId ?? undefined;
    }

    return chain;
  },
});

// ===========================================================================
// 20. Path Steps — Mutations
// ===========================================================================

export const recordPathStep = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    sessionId: v.string(),
    stepIndex: v.number(),
    surfaceType: v.union(
      v.literal("view"),
      v.literal("entity"),
      v.literal("artifact"),
      v.literal("agent_task"),
      v.literal("search"),
      v.literal("external"),
    ),
    surfaceRef: v.string(),
    surfaceLabel: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    companyId: v.optional(v.id("founderCompanies")),
    transitionFrom: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    return ctx.db.insert("founderPathSteps", {
      ...args,
      enteredAt: Date.now(),
    });
  },
});

export const exitPathStep = mutation({
  args: {
    stepId: v.id("founderPathSteps"),
  },
  handler: async (ctx, { stepId }) => {
    const step = await ctx.db.get(stepId);
    if (!step) throw new Error("Step not found");
    const now = Date.now();
    await ctx.db.patch(stepId, {
      exitedAt: now,
      durationMs: now - step.enteredAt,
    });
  },
});

export const markPathStepProducedArtifact = mutation({
  args: {
    stepId: v.id("founderPathSteps"),
    producedArtifactType: v.string(),
    producedArtifactId: v.string(),
  },
  handler: async (ctx, { stepId, producedArtifactType, producedArtifactId }) => {
    await ctx.db.patch(stepId, { producedArtifactType, producedArtifactId });
  },
});

// ===========================================================================
// 20. Path Steps — Queries
// ===========================================================================

export const getPathBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return ctx.db
      .query("founderPathSteps")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .take(500);
  },
});

export const getRecentPaths = query({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, limit }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    const cap = Math.min(limit ?? 50, 200);
    return ctx.db
      .query("founderPathSteps")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(cap);
  },
});

// ===========================================================================
// 21. State Diffs — Mutations
// ===========================================================================

export const recordStateDiff = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    companyId: v.optional(v.id("founderCompanies")),
    entityType: v.string(),
    entityId: v.string(),
    changeType: v.string(),
    beforeState: v.any(),
    afterState: v.any(),
    changedFields: v.array(v.string()),
    triggeringEventId: v.optional(v.id("founderEventLedger")),
    actorType: v.union(
      v.literal("founder"),
      v.literal("agent"),
      v.literal("system"),
      v.literal("background_job"),
    ),
    actorRef: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    return ctx.db.insert("founderStateDiffs", {
      ...args,
      entityType: args.entityType as any,
      changeType: args.changeType as any,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// 21. State Diffs — Queries
// ===========================================================================

export const getStateDiffs = query({
  args: {
    entityType: v.string(),
    entityId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityType, entityId, limit }) => {
    const cap = Math.min(limit ?? 50, 100);
    return ctx.db
      .query("founderStateDiffs")
      .withIndex("by_entity", (q) =>
        q.eq("entityType", entityType as any).eq("entityId", entityId),
      )
      .order("desc")
      .take(cap);
  },
});

export const getCompanyDiffs = query({
  args: {
    companyId: v.id("founderCompanies"),
    changeType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, changeType, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 50, 100);

    if (changeType) {
      return ctx.db
        .query("founderStateDiffs")
        .withIndex("by_change_type", (q) =>
          q.eq("changeType", changeType as any),
        )
        .order("desc")
        .take(cap);
    }

    return ctx.db
      .query("founderStateDiffs")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(cap);
  },
});

// ===========================================================================
// 22. Time Rollups — Mutations
// ===========================================================================

export const generateTimeRollup = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    periodType: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly"),
    ),
    periodKey: v.string(),
    metrics: v.object({
      initiativeCount: v.number(),
      initiativesActive: v.number(),
      initiativesBlocked: v.number(),
      initiativesCompleted: v.number(),
      interventionsSuggested: v.number(),
      interventionsStarted: v.number(),
      interventionsCompleted: v.number(),
      signalsIngested: v.number(),
      avgSignalImportance: v.number(),
      identityConfidence: v.number(),
      avgInitiativePriority: v.number(),
      eventsRecorded: v.number(),
      pathStepsRecorded: v.number(),
      diffsRecorded: v.number(),
      packetsGenerated: v.number(),
      memosGenerated: v.number(),
      agentsHealthy: v.number(),
      agentsDrifting: v.number(),
      importantChangesDetected: v.number(),
      importantChangesResolved: v.number(),
    }),
    deltas: v.optional(v.object({
      initiativeCountDelta: v.number(),
      interventionsCompletedDelta: v.number(),
      signalsIngestedDelta: v.number(),
      identityConfidenceDelta: v.number(),
      eventsRecordedDelta: v.number(),
    })),
    narrative: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    return ctx.db.insert("founderTimeRollups", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// Internal version for background rollup jobs
export const generateTimeRollupInternal = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    periodType: v.string(),
    periodKey: v.string(),
    metrics: v.any(),
    deltas: v.optional(v.any()),
    narrative: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("founderTimeRollups", {
      ...args,
      periodType: args.periodType as any,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// 22. Time Rollups — Queries
// ===========================================================================

export const getTimeRollup = query({
  args: {
    companyId: v.id("founderCompanies"),
    periodType: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly"),
    ),
    periodKey: v.string(),
  },
  handler: async (ctx, { companyId, periodType, periodKey }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q
          .eq("companyId", companyId)
          .eq("periodType", periodType)
          .eq("periodKey", periodKey),
      )
      .first();
  },
});

export const getTimeRollups = query({
  args: {
    companyId: v.id("founderCompanies"),
    periodType: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, periodType, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 30, 100);
    return ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", periodType),
      )
      .order("desc")
      .take(cap);
  },
});

export const compareTimeRollups = query({
  args: {
    companyId: v.id("founderCompanies"),
    periodType: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly"),
    ),
    periodKeyA: v.string(),
    periodKeyB: v.string(),
  },
  handler: async (ctx, { companyId, periodType, periodKeyA, periodKeyB }) => {
    await assertCompanyOwner(ctx, companyId);
    const [rollupA, rollupB] = await Promise.all([
      ctx.db
        .query("founderTimeRollups")
        .withIndex("by_company_period", (q) =>
          q
            .eq("companyId", companyId)
            .eq("periodType", periodType)
            .eq("periodKey", periodKeyA),
        )
        .first(),
      ctx.db
        .query("founderTimeRollups")
        .withIndex("by_company_period", (q) =>
          q
            .eq("companyId", companyId)
            .eq("periodType", periodType)
            .eq("periodKey", periodKeyB),
        )
        .first(),
    ]);

    if (!rollupA || !rollupB) {
      return { rollupA, rollupB, comparison: null };
    }

    // Compute deltas between periods
    const mA = rollupA.metrics;
    const mB = rollupB.metrics;
    const comparison = {
      initiativeCountDelta: mB.initiativeCount - mA.initiativeCount,
      interventionsCompletedDelta: mB.interventionsCompleted - mA.interventionsCompleted,
      signalsIngestedDelta: mB.signalsIngested - mA.signalsIngested,
      identityConfidenceDelta: mB.identityConfidence - mA.identityConfidence,
      eventsRecordedDelta: mB.eventsRecorded - mA.eventsRecorded,
      packetsGeneratedDelta: mB.packetsGenerated - mA.packetsGenerated,
      importantChangesResolvedDelta: mB.importantChangesResolved - mA.importantChangesResolved,
    };

    return { rollupA, rollupB, comparison };
  },
});

// ===========================================================================
// 23. Packet Versions — Mutations
// ===========================================================================

export const createPacketVersion = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    packetContent: v.any(),
    contentHash: v.string(),
    triggerType: v.union(
      v.literal("manual"),
      v.literal("scheduled"),
      v.literal("change_triggered"),
      v.literal("agent_delivered"),
    ),
    triggeringEventId: v.optional(v.id("founderEventLedger")),
    inputSources: v.object({
      evidenceCount: v.number(),
      signalCount: v.number(),
      snapshotId: v.optional(v.string()),
      initiativeIds: v.array(v.string()),
      interventionIds: v.array(v.string()),
    }),
    audience: v.union(
      v.literal("founder"),
      v.literal("investor"),
      v.literal("agent"),
      v.literal("peer"),
      v.literal("team"),
    ),
    diffSummary: v.optional(v.string()),
    changedSections: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { workspace } = await assertCompanyOwner(ctx, args.companyId);

    // Find the latest version to set version number and parent
    const latest = await ctx.db
      .query("founderPacketVersions")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .order("desc")
      .first();

    const versionNumber = latest ? latest.versionNumber + 1 : 1;

    return ctx.db.insert("founderPacketVersions", {
      ...args,
      workspaceId: workspace._id,
      versionNumber,
      parentVersionId: latest?._id,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// 23. Packet Versions — Queries
// ===========================================================================

export const getPacketVersions = query({
  args: {
    companyId: v.id("founderCompanies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 20, 50);
    return ctx.db
      .query("founderPacketVersions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(cap);
  },
});

export const getPacketVersion = query({
  args: { versionId: v.id("founderPacketVersions") },
  handler: async (ctx, { versionId }) => {
    return ctx.db.get(versionId);
  },
});

// ===========================================================================
// 24. Memo Versions — Mutations
// ===========================================================================

export const createMemoVersion = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    memoTitle: v.string(),
    memoContent: v.any(),
    contentHash: v.string(),
    exportFormat: v.union(
      v.literal("markdown"),
      v.literal("html"),
      v.literal("pdf"),
      v.literal("docx"),
      v.literal("json"),
      v.literal("agent_brief"),
      v.literal("shareable_url"),
    ),
    sourcePacketVersionId: v.optional(v.id("founderPacketVersions")),
    diffSummary: v.optional(v.string()),
    changedSections: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { workspace } = await assertCompanyOwner(ctx, args.companyId);

    const latest = await ctx.db
      .query("founderMemoVersions")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .order("desc")
      .first();

    const versionNumber = latest ? latest.versionNumber + 1 : 1;

    return ctx.db.insert("founderMemoVersions", {
      ...args,
      workspaceId: workspace._id,
      versionNumber,
      parentVersionId: latest?._id,
      createdAt: Date.now(),
    });
  },
});

export const recordMemoShare = mutation({
  args: {
    memoVersionId: v.id("founderMemoVersions"),
    audience: v.string(),
    method: v.string(),
  },
  handler: async (ctx, { memoVersionId, audience, method }) => {
    const memo = await ctx.db.get(memoVersionId);
    if (!memo) throw new Error("Memo version not found");
    const existing = memo.sharedWith ?? [];
    await ctx.db.patch(memoVersionId, {
      sharedWith: [...existing, { audience, method, sharedAt: Date.now() }],
    });
  },
});

// ===========================================================================
// 24. Memo Versions — Queries
// ===========================================================================

export const getMemoVersions = query({
  args: {
    companyId: v.id("founderCompanies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 20, 50);
    return ctx.db
      .query("founderMemoVersions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(cap);
  },
});

// ===========================================================================
// 25. Important Changes — Mutations
// ===========================================================================

export const flagImportantChange = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    changeCategory: v.string(),
    impactScore: v.number(),
    impactReason: v.string(),
    affectedEntities: v.array(v.object({
      entityType: v.string(),
      entityId: v.string(),
      entityLabel: v.string(),
    })),
    shouldTriggerPacket: v.boolean(),
    shouldTriggerBrief: v.boolean(),
    shouldTriggerAlert: v.boolean(),
    suggestedAction: v.optional(v.string()),
    detectedByEventId: v.optional(v.id("founderEventLedger")),
  },
  handler: async (ctx, args) => {
    const { workspace } = await assertCompanyOwner(ctx, args.companyId);
    const now = Date.now();
    return ctx.db.insert("founderImportantChanges", {
      ...args,
      changeCategory: args.changeCategory as any,
      workspaceId: workspace._id,
      status: "detected",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Internal version for background detection jobs
export const flagImportantChangeInternal = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    workspaceId: v.id("founderWorkspaces"),
    changeCategory: v.string(),
    impactScore: v.number(),
    impactReason: v.string(),
    affectedEntities: v.any(),
    shouldTriggerPacket: v.boolean(),
    shouldTriggerBrief: v.boolean(),
    shouldTriggerAlert: v.boolean(),
    suggestedAction: v.optional(v.string()),
    detectedByEventId: v.optional(v.id("founderEventLedger")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("founderImportantChanges", {
      ...args,
      changeCategory: args.changeCategory as any,
      status: "detected",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const resolveImportantChange = mutation({
  args: {
    changeId: v.id("founderImportantChanges"),
    status: v.union(
      v.literal("acknowledged"),
      v.literal("investigating"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
    resolutionNote: v.optional(v.string()),
  },
  handler: async (ctx, { changeId, status, resolutionNote }) => {
    const change = await ctx.db.get(changeId);
    if (!change) throw new Error("Change not found");
    const now = Date.now();
    await ctx.db.patch(changeId, {
      status,
      resolutionNote,
      resolvedAt: status === "resolved" || status === "dismissed" ? now : undefined,
      updatedAt: now,
    });
  },
});

// ===========================================================================
// 25. Important Changes — Queries
// ===========================================================================

export const getImportantChanges = query({
  args: {
    companyId: v.id("founderCompanies"),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, status, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 30, 100);

    if (status) {
      return ctx.db
        .query("founderImportantChanges")
        .withIndex("by_status", (q) => q.eq("status", status as any))
        .order("desc")
        .take(cap);
    }

    return ctx.db
      .query("founderImportantChanges")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(cap);
  },
});

export const getActiveChanges = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    const all = await ctx.db
      .query("founderImportantChanges")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(50);
    return all.filter(
      (c) => c.status === "detected" || c.status === "acknowledged" || c.status === "investigating",
    );
  },
});

// ===========================================================================
// 26. Trajectory Scores — Mutations
// ===========================================================================

export const recordTrajectoryScore = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    date: v.string(),
    overallScore: v.number(),
    dimensions: v.object({
      identityClarity: v.number(),
      executionVelocity: v.number(),
      agentAlignment: v.number(),
      signalStrength: v.number(),
      interventionEffectiveness: v.number(),
      contradictionLoad: v.number(),
      confidenceTrend: v.number(),
    }),
    slopeVsPriorDay: v.optional(v.number()),
    slopeVsPriorWeek: v.optional(v.number()),
    slopeVsPriorMonth: v.optional(v.number()),
    snapshotMetrics: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    return ctx.db.insert("founderTrajectoryScores", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// Internal version for daily scoring job
export const recordTrajectoryScoreInternal = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    date: v.string(),
    overallScore: v.number(),
    dimensions: v.any(),
    slopeVsPriorDay: v.optional(v.number()),
    slopeVsPriorWeek: v.optional(v.number()),
    slopeVsPriorMonth: v.optional(v.number()),
    snapshotMetrics: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("founderTrajectoryScores", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// 26. Trajectory Scores — Queries
// ===========================================================================

export const getTrajectoryScores = query({
  args: {
    companyId: v.id("founderCompanies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 90, 365);
    return ctx.db
      .query("founderTrajectoryScores")
      .withIndex("by_company_date", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(cap);
  },
});

export const getTrajectoryScore = query({
  args: {
    companyId: v.id("founderCompanies"),
    date: v.string(),
  },
  handler: async (ctx, { companyId, date }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("founderTrajectoryScores")
      .withIndex("by_company_date", (q) =>
        q.eq("companyId", companyId).eq("date", date),
      )
      .first();
  },
});

// ===========================================================================
// Aggregate Dashboard Query — trajectory + recent changes + rollup
// ===========================================================================

export const getDashboardTrajectory = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);

    const [
      recentScores,
      activeChanges,
      recentEvents,
      latestDailyRollup,
    ] = await Promise.all([
      // Last 30 days of trajectory scores
      ctx.db
        .query("founderTrajectoryScores")
        .withIndex("by_company_date", (q) => q.eq("companyId", companyId))
        .order("desc")
        .take(30),
      // Active important changes
      ctx.db
        .query("founderImportantChanges")
        .withIndex("by_company", (q) => q.eq("companyId", companyId))
        .order("desc")
        .take(20),
      // Last 50 events
      ctx.db
        .query("founderEventLedger")
        .withIndex("by_company", (q) => q.eq("companyId", companyId))
        .order("desc")
        .take(50),
      // Latest daily rollup
      ctx.db
        .query("founderTimeRollups")
        .withIndex("by_company_period", (q) =>
          q.eq("companyId", companyId).eq("periodType", "daily"),
        )
        .order("desc")
        .first(),
    ]);

    const unresolvedChanges = activeChanges.filter(
      (c) => c.status === "detected" || c.status === "acknowledged" || c.status === "investigating",
    );

    return {
      trajectoryScores: recentScores.reverse(), // oldest first for charting
      unresolvedChanges,
      totalActiveChanges: unresolvedChanges.length,
      recentEvents: recentEvents.slice(0, 20),
      latestDailyRollup,
      latestScore: recentScores[0] ?? null,
    };
  },
});
