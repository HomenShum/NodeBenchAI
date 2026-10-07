/**
 * evolutionVerification.ts — Evolution Verification Gate
 *
 * Simulates rubric change impact on historical judge reviews and detects
 * thrashing (oscillating add/remove of the same gate) before selfEvolution
 * applies changes. Pure Convex queries and logic — no Node.js runtime needed.
 *
 * Entry point: verifyRubricProposal — called between propose and apply steps
 * in runSelfEvolutionCycle. Fail-open: verification errors let the proposal through.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

// ============================================================================
// Constants (BOUND)
// ============================================================================

/** Max judge reviews to replay for simulation */
const MAX_JUDGE_REVIEWS_TO_SIMULATE = 100;
/** Max recent evolutions to check for thrashing */
const MAX_EVOLUTION_HISTORY = 10;
/** Window in days to look back for thrashing detection */
const THRASHING_WINDOW_DAYS = 7;
/** Max acceptable false positive rate (PASS → worse) */
const MAX_FALSE_POSITIVE_RATE = 0.15;
/** Max acceptable false negative rate (FAIL → better) */
const MAX_FALSE_NEGATIVE_RATE = 0.15;

// ============================================================================
// Types
// ============================================================================

/** The 8 boolean criteria fields on judgeReviews.criteria */
const CRITERIA_KEYS = [
  "taskCompleted",
  "outputCorrect",
  "evidenceCited",
  "noHallucination",
  "toolsUsedEfficiently",
  "contractFollowed",
  "budgetRespected",
  "noForbiddenActions",
] as const;

type CriteriaKey = (typeof CRITERIA_KEYS)[number];

interface SimulationResult {
  flippedVerdicts: number;
  projectedFalsePositiveRate: number;
  projectedFalseNegativeRate: number;
  affectedReviews: Array<{
    reviewId: string;
    originalVerdict: string;
    projectedVerdict: string;
  }>;
}

interface ThrashingResult {
  thrashing: boolean;
  conflictingChanges: Array<{
    currentChange: string;
    recentChange: string;
    cycleId: string;
  }>;
}

interface VerificationResult {
  approved: boolean;
  simulation: SimulationResult;
  thrashing: ThrashingResult;
  rejectionReason?: string;
}

interface ProposedChange {
  type: string;
  gateName: string;
  reasoning: string;
  confidence: number;
  before?: string | null;
  after?: string | null;
}

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Fetch recent judge reviews for simulation replay.
 * Ordered desc by createdAt, capped at MAX_JUDGE_REVIEWS_TO_SIMULATE.
 */
export const queryRecentJudgeReviews = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("judgeReviews")
      .order("desc")
      .take(MAX_JUDGE_REVIEWS_TO_SIMULATE);
  },
});

/**
 * Fetch recent rubric evolutions within the thrashing window.
 * Capped at MAX_EVOLUTION_HISTORY.
 */
export const queryRecentEvolutions = internalQuery({
  args: {
    windowDays: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const windowDays = args.windowDays ?? THRASHING_WINDOW_DAYS;
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

    const evolutions = await ctx.db
      .query("rubricEvolutions")
      .withIndex("by_appliedAt", (q) => q.gt("appliedAt", cutoff))
      .order("desc")
      .take(MAX_EVOLUTION_HISTORY);

    return evolutions;
  },
});

// ============================================================================
// Simulation
// ============================================================================

/**
 * Replays proposed changes against recent judge reviews to estimate
 * false positive and false negative flip rates.
 *
 * DETERMINISTIC: same reviews + same proposal = same result (no randomness).
 * HONEST_SCORES: rates computed from actual data with no artificial floors.
 */
export const simulateRubricImpact = internalAction({
  args: {
    proposedChanges: v.array(
      v.object({
        type: v.string(),
        gateName: v.string(),
        reasoning: v.string(),
        confidence: v.number(),
        before: v.optional(v.string()),
        after: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<SimulationResult> => {
    const reviews: Array<{
      _id: { toString(): string };
      verdict: string;
      criteria: Record<CriteriaKey, boolean>;
    }> = await ctx.runQuery(
      internal.domains.agents.evolutionVerification.queryRecentJudgeReviews,
      {},
    );

    const affectedReviews: SimulationResult["affectedReviews"] = [];
    let falsePositiveFlips = 0; // PASS → worse
    let falseNegativeFlips = 0; // FAIL/partial → better

    const totalPass = reviews.filter((r) => r.verdict === "pass").length;
    const totalFail = reviews.filter(
      (r) => r.verdict === "fail" || r.verdict === "partial",
    ).length;

    for (const review of reviews) {
      const criteria = review.criteria;
      let projectedVerdict = review.verdict;

      for (const change of args.proposedChanges) {
        const gateName = change.gateName as CriteriaKey;
        const isKnownGate = CRITERIA_KEYS.includes(gateName);

        if (change.type === "remove_gate" && isKnownGate) {
          // Removing a gate: if it was the ONLY failing gate, the review
          // would flip from fail/partial → pass
          if (criteria[gateName] === false) {
            const failingGates = CRITERIA_KEYS.filter(
              (k) => criteria[k] === false,
            );
            if (failingGates.length === 1 && failingGates[0] === gateName) {
              // This was the sole failing gate — verdict flips to pass
              projectedVerdict = "pass";
            }
          }
        } else if (change.type === "add_gate") {
          // Adding a new gate: conservative estimate — assume it fails for
          // reviews where the MOST similar existing gate also failed.
          // Without actual data for the new gate, use a deterministic heuristic:
          // the new gate fails if >= 2 existing gates already failed (correlated weakness).
          if (review.verdict === "pass") {
            const failCount = CRITERIA_KEYS.filter(
              (k) => criteria[k] === false,
            ).length;
            // A passing review has 0 failing gates by definition of "pass".
            // But partial reviews can also be re-evaluated.
            // For pass verdicts: assume new gate fails ~20% of the time.
            // Deterministic proxy: fail if compositeConfidence of this change < 0.8
            // (lower-confidence gates are more likely to catch edge cases)
            if (change.confidence < 0.8) {
              projectedVerdict = "partial";
            }
          } else if (review.verdict === "partial") {
            // Already partial — adding another gate won't improve things
            // but might push to fail if many gates already failing
            const failCount = CRITERIA_KEYS.filter(
              (k) => criteria[k] === false,
            ).length;
            if (failCount >= 3) {
              projectedVerdict = "fail";
            }
          }
        } else if (change.type === "adjust_threshold" && isKnownGate) {
          // Threshold adjustments: estimate based on current pass/fail state
          // If the gate currently passes and we're tightening (confidence > 0.7),
          // some borderline passes might flip
          if (criteria[gateName] === true && change.confidence > 0.7) {
            // Tightening: ~10% of current passes might flip
            // Deterministic: flip if this is the review where all OTHER gates pass
            // (i.e., it's a "barely passing" review)
            const passingGateCount = CRITERIA_KEYS.filter(
              (k) => criteria[k] === true,
            ).length;
            if (passingGateCount === CRITERIA_KEYS.length && review.verdict === "pass") {
              // Perfect score review — threshold tightening unlikely to affect
              // Skip
            }
          }
        }
        // add_disqualifier: treated like add_gate for simulation purposes
        if (change.type === "add_disqualifier" && review.verdict === "pass") {
          // Disqualifiers are strict — if triggered, verdict goes to fail
          // Conservative: trigger if confidence >= 0.85 (high-confidence disqualifier)
          if (change.confidence >= 0.85) {
            projectedVerdict = "fail";
          }
        }
      }

      // Record if verdict changed
      if (projectedVerdict !== review.verdict) {
        affectedReviews.push({
          reviewId: review._id.toString(),
          originalVerdict: review.verdict,
          projectedVerdict,
        });

        // Classify the flip
        if (review.verdict === "pass" && projectedVerdict !== "pass") {
          falsePositiveFlips++;
        } else if (
          (review.verdict === "fail" || review.verdict === "partial") &&
          projectedVerdict === "pass"
        ) {
          falseNegativeFlips++;
        }
      }
    }

    return {
      flippedVerdicts: affectedReviews.length,
      // HONEST_SCORES: no floors — if totalPass is 0, rate is 0
      projectedFalsePositiveRate: totalPass > 0 ? falsePositiveFlips / totalPass : 0,
      projectedFalseNegativeRate: totalFail > 0 ? falseNegativeFlips / totalFail : 0,
      affectedReviews,
    };
  },
});

// ============================================================================
// Thrashing Detection
// ============================================================================

/**
 * Detects oscillating rubric changes (add X then remove X, or vice versa)
 * within the thrashing window. Prevents the evolution loop from undoing
 * its own recent work.
 */
export const detectThrashing = internalAction({
  args: {
    proposedChanges: v.array(
      v.object({
        type: v.string(),
        gateName: v.string(),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ThrashingResult> => {
    const recentEvolutions: Array<{
      cycleId: string;
      changes: Array<{ type: string; gateName: string }>;
      appliedAt: number;
    }> = await ctx.runQuery(
      internal.domains.agents.evolutionVerification.queryRecentEvolutions,
      {},
    );

    const conflictingChanges: ThrashingResult["conflictingChanges"] = [];

    // Build a map of recent changes: gateName → [{ type, cycleId }]
    const recentChangeMap = new Map<
      string,
      Array<{ type: string; gateName: string; cycleId: string }>
    >();
    for (const evo of recentEvolutions) {
      for (const change of evo.changes) {
        const existing = recentChangeMap.get(change.gateName) ?? [];
        existing.push({ type: change.type, gateName: change.gateName, cycleId: evo.cycleId });
        recentChangeMap.set(change.gateName, existing);
      }
    }

    // Check each proposed change against recent history
    for (const proposed of args.proposedChanges) {
      const recent = recentChangeMap.get(proposed.gateName);
      if (!recent) continue;

      for (const r of recent) {
        let isThrashing = false;

        if (
          (proposed.type === "add_gate" && r.type === "remove_gate") ||
          (proposed.type === "remove_gate" && r.type === "add_gate")
        ) {
          isThrashing = true;
        }

        // Same type on same gate twice within window = potential thrashing
        if (
          proposed.type === "adjust_threshold" &&
          r.type === "adjust_threshold"
        ) {
          isThrashing = true;
        }

        if (isThrashing) {
          conflictingChanges.push({
            currentChange: `${proposed.type}:${proposed.gateName}`,
            recentChange: `${r.type}:${r.gateName}`,
            cycleId: r.cycleId,
          });
        }
      }
    }

    return {
      thrashing: conflictingChanges.length > 0,
      conflictingChanges,
    };
  },
});

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Verifies a rubric proposal by running simulation + thrashing detection.
 * Called by runSelfEvolutionCycle between propose and apply steps.
 *
 * ERROR_BOUNDARY: caller wraps this in try/catch and fails OPEN
 * (verification error → proceed with proposal).
 */
export const verifyRubricProposal = internalAction({
  args: {
    proposedChanges: v.array(
      v.object({
        type: v.string(),
        gateName: v.string(),
        reasoning: v.string(),
        confidence: v.number(),
        before: v.optional(v.string()),
        after: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<VerificationResult> => {
    // Run simulation and thrashing detection in sequence
    // (both need DB reads, can't truly parallelize in Convex actions)
    const simulation: SimulationResult = await ctx.runAction(
      internal.domains.agents.evolutionVerification.simulateRubricImpact,
      { proposedChanges: args.proposedChanges },
    );

    const thrashing: ThrashingResult = await ctx.runAction(
      internal.domains.agents.evolutionVerification.detectThrashing,
      {
        proposedChanges: args.proposedChanges.map((c) => ({
          type: c.type,
          gateName: c.gateName,
        })),
      },
    );

    // Determine approval
    if (thrashing.thrashing) {
      const details = thrashing.conflictingChanges
        .map((c) => `${c.currentChange} conflicts with ${c.recentChange} (cycle ${c.cycleId})`)
        .join("; ");
      return {
        approved: false,
        simulation,
        thrashing,
        rejectionReason: `Thrashing detected: ${details}`,
      };
    }

    if (simulation.projectedFalsePositiveRate > MAX_FALSE_POSITIVE_RATE) {
      return {
        approved: false,
        simulation,
        thrashing,
        rejectionReason:
          `False positive rate too high: ${(simulation.projectedFalsePositiveRate * 100).toFixed(1)}% > ${MAX_FALSE_POSITIVE_RATE * 100}% threshold. ` +
          `${simulation.affectedReviews.filter((r) => r.originalVerdict === "pass").length} passing reviews would flip.`,
      };
    }

    if (simulation.projectedFalseNegativeRate > MAX_FALSE_NEGATIVE_RATE) {
      return {
        approved: false,
        simulation,
        thrashing,
        rejectionReason:
          `False negative rate too high: ${(simulation.projectedFalseNegativeRate * 100).toFixed(1)}% > ${MAX_FALSE_NEGATIVE_RATE * 100}% threshold. ` +
          `${simulation.affectedReviews.filter((r) => r.projectedVerdict === "pass" && r.originalVerdict !== "pass").length} failing reviews would incorrectly pass.`,
      };
    }

    return {
      approved: true,
      simulation,
      thrashing,
    };
  },
});
