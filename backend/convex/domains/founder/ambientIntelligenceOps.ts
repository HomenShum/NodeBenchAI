/**
 * Phase 11 — Ambient Intelligence Operations
 *
 * Ingestion queue, canonical objects, change detections, packet readiness.
 * The always-on pipeline that turns raw activity into structured business truth.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

// ===========================================================================
// Auth Helpers
// ===========================================================================

async function requireAuth(ctx: { auth: QueryCtx["auth"] }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  return identity.subject;
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

async function assertAmbientScopeOwner(
  ctx: { db: QueryCtx["db"]; auth: QueryCtx["auth"] },
  scope: {
    companyId?: Id<"founderCompanies">;
    workspaceId?: Id<"founderWorkspaces">;
  },
) {
  if (scope.companyId) {
    return assertCompanyOwner(ctx, scope.companyId);
  }
  if (scope.workspaceId) {
    await assertWorkspaceOwner(ctx, scope.workspaceId);
    const workspace = await ctx.db.get(scope.workspaceId);
    if (!workspace) throw new Error("Access denied");
    return { userId: workspace.ownerUserId, company: undefined, workspace };
  }
  throw new Error("Access denied");
}

async function assertCanonicalObjectOwner(
  ctx: { db: QueryCtx["db"]; auth: QueryCtx["auth"] },
  objectId: Id<"ambientCanonicalObjects">,
) {
  const object = await ctx.db.get(objectId);
  if (!object) throw new Error("Object not found");
  await assertAmbientScopeOwner(ctx, {
    companyId: object.companyId ?? undefined,
    workspaceId: object.workspaceId ?? undefined,
  });
  return object;
}

async function getOwnedWorkspaceId(ctx: { db: QueryCtx["db"]; auth: QueryCtx["auth"] }) {
  const userId = await requireAuth(ctx);
  const workspace = await ctx.db
    .query("founderWorkspaces")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .first();
  return workspace?._id;
}

// ===========================================================================
// 27. Ingestion Queue — Write
// ===========================================================================

/** Enqueue raw content from any source for processing. */
export const enqueueIngestion = mutation({
  args: {
    sourceType: v.union(
      v.literal("chat"),
      v.literal("agent_output"),
      v.literal("mcp_tool"),
      v.literal("file_change"),
      v.literal("web_signal"),
      v.literal("user_action"),
      v.literal("import"),
    ),
    sourceProvider: v.string(),
    sourceRef: v.string(),
    rawContent: v.string(),
    metadata: v.optional(v.any()),
    companyId: v.optional(v.id("founderCompanies")),
    workspaceId: v.optional(v.id("founderWorkspaces")),
  },
  handler: async (ctx, args) => {
    const companyScope = args.companyId ? await assertCompanyOwner(ctx, args.companyId) : undefined;
    if (args.workspaceId) {
      await assertWorkspaceOwner(ctx, args.workspaceId);
    } else {
      await requireAuth(ctx);
    }
    if (companyScope && args.workspaceId && companyScope.company.workspaceId !== args.workspaceId) {
      throw new Error("Access denied");
    }

    return ctx.db.insert("ambientIngestionQueue", {
      ...args,
      processingStatus: "queued",
      createdAt: Date.now(),
    });
  },
});

/** Internal: enqueue without auth (for background jobs / providers). */
export const enqueueIngestionInternal = internalMutation({
  args: {
    sourceType: v.string(),
    sourceProvider: v.string(),
    sourceRef: v.string(),
    rawContent: v.string(),
    metadata: v.optional(v.any()),
    companyId: v.optional(v.id("founderCompanies")),
    workspaceId: v.optional(v.id("founderWorkspaces")),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("ambientIngestionQueue", {
      ...args,
      sourceType: args.sourceType as any,
      processingStatus: "queued",
      createdAt: Date.now(),
    });
  },
});

/** Mark an ingestion item as processed. */
export const markIngestionProcessed = internalMutation({
  args: {
    ingestionId: v.id("ambientIngestionQueue"),
    status: v.union(v.literal("canonicalized"), v.literal("failed")),
  },
  handler: async (ctx, { ingestionId, status }) => {
    await ctx.db.patch(ingestionId, {
      processingStatus: status,
      processedAt: Date.now(),
    });
  },
});

// ===========================================================================
// 27. Ingestion Queue — Read
// ===========================================================================

/** Get queued items for processing. */
export const getQueuedIngestions = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = Math.min(limit ?? 20, 50);
    return ctx.db
      .query("ambientIngestionQueue")
      .withIndex("by_status", (q) => q.eq("processingStatus", "queued"))
      .order("asc")
      .take(cap);
  },
});

/** Get recent ingestions for a company. */
export const getRecentIngestions = query({
  args: {
    companyId: v.id("founderCompanies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 30, 100);
    return ctx.db
      .query("ambientIngestionQueue")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(cap);
  },
});

// ===========================================================================
// 28. Canonical Objects — Write
// ===========================================================================

/** Create a canonical object from processed ingestion. */
export const createCanonicalObject = internalMutation({
  args: {
    objectType: v.string(),
    companyId: v.optional(v.id("founderCompanies")),
    workspaceId: v.optional(v.id("founderWorkspaces")),
    title: v.string(),
    content: v.string(),
    confidence: v.number(),
    sourceIngestionIds: v.array(v.string()),
    supersedes: v.optional(v.id("ambientCanonicalObjects")),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // If superseding, mark the old one as not latest
    if (args.supersedes) {
      await ctx.db.patch(args.supersedes, { isLatest: false });
    }

    const now = Date.now();
    return ctx.db.insert("ambientCanonicalObjects", {
      ...args,
      objectType: args.objectType as any,
      isLatest: true,
      extractedAt: now,
      updatedAt: now,
    });
  },
});

/** Update a canonical object (creates a new version via supersedes chain). */
export const updateCanonicalObject = mutation({
  args: {
    objectId: v.id("ambientCanonicalObjects"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    confidence: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { objectId, ...updates }) => {
    await assertCanonicalObjectOwner(ctx, objectId);

    const now = Date.now();
    const patch: Record<string, any> = { updatedAt: now };
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.content !== undefined) patch.content = updates.content;
    if (updates.confidence !== undefined) patch.confidence = updates.confidence;
    if (updates.tags !== undefined) patch.tags = updates.tags;

    await ctx.db.patch(objectId, patch);
    return objectId;
  },
});

// ===========================================================================
// 28. Canonical Objects — Read
// ===========================================================================

/** Get latest canonical objects for a company. */
export const getCanonicalObjects = query({
  args: {
    companyId: v.id("founderCompanies"),
    objectType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, objectType, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 50, 200);

    if (objectType) {
      return ctx.db
        .query("ambientCanonicalObjects")
        .withIndex("by_company", (q) =>
          q.eq("companyId", companyId).eq("objectType", objectType as any).eq("isLatest", true),
        )
        .order("desc")
        .take(cap);
    }

    return ctx.db
      .query("ambientCanonicalObjects")
      .withIndex("by_company", (q) =>
        q.eq("companyId", companyId),
      )
      .order("desc")
      .take(cap);
  },
});

/** Get the supersedes chain for an object. */
export const getObjectHistory = query({
  args: { objectId: v.id("ambientCanonicalObjects") },
  handler: async (ctx, { objectId }) => {
    const rootObject = await assertCanonicalObjectOwner(ctx, objectId);
    const chain: any[] = [];
    let currentId: Id<"ambientCanonicalObjects"> | undefined = objectId;
    const allowedCompanyId = rootObject.companyId ?? undefined;
    const allowedWorkspaceId = rootObject.workspaceId ?? undefined;

    for (let i = 0; i < 20 && currentId; i++) {
      const obj = await ctx.db.get(currentId);
      if (!obj) break;
      if ((obj.companyId ?? undefined) !== allowedCompanyId || (obj.workspaceId ?? undefined) !== allowedWorkspaceId) {
        break;
      }
      chain.push(obj);
      currentId = obj.supersedes ?? undefined;
    }

    return chain;
  },
});

// ===========================================================================
// 29. Change Detections — Write
// ===========================================================================

/** Record a detected change. */
export const recordChangeDetection = internalMutation({
  args: {
    detectionType: v.string(),
    objectId: v.id("ambientCanonicalObjects"),
    companyId: v.optional(v.id("founderCompanies")),
    priorState: v.optional(v.any()),
    currentState: v.any(),
    impactScore: v.number(),
    impactReason: v.string(),
    requiresAttention: v.boolean(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("ambientChangeDetections", {
      ...args,
      detectionType: args.detectionType as any,
      detectedAt: Date.now(),
    });
  },
});

/** Resolve a change detection. */
export const resolveChangeDetection = mutation({
  args: { detectionId: v.id("ambientChangeDetections") },
  handler: async (ctx, { detectionId }) => {
    const detection = await ctx.db.get(detectionId);
    if (!detection) throw new Error("Access denied");
    if (detection.companyId) {
      await assertCompanyOwner(ctx, detection.companyId);
    } else {
      const object = await ctx.db.get(detection.objectId);
      if (!object) throw new Error("Access denied");
      await assertAmbientScopeOwner(ctx, {
        companyId: object.companyId ?? undefined,
        workspaceId: object.workspaceId ?? undefined,
      });
    }
    await ctx.db.patch(detectionId, { resolvedAt: Date.now(), requiresAttention: false });
  },
});

// ===========================================================================
// 29. Change Detections — Read
// ===========================================================================

/** Get unresolved change detections requiring attention. */
export const getAttentionRequired = query({
  args: {
    companyId: v.optional(v.id("founderCompanies")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit }) => {
    const cap = Math.min(limit ?? 20, 50);

    if (companyId) {
      await assertCompanyOwner(ctx, companyId);
      const all = await ctx.db
        .query("ambientChangeDetections")
        .withIndex("by_company", (q) => q.eq("companyId", companyId))
        .order("desc")
        .take(cap * 2);
      return all.filter((d) => d.requiresAttention).slice(0, cap);
    }

    const workspaceId = await getOwnedWorkspaceId(ctx);
    if (!workspaceId) return [];

    const companies = await ctx.db
      .query("founderCompanies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(100);

    const detections = await Promise.all(
      companies.map((company) =>
        ctx.db
          .query("ambientChangeDetections")
          .withIndex("by_company", (q) => q.eq("companyId", company._id))
          .order("desc")
          .take(cap),
      ),
    );

    return detections
      .flat()
      .filter((d) => d.requiresAttention)
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .slice(0, cap);
  },
});

// ===========================================================================
// 30. Packet Readiness — Write
// ===========================================================================

/** Update packet readiness after changes. */
export const updatePacketReadiness = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    packetType: v.string(),
    changesSinceLastGeneration: v.number(),
    readinessScore: v.number(),
    suggestedRegenerationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ambientPacketReadiness")
      .withIndex("by_company_type", (q) =>
        q.eq("companyId", args.companyId).eq("packetType", args.packetType as any),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        changesSinceLastGeneration: args.changesSinceLastGeneration,
        readinessScore: args.readinessScore,
        suggestedRegenerationReason: args.suggestedRegenerationReason,
        staleSince: args.readinessScore > 0.5 ? (existing.staleSince ?? now) : undefined,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("ambientPacketReadiness", {
      companyId: args.companyId,
      packetType: args.packetType as any,
      changesSinceLastGeneration: args.changesSinceLastGeneration,
      readinessScore: args.readinessScore,
      suggestedRegenerationReason: args.suggestedRegenerationReason,
      staleSince: args.readinessScore > 0.5 ? now : undefined,
      updatedAt: now,
    });
  },
});

/** Mark a packet as freshly generated. */
export const markPacketGenerated = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    packetType: v.string(),
  },
  handler: async (ctx, { companyId, packetType }) => {
    await assertCompanyOwner(ctx, companyId);
    const existing = await ctx.db
      .query("ambientPacketReadiness")
      .withIndex("by_company_type", (q) =>
        q.eq("companyId", companyId).eq("packetType", packetType as any),
      )
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastGeneratedAt: now,
        staleSince: undefined,
        changesSinceLastGeneration: 0,
        readinessScore: 0,
        suggestedRegenerationReason: undefined,
        updatedAt: now,
      });
    }
  },
});

// ===========================================================================
// 30. Packet Readiness — Read
// ===========================================================================

/** Get packet readiness for all types for a company. */
export const getPacketReadiness = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("ambientPacketReadiness")
      .withIndex("by_company_type", (q) => q.eq("companyId", companyId))
      .take(10);
  },
});

// ===========================================================================
// Session Delta — "Since Your Last Session"
// ===========================================================================

/** Compute what changed since the user's last session. */
export const getSessionDelta = query({
  args: {
    companyId: v.id("founderCompanies"),
    lastSessionEnd: v.number(), // epoch ms
  },
  handler: async (ctx, { companyId, lastSessionEnd }) => {
    await assertCompanyOwner(ctx, companyId);
    // Get new canonical objects since last session
    const newObjects = await ctx.db
      .query("ambientCanonicalObjects")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(100);

    const recentObjects = newObjects.filter((o) => o.extractedAt > lastSessionEnd && o.isLatest);

    // Group by type
    const strategyShifts = recentObjects.filter((o) =>
      o.objectType === "thesis" || o.objectType === "decision" || o.objectType === "strategic_insight",
    );
    const competitorSignals = recentObjects.filter((o) =>
      o.objectType === "competitor_signal" || o.objectType === "market_signal",
    );
    const buildItems = recentObjects.filter((o) =>
      o.objectType === "build_item" || o.objectType === "initiative_update",
    );
    const contradictions = recentObjects.filter((o) => o.objectType === "contradiction");
    const risks = recentObjects.filter((o) => o.objectType === "risk");
    const opportunities = recentObjects.filter((o) => o.objectType === "opportunity");

    // Get unresolved change detections
    const changeDetections = await ctx.db
      .query("ambientChangeDetections")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(50);

    const attentionRequired = changeDetections.filter((d) => d.requiresAttention);
    const recentDetections = changeDetections.filter((d) => d.detectedAt > lastSessionEnd);

    // Get packet readiness
    const packets = await ctx.db
      .query("ambientPacketReadiness")
      .withIndex("by_company_type", (q) => q.eq("companyId", companyId))
      .take(10);

    const stalePackets = packets.filter((p) => p.readinessScore > 0.5);

    // Get recent events from event ledger
    const recentEvents = await ctx.db
      .query("founderEventLedger")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(50);

    const eventsSinceLastSession = recentEvents.filter((e) => e.createdAt > lastSessionEnd);

    return {
      sinceTimestamp: lastSessionEnd,
      totalChanges: recentObjects.length,
      strategyShifts: strategyShifts.map((o) => ({ title: o.title, content: o.content, confidence: o.confidence, type: o.objectType })),
      competitorSignals: competitorSignals.map((o) => ({ title: o.title, content: o.content, confidence: o.confidence })),
      buildItems: buildItems.map((o) => ({ title: o.title, content: o.content, type: o.objectType })),
      contradictions: contradictions.map((o) => ({ title: o.title, content: o.content, confidence: o.confidence })),
      risks: risks.map((o) => ({ title: o.title, content: o.content, confidence: o.confidence })),
      opportunities: opportunities.map((o) => ({ title: o.title, content: o.content, confidence: o.confidence })),
      attentionRequired: attentionRequired.length,
      recentDetections: recentDetections.length,
      stalePackets: stalePackets.map((p) => ({
        type: p.packetType,
        changeCount: p.changesSinceLastGeneration,
        readiness: p.readinessScore,
        reason: p.suggestedRegenerationReason,
      })),
      eventsSinceLastSession: eventsSinceLastSession.length,
    };
  },
});
