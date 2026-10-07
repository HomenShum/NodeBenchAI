/**
 * Macro Strategist Evaluation
 *
 * Evaluates the system's ability to produce macro analysis for strategists:
 * - Thesis coherence (event, expected move, rationale)
 * - Indicator accuracy (economic data verification)
 * - Risk comprehensiveness (upside, downside, tail)
 * - Positioning actionability
 *
 * Run via: npx convex run domains/evaluation/personas/strategic/macroStratEval:evaluate
 */

"use node";

import { action } from "../../../../_generated/server";
import { runInvestorPlaybook } from "../../../agents/dueDiligence/investorPlaybook/playbookOrchestrator";
import {
  normalizeScores,
  scoreBooleanChecks,
  buildEvalResult,
  generateScoreReport,
  type RawScoreInput,
} from "../../scoring/scoringFramework";
import { MACRO_STRATEGIST_SCORING } from "../../scoring/personaWeights";
import { FED_POLICY_GROUND_TRUTH } from "./strategicGroundTruth";
import type { PersonaEvalResult, CategoryFinding, MacroEventGroundTruth } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate Macro Strategist persona against Fed Policy ground truth
 */
export const evaluate = action({
  args: {},
  handler: async (ctx): Promise<PersonaEvalResult> => {
    const startTime = Date.now();
    const gt = FED_POLICY_GROUND_TRUTH;

    console.log(`[MACRO_STRAT_EVAL] Starting evaluation for ${gt.entityName}...`);

    // Run the playbook with macro-specific context
    const result = await runInvestorPlaybook(ctx, {
      entityName: gt.entityName,
      entityType: "company", // Map event to company for playbook
      claimVerificationMode: {
        enabled: true,
        rawQuery: buildMacroQuery(gt),
        newsEvent: gt.thesis.event,
      },
      signals: {
        isRequestingFunding: false,
        isClaimVerification: true,
        hasSpecificClaims: true,
      },
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[MACRO_STRAT_EVAL] Playbook completed in ${executionTimeMs}ms`);

    // Extract outputs for scoring
    const synthesis = result.synthesis;
    const branchResults = result.branchResults;

    // Score each category
    const rawScores: RawScoreInput[] = [];

    // 1. Thesis Coherence (25%)
    const thesisScore = scoreThesis(branchResults, synthesis, gt);
    rawScores.push({
      category: "Thesis Coherence",
      ...thesisScore,
    });

    // 2. Indicator Accuracy (25%)
    const indicatorScore = scoreIndicators(branchResults, synthesis, gt);
    rawScores.push({
      category: "Indicator Accuracy",
      ...indicatorScore,
    });

    // 3. Risk Comprehensiveness (25%)
    const riskScore = scoreRisks(synthesis, gt);
    rawScores.push({
      category: "Risk Comprehensiveness",
      ...riskScore,
    });

    // 4. Positioning Actionability (25%)
    const positioningScore = scorePositioning(synthesis, gt);
    rawScores.push({
      category: "Positioning Actionability",
      ...positioningScore,
    });

    // Normalize scores
    const scoringResult = normalizeScores(rawScores, MACRO_STRATEGIST_SCORING);

    // Build result
    const evalResult = buildEvalResult(
      "MACRO_STRATEGIST",
      `Fed Policy Q1 2026`,
      scoringResult,
      executionTimeMs,
      generateScoreReport({
        personaId: "MACRO_STRATEGIST",
        caseName: "Fed Policy Q1 2026",
        passed: scoringResult.passed,
        score: rawScores.reduce((sum, r) => sum + r.rawScore, 0),
        maxScore: rawScores.reduce((sum, r) => sum + r.maxPoints, 0),
        normalizedScore: scoringResult.totalScore,
        categoryScores: scoringResult.categoryScores,
        criticalFailures: scoringResult.criticalFailures,
        executionTimeMs,
        report: "",
        rawOutput: {},
      }),
      {
        synthesis,
        branchResults: Object.keys(branchResults),
        verificationScores: synthesis.verificationScores,
      }
    );

    console.log(`[MACRO_STRAT_EVAL] Score: ${evalResult.normalizedScore}/100 (${evalResult.passed ? "PASSED" : "FAILED"})`);

    return evalResult;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Score thesis coherence
 */
function scoreThesis(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: MacroEventGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const newsResults = branchResults.newsVerification as {
    eventVerified?: boolean;
  } | undefined;

  const checks = [
    {
      name: "Event Identified",
      passed: checkEvent(summary, newsResults, gt.thesis.event),
      points: 8,
      expected: gt.thesis.event,
      actual: summary.toLowerCase().includes("fed") || summary.toLowerCase().includes("fomc") ? "Identified" : "Not identified",
    },
    {
      name: "Expected Move",
      passed: checkExpectedMove(summary, claimResults, gt.thesis.expectedMove),
      points: 8,
      expected: gt.thesis.expectedMove,
      actual: extractExpectedMove(summary) || "Not found",
    },
    {
      name: "Rationale Clear",
      passed: checkRationale(summary, gt.thesis.rationale),
      points: 5,
      expected: "Clear rationale provided",
      actual: summary.length > 100 ? "Present" : "Missing",
    },
    {
      name: "Timeframe Specified",
      passed: checkTimeframe(summary, gt.thesis.timeframe),
      points: 4,
      expected: gt.thesis.timeframe,
      actual: extractTimeframe(summary) || "Not specified",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score indicator accuracy
 */
function scoreIndicators(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: MacroEventGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  // Check key indicators mentioned
  const cpiIndicator = gt.indicators.find(i => i.name.toLowerCase().includes("cpi"));
  const unemploymentIndicator = gt.indicators.find(i => i.name.toLowerCase().includes("unemployment"));

  const checks = [
    {
      name: "Key Indicators",
      passed: checkKeyIndicators(summary, claimResults, gt.indicators),
      points: 10,
      expected: `${gt.indicators.length} indicators`,
      actual: countIndicators(summary, gt.indicators).toString() + " mentioned",
    },
    {
      name: "Values Correct",
      passed: checkIndicatorValues(summary, claimResults, gt.indicators),
      points: 8,
      expected: cpiIndicator ? `CPI ${cpiIndicator.value}%` : "Indicators verified",
      actual: extractIndicatorValue(summary, "cpi") || "Not found",
    },
    {
      name: "Sources Cited",
      passed: checkSourcesCited(summary, gt.indicators),
      points: 7,
      expected: "BLS, BEA, FRED cited",
      actual: summary.toLowerCase().includes("bls") || summary.toLowerCase().includes("fred") ? "Cited" : "Not cited",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score risk comprehensiveness
 */
function scoreRisks(
  synthesis: { executiveSummary?: string },
  gt: MacroEventGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const checks = [
    {
      name: "Upside Risk",
      passed: checkUpsideRisk(summary, gt.risks.upside),
      points: 8,
      expected: "Upside risk discussed",
      actual: summary.toLowerCase().includes("upside") || summary.toLowerCase().includes("stronger") ? "Discussed" : "Not discussed",
    },
    {
      name: "Downside Risk",
      passed: checkDownsideRisk(summary, gt.risks.downside),
      points: 8,
      expected: "Downside risk discussed",
      actual: summary.toLowerCase().includes("downside") || summary.toLowerCase().includes("geopolit") ? "Discussed" : "Not discussed",
    },
    {
      name: "Tail Risk",
      passed: checkTailRisk(summary, gt.risks.tail),
      points: 5,
      expected: "Tail risk mentioned",
      actual: summary.toLowerCase().includes("tail") || summary.toLowerCase().includes("crisis") ? "Mentioned" : "Not mentioned",
    },
    {
      name: "Risk Quantified",
      passed: summary.match(/\d+\s*%/) !== null && summary.toLowerCase().includes("risk"),
      points: 4,
      expected: "Risks quantified",
      actual: summary.match(/\d+\s*%/) !== null ? "Quantified" : "Not quantified",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score positioning actionability
 */
function scorePositioning(
  synthesis: { executiveSummary?: string },
  gt: MacroEventGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const checks = [
    {
      name: "Positions Specified",
      passed: checkPositionsSpecified(summary, gt.positioning),
      points: 10,
      expected: `${gt.positioning.length} positions`,
      actual: countPositions(summary, gt.positioning).toString() + " specified",
    },
    {
      name: "Direction Clear",
      passed: checkDirectionClear(summary, gt.positioning),
      points: 8,
      expected: "Long/short/neutral specified",
      actual: (summary.toLowerCase().includes("long") || summary.toLowerCase().includes("short")) ? "Clear" : "Not clear",
    },
    {
      name: "Rationale Provided",
      passed: checkPositioningRationale(summary, gt.positioning),
      points: 7,
      expected: "Position rationale provided",
      actual: summary.toLowerCase().includes("because") || summary.toLowerCase().includes("given") ? "Provided" : "Not provided",
    },
  ];

  return scoreBooleanChecks(checks);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function buildMacroQuery(gt: MacroEventGroundTruth): string {
  const keyIndicators = gt.indicators.slice(0, 3).map(i => `${i.name}: ${i.value}${i.unit}`).join(", ");
  return `Analyze ${gt.thesis.event}: Current rate ${gt.thesis.currentLevel}, ` +
    `expected ${gt.thesis.expectedMove} with ${gt.thesis.confidence}% confidence. ` +
    `Key indicators: ${keyIndicators}. ` +
    `Assess risks and recommend positioning across rates, equities, FX, and commodities.`;
}

function checkEvent(
  summary: string,
  newsResults: { eventVerified?: boolean } | undefined,
  event: string
): boolean {
  const eventKeywords = ["fed", "fomc", "rate", "policy"];
  return eventKeywords.some(k => summary.toLowerCase().includes(k)) ||
    newsResults?.eventVerified === true;
}

function checkExpectedMove(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedMove: string
): boolean {
  // Check for rate cut mentions
  return summary.toLowerCase().includes("cut") ||
    summary.toLowerCase().includes("25") ||
    summary.toLowerCase().includes("basis point") ||
    summary.toLowerCase().includes("bps");
}

function extractExpectedMove(summary: string): string | null {
  const moveMatch = summary.match(/(-?\d+)\s*(?:bp|bps|basis point)/i);
  if (moveMatch) return `${moveMatch[1]}bps`;

  if (summary.toLowerCase().includes("cut")) {
    const amountMatch = summary.match(/(\d+)\s*(?:bp|bps)?/);
    return amountMatch ? `-${amountMatch[1]}bps` : "Cut expected";
  }

  return null;
}

function checkRationale(summary: string, rationale: string): boolean {
  // Check if rationale elements are present
  const rationaleKeywords = rationale.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  return rationaleKeywords.some(k => summary.toLowerCase().includes(k)) ||
    summary.length > 100;
}

function checkTimeframe(summary: string, timeframe: string): boolean {
  return summary.toLowerCase().includes("january") ||
    summary.toLowerCase().includes("2026") ||
    summary.toLowerCase().includes("q1");
}

function extractTimeframe(summary: string): string | null {
  const tfMatch = summary.match(/(january|february|march|q[1-4])\s*202\d/i);
  return tfMatch ? tfMatch[0] : null;
}

function checkKeyIndicators(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  indicators: Array<{ name: string }>
): boolean {
  return countIndicators(summary, indicators) >= 2;
}

function countIndicators(summary: string, indicators: Array<{ name: string }>): number {
  const summaryLower = summary.toLowerCase();
  const indicatorKeywords = ["cpi", "pce", "unemployment", "gdp", "wage", "inflation", "employment"];
  return indicatorKeywords.filter(k => summaryLower.includes(k)).length;
}

function checkIndicatorValues(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  indicators: Array<{ name: string; value: number }>
): boolean {
  // Check if any indicator values are mentioned
  const cpi = indicators.find(i => i.name.toLowerCase().includes("cpi"));
  if (cpi) {
    const cpiMatch = summary.match(/cpi[^0-9]*(\d+\.?\d*)\s*%?/i);
    if (cpiMatch && Math.abs(parseFloat(cpiMatch[1]) - cpi.value) < 0.5) return true;
  }

  // General check for percentage values
  return summary.match(/\d+\.?\d*\s*%/) !== null;
}

function extractIndicatorValue(summary: string, indicator: string): string | null {
  const pattern = new RegExp(`${indicator}[^0-9]*(\\d+\\.?\\d*)\\s*%?`, "i");
  const match = summary.match(pattern);
  return match ? `${match[1]}%` : null;
}

function checkSourcesCited(summary: string, indicators: Array<{ source: string }>): boolean {
  const sources = ["bls", "bea", "fred", "census", "treasury"];
  return sources.some(s => summary.toLowerCase().includes(s));
}

function checkUpsideRisk(summary: string, upside: string): boolean {
  return summary.toLowerCase().includes("upside") ||
    summary.toLowerCase().includes("stronger than expected") ||
    summary.toLowerCase().includes("surprise");
}

function checkDownsideRisk(summary: string, downside: string): boolean {
  return summary.toLowerCase().includes("downside") ||
    summary.toLowerCase().includes("geopolit") ||
    summary.toLowerCase().includes("shock") ||
    summary.toLowerCase().includes("recession");
}

function checkTailRisk(summary: string, tail: string): boolean {
  return summary.toLowerCase().includes("tail") ||
    summary.toLowerCase().includes("crisis") ||
    summary.toLowerCase().includes("black swan") ||
    summary.toLowerCase().includes("extreme");
}

function checkPositionsSpecified(
  summary: string,
  positioning: Array<{ asset: string; direction: string }>
): boolean {
  return countPositions(summary, positioning) >= 2;
}

function countPositions(
  summary: string,
  positioning: Array<{ asset: string; direction: string }>
): number {
  const summaryLower = summary.toLowerCase();
  let count = 0;

  for (const pos of positioning) {
    const assetKeywords = pos.asset.toLowerCase().split(/\s+/);
    if (assetKeywords.some(k => summaryLower.includes(k))) {
      count++;
    }
  }

  // Also check for generic position mentions
  const assetClasses = ["treasury", "bond", "equity", "stock", "currency", "fx", "gold", "commodity"];
  for (const asset of assetClasses) {
    if (summaryLower.includes(asset) &&
      (summaryLower.includes("long") || summaryLower.includes("short") || summaryLower.includes("neutral"))) {
      count++;
    }
  }

  return Math.min(count, positioning.length);
}

function checkDirectionClear(
  summary: string,
  positioning: Array<{ direction: string }>
): boolean {
  return summary.toLowerCase().includes("long") ||
    summary.toLowerCase().includes("short") ||
    summary.toLowerCase().includes("overweight") ||
    summary.toLowerCase().includes("underweight");
}

function checkPositioningRationale(
  summary: string,
  positioning: Array<{ rationale: string }>
): boolean {
  return summary.toLowerCase().includes("because") ||
    summary.toLowerCase().includes("given") ||
    summary.toLowerCase().includes("due to") ||
    summary.toLowerCase().includes("as a result");
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { FED_POLICY_GROUND_TRUTH };
