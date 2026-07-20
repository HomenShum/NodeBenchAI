"use node";
/**
 * Cross-Agent Decision Consistency Index
 *
 * Detects conflicting decisions across agents operating on the same scenario.
 * When two agents produce divergent verdicts or significantly different
 * confidence scores for the same fingerprinted scenario, an alert is raised
 * for human review or automated deliberation injection.
 *
 * ERROR_BOUNDARY: All recording paths are wrapped in try/catch — consistency
 * detection is advisory and never blocks the judge flow.
 */

import { createHash } from "crypto";
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ============================================================================
// Constants — BOUND limits
// ============================================================================

/** Only compare decisions within this window (ms) */
const CONFLICT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Trigger alert when confidence scores diverge by more than this */
const CONFIDENCE_DIVERGENCE_THRESHOLD = 0.3;
/** BOUND_READ: Max chars for formatted deliberation context */
const MAX_DELIBERATION_CHARS = 1500;
/** Hex chars from SHA-256 digest — matches decisionMemory */
const FINGERPRINT_LENGTH = 16;

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Calculate conflict severity from verdict and confidence divergence.
 *
 * - pass vs fail = high
 * - pass vs partial OR partial vs fail = medium
 * - same verdict but confidence divergence > threshold = low
 */
function calculateSeverity(
  verdictA: string,
  verdictB: string,
  confidenceA: number,
  confidenceB: number,
): "low" | "medium" | "high" {
  const opposing = new Set(["pass-fail", "fail-pass"]);
  const pairKey = `${verdictA}-${verdictB}`;

  if (opposing.has(pairKey)) return "high";

  const mixed = new Set([
    "pass-partial",
    "partial-pass",
    "partial-fail",
    "fail-partial",
    "pass-escalate",
    "escalate-pass",
    "fail-escalate",
    "escalate-fail",
  ]);
  if (mixed.has(pairKey)) return "medium";

  // Same verdict but confidence divergence
  if (Math.abs(confidenceA - confidenceB) > CONFIDENCE_DIVERGENCE_THRESHOLD) {
    return "low";
  }

  return "low";
}

/**
 * Determine conflict type from verdict and confidence comparison.
 */
function determineConflictType(
  verdictA: string,
  verdictB: string,
  confidenceA: number,
  confidenceB: number,
): "verdict_mismatch" | "confidence_divergence" | "recommendation_conflict" {
  if (verdictA !== verdictB) return "verdict_mismatch";
  if (Math.abs(confidenceA - confidenceB) > CONFIDENCE_DIVERGENCE_THRESHOLD) {
    return "confidence_divergence";
  }
  return "recommendation_conflict";
}

/**
 * Compute a decision fingerprint — identical logic to decisionMemory.ts.
 *
 * DETERMINISTIC: keys sorted alphabetically in the object literal.
 * SHA-256 truncated to 16 hex chars.
 */
function computeFingerprint({
  entityRef,
  actionType,
  domain,
}: {
  entityRef?: string;
  actionType: string;
  domain: string;
}): string {
  const payload = JSON.stringify({
    actionType,
    domain,
    entityRef: entityRef ?? "",
  });
  return createHash("sha256")
    .update(payload)
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/**
 * Format active consistency conflicts for injection into deliberation context.
 *
 * BOUND_READ: Output truncated to MAX_DELIBERATION_CHARS.
 */
export function formatConflictsForDeliberation(
  alerts: Array<{
    scenarioFingerprint: string;
    agentA: string;
    agentB: string;
    verdictA: string;
    verdictB: string;
    confidenceA: number;
    confidenceB: number;
    severity: "low" | "medium" | "high";
    conflictType: string;
  }>,
): string {
  if (alerts.length === 0) {
    return "No active consistency conflicts.";
  }

  const header = "## Active Consistency Conflicts\n";
  const lines: string[] = [];

  for (const a of alerts) {
    lines.push(
      `[${a.severity.toUpperCase()}] Agent ${a.agentA} vs Agent ${a.agentB}: ` +
        `${a.verdictA} vs ${a.verdictB} (${a.conflictType}) ` +
        `on scenario ${a.scenarioFingerprint.slice(0, 8)}`,
    );
  }

  const full = header + lines.join("\n");
  if (full.length > MAX_DELIBERATION_CHARS) {
    return full.slice(0, MAX_DELIBERATION_CHARS - 3) + "...";
  }
  return full;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Record a consistency entry and detect conflicts with prior decisions.
 *
 * Called after a judge review is recorded. Computes the scenario fingerprint,
 * scans decisionMemory for prior decisions from DIFFERENT agents on the same
 * scenario, and raises alerts for any conflicts detected.
 *
 * ERROR_BOUNDARY: Entire handler wrapped in try/catch — failures are logged
 * but never block the judge flow. Consistency detection is advisory.
 */
export const recordConsistencyEntry = internalAction({
  args: {
    judgeReviewId: v.id("judgeReviews"),
    missionId: v.id("missions"),
    agentId: v.string(),
    verdict: v.string(),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      // Fetch the mission to extract decision coordinates
      const mission = await ctx.runQuery(
        internal.domains.agents.consistencyIndexQueries.getMission,
        { missionId: args.missionId },
      );
      if (!mission) {
        console.warn(
          `[consistencyIndex] Mission ${args.missionId} not found, skipping`,
        );
        return;
      }

      // Compute fingerprint using same logic as decisionMemory
      const entityRef = mission.entityKey ?? undefined;
      const actionType = mission.missionType ?? "unknown";
      const domain = mission.missionType ?? "unknown";
      const fingerprint = computeFingerprint({ entityRef, actionType, domain });

      // Query recent decisions for this fingerprint within the conflict window
      const windowStart = Date.now() - CONFLICT_WINDOW_MS;
      const priorDecisions = await ctx.runQuery(
        internal.domains.agents.consistencyIndexQueries.getRecentDecisionsByFingerprint,
        { fingerprint, windowStart },
      );

      // Check each prior decision from a DIFFERENT agent for conflicts
      for (const prior of priorDecisions) {
        // Skip decisions from the same agent
        // decisionMemory doesn't store agentId directly, but stores
        // sourceJudgeReviewId — we compare agent IDs when available,
        // and skip self-comparisons using the sourceJudgeReviewId
        if (
          prior.sourceJudgeReviewId &&
          prior.sourceJudgeReviewId === args.judgeReviewId
        ) {
          continue;
        }

        // Check for verdict mismatch or confidence divergence
        const hasVerdictMismatch = prior.verdict !== args.verdict;
        const hasConfidenceDivergence =
          Math.abs(prior.confidence - args.confidence) >
          CONFIDENCE_DIVERGENCE_THRESHOLD;

        if (hasVerdictMismatch || hasConfidenceDivergence) {
          const severity = calculateSeverity(
            args.verdict,
            prior.verdict,
            args.confidence,
            prior.confidence,
          );
          const conflictType = determineConflictType(
            args.verdict,
            prior.verdict,
            args.confidence,
            prior.confidence,
          );

          await ctx.runMutation(
            internal.domains.agents.consistencyIndexQueries.logConsistencyAlert,
            {
              scenarioFingerprint: fingerprint,
              agentA: args.agentId,
              agentB: `prior:${prior.sourceJudgeReviewId ?? "unknown"}`,
              verdictA: args.verdict,
              verdictB: prior.verdict,
              confidenceA: args.confidence,
              confidenceB: prior.confidence,
              missionIdA: args.missionId,
              missionIdB: prior.sourceMissionId ?? undefined,
              conflictType,
              severity,
            },
          );
        }
      }
    } catch (error) {
      // ERROR_BOUNDARY: Consistency detection is advisory — never block judge flow
      console.error(
        "[consistencyIndex] Failed to record consistency entry:",
        error instanceof Error ? error.message : String(error),
      );
    }
  },
});

