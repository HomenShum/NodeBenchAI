// convex/domains/groundTruth/versions.ts
// Ground truth version lifecycle management with two-person review

import { v } from "convex/values";
import { mutation, query, internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id, Doc } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

export type GroundTruthStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "superseded"
  | "rejected";

export interface VersionSummary {
  _id: Id<"groundTruthVersions">;
  entityKey: string;
  version: number;
  status: GroundTruthStatus;
  authorId: Id<"users">;
  reviewerId?: Id<"users">;
  changeNote: string;
  createdAt: number;
  approvedAt?: number;
}

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

/**
 * Get the next version number for an entity
 */
async function getNextVersionNumber(
  ctx: any,
  entityKey: string
): Promise<number> {
  const latestVersion = await ctx.db
    .query("groundTruthVersions")
    .withIndex("by_entity_version", (q: any) => q.eq("entityKey", entityKey))
    .order("desc")
    .first();

  return latestVersion ? latestVersion.version + 1 : 1;
}

/**
 * Get current approved version for an entity
 */
async function getCurrentApprovedVersion(
  ctx: any,
  entityKey: string
): Promise<Doc<"groundTruthVersions"> | null> {
  return await ctx.db
    .query("groundTruthVersions")
    .withIndex("by_entity_status", (q: any) =>
      q.eq("entityKey", entityKey).eq("status", "approved")
    )
    .first();
}

/* ------------------------------------------------------------------ */
/* QUERIES                                                             */
/* ------------------------------------------------------------------ */

/**
 * Get a specific version by ID
 */
export const getVersion = query({
  args: {
    versionId: v.id("groundTruthVersions"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("groundTruthVersions"),
      entityKey: v.string(),
      version: v.number(),
      status: v.string(),
      snapshotArtifactId: v.id("sourceArtifacts"),
      snapshotHash: v.string(),
      authorId: v.id("users"),
      reviewerId: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      changeNote: v.string(),
      previousVersionId: v.optional(v.id("groundTruthVersions")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return null;

    return {
      _id: version._id,
      entityKey: version.entityKey,
      version: version.version,
      status: version.status,
      snapshotArtifactId: version.snapshotArtifactId,
      snapshotHash: version.snapshotHash,
      authorId: version.authorId,
      reviewerId: version.reviewerId,
      approvedAt: version.approvedAt,
      changeNote: version.changeNote,
      previousVersionId: version.previousVersionId,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
    };
  },
});

/**
 * Get all versions for an entity
 */
export const getVersionsForEntity = query({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("groundTruthVersions"),
      version: v.number(),
      status: v.string(),
      authorId: v.id("users"),
      reviewerId: v.optional(v.id("users")),
      changeNote: v.string(),
      createdAt: v.number(),
      approvedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const versions = await ctx.db
      .query("groundTruthVersions")
      .withIndex("by_entity_version", (q) => q.eq("entityKey", args.entityKey))
      .order("desc")
      .take(args.limit ?? 20);

    return versions.map((v) => ({
      _id: v._id,
      version: v.version,
      status: v.status,
      authorId: v.authorId,
      reviewerId: v.reviewerId,
      changeNote: v.changeNote,
      createdAt: v.createdAt,
      approvedAt: v.approvedAt,
    }));
  },
});

/**
 * Get the current approved version for an entity
 */
export const getCurrentVersion = query({
  args: {
    entityKey: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("groundTruthVersions"),
      version: v.number(),
      status: v.string(),
      snapshotArtifactId: v.id("sourceArtifacts"),
      snapshotHash: v.string(),
      authorId: v.id("users"),
      reviewerId: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      changeNote: v.string(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const version = await ctx.db
      .query("groundTruthVersions")
      .withIndex("by_entity_status", (q) =>
        q.eq("entityKey", args.entityKey).eq("status", "approved")
      )
      .first();

    if (!version) return null;

    return {
      _id: version._id,
      version: version.version,
      status: version.status,
      snapshotArtifactId: version.snapshotArtifactId,
      snapshotHash: version.snapshotHash,
      authorId: version.authorId,
      reviewerId: version.reviewerId,
      approvedAt: version.approvedAt,
      changeNote: version.changeNote,
      createdAt: version.createdAt,
    };
  },
});

/**
 * Get versions pending review (for reviewer dashboard)
 */
export const getPendingReviewVersions = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("groundTruthVersions"),
      entityKey: v.string(),
      version: v.number(),
      authorId: v.id("users"),
      changeNote: v.string(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const versions = await ctx.db
      .query("groundTruthVersions")
      .filter((q) => q.eq(q.field("status"), "pending_review"))
      .order("desc")
      .take(args.limit ?? 50);

    return versions.map((v) => ({
      _id: v._id,
      entityKey: v.entityKey,
      version: v.version,
      authorId: v.authorId,
      changeNote: v.changeNote,
      createdAt: v.createdAt,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* MUTATIONS - Version Lifecycle                                       */
/* ------------------------------------------------------------------ */

/**
 * Create a new draft version
 */
export const createVersion = mutation({
  args: {
    entityKey: v.string(),
    snapshotArtifactId: v.id("sourceArtifacts"),
    snapshotHash: v.string(),
    authorId: v.id("users"),
    changeNote: v.string(),
  },
  returns: v.id("groundTruthVersions"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const nextVersion = await getNextVersionNumber(ctx, args.entityKey);

    // Get current approved version as previous
    const currentApproved = await getCurrentApprovedVersion(ctx, args.entityKey);

    const versionId = await ctx.db.insert("groundTruthVersions", {
      entityKey: args.entityKey,
      version: nextVersion,
      status: "draft",
      snapshotArtifactId: args.snapshotArtifactId,
      snapshotHash: args.snapshotHash,
      authorId: args.authorId,
      changeNote: args.changeNote,
      previousVersionId: currentApproved?._id,
      createdAt: now,
      updatedAt: now,
    });

    // Record audit log
    await ctx.runMutation(internal.domains.groundTruth.auditLog.recordAction, {
      versionId,
      entityKey: args.entityKey,
      action: "created",
      actorId: args.authorId,
      reason: args.changeNote,
    });

    return versionId;
  },
});

/**
 * Submit draft for review
 */
export const submitForReview = mutation({
  args: {
    versionId: v.id("groundTruthVersions"),
    actorId: v.id("users"),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) {
      return { success: false, error: "Version not found" };
    }

    if (version.status !== "draft") {
      return { success: false, error: `Cannot submit from status: ${version.status}` };
    }

    // Only author can submit for review
    if (version.authorId !== args.actorId) {
      return { success: false, error: "Only the author can submit for review" };
    }

    await ctx.db.patch(args.versionId, {
      status: "pending_review",
      updatedAt: Date.now(),
    });

    // Record audit log
    await ctx.runMutation(internal.domains.groundTruth.auditLog.recordAction, {
      versionId: args.versionId,
      entityKey: version.entityKey,
      action: "submitted_for_review",
      actorId: args.actorId,
    });

    return { success: true };
  },
});

/**
 * Approve a version (requires different reviewer than author)
 */
export const approve = mutation({
  args: {
    versionId: v.id("groundTruthVersions"),
    reviewerId: v.id("users"),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) {
      return { success: false, error: "Version not found" };
    }

    if (version.status !== "pending_review") {
      return { success: false, error: `Cannot approve from status: ${version.status}` };
    }

    // Two-person rule: reviewer must be different from author
    if (version.authorId === args.reviewerId) {
      return { success: false, error: "Reviewer cannot be the same as author (two-person rule)" };
    }

    const now = Date.now();

    // Supersede the current approved version if exists
    const currentApproved = await getCurrentApprovedVersion(ctx, version.entityKey);
    if (currentApproved) {
      await ctx.db.patch(currentApproved._id, {
        status: "superseded",
        updatedAt: now,
      });

      // Record supersede audit
      await ctx.runMutation(internal.domains.groundTruth.auditLog.recordAction, {
        versionId: currentApproved._id,
        entityKey: version.entityKey,
        action: "superseded",
        actorId: args.reviewerId,
        reason: `Superseded by version ${version.version}`,
        metadata: { newVersionId: args.versionId },
      });
    }

    // Approve the new version
    await ctx.db.patch(args.versionId, {
      status: "approved",
      reviewerId: args.reviewerId,
      approvedAt: now,
      updatedAt: now,
    });

    // Record approval audit
    await ctx.runMutation(internal.domains.groundTruth.auditLog.recordAction, {
      versionId: args.versionId,
      entityKey: version.entityKey,
      action: "approved",
      actorId: args.reviewerId,
      reason: args.reason,
    });

    return { success: true };
  },
});

/**
 * Reject a version
 */
export const reject = mutation({
  args: {
    versionId: v.id("groundTruthVersions"),
    reviewerId: v.id("users"),
    reason: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) {
      return { success: false, error: "Version not found" };
    }

    if (version.status !== "pending_review") {
      return { success: false, error: `Cannot reject from status: ${version.status}` };
    }

    await ctx.db.patch(args.versionId, {
      status: "rejected",
      reviewerId: args.reviewerId,
      updatedAt: Date.now(),
    });

    // Record rejection audit
    await ctx.runMutation(internal.domains.groundTruth.auditLog.recordAction, {
      versionId: args.versionId,
      entityKey: version.entityKey,
      action: "rejected",
      actorId: args.reviewerId,
      reason: args.reason,
    });

    return { success: true };
  },
});

/**
 * Rollback to a previous approved version
 */
export const rollback = mutation({
  args: {
    entityKey: v.string(),
    targetVersionId: v.id("groundTruthVersions"),
    actorId: v.id("users"),
    reason: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    newVersionId: v.optional(v.id("groundTruthVersions")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get target version to rollback to
    const targetVersion = await ctx.db.get(args.targetVersionId);
    if (!targetVersion) {
      return { success: false, error: "Target version not found" };
    }

    if (targetVersion.entityKey !== args.entityKey) {
      return { success: false, error: "Target version is for a different entity" };
    }

    // Target must be a previously approved version
    if (targetVersion.status !== "superseded" && targetVersion.status !== "approved") {
      return { success: false, error: "Can only rollback to previously approved versions" };
    }

    const now = Date.now();

    // Supersede current approved version
    const currentApproved = await getCurrentApprovedVersion(ctx, args.entityKey);
    if (currentApproved) {
      await ctx.db.patch(currentApproved._id, {
        status: "superseded",
        updatedAt: now,
      });
    }

    // Create a new version that copies the target's snapshot
    const nextVersion = await getNextVersionNumber(ctx, args.entityKey);
    const newVersionId = await ctx.db.insert("groundTruthVersions", {
      entityKey: args.entityKey,
      version: nextVersion,
      status: "approved",
      snapshotArtifactId: targetVersion.snapshotArtifactId,
      snapshotHash: targetVersion.snapshotHash,
      authorId: args.actorId,
      reviewerId: args.actorId, // Rollbacks are self-reviewed for audit trail
      approvedAt: now,
      changeNote: `Rollback to version ${targetVersion.version}: ${args.reason}`,
      previousVersionId: currentApproved?._id,
      createdAt: now,
      updatedAt: now,
    });

    // Record rollback audit
    await ctx.runMutation(internal.domains.groundTruth.auditLog.recordAction, {
      versionId: newVersionId,
      entityKey: args.entityKey,
      action: "rollback",
      actorId: args.actorId,
      reason: args.reason,
      metadata: {
        rolledBackFromVersionId: currentApproved?._id,
        rolledBackToVersionId: args.targetVersionId,
        targetVersion: targetVersion.version,
      },
    });

    return { success: true, newVersionId };
  },
});

/**
 * Update a draft version (before submission)
 */
export const updateDraft = mutation({
  args: {
    versionId: v.id("groundTruthVersions"),
    snapshotArtifactId: v.id("sourceArtifacts"),
    snapshotHash: v.string(),
    changeNote: v.string(),
    actorId: v.id("users"),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) {
      return { success: false, error: "Version not found" };
    }

    if (version.status !== "draft") {
      return { success: false, error: "Can only update draft versions" };
    }

    if (version.authorId !== args.actorId) {
      return { success: false, error: "Only the author can update a draft" };
    }

    await ctx.db.patch(args.versionId, {
      snapshotArtifactId: args.snapshotArtifactId,
      snapshotHash: args.snapshotHash,
      changeNote: args.changeNote,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
