/**
 * Journalist Persona Evaluation
 *
 * Evaluates fact-checking and source verification capabilities for journalists
 * covering tech, business, and market news.
 */

"use node";

import { action } from "../../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../../_generated/api";

import { VIRALTECH_LAYOFFS_GROUND_TRUTH, type NewsStoryGroundTruth } from "./mediaGroundTruth";
import {
  normalizeScores,
  mapToRawScores,
  buildEvalResult,
  generateScoreReport,
} from "../../scoring/scoringFramework";
import { JOURNALIST_SCORING } from "../../scoring/personaWeights";
import type { PersonaEvalResult } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate Journalist persona against ViralTech Layoffs ground truth
 */
export const evaluateJournalist = action({
  args: {
    entityName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PersonaEvalResult> => {
    const entityName = args.entityName || VIRALTECH_LAYOFFS_GROUND_TRUTH.entityName;
    const groundTruth = VIRALTECH_LAYOFFS_GROUND_TRUTH;

    console.log(`[JOURNALIST_EVAL] Starting evaluation for ${entityName}...`);
    const startTime = Date.now();

    try {
      // Run investor playbook with journalist context (claim + news verification)
      const playbookResult = await ctx.runAction(
        internal.domains.agents.dueDiligence.investorPlaybook.evalPlaybook.runInvestorPlaybookEval,
        {
          entityName: groundTruth.story.subject,
          entityType: "company",
          persona: "JOURNALIST",
        }
      );

      // Extract and score results
      const scoreMap = extractJournalistScores(playbookResult, groundTruth);
      const rawScores = mapToRawScores(scoreMap, JOURNALIST_SCORING);
      const normalizedScores = normalizeScores(rawScores, JOURNALIST_SCORING);
      const executionTimeMs = Date.now() - startTime;
      const result = buildEvalResult(
        "JOURNALIST",
        entityName,
        normalizedScores,
        executionTimeMs,
        "", // Report generated separately
        { playbookResult }
      );

      console.log(`[JOURNALIST_EVAL] Completed: ${result.normalizedScore}/100 (${result.passed ? "PASS" : "FAIL"})`);
      return result;
    } catch (error: any) {
      console.error(`[JOURNALIST_EVAL] Error:`, error);
      throw error;
    }
  },
});

/**
 * Mock evaluation for framework testing
 */
export const evaluateJournalistMock = action({
  args: {},
  handler: async (): Promise<PersonaEvalResult> => {
    const groundTruth = VIRALTECH_LAYOFFS_GROUND_TRUTH;
    const startTime = Date.now();

    // Generate mock scores based on expected outcome
    const rawScores = new Map<string, number>();
    const isPass = groundTruth.expectedOutcome === "pass";

    rawScores.set("fact_verification", isPass ? 0.9 : 0.4);
    rawScores.set("source_quality", isPass ? 0.85 : 0.35);
    rawScores.set("conflict_detection", isPass ? 0.88 : 0.5);
    rawScores.set("context", isPass ? 0.75 : 0.45);
    rawScores.set("attribution", isPass ? 0.92 : 0.4);

    const rawScoresArray = mapToRawScores(rawScores, JOURNALIST_SCORING);
    const normalizedScores = normalizeScores(rawScoresArray, JOURNALIST_SCORING);
    const executionTimeMs = Date.now() - startTime;
    const result = buildEvalResult(
      "JOURNALIST",
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

function extractJournalistScores(
  playbookResult: any,
  groundTruth: NewsStoryGroundTruth
): Map<string, number> {
  const scores = new Map<string, number>();
  const synthesis = playbookResult?.synthesis;

  if (!synthesis) {
    scores.set("fact_verification", 0);
    scores.set("source_quality", 0);
    scores.set("conflict_detection", 0);
    scores.set("context", 0);
    scores.set("attribution", 0);
    return scores;
  }

  const branchResults = playbookResult?.branchResults || {};

  // Fact verification - from claim verification branch
  const claimVerification = branchResults.claimVerification;
  if (claimVerification) {
    const verifiedCount = claimVerification.claims?.filter((c: any) => c.verdict === "verified").length || 0;
    const totalClaims = claimVerification.claims?.length || 1;
    scores.set("fact_verification", verifiedCount / totalClaims);
  } else {
    scores.set("fact_verification", 0.5);
  }

  // Source quality - from news verification branch
  const newsVerification = branchResults.newsVerification;
  if (newsVerification) {
    const tier1Count = newsVerification.tier1Sources?.length || 0;
    scores.set("source_quality", Math.min(1, tier1Count / 2 + 0.3));
  } else {
    scores.set("source_quality", 0.4);
  }

  // Conflict detection
  const hasConflicts = newsVerification?.contradictions?.length > 0;
  scores.set("conflict_detection", hasConflicts ? 0.9 : 0.7);

  // Context
  scores.set("context", synthesis.verificationScores?.entity || 0.5);

  // Attribution
  const sourcesCount = synthesis.sources?.length || 0;
  scores.set("attribution", Math.min(1, sourcesCount / 5));

  return scores;
}
