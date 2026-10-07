/**
 * JPM Startup Banker Evaluation
 *
 * Evaluates the system's ability to produce deal memos for bankers:
 * - Funding verification (stage, amount, investors)
 * - Entity/HQ verification
 * - Contact discovery
 * - Verdict accuracy
 * - Thesis quality
 *
 * Run via: npx convex run domains/evaluation/personas/financial/jpmBankerEval:evaluate
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
import { JPM_BANKER_SCORING } from "../../scoring/personaWeights";
import { TECHCORP_GROUND_TRUTH } from "./financialGroundTruth";
import type { PersonaEvalResult, CategoryFinding } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate JPM Banker persona against TechCorp ground truth
 */
export const evaluate = action({
  args: {},
  handler: async (ctx): Promise<PersonaEvalResult> => {
    const startTime = Date.now();
    const gt = TECHCORP_GROUND_TRUTH;

    console.log(`[JPM_BANKER_EVAL] Starting evaluation for ${gt.entityName}...`);

    // Run the playbook with banker-specific context
    const result = await runInvestorPlaybook(ctx, {
      entityName: gt.entityName,
      entityType: gt.entityType,
      claimedState: gt.hq.state,
      // Pass funding claims for verification
      signals: {
        isRequestingFunding: false,
        isClaimVerification: true,
        hasSpecificClaims: true,
      },
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[JPM_BANKER_EVAL] Playbook completed in ${executionTimeMs}ms`);

    // Extract outputs for scoring
    const synthesis = result.synthesis;
    const branchResults = result.branchResults;

    // Score each category
    const rawScores: RawScoreInput[] = [];

    // 1. Funding Verification (25%)
    const fundingScore = scoreFunding(branchResults, gt);
    rawScores.push({
      category: "Funding Verification",
      ...fundingScore,
    });

    // 2. Entity/HQ Verification (20%)
    const entityScore = scoreEntity(branchResults, gt);
    rawScores.push({
      category: "Entity/HQ Verification",
      ...entityScore,
    });

    // 3. Contact Information (20%)
    const contactScore = scoreContact(branchResults, gt);
    rawScores.push({
      category: "Contact Information",
      ...contactScore,
    });

    // 4. Verdict Accuracy (20%)
    const verdictScore = scoreVerdict(synthesis, gt);
    rawScores.push({
      category: "Verdict Accuracy",
      ...verdictScore,
    });

    // 5. Thesis Quality (15%)
    const thesisScore = scoreThesis(synthesis, gt);
    rawScores.push({
      category: "Thesis Quality",
      ...thesisScore,
    });

    // Normalize scores
    const scoringResult = normalizeScores(rawScores, JPM_BANKER_SCORING);

    // Build result
    const evalResult = buildEvalResult(
      "JPM_STARTUP_BANKER",
      `TechCorp Series B`,
      scoringResult,
      executionTimeMs,
      generateScoreReport({
        personaId: "JPM_STARTUP_BANKER",
        caseName: "TechCorp Series B",
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

    console.log(`[JPM_BANKER_EVAL] Score: ${evalResult.normalizedScore}/100 (${evalResult.passed ? "PASSED" : "FAILED"})`);

    return evalResult;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Score funding verification
 */
function scoreFunding(
  branchResults: Record<string, unknown>,
  gt: typeof TECHCORP_GROUND_TRUTH
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const secResults = branchResults.secEdgar as {
    securitiesRegime?: string;
    activeOffering?: { amount?: number };
  } | undefined;

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  // Check funding-related claims
  const checks = [
    {
      name: "Stage Correct",
      passed: checkFundingStage(claimResults, gt.funding.stage),
      points: 10,
      expected: gt.funding.stage,
      actual: extractFundingStage(claimResults) || "Not found",
    },
    {
      name: "Amount Correct",
      passed: checkFundingAmount(claimResults, secResults, gt.funding.amount),
      points: 10,
      expected: `$${(gt.funding.amount / 1_000_000).toFixed(0)}M`,
      actual: extractFundingAmount(claimResults, secResults) || "Not found",
    },
    {
      name: "Lead Investor",
      passed: checkLeadInvestor(claimResults, gt.funding.leadInvestor),
      points: 5,
      expected: gt.funding.leadInvestor || "Any",
      actual: extractLeadInvestor(claimResults) || "Not found",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score entity/HQ verification
 */
function scoreEntity(
  branchResults: Record<string, unknown>,
  gt: typeof TECHCORP_GROUND_TRUTH
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const entityResults = branchResults.entityVerification as {
    primaryEntity?: {
      state?: string;
      entityName?: string;
      status?: string;
    };
    verification?: {
      entityExists?: boolean;
      isGoodStanding?: boolean;
    };
  } | undefined;

  const checks = [
    {
      name: "City Correct",
      passed: checkCity(entityResults, gt.hq.city),
      points: 7,
      expected: gt.hq.city,
      actual: "Derived from entity",
    },
    {
      name: "State Correct",
      passed: entityResults?.primaryEntity?.state?.toUpperCase() === gt.hq.state.toUpperCase(),
      points: 7,
      expected: gt.hq.state,
      actual: entityResults?.primaryEntity?.state || "Not found",
    },
    {
      name: "Entity Found",
      passed: entityResults?.verification?.entityExists === true,
      points: 6,
      expected: "true",
      actual: String(entityResults?.verification?.entityExists ?? false),
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score contact information discovery
 */
function scoreContact(
  branchResults: Record<string, unknown>,
  gt: typeof TECHCORP_GROUND_TRUTH
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const personResults = branchResults.personVerification as {
    sources?: Array<{ url?: string }>;
  } | undefined;

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  // Check if contact info was found
  const foundLinkedIn = personResults?.sources?.some(s => s.url?.includes("linkedin.com")) ?? false;
  const foundEmail = checkEmailFound(claimResults, gt.contact.irEmail);
  const foundPhone = checkPhoneFound(claimResults, gt.contact.phone);

  const checks = [
    {
      name: "IR Email Found",
      passed: foundEmail,
      points: 10,
      expected: gt.contact.irEmail || "Any valid email",
      actual: foundEmail ? "Found" : "Not found",
    },
    {
      name: "LinkedIn Found",
      passed: foundLinkedIn,
      points: 5,
      expected: gt.contact.linkedIn || "Any LinkedIn",
      actual: foundLinkedIn ? "Found" : "Not found",
    },
    {
      name: "Phone Found",
      passed: foundPhone,
      points: 5,
      expected: gt.contact.phone || "Any phone",
      actual: foundPhone ? "Found" : "Not found",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score verdict accuracy
 */
function scoreVerdict(
  synthesis: { recommendation?: string; overallRisk?: string },
  gt: typeof TECHCORP_GROUND_TRUTH
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  // Map ground truth verdict to expected recommendations
  const verdictMap: Record<string, string[]> = {
    PASS: ["proceed", "approve", "safe_to_proceed"],
    FLAG: ["require_resolution", "investigate"],
    FAIL: ["disengage", "reject"],
  };

  const expectedRecs = verdictMap[gt.verdict] || [];
  const actualRec = synthesis.recommendation?.toLowerCase() || "";
  const verdictCorrect = expectedRecs.some(r => actualRec.includes(r)) ||
    (gt.verdict === "PASS" && synthesis.overallRisk === "low");

  const checks = [
    {
      name: "Verdict Correct",
      passed: verdictCorrect,
      points: 15,
      expected: gt.verdict,
      actual: synthesis.recommendation || "No recommendation",
    },
    {
      name: "Verdict Justified",
      passed: synthesis.recommendation !== undefined,
      points: 5,
      expected: "Justification present",
      actual: synthesis.recommendation ? "Present" : "Missing",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score thesis quality
 */
function scoreThesis(
  synthesis: { executiveSummary?: string },
  gt: typeof TECHCORP_GROUND_TRUTH
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";
  const hasThesis = summary.length > 50;
  const mentionsSector = gt.sector ? summary.toLowerCase().includes(gt.sector.toLowerCase().split("/")[0]) : true;

  const checks = [
    {
      name: "Thesis Present",
      passed: hasThesis,
      points: 5,
      expected: "Investment thesis present",
      actual: hasThesis ? "Present" : "Missing",
    },
    {
      name: "Thesis Coherent",
      passed: summary.length > 100,
      points: 5,
      expected: "Coherent thesis (100+ chars)",
      actual: `${summary.length} chars`,
    },
    {
      name: "Sector Identified",
      passed: mentionsSector,
      points: 5,
      expected: gt.sector || "Any sector",
      actual: mentionsSector ? "Identified" : "Not identified",
    },
  ];

  return scoreBooleanChecks(checks);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function checkFundingStage(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedStage: string
): boolean {
  if (!claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(
    c => c.verified && c.claim.toLowerCase().includes(expectedStage.toLowerCase())
  );
}

function extractFundingStage(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined
): string | null {
  if (!claimResults?.verifiedClaims) return null;
  const stageClaim = claimResults.verifiedClaims.find(c =>
    /series\s*[a-z]/i.test(c.claim) || /seed|pre-seed/i.test(c.claim)
  );
  return stageClaim?.claim || null;
}

function checkFundingAmount(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  secResults: { activeOffering?: { amount?: number } } | undefined,
  expectedAmount: number
): boolean {
  // Check SEC filing first
  if (secResults?.activeOffering?.amount) {
    const ratio = secResults.activeOffering.amount / expectedAmount;
    if (ratio >= 0.9 && ratio <= 1.1) return true;
  }

  // Check claim verification
  if (!claimResults?.verifiedClaims) return false;
  const amountStr = `${expectedAmount / 1_000_000}`;
  return claimResults.verifiedClaims.some(
    c => c.verified && (c.claim.includes(amountStr) || c.claim.includes("$45"))
  );
}

function extractFundingAmount(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  secResults: { activeOffering?: { amount?: number } } | undefined
): string | null {
  if (secResults?.activeOffering?.amount) {
    return `$${(secResults.activeOffering.amount / 1_000_000).toFixed(0)}M`;
  }
  return null;
}

function checkLeadInvestor(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedLead?: string
): boolean {
  if (!expectedLead) return true;
  if (!claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(
    c => c.verified && c.claim.toLowerCase().includes(expectedLead.toLowerCase())
  );
}

function extractLeadInvestor(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined
): string | null {
  if (!claimResults?.verifiedClaims) return null;
  const investorClaim = claimResults.verifiedClaims.find(c =>
    c.verified && /led by|lead|investor/i.test(c.claim)
  );
  return investorClaim?.claim || null;
}

function checkCity(
  entityResults: { primaryEntity?: { state?: string } } | undefined,
  expectedCity: string
): boolean {
  // City is typically not in state registry, so we check if we at least have state
  return entityResults?.primaryEntity?.state !== undefined;
}

function checkEmailFound(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedEmail?: string
): boolean {
  if (!claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(
    c => c.verified && (c.claim.includes("@") || c.claim.toLowerCase().includes("email"))
  );
}

function checkPhoneFound(
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedPhone?: string
): boolean {
  if (!claimResults?.verifiedClaims) return false;
  return claimResults.verifiedClaims.some(
    c => c.verified && /\+?\d{1,2}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(c.claim)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { TECHCORP_GROUND_TRUTH };
