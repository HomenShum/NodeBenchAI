/**
 * runBenchmark.ts
 *
 * Convex action to run the DD benchmark suite.
 *
 * Usage:
 *   npx convex run domains/evaluation/runBenchmark:runDDBenchmark '{}'
 *   npx convex run domains/evaluation/runBenchmark:runDDBenchmark '{"category": "fraud"}'
 */

"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  ALL_BENCHMARK_CASES,
  FRAUD_CASES,
  LEGITIMATE_CASES,
  AMBIGUOUS_CASES,
  BEC_CASES,
  runBenchmarkSuite,
  formatBenchmarkResults,
  BenchmarkCase,
  BenchmarkSuiteResult,
} from "./scoring/benchmarkSuite";

/**
 * Run the full DD benchmark suite
 */
export const runDDBenchmark = action({
  args: {
    category: v.optional(v.union(
      v.literal("fraud"),
      v.literal("legitimate"),
      v.literal("ambiguous"),
      v.literal("bec_pattern"),
      v.literal("all")
    )),
    verbose: v.optional(v.boolean()),
  },
  handler: async (ctx, { category = "all", verbose = false }): Promise<{
    success: boolean;
    summary: string;
    passRate: number;
    escalationAccuracy: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    recommendations: string[];
    fullResults?: BenchmarkSuiteResult;
  }> => {
    console.log(`[Benchmark] Starting DD benchmark suite (category: ${category})`);

    // Select cases
    let cases: BenchmarkCase[];
    switch (category) {
      case "fraud":
        cases = FRAUD_CASES;
        break;
      case "legitimate":
        cases = LEGITIMATE_CASES;
        break;
      case "ambiguous":
        cases = AMBIGUOUS_CASES;
        break;
      case "bec_pattern":
        cases = BEC_CASES;
        break;
      default:
        cases = ALL_BENCHMARK_CASES;
    }

    console.log(`[Benchmark] Running ${cases.length} test cases`);

    // Run benchmark
    const results = runBenchmarkSuite(cases);

    // Log results
    console.log(`[Benchmark] Results:`);
    console.log(formatBenchmarkResults(results));

    // Log individual failures for debugging
    if (verbose) {
      for (const caseResult of results.caseResults) {
        if (!caseResult.passed) {
          console.log(`\n[FAILED] ${caseResult.caseName}:`);
          console.log(`  Risk Score: ${caseResult.actualRiskScore}`);
          console.log(`  Tier: ${caseResult.actualTier}`);
          console.log(`  IAL: ${caseResult.actualIAL}`);
          console.log(`  BEC Patterns: ${caseResult.becPatternsFound}`);
          console.log(`  Signals: ${caseResult.signalsDetected.length}`);
          for (const failure of caseResult.failures) {
            console.log(`  - ${failure}`);
          }
        }
      }
    }

    return {
      success: results.passedCases === results.totalCases,
      summary: results.summary,
      passRate: results.passedCases / results.totalCases,
      escalationAccuracy: results.escalationAccuracy,
      falsePositiveRate: results.falsePositiveRate,
      falseNegativeRate: results.falseNegativeRate,
      recommendations: results.recommendations,
      fullResults: verbose ? results : undefined,
    };
  },
});

/**
 * Run benchmark and generate calibration report
 */
export const runCalibrationCheck = action({
  args: {},
  handler: async (ctx): Promise<{
    benchmarkPassed: boolean;
    passRate: number;
    categoryBreakdown: Record<string, { passed: number; total: number; accuracy: number }>;
    driftWarnings: string[];
    recommendations: string[];
  }> => {
    console.log(`[Calibration] Running calibration check`);

    // Run all benchmarks
    const results = runBenchmarkSuite(ALL_BENCHMARK_CASES);

    // Check for drift warnings
    const driftWarnings: string[] = [];

    // If any category drops below 70% accuracy, warn
    for (const [category, metrics] of Object.entries(results.resultsByCategory)) {
      if (metrics.total >= 2 && metrics.accuracy < 0.7) {
        driftWarnings.push(`${category} accuracy dropped to ${(metrics.accuracy * 100).toFixed(0)}%`);
      }
    }

    // If escalation accuracy drops below 80%, warn
    if (results.escalationAccuracy < 0.8) {
      driftWarnings.push(`Escalation accuracy dropped to ${(results.escalationAccuracy * 100).toFixed(0)}%`);
    }

    // If false negative rate exceeds 15%, critical warning
    if (results.falseNegativeRate > 0.15) {
      driftWarnings.push(`CRITICAL: False negative rate is ${(results.falseNegativeRate * 100).toFixed(0)}% - missing escalations`);
    }

    return {
      benchmarkPassed: results.passedCases === results.totalCases,
      passRate: results.passedCases / results.totalCases,
      categoryBreakdown: results.resultsByCategory,
      driftWarnings,
      recommendations: results.recommendations,
    };
  },
});

/**
 * Test a single company against the risk scoring system
 */
export const testCompanyRisk = action({
  args: {
    companyName: v.string(),
    websiteUrl: v.optional(v.string()),
    amountUsd: v.optional(v.number()),
    roundType: v.optional(v.string()),
    domainAge: v.optional(v.number()),
    foundInRegistry: v.optional(v.boolean()),
    founderName: v.optional(v.string()),
    founderLinkedIn: v.optional(v.string()),
    communicationText: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    riskScore: number;
    recommendedTier: string;
    escalationTriggers: string[];
    signals: Array<{ category: string; severity: string; signal: string }>;
    becPatterns: Array<{ type: string; severity: string; evidence: string }>;
    recommendations: string[];
  }> => {
    // Dynamic import to avoid circular dependency
    const { detectRiskSignals, calculateRiskScore } = await import("../agents/dueDiligence/riskScoring");
    const { detectBECPatterns } = await import("./inference/becPlaybook");

    // Build input
    const input: any = {
      companyName: args.companyName,
      websiteUrl: args.websiteUrl,
      amountUsd: args.amountUsd,
      roundType: args.roundType,
      domainAge: args.domainAge,
      foundInRegistry: args.foundInRegistry,
    };

    if (args.founderName) {
      input.founders = [{
        name: args.founderName,
        linkedinUrl: args.founderLinkedIn,
      }];
    }

    // Detect signals
    const signals = detectRiskSignals(input);
    const riskResult = calculateRiskScore(signals);

    // Detect BEC patterns
    const becPatterns = args.communicationText
      ? detectBECPatterns(args.communicationText)
      : [];

    // Build recommendations
    const recommendations: string[] = [];

    if (riskResult.overall > 50) {
      recommendations.push("Consider enhanced due diligence");
    }
    if (riskResult.escalationTriggers.length > 0) {
      recommendations.push("ESCALATION REQUIRED: " + riskResult.escalationTriggers.join(", "));
    }
    if (becPatterns.length > 0) {
      recommendations.push("BEC patterns detected - verify via known phone number before any payment");
    }
    if (!args.foundInRegistry) {
      recommendations.push("Verify company in business registry");
    }

    return {
      riskScore: riskResult.overall,
      recommendedTier: riskResult.recommendedTier,
      escalationTriggers: riskResult.escalationTriggers,
      signals: signals.map(s => ({
        category: s.category,
        severity: s.severity,
        signal: s.signal,
      })),
      becPatterns: becPatterns.map(p => ({
        type: p.type,
        severity: p.severity,
        evidence: p.evidence,
      })),
      recommendations,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL: Cron-schedulable calibration check wrapper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Internal wrapper for runCalibrationCheck, callable by cron scheduler.
 * Runs all DD benchmark cases and returns calibration results.
 */
export const runCalibrationCheckInternal = internalAction({
  args: {},
  handler: async (): Promise<{
    benchmarkPassed: boolean;
    passRate: number;
    categoryBreakdown: Record<string, { passed: number; total: number; accuracy: number }>;
    driftWarnings: string[];
    recommendations: string[];
  }> => {
    const results = runBenchmarkSuite(ALL_BENCHMARK_CASES);

    const driftWarnings: string[] = [];

    for (const [category, metrics] of Object.entries(results.resultsByCategory)) {
      if (metrics.total >= 2 && metrics.accuracy < 0.7) {
        driftWarnings.push(`${category} accuracy dropped to ${(metrics.accuracy * 100).toFixed(0)}%`);
      }
    }

    if (results.escalationAccuracy < 0.8) {
      driftWarnings.push(`Escalation accuracy dropped to ${(results.escalationAccuracy * 100).toFixed(0)}%`);
    }

    if (results.falseNegativeRate > 0.15) {
      driftWarnings.push(`CRITICAL: False negative rate is ${(results.falseNegativeRate * 100).toFixed(0)}% - missing escalations`);
    }

    return {
      benchmarkPassed: results.passedCases === results.totalCases,
      passRate: results.passedCases / results.totalCases,
      categoryBreakdown: results.resultsByCategory,
      driftWarnings,
      recommendations: results.recommendations,
    };
  },
});
