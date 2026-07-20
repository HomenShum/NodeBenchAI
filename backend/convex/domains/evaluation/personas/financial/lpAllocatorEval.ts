/**
 * LP Allocator Evaluation
 *
 * Evaluates the system's ability to produce fund due diligence for LPs:
 * - Track record verification (TVPI, DPI, IRR)
 * - Team experience verification
 * - Strategy clarity assessment
 * - Terms assessment
 * - Mandate fit scoring
 *
 * Run via: npx convex run domains/evaluation/personas/financial/lpAllocatorEval:evaluate
 */

"use node";

import { action } from "../../../../_generated/server";
import { runInvestorPlaybook } from "../../../agents/dueDiligence/investorPlaybook/playbookOrchestrator";
import {
  normalizeScores,
  scoreBooleanChecks,
  scoreThresholdChecks,
  buildEvalResult,
  generateScoreReport,
  type RawScoreInput,
} from "../../scoring/scoringFramework";
import { LP_ALLOCATOR_SCORING } from "../../scoring/personaWeights";
import { APEX_FUND_GROUND_TRUTH } from "./financialGroundTruth";
import type { PersonaEvalResult, CategoryFinding, FundGroundTruth } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate LP Allocator persona against Apex Fund ground truth
 */
export const evaluate = action({
  args: {},
  handler: async (ctx): Promise<PersonaEvalResult> => {
    const startTime = Date.now();
    const gt = APEX_FUND_GROUND_TRUTH;

    console.log(`[LP_ALLOCATOR_EVAL] Starting evaluation for ${gt.entityName}...`);

    // Run the playbook with LP-specific context
    const result = await runInvestorPlaybook(ctx, {
      entityName: gt.entityName,
      entityType: "fund",
      claimVerificationMode: {
        enabled: true,
        rawQuery: buildLPQuery(gt),
      },
      signals: {
        isRequestingFunding: false,
        isClaimVerification: true,
        hasSpecificClaims: true,
      },
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[LP_ALLOCATOR_EVAL] Playbook completed in ${executionTimeMs}ms`);

    // Extract outputs for scoring
    const synthesis = result.synthesis;
    const branchResults = result.branchResults;

    // Score each category
    const rawScores: RawScoreInput[] = [];

    // 1. Track Record Verification (30%)
    const trackRecordScore = scoreTrackRecord(branchResults, gt);
    rawScores.push({
      category: "Track Record Verification",
      ...trackRecordScore,
    });

    // 2. Team Experience (20%)
    const teamScore = scoreTeam(branchResults, gt);
    rawScores.push({
      category: "Team Experience",
      ...teamScore,
    });

    // 3. Strategy Clarity (15%)
    const strategyScore = scoreStrategy(branchResults, synthesis, gt);
    rawScores.push({
      category: "Strategy Clarity",
      ...strategyScore,
    });

    // 4. Terms Assessment (15%)
    const termsScore = scoreTerms(branchResults, gt);
    rawScores.push({
      category: "Terms Assessment",
      ...termsScore,
    });

    // 5. Mandate Fit (20%)
    const fitScore = scoreMandateFit(synthesis, gt);
    rawScores.push({
      category: "Mandate Fit",
      ...fitScore,
    });

    // Normalize scores
    const scoringResult = normalizeScores(rawScores, LP_ALLOCATOR_SCORING);

    // Build result
    const evalResult = buildEvalResult(
      "LP_ALLOCATOR",
      `Apex Ventures Fund IV`,
      scoringResult,
      executionTimeMs,
      generateScoreReport({
        personaId: "LP_ALLOCATOR",
        caseName: "Apex Ventures Fund IV",
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

    console.log(`[LP_ALLOCATOR_EVAL] Score: ${evalResult.normalizedScore}/100 (${evalResult.passed ? "PASSED" : "FAILED"})`);

    return evalResult;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Score track record verification
 */
function scoreTrackRecord(
  branchResults: Record<string, unknown>,
  gt: FundGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean; confidence?: number }>;
  } | undefined;

  // Get expected values from most recent fund with full DPI
  const recentFund = gt.trackRecord.find(f => f.dpiNet > 1.0) || gt.trackRecord[1];

  const findings: CategoryFinding[] = [];
  let rawScore = 0;
  const maxPoints = 30;

  // TVPI Verification (12 points)
  const tvpiVerified = checkPerformanceMetric(claimResults, "tvpi", recentFund.tvpiNet);
  findings.push({
    field: "TVPI Verified",
    expected: `${recentFund.tvpiNet}x`,
    actual: tvpiVerified ? "Verified" : "Not verified",
    match: tvpiVerified,
  });
  if (tvpiVerified) rawScore += 12;

  // DPI Verification (12 points)
  const dpiVerified = checkPerformanceMetric(claimResults, "dpi", recentFund.dpiNet);
  findings.push({
    field: "DPI Verified",
    expected: `${recentFund.dpiNet}x`,
    actual: dpiVerified ? "Verified" : "Not verified",
    match: dpiVerified,
  });
  if (dpiVerified) rawScore += 12;

  // IRR Verification (6 points)
  const irrVerified = recentFund.irrNet
    ? checkPerformanceMetric(claimResults, "irr", recentFund.irrNet)
    : false;
  findings.push({
    field: "IRR Verified",
    expected: recentFund.irrNet ? `${recentFund.irrNet}%` : "N/A",
    actual: irrVerified ? "Verified" : "Not verified",
    match: irrVerified,
  });
  if (irrVerified) rawScore += 6;

  return { rawScore, maxPoints, findings };
}

/**
 * Score team experience verification
 */
function scoreTeam(
  branchResults: Record<string, unknown>,
  gt: FundGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const personResults = branchResults.personVerification as {
    verified?: boolean;
    currentRole?: string;
    careerTimeline?: Array<{ role?: string; yearsInRole?: number }>;
  } | undefined;

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const findings: CategoryFinding[] = [];
  let rawScore = 0;
  const maxPoints = 20;

  // GP Identified (8 points)
  const leadGP = gt.team.find(t => t.role.includes("Managing") || t.role.includes("General"));
  const gpIdentified = personResults?.verified === true ||
    checkPersonMentioned(claimResults, leadGP?.name);
  findings.push({
    field: "GP Identified",
    expected: leadGP?.name || "Any GP",
    actual: gpIdentified ? "Identified" : "Not found",
    match: gpIdentified,
  });
  if (gpIdentified) rawScore += 8;

  // Years Experience (6 points)
  const expectedMinYears = Math.min(...gt.team.map(t => t.yearsExperience));
  const experienceVerified = checkExperience(claimResults, personResults, expectedMinYears);
  findings.push({
    field: "Years Experience",
    expected: `>= ${expectedMinYears} years`,
    actual: experienceVerified ? "Verified" : "Not verified",
    match: experienceVerified,
  });
  if (experienceVerified) rawScore += 6;

  // Prior Funds (6 points)
  const priorFundsFound = gt.trackRecord.length > 1 &&
    checkPriorFunds(claimResults, gt.trackRecord.length - 1);
  findings.push({
    field: "Prior Funds",
    expected: `${gt.trackRecord.length - 1} prior funds`,
    actual: priorFundsFound ? "Found" : "Not found",
    match: priorFundsFound,
  });
  if (priorFundsFound) rawScore += 6;

  return { rawScore, maxPoints, findings };
}

/**
 * Score strategy clarity
 */
function scoreStrategy(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: FundGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";
  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const findings: CategoryFinding[] = [];
  let rawScore = 0;
  const maxPoints = 15;

  // Strategy Described (5 points)
  const strategyDescribed = summary.length > 50 ||
    checkStrategyMentioned(claimResults, gt.strategy.focus);
  findings.push({
    field: "Strategy Described",
    expected: gt.strategy.focus,
    actual: strategyDescribed ? "Described" : "Not described",
    match: strategyDescribed,
  });
  if (strategyDescribed) rawScore += 5;

  // Stage Focus Clear (5 points)
  const stageClear = summary.toLowerCase().includes("early") ||
    summary.toLowerCase().includes("seed") ||
    checkStrategyMentioned(claimResults, gt.strategy.stagePreference);
  findings.push({
    field: "Stage Focus Clear",
    expected: gt.strategy.stagePreference,
    actual: stageClear ? "Clear" : "Not clear",
    match: stageClear,
  });
  if (stageClear) rawScore += 5;

  // Sector Focus Clear (5 points)
  const sectorClear = gt.strategy.sectorFocus.some(s =>
    summary.toLowerCase().includes(s.toLowerCase())
  );
  findings.push({
    field: "Sector Focus Clear",
    expected: gt.strategy.sectorFocus.join(", "),
    actual: sectorClear ? "Clear" : "Not clear",
    match: sectorClear,
  });
  if (sectorClear) rawScore += 5;

  return { rawScore, maxPoints, findings };
}

/**
 * Score terms assessment
 */
function scoreTerms(
  branchResults: Record<string, unknown>,
  gt: FundGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const findings: CategoryFinding[] = [];
  let rawScore = 0;
  const maxPoints = 15;

  // Management Fee (5 points)
  const feeVerified = checkTermValue(claimResults, "management fee", gt.terms.managementFee, 0.5);
  findings.push({
    field: "Mgmt Fee Verified",
    expected: `${gt.terms.managementFee}%`,
    actual: feeVerified ? "Verified" : "Not verified",
    match: feeVerified,
  });
  if (feeVerified) rawScore += 5;

  // Carried Interest (5 points)
  const carryVerified = checkTermValue(claimResults, "carry", gt.terms.carriedInterest, 5);
  findings.push({
    field: "Carry Verified",
    expected: `${gt.terms.carriedInterest}%`,
    actual: carryVerified ? "Verified" : "Not verified",
    match: carryVerified,
  });
  if (carryVerified) rawScore += 5;

  // GP Commitment (5 points)
  const gpCommitVerified = gt.terms.gpCommitment
    ? checkTermValue(claimResults, "gp commit", gt.terms.gpCommitment, 1)
    : true;
  findings.push({
    field: "GP Commitment",
    expected: gt.terms.gpCommitment ? `${gt.terms.gpCommitment}%` : "N/A",
    actual: gpCommitVerified ? "Verified" : "Not verified",
    match: gpCommitVerified,
  });
  if (gpCommitVerified) rawScore += 5;

  return { rawScore, maxPoints, findings };
}

/**
 * Score mandate fit
 */
function scoreMandateFit(
  synthesis: { recommendation?: string; executiveSummary?: string },
  gt: FundGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const findings: CategoryFinding[] = [];
  let rawScore = 0;
  const maxPoints = 20;

  // Sector Match (7 points)
  const sectorMatch = gt.fit.sectorMatch;
  findings.push({
    field: "Sector Match",
    expected: String(sectorMatch),
    actual: String(sectorMatch),
    match: sectorMatch,
  });
  if (sectorMatch) rawScore += 7;

  // Stage Match (7 points)
  const stageMatch = gt.fit.stageMatch;
  findings.push({
    field: "Stage Match",
    expected: String(stageMatch),
    actual: String(stageMatch),
    match: stageMatch,
  });
  if (stageMatch) rawScore += 7;

  // Geo Match (6 points)
  const geoMatch = gt.fit.geoMatch;
  findings.push({
    field: "Geo Match",
    expected: String(geoMatch),
    actual: String(geoMatch),
    match: geoMatch,
  });
  if (geoMatch) rawScore += 6;

  return { rawScore, maxPoints, findings };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function buildLPQuery(gt: FundGroundTruth): string {
  const recentFund = gt.trackRecord[gt.trackRecord.length - 1];
  return `Verify ${gt.entityName} performance claims: Fund II TVPI ${recentFund.tvpiNet}x, DPI ${recentFund.dpiNet}x. ` +
    `Team led by ${gt.team[0].name}. Strategy: ${gt.strategy.focus}. ` +
    `Terms: ${gt.terms.managementFee}% mgmt fee, ${gt.terms.carriedInterest}% carry.`;
}

function checkPerformanceMetric(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  metric: string,
  expectedValue: number
): boolean {
  if (!claimResults?.verifiedClaims) return false;

  return claimResults.verifiedClaims.some(c => {
    if (!c.verified) return false;
    const lowerClaim = c.claim.toLowerCase();
    if (!lowerClaim.includes(metric.toLowerCase())) return false;

    // Extract number and check if within 10%
    const numMatch = c.claim.match(/(\d+\.?\d*)/);
    if (!numMatch) return false;

    const actualValue = parseFloat(numMatch[1]);
    const ratio = actualValue / expectedValue;
    return ratio >= 0.9 && ratio <= 1.1;
  });
}

function checkPersonMentioned(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  name?: string
): boolean {
  if (!name || !claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(
    c => c.verified && c.claim.toLowerCase().includes(name.toLowerCase())
  );
}

function checkExperience(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  personResults: { careerTimeline?: Array<{ yearsInRole?: number }> } | undefined,
  minYears: number
): boolean {
  // Check person verification results
  if (personResults?.careerTimeline) {
    const totalYears = personResults.careerTimeline.reduce(
      (sum, c) => sum + (c.yearsInRole || 0),
      0
    );
    if (totalYears >= minYears) return true;
  }

  // Check claims for experience mentions
  if (!claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(c => {
    if (!c.verified) return false;
    const yearsMatch = c.claim.match(/(\d+)\s*(?:years?|yrs?)/i);
    if (!yearsMatch) return false;
    return parseInt(yearsMatch[1], 10) >= minYears;
  });
}

function checkPriorFunds(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedCount: number
): boolean {
  if (!claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(
    c => c.verified && /fund\s*[i-v]+/i.test(c.claim)
  );
}

function checkStrategyMentioned(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  strategy: string
): boolean {
  if (!claimResults?.verifiedClaims) return false;
  const keywords = strategy.toLowerCase().split(/\s+/);
  return claimResults.verifiedClaims.some(c =>
    c.verified && keywords.some(k => c.claim.toLowerCase().includes(k))
  );
}

function checkTermValue(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  termName: string,
  expectedValue: number,
  tolerance: number
): boolean {
  if (!claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(c => {
    if (!c.verified) return false;
    if (!c.claim.toLowerCase().includes(termName.toLowerCase())) return false;

    const numMatch = c.claim.match(/(\d+\.?\d*)\s*%?/);
    if (!numMatch) return false;

    const actualValue = parseFloat(numMatch[1]);
    return Math.abs(actualValue - expectedValue) <= tolerance;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { APEX_FUND_GROUND_TRUTH };
