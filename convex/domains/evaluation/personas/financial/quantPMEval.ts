/**
 * Quant PM Persona Evaluation
 *
 * Evaluates quantitative analysis capabilities for portfolio managers
 * assessing trading strategies and factor models.
 */

"use node";

import { action } from "../../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../../_generated/api";

import { ALPHA_MOMENTUM_GROUND_TRUTH, type QuantStrategyGroundTruth } from "./quantPMGroundTruth";
import {
  normalizeScores,
  mapToRawScores,
  buildEvalResult,
} from "../../scoring/scoringFramework";
import { QUANT_PM_SCORING } from "../../scoring/personaWeights";
import type { PersonaEvalResult } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate Quant PM persona against Alpha Momentum ground truth
 */
export const evaluateQuantPM = action({
  args: {
    entityName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PersonaEvalResult> => {
    const entityName = args.entityName || ALPHA_MOMENTUM_GROUND_TRUTH.entityName;
    const groundTruth = ALPHA_MOMENTUM_GROUND_TRUTH;

    console.log(`[QUANT_PM_EVAL] Starting evaluation for ${entityName}...`);
    const startTime = Date.now();

    try {
      // Run investor playbook with quant context
      const playbookResult = await ctx.runAction(
        internal.domains.agents.dueDiligence.investorPlaybook.evalPlaybook.runInvestorPlaybookEval,
        {
          entityName,
          entityType: "company", // Strategy treated as company for now
          persona: "QUANT_PM",
        }
      );

      // Extract and score results
      const scoreMap = extractQuantScores(playbookResult, groundTruth);
      const rawScores = mapToRawScores(scoreMap, QUANT_PM_SCORING);
      const normalizedScores = normalizeScores(rawScores, QUANT_PM_SCORING);
      const executionTimeMs = Date.now() - startTime;
      const result = buildEvalResult(
        "QUANT_PM",
        entityName,
        normalizedScores,
        executionTimeMs,
        "", // Report generated separately
        { playbookResult }
      );

      console.log(`[QUANT_PM_EVAL] Completed: ${result.normalizedScore}/100 (${result.passed ? "PASS" : "FAIL"})`);
      return result;
    } catch (error: any) {
      console.error(`[QUANT_PM_EVAL] Error:`, error);
      throw error;
    }
  },
});

/**
 * Mock evaluation for framework testing
 */
export const evaluateQuantPMMock = action({
  args: {},
  handler: async (): Promise<PersonaEvalResult> => {
    const groundTruth = ALPHA_MOMENTUM_GROUND_TRUTH;
    const startTime = Date.now();

    // Generate mock scores based on expected outcome
    const rawScores = new Map<string, number>();
    const isPass = groundTruth.expectedOutcome === "pass";

    rawScores.set("performance", isPass ? 0.88 : 0.35);
    rawScores.set("risk_metrics", isPass ? 0.85 : 0.4);
    rawScores.set("methodology", isPass ? 0.9 : 0.3);
    rawScores.set("factor_attribution", isPass ? 0.82 : 0.45);
    rawScores.set("robustness", isPass ? 0.78 : 0.5);

    const rawScoresArray = mapToRawScores(rawScores, QUANT_PM_SCORING);
    const normalizedScores = normalizeScores(rawScoresArray, QUANT_PM_SCORING);
    const executionTimeMs = Date.now() - startTime;
    const result = buildEvalResult(
      "QUANT_PM",
      groundTruth.entityName,
      normalizedScores,
      executionTimeMs,
      "", // Report generated separately
      { mockScores: Object.fromEntries(rawScores) }
    );

    return result;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SCORE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function extractQuantScores(
  playbookResult: any,
  groundTruth: QuantStrategyGroundTruth
): Map<string, number> {
  const scores = new Map<string, number>();
  const synthesis = playbookResult?.synthesis;

  if (!synthesis) {
    scores.set("performance", 0);
    scores.set("risk_metrics", 0);
    scores.set("methodology", 0);
    scores.set("factor_attribution", 0);
    scores.set("robustness", 0);
    return scores;
  }

  const verificationScores = synthesis.verificationScores || {};

  // Performance verification
  scores.set("performance", verificationScores.overall || 0.5);

  // Risk metrics
  scores.set("risk_metrics", verificationScores.securities || 0.5);

  // Methodology
  const branchResults = playbookResult?.branchResults || {};
  const claimVerification = branchResults.claimVerification;
  if (claimVerification) {
    const verifiedCount = claimVerification.claims?.filter((c: any) => c.verdict === "verified").length || 0;
    const totalClaims = claimVerification.claims?.length || 1;
    scores.set("methodology", verifiedCount / totalClaims);
  } else {
    scores.set("methodology", 0.5);
  }

  // Factor attribution
  scores.set("factor_attribution", verificationScores.entity || 0.5);

  // Robustness
  const hasGoodRecommendation = synthesis.recommendation === "proceed";
  scores.set("robustness", hasGoodRecommendation ? 0.8 : 0.4);

  return scores;
}
