/**
 * Academic R&D Evaluation
 *
 * Evaluates the system's ability to assess research signals for academics:
 * - Methodology quality (technique, validation, replication)
 * - Findings accuracy (results, effect size, significance)
 * - Citation verification (counts, key papers, h5)
 * - Gap identification
 * - Implications clarity
 *
 * Run via: npx convex run domains/evaluation/personas/industry/academicRDEval:evaluate
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
import { ACADEMIC_RD_SCORING } from "../../scoring/personaWeights";
import { CRISPR_ABE_GROUND_TRUTH } from "./industryGroundTruth";
import type { PersonaEvalResult, CategoryFinding, AcademicGroundTruth } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate Academic R&D persona against CRISPR ABE ground truth
 */
export const evaluate = action({
  args: {},
  handler: async (ctx): Promise<PersonaEvalResult> => {
    const startTime = Date.now();
    const gt = CRISPR_ABE_GROUND_TRUTH;

    console.log(`[ACADEMIC_RD_EVAL] Starting evaluation for ${gt.entityName}...`);

    // Run the playbook with academic-specific context
    const result = await runInvestorPlaybook(ctx, {
      entityName: gt.entityName,
      entityType: "company", // Map research_signal to company for playbook
      claimVerificationMode: {
        enabled: true,
        rawQuery: buildAcademicQuery(gt),
      },
      signals: {
        isRequestingFunding: false,
        isClaimVerification: true,
        hasSpecificClaims: true,
        hasPatentMentions: true,
      },
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[ACADEMIC_RD_EVAL] Playbook completed in ${executionTimeMs}ms`);

    // Extract outputs for scoring
    const synthesis = result.synthesis;
    const branchResults = result.branchResults;

    // Score each category
    const rawScores: RawScoreInput[] = [];

    // 1. Methodology Quality (20%)
    const methodologyScore = scoreMethodology(branchResults, synthesis, gt);
    rawScores.push({
      category: "Methodology Quality",
      ...methodologyScore,
    });

    // 2. Findings Accuracy (25%)
    const findingsScore = scoreFindings(branchResults, synthesis, gt);
    rawScores.push({
      category: "Findings Accuracy",
      ...findingsScore,
    });

    // 3. Citation Verification (15%)
    const citationScore = scoreCitations(branchResults, synthesis, gt);
    rawScores.push({
      category: "Citation Verification",
      ...citationScore,
    });

    // 4. Gap Identification (20%)
    const gapScore = scoreGaps(branchResults, synthesis, gt);
    rawScores.push({
      category: "Gap Identification",
      ...gapScore,
    });

    // 5. Implications Clarity (20%)
    const implicationsScore = scoreImplications(synthesis, gt);
    rawScores.push({
      category: "Implications Clarity",
      ...implicationsScore,
    });

    // Normalize scores
    const scoringResult = normalizeScores(rawScores, ACADEMIC_RD_SCORING);

    // Build result
    const evalResult = buildEvalResult(
      "ACADEMIC_RD",
      `CRISPR ABE Research`,
      scoringResult,
      executionTimeMs,
      generateScoreReport({
        personaId: "ACADEMIC_RD",
        caseName: "CRISPR ABE Research",
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

    console.log(`[ACADEMIC_RD_EVAL] Score: ${evalResult.normalizedScore}/100 (${evalResult.passed ? "PASSED" : "FAILED"})`);

    return evalResult;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SCORING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Score methodology quality
 */
function scoreMethodology(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: AcademicGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Technique Identified",
      passed: checkTechnique(summary, claimResults, gt.methodology.technique),
      points: 7,
      expected: gt.methodology.technique,
      actual: extractTechnique(summary) || "Not found",
    },
    {
      name: "Validation Level",
      passed: checkValidation(summary, claimResults, gt.methodology.validationLevel),
      points: 7,
      expected: gt.methodology.validationLevel,
      actual: extractValidation(summary) || "Not found",
    },
    {
      name: "Replication Status",
      passed: checkReplication(summary, claimResults, gt.methodology.replicationCount),
      points: 6,
      expected: `${gt.methodology.replicationCount}+ replications`,
      actual: extractReplicationCount(summary, claimResults) || "Not found",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score findings accuracy
 */
function scoreFindings(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: AcademicGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Primary Result",
      passed: checkPrimaryResult(summary, claimResults, gt.findings.primaryResult),
      points: 10,
      expected: gt.findings.primaryResult,
      actual: extractPrimaryResult(summary) || "Not found",
    },
    {
      name: "Effect Size",
      passed: checkEffectSize(summary, claimResults, gt.findings.effectSize),
      points: 8,
      expected: gt.findings.effectSize ? `${(gt.findings.effectSize * 100).toFixed(0)}%` : "N/A",
      actual: extractEffectSize(summary) || "Not found",
    },
    {
      name: "Statistical Significance",
      passed: checkStatSig(summary, claimResults, gt.findings.statisticalSignificance),
      points: 7,
      expected: gt.findings.statisticalSignificance || "p < 0.05",
      actual: summary.toLowerCase().includes("significant") ? "Mentioned" : "Not mentioned",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score citation verification
 */
function scoreCitations(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: AcademicGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const claimResults = branchResults.claimVerification as {
    verifiedClaims?: Array<{ claim: string; verified: boolean }>;
  } | undefined;

  const checks = [
    {
      name: "Citation Count",
      passed: checkCitationCount(summary, claimResults, gt.citations.totalCitations),
      points: 6,
      expected: `${gt.citations.totalCitations}+ citations`,
      actual: extractCitationCount(summary, claimResults) || "Not found",
    },
    {
      name: "Key Papers Found",
      passed: checkKeyPapers(summary, claimResults, gt.citations.keyPapers),
      points: 5,
      expected: gt.citations.keyPapers.slice(0, 2).join(", "),
      actual: countKeyPapers(summary, gt.citations.keyPapers).toString() + " found",
    },
    {
      name: "h5 Index",
      passed: gt.citations.h5Index ? checkH5Index(summary, claimResults, gt.citations.h5Index) : true,
      points: 4,
      expected: gt.citations.h5Index ? `h5=${gt.citations.h5Index}` : "N/A",
      actual: extractH5Index(summary) || "Not found",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score gap identification
 */
function scoreGaps(
  branchResults: Record<string, unknown>,
  synthesis: { executiveSummary?: string },
  gt: AcademicGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const checks = [
    {
      name: "Gaps Identified",
      passed: checkGapsIdentified(summary, gt.gaps),
      points: 10,
      expected: `${gt.gaps.length} gaps`,
      actual: countGapsIdentified(summary, gt.gaps).toString() + " found",
    },
    {
      name: "Gap Relevance",
      passed: checkGapRelevance(summary, gt.gaps),
      points: 5,
      expected: "Relevant gaps discussed",
      actual: summary.toLowerCase().includes("challenge") || summary.toLowerCase().includes("limitation") ? "Discussed" : "Not discussed",
    },
    {
      name: "Gap Prioritization",
      passed: summary.toLowerCase().includes("critical") || summary.toLowerCase().includes("major") || summary.toLowerCase().includes("key"),
      points: 5,
      expected: "Gaps prioritized",
      actual: "Inferred from context",
    },
  ];

  return scoreBooleanChecks(checks);
}

/**
 * Score implications clarity
 */
function scoreImplications(
  synthesis: { executiveSummary?: string },
  gt: AcademicGroundTruth
): { rawScore: number; maxPoints: number; findings: CategoryFinding[] } {
  const summary = synthesis.executiveSummary || "";

  const checks = [
    {
      name: "Clinical Translation",
      passed: checkClinicalTranslation(summary, gt.implications.clinicalTranslation),
      points: 7,
      expected: gt.implications.clinicalTranslation || "Clinical path discussed",
      actual: summary.toLowerCase().includes("clinical") || summary.toLowerCase().includes("trial") ? "Discussed" : "Not discussed",
    },
    {
      name: "Commercialization Path",
      passed: checkCommercialization(summary, gt.implications.commercializationPath),
      points: 7,
      expected: gt.implications.commercializationPath || "Commercial path discussed",
      actual: summary.toLowerCase().includes("commercial") || summary.toLowerCase().includes("therapy") ? "Discussed" : "Not discussed",
    },
    {
      name: "Regulatory Considerations",
      passed: checkRegulatoryConsiderations(summary, gt.implications.regulatoryConsiderations),
      points: 6,
      expected: gt.implications.regulatoryConsiderations || "Regulatory discussed",
      actual: summary.toLowerCase().includes("regulatory") || summary.toLowerCase().includes("fda") ? "Discussed" : "Not discussed",
    },
  ];

  return scoreBooleanChecks(checks);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function buildAcademicQuery(gt: AcademicGroundTruth): string {
  return `Evaluate research signal: ${gt.entityName}. ` +
    `Methodology: ${gt.methodology.technique}. ` +
    `Verify key findings: ${gt.findings.primaryResult}. ` +
    `Check citation impact (key papers: ${gt.citations.keyPapers[0]}). ` +
    `Identify research gaps and implications for translation.`;
}

function checkTechnique(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  technique: string
): boolean {
  const keywords = technique.toLowerCase().split(/\s+/);
  return keywords.some(k => summary.toLowerCase().includes(k));
}

function extractTechnique(summary: string): string | null {
  const techniquePatterns = [
    /(base\s*editing)/i,
    /(crispr)/i,
    /(gene\s*editing)/i,
    /(adenine\s*base)/i,
  ];

  for (const pattern of techniquePatterns) {
    const match = summary.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function checkValidation(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  validation: string
): boolean {
  const validationKeywords = ["in vivo", "mouse", "human", "cell line", "validated"];
  return validationKeywords.some(k => summary.toLowerCase().includes(k));
}

function extractValidation(summary: string): string | null {
  if (summary.toLowerCase().includes("in vivo")) return "In vivo";
  if (summary.toLowerCase().includes("mouse")) return "Mouse models";
  if (summary.toLowerCase().includes("human cell")) return "Human cell lines";
  return null;
}

function checkReplication(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expectedCount: number
): boolean {
  const replicationKeywords = ["replicated", "reproduced", "confirmed", "validated", "independent"];
  return replicationKeywords.some(k => summary.toLowerCase().includes(k));
}

function extractReplicationCount(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined
): string | null {
  const countMatch = summary.match(/(\d+)\s*(?:independent|separate)?\s*(?:lab|group|stud)/i);
  return countMatch ? `${countMatch[1]} labs` : null;
}

function checkPrimaryResult(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  result: string
): boolean {
  // Check for efficiency/result mentions
  const resultKeywords = result.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  return resultKeywords.some(k => summary.toLowerCase().includes(k)) ||
    summary.toLowerCase().includes("efficiency") ||
    summary.toLowerCase().includes("%");
}

function extractPrimaryResult(summary: string): string | null {
  const resultMatch = summary.match(/(\d+\.?\d*)\s*%/);
  if (resultMatch) return `${resultMatch[1]}% efficiency`;
  return null;
}

function checkEffectSize(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  effectSize?: number
): boolean {
  if (!effectSize) return true;
  const percentMatch = summary.match(/(\d+\.?\d*)\s*%/);
  if (!percentMatch) return false;
  const actualPercent = parseFloat(percentMatch[1]) / 100;
  return Math.abs(actualPercent - effectSize) < 0.15; // Within 15%
}

function extractEffectSize(summary: string): string | null {
  const match = summary.match(/(\d+\.?\d*)\s*%/);
  return match ? `${match[1]}%` : null;
}

function checkStatSig(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  statSig?: string
): boolean {
  return summary.toLowerCase().includes("significant") ||
    summary.toLowerCase().includes("p <") ||
    summary.toLowerCase().includes("p=");
}

function checkCitationCount(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expected: number
): boolean {
  const countMatch = summary.match(/(\d{3,})\s*citation/i);
  if (!countMatch) return summary.toLowerCase().includes("highly cited");
  const count = parseInt(countMatch[1], 10);
  return count >= expected * 0.8;
}

function extractCitationCount(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined
): string | null {
  const match = summary.match(/(\d{3,})\s*citation/i);
  return match ? `${match[1]} citations` : null;
}

function checkKeyPapers(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  keyPapers: string[]
): boolean {
  return countKeyPapers(summary, keyPapers) >= 1;
}

function countKeyPapers(summary: string, keyPapers: string[]): number {
  const summaryLower = summary.toLowerCase();
  return keyPapers.filter(paper => {
    const author = paper.split(/\s/)[0].toLowerCase();
    return summaryLower.includes(author);
  }).length;
}

function checkH5Index(
  summary: string,
  claimResults: { verifiedClaims?: Array<{ claim: string; verified: boolean }> } | undefined,
  expected: number
): boolean {
  return summary.toLowerCase().includes("h5") || summary.toLowerCase().includes("h-index") ||
    summary.toLowerCase().includes("impact");
}

function extractH5Index(summary: string): string | null {
  const match = summary.match(/h5?\s*(?:index|=)\s*(\d+)/i);
  return match ? `h5=${match[1]}` : null;
}

function checkGapsIdentified(summary: string, gaps: Array<{ challenge: string }>): boolean {
  return countGapsIdentified(summary, gaps) >= 1;
}

function countGapsIdentified(summary: string, gaps: Array<{ challenge: string }>): number {
  const summaryLower = summary.toLowerCase();
  return gaps.filter(gap => {
    const keywords = gap.challenge.toLowerCase().split(/\s+/);
    return keywords.some(k => k.length > 3 && summaryLower.includes(k));
  }).length;
}

function checkGapRelevance(summary: string, gaps: Array<{ challenge: string }>): boolean {
  return summary.toLowerCase().includes("challenge") ||
    summary.toLowerCase().includes("limitation") ||
    summary.toLowerCase().includes("barrier");
}

function checkClinicalTranslation(summary: string, translation?: string): boolean {
  return summary.toLowerCase().includes("clinical") ||
    summary.toLowerCase().includes("trial") ||
    summary.toLowerCase().includes("patient");
}

function checkCommercialization(summary: string, path?: string): boolean {
  return summary.toLowerCase().includes("commercial") ||
    summary.toLowerCase().includes("therapy") ||
    summary.toLowerCase().includes("therapeutic");
}

function checkRegulatoryConsiderations(summary: string, considerations?: string): boolean {
  return summary.toLowerCase().includes("regulatory") ||
    summary.toLowerCase().includes("fda") ||
    summary.toLowerCase().includes("approval");
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { CRISPR_ABE_GROUND_TRUTH };
