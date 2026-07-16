/**
 * CTO/Tech Lead Persona Evaluation
 *
 * Evaluates technical due diligence capabilities for CTOs and tech leads
 * assessing potential vendors, partners, or acquisition targets.
 */

"use node";

import { action } from "../../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../../_generated/api";

import { CLOUDSCALE_GROUND_TRUTH, type TechPlatformGroundTruth } from "./technicalGroundTruth";
import {
  normalizeScores,
  mapToRawScores,
  buildEvalResult,
  generateScoreReport,
} from "../../scoring/scoringFramework";
import { CTO_TECH_LEAD_SCORING } from "../../scoring/personaWeights";
import type { PersonaEvalResult } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate CTO/Tech Lead persona against CloudScale ground truth
 */
export const evaluateCTOTechLead = action({
  args: {
    entityName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PersonaEvalResult> => {
    const entityName = args.entityName || CLOUDSCALE_GROUND_TRUTH.entityName;
    const groundTruth = CLOUDSCALE_GROUND_TRUTH;

    console.log(`[CTO_EVAL] Starting evaluation for ${entityName}...`);
    const startTime = Date.now();

    try {
      // Run investor playbook with CTO context
      const playbookResult = await ctx.runAction(
        internal.domains.agents.dueDiligence.investorPlaybook.evalPlaybook.runInvestorPlaybookEval,
        {
          entityName,
          entityType: "company",
          persona: "CTO_TECH_LEAD",
        }
      );

      // Extract and score results
      const scoreMap = extractCTOScores(playbookResult, groundTruth);
      const rawScores = mapToRawScores(scoreMap, CTO_TECH_LEAD_SCORING);
      const normalizedScores = normalizeScores(rawScores, CTO_TECH_LEAD_SCORING);
      const executionTimeMs = Date.now() - startTime;
      const result = buildEvalResult(
        "CTO_TECH_LEAD",
        entityName,
        normalizedScores,
        executionTimeMs,
        "", // Report generated separately
        { playbookResult }
      );

      console.log(`[CTO_EVAL] Completed: ${result.normalizedScore}/100 (${result.passed ? "PASS" : "FAIL"})`);
      return result;
    } catch (error: any) {
      console.error(`[CTO_EVAL] Error:`, error);
      throw error;
    }
  },
});

/**
 * Mock evaluation for framework testing
 */
export const evaluateCTOTechLeadMock = action({
  args: {},
  handler: async (): Promise<PersonaEvalResult> => {
    const groundTruth = CLOUDSCALE_GROUND_TRUTH;
    const startTime = Date.now();

    // Generate mock scores based on expected outcome
    const rawScores = new Map<string, number>();
    const isPass = groundTruth.expectedOutcome === "pass";

    rawScores.set("tech_stack", isPass ? 0.85 : 0.4);
    rawScores.set("architecture", isPass ? 0.9 : 0.35);
    rawScores.set("security", isPass ? 0.88 : 0.45);
    rawScores.set("team", isPass ? 0.75 : 0.5);
    rawScores.set("devops", isPass ? 0.82 : 0.4);

    const rawScoresArray = mapToRawScores(rawScores, CTO_TECH_LEAD_SCORING);
    const normalizedScores = normalizeScores(rawScoresArray, CTO_TECH_LEAD_SCORING);
    const executionTimeMs = Date.now() - startTime;
    const result = buildEvalResult(
      "CTO_TECH_LEAD",
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

function extractCTOScores(
  playbookResult: any,
  groundTruth: TechPlatformGroundTruth
): Map<string, number> {
  const scores = new Map<string, number>();
  const synthesis = playbookResult?.synthesis;

  if (!synthesis) {
    scores.set("tech_stack", 0);
    scores.set("architecture", 0);
    scores.set("security", 0);
    scores.set("team", 0);
    scores.set("devops", 0);
    return scores;
  }

  // Tech stack verification
  const verificationScores = synthesis.verificationScores || {};
  scores.set("tech_stack", verificationScores.patents || 0.5);

  // Architecture assessment
  scores.set("architecture", verificationScores.overall || 0.5);

  // Security & compliance
  scores.set("security", verificationScores.entity || 0.5);

  // Team metrics
  scores.set("team", synthesis.entityVerification?.verification?.entityExists ? 0.7 : 0.3);

  // DevOps maturity
  const hasGoodRecommendation = synthesis.recommendation === "proceed";
  scores.set("devops", hasGoodRecommendation ? 0.8 : 0.4);

  return scores;
}
