/**
 * Narrative Dispute Chain Mutations
 *
 * CRUD operations for narrativeDisputeChains table.
 * Disputes track challenges to claims, alternative interpretations,
 * and resolution workflows for conflicting evidence.
 *
 * Implements HITL (Human-in-the-Loop) resolution pattern.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "../../../../_generated/dataModel";

/**
 * FNV-1a 32-bit hash for stable ID generation
 */
function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Target type validator
 */
const targetTypeValidator = v.union(
  v.literal("post"),
  v.literal("event"),
  v.literal("fact"),
  v.literal("claim")
);

/**
 * Dispute type validator
 */
const disputeTypeValidator = v.union(
  v.literal("factual_error"),
  v.literal("outdated"),
  v.literal("missing_context"),
  v.literal("alternative_interpretation")
);

/**
 * Status validator
 */
const statusValidator = v.union(
  v.literal("open"),
  v.literal("under_review"),
  v.literal("resolved_original"),
  v.literal("resolved_challenge"),
  v.literal("merged")
);

// ============================================================================
// PUBLIC MUTATIONS (User-facing, require auth)
// ============================================================================

/**
 * Create a new dispute against a post, event, fact, or claim
 */
export const createDispute = mutation({
  args: {
    targetType: targetTypeValidator,
    targetId: v.string(),
    disputeType: disputeTypeValidator,
    originalClaim: v.string(),
    challengeClaim: v.string(),
    evidenceArtifactIds: v.array(v.id("sourceArtifacts")),
  },
  returns: v.id("narrativeDisputeChains"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const now = Date.now();
    const disputeId = `nd_${fnv1a32Hex(args.targetId + args.challengeClaim + now)}`;

    return await ctx.db.insert("narrativeDisputeChains", {
      disputeId,
      targetType: args.targetType,
      targetId: args.targetId,
      disputeType: args.disputeType,
      originalClaim: args.originalClaim,
      challengeClaim: args.challengeClaim,
      evidenceForChallenge: args.evidenceArtifactIds,
      status: "open",
      resolution: undefined,
      resolvedBy: undefined,
      resolvedAt: undefined,
      raisedBy: userId,
      raisedAt: now,
      createdAt: now,
    });
  },
});

/**
 * Update dispute status (move to under_review)
 */
export const updateDisputeStatus = mutation({
  args: {
    disputeId: v.id("narrativeDisputeChains"),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const dispute = await ctx.db.get(args.disputeId);
    if (!dispute) throw new Error("Dispute not found");

    // Only allow status transitions that make sense
    const validTransitions: Record<string, string[]> = {
      open: ["under_review"],
      under_review: ["open", "resolved_original", "resolved_challenge", "merged"],
    };

    const currentStatus = dispute.status;
    if (!validTransitions[currentStatus]?.includes(args.status)) {
      throw new Error(`Cannot transition from ${currentStatus} to ${args.status}`);
    }

    await ctx.db.patch(args.disputeId, {
      status: args.status,
    });
  },
});

/**
 * Add evidence to an existing dispute
 */
export const addEvidenceToDispute = mutation({
  args: {
    disputeId: v.id("narrativeDisputeChains"),
    artifactIds: v.array(v.id("sourceArtifacts")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const dispute = await ctx.db.get(args.disputeId);
    if (!dispute) throw new Error("Dispute not found");

    // Can only add evidence to open or under_review disputes
    if (!["open", "under_review"].includes(dispute.status)) {
      throw new Error("Cannot add evidence to resolved disputes");
    }

    const updatedEvidence = [...dispute.evidenceForChallenge, ...args.artifactIds];
    await ctx.db.patch(args.disputeId, {
      evidenceForChallenge: updatedEvidence,
    });
  },
});

/**
 * Resolve a dispute (human adjudication)
 */
export const resolveDispute = mutation({
  args: {
    disputeId: v.id("narrativeDisputeChains"),
    resolution: v.union(
      v.literal("resolved_original"),
      v.literal("resolved_challenge"),
      v.literal("merged")
    ),
    resolutionNotes: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const dispute = await ctx.db.get(args.disputeId);
    if (!dispute) throw new Error("Dispute not found");

    if (!["open", "under_review"].includes(dispute.status)) {
      throw new Error("Dispute already resolved");
    }

    const now = Date.now();

    await ctx.db.patch(args.disputeId, {
      status: args.resolution,
      resolution: args.resolutionNotes,
      resolvedBy: userId,
      resolvedAt: now,
    });

    // If the dispute was against a post, update the post's status
    if (dispute.targetType === "post") {
      try {
        const post = await ctx.db.get(dispute.targetId as any);
        if (post) {
          const wasChallenge = args.resolution === "resolved_challenge";
          await ctx.db.patch(dispute.targetId as any, {
            hasContradictions: wasChallenge,
            isVerified: args.resolution === "resolved_original",
            requiresAdjudication: false,
            updatedAt: now,
          });
        }
      } catch {
        // Post may have been deleted, ignore
      }
    }
  },
});

/**
 * Reopen a resolved dispute
 */
export const reopenDispute = mutation({
  args: {
    disputeId: v.id("narrativeDisputeChains"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const dispute = await ctx.db.get(args.disputeId);
    if (!dispute) throw new Error("Dispute not found");

    if (dispute.status === "open" || dispute.status === "under_review") {
      throw new Error("Dispute is already open");
    }

    await ctx.db.patch(args.disputeId, {
      status: "open",
      resolution: `[Reopened: ${args.reason}] ${dispute.resolution || ""}`,
      resolvedBy: undefined,
      resolvedAt: undefined,
    });
  },
});

// ============================================================================
// INTERNAL MUTATIONS (Agent-facing, no auth required)
// ============================================================================

/**
 * Create a dispute from an agent (e.g., contradiction detector)
 */
export const createDisputeInternal = internalMutation({
  args: {
    targetType: targetTypeValidator,
    targetId: v.string(),
    disputeType: disputeTypeValidator,
    originalClaim: v.string(),
    challengeClaim: v.string(),
    evidenceArtifactIds: v.array(v.id("sourceArtifacts")),
    agentName: v.string(),
  },
  returns: v.id("narrativeDisputeChains"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const disputeId = `nd_${fnv1a32Hex(args.targetId + args.challengeClaim + now)}`;

    const newDisputeId = await ctx.db.insert("narrativeDisputeChains", {
      disputeId,
      targetType: args.targetType,
      targetId: args.targetId,
      disputeType: args.disputeType,
      originalClaim: args.originalClaim,
      challengeClaim: args.challengeClaim,
      evidenceForChallenge: args.evidenceArtifactIds,
      status: "open",
      resolution: undefined,
      resolvedBy: undefined,
      resolvedAt: undefined,
      raisedBy: `agent:${args.agentName}`,
      raisedAt: now,
      createdAt: now,
    });

    // If targeting a post, mark it as having contradictions
    if (args.targetType === "post") {
      try {
        await ctx.db.patch(args.targetId as any, {
          hasContradictions: true,
          requiresAdjudication: true,
          updatedAt: now,
        });
      } catch {
        // Post may not exist, ignore
      }
    }

    return newDisputeId;
  },
});

/**
 * Batch create disputes (for contradiction detector processing multiple conflicts)
 */
export const batchCreateDisputes = internalMutation({
  args: {
    disputes: v.array(
      v.object({
        targetType: targetTypeValidator,
        targetId: v.string(),
        disputeType: disputeTypeValidator,
        originalClaim: v.string(),
        challengeClaim: v.string(),
        evidenceArtifactIds: v.array(v.id("sourceArtifacts")),
      })
    ),
    agentName: v.string(),
  },
  returns: v.array(v.id("narrativeDisputeChains")),
  handler: async (ctx, args) => {
    const now = Date.now();
    const createdIds: any[] = [];

    for (const dispute of args.disputes) {
      const disputeId = `nd_${fnv1a32Hex(dispute.targetId + dispute.challengeClaim + now + createdIds.length)}`;

      const newId = await ctx.db.insert("narrativeDisputeChains", {
        disputeId,
        targetType: dispute.targetType,
        targetId: dispute.targetId,
        disputeType: dispute.disputeType,
        originalClaim: dispute.originalClaim,
        challengeClaim: dispute.challengeClaim,
        evidenceForChallenge: dispute.evidenceArtifactIds,
        status: "open",
        resolution: undefined,
        resolvedBy: undefined,
        resolvedAt: undefined,
        raisedBy: `agent:${args.agentName}`,
        raisedAt: now,
        createdAt: now,
      });

      createdIds.push(newId);

      // Mark target as having contradictions
      if (dispute.targetType === "post") {
        try {
          await ctx.db.patch(dispute.targetId as any, {
            hasContradictions: true,
            requiresAdjudication: true,
            updatedAt: now,
          });
        } catch {
          // Ignore
        }
      }
    }

    return createdIds;
  },
});

/**
 * Auto-resolve a dispute (for clear-cut cases)
 */
export const autoResolveDispute = internalMutation({
  args: {
    disputeId: v.id("narrativeDisputeChains"),
    resolution: v.union(
      v.literal("resolved_original"),
      v.literal("resolved_challenge")
    ),
    resolutionNotes: v.string(),
    agentName: v.string(),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    const dispute = await ctx.db.get(args.disputeId);
    if (!dispute) return;

    // Only auto-resolve if confidence is high enough
    if (args.confidence < 0.9) {
      console.warn(
        `[autoResolveDispute] Confidence ${args.confidence} too low for auto-resolve`
      );
      return;
    }

    const now = Date.now();

    await ctx.db.patch(args.disputeId, {
      status: args.resolution,
      resolution: `[Auto-resolved by ${args.agentName}, confidence: ${args.confidence}] ${args.resolutionNotes}`,
      resolvedBy: `agent:${args.agentName}`,
      resolvedAt: now,
    });

    // Update the target if it's a post
    if (dispute.targetType === "post") {
      try {
        const wasChallenge = args.resolution === "resolved_challenge";
        await ctx.db.patch(dispute.targetId as any, {
          hasContradictions: wasChallenge,
          isVerified: args.resolution === "resolved_original",
          requiresAdjudication: false,
          updatedAt: now,
        });
      } catch {
        // Ignore
      }
    }
  },
});

/**
 * Get disputes that need human review (for dashboard)
 */
export const getOpenDisputes = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("narrativeDisputeChains"),
      disputeId: v.string(),
      targetType: v.string(),
      disputeType: v.string(),
      originalClaim: v.string(),
      challengeClaim: v.string(),
      status: v.string(),
      raisedBy: v.string(),
      raisedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const disputes = await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(args.limit || 50);

    return disputes.map((d) => ({
      _id: d._id,
      disputeId: d.disputeId,
      targetType: d.targetType,
      disputeType: d.disputeType,
      originalClaim: d.originalClaim,
      challengeClaim: d.challengeClaim,
      status: d.status,
      raisedBy: d.raisedBy,
      raisedAt: d.raisedAt,
    }));
  },
});
