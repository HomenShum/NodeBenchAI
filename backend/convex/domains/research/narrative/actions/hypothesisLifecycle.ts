/**
 * Hypothesis Lifecycle Automation (Phase 7)
 *
 * Periodic scoring action that reads signal metrics + claim entailment verdicts
 * and transitions hypothesis status + confidence automatically.
 *
 * Status transitions:
 *   active → supported    (confidence >= 0.75, supporting > contradicting)
 *   active → weakened     (contradicting > supporting, confidence < 0.4)
 *   active → inconclusive (stale: no new evidence in 30 days)
 *   weakened → retired    (contradicting >= 3x supporting)
 *   supported → active    (new contradicting evidence arrives)
 *
 * Confidence formula:
 *   base = supporting / (supporting + contradicting + 1)
 *   tierBoost = sum of tier weights for supporting evidence
 *   confidence = clamp(base * 0.7 + tierBoost * 0.3, 0, 1)
 *
 * @module domains/narrative/actions/hypothesisLifecycle
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id, Doc } from "../../../../_generated/dataModel";
import type { HypothesisStatus } from "../validators";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Boolean evidence gates for hypothesis scoring.
 * Each gate is independently verifiable. No arbitrary numbers.
 *
 * Confidence = passing gates / total gates (deterministic).
 * Status transitions use gate counts, not float thresholds.
 */
interface HypothesisEvidenceGates {
  hasSupportingEvidence: boolean;     // at least 1 piece of supporting evidence
  hasMultipleSources: boolean;        // 2+ independent sources
  hasNoContradictions: boolean;       // no contradicting evidence exists
  hasSignalMetrics: boolean;          // quantitative signal data backs this
  isNotStale: boolean;                // evidence activity within 30 days
  supportOutweighsContradict: boolean; // supporting > contradicting
}

const GATE_KEYS: (keyof HypothesisEvidenceGates)[] = [
  "hasSupportingEvidence",
  "hasMultipleSources",
  "hasNoContradictions",
  "hasSignalMetrics",
  "isNotStale",
  "supportOutweighsContradict",
];

interface HypothesisScoreResult {
  hypothesisDocId: Id<"narrativeHypotheses">;
  hypothesisId: string;
  label: string;
  oldStatus: string;
  newStatus: HypothesisStatus;
  oldConfidence: number;
  newConfidence: number;
  reason: string;
  changed: boolean;
  gates: HypothesisEvidenceGates;
}

// ─── Scoring Logic (Boolean Gates) ──────────────────────────────────────────

const STALENESS_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function evaluateGates(
  supporting: number,
  contradicting: number,
  signalMetricCount: number,
  isStale: boolean
): HypothesisEvidenceGates {
  return {
    hasSupportingEvidence: supporting >= 1,
    hasMultipleSources: supporting >= 2,
    hasNoContradictions: contradicting === 0,
    hasSignalMetrics: signalMetricCount >= 1,
    isNotStale: !isStale,
    supportOutweighsContradict: supporting > contradicting,
  };
}

function countGates(gates: HypothesisEvidenceGates): number {
  return GATE_KEYS.filter((k) => gates[k]).length;
}

function gateConfidence(gates: HypothesisEvidenceGates): number {
  return countGates(gates) / GATE_KEYS.length;
}

function determineStatus(
  current: HypothesisStatus,
  gates: HypothesisEvidenceGates,
  supporting: number,
  contradicting: number
): { status: HypothesisStatus; reason: string } {
  const passing = countGates(gates);
  const failing = GATE_KEYS.filter((k) => !gates[k]);

  // Retired hypotheses stay retired unless manually reactivated
  if (current === "retired") {
    return { status: "retired", reason: "Hypothesis is retired" };
  }

  // Stale + no evidence → inconclusive
  if (!gates.isNotStale && !gates.hasSupportingEvidence) {
    return { status: "inconclusive", reason: "No evidence activity in 30+ days" };
  }

  // Strong support: ≥5 of 6 gates pass
  if (passing >= 5) {
    return { status: "supported", reason: `${passing}/6 evidence gates pass. ${supporting} supporting, ${contradicting} contradicting` };
  }

  // Retired: contradicting >= 3x supporting
  if (contradicting >= 3 * Math.max(supporting, 1)) {
    return { status: "retired", reason: `Contradicting evidence (${contradicting}) >= 3x supporting (${supporting}). Failing: ${failing.join(", ")}` };
  }

  // Weakened: ≤2 gates pass AND contradicting > supporting
  if (passing <= 2 && !gates.supportOutweighsContradict) {
    return { status: "weakened", reason: `Only ${passing}/6 gates pass. Failing: ${failing.join(", ")}` };
  }

  // Re-activate if previously supported but gates dropped
  if (current === "supported" && passing < 4) {
    return { status: "active", reason: `Dropped from supported: ${passing}/6 gates now passing. Failing: ${failing.join(", ")}` };
  }

  // Default: stay active
  return { status: "active", reason: `${passing}/6 gates pass. Monitoring. Failing: ${failing.join(", ")}` };
}

// ─── Internal Action: Score All Active Hypotheses ────────────────────────────

/**
 * Score and transition all active hypotheses for a thread.
 * Called periodically (e.g., after each newsroom pipeline run).
 */
export const scoreThreadHypotheses = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    hypothesisDocId: v.id("narrativeHypotheses"),
    hypothesisId: v.string(),
    label: v.string(),
    oldStatus: v.string(),
    newStatus: v.string(),
    oldConfidence: v.number(),
    newConfidence: v.number(),
    reason: v.string(),
    changed: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const now = Date.now();

    console.log(`[HypothesisLifecycle] Scoring hypotheses for thread ${args.threadId} (dryRun=${dryRun})`);

    // 1. Fetch all hypotheses for this thread
    const hypotheses = await ctx.runQuery(
      internal.domains.narrative.queries.hypotheses.getByThreadInternal,
      { threadId: args.threadId }
    );

    if (hypotheses.length === 0) {
      console.log("[HypothesisLifecycle] No hypotheses found for thread");
      return [];
    }

    console.log(`[HypothesisLifecycle] Found ${hypotheses.length} hypotheses`);

    // 2. Fetch signal metrics for context
    const signalMetrics = await ctx.runQuery(
      internal.domains.narrative.queries.signalMetrics.getByThreadInternal,
      { threadId: args.threadId, limit: 50 }
    );

    const results: HypothesisScoreResult[] = [];

    // 3. Score each hypothesis
    for (const hyp of hypotheses) {
      const supporting = hyp.supportingEvidenceCount ?? 0;
      const contradicting = hyp.contradictingEvidenceCount ?? 0;

      // Count signal metrics linked to this hypothesis
      const linkedMetrics = signalMetrics.filter(
        (m: any) => m.hypothesisId === hyp.hypothesisId
      );

      const isStale = (now - (hyp.updatedAt ?? hyp.createdAt)) > STALENESS_THRESHOLD_MS;
      const gates = evaluateGates(supporting, contradicting, linkedMetrics.length, isStale);
      const newConfidence = gateConfidence(gates);
      const { status: newStatus, reason } = determineStatus(
        hyp.status as HypothesisStatus,
        gates,
        supporting,
        contradicting
      );

      const changed = newStatus !== hyp.status || Math.abs(newConfidence - (hyp.confidence ?? 0.5)) > 0.05;

      results.push({
        hypothesisDocId: hyp._id,
        hypothesisId: hyp.hypothesisId,
        label: hyp.label,
        oldStatus: hyp.status,
        newStatus,
        oldConfidence: hyp.confidence ?? 0.5,
        newConfidence,
        reason,
        changed,
        gates,
      });

      // 4. Apply changes if not dry run
      if (changed && !dryRun) {
        await ctx.runMutation(
          internal.domains.narrative.mutations.hypotheses.updateHypothesisInternal,
          {
            hypothesisDocId: hyp._id,
            status: newStatus,
            confidence: newConfidence,
            reviewedBy: "hypothesis_lifecycle",
          }
        );
        const passing = countGates(gates);
        console.log(`[HypothesisLifecycle] ${hyp.label}: ${hyp.status} → ${newStatus} (${passing}/6 gates)`);
      }
    }

    const changedCount = results.filter((r) => r.changed).length;
    console.log(`[HypothesisLifecycle] ${changedCount}/${results.length} hypotheses would change`);

    return results;
  },
});

/**
 * Score hypotheses across ALL threads with active hypotheses.
 * Designed to be called from a cron job.
 */
export const scoreAllActiveHypotheses = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    maxThreads: v.optional(v.number()),
  },
  returns: v.object({
    threadsScored: v.number(),
    totalHypotheses: v.number(),
    totalChanged: v.number(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const maxThreads = args.maxThreads ?? 50;

    // Find threads that have active hypotheses
    const activeHypotheses = await ctx.runQuery(
      internal.domains.narrative.actions.hypothesisLifecycle.getThreadsWithActiveHypotheses,
      { limit: maxThreads }
    );

    let totalHypotheses = 0;
    let totalChanged = 0;

    for (const threadId of activeHypotheses) {
      const results = await ctx.runAction(
        internal.domains.narrative.actions.hypothesisLifecycle.scoreThreadHypotheses,
        { threadId: threadId as Id<"narrativeThreads">, dryRun }
      );
      totalHypotheses += results.length;
      totalChanged += results.filter((r: any) => r.changed).length;
    }

    console.log(`[HypothesisLifecycle] Scored ${totalHypotheses} hypotheses across ${activeHypotheses.length} threads, ${totalChanged} changed`);

    return {
      threadsScored: activeHypotheses.length,
      totalHypotheses,
      totalChanged,
    };
  },
});

/**
 * Helper query: get distinct thread IDs that have active hypotheses.
 */
export const getThreadsWithActiveHypotheses = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.id("narrativeThreads")),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const active = await ctx.db
      .query("narrativeHypotheses")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(500);

    const threadIds = new Set<Id<"narrativeThreads">>();
    for (const h of active) {
      if (threadIds.size >= limit) break;
      threadIds.add(h.threadId);
    }

    return Array.from(threadIds);
  },
});
