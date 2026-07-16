/**
 * ddTriggers.ts
 *
 * Actions for DD triggers. Contains ONLY actions (Node.js runtime).
 * Queries and mutations are in ddTriggerQueries.ts.
 *
 * TIERED DD SYSTEM (v3 - Risk-Aware):
 * Combines funding-based tiers with risk-based escalation.
 *
 * KEY INSIGHT: Deal size alone is NOT a reliable proxy for diligence depth.
 * Lower-funding companies often have HIGHER information asymmetry and risk.
 *
 * Risk-Based Override:
 * - High risk scores (71+) escalate to FULL_PLAYBOOK regardless of funding
 * - Escalation triggers (identity mismatch, BEC indicators) force immediate upgrade
 * - Small deals with high risk get MORE scrutiny, not less
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { Id } from "../../../_generated/dataModel";
import { DDTier, DD_TIER_BRANCHES, RISK_BASED_BRANCHES, MicroBranchType } from "./types";
import {
  detectRiskSignals,
  calculateRiskScore,
  RiskAssessmentInput,
  formatRiskScore,
} from "./riskScoring";

// Type for DD job records returned from queries
interface DDJobRecord {
  jobId: string;
  entityName: string;
  entityType: "company" | "fund" | "person";
  status: string;
  createdAt: number;
  completedAt?: number;
  entityId?: Id<"entityContexts">;
}

// ============================================================================
// Actions - Trigger Handlers
// ============================================================================

/**
 * Trigger DD from a funding event.
 * Uses risk-aware tiered DD system (v3) to determine depth of analysis.
 *
 * This action performs risk assessment before tier selection, allowing
 * small deals with high risk to escalate to deeper DD tiers.
 */
export const triggerDDFromFundingInternal = internalAction({
  args: {
    fundingEventId: v.id("fundingEvents"),
    userId: v.id("users"),
    // Optional: skip risk assessment (use funding-only tiers)
    skipRiskAssessment: v.optional(v.boolean()),
  },
  handler: async (ctx, { fundingEventId, userId, skipRiskAssessment }) => {
    // Get the funding event first (needed for risk assessment)
    const event = await ctx.runQuery(
      internal.domains.enrichment.fundingQueries.getFundingEventById,
      { fundingEventId }
    );

    if (!event) {
      return { triggered: false, reason: "Funding event not found" };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RISK ASSESSMENT (v3)
    // ─────────────────────────────────────────────────────────────────────────

    let riskScore: number | undefined;
    let escalationTriggers: string[] | undefined;

    if (!skipRiskAssessment) {
      try {
        // Build risk assessment input from available data
        const riskInput: RiskAssessmentInput = {
          companyName: event.companyName,
          websiteUrl: event.websiteUrl,
          amountUsd: event.amountUsd,
          roundType: event.roundType,
          sourceUrl: event.sourceUrl,
          sectors: event.sectors,
          // Note: Additional risk signals (founders, claims) would be
          // gathered during enrichment. For now we use available data.
        };

        // Detect risk signals
        const signals = detectRiskSignals(riskInput);

        // Calculate risk score
        const riskResult = calculateRiskScore(signals);
        riskScore = riskResult.overall;
        escalationTriggers = riskResult.escalationTriggers;

        console.log(`[ddTriggers] Risk assessment for ${event.companyName}:`);
        console.log(`  Score: ${riskScore}/100`);
        console.log(`  Signals: ${signals.length}`);
        if (escalationTriggers.length > 0) {
          console.log(`  ESCALATION TRIGGERS: ${escalationTriggers.join(", ")}`);
        }
      } catch (error) {
        console.warn(`[ddTriggers] Risk assessment failed, using funding-based tiers:`, error);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIER SELECTION (with risk override)
    // ─────────────────────────────────────────────────────────────────────────

    // Check if should trigger (now with risk assessment)
    const check = await ctx.runQuery(
      internal.domains.agents.dueDiligence.ddTriggerQueries.shouldTriggerDDForFundingInternal,
      {
        fundingEventId,
        userId,
        riskScore,
        escalationTriggers,
      }
    );

    // Extract tier and metadata from check result
    const tier: DDTier = (check as any).tier ?? "STANDARD_DD";
    const tierResult = (check as any).tierResult;
    const wasOverridden = tierResult?.wasOverridden ?? false;

    if (!check.shouldTrigger) {
      console.log(`[ddTriggers] Skipping DD for ${fundingEventId}: ${check.reason} (tier: ${tier})`);
      await ctx.runMutation(
        internal.domains.agents.dueDiligence.ddTriggerQueries.recordTriggerDecision,
        {
          fundingEventId,
          triggered: false,
          reason: check.reason,
        }
      );
      return {
        triggered: false,
        reason: check.reason,
        tier,
        riskScore,
        wasOverridden,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH SELECTION (tier-specific + risk micro-branches)
    // ─────────────────────────────────────────────────────────────────────────

    // Get full DD branches for this tier
    const ddBranches = DD_TIER_BRANCHES[tier];

    // Get micro-branches based on risk (these run even for small deals)
    const microBranches: MicroBranchType[] = tierResult?.microBranches ?? RISK_BASED_BRANCHES[tier];

    console.log(`[ddTriggers] Starting ${tier} DD for ${event.companyName}`);
    console.log(`  DD Branches: ${ddBranches.length}`);
    console.log(`  Micro-branches: ${microBranches.length}`);
    if (wasOverridden) {
      console.log(`  RISK OVERRIDE: tier escalated from funding-based ${tierResult?.fundingBasedTier}`);
    }

    // Start DD job with tier-specific branches and micro-branches
    const result = await ctx.runAction(
      internal.domains.agents.dueDiligence.ddOrchestrator.startDueDiligenceJobInternal,
      {
        entityName: event.companyName,
        entityType: "company",
        triggerSource: "funding_detection",
        triggerEventId: fundingEventId,
        entityId: event.companyId,
        userId,
        // Pass tier and branch override
        ddTier: tier,
        branchOverride: ddBranches,
        // Pass micro-branches for fast pre-checks
        microBranches,
        // Pass risk metadata for logging/tracking
        riskScore,
        escalationTriggers,
      }
    );

    // Record trigger
    await ctx.runMutation(
      internal.domains.agents.dueDiligence.ddTriggerQueries.recordTriggerDecision,
      {
        fundingEventId,
        triggered: true,
        reason: check.reason,
        jobId: result.jobId,
      }
    );

    console.log(`[ddTriggers] Triggered ${tier} DD job ${result.jobId} for ${event.companyName}`);

    return {
      triggered: true,
      jobId: result.jobId,
      tier,
      branchCount: ddBranches.length,
      microBranchCount: microBranches.length,
      riskScore,
      wasOverridden,
      escalationTriggers,
    };
  },
});

/**
 * Process all pending DD triggers (scheduled job)
 */
export const processPendingTriggersInternal = internalAction({
  args: {
    userId: v.id("users"),
    maxJobs: v.optional(v.number()),
  },
  handler: async (ctx, { userId, maxJobs = 5 }) => {
    // Get pending triggers
    const pending = await ctx.runQuery(
      internal.domains.agents.dueDiligence.ddTriggerQueries.getPendingDDTriggersInternal,
      { userId, limit: maxJobs }
    );

    const results: Array<{
      fundingEventId: Id<"fundingEvents">;
      companyName: string;
      triggered: boolean;
      jobId?: string;
      reason?: string;
    }> = [];

    for (const trigger of pending) {
      const result = await ctx.runAction(
        internal.domains.agents.dueDiligence.ddTriggers.triggerDDFromFundingInternal,
        {
          fundingEventId: trigger.fundingEventId,
          userId,
        }
      );

      results.push({
        fundingEventId: trigger.fundingEventId,
        companyName: trigger.companyName,
        triggered: result.triggered,
        jobId: result.jobId,
        reason: result.reason,
      });
    }

    return {
      processed: results.length,
      triggered: results.filter(r => r.triggered).length,
      results,
    };
  },
});

/**
 * Trigger DD refresh for stale memos
 */
export const triggerStaleRefreshInternal = internalAction({
  args: {
    maxAgeMs: v.optional(v.number()),
    userId: v.id("users"),
    maxJobs: v.optional(v.number()),
  },
  handler: async (ctx, { maxAgeMs = 30 * 24 * 60 * 60 * 1000, userId, maxJobs = 5 }) => {
    // Find stale memos
    const cutoff = Date.now() - maxAgeMs;

    // Get completed jobs with old memos
    const jobs = await ctx.runQuery(
      internal.domains.agents.dueDiligence.ddMutations.getUserDDJobsInternal,
      { userId, status: "completed", limit: 50 }
    );

    const staleJobs = jobs.filter((j: DDJobRecord) => j.completedAt && j.completedAt < cutoff);

    const results: Array<{
      entityName: string;
      triggered: boolean;
      jobId?: string;
    }> = [];

    for (const staleJob of staleJobs.slice(0, maxJobs)) {
      const result = await ctx.runAction(
        internal.domains.agents.dueDiligence.ddOrchestrator.startDueDiligenceJobInternal,
        {
          entityName: staleJob.entityName,
          entityType: staleJob.entityType,
          triggerSource: "scheduled_refresh",
          entityId: staleJob.entityId,
          userId,
        }
      );

      results.push({
        entityName: staleJob.entityName,
        triggered: result.status === "started",
        jobId: result.jobId,
      });
    }

    return {
      staleCount: staleJobs.length,
      refreshed: results.filter(r => r.triggered).length,
      results,
    };
  },
});
