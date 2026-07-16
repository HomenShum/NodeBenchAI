/**
 * Unified Persona Evaluation Harness
 *
 * Orchestrates evaluation runs across all persona groups (Financial, Industry, Strategic).
 * Integrates ground truth cases, claim verification scenarios, and scoring framework.
 */

"use node";

import { action } from "../../../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../../../_generated/api";

// Ground truth imports
import {
  TECHCORP_GROUND_TRUTH,
  APEX_FUND_GROUND_TRUTH,
  OPENAI_GROUND_TRUTH,
  BANKER_CLAIM_SCENARIOS,
  LP_CLAIM_SCENARIOS,
  VC_CLAIM_SCENARIOS,
} from "./financial/financialGroundTruth";
import {
  ALPHA_MOMENTUM_GROUND_TRUTH,
  QUANT_PM_CLAIM_SCENARIOS,
} from "./financial/quantPMGroundTruth";
import {
  BIOGENEX_GROUND_TRUTH,
  CRISPR_ABE_GROUND_TRUTH,
  PHARMA_CLAIM_SCENARIOS,
  ACADEMIC_CLAIM_SCENARIOS,
} from "./industry/industryGroundTruth";
import {
  ACME_WIDGETCO_GROUND_TRUTH,
  FED_POLICY_GROUND_TRUTH,
  CORP_DEV_CLAIM_SCENARIOS,
  MACRO_CLAIM_SCENARIOS,
} from "./strategic/strategicGroundTruth";
import {
  DEVTOOLSAI_GROUND_TRUTH,
  FOUNDER_STRATEGY_CLAIM_SCENARIOS,
} from "./strategic/founderStrategyGroundTruth";
import {
  CLOUDSCALE_GROUND_TRUTH,
  CTO_CLAIM_SCENARIOS,
} from "./technical/technicalGroundTruth";
import {
  VIRALTECH_LAYOFFS_GROUND_TRUTH,
  JOURNALIST_CLAIM_SCENARIOS,
} from "./media/mediaGroundTruth";

// Scoring framework
import {
  normalizeScores,
  mapToRawScores,
  buildEvalResult,
  generateScoreReport,
} from "../scoring/scoringFramework";
import {
  JPM_BANKER_SCORING,
  LP_ALLOCATOR_SCORING,
  EARLY_STAGE_VC_SCORING,
  QUANT_PM_SCORING,
  PHARMA_BD_SCORING,
  ACADEMIC_RD_SCORING,
  CORP_DEV_SCORING,
  MACRO_STRATEGIST_SCORING,
  FOUNDER_STRATEGY_SCORING,
  CTO_TECH_LEAD_SCORING,
  JOURNALIST_SCORING,
} from "../scoring/personaWeights";
import type { PersonaScoringConfig } from "../scoring/scoringFramework";
import type { PersonaId } from "../../../config/autonomousConfig";

import type { PersonaEvalResult, ClaimVerificationScenario } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PersonaEvalCase {
  personaId: string;
  personaName: string;
  group: "financial" | "industry" | "strategic" | "technical" | "media";
  groundTruth: any;
  claimScenarios: ClaimVerificationScenario[];
  scoringConfig: PersonaScoringConfig;
}

export interface UnifiedEvalResult {
  runId: string;
  startTime: number;
  endTime: number;
  totalDurationMs: number;

  // Summary
  totalPersonas: number;
  totalPassed: number;
  totalFailed: number;
  overallPassRate: number;

  // Per-group results
  byGroup: {
    financial: GroupResult;
    industry: GroupResult;
    strategic: GroupResult;
    technical: GroupResult;
    media: GroupResult;
  };

  // Per-persona results
  personaResults: PersonaEvalResult[];

  // Recommendations
  recommendations: string[];
}

export interface GroupResult {
  personas: string[];
  passed: number;
  failed: number;
  passRate: number;
  avgScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA EVALUATION CASES
// ═══════════════════════════════════════════════════════════════════════════

const PERSONA_EVAL_CASES: PersonaEvalCase[] = [
  // Financial Group
  {
    personaId: "JPM_STARTUP_BANKER",
    personaName: "JPM Startup Banker",
    group: "financial",
    groundTruth: TECHCORP_GROUND_TRUTH,
    claimScenarios: BANKER_CLAIM_SCENARIOS,
    scoringConfig: JPM_BANKER_SCORING,
  },
  {
    personaId: "LP_ALLOCATOR",
    personaName: "LP Allocator",
    group: "financial",
    groundTruth: APEX_FUND_GROUND_TRUTH,
    claimScenarios: LP_CLAIM_SCENARIOS,
    scoringConfig: LP_ALLOCATOR_SCORING,
  },
  {
    personaId: "QUANT_PM",
    personaName: "Quant PM",
    group: "financial",
    groundTruth: ALPHA_MOMENTUM_GROUND_TRUTH,
    claimScenarios: QUANT_PM_CLAIM_SCENARIOS,
    scoringConfig: QUANT_PM_SCORING,
  },
  {
    personaId: "EARLY_STAGE_VC",
    personaName: "Early Stage VC",
    group: "financial",
    groundTruth: OPENAI_GROUND_TRUTH,
    claimScenarios: VC_CLAIM_SCENARIOS,
    scoringConfig: EARLY_STAGE_VC_SCORING,
  },

  // Industry Group
  {
    personaId: "PHARMA_BD",
    personaName: "Pharma BD",
    group: "industry",
    groundTruth: BIOGENEX_GROUND_TRUTH,
    claimScenarios: PHARMA_CLAIM_SCENARIOS,
    scoringConfig: PHARMA_BD_SCORING,
  },
  {
    personaId: "ACADEMIC_RD",
    personaName: "Academic R&D",
    group: "industry",
    groundTruth: CRISPR_ABE_GROUND_TRUTH,
    claimScenarios: ACADEMIC_CLAIM_SCENARIOS,
    scoringConfig: ACADEMIC_RD_SCORING,
  },

  // Strategic Group
  {
    personaId: "CORP_DEV",
    personaName: "Corp Dev",
    group: "strategic",
    groundTruth: ACME_WIDGETCO_GROUND_TRUTH,
    claimScenarios: CORP_DEV_CLAIM_SCENARIOS,
    scoringConfig: CORP_DEV_SCORING,
  },
  {
    personaId: "MACRO_STRATEGIST",
    personaName: "Macro Strategist",
    group: "strategic",
    groundTruth: FED_POLICY_GROUND_TRUTH,
    claimScenarios: MACRO_CLAIM_SCENARIOS,
    scoringConfig: MACRO_STRATEGIST_SCORING,
  },
  {
    personaId: "FOUNDER_STRATEGY",
    personaName: "Founder/Strategy",
    group: "strategic",
    groundTruth: DEVTOOLSAI_GROUND_TRUTH,
    claimScenarios: FOUNDER_STRATEGY_CLAIM_SCENARIOS,
    scoringConfig: FOUNDER_STRATEGY_SCORING,
  },

  // Technical Group
  {
    personaId: "CTO_TECH_LEAD",
    personaName: "CTO/Tech Lead",
    group: "technical",
    groundTruth: CLOUDSCALE_GROUND_TRUTH,
    claimScenarios: CTO_CLAIM_SCENARIOS,
    scoringConfig: CTO_TECH_LEAD_SCORING,
  },

  // Media Group
  {
    personaId: "JOURNALIST",
    personaName: "Journalist",
    group: "media",
    groundTruth: VIRALTECH_LAYOFFS_GROUND_TRUTH,
    claimScenarios: JOURNALIST_CLAIM_SCENARIOS,
    scoringConfig: JOURNALIST_SCORING,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// MOCK EVALUATION (for framework testing)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate mock category scores for a persona based on ground truth
 */
function generateMockScores(evalCase: PersonaEvalCase): Map<string, number> {
  const scores = new Map<string, number>();
  const config = evalCase.scoringConfig;

  // Generate scores based on expected outcome
  const isPass = evalCase.groundTruth.expectedOutcome === "pass";
  const baseScore = isPass ? 0.85 : 0.45;

  for (const category of config.categories) {
    // Add some variance
    const variance = (Math.random() - 0.5) * 0.2;
    let score = Math.max(0, Math.min(1, baseScore + variance));

    // Critical categories get higher scores for passing cases
    if (category.isCritical && isPass) {
      score = Math.max(score, 0.75);
    }

    scores.set(category.name, score);
  }

  return scores;
}

/**
 * Run mock evaluation for a single persona (framework testing)
 */
async function evaluatePersonaMock(evalCase: PersonaEvalCase): Promise<PersonaEvalResult> {
  const startTime = Date.now();

  // Generate mock scores
  const scoreMap = generateMockScores(evalCase);

  // Normalize to 100-point scale
  const rawScores = mapToRawScores(scoreMap, evalCase.scoringConfig);
  const normalizedScores = normalizeScores(rawScores, evalCase.scoringConfig);
  const executionTimeMs = Date.now() - startTime;

  // Build result
  const result = buildEvalResult(
    evalCase.personaId as PersonaId,
    evalCase.groundTruth.entityName,
    normalizedScores,
    executionTimeMs,
    "", // Report generated separately via formatUnifiedReport
    { mockScores: Object.fromEntries(scoreMap) }
  );

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE EVALUATION (actual agent testing)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run live evaluation for a single persona using the investor playbook
 */
async function evaluatePersonaLive(
  ctx: any,
  evalCase: PersonaEvalCase
): Promise<PersonaEvalResult> {
  const startTime = Date.now();

  try {
    // Run the investor playbook with persona context
    const playbookResult = await ctx.runAction(
      internal.domains.agents.dueDiligence.investorPlaybook.evalPlaybook.runInvestorPlaybookEval,
      {
        entityName: evalCase.groundTruth.entityName,
        entityType: evalCase.groundTruth.entityType,
        persona: evalCase.personaId,
      }
    );

    // Extract scores from playbook result
    const scoreMap = extractScoresFromPlaybook(playbookResult, evalCase);

    // Normalize to 100-point scale
    const rawScores = mapToRawScores(scoreMap, evalCase.scoringConfig);
    const normalizedScores = normalizeScores(rawScores, evalCase.scoringConfig);
    const executionTimeMs = Date.now() - startTime;

    // Build result
    const result = buildEvalResult(
      evalCase.personaId as PersonaId,
      evalCase.groundTruth.entityName,
      normalizedScores,
      executionTimeMs,
      "", // Report generated separately via formatUnifiedReport
      { playbookResult, branchResults: Object.keys(playbookResult.branchResults || {}), scoreMap: Object.fromEntries(scoreMap) }
    );

    return result;
  } catch (error: any) {
    console.error(`[UnifiedHarness] Error evaluating ${evalCase.personaId}:`, error);

    // Return failure result
    return {
      personaId: evalCase.personaId as import("../../../config/autonomousConfig").PersonaId,
      caseName: evalCase.groundTruth.entityName,
      score: 0,
      maxScore: 100,
      normalizedScore: 0,
      passed: false,
      passThreshold: evalCase.scoringConfig.passingThreshold,
      categoryScores: [],
      criticalFailures: [`Evaluation failed: ${error.message}`],
      criticalsPassed: false,
      failedCriticals: evalCase.scoringConfig.categories
        .filter((c) => c.isCritical)
        .map((c) => c.name),
      executionTimeMs: Date.now() - startTime,
      report: "",
      rawOutput: { error: error.message },
    };
  }
}

/**
 * Extract category scores from playbook result
 */
function extractScoresFromPlaybook(
  playbookResult: any,
  evalCase: PersonaEvalCase
): Map<string, number> {
  const scores = new Map<string, number>();
  const synthesis = playbookResult?.synthesis;

  if (!synthesis) {
    // No synthesis - return zeros
    for (const cat of evalCase.scoringConfig.categories) {
      scores.set(cat.name, 0);
    }
    return scores;
  }

  // Map verification scores to category scores based on persona
  const verificationScores = synthesis.verificationScores || {};

  // Financial personas
  if (evalCase.personaId === "JPM_STARTUP_BANKER") {
    scores.set("funding", verificationScores.securities || 0);
    scores.set("entity_hq", verificationScores.entity || 0);
    scores.set("contact", synthesis.entityVerification?.verification?.registeredAgentValid ? 1 : 0);
    scores.set("verdict", verificationScores.overall || 0);
    scores.set("thesis", synthesis.recommendation === "proceed" ? 1 : 0.5);
  } else if (evalCase.personaId === "LP_ALLOCATOR") {
    scores.set("track_record", verificationScores.overall || 0);
    scores.set("team", verificationScores.entity || 0);
    scores.set("strategy", 0.7); // Mock for now
    scores.set("terms", verificationScores.securities || 0);
    scores.set("mandate_fit", synthesis.recommendation === "proceed" ? 1 : 0.5);
  } else if (evalCase.personaId === "QUANT_PM") {
    scores.set("performance", verificationScores.overall || 0);
    scores.set("risk_metrics", verificationScores.securities || 0);
    scores.set("methodology", 0.75); // Mock for now
    scores.set("factor_attribution", verificationScores.entity || 0);
    scores.set("robustness", synthesis.recommendation === "proceed" ? 0.8 : 0.4);
  } else if (evalCase.personaId === "EARLY_STAGE_VC") {
    // VC evaluation uses claim verification and playbook results
    const branchResults = playbookResult?.branchResults || {};
    const claimVerification = branchResults.claimVerification;

    // Investment Thesis - check for thesis clarity from claim verification
    scores.set("Investment Thesis", synthesis.thesis ? 0.8 : (verificationScores.overall || 0.5));

    // Market Analysis - from overall verification
    scores.set("Market Analysis", verificationScores.entity || 0.5);

    // Competitive Analysis - from claim verification
    if (claimVerification) {
      const verifiedCount = claimVerification.claims?.filter((c: any) => c.verdict === "verified").length || 0;
      const totalClaims = claimVerification.claims?.length || 1;
      scores.set("Competitive Analysis", verifiedCount / totalClaims);
    } else {
      scores.set("Competitive Analysis", 0.5);
    }

    // Team Assessment - from entity verification
    scores.set("Team Assessment", verificationScores.entity || 0.5);

    // Deal Terms - from securities verification
    scores.set("Deal Terms", verificationScores.securities || 0.5);
  }
  // Industry personas
  else if (evalCase.personaId === "PHARMA_BD") {
    scores.set("exposure", verificationScores.fda || 0);
    scores.set("impact", verificationScores.patents || 0);
    scores.set("mitigations", synthesis.stopRules?.some((r: any) => r.triggered) ? 0.3 : 0.8);
    scores.set("timeline", 0.7); // Mock for now
  } else if (evalCase.personaId === "ACADEMIC_RD") {
    scores.set("methodology", verificationScores.patents || 0);
    scores.set("findings", verificationScores.overall || 0);
    scores.set("citations", 0.7); // Mock for now
    scores.set("gaps", 0.6); // Mock for now
    scores.set("implications", synthesis.recommendation === "proceed" ? 0.8 : 0.4);
  }
  // Strategic personas
  else if (evalCase.personaId === "CORP_DEV") {
    scores.set("deal_facts", verificationScores.securities || 0);
    scores.set("rationale", 0.7); // Mock for now
    scores.set("risks", synthesis.stopRules?.some((r: any) => r.triggered) ? 0.4 : 0.8);
    scores.set("timeline", verificationScores.entity || 0);
  } else if (evalCase.personaId === "MACRO_STRATEGIST") {
    scores.set("thesis", verificationScores.overall || 0);
    scores.set("indicators", 0.7); // Mock for now
    scores.set("risks", synthesis.stopRules?.length > 0 ? 0.6 : 0.8);
    scores.set("positioning", synthesis.recommendation === "proceed" ? 0.8 : 0.4);
  } else if (evalCase.personaId === "FOUNDER_STRATEGY") {
    scores.set("market_sizing", verificationScores.overall || 0);
    scores.set("competitive_intel", 0.75); // Mock for now
    scores.set("positioning", verificationScores.entity || 0);
    scores.set("gtm_clarity", 0.7); // Mock for now
    scores.set("risk_assessment", synthesis.stopRules?.some((r: any) => r.triggered) ? 0.9 : 0.6);
  }
  // Technical personas
  else if (evalCase.personaId === "CTO_TECH_LEAD") {
    scores.set("tech_stack", verificationScores.entity || 0);
    scores.set("architecture", 0.75); // Mock for now
    scores.set("security_compliance", verificationScores.overall || 0);
    scores.set("team_metrics", 0.7); // Mock for now
    scores.set("devops_maturity", 0.65); // Mock for now
  }
  // Media personas
  else if (evalCase.personaId === "JOURNALIST") {
    scores.set("fact_verification", verificationScores.overall || 0);
    scores.set("source_quality", 0.75); // Mock for now
    scores.set("conflict_detection", synthesis.stopRules?.some((r: any) => r.triggered) ? 0.8 : 0.5);
    scores.set("context_completeness", verificationScores.entity || 0);
    scores.set("attribution_standards", 0.7); // Mock for now
  }

  return scores;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED HARNESS ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run mock evaluation for all personas (framework testing)
 */
export const runAllPersonaEvalsMock = action({
  args: {},
  handler: async (ctx): Promise<UnifiedEvalResult> => {
    const startTime = Date.now();
    const runId = `eval_${Date.now()}`;

    const personaResults: PersonaEvalResult[] = [];

    // Run evaluations for all personas
    for (const evalCase of PERSONA_EVAL_CASES) {
      console.log(`[UnifiedHarness] Evaluating ${evalCase.personaId}...`);
      const result = await evaluatePersonaMock(evalCase);
      personaResults.push(result);
      console.log(`[UnifiedHarness] ${evalCase.personaId}: ${result.normalizedScore}/100 (${result.passed ? "PASS" : "FAIL"})`);
    }

    // Aggregate results
    return aggregateResults(runId, startTime, personaResults);
  },
});

/**
 * Run live evaluation for all personas
 */
export const runAllPersonaEvalsLive = action({
  args: {
    personas: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<UnifiedEvalResult> => {
    const startTime = Date.now();
    const runId = `eval_live_${Date.now()}`;

    const personaResults: PersonaEvalResult[] = [];

    // Filter personas if specified
    let evalCases = PERSONA_EVAL_CASES;
    if (args.personas?.length) {
      evalCases = evalCases.filter(c => args.personas!.includes(c.personaId));
    }

    // Run evaluations
    for (const evalCase of evalCases) {
      console.log(`[UnifiedHarness] Live evaluating ${evalCase.personaId}...`);
      const result = await evaluatePersonaLive(ctx, evalCase);
      personaResults.push(result);
      console.log(`[UnifiedHarness] ${evalCase.personaId}: ${result.normalizedScore}/100 (${result.passed ? "PASS" : "FAIL"})`);
    }

    return aggregateResults(runId, startTime, personaResults);
  },
});

/**
 * Run evaluation for a single persona
 */
export const runSinglePersonaEval = action({
  args: {
    personaId: v.string(),
    useMock: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<PersonaEvalResult> => {
    const evalCase = PERSONA_EVAL_CASES.find(c => c.personaId === args.personaId);
    if (!evalCase) {
      throw new Error(`Unknown persona: ${args.personaId}`);
    }

    if (args.useMock) {
      return evaluatePersonaMock(evalCase);
    } else {
      return evaluatePersonaLive(ctx, evalCase);
    }
  },
});

/**
 * Get available personas for evaluation
 */
export const getAvailablePersonas = action({
  args: {},
  handler: async (): Promise<Array<{
    personaId: string;
    personaName: string;
    group: string;
    groundTruthEntity: string;
    passThreshold: number;
  }>> => {
    return PERSONA_EVAL_CASES.map(c => ({
      personaId: c.personaId,
      personaName: c.personaName,
      group: c.group,
      groundTruthEntity: c.groundTruth.entityName,
      passThreshold: c.scoringConfig.passingThreshold,
    }));
  },
});

/**
 * Generate evaluation report
 */
export const generateEvalReport = action({
  args: {
    runId: v.optional(v.string()),
    useMock: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<string> => {
    // Run evaluation
    let result: UnifiedEvalResult;
    if (args.useMock) {
      result = await ctx.runAction(api.domains.evaluation.personas.unifiedPersonaHarness.runAllPersonaEvalsMock, {});
    } else {
      result = await ctx.runAction(api.domains.evaluation.personas.unifiedPersonaHarness.runAllPersonaEvalsLive, {});
    }

    // Generate report
    return formatUnifiedReport(result);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function aggregateResults(
  runId: string,
  startTime: number,
  personaResults: PersonaEvalResult[]
): UnifiedEvalResult {
  const endTime = Date.now();

  // Group results
  const byGroup: UnifiedEvalResult["byGroup"] = {
    financial: { personas: [], passed: 0, failed: 0, passRate: 0, avgScore: 0 },
    industry: { personas: [], passed: 0, failed: 0, passRate: 0, avgScore: 0 },
    strategic: { personas: [], passed: 0, failed: 0, passRate: 0, avgScore: 0 },
    technical: { personas: [], passed: 0, failed: 0, passRate: 0, avgScore: 0 },
    media: { personas: [], passed: 0, failed: 0, passRate: 0, avgScore: 0 },
  };

  for (const result of personaResults) {
    const evalCase = PERSONA_EVAL_CASES.find(c => c.personaId === result.personaId);
    if (!evalCase) continue;

    const group = evalCase.group;
    byGroup[group].personas.push(result.personaId);
    if (result.passed) {
      byGroup[group].passed++;
    } else {
      byGroup[group].failed++;
    }
  }

  // Calculate pass rates and avg scores
  for (const group of ["financial", "industry", "strategic", "technical", "media"] as const) {
    const groupResults = personaResults.filter(r => {
      const evalCase = PERSONA_EVAL_CASES.find(c => c.personaId === r.personaId);
      return evalCase?.group === group;
    });

    if (groupResults.length > 0) {
      byGroup[group].passRate = byGroup[group].passed / groupResults.length;
      byGroup[group].avgScore = groupResults.reduce((sum, r) => sum + r.normalizedScore, 0) / groupResults.length;
    }
  }

  // Calculate totals
  const totalPassed = personaResults.filter(r => r.passed).length;
  const totalFailed = personaResults.filter(r => !r.passed).length;

  // Generate recommendations
  const recommendations: string[] = [];

  for (const result of personaResults) {
    if (!result.passed) {
      recommendations.push(`${result.personaId}: Scored ${result.normalizedScore}/100 (needs ${result.passThreshold ?? 70})`);
      if (result.failedCriticals && result.failedCriticals.length > 0) {
        recommendations.push(`  - Failed critical categories: ${result.failedCriticals.join(", ")}`);
      }
    }
  }

  if (totalPassed < personaResults.length) {
    recommendations.push(`Overall: ${totalFailed} persona(s) need improvement`);
  }

  return {
    runId,
    startTime,
    endTime,
    totalDurationMs: endTime - startTime,
    totalPersonas: personaResults.length,
    totalPassed,
    totalFailed,
    overallPassRate: personaResults.length > 0 ? totalPassed / personaResults.length : 0,
    byGroup,
    personaResults,
    recommendations,
  };
}

function formatUnifiedReport(result: UnifiedEvalResult): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`UNIFIED PERSONA EVALUATION REPORT`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(``);
  lines.push(`Run ID: ${result.runId}`);
  lines.push(`Duration: ${result.totalDurationMs}ms`);
  lines.push(``);

  lines.push(`SUMMARY`);
  lines.push(`  Total Personas: ${result.totalPersonas}`);
  lines.push(`  Passed: ${result.totalPassed}`);
  lines.push(`  Failed: ${result.totalFailed}`);
  lines.push(`  Overall Pass Rate: ${(result.overallPassRate * 100).toFixed(1)}%`);
  lines.push(``);

  lines.push(`BY GROUP`);
  for (const [group, data] of Object.entries(result.byGroup)) {
    if (data.personas.length > 0) {
      lines.push(`  ${group.toUpperCase()}`);
      lines.push(`    Personas: ${data.personas.join(", ")}`);
      lines.push(`    Pass Rate: ${(data.passRate * 100).toFixed(1)}%`);
      lines.push(`    Avg Score: ${data.avgScore.toFixed(1)}/100`);
    }
  }
  lines.push(``);

  lines.push(`INDIVIDUAL RESULTS`);
  for (const persona of result.personaResults) {
    const status = persona.passed ? "PASS" : "FAIL";
    const criticalStatus = persona.criticalsPassed ? "✓" : "✗";
    lines.push(`  ${persona.personaId}: ${persona.normalizedScore.toFixed(1)}/100 [${status}] (criticals: ${criticalStatus})`);

    // Show category breakdown
    for (const cat of persona.categoryScores) {
      const catStatus = cat.passed ? "✓" : "✗";
      lines.push(`    - ${cat.category}: ${cat.normalizedScore.toFixed(1)}/${cat.maxPoints} ${catStatus}`);
    }
  }
  lines.push(``);

  if (result.recommendations.length > 0) {
    lines.push(`RECOMMENDATIONS`);
    for (const rec of result.recommendations) {
      lines.push(`  ${rec}`);
    }
  }

  lines.push(`═══════════════════════════════════════════════════════════════`);

  return lines.join("\n");
}
