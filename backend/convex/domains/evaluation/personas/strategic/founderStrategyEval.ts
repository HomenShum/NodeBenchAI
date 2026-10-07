/**
 * Founder Strategy Persona Evaluation
 *
 * Evaluates competitive intelligence and market analysis capabilities
 * for founders doing strategic planning.
 */

"use node";

import { action } from "../../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../../_generated/api";

import { DEVTOOLSAI_GROUND_TRUTH, type MarketAnalysisGroundTruth } from "./founderStrategyGroundTruth";
import {
  normalizeScores,
  mapToRawScores,
  buildEvalResult,
} from "../../scoring/scoringFramework";
import { FOUNDER_STRATEGY_SCORING } from "../../scoring/personaWeights";
import type { PersonaEvalResult } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate Founder Strategy persona against DevToolsAI ground truth
 */
export const evaluateFounderStrategy = action({
  args: {
    entityName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PersonaEvalResult> => {
    const entityName = args.entityName || DEVTOOLSAI_GROUND_TRUTH.entityName;
    const groundTruth = DEVTOOLSAI_GROUND_TRUTH;

    console.log(`[FOUNDER_STRATEGY_EVAL] Starting evaluation for ${entityName}...`);
    const startTime = Date.now();

    try {
      // Run investor playbook with founder context
      const playbookResult = await ctx.runAction(
        internal.domains.agents.dueDiligence.investorPlaybook.evalPlaybook.runInvestorPlaybookEval,
        {
          entityName,
          entityType: "company",
          persona: "FOUNDER_STRATEGY",
        }
      );

      // Extract and score results
      const scoreMap = extractFounderScores(playbookResult, groundTruth);
      const rawScores = mapToRawScores(scoreMap, FOUNDER_STRATEGY_SCORING);
      const normalizedScores = normalizeScores(rawScores, FOUNDER_STRATEGY_SCORING);
      const executionTimeMs = Date.now() - startTime;
      const result = buildEvalResult(
        "FOUNDER_STRATEGY",
        entityName,
        normalizedScores,
        executionTimeMs,
        "", // Report generated separately
        { playbookResult }
      );

      console.log(`[FOUNDER_STRATEGY_EVAL] Completed: ${result.normalizedScore}/100 (${result.passed ? "PASS" : "FAIL"})`);
      return result;
    } catch (error: any) {
      console.error(`[FOUNDER_STRATEGY_EVAL] Error:`, error);
      throw error;
    }
  },
});

/**
 * Mock evaluation for framework testing
 */
export const evaluateFounderStrategyMock = action({
  args: {},
  handler: async (): Promise<PersonaEvalResult> => {
    const groundTruth = DEVTOOLSAI_GROUND_TRUTH;
    const startTime = Date.now();

    // Generate mock scores based on expected outcome
    const rawScores = new Map<string, number>();
    const isPass = groundTruth.expectedOutcome === "pass";

    rawScores.set("market_sizing", isPass ? 0.85 : 0.4);
    rawScores.set("competitive_intel", isPass ? 0.88 : 0.35);
    rawScores.set("positioning", isPass ? 0.82 : 0.45);
    rawScores.set("gtm_clarity", isPass ? 0.78 : 0.5);
    rawScores.set("risk_assessment", isPass ? 0.75 : 0.55);

    const rawScoresArray = mapToRawScores(rawScores, FOUNDER_STRATEGY_SCORING);
    const normalizedScores = normalizeScores(rawScoresArray, FOUNDER_STRATEGY_SCORING);
    const executionTimeMs = Date.now() - startTime;
    const result = buildEvalResult(
      "FOUNDER_STRATEGY",
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

function extractFounderScores(
  playbookResult: any,
  groundTruth: MarketAnalysisGroundTruth
): Map<string, number> {
  const scores = new Map<string, number>();
  const synthesis = playbookResult?.synthesis;

  if (!synthesis) {
    scores.set("market_sizing", 0);
    scores.set("competitive_intel", 0);
    scores.set("positioning", 0);
    scores.set("gtm_clarity", 0);
    scores.set("risk_assessment", 0);
    return scores;
  }

  const verificationScores = synthesis.verificationScores || {};
  const branchResults = playbookResult?.branchResults || {};

  // Market sizing
  scores.set("market_sizing", verificationScores.overall || 0.5);

  // Competitive intelligence
  const newsVerification = branchResults.newsVerification;
  if (newsVerification) {
    scores.set("competitive_intel", 0.8);
  } else {
    scores.set("competitive_intel", 0.5);
  }

  // Positioning
  scores.set("positioning", verificationScores.entity || 0.5);

  // GTM clarity
  const claimVerification = branchResults.claimVerification;
  if (claimVerification) {
    const verifiedCount = claimVerification.claims?.filter((c: any) => c.verdict === "verified").length || 0;
    const totalClaims = claimVerification.claims?.length || 1;
    scores.set("gtm_clarity", verifiedCount / totalClaims);
  } else {
    scores.set("gtm_clarity", 0.5);
  }

  // Risk assessment
  const hasStopRules = synthesis.stopRules?.some((r: any) => r.triggered);
  scores.set("risk_assessment", hasStopRules ? 0.9 : 0.6);

  return scores;
}
