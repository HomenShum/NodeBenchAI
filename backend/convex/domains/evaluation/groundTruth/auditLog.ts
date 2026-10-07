// convex/domains/groundTruth/auditLog.ts
// Audit logging for ground truth mutations

import { v } from "convex/values";
import { internalMutation, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

export type AuditAction =
  | "created"
  | "submitted_for_review"
  | "approved"
  | "rejected"
  | "superseded"
  | "rollback";

export interface AuditEntry {
  _id: Id<"groundTruthAuditLog">;
  versionId: Id<"groundTruthVersions">;
  entityKey: string;
  action: AuditAction;
  actorId: Id<"users">;
  reason?: string;
  metadata?: any;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* INTERNAL MUTATIONS                                                  */
/* ------------------------------------------------------------------ */

/**
 * Record an audit action (internal only)
 */
export const recordAction = internalMutation({
  args: {
    versionId: v.id("groundTruthVersions"),
    entityKey: v.string(),
    action: v.union(
      v.literal("created"),
      v.literal("submitted_for_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("superseded"),
      v.literal("rollback")
    ),
    actorId: v.id("users"),
    reason: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("groundTruthAuditLog"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("groundTruthAuditLog", {
      versionId: args.versionId,
      entityKey: args.entityKey,
      action: args.action,
      actorId: args.actorId,
      reason: args.reason,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

/* ------------------------------------------------------------------ */
/* QUERIES                                                             */
/* ------------------------------------------------------------------ */

/**
 * Get audit log for a specific version
 */
export const getLogForVersion = query({
  args: {
    versionId: v.id("groundTruthVersions"),
  },
  returns: v.array(
    v.object({
      _id: v.id("groundTruthAuditLog"),
      action: v.string(),
      actorId: v.id("users"),
      reason: v.optional(v.string()),
      metadata: v.optional(v.any()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("groundTruthAuditLog")
      .withIndex("by_version", (q) => q.eq("versionId", args.versionId))
      .order("asc")
      .collect();

    return logs.map((log) => ({
      _id: log._id,
      action: log.action,
      actorId: log.actorId,
      reason: log.reason,
      metadata: log.metadata,
      createdAt: log.createdAt,
    }));
  },
});

/**
 * Get audit log for an entity (all versions)
 */
export const getLogForEntity = query({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("groundTruthAuditLog"),
      versionId: v.id("groundTruthVersions"),
      action: v.string(),
      actorId: v.id("users"),
      reason: v.optional(v.string()),
      metadata: v.optional(v.any()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("groundTruthAuditLog")
      .withIndex("by_entity", (q) => q.eq("entityKey", args.entityKey))
      .order("desc")
      .take(args.limit ?? 100);

    return logs.map((log) => ({
      _id: log._id,
      versionId: log.versionId,
      action: log.action,
      actorId: log.actorId,
      reason: log.reason,
      metadata: log.metadata,
      createdAt: log.createdAt,
    }));
  },
});

/**
 * Get audit log by actor (for compliance/admin)
 */
export const getLogByActor = query({
  args: {
    actorId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("groundTruthAuditLog"),
      versionId: v.id("groundTruthVersions"),
      entityKey: v.string(),
      action: v.string(),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("groundTruthAuditLog")
      .withIndex("by_actor", (q) => q.eq("actorId", args.actorId))
      .order("desc")
      .take(args.limit ?? 100);

    return logs.map((log) => ({
      _id: log._id,
      versionId: log.versionId,
      entityKey: log.entityKey,
      action: log.action,
      reason: log.reason,
      createdAt: log.createdAt,
    }));
  },
});

/**
 * Get recent audit activity (for admin dashboard)
 */
export const getRecentActivity = query({
  args: {
    limit: v.optional(v.number()),
    sinceTimestamp: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("groundTruthAuditLog"),
      versionId: v.id("groundTruthVersions"),
      entityKey: v.string(),
      action: v.string(),
      actorId: v.id("users"),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    let logsQuery = ctx.db.query("groundTruthAuditLog").order("desc");

    if (args.sinceTimestamp) {
      logsQuery = logsQuery.filter((q) =>
        q.gt(q.field("createdAt"), args.sinceTimestamp!)
      );
    }

    const logs = await logsQuery.take(args.limit ?? 50);

    return logs.map((log) => ({
      _id: log._id,
      versionId: log.versionId,
      entityKey: log.entityKey,
      action: log.action,
      actorId: log.actorId,
      reason: log.reason,
      createdAt: log.createdAt,
    }));
  },
});

/**
 * Count actions by type for an entity (for statistics)
 */
export const getActionStats = query({
  args: {
    entityKey: v.string(),
  },
  returns: v.object({
    total: v.number(),
    byAction: v.object({
      created: v.number(),
      submitted_for_review: v.number(),
      approved: v.number(),
      rejected: v.number(),
      superseded: v.number(),
      rollback: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("groundTruthAuditLog")
      .withIndex("by_entity", (q) => q.eq("entityKey", args.entityKey))
      .collect();

    const stats = {
      created: 0,
      submitted_for_review: 0,
      approved: 0,
      rejected: 0,
      superseded: 0,
      rollback: 0,
    };

    for (const log of logs) {
      if (log.action in stats) {
        stats[log.action as keyof typeof stats]++;
      }
    }

    return {
      total: logs.length,
      byAction: stats,
    };
  },
});
