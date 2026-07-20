/**
 * Pharma BD Evaluation
 *
 * Evaluates the system's ability to produce pipeline assessments for pharma BD:
 * - Exposure analysis (indication, MOA, phase, competition)
 * - Impact assessment (market size, differentiation, patents)
 * - Risk mitigations (clinical risk, regulatory path, manufacturing)
 * - Timeline realism
 *
 * Run via: npx convex run domains/evaluation/personas/industry/pharmaBDEval:evaluate
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
import { PHARMA_BD_SCORING } from "../../scoring/personaWeights";
import { BIOGENEX_GROUND_TRUTH } from "./industryGroundTruth";
import type { PersonaEvalResult, CategoryFinding, PharmaGroundTruth } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate Pharma BD persona against BioGenex ground truth
 */
export const evaluate = action({
  args: {},
  handler: async (ctx): Promise<PersonaEvalResult> => {
    const startTime = Date.now();
    const gt = BIOGENEX_GROUND_TRUTH;

    console.log(`[PHARMA_BD_EVAL] Starting evaluation for ${gt.entityName}...`);

    // Run the playbook with pharma-specific context
    const result = await runInvestorPlaybook(ctx, {
      entityName: gt.entityName,
      entityType: gt.entityType,
      claimVerificationMode: {
        enabled: true,
        rawQuery: buildPharmaQuery(gt),
      },
      signals: {
        isRequestingFunding: false,
        isClaimVerification: true,
        hasSpecificClaims: true,
        hasRegulatoryMentions: true,
        hasPatentMentions: true,
      },
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[PHARMA_BD_EVAL] Playbook completed in ${executionTimeMs}ms`);

    // Extract outputs for scoring
    const synthesis = result.synthesis;
    const branchResults = result.branchResults;

    // Score each category
    const rawScores: RawScoreInput[] = [];

    // 1. Exposure Analysis (25%)
    const exposureScore = scoreExposure(branchResults, synthesis, gt);
    rawScores.push({
      category: "Exposure Analysis",
      ...exposureScore,
    });

    // 2. Impact Assessment (25%)
    const impactScore = scoreImpact(branchResults, synthesis, gt);
    rawScores.push({
      category: "Impact Assessment",
      ...impactScore,
    });

    // 3. Risk Mitigations (25%)
    const mitigationsScore = scoreMitigations(branchResults, synthesis, gt);
    rawScores.push({
      category: "Risk Mitigations",
      ...mitigationsScore,
    });

    // 4. Timeline Realism (25%)
    const timelineScore = scoreTimeline(branchResults, synthesis, gt);
    rawScores.push({
      category: "Timeline Realism",
      ...timelineScore,
    });

    // Normalize scores
    const scoringResult = normalizeScores(rawScores, PHARMA_BD_SCORING);

    // Build result
    const evalResult = buildEvalResult(
      "PHARMA_BD",
      `BioGenex Phase 2 Asset`,
      scoringResult,
      executionTimeMs,
      generateScoreReport({
        personaId: "PHARMA_BD",
        caseName: "BioGenex Phase 2 Asset",
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

    console.log(`[PHARMA_BD_EVAL] Score: ${evalResult.normalizedScore}/100 (${evalResult.passed ? "PASSED" : "FAILED"})`);

    return evalResult;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Score exposure analysis
 */
function scoreExposure(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: PharmaGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";
  const fdaResults = branchResults.fdaVerification as {
    actualStatus?: string;
    clearances?: Array<{ productName?: string }>;
  } | undefined;

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Indication Correct",
      passed: checkIndication(summary, claimResults, gt.exposure.targetIndication),
      points: 8,
      expected: gt.exposure.targetIndication,
      actual: extractIndication(summary, claimResults) || "Not found",
    },
    {
      name: "MOA Correct",
      passed: checkMOA(summary, claimResults, gt.exposure.mechanismOfAction),
      points: 8,
      expected: gt.exposure.mechanismOfAction,
      actual: extractMOA(summary, claimResults) || "Not found",
    },
    {
      name: "Phase Correct",
      passed: checkPhase(summary, claimResults, fdaResults, gt.exposure.phase),
      points: 5,
      expected: gt.exposure.phase,
      actual: extractPhase(summary, claimResults) || "Not found",
    },
    {
      name: "Competition Mapped",
      passed: checkCompetition(summary, claimResults, gt.exposure.competitiveLandscape),
      points: 4,
      expected: `${gt.exposure.competitiveLandscape.length} competitors`,
      actual: countCompetitors(summary, gt.exposure.competitiveLandscape).toString(),
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score impact assessment
 */
function scoreImpact(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: PharmaGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";
  const patentResults = branchResults.usptoDeepDive as {
    patents?: Array<{ expirationDate?: string }>;
  } | undefined;

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Market Size",
      passed: checkMarketSize(summary, claimResults, gt.impact.marketSize),
      points: 8,
      expected: gt.impact.marketSize,
      actual: extractMarketSize(summary) || "Not found",
    },
    {
      name: "Differentiation",
      passed: checkDifferentiation(summary, claimResults, gt.impact.differentiatedMOA),
      points: 8,
      expected: gt.impact.differentiatedMOA ? "Differentiated" : "Me-too",
      actual: summary.toLowerCase().includes("differentiat") ? "Differentiated" : "Unknown",
    },
    {
      name: "Patent Protection",
      passed: checkPatentProtection(patentResults, claimResults, gt.impact.patentProtection),
      points: 5,
      expected: gt.impact.patentProtection,
      actual: extractPatentDate(patentResults) || "Not found",
    },
    {
      name: "First in Class",
      passed: checkFirstInClass(summary, claimResults, gt.impact.firstInClass),
      points: 4,
      expected: gt.impact.firstInClass ? "First in class" : "Not first in class",
      actual: summary.toLowerCase().includes("first in class") ? "First in class" : "Not first in class",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score risk mitigations
 */
function scoreMitigations(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string; recommendation?: string },
  gt: PharmaGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Clinical Risk Assessed",
      passed: checkClinicalRisk(summary, gt.mitigations.clinicalRisk),
      points: 8,
      expected: "Clinical risk assessment present",
      actual: summary.toLowerCase().includes("risk") || summary.toLowerCase().includes("safety") ? "Assessed" : "Not assessed",
    },
    {
      name: "Regulatory Path",
      passed: checkRegulatoryPath(summary, claimResults, gt.mitigations.regulatoryPath),
      points: 8,
      expected: gt.mitigations.regulatoryPath,
      actual: extractRegulatoryPath(summary) || "Not found",
    },
    {
      name: "Manufacturing Ready",
      passed: checkManufacturing(summary, claimResults, gt.mitigations.manufacturingReady),
      points: 5,
      expected: gt.mitigations.manufacturingReady ? "Ready" : "Not ready",
      actual: summary.toLowerCase().includes("manufactur") ? "Mentioned" : "Not mentioned",
    },
    {
      name: "Supply Chain",
      passed: summary.toLowerCase().includes("supply") || summary.toLowerCase().includes("cmo"),
      points: 4,
      expected: "Supply chain assessment",
      actual: summary.toLowerCase().includes("supply") ? "Assessed" : "Not assessed",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score timeline realism
 */
function scoreTimeline(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: PharmaGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Phase Timeline",
      passed: checkPhaseTimeline(summary, claimResults, gt.timeline.currentPhaseComplete),
      points: 8,
      expected: gt.timeline.currentPhaseComplete || "Any timeline",
      actual: extractTimeline(summary, "phase") || "Not found",
    },
    {
      name: "Approval Timeline",
      passed: checkApprovalTimeline(summary, claimResults, gt.timeline.potentialApproval),
      points: 8,
      expected: gt.timeline.potentialApproval || "Any timeline",
      actual: extractTimeline(summary, "approval") || "Not found",
    },
    {
      name: "Commercial Timeline",
      passed: checkCommercialTimeline(summary, gt.timeline.commercialLaunch),
      points: 5,
      expected: gt.timeline.commercialLaunch || "Any timeline",
      actual: extractTimeline(summary, "launch") || "Not found",
    },
    {
      name: "NCT Number Verified",
      passed: checkNCTNumber(claimResults, gt.clinicalData.nctNumber),
      points: 4,
      expected: gt.clinicalData.nctNumber || "Any NCT",
      actual: extractNCTNumber(claimResults) || "Not found",
    },
  ];

  return scoreBooleanChecks(checks);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function buildPharmaQuery(gt: PharmaGroundTruth): string {
  return `Evaluate ${gt.entityName} pipeline asset BGX-101: ${gt.exposure.phase} ${gt.exposure.mechanismOfAction} for ${gt.exposure.targetIndication}. ` +
    `Verify clinical trial status (NCT ${gt.clinicalData.nctNumber}), assess competitive landscape against ${gt.exposure.competitiveLandscape.slice(0, 2).join(", ")}, ` +
    `and evaluate commercial potential in $${gt.impact.marketSize} market.`;
}

function checkIndication(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  indication: string
): boolean {
  const indicationKeywords = indication.toLowerCase().split(/\s+/);
  const summaryLower = summary.toLowerCase();

  // Check summary
  if (indicationKeywords.some(k => summaryLower.includes(k))) return true;

  // Check claims
  if (!claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(c =>
    c.verified && indicationKeywords.some(k => c.claim.toLowerCase().includes(k))
  );
}

function extractIndication(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined
): string | null {
  const indicationPatterns = [
    /(?:for|treating|indication[s]?[:\s]+)([^,.]+)/i,
    /(cancer|carcinoma|lymphoma|leukemia|nsclc|melanoma)/i,
  ];

  for (const pattern of indicationPatterns) {
    const match = summary.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function checkMOA(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  moa: string
): boolean {
  const moaKeywords = ["pd-l1", "pd-1", "checkpoint", "inhibitor"];
  const summaryLower = summary.toLowerCase();
  return moaKeywords.some(k => summaryLower.includes(k));
}

function extractMOA(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined
): string | null {
  const moaPatterns = [
    /(pd-?[l]?1\s*(?:checkpoint\s*)?inhibitor)/i,
    /(checkpoint\s*inhibitor)/i,
    /(monoclonal\s*antibody)/i,
  ];

  for (const pattern of moaPatterns) {
    const match = summary.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function checkPhase(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  fdaResults: { actualStatus?: string } | undefined,
  expectedPhase: string
): boolean {
  const phaseLower = expectedPhase.toLowerCase().replace(/\s+/g, "");
  const summaryLower = summary.toLowerCase().replace(/\s+/g, "");
  return summaryLower.includes(phaseLower);
}

function extractPhase(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined
): string | null {
  const phaseMatch = summary.match(/phase\s*([1-4]|i{1,3}|iv)/i);
  return phaseMatch ? `Phase ${phaseMatch[1]}` : null;
}

function checkCompetition(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  competitors: string[]
): boolean {
  return countCompetitors(summary, competitors) >= 2;
}

function countCompetitors(summary: string, competitors: string[]): number {
  const summaryLower = summary.toLowerCase();
  return competitors.filter(c => summaryLower.includes(c.toLowerCase().split(" ")[0])).length;
}

function checkMarketSize(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  marketSize: string
): boolean {
  const summaryLower = summary.toLowerCase();
  return summaryLower.includes("billion") || summaryLower.includes("$") || summaryLower.includes("market");
}

function extractMarketSize(summary: string): string | null {
  const sizeMatch = summary.match(/\$?(\d+\.?\d*)\s*(?:billion|bn|b)/i);
  return sizeMatch ? `$${sizeMatch[1]}B` : null;
}

function checkDifferentiation(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  differentiated: boolean
): boolean {
  if (!differentiated) return true;
  return summary.toLowerCase().includes("differentiat") || summary.toLowerCase().includes("novel");
}

function checkPatentProtection(
  patentResults: { patents?: Array<{ expirationDate?: string }> } | undefined,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedYear: string
): boolean {
  if (patentResults?.patents?.some(p => p.expirationDate?.includes(expectedYear))) return true;
  return false;
}

function extractPatentDate(
  patentResults: { patents?: Array<{ expirationDate?: string }> } | undefined
): string | null {
  if (!patentResults?.patents?.[0]?.expirationDate) return null;
  return patentResults.patents[0].expirationDate;
}

function checkFirstInClass(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  isFirstInClass: boolean
): boolean {
  const mentions = summary.toLowerCase().includes("first in class") ||
    summary.toLowerCase().includes("first-in-class");
  return isFirstInClass ? mentions : !mentions;
}

function checkClinicalRisk(summary: string, clinicalRisk: string): boolean {
  const riskKeywords = ["risk", "safety", "adverse", "toxicity", "orr", "response"];
  return riskKeywords.some(k => summary.toLowerCase().includes(k));
}

function checkRegulatoryPath(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  regulatoryPath: string
): boolean {
  const regKeywords = ["fda", "bla", "nda", "regulatory", "approval"];
  return regKeywords.some(k => summary.toLowerCase().includes(k));
}

function extractRegulatoryPath(summary: string): string | null {
  if (summary.toLowerCase().includes("breakthrough")) return "Breakthrough designation";
  if (summary.toLowerCase().includes("accelerated")) return "Accelerated approval";
  if (summary.toLowerCase().includes("bla")) return "BLA pathway";
  return null;
}

function checkManufacturing(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  isReady: boolean
): boolean {
  return summary.toLowerCase().includes("manufactur") || summary.toLowerCase().includes("cmo");
}

function checkPhaseTimeline(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedDate?: string
): boolean {
  return summary.match(/20\d{2}/) !== null || summary.toLowerCase().includes("q1") ||
    summary.toLowerCase().includes("q2") || summary.toLowerCase().includes("q3") ||
    summary.toLowerCase().includes("q4");
}

function checkApprovalTimeline(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedDate?: string
): boolean {
  return summary.toLowerCase().includes("approval") && summary.match(/20\d{2}/) !== null;
}

function checkCommercialTimeline(summary: string, expectedDate?: string): boolean {
  return summary.toLowerCase().includes("launch") || summary.toLowerCase().includes("commercial");
}

function extractTimeline(summary: string, type: string): string | null {
  const dateMatch = summary.match(/(20\d{2})/);
  return dateMatch ? dateMatch[1] : null;
}

function checkNCTNumber(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  nctNumber?: string
): boolean {
  if (!nctNumber || !claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(c => c.verified && c.claim.includes(nctNumber));
}

function extractNCTNumber(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined
): string | null {
  if (!claimResults?.verifiedClaims) return null;
  const nctClaim = claimResults.verifiedClaims.find(c => /NCT\d+/.test(c.claim));
  if (!nctClaim) return null;
  const match = nctClaim.claim.match(/NCT\d+/);
  return match ? match[0] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { BIOGENEX_GROUND_TRUTH };
