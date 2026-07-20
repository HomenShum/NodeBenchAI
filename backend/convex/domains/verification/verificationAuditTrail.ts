/**
 * Verification Audit Trail
 *
 * Complete audit log for all verification actions.
 * Every verification decision is logged with:
 * - What was verified
 * - What sources were checked
 * - What verdict was reached
 * - Who/what performed the verification
 * - Full reasoning chain
 *
 * This is critical for:
 * 1. Regulatory compliance
 * 2. Dispute resolution
 * 3. Model training/improvement
 * 4. Quality assurance
 *
 * @module domains/verification/verificationAuditTrail
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type AuditAction =
  | "claim_verified"
  | "claim_rejected"
  | "source_checked"
  | "entailment_checked"
  | "ground_truth_added"
  | "ground_truth_superseded"
  | "manual_override";

export type TargetType = "claim" | "post" | "fact" | "source";

export interface AuditEntry {
  auditId: string;
  action: AuditAction;
  targetType: TargetType;
  targetId: string;
  claim?: string;
  sourceUrls: string[];
  verdict: string;
  confidence: number;
  reasoning: string;
  sourceTiers?: string[];
  performedBy: string;
  performedAt: number;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log a verification action
 */
export const logVerificationAction = internalMutation({
  args: {
    action: v.union(
      v.literal("claim_verified"),
      v.literal("claim_rejected"),
      v.literal("source_checked"),
      v.literal("entailment_checked"),
      v.literal("ground_truth_added"),
      v.literal("ground_truth_superseded"),
      v.literal("manual_override")
    ),
    targetType: v.union(
      v.literal("claim"),
      v.literal("post"),
      v.literal("fact"),
      v.literal("source")
    ),
    targetId: v.string(),
    claim: v.optional(v.string()),
    sourceUrls: v.array(v.string()),
    verdict: v.string(),
    confidence: v.number(),
    reasoning: v.string(),
    sourceTiers: v.optional(v.array(v.string())),
    performedBy: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const id = await ctx.db.insert("verificationActions", {
      auditId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      claim: args.claim,
      sourceUrls: args.sourceUrls,
      verdict: args.verdict,
      confidence: args.confidence,
      reasoning: args.reasoning,
      sourceTiers: args.sourceTiers,
      performedBy: args.performedBy,
      performedAt: Date.now(),
      metadata: args.metadata,
    });

    return { auditId, id };
  },
});

/**
 * Log a claim verification
 */
export const logClaimVerification = internalMutation({
  args: {
    claimId: v.string(),
    claim: v.string(),
    sourceUrls: v.array(v.string()),
    sourceTiers: v.array(v.string()),
    verdict: v.union(
      v.literal("verified"),
      v.literal("corroborated"),
      v.literal("unverified"),
      v.literal("contradicted"),
      v.literal("insufficient")
    ),
    confidence: v.number(),
    reasoning: v.string(),
    performedBy: v.string(),
    entailmentResults: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const action = args.verdict === "contradicted" ? "claim_rejected" : "claim_verified";

    const id = await ctx.db.insert("verificationActions", {
      auditId,
      action,
      targetType: "claim",
      targetId: args.claimId,
      claim: args.claim,
      sourceUrls: args.sourceUrls,
      verdict: args.verdict,
      confidence: args.confidence,
      reasoning: args.reasoning,
      sourceTiers: args.sourceTiers,
      performedBy: args.performedBy,
      performedAt: Date.now(),
      metadata: {
        entailmentResults: args.entailmentResults,
      },
    });

    return { auditId, id };
  },
});

/**
 * Log a source credibility check
 */
export const logSourceCheck = internalMutation({
  args: {
    sourceUrl: v.string(),
    domain: v.string(),
    tier: v.string(),
    category: v.string(),
    canSupportFactClaims: v.boolean(),
    performedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const id = await ctx.db.insert("verificationActions", {
      auditId,
      action: "source_checked",
      targetType: "source",
      targetId: args.sourceUrl,
      sourceUrls: [args.sourceUrl],
      verdict: args.tier,
      confidence: 1.0,
      reasoning: `Source ${args.domain} categorized as ${args.category} with tier ${args.tier}`,
      sourceTiers: [args.tier],
      performedBy: args.performedBy,
      performedAt: Date.now(),
      metadata: {
        domain: args.domain,
        category: args.category,
        canSupportFactClaims: args.canSupportFactClaims,
      },
    });

    return { auditId, id };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get audit log for a target
 */
export const getAuditLogForTarget = internalQuery({
  args: {
    targetType: v.union(
      v.literal("claim"),
      v.literal("post"),
      v.literal("fact"),
      v.literal("source")
    ),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("verificationActions")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .order("desc")
      .collect();

    return {
      targetType: args.targetType,
      targetId: args.targetId,
      entries,
      count: entries.length,
    };
  },
});

/**
 * Get recent audit entries
 */
export const getRecentAuditEntries = internalQuery({
  args: {
    action: v.optional(
      v.union(
        v.literal("claim_verified"),
        v.literal("claim_rejected"),
        v.literal("source_checked"),
        v.literal("entailment_checked"),
        v.literal("ground_truth_added"),
        v.literal("ground_truth_superseded"),
        v.literal("manual_override")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.action) {
      const entries = await ctx.db
        .query("verificationActions")
        .withIndex("by_action", (q) => q.eq("action", args.action!))
        .order("desc")
        .take(limit);

      return { entries, count: entries.length };
    }

    const entries = await ctx.db
      .query("verificationActions")
      .order("desc")
      .take(limit);

    return { entries, count: entries.length };
  },
});

/**
 * Get audit summary by verdict
 */
export const getAuditSummary = internalQuery({
  args: {
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = args.since ?? Date.now() - 7 * 24 * 60 * 60 * 1000; // Default 7 days

    const entries = await ctx.db
      .query("verificationActions")
      .filter((q) => q.gte(q.field("performedAt"), since))
      .collect();

    const summary = {
      total: entries.length,
      byVerdict: {} as Record<string, number>,
      byAction: {} as Record<string, number>,
      byPerformer: {} as Record<string, number>,
      bySourceTier: {} as Record<string, number>,
    };

    for (const entry of entries) {
      // By verdict
      summary.byVerdict[entry.verdict] = (summary.byVerdict[entry.verdict] ?? 0) + 1;

      // By action
      summary.byAction[entry.action] = (summary.byAction[entry.action] ?? 0) + 1;

      // By performer
      summary.byPerformer[entry.performedBy] =
        (summary.byPerformer[entry.performedBy] ?? 0) + 1;

      // By source tier
      if (entry.sourceTiers) {
        for (const tier of entry.sourceTiers) {
          summary.bySourceTier[tier] = (summary.bySourceTier[tier] ?? 0) + 1;
        }
      }
    }

    return summary;
  },
});

/**
 * Get verification rate metrics
 */
export const getVerificationMetrics = internalQuery({
  args: {
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = args.since ?? Date.now() - 24 * 60 * 60 * 1000; // Default 24 hours

    const entries = await ctx.db
      .query("verificationActions")
      .filter((q) =>
        q.and(
          q.gte(q.field("performedAt"), since),
          q.eq(q.field("targetType"), "claim")
        )
      )
      .collect();

    const verified = entries.filter((e) => e.verdict === "verified").length;
    const corroborated = entries.filter((e) => e.verdict === "corroborated").length;
    const unverified = entries.filter((e) => e.verdict === "unverified").length;
    const contradicted = entries.filter((e) => e.verdict === "contradicted").length;
    const insufficient = entries.filter((e) => e.verdict === "insufficient").length;

    const total = entries.length;
    const avgConfidence =
      total > 0
        ? entries.reduce((sum, e) => sum + e.confidence, 0) / total
        : 0;

    return {
      total,
      verified,
      corroborated,
      unverified,
      contradicted,
      insufficient,
      verificationRate: total > 0 ? (verified + corroborated) / total : 0,
      contradictionRate: total > 0 ? contradicted / total : 0,
      avgConfidence,
      sincePeriod: since,
    };
  },
});

/**
 * Export audit log for external review
 */
export const exportAuditLog = internalQuery({
  args: {
    since: v.number(),
    until: v.optional(v.number()),
    targetType: v.optional(
      v.union(
        v.literal("claim"),
        v.literal("post"),
        v.literal("fact"),
        v.literal("source")
      )
    ),
  },
  handler: async (ctx, args) => {
    const until = args.until ?? Date.now();

    let query = ctx.db
      .query("verificationActions")
      .filter((q) =>
        q.and(
          q.gte(q.field("performedAt"), args.since),
          q.lte(q.field("performedAt"), until)
        )
      );

    if (args.targetType) {
      query = query.filter((q) => q.eq(q.field("targetType"), args.targetType!));
    }

    const entries = await query.collect();

    return {
      exportedAt: Date.now(),
      period: { since: args.since, until },
      targetType: args.targetType ?? "all",
      entries,
      count: entries.length,
    };
  },
});
