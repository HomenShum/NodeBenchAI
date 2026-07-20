/**
 * Corp Dev Evaluation
 *
 * Evaluates the system's ability to produce M&A analysis for Corp Dev:
 * - Deal facts verification (parties, value, type, status)
 * - Strategic rationale (synergies, market position)
 * - Risk identification (regulatory, integration, cultural)
 * - Timeline assessment
 *
 * Run via: npx convex run domains/evaluation/personas/strategic/corpDevEval:evaluate
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
import { CORP_DEV_SCORING } from "../../scoring/personaWeights";
import { ACME_WIDGETCO_GROUND_TRUTH } from "./strategicGroundTruth";
import type { PersonaEvalResult, CategoryFinding, MADealGroundTruth } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate Corp Dev persona against Acme-WidgetCo ground truth
 */
export const evaluate = action({
  args: {},
  handler: async (ctx): Promise<PersonaEvalResult> => {
    const startTime = Date.now();
    const gt = ACME_WIDGETCO_GROUND_TRUTH;

    console.log(`[CORP_DEV_EVAL] Starting evaluation for ${gt.entityName}...`);

    // Run the playbook with corp dev-specific context
    const result = await runInvestorPlaybook(ctx, {
      entityName: gt.deal.target,
      entityType: "company",
      claimVerificationMode: {
        enabled: true,
        rawQuery: buildCorpDevQuery(gt),
        newsEvent: `${gt.deal.acquirer} acquisition of ${gt.deal.target}`,
        acquisitionAcquirer: gt.deal.acquirer,
        acquisitionTarget: gt.deal.target,
      },
      signals: {
        isRequestingFunding: false,
        isClaimVerification: true,
        hasSpecificClaims: true,
      },
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[CORP_DEV_EVAL] Playbook completed in ${executionTimeMs}ms`);

    // Extract outputs for scoring
    const synthesis = result.synthesis;
    const branchResults = result.branchResults;

    // Score each category
    const rawScores: RawScoreInput[] = [];

    // 1. Deal Facts Verification (30%)
    const dealFactsScore = scoreDealFacts(branchResults, synthesis, gt);
    rawScores.push({
      category: "Deal Facts Verification",
      ...dealFactsScore,
    });

    // 2. Strategic Rationale (25%)
    const rationaleScore = scoreRationale(branchResults, synthesis, gt);
    rawScores.push({
      category: "Strategic Rationale",
      ...rationaleScore,
    });

    // 3. Risk Identification (25%)
    const riskScore = scoreRisks(branchResults, synthesis, gt);
    rawScores.push({
      category: "Risk Identification",
      ...riskScore,
    });

    // 4. Timeline Assessment (20%)
    const timelineScore = scoreTimeline(branchResults, synthesis, gt);
    rawScores.push({
      category: "Timeline Assessment",
      ...timelineScore,
    });

    // Normalize scores
    const scoringResult = normalizeScores(rawScores, CORP_DEV_SCORING);

    // Build result
    const evalResult = buildEvalResult(
      "CORP_DEV",
      `Acme-WidgetCo Acquisition`,
      scoringResult,
      executionTimeMs,
      generateScoreReport({
        personaId: "CORP_DEV",
        caseName: "Acme-WidgetCo Acquisition",
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

    console.log(`[CORP_DEV_EVAL] Score: ${evalResult.normalizedScore}/100 (${evalResult.passed ? "PASSED" : "FAILED"})`);

    return evalResult;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Score deal facts verification
 */
function scoreDealFacts(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: MADealGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const newsResults = branchResults.newsVerification as {
    eventVerified?: boolean;
    acquisitionDetails?: {
      acquirer?: string;
      target?: string;
      dealValue?: string;
    };
  } | undefined;

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Acquirer Correct",
      passed: checkAcquirer(summary, newsResults, claimResults, gt.deal.acquirer),
      points: 8,
      expected: gt.deal.acquirer,
      actual: extractParty(summary, newsResults, "acquirer") || "Not found",
    },
    {
      name: "Target Correct",
      passed: checkTarget(summary, newsResults, claimResults, gt.deal.target),
      points: 8,
      expected: gt.deal.target,
      actual: extractParty(summary, newsResults, "target") || "Not found",
    },
    {
      name: "Deal Value",
      passed: checkDealValue(summary, newsResults, claimResults, gt.deal.dealValue),
      points: 7,
      expected: gt.deal.dealValue,
      actual: extractDealValue(summary, newsResults) || "Not found",
    },
    {
      name: "Deal Type",
      passed: checkDealType(summary, claimResults, gt.deal.dealType),
      points: 4,
      expected: gt.deal.dealType,
      actual: extractDealType(summary) || "Not found",
    },
    {
      name: "Status Correct",
      passed: checkDealStatus(summary, newsResults, gt.deal.dealStatus),
      points: 3,
      expected: gt.deal.dealStatus,
      actual: extractDealStatus(summary) || "Not found",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score strategic rationale
 */
function scoreRationale(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: MADealGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Synergies Identified",
      passed: checkSynergies(summary, claimResults, gt.strategicRationale.synergies),
      points: 10,
      expected: gt.strategicRationale.synergies,
      actual: extractSynergies(summary) || "Not found",
    },
    {
      name: "Market Position Impact",
      passed: checkMarketPosition(summary, gt.strategicRationale.marketPositionImpact),
      points: 8,
      expected: gt.strategicRationale.marketPositionImpact,
      actual: summary.toLowerCase().includes("market") || summary.toLowerCase().includes("leader") ? "Discussed" : "Not discussed",
    },
    {
      name: "Technology/Talent",
      passed: checkTechTalent(summary, gt.strategicRationale),
      points: 7,
      expected: "Technology and/or talent acquisition discussed",
      actual: (summary.toLowerCase().includes("technolog") || summary.toLowerCase().includes("talent")) ? "Discussed" : "Not discussed",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score risk identification
 */
function scoreRisks(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string; discrepancies?: Array<{ field: string; severity: string }> },
  gt: MADealGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const checks = [
    {
      name: "Regulatory Risk",
      passed: checkRegulatoryRisk(summary, gt.risks.regulatoryRisk),
      points: 8,
      expected: gt.risks.regulatoryRisk,
      actual: summary.toLowerCase().includes("regulator") || summary.toLowerCase().includes("ftc") || summary.toLowerCase().includes("antitrust") ? "Identified" : "Not identified",
    },
    {
      name: "Integration Risk",
      passed: checkIntegrationRisk(summary, gt.risks.integrationRisk),
      points: 8,
      expected: "Integration risk discussed",
      actual: summary.toLowerCase().includes("integrat") ? "Identified" : "Not identified",
    },
    {
      name: "Cultural Risk",
      passed: checkCulturalRisk(summary, gt.risks.culturalRisk),
      points: 5,
      expected: gt.risks.culturalRisk,
      actual: summary.toLowerCase().includes("cultur") || summary.toLowerCase().includes("remote") ? "Identified" : "Not identified",
    },
    {
      name: "Financing Risk",
      passed: checkFinancingRisk(summary, gt.risks.financingRisk),
      points: 4,
      expected: gt.risks.financingRisk || "Financing discussed",
      actual: summary.toLowerCase().includes("financ") || summary.toLowerCase().includes("debt") || summary.toLowerCase().includes("loan") ? "Identified" : "Not identified",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score timeline assessment
 */
function scoreTimeline(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: MADealGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const newsResults = branchResults.newsVerification as {
    acquisitionDetails?: {
      expectedClose?: string;
      announcementDate?: string;
    };
  } | undefined;

  const checks = [
    {
      name: "Close Date",
      passed: checkCloseDate(summary, newsResults, gt.deal.expectedClose),
      points: 8,
      expected: gt.deal.expectedClose,
      actual: extractTimeline(summary, "close") || "Not found",
    },
    {
      name: "Announcement Date",
      passed: checkAnnouncementDate(summary, newsResults, gt.deal.announcementDate),
      points: 6,
      expected: gt.deal.announcementDate,
      actual: extractTimeline(summary, "announced") || "Not found",
    },
    {
      name: "Integration Timeline",
      passed: summary.toLowerCase().includes("integrat") && (summary.match(/\d+\s*(?:month|year)/i) !== null || summary.toLowerCase().includes("timeline")),
      points: 6,
      expected: "Integration timeline discussed",
      actual: summary.toLowerCase().includes("integrat") ? "Mentioned" : "Not mentioned",
    },
  ];

  return scoreBooleanChecks(checks);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function buildCorpDevQuery(gt: MADealGroundTruth): string {
  return `Analyze ${gt.deal.acquirer} acquisition of ${gt.deal.target}: ` +
    `${gt.deal.dealValue} ${gt.deal.dealType} deal announced ${gt.deal.announcementDate}. ` +
    `Expected close ${gt.deal.expectedClose}. ` +
    `Verify deal facts, assess strategic rationale (${gt.strategicRationale.synergies} synergies), ` +
    `and identify key risks (regulatory, integration, cultural).`;
}

function checkAcquirer(
  summary: string,
  newsResults: { acquisitionDetails?: { acquirer?: string } } | undefined,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expected: string
): boolean {
  if (newsResults?.acquisitionDetails?.acquirer?.toLowerCase().includes(expected.toLowerCase())) return true;
  return summary.toLowerCase().includes(expected.toLowerCase());
}

function checkTarget(
  summary: string,
  newsResults: { acquisitionDetails?: { target?: string } } | undefined,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expected: string
): boolean {
  if (newsResults?.acquisitionDetails?.target?.toLowerCase().includes(expected.toLowerCase())) return true;
  return summary.toLowerCase().includes(expected.toLowerCase());
}

function extractParty(
  summary: string,
  newsResults: { acquisitionDetails?: { acquirer?: string; target?: string } } | undefined,
  type: "acquirer" | "target"
): string | null {
  if (type === "acquirer" && newsResults?.acquisitionDetails?.acquirer) {
    return newsResults.acquisitionDetails.acquirer;
  }
  if (type === "target" && newsResults?.acquisitionDetails?.target) {
    return newsResults.acquisitionDetails.target;
  }
  return null;
}

function checkDealValue(
  summary: string,
  newsResults: { acquisitionDetails?: { dealValue?: string } } | undefined,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expected: string
): boolean {
  const expectedNum = parseFloat(expected.replace(/[^0-9.]/g, ""));

  // Check news results
  if (newsResults?.acquisitionDetails?.dealValue) {
    const actualNum = parseFloat(newsResults.acquisitionDetails.dealValue.replace(/[^0-9.]/g, ""));
    if (Math.abs(actualNum - expectedNum) / expectedNum < 0.1) return true;
  }

  // Check summary for value mention
  const valueMatch = summary.match(/\$(\d+\.?\d*)\s*(?:billion|bn|b)/i);
  if (valueMatch) {
    const actualNum = parseFloat(valueMatch[1]);
    if (Math.abs(actualNum - expectedNum) / expectedNum < 0.1) return true;
  }

  return false;
}

function extractDealValue(
  summary: string,
  newsResults: { acquisitionDetails?: { dealValue?: string } } | undefined
): string | null {
  if (newsResults?.acquisitionDetails?.dealValue) {
    return newsResults.acquisitionDetails.dealValue;
  }
  const match = summary.match(/\$(\d+\.?\d*)\s*(?:billion|bn|b)/i);
  return match ? `$${match[1]}B` : null;
}

function checkDealType(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expected: string
): boolean {
  const typeLower = expected.toLowerCase();
  const summaryLower = summary.toLowerCase();

  if (typeLower.includes("cash") && summaryLower.includes("cash")) return true;
  if (typeLower.includes("stock") && summaryLower.includes("stock")) return true;
  if (typeLower.includes("asset") && summaryLower.includes("asset")) return true;

  return false;
}

function extractDealType(summary: string): string | null {
  if (summary.toLowerCase().includes("all-cash") || summary.toLowerCase().includes("all cash")) return "All-cash";
  if (summary.toLowerCase().includes("stock")) return "Stock";
  if (summary.toLowerCase().includes("cash and stock")) return "Cash+Stock";
  return null;
}

function checkDealStatus(
  summary: string,
  newsResults: { eventVerified?: boolean } | undefined,
  expected: string
): boolean {
  const statusLower = expected.toLowerCase();
  const summaryLower = summary.toLowerCase();

  if (statusLower === "pending" && (summaryLower.includes("pending") || summaryLower.includes("expected"))) return true;
  if (statusLower === "closed" && summaryLower.includes("closed")) return true;
  if (statusLower === "announced" && summaryLower.includes("announced")) return true;

  return newsResults?.eventVerified === true;
}

function extractDealStatus(summary: string): string | null {
  if (summary.toLowerCase().includes("pending")) return "Pending";
  if (summary.toLowerCase().includes("closed")) return "Closed";
  if (summary.toLowerCase().includes("announced")) return "Announced";
  return null;
}

function checkSynergies(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expected: string
): boolean {
  return summary.toLowerCase().includes("synerg") || summary.toLowerCase().includes("cost sav");
}

function extractSynergies(summary: string): string | null {
  const match = summary.match(/\$?(\d+)\s*(?:million|mn|m)?\s*(?:annual)?\s*(?:synerg|cost sav)/i);
  return match ? `$${match[1]}M synergies` : null;
}

function checkMarketPosition(summary: string, expected: string): boolean {
  return summary.toLowerCase().includes("market") ||
    summary.toLowerCase().includes("leader") ||
    summary.toLowerCase().includes("position");
}

function checkTechTalent(
  summary: string,
  rationale: { technologyAcquisition?: boolean; talentAcquisition?: boolean }
): boolean {
  const hasTech = summary.toLowerCase().includes("technolog") || summary.toLowerCase().includes("ip");
  const hasTalent = summary.toLowerCase().includes("talent") || summary.toLowerCase().includes("team");

  if (rationale.technologyAcquisition && rationale.talentAcquisition) {
    return hasTech || hasTalent;
  }
  if (rationale.technologyAcquisition) return hasTech;
  if (rationale.talentAcquisition) return hasTalent;
  return true;
}

function checkRegulatoryRisk(summary: string, expected: string): boolean {
  return summary.toLowerCase().includes("regulator") ||
    summary.toLowerCase().includes("ftc") ||
    summary.toLowerCase().includes("antitrust") ||
    summary.toLowerCase().includes("doj");
}

function checkIntegrationRisk(summary: string, expected: string): boolean {
  return summary.toLowerCase().includes("integrat");
}

function checkCulturalRisk(summary: string, expected: string): boolean {
  return summary.toLowerCase().includes("cultur") ||
    summary.toLowerCase().includes("remote") ||
    summary.toLowerCase().includes("hybrid");
}

function checkFinancingRisk(summary: string, expected?: string): boolean {
  return summary.toLowerCase().includes("financ") ||
    summary.toLowerCase().includes("debt") ||
    summary.toLowerCase().includes("loan") ||
    summary.toLowerCase().includes("lever");
}

function checkCloseDate(
  summary: string,
  newsResults: { acquisitionDetails?: { expectedClose?: string } } | undefined,
  expected: string
): boolean {
  if (newsResults?.acquisitionDetails?.expectedClose) return true;
  return summary.toLowerCase().includes(expected.toLowerCase()) ||
    summary.toLowerCase().includes("close") ||
    summary.match(/q[1-4]\s*202\d/i) !== null;
}

function checkAnnouncementDate(
  summary: string,
  newsResults: { acquisitionDetails?: { announcementDate?: string } } | undefined,
  expected: string
): boolean {
  if (newsResults?.acquisitionDetails?.announcementDate) return true;
  return summary.toLowerCase().includes("announced") ||
    summary.toLowerCase().includes("december") ||
    summary.match(/\d{4}-\d{2}-\d{2}/) !== null;
}

function extractTimeline(summary: string, type: string): string | null {
  if (type === "close") {
    const match = summary.match(/(?:close|closing)[^.]*?(q[1-4]\s*202\d|202\d)/i);
    return match ? match[1] : null;
  }
  if (type === "announced") {
    const match = summary.match(/(?:announced|announcement)[^.]*?(\d{4}-\d{2}-\d{2}|[a-z]+\s*\d{4})/i);
    return match ? match[1] : null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { ACME_WIDGETCO_GROUND_TRUTH };
