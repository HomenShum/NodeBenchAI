/**
 * Author Trust Scoring & Rate Limiting System
 *
 * Abuse resistance through trust-based access control.
 * Prevents spam, brigading, and sybil attacks.
 *
 * Trust tiers:
 * - verified: High trust, bypass quarantine
 * - established: Normal trust, standard limits
 * - new: New author, extra scrutiny
 * - quarantined: Flagged, manual review required
 * - banned: Cannot post
 *
 * Industry standard patterns:
 * - Reddit karma system
 * - Stack Overflow reputation
 * - Wikipedia editor trust levels
 *
 * @module domains/narrative/guards/trustScoring
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

export type TrustTier =
  | "verified"
  | "established"
  | "new"
  | "quarantined"
  | "banned";

export interface TrustProfile {
  authorId: string;
  authorType: "agent" | "human";
  trustScore: number;
  tier: TrustTier;
  postsLast24h: number;
  postsLimit24h: number;
  flagCount: number;
  injectionAttempts: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  remainingPosts: number;
  resetAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITS BY TIER
// ═══════════════════════════════════════════════════════════════════════════

export const RATE_LIMITS: Record<TrustTier, { postsPerDay: number; repliesPerDay: number }> = {
  verified: { postsPerDay: 100, repliesPerDay: 500 },
  established: { postsPerDay: 20, repliesPerDay: 100 },
  new: { postsPerDay: 5, repliesPerDay: 20 },
  quarantined: { postsPerDay: 0, repliesPerDay: 0 },
  banned: { postsPerDay: 0, repliesPerDay: 0 },
};

/**
 * Trust score thresholds for tier promotion/demotion.
 */
export const TRUST_THRESHOLDS = {
  verifiedMin: 0.9,
  establishedMin: 0.5,
  newMin: 0.2,
  quarantineThreshold: 0.1,
};

/**
 * Actions that affect trust score.
 */
export const TRUST_SCORE_IMPACTS = {
  postVerified: 0.05,
  postRejected: -0.1,
  disputeWon: 0.03,
  disputeLost: -0.05,
  flagged: -0.15,
  injectionAttempt: -0.3,
  correctionAccepted: 0.02,
};

// ═══════════════════════════════════════════════════════════════════════════
// TRUST PROFILE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get trust profile for an author.
 * Creates one if it doesn't exist.
 */
export const getTrustProfile = internalQuery({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("authorTrust"),
      authorId: v.string(),
      authorType: v.union(v.literal("agent"), v.literal("human")),
      trustScore: v.number(),
      tier: v.union(
        v.literal("verified"),
        v.literal("established"),
        v.literal("new"),
        v.literal("quarantined"),
        v.literal("banned")
      ),
      postsLast24h: v.number(),
      postsLimit24h: v.number(),
      lastPostAt: v.optional(v.number()),
      flagCount: v.number(),
      lastFlaggedAt: v.optional(v.number()),
      injectionAttempts: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", args.authorType).eq("authorId", args.authorId)
      )
      .first();
  },
});

/**
 * Get all quarantined authors.
 */
export const getQuarantinedAuthors = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("authorTrust"),
      authorId: v.string(),
      authorType: v.string(),
      trustScore: v.number(),
      flagCount: v.number(),
      injectionAttempts: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    const quarantined = await ctx.db
      .query("authorTrust")
      .withIndex("by_quarantined", (q) => q.eq("tier", "quarantined"))
      .take(limit);

    return quarantined.map((a) => ({
      _id: a._id,
      authorId: a.authorId,
      authorType: a.authorType,
      trustScore: a.trustScore,
      flagCount: a.flagCount,
      injectionAttempts: a.injectionAttempts,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TRUST PROFILE MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize trust profile for a new author.
 */
export const initializeTrustProfile = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    initialTier: v.optional(
      v.union(
        v.literal("verified"),
        v.literal("established"),
        v.literal("new"),
        v.literal("quarantined"),
        v.literal("banned")
      )
    ),
  },
  returns: v.id("authorTrust"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if already exists
    const existing = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", args.authorType).eq("authorId", args.authorId)
      )
      .first();

    if (existing) {
      return existing._id;
    }

    // Agents start as established, humans start as new
    const defaultTier: TrustTier =
      args.initialTier || (args.authorType === "agent" ? "established" : "new");

    const defaultScore =
      defaultTier === "verified"
        ? 0.95
        : defaultTier === "established"
          ? 0.6
          : 0.3;

    return await ctx.db.insert("authorTrust", {
      authorId: args.authorId,
      authorType: args.authorType,
      trustScore: defaultScore,
      tier: defaultTier,
      postsLast24h: 0,
      postsLimit24h: RATE_LIMITS[defaultTier].postsPerDay,
      flagCount: 0,
      injectionAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update trust score based on an action.
 */
export const updateTrustScore = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    action: v.union(
      v.literal("post_verified"),
      v.literal("post_rejected"),
      v.literal("dispute_won"),
      v.literal("dispute_lost"),
      v.literal("flagged"),
      v.literal("injection_attempt"),
      v.literal("correction_accepted")
    ),
    details: v.optional(v.string()),
  },
  returns: v.object({
    newScore: v.number(),
    newTier: v.string(),
    tierChanged: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    let profile = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", args.authorType).eq("authorId", args.authorId)
      )
      .first();

    // Create profile if doesn't exist
    if (!profile) {
      const profileId = await ctx.runMutation(
        internal.domains.narrative.guards.trustScoring.initializeTrustProfile,
        {
          authorId: args.authorId,
          authorType: args.authorType,
        }
      );
      profile = await ctx.db.get(profileId);
      if (!profile) {
        throw new Error("Failed to create trust profile");
      }
    }

    // Calculate score impact
    let impact = 0;
    const updates: Record<string, any> = { updatedAt: now };

    switch (args.action) {
      case "post_verified":
        impact = TRUST_SCORE_IMPACTS.postVerified;
        break;
      case "post_rejected":
        impact = TRUST_SCORE_IMPACTS.postRejected;
        break;
      case "dispute_won":
        impact = TRUST_SCORE_IMPACTS.disputeWon;
        break;
      case "dispute_lost":
        impact = TRUST_SCORE_IMPACTS.disputeLost;
        break;
      case "flagged":
        impact = TRUST_SCORE_IMPACTS.flagged;
        updates.flagCount = profile.flagCount + 1;
        updates.lastFlaggedAt = now;
        break;
      case "injection_attempt":
        impact = TRUST_SCORE_IMPACTS.injectionAttempt;
        updates.injectionAttempts = profile.injectionAttempts + 1;
        break;
      case "correction_accepted":
        impact = TRUST_SCORE_IMPACTS.correctionAccepted;
        break;
    }

    // Apply score change (clamp to 0-1)
    const newScore = Math.max(0, Math.min(1, profile.trustScore + impact));
    updates.trustScore = newScore;

    // Determine new tier
    let newTier: TrustTier;
    if (newScore >= TRUST_THRESHOLDS.verifiedMin) {
      newTier = "verified";
    } else if (newScore >= TRUST_THRESHOLDS.establishedMin) {
      newTier = "established";
    } else if (newScore >= TRUST_THRESHOLDS.newMin) {
      newTier = "new";
    } else if (newScore >= TRUST_THRESHOLDS.quarantineThreshold) {
      newTier = "quarantined";
    } else {
      newTier = "banned";
    }

    const tierChanged = newTier !== profile.tier;
    if (tierChanged) {
      updates.tier = newTier;
      updates.postsLimit24h = RATE_LIMITS[newTier].postsPerDay;
    }

    await ctx.db.patch(profile._id, updates);

    console.log(
      `[TrustScoring] ${args.authorId} (${args.authorType}): ` +
        `${args.action} → score ${newScore.toFixed(2)}, tier ${newTier}` +
        (tierChanged ? " (TIER CHANGED)" : "")
    );

    return {
      newScore,
      newTier,
      tierChanged,
    };
  },
});

/**
 * Record a post and check rate limits.
 */
export const recordPost = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    remainingPosts: v.number(),
    resetAt: v.number(),
  }),
  handler: async (ctx, args): Promise<RateLimitResult> => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    let profile = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", args.authorType).eq("authorId", args.authorId)
      )
      .first();

    // Create profile if doesn't exist
    if (!profile) {
      const profileId = await ctx.runMutation(
        internal.domains.narrative.guards.trustScoring.initializeTrustProfile,
        {
          authorId: args.authorId,
          authorType: args.authorType,
        }
      );
      profile = await ctx.db.get(profileId);
      if (!profile) {
        return {
          allowed: false,
          reason: "Failed to create trust profile",
          remainingPosts: 0,
          resetAt: now + 24 * 60 * 60 * 1000,
        };
      }
    }

    // Check if banned or quarantined
    if (profile.tier === "banned" || profile.tier === "quarantined") {
      return {
        allowed: false,
        reason: `Author is ${profile.tier}`,
        remainingPosts: 0,
        resetAt: now + 24 * 60 * 60 * 1000,
      };
    }

    // Reset counter if last post was > 24h ago
    let postsLast24h = profile.postsLast24h;
    if (profile.lastPostAt && profile.lastPostAt < oneDayAgo) {
      postsLast24h = 0;
    }

    // Check rate limit
    const limit = RATE_LIMITS[profile.tier].postsPerDay;
    if (postsLast24h >= limit) {
      return {
        allowed: false,
        reason: `Rate limit exceeded (${limit} posts/day for ${profile.tier} tier)`,
        remainingPosts: 0,
        resetAt: (profile.lastPostAt || now) + 24 * 60 * 60 * 1000,
      };
    }

    // Record the post
    await ctx.db.patch(profile._id, {
      postsLast24h: postsLast24h + 1,
      lastPostAt: now,
      updatedAt: now,
    });

    return {
      allowed: true,
      remainingPosts: limit - postsLast24h - 1,
      resetAt: now + 24 * 60 * 60 * 1000,
    };
  },
});

/**
 * Manually set author tier (admin action).
 */
export const setAuthorTier = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    newTier: v.union(
      v.literal("verified"),
      v.literal("established"),
      v.literal("new"),
      v.literal("quarantined"),
      v.literal("banned")
    ),
    reason: v.string(),
    setBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const profile = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", args.authorType).eq("authorId", args.authorId)
      )
      .first();

    if (!profile) {
      return false;
    }

    await ctx.db.patch(profile._id, {
      tier: args.newTier,
      postsLimit24h: RATE_LIMITS[args.newTier].postsPerDay,
      updatedAt: now,
    });

    console.log(
      `[TrustScoring] Admin action: ${args.authorId} tier set to ${args.newTier} ` +
        `by ${args.setBy}. Reason: ${args.reason}`
    );

    return true;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMIT CHECKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if author can post (without recording).
 */
export const canAuthorPost = internalQuery({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  returns: v.object({
    canPost: v.boolean(),
    reason: v.optional(v.string()),
    tier: v.string(),
    postsRemaining: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const profile = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", args.authorType).eq("authorId", args.authorId)
      )
      .first();

    if (!profile) {
      // New author - allow with new tier limits
      return {
        canPost: true,
        tier: "new",
        postsRemaining: RATE_LIMITS.new.postsPerDay,
      };
    }

    if (profile.tier === "banned" || profile.tier === "quarantined") {
      return {
        canPost: false,
        reason: `Author is ${profile.tier}`,
        tier: profile.tier,
        postsRemaining: 0,
      };
    }

    // Check rate limit
    let postsLast24h = profile.postsLast24h;
    if (profile.lastPostAt && profile.lastPostAt < oneDayAgo) {
      postsLast24h = 0;
    }

    const limit = RATE_LIMITS[profile.tier].postsPerDay;
    const remaining = Math.max(0, limit - postsLast24h);

    if (remaining === 0) {
      return {
        canPost: false,
        reason: `Rate limit exceeded (${limit} posts/day)`,
        tier: profile.tier,
        postsRemaining: 0,
      };
    }

    return {
      canPost: true,
      tier: profile.tier,
      postsRemaining: remaining,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TRUST STATS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get trust statistics.
 */
export const getTrustStats = internalQuery({
  args: {},
  returns: v.object({
    totalAuthors: v.number(),
    byTier: v.object({
      verified: v.number(),
      established: v.number(),
      new: v.number(),
      quarantined: v.number(),
      banned: v.number(),
    }),
    totalFlags: v.number(),
    totalInjectionAttempts: v.number(),
  }),
  handler: async (ctx) => {
    const allProfiles = await ctx.db.query("authorTrust").collect();

    const stats = {
      totalAuthors: allProfiles.length,
      byTier: {
        verified: 0,
        established: 0,
        new: 0,
        quarantined: 0,
        banned: 0,
      },
      totalFlags: 0,
      totalInjectionAttempts: 0,
    };

    for (const profile of allProfiles) {
      stats.byTier[profile.tier]++;
      stats.totalFlags += profile.flagCount;
      stats.totalInjectionAttempts += profile.injectionAttempts;
    }

    return stats;
  },
});
