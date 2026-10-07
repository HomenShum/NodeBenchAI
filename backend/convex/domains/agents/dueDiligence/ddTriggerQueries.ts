/**
 * ddTriggerQueries.ts
 *
 * Queries and mutations for DD trigger logic.
 * Separated from ddTriggers.ts to comply with Convex Node.js runtime requirements.
 *
 * TIERED DD SYSTEM (v3 - Risk-Aware):
 * Combines funding-based tiers with risk-based escalation.
 *
 * Funding-Based Tiers:
 * - FULL_PLAYBOOK: $50M+ or Series C+ (all branches)
 * - STANDARD_DD: $5M-$50M or Series A/B (core + tech + financial)
 * - LIGHT_DD: $1M-$5M or Seed (core only)
 * - FAST_VERIFY: <$1M or Pre-seed (no DD, fast verify only)
 *
 * Risk-Based Override:
 * - High risk scores (71+) escalate to FULL_PLAYBOOK regardless of funding
 * - Escalation triggers (identity mismatch, BEC indicators) force immediate upgrade
 * - Small deals with high risk get MORE scrutiny, not less
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";
import { Doc, Id } from "../../../_generated/dataModel";
import {
  DDTier,
  DDRiskScore,
  DD_TIER_THRESHOLDS,
  DD_RISK_THRESHOLDS,
  RISK_BASED_BRANCHES,
  MicroBranchType,
} from "./types";

// ============================================================================
// Trigger Configuration
// ============================================================================

// Minimum confidence to trigger DD from funding detection (any tier)
const MIN_FUNDING_CONFIDENCE = 0.5; // Lowered from 0.7 to allow more tiers

// Cooldown period before re-triggering DD for same entity (ms)
const DD_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ============================================================================
// DD Tier Selection (v3 - Risk-Aware)
// ============================================================================

/**
 * Tier ranking for comparison (higher index = more thorough)
 */
const TIER_RANKING: DDTier[] = ["FAST_VERIFY", "LIGHT_DD", "STANDARD_DD", "FULL_PLAYBOOK"];

/**
 * Select DD tier based on funding amount only (legacy/fallback)
 */
export function selectDDTierByFunding(amountUsd: number | null | undefined, roundType: string): DDTier {
  const amount = amountUsd ?? 0;
  const round = roundType?.toLowerCase() ?? "unknown";

  if (
    amount >= DD_TIER_THRESHOLDS.FULL_PLAYBOOK.minAmountUsd ||
    DD_TIER_THRESHOLDS.FULL_PLAYBOOK.roundTypes.includes(round)
  ) {
    return "FULL_PLAYBOOK";
  }

  if (
    amount >= DD_TIER_THRESHOLDS.STANDARD_DD.minAmountUsd ||
    DD_TIER_THRESHOLDS.STANDARD_DD.roundTypes.includes(round)
  ) {
    return "STANDARD_DD";
  }

  if (
    amount >= DD_TIER_THRESHOLDS.LIGHT_DD.minAmountUsd ||
    DD_TIER_THRESHOLDS.LIGHT_DD.roundTypes.includes(round)
  ) {
    return "LIGHT_DD";
  }

  return "FAST_VERIFY";
}

/**
 * Select DD tier based on risk score only
 */
export function selectDDTierByRisk(riskScore: number, hasEscalationTriggers: boolean): DDTier {
  // Escalation triggers always force FULL_PLAYBOOK
  if (hasEscalationTriggers) {
    return "FULL_PLAYBOOK";
  }

  if (riskScore >= DD_RISK_THRESHOLDS.FULL_PLAYBOOK.min) {
    return "FULL_PLAYBOOK";
  }

  if (riskScore >= DD_RISK_THRESHOLDS.STANDARD_DD.min) {
    return "STANDARD_DD";
  }

  if (riskScore >= DD_RISK_THRESHOLDS.LIGHT_DD.min) {
    return "LIGHT_DD";
  }

  return "FAST_VERIFY";
}

/**
 * Select appropriate DD tier based on BOTH funding AND risk assessment.
 *
 * KEY INSIGHT: Small deals with high risk should get MORE scrutiny, not less.
 * A $500K seed with identity issues is higher risk than a $50M Series B
 * from known institutional investors.
 *
 * @param amountUsd - Funding amount in USD
 * @param roundType - Round type (seed, series-a, etc.)
 * @param riskScore - Optional risk score (0-100)
 * @param escalationTriggers - Optional array of hard-fail triggers
 */
export function selectDDTier(
  amountUsd: number | null | undefined,
  roundType: string,
  riskScore?: number,
  escalationTriggers?: string[]
): DDTierSelectionResult {
  const fundingBasedTier = selectDDTierByFunding(amountUsd, roundType);

  // If no risk assessment, use funding-based tier
  if (riskScore === undefined) {
    return {
      tier: fundingBasedTier,
      fundingBasedTier,
      riskBasedTier: null,
      wasOverridden: false,
      reason: `Funding-based: $${((amountUsd ?? 0) / 1_000_000).toFixed(1)}M ${roundType}`,
      microBranches: RISK_BASED_BRANCHES[fundingBasedTier],
    };
  }

  // Calculate risk-based tier
  const hasEscalation = !!(escalationTriggers && escalationTriggers.length > 0);
  const riskBasedTier = selectDDTierByRisk(riskScore, hasEscalation);

  // Use the HIGHER (more thorough) tier
  const fundingRank = TIER_RANKING.indexOf(fundingBasedTier);
  const riskRank = TIER_RANKING.indexOf(riskBasedTier);
  const finalTier = riskRank > fundingRank ? riskBasedTier : fundingBasedTier;
  const wasOverridden = riskRank > fundingRank;

  // Build reason
  let reason: string;
  if (wasOverridden) {
    reason = `Risk override: score ${riskScore}/100`;
    if (hasEscalation) {
      reason += ` + ${escalationTriggers!.length} escalation trigger(s)`;
    }
  } else {
    reason = `Funding-based: $${((amountUsd ?? 0) / 1_000_000).toFixed(1)}M ${roundType}`;
    if (riskScore > 30) {
      reason += ` (risk: ${riskScore})`;
    }
  }

  return {
    tier: finalTier,
    fundingBasedTier,
    riskBasedTier,
    wasOverridden,
    reason,
    microBranches: RISK_BASED_BRANCHES[finalTier],
  };
}

/**
 * Result of tier selection with full context
 */
export interface DDTierSelectionResult {
  tier: DDTier;
  fundingBasedTier: DDTier;
  riskBasedTier: DDTier | null;
  wasOverridden: boolean;
  reason: string;
  microBranches: MicroBranchType[];
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Check if DD should be triggered for a funding event.
 * Uses risk-aware tiered DD system (v3).
 *
 * Note: Risk scoring happens in the action layer (ddTriggers.ts) since it may
 * require external API calls. This query accepts optional pre-computed risk data.
 */
export const shouldTriggerDDForFundingInternal = internalQuery({
  args: {
    fundingEventId: v.id("fundingEvents"),
    userId: v.id("users"),
    // Optional risk assessment (computed in action layer)
    riskScore: v.optional(v.number()),
    escalationTriggers: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { fundingEventId, userId, riskScore, escalationTriggers }) => {
    const event = await ctx.db.get(fundingEventId) as Doc<"fundingEvents"> | null;
    if (!event) return { shouldTrigger: false, reason: "Funding event not found" };

    // Check confidence (lowered threshold for tiered system)
    if (event.confidence < MIN_FUNDING_CONFIDENCE) {
      return {
        shouldTrigger: false,
        reason: `Confidence ${(event.confidence * 100).toFixed(0)}% below threshold (${MIN_FUNDING_CONFIDENCE * 100}%)`,
      };
    }

    // Check verification status - unverified events get FAST_VERIFY tier only
    // UNLESS there are escalation triggers (which override everything)
    const isUnverified = event.verificationStatus === "unverified";
    const hasEscalation = escalationTriggers && escalationTriggers.length > 0;

    // Determine tier using risk-aware selection
    const tierResult = selectDDTier(
      event.amountUsd,
      event.roundType,
      riskScore,
      escalationTriggers
    );

    // For FAST_VERIFY tier without escalation, skip full DD
    // But if there are escalation triggers, always run DD regardless of tier
    if (tierResult.tier === "FAST_VERIFY" && !hasEscalation) {
      if (isUnverified) {
        return {
          shouldTrigger: false,
          tier: "FAST_VERIFY",
          reason: "Unverified event - fast verify only",
          companyName: event.companyName,
          roundType: event.roundType,
          amountUsd: event.amountUsd,
          tierResult,
        };
      }
      return {
        shouldTrigger: false,
        tier: "FAST_VERIFY",
        reason: tierResult.reason,
        companyName: event.companyName,
        roundType: event.roundType,
        amountUsd: event.amountUsd,
        tierResult,
      };
    }

    // Check for recent DD job on this entity
    const recentJob = await ctx.db
      .query("dueDiligenceJobs")
      .withIndex("by_entity", (q) =>
        q.eq("entityName", event.companyName).eq("entityType", "company")
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.neq(q.field("status"), "failed"),
          q.gt(q.field("createdAt"), Date.now() - DD_COOLDOWN_MS)
        )
      )
      .first() as Doc<"dueDiligenceJobs"> | null;

    if (recentJob) {
      return {
        shouldTrigger: false,
        tier: tierResult.tier,
        reason: `Recent DD job exists (${recentJob.status}) from ${new Date(recentJob.createdAt).toLocaleDateString()}`,
        existingJobId: recentJob.jobId,
        tierResult,
      };
    }

    // Tier descriptions for logging
    const tierDescriptions: Record<DDTier, string> = {
      FULL_PLAYBOOK: "Full DD with all branches",
      STANDARD_DD: "Standard DD (core + tech + financial)",
      LIGHT_DD: "Light DD (core branches only)",
      FAST_VERIFY: "Fast verification only",
    };

    return {
      shouldTrigger: true,
      tier: tierResult.tier,
      reason: tierResult.wasOverridden
        ? `${tierDescriptions[tierResult.tier]} - ${tierResult.reason}`
        : `${tierDescriptions[tierResult.tier]} - ${tierResult.reason}`,
      companyName: event.companyName,
      roundType: event.roundType,
      amountUsd: event.amountUsd,
      confidence: event.confidence,
      tierResult,
      microBranches: tierResult.microBranches,
    };
  },
});

/**
 * Get pending funding events that should trigger DD.
 * Now includes tier information for each event.
 */
export const getPendingDDTriggersInternal = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, limit = 10 }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("limit must be an integer between 1 and 100");
    }
    // Get verified funding events from the last 7 days
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);

    const fundingEvents = await ctx.db
      .query("fundingEvents")
      .withIndex("by_verificationStatus", (q) => q.eq("verificationStatus", "verified"))
      .filter((q) => q.gt(q.field("createdAt"), cutoff))
      .order("desc")
      .take(limit * 2) as Doc<"fundingEvents">[]; // Get more than needed to filter

    const pending: Array<{
      fundingEventId: Id<"fundingEvents">;
      companyName: string;
      roundType: string;
      amountUsd: number | null;
      confidence: number;
      reason: string;
      tier: DDTier;
    }> = [];

    for (const event of fundingEvents) {
      if (pending.length >= limit) break;

      // Check if should trigger
      const check = await shouldTriggerDDForFundingForOwner(ctx, event, userId);
      if (check.shouldTrigger && check.tier) {
        pending.push({
          fundingEventId: event._id,
          companyName: event.companyName,
          roundType: event.roundType,
          amountUsd: event.amountUsd ?? null,
          confidence: event.confidence,
          reason: check.reason,
          tier: check.tier,
        });
      }
    }

    return pending;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Record DD trigger decision
 */
export const recordTriggerDecision = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    triggered: v.boolean(),
    reason: v.string(),
    jobId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Could store in a ddTriggerLog table if needed
    console.log(
      `[ddTriggers] Funding event ${args.fundingEventId}: triggered=${args.triggered}, reason=${args.reason}`
    );
  },
});

// ============================================================================
// Internal Helpers
// ============================================================================

async function shouldTriggerDDForFundingForOwner(
  ctx: any,
  event: Doc<"fundingEvents">,
  userId: Id<"users">,
  riskScore?: number,
  escalationTriggers?: string[]
): Promise<{
  shouldTrigger: boolean;
  reason: string;
  tier?: DDTier;
  tierResult?: DDTierSelectionResult;
}> {
  // Check confidence
  if (event.confidence < MIN_FUNDING_CONFIDENCE) {
    return { shouldTrigger: false, reason: "Low confidence" };
  }

  // Determine tier using risk-aware selection
  const tierResult = selectDDTier(
    event.amountUsd,
    event.roundType,
    riskScore,
    escalationTriggers
  );

  const hasEscalation = escalationTriggers && escalationTriggers.length > 0;

  // Check verification - unverified only get FAST_VERIFY unless escalation
  if (
    (event.verificationStatus === "unverified" || tierResult.tier === "FAST_VERIFY") &&
    !hasEscalation
  ) {
    return {
      shouldTrigger: false,
      reason: "Fast verify only",
      tier: "FAST_VERIFY",
      tierResult,
    };
  }

  // Check cooldown
  const recentJob = await ctx.db
    .query("dueDiligenceJobs")
    .withIndex("by_entity", (q: any) =>
      q.eq("entityName", event.companyName).eq("entityType", "company")
    )
    .filter((q: any) =>
      q.and(
        q.eq(q.field("userId"), userId),
        q.neq(q.field("status"), "failed"),
        q.gt(q.field("createdAt"), Date.now() - DD_COOLDOWN_MS)
      )
    )
    .first() as Doc<"dueDiligenceJobs"> | null;

  if (recentJob) {
    return {
      shouldTrigger: false,
      reason: "Recent DD exists",
      tier: tierResult.tier,
      tierResult,
    };
  }

  return {
    shouldTrigger: true,
    reason: tierResult.reason,
    tier: tierResult.tier,
    tierResult,
  };
}
