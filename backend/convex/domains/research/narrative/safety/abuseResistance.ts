/**
 * Abuse Resistance System
 *
 * Provides defense against:
 * - Spam / brigading / sybil attacks
 * - Prompt injection via user content
 * - Content poisoning of timeline memory
 *
 * Implements:
 * - Trust scoring for authors
 * - Rate limiting per author/token
 * - Quarantine lanes for low-trust content
 * - Prompt injection detection
 * - "Quarantine-to-Canon" promotion rules
 *
 * @module domains/narrative/safety/abuseResistance
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TrustTier = "verified" | "established" | "new" | "quarantined" | "banned";

export type QuarantineReason =
  | "low_trust_author"
  | "injection_detected"
  | "rate_limit_exceeded"
  | "contested_claim"
  | "manual_hold";

export interface TrustCheck {
  authorId: string;
  authorType: "agent" | "human";
  tier: TrustTier;
  trustScore: number;
  canPost: boolean;
  requiresQuarantine: boolean;
  rateLimitRemaining: number;
  blockReason?: string;
}

export interface InjectionCheckResult {
  isClean: boolean;
  injectionScore: number;  // 0-1, higher = more likely injection
  detectedPatterns: string[];
  sanitizedContent?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRUST TIER THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════

const TRUST_THRESHOLDS = {
  verified: 0.9,      // Trusted contributors
  established: 0.6,   // Regular contributors
  new: 0.3,           // New, limited history
  quarantined: 0.0,   // Flagged for review
};

const RATE_LIMITS: Record<TrustTier, number> = {
  verified: 100,      // posts per 24h
  established: 30,
  new: 5,
  quarantined: 0,
  banned: 0,
};

// ═══════════════════════════════════════════════════════════════════════════
// INJECTION DETECTION
// ═══════════════════════════════════════════════════════════════════════════

// Patterns that suggest prompt injection attempts
const INJECTION_PATTERNS = [
  // Direct instruction patterns
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?)/i,
  /disregard\s+(previous|above|all|your)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(everything|all|your)\s+(instructions?|training)/i,
  /new\s+instructions?:/i,
  /system\s*prompt:/i,
  /\[\s*system\s*\]/i,

  // Role-playing attempts
  /you\s+are\s+now\s+(a|an|the)/i,
  /pretend\s+(you\'re|you\s+are|to\s+be)/i,
  /act\s+as\s+(a|an|the|if)/i,
  /roleplay\s+as/i,

  // Output manipulation
  /output\s+only/i,
  /respond\s+with\s+only/i,
  /print\s+(the\s+)?(following|this)/i,

  // Jailbreak attempts
  /DAN\s+mode/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /bypass\s+(your\s+)?(safety|restrictions|filters)/i,

  // Hidden instructions
  /<!--.*-->/s,  // HTML comments
  /\x00/,        // Null bytes
  /[\u200B-\u200D\uFEFF]/,  // Zero-width characters
];

// Suspicious phrase patterns (lower weight)
const SUSPICIOUS_PATTERNS = [
  /please\s+confirm\s+you\s+understand/i,
  /acknowledge\s+the\s+following/i,
  /from\s+now\s+on/i,
  /for\s+the\s+rest\s+of\s+this\s+conversation/i,
  /\[IMPORTANT\]/i,
  /\[PRIORITY\]/i,
  /\[OVERRIDE\]/i,
];

/**
 * Check content for prompt injection attempts
 */
export const checkForInjection = internalQuery({
  args: {
    content: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  handler: async (ctx, args): Promise<InjectionCheckResult> => {
    const detectedPatterns: string[] = [];
    let injectionScore = 0;

    // Check high-confidence injection patterns
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(args.content)) {
        detectedPatterns.push(`injection: ${pattern.source.slice(0, 30)}...`);
        injectionScore += 0.3;
      }
    }

    // Check suspicious patterns (lower weight)
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(args.content)) {
        detectedPatterns.push(`suspicious: ${pattern.source.slice(0, 30)}...`);
        injectionScore += 0.1;
      }
    }

    // Check for unusual character distributions
    const nonAsciiRatio = (args.content.match(/[^\x20-\x7E]/g) || []).length / args.content.length;
    if (nonAsciiRatio > 0.3) {
      detectedPatterns.push("high_non_ascii_ratio");
      injectionScore += 0.1;
    }

    // Check for excessive formatting/special chars
    const specialCharRatio = (args.content.match(/[<>\[\]{}|\\^~`]/g) || []).length / args.content.length;
    if (specialCharRatio > 0.1) {
      detectedPatterns.push("excessive_special_chars");
      injectionScore += 0.1;
    }

    // Cap score at 1
    injectionScore = Math.min(injectionScore, 1);

    // Sanitize if needed
    let sanitizedContent: string | undefined;
    if (injectionScore > 0.3) {
      sanitizedContent = args.content
        .replace(/<!--[\s\S]*?-->/g, "")  // Remove HTML comments
        .replace(/[\u200B-\u200D\uFEFF]/g, "")  // Remove zero-width chars
        .replace(/\x00/g, "");  // Remove null bytes
    }

    return {
      isClean: injectionScore < 0.3,
      injectionScore,
      detectedPatterns,
      sanitizedContent,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TRUST MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get or create trust record for an author
 */
export const getOrCreateTrust = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", q => q.eq("authorType", args.authorType).eq("authorId", args.authorId))
      .first();

    if (existing) {
      return existing;
    }

    // Default trust for new authors
    const defaultTrustScore = args.authorType === "agent" ? 0.7 : 0.4;
    const defaultTier: TrustTier = args.authorType === "agent" ? "established" : "new";

    const id = await ctx.db.insert("authorTrust", {
      authorId: args.authorId,
      authorType: args.authorType,
      trustScore: defaultTrustScore,
      tier: defaultTier,
      postsLast24h: 0,
      postsLimit24h: RATE_LIMITS[defaultTier],
      flagCount: 0,
      injectionAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return await ctx.db.get(id);
  },
});

/**
 * Check if an author can post (trust + rate limit check)
 */
export const checkAuthorTrust = internalQuery({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  handler: async (ctx, args): Promise<TrustCheck> => {
    const trust = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", q => q.eq("authorType", args.authorType).eq("authorId", args.authorId))
      .first();

    if (!trust) {
      // New author - apply defaults
      const defaultTier: TrustTier = args.authorType === "agent" ? "established" : "new";
      return {
        authorId: args.authorId,
        authorType: args.authorType,
        tier: defaultTier,
        trustScore: args.authorType === "agent" ? 0.7 : 0.4,
        canPost: true,
        requiresQuarantine: defaultTier === "new",
        rateLimitRemaining: RATE_LIMITS[defaultTier],
      };
    }

    // Check if banned
    if (trust.tier === "banned") {
      return {
        authorId: args.authorId,
        authorType: args.authorType,
        tier: "banned",
        trustScore: trust.trustScore,
        canPost: false,
        requiresQuarantine: true,
        rateLimitRemaining: 0,
        blockReason: "Author is banned",
      };
    }

    // Check rate limit
    const rateLimitRemaining = Math.max(0, trust.postsLimit24h - trust.postsLast24h);
    const canPost = rateLimitRemaining > 0 && trust.tier !== "banned";

    return {
      authorId: args.authorId,
      authorType: args.authorType,
      tier: trust.tier as TrustTier,
      trustScore: trust.trustScore,
      canPost,
      requiresQuarantine: trust.tier === "new" || trust.tier === "quarantined",
      rateLimitRemaining,
      blockReason: rateLimitRemaining <= 0 ? "Rate limit exceeded" : undefined,
    };
  },
});

/**
 * Record a post by an author (updates rate limit counter)
 */
export const recordAuthorPost = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  handler: async (ctx, args) => {
    const trust = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", q => q.eq("authorType", args.authorType).eq("authorId", args.authorId))
      .first();

    if (!trust) {
      // Create record
      return await ctx.db.insert("authorTrust", {
        authorId: args.authorId,
        authorType: args.authorType,
        trustScore: args.authorType === "agent" ? 0.7 : 0.4,
        tier: args.authorType === "agent" ? "established" : "new",
        postsLast24h: 1,
        postsLimit24h: RATE_LIMITS[args.authorType === "agent" ? "established" : "new"],
        lastPostAt: Date.now(),
        flagCount: 0,
        injectionAttempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // Reset counter if 24h passed
    const shouldReset = trust.lastPostAt && (Date.now() - trust.lastPostAt) > 24 * 60 * 60 * 1000;

    await ctx.db.patch(trust._id, {
      postsLast24h: shouldReset ? 1 : trust.postsLast24h + 1,
      lastPostAt: Date.now(),
      updatedAt: Date.now(),
    });

    return trust._id;
  },
});

/**
 * Record an injection attempt (degrades trust)
 */
export const recordInjectionAttempt = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    injectionScore: v.number(),
    detectedPatterns: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const trust = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", q => q.eq("authorType", args.authorType).eq("authorId", args.authorId))
      .first();

    if (!trust) return;

    const newInjectionCount = trust.injectionAttempts + 1;
    let newTrustScore = trust.trustScore - (args.injectionScore * 0.2);
    newTrustScore = Math.max(0, newTrustScore);

    // Determine new tier
    let newTier = trust.tier;
    if (newInjectionCount >= 3 || newTrustScore < TRUST_THRESHOLDS.new) {
      newTier = "quarantined";
    }
    if (newInjectionCount >= 5) {
      newTier = "banned";
    }

    await ctx.db.patch(trust._id, {
      trustScore: newTrustScore,
      tier: newTier,
      injectionAttempts: newInjectionCount,
      postsLimit24h: RATE_LIMITS[newTier as TrustTier],
      updatedAt: Date.now(),
    });

    return { newTier, newTrustScore, newInjectionCount };
  },
});

/**
 * Flag content (user report)
 */
export const flagAuthor = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const trust = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", q => q.eq("authorType", args.authorType).eq("authorId", args.authorId))
      .first();

    if (!trust) return;

    const newFlagCount = trust.flagCount + 1;
    let newTrustScore = trust.trustScore - 0.1;
    newTrustScore = Math.max(0, newTrustScore);

    // Auto-quarantine after 3 flags
    let newTier = trust.tier;
    if (newFlagCount >= 3 && trust.tier !== "verified") {
      newTier = "quarantined";
    }

    await ctx.db.patch(trust._id, {
      trustScore: newTrustScore,
      tier: newTier,
      flagCount: newFlagCount,
      lastFlaggedAt: Date.now(),
      postsLimit24h: RATE_LIMITS[newTier as TrustTier],
      updatedAt: Date.now(),
    });

    return { newTier, newFlagCount };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUARANTINE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add content to quarantine
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
    reason: v.string(),
    reasonDetail: v.optional(v.string()),
    expiryHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const expiryHours = args.expiryHours || 72;  // Default 72h expiry

    return await ctx.db.insert("contentQuarantine", {
      contentType: args.contentType,
      contentId: args.contentId,
      threadId: args.threadId,
      reason: args.reason as QuarantineReason,
      reasonDetail: args.reasonDetail,
      status: "pending",
      expiresAt: Date.now() + (expiryHours * 60 * 60 * 1000),
      createdAt: Date.now(),
    });
  },
});

/**
 * Review quarantined content
 */
export const reviewQuarantinedContent = internalMutation({
  args: {
    quarantineId: v.id("contentQuarantine"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reviewerId: v.string(),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.quarantineId, {
      status: args.decision,
      reviewedBy: args.reviewerId,
      reviewedAt: Date.now(),
      reviewNote: args.reviewNote,
    });

    return args.quarantineId;
  },
});

/**
 * Get pending quarantine items
 */
export const getPendingQuarantine = internalQuery({
  args: {
    threadId: v.optional(v.id("narrativeThreads")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("contentQuarantine")
      .withIndex("by_status", q => q.eq("status", "pending"));

    if (args.threadId) {
      query = ctx.db
        .query("contentQuarantine")
        .withIndex("by_thread", q => q.eq("threadId", args.threadId).eq("status", "pending"));
    }

    return await query.take(args.limit || 50);
  },
});

/**
 * Check if content is quarantined
 */
export const isContentQuarantined = internalQuery({
  args: {
    contentType: v.string(),
    contentId: v.string(),
  },
  handler: async (ctx, args) => {
    const quarantine = await ctx.db
      .query("contentQuarantine")
      .withIndex("by_content", q => q.eq("contentType", args.contentType).eq("contentId", args.contentId))
      .first();

    if (!quarantine) {
      return { isQuarantined: false };
    }

    // Check if expired (note: actual expiry update happens via scheduled job)
    const isExpired = quarantine.status === "pending" && quarantine.expiresAt < Date.now();

    return {
      isQuarantined: quarantine.status === "pending" && !isExpired,
      status: isExpired ? "expired" : quarantine.status,
      reason: quarantine.reason,
      expiresAt: quarantine.expiresAt,
      needsExpiryUpdate: isExpired,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PROMOTION RULES (Quarantine-to-Canon)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if community-sourced evidence can be promoted to affect temporalFacts
 */
export const checkCanonPromotionEligibility = internalQuery({
  args: {
    contentId: v.string(),
    contentType: v.string(),
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  handler: async (ctx, args) => {
    const blockReasons: string[] = [];

    // Check author trust
    const trust = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", q => q.eq("authorType", args.authorType).eq("authorId", args.authorId))
      .first();

    if (!trust || trust.tier === "new" || trust.tier === "quarantined" || trust.tier === "banned") {
      blockReasons.push("Author trust tier insufficient for canon promotion");
    }

    if (trust && trust.trustScore < TRUST_THRESHOLDS.established) {
      blockReasons.push(`Trust score ${trust.trustScore.toFixed(2)} below threshold ${TRUST_THRESHOLDS.established}`);
    }

    // Check quarantine status
    const quarantine = await ctx.db
      .query("contentQuarantine")
      .withIndex("by_content", q => q.eq("contentType", args.contentType).eq("contentId", args.contentId))
      .first();

    if (quarantine && quarantine.status === "pending") {
      blockReasons.push("Content is still in quarantine");
    }

    if (quarantine && quarantine.status === "rejected") {
      blockReasons.push("Content was rejected from quarantine");
    }

    return {
      canPromote: blockReasons.length === 0,
      blockReasons,
      requiresCorroboration: args.authorType === "human",  // Human evidence needs tier1/tier2 corroboration
    };
  },
});
