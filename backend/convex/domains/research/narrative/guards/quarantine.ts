/**
 * Content Quarantine System
 *
 * Holds content pending review before promotion to canon.
 * Implements quarantine-to-canon promotion rules.
 *
 * Key principle: Community evidence (tier3) can influence sentiment
 * but cannot update temporalFacts without tier1/2 corroboration.
 *
 * @module domains/narrative/guards/quarantine
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  internalAction,
} from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type QuarantineContentType = "post" | "reply" | "evidence" | "fact_update";

export type QuarantineReason =
  | "low_trust_author"
  | "injection_detected"
  | "rate_limit_exceeded"
  | "contested_claim"
  | "tier3_fact_update"
  | "manual_hold";

export type QuarantineStatus = "pending" | "approved" | "rejected" | "expired";

export interface QuarantineEntry {
  contentType: QuarantineContentType;
  contentId: string;
  threadId: Id<"narrativeThreads">;
  reason: QuarantineReason;
  reasonDetail?: string;
  status: QuarantineStatus;
  expiresAt: number;
  createdAt: number;
}

export interface PromotionEligibility {
  eligible: boolean;
  reason: string;
  requirements: string[];
  corroborationStatus?: {
    hasTier1: boolean;
    hasTier2: boolean;
    sources: string[];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUARANTINE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get quarantine entry for content.
 */
export const getQuarantineEntry = internalQuery({
  args: {
    contentType: v.union(
      v.literal("post"),
      v.literal("reply"),
      v.literal("evidence"),
      v.literal("fact_update")
    ),
    contentId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("contentQuarantine"),
      contentType: v.string(),
      contentId: v.string(),
      threadId: v.id("narrativeThreads"),
      reason: v.string(),
      reasonDetail: v.optional(v.string()),
      status: v.string(),
      reviewedBy: v.optional(v.string()),
      reviewedAt: v.optional(v.number()),
      reviewNote: v.optional(v.string()),
      expiresAt: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contentQuarantine")
      .withIndex("by_content", (q) =>
        q.eq("contentType", args.contentType).eq("contentId", args.contentId)
      )
      .first();
  },
});

/**
 * Get pending quarantine entries for a thread.
 */
export const getPendingForThread = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("contentQuarantine"),
      contentType: v.string(),
      contentId: v.string(),
      reason: v.string(),
      reasonDetail: v.optional(v.string()),
      expiresAt: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    const entries = await ctx.db
      .query("contentQuarantine")
      .withIndex("by_thread", (q) =>
        q.eq("threadId", args.threadId).eq("status", "pending")
      )
      .take(limit);

    return entries.map((e) => ({
      _id: e._id,
      contentType: e.contentType,
      contentId: e.contentId,
      reason: e.reason,
      reasonDetail: e.reasonDetail,
      expiresAt: e.expiresAt,
      createdAt: e.createdAt,
    }));
  },
});

/**
 * Get all pending quarantine entries.
 */
export const getAllPending = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("contentQuarantine"),
      contentType: v.string(),
      contentId: v.string(),
      threadId: v.id("narrativeThreads"),
      reason: v.string(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 100;

    const entries = await ctx.db
      .query("contentQuarantine")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(limit);

    return entries.map((e) => ({
      _id: e._id,
      contentType: e.contentType,
      contentId: e.contentId,
      threadId: e.threadId,
      reason: e.reason,
      createdAt: e.createdAt,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUARANTINE MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quarantine content before it's persisted (flexible schema for policy enforcement).
 * Used when content fails guards and needs to be held for review before DB insert.
 */
export const quarantineContentPrePersist = internalMutation({
  args: {
    contentType: v.union(
      v.literal("post"),
      v.literal("reply"),
      v.literal("evidence"),
      v.literal("fact"),
      v.literal("fact_update")
    ),
    content: v.string(),
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    reason: v.union(
      v.literal("low_trust_author"),
      v.literal("injection_detected"),
      v.literal("rate_limit_exceeded"),
      v.literal("contested_claim"),
      v.literal("tier3_fact_update"),
      v.literal("manual_hold"),
      v.literal("policy_violation")
    ),
    metadata: v.optional(v.any()),
    expiryHours: v.optional(v.number()),
  },
  returns: v.id("contentQuarantine"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiryHours = args.expiryHours ?? 168; // 7 days default
    const expiresAt = now + expiryHours * 60 * 60 * 1000;

    // Generate a temporary content ID for pre-persist quarantine
    const contentId = `pre_${now}_${Math.random().toString(36).slice(2, 10)}`;

    // Create quarantine entry with flexible schema
    return await ctx.db.insert("contentQuarantine", {
      contentType: args.contentType === "fact" ? "fact_update" : args.contentType,
      contentId,
      // Use a placeholder threadId - will be updated if content is approved
      threadId: undefined as any, // Schema allows optional in practice
      reason: args.reason === "policy_violation" ? "manual_hold" : args.reason,
      reasonDetail: JSON.stringify({
        content: args.content.slice(0, 1000), // Store truncated content
        authorId: args.authorId,
        authorType: args.authorType,
        metadata: args.metadata,
      }),
      status: "pending",
      expiresAt,
      createdAt: now,
    });
  },
});

/**
 * Add content to quarantine (requires existing threadId).
 */
export const quarantineContent = internalMutation({
  args: {
    contentType: v.union(
      v.literal("post"),
      v.literal("reply"),
      v.literal("evidence"),
      v.literal("fact_update")
    ),
    contentId: v.string(),
    threadId: v.id("narrativeThreads"),
    reason: v.union(
      v.literal("low_trust_author"),
      v.literal("injection_detected"),
      v.literal("rate_limit_exceeded"),
      v.literal("contested_claim"),
      v.literal("tier3_fact_update"),
      v.literal("manual_hold")
    ),
    reasonDetail: v.optional(v.string()),
    expiryHours: v.optional(v.number()),
  },
  returns: v.id("contentQuarantine"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiryHours = args.expiryHours ?? 168; // 7 days default
    const expiresAt = now + expiryHours * 60 * 60 * 1000;

    // Check if already quarantined
    const existing = await ctx.db
      .query("contentQuarantine")
      .withIndex("by_content", (q) =>
        q.eq("contentType", args.contentType).eq("contentId", args.contentId)
      )
      .first();

    if (existing) {
      // Update existing entry
      await ctx.db.patch(existing._id, {
        reason: args.reason,
        reasonDetail: args.reasonDetail,
        status: "pending",
        expiresAt,
      });
      return existing._id;
    }

    // Create new entry
    return await ctx.db.insert("contentQuarantine", {
      contentType: args.contentType,
      contentId: args.contentId,
      threadId: args.threadId,
      reason: args.reason,
      reasonDetail: args.reasonDetail,
      status: "pending",
      expiresAt,
      createdAt: now,
    });
  },
});

/**
 * Approve quarantined content (promote to canon).
 */
export const approveQuarantined = internalMutation({
  args: {
    quarantineId: v.id("contentQuarantine"),
    reviewedBy: v.string(),
    reviewNote: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.quarantineId);
    if (!entry) return false;

    const now = Date.now();

    await ctx.db.patch(args.quarantineId, {
      status: "approved",
      reviewedBy: args.reviewedBy,
      reviewedAt: now,
      reviewNote: args.reviewNote,
    });

    console.log(
      `[Quarantine] Approved ${entry.contentType}:${entry.contentId} ` +
        `by ${args.reviewedBy}`
    );

    return true;
  },
});

/**
 * Reject quarantined content.
 */
export const rejectQuarantined = internalMutation({
  args: {
    quarantineId: v.id("contentQuarantine"),
    reviewedBy: v.string(),
    reviewNote: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.quarantineId);
    if (!entry) return false;

    const now = Date.now();

    await ctx.db.patch(args.quarantineId, {
      status: "rejected",
      reviewedBy: args.reviewedBy,
      reviewedAt: now,
      reviewNote: args.reviewNote,
    });

    console.log(
      `[Quarantine] Rejected ${entry.contentType}:${entry.contentId} ` +
        `by ${args.reviewedBy}: ${args.reviewNote}`
    );

    return true;
  },
});

/**
 * Expire old quarantine entries.
 */
export const expireOldEntries = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let expired = 0;

    const pendingEntries = await ctx.db
      .query("contentQuarantine")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    for (const entry of pendingEntries) {
      if (entry.expiresAt < now) {
        await ctx.db.patch(entry._id, {
          status: "expired",
        });
        expired++;
      }
    }

    if (expired > 0) {
      console.log(`[Quarantine] Expired ${expired} entries`);
    }

    return expired;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUARANTINE-TO-CANON PROMOTION RULES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if tier3 evidence can be promoted to affect temporalFacts.
 * Requires tier1 or tier2 corroboration.
 */
export const checkPromotionEligibility = internalAction({
  args: {
    evidenceArtifactId: v.string(),
    claimText: v.string(),
    threadId: v.id("narrativeThreads"),
  },
  returns: v.object({
    eligible: v.boolean(),
    reason: v.string(),
    requirements: v.array(v.string()),
    corroborationStatus: v.optional(
      v.object({
        hasTier1: v.boolean(),
        hasTier2: v.boolean(),
        sources: v.array(v.string()),
      })
    ),
  }),
  handler: async (ctx, args): Promise<PromotionEligibility> => {
    // Get the evidence artifact
    const artifact = await ctx.runQuery(
      internal.domains.narrative.mutations.evidence.getByArtifactId,
      { artifactId: args.evidenceArtifactId }
    );

    if (!artifact) {
      return {
        eligible: false,
        reason: "Evidence artifact not found",
        requirements: ["Valid evidence artifact required"],
      };
    }

    // Tier1/2 evidence can always be promoted
    if (
      artifact.credibilityTier === "tier1_primary" ||
      artifact.credibilityTier === "tier2_established"
    ) {
      return {
        eligible: true,
        reason: `${artifact.credibilityTier} evidence can be directly promoted`,
        requirements: [],
        corroborationStatus: {
          hasTier1: artifact.credibilityTier === "tier1_primary",
          hasTier2: artifact.credibilityTier === "tier2_established",
          sources: [artifact.publisher],
        },
      };
    }

    // Tier3 requires corroboration
    if (artifact.credibilityTier === "tier3_community") {
      // Search for corroborating tier1/tier2 evidence
      // This would search for other evidence with similar claims/entities

      // For now, check if there's any tier1/tier2 evidence in the thread
      // In production, would do semantic similarity search

      return {
        eligible: false,
        reason:
          "Tier3 (community) evidence requires tier1 or tier2 corroboration " +
          "to update temporal facts. It can influence sentiment scores.",
        requirements: [
          "Find corroborating tier1_primary source (wire service, official filing)",
          "Or find corroborating tier2_established source (major publication)",
        ],
        corroborationStatus: {
          hasTier1: false,
          hasTier2: false,
          sources: [],
        },
      };
    }

    // Tier4 cannot be promoted
    return {
      eligible: false,
      reason: "Tier4 (unverified) evidence cannot update temporal facts",
      requirements: [
        "Verify source credibility",
        "Upgrade to at least tier3 with verified community source",
      ],
    };
  },
});

/**
 * Check if content should be auto-quarantined.
 */
export const shouldQuarantine = internalAction({
  args: {
    contentType: v.union(
      v.literal("post"),
      v.literal("reply"),
      v.literal("evidence"),
      v.literal("fact_update")
    ),
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    content: v.string(),
    credibilityTier: v.optional(
      v.union(
        v.literal("tier1_primary"),
        v.literal("tier2_established"),
        v.literal("tier3_community"),
        v.literal("tier4_unverified")
      )
    ),
  },
  returns: v.object({
    shouldQuarantine: v.boolean(),
    reason: v.optional(v.string()),
    quarantineReason: v.optional(
      v.union(
        v.literal("low_trust_author"),
        v.literal("injection_detected"),
        v.literal("rate_limit_exceeded"),
        v.literal("contested_claim"),
        v.literal("tier3_fact_update"),
        v.literal("manual_hold")
      )
    ),
  }),
  handler: async (ctx, args) => {
    // Check author trust
    const trustProfile = await ctx.runQuery(
      internal.domains.narrative.guards.trustScoring.getTrustProfile,
      {
        authorId: args.authorId,
        authorType: args.authorType,
      }
    );

    // Low trust authors get quarantined
    if (trustProfile && trustProfile.tier === "quarantined") {
      return {
        shouldQuarantine: true,
        reason: "Author is in quarantine tier",
        quarantineReason: "low_trust_author",
      };
    }

    if (trustProfile && trustProfile.tier === "new") {
      // New authors' fact updates get quarantined
      if (args.contentType === "fact_update") {
        return {
          shouldQuarantine: true,
          reason: "New authors require review for fact updates",
          quarantineReason: "low_trust_author",
        };
      }
    }

    // Check for injection
    const injectionCheck = await ctx.runQuery(
      internal.domains.narrative.guards.injectionContainment.checkForInjections,
      { content: args.content }
    );

    if (
      injectionCheck.threatLevel === "critical" ||
      injectionCheck.threatLevel === "high"
    ) {
      return {
        shouldQuarantine: true,
        reason: `Injection detected: ${injectionCheck.threatLevel} threat level`,
        quarantineReason: "injection_detected",
      };
    }

    // Tier3 fact updates get quarantined
    if (
      args.contentType === "fact_update" &&
      args.credibilityTier === "tier3_community"
    ) {
      return {
        shouldQuarantine: true,
        reason: "Tier3 evidence cannot directly update facts without corroboration",
        quarantineReason: "tier3_fact_update",
      };
    }

    // No quarantine needed
    return {
      shouldQuarantine: false,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUARANTINE STATS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get quarantine statistics.
 */
export const getQuarantineStats = internalQuery({
  args: {},
  returns: v.object({
    total: v.number(),
    pending: v.number(),
    approved: v.number(),
    rejected: v.number(),
    expired: v.number(),
    byReason: v.array(
      v.object({
        reason: v.string(),
        count: v.number(),
      })
    ),
    byContentType: v.array(
      v.object({
        contentType: v.string(),
        count: v.number(),
      })
    ),
  }),
  handler: async (ctx) => {
    const allEntries = await ctx.db.query("contentQuarantine").collect();

    const stats = {
      total: allEntries.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      byReason: new Map<string, number>(),
      byContentType: new Map<string, number>(),
    };

    for (const entry of allEntries) {
      // Count by status
      switch (entry.status) {
        case "pending":
          stats.pending++;
          break;
        case "approved":
          stats.approved++;
          break;
        case "rejected":
          stats.rejected++;
          break;
        case "expired":
          stats.expired++;
          break;
      }

      // Count by reason
      const reasonCount = stats.byReason.get(entry.reason) || 0;
      stats.byReason.set(entry.reason, reasonCount + 1);

      // Count by content type
      const typeCount = stats.byContentType.get(entry.contentType) || 0;
      stats.byContentType.set(entry.contentType, typeCount + 1);
    }

    return {
      total: stats.total,
      pending: stats.pending,
      approved: stats.approved,
      rejected: stats.rejected,
      expired: stats.expired,
      byReason: Array.from(stats.byReason.entries()).map(([reason, count]) => ({
        reason,
        count,
      })),
      byContentType: Array.from(stats.byContentType.entries()).map(
        ([contentType, count]) => ({
          contentType,
          count,
        })
      ),
    };
  },
});
