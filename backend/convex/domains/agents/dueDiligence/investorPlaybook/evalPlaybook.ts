/**
 * Playbook Evaluation Action
 *
 * Direct test action to evaluate the investor playbook against MyDentalWig ground truth.
 * Run via: npx convex run domains/agents/dueDiligence/investorPlaybook/evalPlaybook:evaluateMyDentalWig
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import { runInvestorPlaybook, generatePlaybookReport } from "./playbookOrchestrator";
import type { SecuritiesRegime } from "./types";

// Ground truth for MyDentalWig
const GROUND_TRUTH = {
  entityName: "MyDentalWig",
  entity: { state: "DE", formationYear: 2021 },
  securities: { regime: "Reg CF" as SecuritiesRegime },
  finra: { portal: "PicMii" },
  fda: { claimedStatus: "FDA Cleared" }, // KEY: This is likely misrepresentation
  patents: { claimed: ["US 7,967,145"] },
  expectedRisk: "high",
};

interface EvalResult {
  passed: boolean;
  score: number;
  maxScore: number;
  findings: Array<{
    category: string;
    expected: string;
    actual: string;
    match: boolean;
  }>;
  criticalFailures: string[];
  executionTimeMs: number;
  report: string;
  rawOutput: any;
}

/**
 * Evaluate playbook against MyDentalWig ground truth
 */
export const evaluateMyDentalWig = internalAction({
  args: {},
  handler: async (ctx): Promise<EvalResult> => {
    const startTime = Date.now();
    console.log("[EVAL] Starting MyDentalWig evaluation...");

    // Run the playbook
    const result = await runInvestorPlaybook(ctx, {
      entityName: GROUND_TRUTH.entityName,
      entityType: "company",
      claimedState: GROUND_TRUTH.entity.state,
      claimedFormationYear: GROUND_TRUTH.entity.formationYear,
      claimedSecuritiesRegime: GROUND_TRUTH.securities.regime,
      claimedFundingPortal: GROUND_TRUTH.finra.portal,
      claimedFDAStatus: GROUND_TRUTH.fda.claimedStatus,
      claimedPatents: GROUND_TRUTH.patents.claimed,
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[EVAL] Playbook completed in ${executionTimeMs}ms`);

    // Generate report
    const report = generatePlaybookReport(result.synthesis);

    // Evaluate results
    const findings: EvalResult["findings"] = [];
    const criticalFailures: string[] = [];
    let score = 0;
    const maxScore = 100;

    // 1. Overall Risk (25 pts)
    const riskMatch = ["high", "critical", "elevated"].includes(result.synthesis.overallRisk);
    findings.push({
      category: "Overall Risk",
      expected: "high/critical/elevated",
      actual: result.synthesis.overallRisk,
      match: riskMatch,
    });
    if (riskMatch) score += 25;
    if (result.synthesis.overallRisk === "low") {
      criticalFailures.push("Rated HIGH RISK company as LOW");
    }

    // 2. FDA Misrepresentation Detection (25 pts) - MOST CRITICAL
    const fdaFindings = result.branchResults.fdaVerification;

    // Debug logging for FDA verification
    console.log(`[EVAL] FDA Claimed Status: ${fdaFindings?.claimedStatus}`);
    console.log(`[EVAL] FDA Actual Status: ${fdaFindings?.actualStatus}`);
    console.log(`[EVAL] FDA Status Matches Claims: ${fdaFindings?.statusMatchesClaims}`);
    console.log(`[EVAL] FDA Red Flags:`, JSON.stringify(fdaFindings?.redFlags, null, 2));
    console.log(`[EVAL] Stop Rules:`, JSON.stringify(result.synthesis.stopRules, null, 2));

    const fdaMisrepDetected =
      fdaFindings?.redFlags.some(f =>
        f.type === "status_misrepresentation" ||
        f.type === "clearance_not_found"
      ) ||
      !fdaFindings?.statusMatchesClaims ||
      result.synthesis.stopRules.some(r =>
        r.triggered && r.rule.toLowerCase().includes("fda")
      );

    findings.push({
      category: "FDA Misrepresentation",
      expected: "DETECTED",
      actual: fdaMisrepDetected ? "DETECTED" : "NOT DETECTED",
      match: fdaMisrepDetected,
    });
    if (fdaMisrepDetected) score += 25;
    if (!fdaMisrepDetected) {
      criticalFailures.push("Failed to detect FDA cleared vs registered misrepresentation");
    }

    // 3. SEC/Securities Verification (15 pts)
    const secScore = result.synthesis.verificationScores.securities;
    const secVerified = secScore > 0.3;
    findings.push({
      category: "SEC Verification",
      expected: "Reg CF detected",
      actual: `Score: ${(secScore * 100).toFixed(0)}%`,
      match: secVerified,
    });
    if (secVerified) score += 15;

    // 4. FINRA Portal (10 pts)
    const finraScore = result.synthesis.verificationScores.finra;
    const finraVerified = finraScore > 0.3;
    findings.push({
      category: "FINRA Portal",
      expected: "PicMii verified",
      actual: `Score: ${(finraScore * 100).toFixed(0)}%`,
      match: finraVerified,
    });
    if (finraVerified) score += 10;

    // 5. Entity Verification (10 pts)
    const entityScore = result.synthesis.verificationScores.entity;
    const entityVerified = entityScore > 0.2;
    findings.push({
      category: "Entity Verification",
      expected: "DE corp found",
      actual: `Score: ${(entityScore * 100).toFixed(0)}%`,
      match: entityVerified,
    });
    if (entityVerified) score += 10;

    // 6. Patent Check (5 pts)
    const patentScore = result.synthesis.verificationScores.patents;
    const patentChecked = patentScore > 0.2;
    findings.push({
      category: "Patent Check",
      expected: "US 7,967,145 checked",
      actual: `Score: ${(patentScore * 100).toFixed(0)}%`,
      match: patentChecked,
    });
    if (patentChecked) score += 5;

    // 7. Money Flow (10 pts)
    const moneyScore = result.synthesis.verificationScores.moneyFlow;
    const moneyChecked = moneyScore > 0.2;
    findings.push({
      category: "Money Flow",
      expected: "Verified",
      actual: `Score: ${(moneyScore * 100).toFixed(0)}%`,
      match: moneyChecked,
    });
    if (moneyChecked) score += 10;

    const passed = score >= 60 && criticalFailures.length === 0;

    console.log(`[EVAL] Score: ${score}/${maxScore} (${passed ? "PASSED" : "FAILED"})`);
    if (criticalFailures.length > 0) {
      console.log(`[EVAL] Critical failures: ${criticalFailures.join(", ")}`);
    }

    return {
      passed,
      score,
      maxScore,
      findings,
      criticalFailures,
      executionTimeMs,
      report,
      rawOutput: {
        overallRisk: result.synthesis.overallRisk,
        recommendation: result.synthesis.recommendation,
        shouldDisengage: result.synthesis.shouldDisengage,
        verificationScores: result.synthesis.verificationScores,
        discrepancyCount: result.synthesis.discrepancies.length,
        stopRulesTriggered: result.synthesis.stopRules.filter(r => r.triggered).map(r => r.rule),
        branchesExecuted: result.synthesis.branchesExecuted,
      },
    };
  },
});

/**
 * Quick test - just run playbook and return raw results
 */
export const testPlaybook = internalAction({
  args: {
    entityName: v.string(),
    claimedFDAStatus: v.optional(v.string()),
    claimedSecuritiesRegime: v.optional(v.string()),
    claimedFundingPortal: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[TEST] Running playbook for ${args.entityName}...`);

    const result = await runInvestorPlaybook(ctx, {
      entityName: args.entityName,
      entityType: "company",
      claimedFDAStatus: args.claimedFDAStatus,
      claimedSecuritiesRegime: args.claimedSecuritiesRegime as SecuritiesRegime | undefined,
      claimedFundingPortal: args.claimedFundingPortal,
    });

    const report = generatePlaybookReport(result.synthesis);

    return {
      overallRisk: result.synthesis.overallRisk,
      recommendation: result.synthesis.recommendation,
      shouldDisengage: result.synthesis.shouldDisengage,
      verificationScores: result.synthesis.verificationScores,
      discrepancies: result.synthesis.discrepancies,
      stopRulesTriggered: result.synthesis.stopRules.filter(r => r.triggered),
      executionTimeMs: result.executionTimeMs,
      report,
    };
  },
});

// ============================================================================
// TASK 2 GROUND TRUTH: Vijay Rao / Meta Manus Acquisition Verification
// ============================================================================

const TASK2_INPUT = `Vijay Rao
https://www.linkedin.com/in/raovj/

Does it have to do with recent news for Manus acquisition? Vijay initiated the effort and scaled the GPU training clusters for serving and training AI Models. Manus trains their own Manus models for multimodal instruction following agent models and dogfood their own models for the browser automation tasks, which quite much aligns with the narrative where Tests Assured has deep QA Automation expertise, has been integrated with Meta, has proposed to make QA Automation platform to serve customers that need QA automation solution like testing out apps created by AI and generating report and optimization fixes. And other major companies like google gemini antigravity and browser base are all tackling this next trend. Meta can benefit dramatically from acquiring Manus and its foundational models, serve Manus the training capacities and grow super quickly, compete on global multimodal agentic AI models benchmarks, and let companies like tests assured and their development studio to spin off platforms that utilizes Manus by Meta and sell inference and earn revenue and profit and user training data for the next few years.

But, I can be very wrong, be brutally honest, deeply due diligence and critique and verify all information patches fully paralleled
How exactly did you come up with all this from my input? I want a full step by step guide for reproducing similar due diligence and verifications`;

const TASK2_GROUND_TRUTH = {
  // What should be VERIFIED (high confidence)
  verified: {
    metaAcquiredManus: true,          // Meta did acquire Manus in late Dec 2025
    manusHasBrowserAutomation: true,   // Manus markets browser operator capabilities
    vijayRaoIsMetaVP: true,            // VP of Compute at Meta
    antigravityIsReal: true,           // Google's agent-first dev environment
    browserbaseIsReal: true,           // Browser infra for AI automation
    testsAssuredWorkedWithMeta: true,  // TA claims prior work with Meta
  },
  // What should be CONTRADICTED (based on reporting)
  contradicted: {
    manusTrainsOwnModels: true,        // Manus uses third-party models (Anthropic/Qwen)
    metaWillLetVendorsResell: true,    // Not supported, conflicts with platform control
  },
  // What is UNVERIFIED / SPECULATIVE
  unverified: {
    vijayInitiatedGPUScaling: true,    // No public confirmation
    vijayVisitRelatedToManus: true,    // Possible but no evidence
  },
  // Key sources that should be cited
  expectedSources: [
    "reuters.com",
    "businessinsider.com",
    "linkedin.com",
    "theverge.com",
    "venturebeat.com",
  ],
};

interface Task2EvalResult {
  passed: boolean;
  score: number;
  maxScore: number;
  findings: {
    verified: Record<string, boolean>;
    contradicted: Record<string, boolean>;
    unverified: Record<string, boolean>;
    sourcesFound: string[];
    sourcesMissing: string[];
  };
  criticalGaps: string[];
  executionTimeMs: number;
  rawOutput: any;
}

/**
 * Evaluate Task 2: Vijay Rao / Meta Manus complex verification
 */
export const evaluateTask2VijayRaoManus = internalAction({
  args: {},
  handler: async (ctx): Promise<Task2EvalResult> => {
    const startTime = Date.now();
    console.log("[EVAL-TASK2] Starting Vijay Rao / Manus verification evaluation (v2 - enhanced)...");

    // Run the playbook with claim verification mode enabled
    const result = await runInvestorPlaybook(ctx, {
      entityName: "Manus",
      entityType: "company",
      claimVerificationMode: {
        enabled: true,
        rawQuery: TASK2_INPUT,
        personToVerify: "Vijay Rao",
        personLinkedIn: "https://www.linkedin.com/in/raovj/",
        personClaimedRole: "VP of Compute",
        personClaimedCompany: "Meta",
        acquisitionAcquirer: "Meta",
        acquisitionTarget: "Manus",
        newsEvent: "Meta acquisition of Manus AI startup",
      },
      signals: {
        isRequestingFunding: false,
        isClaimVerification: true,
        hasSpecificClaims: true,
        personMentioned: "Vijay Rao",
        linkedInUrl: "https://www.linkedin.com/in/raovj/",
        acquisitionMentioned: true,
        newsEventMentioned: true,
        companiesInvolved: ["Meta", "Manus", "Tests Assured", "Google", "Browserbase"],
      },
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[EVAL-TASK2] Playbook completed in ${executionTimeMs}ms`);

    // Evaluate results
    const findings = {
      verified: {} as Record<string, boolean>,
      contradicted: {} as Record<string, boolean>,
      unverified: {} as Record<string, boolean>,
      sourcesFound: [] as string[],
      sourcesMissing: [] as string[],
    };
    const criticalGaps: string[] = [];
    let score = 0;
    const maxScore = 110; // Including bonus points for high confidence

    // Check verified claims
    const claimVerification = result.branchResults.claimVerification;
    const newsVerification = result.branchResults.newsVerification;
    const personVerification = result.branchResults.personVerification;

    // Score claim verification (30 pts)
    if (claimVerification) {
      const verifiedCount = claimVerification.verifiedClaims?.length ?? 0;
      const contradictedCount = claimVerification.contradictedClaims?.length ?? 0;

      if (verifiedCount >= 3) score += 15;
      else if (verifiedCount >= 1) score += 8;

      if (contradictedCount >= 1) score += 15; // Should identify contradicted claims

      console.log(`[EVAL-TASK2] Claims: ${verifiedCount} verified, ${contradictedCount} contradicted`);
    } else {
      criticalGaps.push("Claim verification branch did not run");
    }

    // Score news verification (30 pts)
    if (newsVerification) {
      if (newsVerification.eventVerified) {
        score += 20;
        findings.verified["metaAcquiredManus"] = true;
      }
      if (newsVerification.acquisitionDetails) {
        score += 10;
      }
      console.log(`[EVAL-TASK2] News verified: ${newsVerification.eventVerified}`);
    } else {
      criticalGaps.push("News verification branch did not run");
    }

    // Score person verification (20 pts)
    if (personVerification) {
      if (personVerification.verified) {
        score += 15;
        findings.verified["vijayRaoIsMetaVP"] = true;
      }
      if (personVerification.currentCompany?.toLowerCase().includes("meta")) {
        score += 5;
      }
      console.log(`[EVAL-TASK2] Person verified: ${personVerification.verified}`);
    } else {
      criticalGaps.push("Person verification branch did not run");
    }

    // Bonus: High confidence verification (10 pts)
    if (newsVerification && newsVerification.overallConfidence >= 0.85) {
      score += 5;
      console.log(`[EVAL-TASK2] Bonus: High news confidence (${newsVerification.overallConfidence})`);
    }
    if (claimVerification && claimVerification.confidenceScore >= 0.7) {
      score += 5;
      console.log(`[EVAL-TASK2] Bonus: High claim confidence (${claimVerification.confidenceScore})`);
    }

    // Score sources (20 pts)
    const allSources = result.sources.map(s => s.url || "").filter(Boolean);
    for (const expectedSource of TASK2_GROUND_TRUTH.expectedSources) {
      const found = allSources.some(url => url.toLowerCase().includes(expectedSource));
      if (found) {
        findings.sourcesFound.push(expectedSource);
        score += 4;
      } else {
        findings.sourcesMissing.push(expectedSource);
      }
    }

    const passed = score >= 60;

    console.log(`[EVAL-TASK2] ═══════════════════════════════════════`);
    console.log(`[EVAL-TASK2] EVALUATION COMPLETE`);
    console.log(`[EVAL-TASK2] Score: ${score}/${maxScore} (${passed ? "PASSED" : "FAILED"})`);
    console.log(`[EVAL-TASK2] Critical gaps: ${criticalGaps.length}`);
    console.log(`[EVAL-TASK2] ═══════════════════════════════════════`);

    return {
      passed,
      score,
      maxScore,
      findings,
      criticalGaps,
      executionTimeMs,
      rawOutput: {
        claimVerification: claimVerification ? {
          verifiedCount: claimVerification.verifiedClaims?.length ?? 0,
          unverifiedCount: claimVerification.unverifiedClaims?.length ?? 0,
          contradictedCount: claimVerification.contradictedClaims?.length ?? 0,
          overallAssessment: claimVerification.overallAssessment,
        } : null,
        newsVerification: newsVerification ? {
          eventVerified: newsVerification.eventVerified,
          eventType: newsVerification.eventType,
          overallConfidence: newsVerification.overallConfidence,
        } : null,
        personVerification: personVerification ? {
          verified: personVerification.verified,
          currentRole: personVerification.currentRole,
          currentCompany: personVerification.currentCompany,
          confidenceScore: personVerification.confidenceScore,
        } : null,
        branchesExecuted: result.synthesis.branchesExecuted,
        totalSources: result.sources.length,
      },
    };
  },
});

// ============================================================================
// UNIFIED HARNESS INTEGRATION
// ============================================================================

/**
 * Run Investor Playbook for Unified Persona Evaluation
 *
 * This action is called by the unified persona harness to evaluate
 * different personas against their ground truth cases.
 */
export const runInvestorPlaybookEval = internalAction({
  args: {
    entityName: v.string(),
    entityType: v.optional(v.string()),
    persona: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[EVAL] Running playbook eval for ${args.entityName} (persona: ${args.persona || "default"})...`);
    const startTime = Date.now();

    // Map persona to appropriate config signals
    const signals = getPersonaSignals(args.persona);

    // Run the playbook
    const result = await runInvestorPlaybook(ctx, {
      entityName: args.entityName,
      entityType: (args.entityType as "company" | "fund" | "person") || "company",
      signals,
      // Enable claim verification for journalist/academic personas
      // CRITICAL: Pass rawQuery for scientific claim detection (LK-99, cold fusion, etc.)
      claimVerificationMode: ["JOURNALIST", "ACADEMIC_RD", "PHARMA_BD", "CTO_TECH_LEAD"].includes(args.persona || "")
        ? {
            enabled: true,
            rawQuery: args.entityName, // Pass entity name as query for scientific claim pattern matching
            newsEvent: `News about ${args.entityName}`,
          }
        : {
            enabled: true,
            rawQuery: args.entityName, // Always pass for scientific claim detection
          },
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[EVAL] Playbook eval completed in ${executionTimeMs}ms`);

    return {
      synthesis: result.synthesis,
      branchResults: result.branchResults,
      sources: result.sources,
      executionTimeMs,
    };
  },
});

/**
 * Map persona to complexity signals for routing
 */
function getPersonaSignals(persona?: string): import("./types").PlaybookComplexitySignals {
  const baseSignals = {
    isRequestingFunding: false,
    isClaimVerification: false,
    hasSpecificClaims: false,
    acquisitionMentioned: false,
    newsEventMentioned: false,
    academicResearchMentioned: false,
    hasScientificClaims: false,
  };

  switch (persona) {
    case "JPM_STARTUP_BANKER":
      return { ...baseSignals, isRequestingFunding: true };

    case "LP_ALLOCATOR":
      return { ...baseSignals, hasSpecificClaims: true };

    case "QUANT_PM":
      return { ...baseSignals, hasSpecificClaims: true };

    case "EARLY_STAGE_VC":
      return { ...baseSignals, isRequestingFunding: true, hasSpecificClaims: true };

    case "PHARMA_BD":
      // Pharma BD needs scientific claim verification for drug/biotech claims
      return { ...baseSignals, hasSpecificClaims: true, academicResearchMentioned: true };

    case "ACADEMIC_RD":
      // Academic R&D is the primary persona for scientific claim verification
      return {
        ...baseSignals,
        isClaimVerification: true,
        hasSpecificClaims: true,
        academicResearchMentioned: true,
        hasScientificClaims: true, // Always check scientific claims for this persona
      };

    case "CORP_DEV":
      return { ...baseSignals, acquisitionMentioned: true };

    case "MACRO_STRATEGIST":
      return { ...baseSignals, newsEventMentioned: true };

    case "FOUNDER_STRATEGY":
      return { ...baseSignals, hasSpecificClaims: true };

    case "CTO_TECH_LEAD":
      // CTO needs scientific claim verification for tech claims
      return { ...baseSignals, hasSpecificClaims: true, academicResearchMentioned: true };

    case "JOURNALIST":
      return { ...baseSignals, isClaimVerification: true, newsEventMentioned: true };

    default:
      return baseSignals;
  }
}
